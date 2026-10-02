/**
 * Background preview service — Stage B2 §6
 *
 * 「去除纯色背景」不该在用户点下开关的瞬间**静默**改掉图纸。开启后先做一次**轻量预检**，
 * 把「能不能安全移除、大概移除多少」摆到用户面前，由他决定 [应用] 还是 [保留背景]。
 *
 * ── 为什么预检不在最终格数上跑 ──────────────────────────────────────
 * 背景「是不是一块纯色」和图纸有多少格无关，所以预检把长边封在 `PREVIEW_LONG_EDGE`，
 * 一次采样几十毫秒就能出结论。移除**比例**是尺度无关的，直接用；
 * 移除**格数**按格数比线性折算，文案里如实写「预计」。
 *
 * 真正的判定仍然在生成时由 `generateV2` 在**真实格数**上重跑一遍
 * （见 background-reliability.mjs）。预检只是提示，**不是**放行凭证 ——
 * 所以预检即使乐观，也不会导致主体被误删。
 *
 * 纯计算，无 DOM / window / 应用 state。图片解码由调用方（app.js）完成。
 */

import { sampleGrid, sampleGridAdaptive, SamplingMode } from "../smart-preprocessing/sampling-engine-v2.mjs";
import { SAMPLING_CONFIG_V2, buildAlphaGrid } from "../smart-preprocessing/generation-engine-v2.mjs";
import {
  resolveBackgroundDecision,
  BACKGROUND_STATUS,
  BACKGROUND_KEEP_MESSAGE,
  formatBackgroundRemovalMessage,
} from "../smart-preprocessing/background-reliability.mjs";

/** 预检长边上限。够看清「背景是不是一块纯色」，又不至于把 UI 卡住。 */
export const PREVIEW_LONG_EDGE = 160;

/** 按长边上限等比缩放，并保证两边都 ≥ 2。 */
export function resolveProbeSize(width, height, cap = PREVIEW_LONG_EDGE) {
  const w = Math.max(2, Math.round(Number(width) || 0));
  const h = Math.max(2, Math.round(Number(height) || 0));
  const long = Math.max(w, h);
  if (!cap || long <= cap) return { width: w, height: h };
  const scale = cap / long;
  return {
    width: Math.max(2, Math.round(w * scale)),
    height: Math.max(2, Math.round(h * scale)),
  };
}

/**
 * 跑一次背景预检。
 *
 * @param {object} input
 * @param {{data:Uint8ClampedArray,width:number,height:number}} input.image 源图 ImageData
 * @param {{width:number,height:number}} input.finalSize 这一版图纸的真实格数（用于折算格数）
 * @param {string} [input.sampling] "auto" | "linear-mean" | "center" | "dominant" | "edge-aware"
 * @param {string} [input.preset] 自适应采样的**内容预设提示**，不是生成模式。
 *   **必须与 generateV2 的 `options.preset` 同源** —— 生产链路从不传它，
 *   所以这里保持默认值，两边都走 "photo" / `autoProfile: false`。
 *   （B4 §2 之前宿主把生成模式传进来，导致预检与真实生成用的采样不一致。）
 * @param {object} [input.options] 背景阈值 + 可靠性阈值覆盖
 * @returns {{
 *   status:string, reliable:boolean, removedCount:number, removedRatio:number,
 *   estimatedRemoved:number, message:string, reason:string,
 *   metrics:object, detail:object, probeSize:{width:number,height:number}
 * }}
 */
export function previewBackgroundRemoval({
  image,
  finalSize = null,
  sampling = "auto",
  preset = "photo",
  options = {},
} = {}) {
  const sourceWidth = Number(image?.width) || 0;
  const sourceHeight = Number(image?.height) || 0;
  if (!image?.data || !sourceWidth || !sourceHeight) {
    return emptyPreview({ width: 0, height: 0 }, "没有可预检的源图。");
  }

  const probeSize = resolveProbeSize(sourceWidth, sourceHeight);
  const sampled = sampling === SamplingMode.AUTO
    ? sampleGridAdaptive(image, probeSize.width, probeSize.height, {
      preset, autoProfile: preset === "auto", ...SAMPLING_CONFIG_V2,
    })
    : sampleGrid(image, probeSize.width, probeSize.height, { mode: sampling, ...SAMPLING_CONFIG_V2 });

  // 只做「有没有颜色」的标记网格 —— 预检不需要色号，
  // 但 resolveBackgroundDecision 的 removedCount 口径是「原本有颜色的格」，
  // 所以这里必须给出一个非 null 的占位格，口径才与生成时一致。
  const markerGrid = [];
  for (let y = 0; y < probeSize.height; y += 1) {
    const row = new Array(probeSize.width);
    for (let x = 0; x < probeSize.width; x += 1) row[x] = sampled.colors[y]?.[x] ? {} : null;
    markerGrid.push(row);
  }

  const alphaGrid = buildAlphaGrid(image, probeSize.width, probeSize.height);
  const decision = resolveBackgroundDecision({
    rgbGrid: sampled.colors,
    alphaGrid,
    grid: markerGrid,
    width: probeSize.width,
    height: probeSize.height,
    options,
  });

  const reliable = decision.status === BACKGROUND_STATUS.RELIABLE;
  const finalCells = finalSize
    ? Math.max(1, (Number(finalSize.width) || 0) * (Number(finalSize.height) || 0))
    : probeSize.width * probeSize.height;
  const probeCells = probeSize.width * probeSize.height;
  const estimatedRemoved = reliable
    ? Math.max(0, Math.round(decision.removedCount * (finalCells / Math.max(1, probeCells))))
    : 0;

  return {
    status: decision.status,
    reliable,
    removedCount: decision.removedCount,
    removedRatio: decision.removedRatio,
    estimatedRemoved,
    message: reliable
      ? formatBackgroundRemovalMessage(estimatedRemoved, decision.removedRatio)
      : BACKGROUND_KEEP_MESSAGE,
    reason: decision.reason,
    metrics: decision.metrics,
    detail: decision.detail,
    probeSize,
  };
}

function emptyPreview(probeSize, reason) {
  return {
    status: BACKGROUND_STATUS.NONE,
    reliable: false,
    removedCount: 0,
    removedRatio: 0,
    estimatedRemoved: 0,
    message: BACKGROUND_KEEP_MESSAGE,
    reason,
    metrics: null,
    detail: null,
    probeSize,
  };
}

export { BACKGROUND_STATUS, BACKGROUND_KEEP_MESSAGE, formatBackgroundRemovalMessage };

export default {
  PREVIEW_LONG_EDGE,
  BACKGROUND_STATUS,
  BACKGROUND_KEEP_MESSAGE,
  resolveProbeSize,
  previewBackgroundRemoval,
};
