/**
 * quantization/dominant-colors.js
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **来源：本仓库补全（ORIGIN.LIBMS_FILL）**
 *
 * 上游只有 K-means 一条量化路径（`kMeansPalette`，app.js:225–253），**没有直方图**、
 * 也没有中位切分。审计 §1 第 7 项「主色提取」因此只能标为 🟡（存在但形态不同）：
 * K-means 是「按距离分区求均值」，主色提取是「按频次取众数」，两者会给出**不同**的答案。
 *
 * 本文件补出两条独立于 K-means 的路径：
 *
 *   ① `dominantColors()` —— 分桶直方图取频次最高者。
 *      优点：**完全确定**、能如实反映「哪个颜色真的最多」，不会被均值拉偏；
 *      缺点：会忽略频次低但在视觉上重要的颜色（如点睛的小面积高饱和色）。
 *      → 正好与「强调色保护」互补，不是替代关系。
 *
 *   ② `medianCut()` —— 中位切分（Heckbert）。递归地把颜色空间沿「最宽的通道」
 *      在**加权中位数**处切成两半，直到得到 count 个盒子，各盒取均值。
 *      相比 K-means：不迭代、不依赖初始化、速度线性于样本数。
 *
 * 两者都是确定性的（平票按分桶键升序），不属于 K-means 的另一种参数化。
 */

import { PW_CONFIG } from "../config.js";

/**
 * 分桶键。`bits` 是每通道保留的位数（5 → 每通道 32 级）。
 * @param {ArrayLike<number>} rgb
 * @param {number} bits
 */
export function binKey(rgb, bits = 5) {
  const shift = 8 - bits;
  const r = (rgb[0] | 0) >> shift;
  const g = (rgb[1] | 0) >> shift;
  const b = (rgb[2] | 0) >> shift;
  const mask = (1 << bits) - 1;
  return ((r & mask) << (bits * 2)) | ((g & mask) << bits) | (b & mask);
}

/** 分桶键 → 该桶的量化中心色。 */
export function binCenter(key, bits = 5) {
  const shift = 8 - bits;
  const mask = (1 << bits) - 1;
  const r = (key >> (bits * 2)) & mask;
  const g = (key >> bits) & mask;
  const b = key & mask;
  const step = 1 << shift;
  const half = step >> 1;
  return [r * step + half, g * step + half, b * step + half];
}

/**
 * 颜色直方图。
 * @param {Array<number[]>} points
 * @param {{bits?:number, minCount?:number}} [options]
 * @returns {{buckets:Map<number,{key:number,count:number,sum:number[],center:number[]}>,
 *            total:number, distinct:number, bits:number}}
 */
export function colorHistogram(points, options = {}) {
  const bits = Math.max(1, Math.min(8, options.bits ?? 5));
  const minCount = Math.max(1, options.minCount ?? 1);
  const buckets = new Map();
  let total = 0;

  for (const point of points) {
    if (!point) continue;
    const key = binKey(point, bits);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { key, count: 0, sum: [0, 0, 0], center: binCenter(key, bits) };
      buckets.set(key, bucket);
    }
    bucket.count++;
    bucket.sum[0] += point[0];
    bucket.sum[1] += point[1];
    bucket.sum[2] += point[2];
    total++;
  }

  if (minCount > 1) {
    for (const [key, bucket] of [...buckets.entries()]) {
      if (bucket.count < minCount) buckets.delete(key);
    }
  }

  return { buckets, total, distinct: buckets.size, bits };
}

/**
 * 主色提取：按频次取前 N。
 *
 * @param {Array<number[]>} points
 * @param {{count?:number, bits?:number, minShare?:number, withMean?:boolean}} [options]
 * @returns {Array<{rgb:number[], count:number, share:number, key:number}>}
 */
export function dominantColors(points, options = {}) {
  const bits = Math.max(1, Math.min(8, options.bits ?? 5));
  const count = Math.max(1, options.count ?? 8);
  const minShare = options.minShare ?? 0;
  const withMean = options.withMean !== false;

  const histogram = colorHistogram(points, { bits });
  const entries = [...histogram.buckets.values()];

  // 频次降序；**平票按分桶键升序** —— 确定性，不依赖 Map 迭代顺序。
  entries.sort((a, b) => (b.count - a.count) || (a.key - b.key));

  const out = [];
  for (const bucket of entries) {
    if (out.length >= count) break;
    const share = histogram.total ? bucket.count / histogram.total : 0;
    if (share < minShare) continue;
    // 取桶内真实均值（而不是量化中心），避免 5 位分桶带来的 ±4 偏差。
    const rgb = withMean
      ? [
        Math.round(bucket.sum[0] / bucket.count),
        Math.round(bucket.sum[1] / bucket.count),
        Math.round(bucket.sum[2] / bucket.count),
      ]
      : bucket.center.slice();
    out.push({ rgb, count: bucket.count, share, key: bucket.key, center: bucket.center });
  }

  return out;
}

