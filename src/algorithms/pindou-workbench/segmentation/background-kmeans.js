/**
 * segmentation/background-kmeans.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`autoCutout` 的背景估计段（app.js:145–170）
 *
 * ```js
 * const margin = Math.max(3, Math.floor(Math.min(w, h) * 0.03));
 * // 取上下 margin 行 + 左右 margin 列（四角被重复采样）
 * const bgColor = bgSamples.reduce((acc, c) => [acc[0]+c[0], acc[1]+c[1], acc[2]+c[2]], [0,0,0])
 *                           .map(v => v / bgSamples.length);
 * ```
 *
 * 忠实移植（含「四角重复采样」这一细节），并补齐上游 README 宣称却不存在的能力：
 *   > README：「**K-means 背景估计**：精准识别复杂背景色」
 *   实际：`grep -ci kmeans app.js` → 2 次，**两处都在前景量化里**，与背景无关。
 *   背景就是一句算术平均。审计缺陷。
 *
 * 为什么边框均值会失效（实测，审计 §2 A-6）：
 *   让深色主体铺满四边、只留左上角一小块浅色背景，`margin=3` 采到的 444 个样本里
 *   417 个是主体 → `bgColor` 估成 **36.9**（接近主体色）而不是真实的 **245**。
 *   于是「与背景色差异」这条判据完全失效，前景只剩边缘膨胀在撑。
 *
 * 三种模式：
 *   `border-mean`            —— 上游行为（算术平均）
 *   `border-kmeans`          —— 边框样本聚类，取**占比最大**的簇
 *   `border-kmeans-nearest`  —— 边框样本聚类，取**最外层 1 像素环里出现最多**的簇
 *                               （复杂背景下更稳：最外圈必然是真背景）
 */

import { PW_CONFIG, BACKGROUND_MODE } from "../config.js";
import { kMeans } from "../quantization/kmeans.js";
import { weightedRgbDistance } from "../color/weighted-rgb.js";

export { BACKGROUND_MODE };

/**
 * 上游的 margin 规则：`max(3, floor(min(w,h) * 0.03))`。
 * @param {number} width
 * @param {number} height
 */
export function backgroundMargin(width, height) {
  return Math.max(PW_CONFIG.background.minMargin, Math.floor(Math.min(width, height) * PW_CONFIG.background.marginRatio));
}

/**
 * 采集边框样本。**与上游完全同构**，包括四角被重复计入。
 *
 * @param {{data:ArrayLike<number>, width:number, height:number}} raster
 * @param {{margin?:number}} [options]
 * @returns {{samples:number[][], outerRing:Uint8Array, margin:number, count:number, distinctPixels:number}}
 */
export function collectBorderSamples(raster, options = {}) {
  const { width, height, data } = raster;
  const margin = Math.max(1, options.margin ?? backgroundMargin(width, height));
  const samples = [];
  const outerRing = [];

  const push = (x, y) => {
    const p = (y * width + x) * 4;
    samples.push([data[p], data[p + 1], data[p + 2]]);
    outerRing.push(x === 0 || y === 0 || x === width - 1 || y === height - 1 ? 1 : 0);
  };

  for (let x = 0; x < width; x++) {
    for (let y = 0; y < margin; y++) push(x, y);
    for (let y = Math.max(margin, height - margin); y < height; y++) push(x, y);
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < margin; x++) push(x, y);
    for (let x = Math.max(margin, width - margin); x < width; x++) push(x, y);
  }

  const distinct = new Set();
  for (const sample of samples) distinct.add(`${sample[0] | 0},${sample[1] | 0},${sample[2] | 0}`);

  return {
    samples,
    outerRing: Uint8Array.from(outerRing),
    margin,
    count: samples.length,
    distinctPixels: distinct.size,
  };
}

/**
 * 上游口径：算术平均（浮点，不取整）。
 * @param {number[][]} samples
 */
export function borderMean(samples) {
  if (!samples.length) return [0, 0, 0];
  let r = 0;
  let g = 0;
  let b = 0;
  for (const sample of samples) {
    r += sample[0];
    g += sample[1];
    b += sample[2];
  }
  return [r / samples.length, g / samples.length, b / samples.length];
}

/**
 * 边框样本 K-means。**确定性**（沿用上游的等距抽样初始化）。
 *
 * @param {number[][]} samples
 * @param {{k?:number, iterations?:number, distanceFn?:Function, outerRing?:Uint8Array}} [options]
 * @returns {{clusters:Array<{center:number[], count:number, share:number, outerCount:number}>,
 *            dominant:number[], dominantShare:number, nearestOuter:number[]}}
 */
