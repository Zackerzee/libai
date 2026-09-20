/**
 * segmentation/index.js
 * ─────────────────────────────────────────────────────────────
 * 把各算子组合成上游 `autoCutout()`（app.js:88–222）的等价物。
 *
 * 上游的六阶段（行号为 app.js）：
 *   1. 3×3 Sobel                      99–115
 *   2. 自适应阈值（median × 0.8）      117–125
 *   3. 膨胀桥接 × morphIter            127–143
 *   4. 背景色 = 边框均值                145–170
 *   5. mask = 膨胀边缘 OR 距背景 > 阈值 172–188
 *   6. 开运算（多数腐蚀 + 膨胀）× morphIter  190–219
 *
 * 本模块逐阶段对应，并按 `profile` 决定是否启用修复：
 *   `upstream` —— 只做阶段 1–6，参数与上游默认一致，**不读 alpha、不做连通性过滤**
 *   `improved` —— 同样的骨架，但：多尺度边缘可开、背景可换 K-means、
 *                 腐蚀可换标准 min-filter、读 alpha、加连通性过滤、真正接上羽化
 */

import { PW_CONFIG, PIPELINE_PROFILE, THRESHOLD_MODE, BACKGROUND_MODE, ERODE_MODE, resolvePrecision } from "../config.js";
import { toLuma } from "./sobel3.js";
import { multiScaleEdge } from "./multi-scale-edge.js";
import { resolveThreshold, binarize, edgeHistogram } from "./adaptive-threshold.js";
import { estimateBackground, markBackgroundSimilar } from "./background-kmeans.js";
import { dilate, erodeWith, filterComponents, componentStats } from "./morphology.js";
import { featherMask, featherRadiusForPrecision } from "./feather-mask.js";
import { weightedRgbDistance } from "../color/weighted-rgb.js";

export * from "./sobel3.js";
export * from "./sobel5.js";
export * from "./multi-scale-edge.js";
export * from "./adaptive-threshold.js";
export * from "./background-kmeans.js";
export * from "./morphology.js";
export * from "./feather-mask.js";

/**
 * 上游那一整段 `autoCutout`。纯函数，零 DOM / Canvas。
 *
 * @param {{data:ArrayLike<number>, width:number, height:number}} raster
 * @param {{
 *   precision?:string, profile?:string,
 *   useMultiScale?:boolean, useSobel5?:boolean,
 *   backgroundMode?:string, backgroundK?:number,
 *   erodeMode?:string, alphaThreshold?:number,
 *   filterConnectivity?:boolean, minComponentSize?:number, keepBorderContact?:null|boolean,
 *   feather?:number|null, edgeThresh?:number, colorThresh?:number, morphIter?:number,
 *   distanceFn?:Function
 * }} [options]
 * @returns {{
 *   mask:Uint8Array, alpha:Float32Array, bgColor:number[], stages:object, diagnostics:object
 * }}
 */
