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
import { BACKGROUND_MODES } from "./background-mode.mjs";
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
 * 阶段 3：`mode` 决定预检问哪个问题 ——
 *   · auto        既有路径：采样 + 可靠性门，回答「能不能安全移除纯色背景」；
 *   · keep        回答「有多少透明区域会被填充成背景色的豆」；
 *   · transparent 回答「有多少透明区域会留空」。
 * 后两个模式**不跑**采样与五指标判定：它们压根不移除背景，跑一遍纯属白开销，
 * 而且会给用户一个与当前模式无关的「建议」——那正是要避免的误导。
 *
 * @param {object} input
 * @param {{data:Uint8ClampedArray,width:number,height:number}} input.image 源图 ImageData
 * @param {{width:number,height:number}} input.finalSize 这一版图纸的真实格数（用于折算格数）
 * @param {string} [input.sampling] "auto" | "linear-mean" | "center" | "dominant" | "edge-aware"
 * @param {string} [input.preset] 自适应采样的**内容预设提示**，不是生成模式。
 *   **必须与 generateV2 的 `options.preset` 同源** —— 生产链路从不传它，
 *   所以这里保持默认值，两边都走 "photo" / `autoProfile: false`。
 *   （B4 §2 之前宿主把生成模式传进来，导致预检与真实生成用的采样不一致。）
 * @param {string} [input.mode] 阶段 3 背景处理模式（keep / transparent / auto）。
 *   缺省 "auto" = 与阶段 3 之前的行为逐位一致（既有调用方不传它）。
 * @param {string} [input.fillColor] keep 模式的填充色（"#rrggbb"），只影响文案。
 * @param {object} [input.options] 背景阈值 + 可靠性阈值覆盖
 * @returns {{
 *   status:string, reliable:boolean, removedCount:number, removedRatio:number,
 *   estimatedRemoved:number, message:string, reason:string,
 *   mode:string, transparentCells:number, estimatedTransparent:number,
 *   metrics:object, detail:object, probeSize:{width:number,height:number}
 * }}
 */
export function previewBackgroundRemoval({
  image,
  finalSize = null,
  sampling = "auto",
  preset = "photo",
  mode = BACKGROUND_MODES.AUTO,
  fillColor = null,
  options = {},
} = {}) {
  const sourceWidth = Number(image?.width) || 0;
  const sourceHeight = Number(image?.height) || 0;
  if (!image?.data || !sourceWidth || !sourceHeight) {
    return emptyPreview({ width: 0, height: 0 }, "没有可预检的源图。", mode);
  }

  const probeSize = resolveProbeSize(sourceWidth, sourceHeight);
  const finalCells = finalSize
    ? Math.max(1, (Number(finalSize.width) || 0) * (Number(finalSize.height) || 0))
    : probeSize.width * probeSize.height;
  const probeCells = probeSize.width * probeSize.height;
  const scale = finalCells / Math.max(1, probeCells);

  // 透明格估算：三个模式都用同一份 alpha 网格（口径与生成时的 buildAlphaGrid 一致）。
  const alphaGrid = buildAlphaGrid(image, probeSize.width, probeSize.height);
  let transparentCells = 0;
  for (let i = 0; i < alphaGrid.length; i += 1) {
    if (alphaGrid[i] === 0) transparentCells += 1;
  }
  const estimatedTransparent = Math.max(0, Math.round(transparentCells * scale));

  // ── keep / transparent：只回答「透明区域会怎样」，不碰移除判定 ──────────
  if (mode === BACKGROUND_MODES.KEEP || mode === BACKGROUND_MODES.TRANSPARENT) {
    const base = {
      mode,
      transparentCells,
      estimatedTransparent,
      probeSize,
      status: BACKGROUND_STATUS.NONE,
      reliable: false,
      removedCount: 0,
      removedRatio: 0,
      estimatedRemoved: 0,
      metrics: null,
      detail: null,
      reason: "",
    };
    if (transparentCells === 0) {
      return {
        ...base,
        message: mode === BACKGROUND_MODES.KEEP
          ? "未检测到透明区域；整幅图像都会生成豆。"
          : "未检测到透明区域；没有区域会留空。",
      };
    }
    return {
      ...base,
      message: mode === BACKGROUND_MODES.KEEP
        ? `预计 ${estimatedTransparent} 格透明区域将填充为背景色 ${fillColor || "#ffffff"}`
        : `预计 ${estimatedTransparent} 格透明区域将留空、不填豆`,
    };
  }

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

  const decision = resolveBackgroundDecision({
    rgbGrid: sampled.colors,
    alphaGrid,
    grid: markerGrid,
    width: probeSize.width,
    height: probeSize.height,
    options,
  });

  const reliable = decision.status === BACKGROUND_STATUS.RELIABLE;
  const estimatedRemoved = reliable
    ? Math.max(0, Math.round(decision.removedCount * scale))
    : 0;

  return {
    mode: BACKGROUND_MODES.AUTO,
    status: decision.status,
    reliable,
    removedCount: decision.removedCount,
    removedRatio: decision.removedRatio,
    estimatedRemoved,
    transparentCells,
    estimatedTransparent,
    message: reliable
      ? formatBackgroundRemovalMessage(estimatedRemoved, decision.removedRatio)
      : BACKGROUND_KEEP_MESSAGE,
    reason: decision.reason,
    metrics: decision.metrics,
    detail: decision.detail,
    probeSize,
  };
}

function emptyPreview(probeSize, reason, mode = BACKGROUND_MODES.AUTO) {
  return {
    mode,
    status: BACKGROUND_STATUS.NONE,
    reliable: false,
    removedCount: 0,
    removedRatio: 0,
    estimatedRemoved: 0,
    transparentCells: 0,
    estimatedTransparent: 0,
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