export function backgroundKMeans(samples, options = {}) {
  const k = Math.max(1, options.k ?? PW_CONFIG.background.k);
  const distanceFn = options.distanceFn || weightedRgbDistance;
  const outerRing = options.outerRing;

  if (!samples.length) {
    return { clusters: [], dominant: [0, 0, 0], dominantShare: 0, nearestOuter: [0, 0, 0] };
  }

  const clustered = kMeans(samples, k, {
    distanceFn,
    init: PW_CONFIG.kmeans.init,
    // 边框样本量小、簇数少，用收敛判据即可；不影响前景 K-means 的「跑满 10 轮」。
    maxIterations: options.iterations ?? PW_CONFIG.background.iterations,
    tolerance: 0,
    reseedEmptyClusters: true,
  });

  const clusters = [];
  for (let c = 0; c < clustered.centroids.length; c++) {
    if (clustered.sizes[c] === 0) continue;
    let outerCount = 0;
    if (outerRing) {
      for (let i = 0; i < samples.length; i++) {
        if (clustered.assignments[i] === c && outerRing[i]) outerCount++;
      }
    }
    clusters.push({
      cluster: c,
      center: clustered.centroids[c],
      count: clustered.sizes[c],
      share: clustered.sizes[c] / samples.length,
      outerCount,
    });
  }

  if (!clusters.length) {
    const mean = borderMean(samples);
    return { clusters: [], dominant: mean, dominantShare: 1, nearestOuter: mean };
  }

  const byCount = clusters.slice().sort((a, b) => (b.count - a.count) || (a.cluster - b.cluster));
  const byOuter = clusters.slice().sort((a, b) => (b.outerCount - a.outerCount) || (b.count - a.count) || (a.cluster - b.cluster));

  return {
    clusters: byCount,
    dominant: byCount[0].center,
    dominantShare: byCount[0].share,
    nearestOuter: byOuter[0].center,
    outerLeaderShare: byOuter[0].share,
  };
}

/**
 * 估计背景色。
 *
 * @param {{data:ArrayLike<number>, width:number, height:number}} raster
 * @param {{mode?:string, margin?:number, k?:number, iterations?:number, distanceFn?:Function}} [options]
 * @returns {{color:number[], mode:string, margin:number, sampleCount:number,
 *            distinctPixels:number, clusters:Array|null, multiModal:boolean}}
 */
export function estimateBackground(raster, options = {}) {
  const mode = Object.values(BACKGROUND_MODE).includes(options.mode) ? options.mode : BACKGROUND_MODE.BORDER_MEAN;
  const collected = collectBorderSamples(raster, { margin: options.margin });

  if (mode === BACKGROUND_MODE.BORDER_MEAN) {
    return {
      color: borderMean(collected.samples),
      mode,
      margin: collected.margin,
      sampleCount: collected.count,
      distinctPixels: collected.distinctPixels,
      clusters: null,
      multiModal: false,
    };
  }

  const clustered = backgroundKMeans(collected.samples, {
    k: options.k,
    iterations: options.iterations,
    distanceFn: options.distanceFn,
    outerRing: collected.outerRing,
  });

  const color = mode === BACKGROUND_MODE.BORDER_KMEANS_NEAREST ? clustered.nearestOuter : clustered.dominant;

  return {
    color,
    mode,
    margin: collected.margin,
    sampleCount: collected.count,
    distinctPixels: collected.distinctPixels,
    clusters: clustered.clusters,
    // 多峰 = 占比最大的簇不到一半 → 边框本身就不干净，此时 distance-to-background 判据不可信。
    multiModal: clustered.dominantShare < 0.5,
    dominantShare: clustered.dominantShare,
  };
}

/**
 * 判断哪些像素「与背景色足够接近」。
 * 上游用的是**加权 RGB 距离**（`autoCutout` 第 179–183 行），这里保持一致。
 *
 * @param {{data:ArrayLike<number>, width:number, height:number}} raster
 * @param {number[]} bgColor
 * @param {{threshold:number, distanceFn?:Function, alphaThreshold?:number}} options
 * @returns {{similar:Uint8Array, distances:Float32Array, stats:object}}
 */
export function markBackgroundSimilar(raster, bgColor, options) {
  const { data, width, height } = raster;
  const distanceFn = options.distanceFn || weightedRgbDistance;
  const alphaThreshold = options.alphaThreshold ?? 0;
  const count = width * height;
  const similar = new Uint8Array(count);
  const distances = new Float32Array(count);
  let below = 0;
  let maxDistance = 0;

  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const rgb = [data[p], data[p + 1], data[p + 2]];
    const distance = distanceFn(rgb, bgColor);
    distances[i] = distance;
    if (distance > maxDistance) maxDistance = distance;
    const transparent = alphaThreshold > 0 && data[p + 3] < alphaThreshold;
    if (transparent || distance <= options.threshold) {
      similar[i] = 1;
      below++;
    }
  }

  return { similar, distances, stats: { below, above: count - below, maxDistance } };
}

export const DEFAULT_BACKGROUND = Object.freeze({
  mode: PW_CONFIG.background.mode,
  k: PW_CONFIG.background.k,
  marginRatio: PW_CONFIG.background.marginRatio,
  minMargin: PW_CONFIG.background.minMargin,
});
