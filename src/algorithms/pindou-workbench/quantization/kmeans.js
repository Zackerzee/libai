/**
 * quantization/kmeans.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`kMeansPalette(pixels, k)`（app.js:225–253）
 *
 * ```js
 * function kMeansPalette(pixels, k) {
 *   if (pixels.length === 0) return MARD_264.slice(0, k);
 *   let centroids = [];
 *   const step = Math.max(1, Math.floor(pixels.length / k));
 *   for (let i = 0; i < k && i * step < pixels.length; i++) centroids.push([...pixels[i * step]]);
 *   for (let iter = 0; iter < 10; iter++) {
 *     /* 分配：colorDistance，严格小于，先到先得 *\/
 *     /* 更新：算术平均 + Math.round *\/
 *   }
 *   return centroids.map(c => findClosestBead(c, MARD_264));   // ← 硬编码全局
 * }
 * ```
 *
 * **保留的上游特性**（这些是它的优点）：
 *   - 初始化**确定性**：等距抽样，不用随机数 → 同图同参必得同果；
 *   - 固定轮数、无提前退出 → 结果与「跑满 10 轮」严格一致。
 *
 * **修复的上游缺陷**（审计 §5）：
 *   - **K-1**：色板是**参数**，不再硬编码 `MARD_264`。上游把调用方选中的
 *     HAMA / Perler / Artkal / Nabbi 色卡整块丢掉（因为 `colorLimit(16) < 30` 恒真），
 *     实测「传 HAMA 返回 MARD 色号」。
 *   - **K-2**：多个质心可能落回同一个色卡条目 → 报告 `duplicates`，
 *     让调用方知道实际可用色数少于 k。
 *   - **K-3**：`k > 样本数` 时上游会产出 `undefined` 质心，`NaN < minDist` 恒 false，
 *     所有像素塌进簇 0。这里把 k 夹到样本数。
 *   - **K-4**：空簇重播种（确定性：选距最近质心最远的样本），以及可选的收敛判据。
 *
 * **新增能力**：`distanceFn` 可注入 —— 这样 `paletteMatchMode` 的三档
 * （weighted-rgb / lab / ciede2000）可以**贯穿**「聚类」与「最终匹配」两个阶段，
 * 而不是聚类用一种度量、匹配用另一种。
 */

import { PW_CONFIG } from "../config.js";
import { weightedRgbDistance } from "../color/weighted-rgb.js";

/** 初始化方式。 */
export const KMEANS_INIT = Object.freeze({
  /** 上游：按 `step = floor(n / k)` 等距抽样。确定性。 */
  STRIDED: "strided",
  /** 最远优先遍历（maximin）。确定性，且分布远比等距抽样均匀。 */
  FARTHEST_FIRST: "farthest-first",
});

/** 默认距离函数（上游口径）。 */
export const DEFAULT_DISTANCE = weightedRgbDistance;

/**
 * K-means 聚类。**不依赖任何全局状态。**
 *
 * @param {Array<number[]>} points `[[r,g,b], …]`
 * @param {number} k 期望簇数
 * @param {{
 *   distanceFn?:Function, init?:string, maxIterations?:number,
 *   tolerance?:number, reseedEmptyClusters?:boolean
 * }} [options]
 * @returns {{
 *   centroids:number[][], assignments:Int32Array, sizes:Uint32Array,
 *   iterations:number, converged:boolean, emptyClusters:number,
 *   reseeded:number, movedLast:number, distanceFnName:string
 * }}
 */