export function segmentForeground(raster, options = {}) {
  const profile = options.profile === PIPELINE_PROFILE.UPSTREAM ? PIPELINE_PROFILE.UPSTREAM : PIPELINE_PROFILE.IMPROVED;
  const upstream = profile === PIPELINE_PROFILE.UPSTREAM;

  const preset = resolvePrecision(options.precision ?? PW_CONFIG.precision.default);
  const edgeThresh = options.edgeThresh ?? preset.edgeThresh;
  const colorThresh = options.colorThresh ?? preset.colorThresh;
  const morphIter = options.morphIter ?? preset.morphIter;

  const alphaThreshold = options.alphaThreshold ?? (upstream ? PW_CONFIG.alpha.thresholdUpstream : PW_CONFIG.alpha.thresholdFixed);
  // 多尺度默认关：`pw-original` 必须是纯 3×3（上游语义），
  // 只有 hybrid / improved 显式传 `useMultiScale: true` 才启用。
  const useMultiScale = options.useMultiScale === true;
  const distanceFn = options.distanceFn || weightedRgbDistance;

  const { width, height } = raster;

  // ── 阶段 1：边缘 ──────────────────────────────────────────
  const luma = toLuma(raster);
  let magnitude;
  let edgeInfo;
  if (useMultiScale) {
    const multi = multiScaleEdge(luma, width, height, options.multiScale);
    magnitude = multi.magnitude;
    edgeInfo = { kind: "multi-scale", perScale: multi.perScale, fuse: multi.fuse, validRadius: multi.validRadius, referenceQuantile: multi.referenceQuantile };
  } else {
    // 单尺度 3×3 —— 上游路径
    const single = multiScaleEdge(luma, width, height, { scales: [{ kernel: 3, sigma: 0 }], fuse: "weighted-mean", weights: [1] });
    magnitude = single.magnitude;
    edgeInfo = { kind: "sobel3", perScale: single.perScale, fuse: "single", validRadius: 1, referenceQuantile: single.referenceQuantile };
  }

  // ── 阶段 2：自适应阈值 ────────────────────────────────────
  const threshold = resolveThreshold(magnitude, {
    mode: options.thresholdMode ?? PW_CONFIG.threshold.mode,
    floor: edgeThresh,
    medianFactor: options.medianFactor ?? PW_CONFIG.threshold.medianFactor,
  });
  const edges = binarize(magnitude, threshold.value);

  // ── 阶段 3：膨胀桥接 ──────────────────────────────────────
  const bridged = dilate(edges, width, height, { iterations: morphIter });

  // ── 阶段 4：背景估计 ──────────────────────────────────────
  const background = estimateBackground(raster, {
    mode: options.backgroundMode ?? (upstream ? BACKGROUND_MODE.BORDER_MEAN : PW_CONFIG.background.mode),
    k: options.backgroundK,
    distanceFn,
  });

  // ── 阶段 5：前景标记 ──────────────────────────────────────
  const { similar, distances } = markBackgroundSimilar(raster, background.color, {
    threshold: colorThresh,
    distanceFn,
    alphaThreshold,
  });

  let mask = new Uint8Array(width * height);
  let byEdge = 0;
  let byColor = 0;
  let byAlpha = 0;
  for (let i = 0; i < mask.length; i++) {
    const isTransparent = alphaThreshold > 0 && raster.data[i * 4 + 3] < alphaThreshold;
    if (isTransparent) { byAlpha++; continue; }
    if (bridged.mask[i]) { mask[i] = 1; byEdge++; continue; }
    if (!similar[i]) { mask[i] = 1; byColor++; }
  }

  // ── 阶段 6：形态学开运算 ──────────────────────────────────
  const erodeMode = options.erodeMode ?? (upstream ? PW_CONFIG.morphology.erodeMode : ERODE_MODE.MIN_FILTER);
  const beforeMorphology = mask.reduce((sum, value) => sum + value, 0);
  let opened;
  {
    const eroded = erodeWith(erodeMode, mask, width, height, {
      iterations: morphIter,
      threshold: PW_CONFIG.morphology.majorityThreshold,
    });
    opened = dilate(eroded.mask, width, height, { iterations: morphIter });
    mask = opened.mask;
  }

  // ── 修复 S-3：连通性过滤（上游没有） ──────────────────────
  let connectivity = null;
  const shouldFilter = options.filterConnectivity ?? !upstream;
  if (shouldFilter) {
    const stats = componentStats(mask, width, height, { connectivity: 8 });
    const filtered = filterComponents(mask, width, height, {
      connectivity: 8,
      minSize: options.minComponentSize ?? 1,
      keepBorderContact: options.keepBorderContact ?? null,
    });
    mask = filtered.mask;
    connectivity = { before: stats, after: componentStats(mask, width, height, { connectivity: 8 }), removedComponents: filtered.removed };
  }

  // ── 羽化（上游声明未用；这里真正接上） ────────────────────
  const featherRadius = options.feather === null
    ? 0
    : (options.feather ?? (upstream ? 0 : featherRadiusForPrecision(preset.name)));
  const feathered = featherMask(mask, width, height, { radius: featherRadius });
  const finalMask = featherRadius > 0 ? feathered.binary : mask;

  const foregroundPixels = finalMask.reduce((sum, value) => sum + value, 0);

  return {
    mask: finalMask,
    hardMask: mask,
    alpha: featherRadius > 0 ? feathered.alpha : Uint8Array.from(mask, (v) => (v ? 1 : 0)),
    bgColor: background.color,
    stages: {
      edge: edgeInfo,
      threshold: { value: threshold.value, raw: threshold.raw, mode: threshold.mode, floor: threshold.floor, median: threshold.components.median },
      edgeHistogram: threshold.histogram,
      bridge: { iterations: morphIter, edgePixels: edges.reduce((s, v) => s + v, 0) },
      background,
      marking: { byEdge, byColor, byAlpha, colorThresh, alphaThreshold },
      morphology: { erodeMode, iterations: morphIter, before: beforeMorphology, after: mask.reduce((sum, value) => sum + value, 0) },
      connectivity,
      feather: { radius: featherRadius, applied: featherRadius > 0 },
    },
    diagnostics: {
      profile,
      precision: preset.name,
      width,
      height,
      foregroundPixels,
      foregroundRatio: foregroundPixels / (width * height),
      bgColor: background.color.map((v) => Math.round(v * 1000) / 1000),
      threshold: threshold.value,
      alphaThreshold,
      connectivityApplied: shouldFilter,
      featherRadius,
    },
  };
}

export { PIPELINE_PROFILE };