/**
 * 中位切分（Heckbert median cut）。
 *
 * @param {Array<number[]>} points
 * @param {{count?:number, distanceFn?:Function, maxDepth?:number}} [options]
 * @returns {{centroids:number[][], boxes:Array<{count:number, ranges:number[]}>, count:number}}
 */
export function medianCut(points, options = {}) {
  const target = Math.max(1, options.count ?? 8);
  const maxDepth = Math.max(1, options.maxDepth ?? 12);

  if (!points.length) return { centroids: [], boxes: [], count: 0 };

  let boxes = [{ points: points.slice(), depth: 0 }];

  while (boxes.length < target) {
    // 选「体积最大且还能切」的盒子（按最长通道跨度加权样本数）。
    let bestIndex = -1;
    let bestScore = -1;
    for (let i = 0; i < boxes.length; i++) {
      const box = boxes[i];
      if (box.points.length < 2) continue;
      const ranges = channelRanges(box.points);
      const span = Math.max(ranges[0], ranges[1], ranges[2]);
      const score = span * box.points.length;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = i;
      }
    }
    if (bestIndex < 0) break;

    const box = boxes[bestIndex];
    const ranges = channelRanges(box.points);
    const channel = ranges.indexOf(Math.max(ranges[0], ranges[1], ranges[2]));
    if (ranges[channel] <= 0) {
      boxes[bestIndex] = { ...box, points: box.points, depth: maxDepth };
      break;
    }

    // 沿该通道排序，在**加权中位数**处切。
    const sorted = box.points.slice().sort((a, b) => (a[channel] - b[channel]) || (a[0] - b[0]) || (a[1] - b[1]) || (a[2] - b[2]));
    const middle = sorted.length >> 1;
    const left = sorted.slice(0, middle);
    const right = sorted.slice(middle);
    if (!left.length || !right.length) break;

    boxes.splice(bestIndex, 1, { points: left, depth: box.depth + 1 }, { points: right, depth: box.depth + 1 });
  }

  const centroids = [];
  const summary = [];
  for (const box of boxes) {
    if (!box.points.length) continue;
    let sumR = 0;
    let sumG = 0;
    let sumB = 0;
    for (const point of box.points) {
      sumR += point[0];
      sumG += point[1];
      sumB += point[2];
    }
    const n = box.points.length;
    centroids.push([Math.round(sumR / n), Math.round(sumG / n), Math.round(sumB / n)]);
    summary.push({ count: n, ranges: channelRanges(box.points), depth: box.depth });
  }

  return { centroids, boxes: summary, count: centroids.length };
}

function channelRanges(points) {
  let minR = 255;
  let maxR = 0;
  let minG = 255;
  let maxG = 0;
  let minB = 255;
  let maxB = 0;
  for (const point of points) {
    if (point[0] < minR) minR = point[0];
    if (point[0] > maxR) maxR = point[0];
    if (point[1] < minG) minG = point[1];
    if (point[1] > maxG) maxG = point[1];
    if (point[2] < minB) minB = point[2];
    if (point[2] > maxB) maxB = point[2];
  }
  return [maxR - minR, maxG - minG, maxB - minB];
}

/**
 * 把一组代表色落回色板（与 k-means 的落色卡步骤同构）。
 * @param {number[][]} colors
 * @param {object} matcher
 */
export function colorsToPalette(colors, matcher) {
  const seen = new Set();
  const beads = [];
  const duplicates = [];
  const sources = [];
  for (const rgb of colors) {
    const matched = matcher.match(rgb);
    if (!matched) continue;
    sources.push({ rgb, code: matched.code, distance: matched.distance });
    if (seen.has(matched.position)) {
      duplicates.push(matched.code);
      continue;
    }
    seen.add(matched.position);
    beads.push(matched.entry);
  }
  return { beads, duplicates, sources, uniqueCount: beads.length };
}

export const DEFAULT_DOMINANT = Object.freeze({
  bits: 5,
  count: 8,
  minShare: 0,
});