export function kMeans(points, k, options = {}) {
  const distanceFn = options.distanceFn || DEFAULT_DISTANCE;
  const init = Object.values(KMEANS_INIT).includes(options.init) ? options.init : PW_CONFIG.kmeans.init;
  const maxIterations = Math.max(1, options.maxIterations ?? PW_CONFIG.kmeans.maxIterations);
  const tolerance = options.tolerance ?? PW_CONFIG.kmeans.tolerance;
  const reseedEmptyClusters = options.reseedEmptyClusters ?? PW_CONFIG.kmeans.reseedEmptyClusters;

  const n = points.length;
  // K-3：夹到样本数，杜绝 undefined 质心
  const clusters = Math.max(1, Math.min(k | 0, n || 1));

  if (!n) {
    return {
      centroids: [],
      assignments: new Int32Array(0),
      sizes: new Uint32Array(0),
      iterations: 0,
      converged: true,
      emptyClusters: 0,
      reseeded: 0,
      movedLast: 0,
      distanceFnName: distanceFn.name || "anonymous",
    };
  }

  const centroids = initCentroids(points, clusters, init, distanceFn);
  const assignments = new Int32Array(n).fill(-1);
  let iterations = 0;
  let converged = false;
  let reseeded = 0;
  let movedLast = 0;

  for (let iter = 0; iter < maxIterations; iter++) {
    iterations = iter + 1;

    // ── 分配（严格小于，先到先得 —— 与上游一致） ──
    let moved = 0;
    for (let i = 0; i < n; i++) {
      const point = points[i];
      let bestIndex = 0;
      let bestDistance = Infinity;
      for (let c = 0; c < clusters; c++) {
        const distance = distanceFn(point, centroids[c]);
        if (distance < bestDistance) {
          bestDistance = distance;
          bestIndex = c;
        }
      }
      if (assignments[i] !== bestIndex) {
        assignments[i] = bestIndex;
        moved++;
      }
    }
    movedLast = moved;

    // ── 更新（算术平均 + round —— 与上游一致） ──
    const sums = Array.from({ length: clusters }, () => [0, 0, 0]);
    const sizes = new Uint32Array(clusters);
    for (let i = 0; i < n; i++) {
      const cluster = assignments[i];
      const point = points[i];
      sums[cluster][0] += point[0];
      sums[cluster][1] += point[1];
      sums[cluster][2] += point[2];
      sizes[cluster]++;
    }

    let emptyClusters = 0;
    for (let c = 0; c < clusters; c++) {
      if (sizes[c] > 0) {
        centroids[c] = [
          Math.round(sums[c][0] / sizes[c]),
          Math.round(sums[c][1] / sizes[c]),
          Math.round(sums[c][2] / sizes[c]),
        ];
      } else {
        emptyClusters++;
      }
    }
    // K-4：空簇重播种 —— 挑「离自己最近质心最远」的样本，确定性且不动随机数。
    if (reseedEmptyClusters && emptyClusters > 0) {
      for (let c = 0; c < clusters; c++) {
        if (sizes[c] > 0) continue;
        let farthest = -1;
        let farthestDistance = -1;
        for (let i = 0; i < n; i++) {
          if (assignments[i] === c) continue;
          let nearest = Infinity;
          for (let other = 0; other < clusters; other++) {
            const distance = distanceFn(points[i], centroids[other]);
            if (distance < nearest) nearest = distance;
          }
          if (nearest > farthestDistance) {
            farthestDistance = nearest;
            farthest = i;
          }
        }
        if (farthest >= 0) {
          centroids[c] = [...points[farthest]];
          reseeded++;
        }
      }
    }

    if (moved === 0) { converged = true; break; }
    // 收敛判据：本轮被重新分配的样本占比低于 tolerance 即停。
    // 默认 tolerance = 0 表示**永不提前退出** —— 与上游「跑满 10 轮」逐位一致。
    if (tolerance > 0 && moved / n <= tolerance) { converged = true; break; }
  }

  const finalSizes = new Uint32Array(clusters);
  for (let i = 0; i < n; i++) finalSizes[assignments[i]]++;

  return {
    centroids,
    assignments,
    sizes: finalSizes,
    iterations,
    converged,
    emptyClusters: finalSizes.reduce((count, size) => count + (size === 0 ? 1 : 0), 0),
    reseeded,
    movedLast,
    distanceFnName: distanceFn.name || "anonymous",
  };
}

/** 初始化质心。两种方式都是确定性的。 */
function initCentroids(points, k, init, distanceFn) {
  if (init === KMEANS_INIT.FARTHEST_FIRST) {
    const centroids = [points[0].slice()];
    while (centroids.length < k) {
      let bestIndex = 0;
      let bestDistance = -1;
      for (let i = 0; i < points.length; i++) {
        let nearest = Infinity;
        for (const centroid of centroids) {
          const distance = distanceFn(points[i], centroid);
          if (distance < nearest) nearest = distance;
        }
        if (nearest > bestDistance) {
          bestDistance = nearest;
          bestIndex = i;
        }
      }
      centroids.push(points[bestIndex].slice());
    }
    return centroids;
  }

  // 上游：step = max(1, floor(n / k))，取 points[i * step]
  const step = Math.max(1, Math.floor(points.length / k));
  const centroids = [];
  for (let i = 0; i < k && i * step < points.length; i++) centroids.push(points[i * step].slice());
  while (centroids.length < k) centroids.push(points[centroids.length % points.length].slice());
  return centroids;
}

/**
 * 上游 `kMeansPalette` 的等价物 —— 聚类后再把质心落回色板。
 *
 * 与上游的两点差别，都是刻意的：
 *   ① 色板是**参数**（修复 K-1）；
 *   ② 用 `matcher` 落色卡，而不是内部的 `findClosestBead` + 全局常量。
 *
 * @param {Array<number[]>} points
 * @param {number} k
 * @param {object} matcher `color/palette-match.js` 的 `createPaletteMatcher()` 返回值
 * @param {{distanceFn?:Function, init?:string, maxIterations?:number, tolerance?:number,
 *          reseedEmptyClusters?:boolean}} [options]
 */
export function kMeansPalette(points, k, matcher, options = {}) {
  const distanceFn = options.distanceFn || matcher.distanceFn || DEFAULT_DISTANCE;
  const clustered = kMeans(points, k, { ...options, distanceFn });

  const seen = new Set();
  const beads = [];
  const duplicates = [];
  const sources = [];

  for (let c = 0; c < clustered.centroids.length; c++) {
    if (clustered.sizes[c] === 0) continue;
    const centroid = clustered.centroids[c];
    const matched = matcher.match(centroid);
    if (!matched) continue;
    sources.push({ cluster: c, centroid, size: clustered.sizes[c], code: matched.code });
    if (seen.has(matched.position)) {
      duplicates.push(matched.code);
      continue;
    }
    seen.add(matched.position);
    beads.push(matched.entry);
  }

  return {
    beads,
    centroids: clustered.centroids,
    sizes: clustered.sizes,
    iterations: clustered.iterations,
    converged: clustered.converged,
    duplicates,
    uniqueCount: beads.length,
    requestedK: k,
    effectiveK: Math.min(k, points.length),
    emptyClusters: clustered.emptyClusters,
    reseeded: clustered.reseeded,
    sources,
  };
}

export const DEFAULT_KMEANS = Object.freeze({
  init: PW_CONFIG.kmeans.init,
  maxIterations: PW_CONFIG.kmeans.maxIterations,
  tolerance: PW_CONFIG.kmeans.tolerance,
  reseedEmptyClusters: PW_CONFIG.kmeans.reseedEmptyClusters,
});
