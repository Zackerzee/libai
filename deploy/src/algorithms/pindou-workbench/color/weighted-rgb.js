/**
 * color/weighted-rgb.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`colorDistance(c1, c2)`（app.js:61–66）
 *
 * ```js
 * function colorDistance(c1, c2) {
 *   const dr = c1[0] - c2[0], dg = c1[1] - c2[1], db = c1[2] - c2[2];
 *   return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
 * }
 * ```
 *
 * 这是「加权欧氏距离」里最常见的**固定权重**版本，权重 R:G:B = 2:4:3
 * （绿最重、蓝次之、红最轻），上界 `sqrt(9 · 255²) = 765`。
 *
 * ⚠️ 与常见的 **redmean / CompuPhase 低代价近似**不是同一个东西：
 *   红均值版：`(2 + r̄/256)·Δr² + 4·Δg² + (2 + (255−r̄)/256)·Δb²`
 *   它带一个随红通道均值变化的可变项；上游**没有**这一项。
 *   两者在纯红/纯蓝上差异显著，因此本文件把两版都实现出来，
 *   默认使用**上游固定权重版**，redmean 版只作为对照（`redmeanDistance`）。
 *
 * 实证（纯 Node 实跑，审计 §2 A-3）：
 *   黑↔白 765.000 · 纯红 360.624 · 纯绿 510.000 · 纯蓝 441.673
 */

import { PW_CONFIG } from "../config.js";

/** 上游权重：R=2, G=4, B=3。 */
export const WEIGHTED_RGB_WEIGHTS = PW_CONFIG.weightedRgb.weights;

/** 理论最大值：三个通道都取满量程差。 */
export const MAX_WEIGHTED_RGB_DISTANCE = (() => {
  const [wr, wg, wb] = WEIGHTED_RGB_WEIGHTS;
  return Math.sqrt((wr + wg + wb) * 255 * 255);
})();

/**
 * 上游口径的加权 RGB 距离。**这是 pw 的 default 度量。**
 * @param {ArrayLike<number>} a `[r,g,b]`
 * @param {ArrayLike<number>} b `[r,g,b]`
 * @returns {number} `[0, 765]`
 */
export function weightedRgbDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  const [wr, wg, wb] = WEIGHTED_RGB_WEIGHTS;
  return Math.sqrt(wr * dr * dr + wg * dg * dg + wb * db * db);
}

/** 省掉开方的版本（比较大小时可省，但会改变「距离」的量纲）。 */
export function weightedRgbDistanceSquared(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  const [wr, wg, wb] = WEIGHTED_RGB_WEIGHTS;
  return wr * dr * dr + wg * dg * dg + wb * db * db;
}

/** 归一化到 [0,1]，便于与 ΔE 之类的指标并排显示。 */
export function normalizedWeightedRgbDistance(a, b) {
  return weightedRgbDistance(a, b) / MAX_WEIGHTED_RGB_DISTANCE;
}

/**
 * redmean / CompuPhase 低代价近似（**对照用，不是上游口径**）。
 * 参考：https://www.compuphase.com/cmetric.htm
 * @param {ArrayLike<number>} a
 * @param {ArrayLike<number>} b
 */
export function redmeanDistance(a, b) {
  const rMean = (a[0] + b[0]) / 2;
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(
    (2 + rMean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - rMean) / 256) * db * db,
  );
}

/** 纯欧氏（无权重），作为第三个参照点。 */
export function euclideanRgbDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/** 加权 RGB 的通道权重占比（R:G:B = 2:4:3 → 22.2% / 44.4% / 33.3%）。 */
export function weightRatios() {
  const total = WEIGHTED_RGB_WEIGHTS.reduce((a, b) => a + b, 0);
  return WEIGHTED_RGB_WEIGHTS.map((w) => w / total);
}

/** 每种度量的量纲上界，供跨度量对齐时使用。 */
export const METRIC_RANGES = Object.freeze({
  "weighted-rgb": Object.freeze({ max: MAX_WEIGHTED_RGB_DISTANCE, note: "上游口径" }),
  "redmean": Object.freeze({ max: 764.83, note: "对照，非上游" }),
  "euclidean-rgb": Object.freeze({ max: Math.sqrt(3) * 255, note: "无权重参照" }),
});

export const DEFAULT_WEIGHTED_RGB = Object.freeze({
  weights: WEIGHTED_RGB_WEIGHTS,
  maxDistance: MAX_WEIGHTED_RGB_DISTANCE,
});
