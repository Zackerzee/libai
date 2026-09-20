/**
 * Adaptive Cell Sampling —— Hybrid V2 阶段 3。
 *
 * 统一接口：`sampleCell(sourceRegion, context)`。
 *
 * 模式与证据等级（见 docs/research/HYBRID_V2_IMPLEMENTATION_PLAN.md §4）：
 *   linear-mean  CURRENT VERIFIED（+ A/B 同式面积加权线性 RGB 均值）
 *   robust-mean  LOCAL_UNVERIFIED —— 审计无对应实现，adaptive 默认不选中
 *   dominant     B SOURCE VERIFIED（RGB 4-bit 桶，准入 maxBucketShare ≥ 0.20）
 *   two-means    A SOURCE VERIFIED（方差 > 0.008 且 ≥4 像素，均值 + Lab 最远像素初始化，3 次迭代）
 *   adaptive     组合策略；触发阈值全部有出处，见 config.mjs
 *
 * 触发冲突处理：A 的格内方差触发与 F 的格间触发串联会产生双重选择偏差
 * （ALGORITHM_CONFLICT_MATRIX 已列），因此 adaptive 内部按**互斥短路**执行。
 */

import { srgbToLinear } from "../../../../smart-preprocessing/palette-engine.mjs";
import { HybridV2Config, PROVENANCE } from "./config.mjs";

export const SAMPLING_MODE = Object.freeze({
  LINEAR_MEAN: "linear-mean",
  ROBUST_MEAN: "robust-mean",
  DOMINANT: "dominant",
  TWO_MEANS: "two-means",
  ADAPTIVE: "adaptive",
});

const S = HybridV2Config.sampling;
const v = (node) => node.value;

/* ────────────────────────────────────────────────────────────
 * 栅格与格边界
 * ──────────────────────────────────────────────────────────── */

export function asRaster(imageData) {
  if (!imageData || !imageData.width || !imageData.height || !imageData.data) {
    throw new Error("hybrid-v2: imageData 必须是 { width, height, data }");
  }
  return { width: imageData.width, height: imageData.height, data: imageData.data };
}

/** floor/floor 严格不重叠（与 Batch E/F 同一套修法：不能用 max(x0+1,…)）。 */
export function cellBounds(x, y, sourceWidth, sourceHeight, gridWidth, gridHeight) {
  const x0 = Math.floor((x * sourceWidth) / gridWidth);
  const x1 = Math.floor(((x + 1) * sourceWidth) / gridWidth);
  const y0 = Math.floor((y * sourceHeight) / gridHeight);
  const y1 = Math.floor(((y + 1) * sourceHeight) / gridHeight);
  return {
    x0,
    y0,
    x1: Math.max(x0, Math.min(sourceWidth, x1)),
    y1: Math.max(y0, Math.min(sourceHeight, y1)),
  };
}

const LUMA = (r, g, b) => 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);

/**
 * 采集一格内的像素（面积加权，A 的「原图像素与豆格矩形相交面积」口径）。
 * 这里每像素权重相等（格内像素本就是格矩形的整数剖分），透明按 alpha 折减。
 */
export function collectCell(source, bounds) {
  const pixels = [];
  const { data, width } = source;
  for (let y = bounds.y0; y < bounds.y1; y++) {
    for (let x = bounds.x0; x < bounds.x1; x++) {
      const i = (y * width + x) * 4;
      pixels.push([data[i], data[i + 1], data[i + 2], data[i + 3] ?? 255]);
    }
  }
  return pixels;
}

/** B：跨度 ≤8 时全取，否则每轴 7 点定点。用于 dominant 的低成本路径。 */
export function fixedSamplePoints(bounds, axis = S.fixedSampleAxis.value, fullSpanMax = S.fixedSampleFullSpanMax.value) {
  const w = bounds.x1 - bounds.x0;
  const h = bounds.y1 - bounds.y0;
  const out = [];
  const stepX = w <= fullSpanMax ? 1 : Math.max(1, Math.floor(w / axis));
  const stepY = h <= fullSpanMax ? 1 : Math.max(1, Math.floor(h / axis));
  for (let y = bounds.y0; y < bounds.y1; y += stepY) {
    for (let x = bounds.x0; x < bounds.x1; x += stepX) out.push([x, y]);
  }
  return out;
}

/* ────────────────────────────────────────────────────────────
 * 格内特征
 * ──────────────────────────────────────────────────────────── */

/** 线性 RGB 均值（面积 × alpha 加权）。 */
export function linearMean(pixels) {
  if (!pixels.length) return null;
  let r = 0, g = 0, b = 0, wsum = 0, alphaSum = 0;
  for (const px of pixels) {
    const a = (px[3] ?? 255) / 255;
    r += srgbToLinear(px[0]) * a;
    g += srgbToLinear(px[1]) * a;
    b += srgbToLinear(px[2]) * a;
    alphaSum += a;
    wsum += 1;
  }
  if (!wsum) return null;
  return { r: r / wsum, g: g / wsum, b: b / wsum, alpha: alphaSum / wsum, count: wsum };
}

/** 线性 RGB 方差（A 的触发量）与亮度跨度（B 的触发量）。 */
export function cellVariance(pixels, mean) {
  if (pixels.length < 2 || !mean) return { variance: 0, luminanceSpan: 0 };
  let acc = 0;
  let lmin = Infinity;
  let lmax = -Infinity;
  for (const px of pixels) {
    const lr = srgbToLinear(px[0]);
    const lg = srgbToLinear(px[1]);
    const lb = srgbToLinear(px[2]);
    acc += (lr - mean.r) ** 2 + (lg - mean.g) ** 2 + (lb - mean.b) ** 2;
    const l = LUMA(px[0], px[1], px[2]);
    if (l < lmin) lmin = l;
    if (l > lmax) lmax = l;
  }
  return { variance: acc / (pixels.length * 3), luminanceSpan: lmax - lmin };
}

/** B：RGB 4-bit 桶 dominant。 */
export function dominantBucket(pixels, bits = S.dominantBucketBits.value) {
  if (!pixels.length) return { rgb: null, share: 0, count: 0 };
  const shift = 8 - bits;
  const buckets = new Map();
  for (const px of pixels) {
    const key = ((px[0] >> shift) << (bits * 2)) | ((px[1] >> shift) << bits) | (px[2] >> shift);
    let entry = buckets.get(key);
    if (!entry) {
      entry = { count: 0, r: 0, g: 0, b: 0, n: 0 };
      buckets.set(key, entry);
    }
    entry.count++;
    entry.r += px[0];
    entry.g += px[1];
    entry.b += px[2];
    entry.n++;
  }
  let best = null;
  for (const entry of buckets.values()) if (!best || entry.count > best.count) best = entry;
  return {
    rgb: [Math.round(best.r / best.n), Math.round(best.g / best.n), Math.round(best.b / best.n)],
    share: best.count / pixels.length,
    count: best.count,
  };
}

/**
 * A：二簇。以「格内线性均值」和「Lab 意义下最远的像素」初始化，迭代 N 次，
 * 取覆盖像素更多的簇的线性均值。
 *
 * 注意 A 原文用 Lab 距离挑最远像素；本实现按审计描述复现该策略（思想来自 MIT 仓库 A）。
 */
export function twoMeans(pixels, mean, iterations = S.twoMeansIterations.value) {
  if (pixels.length < S.minPixelsForTwoMeans.value) return null;
  const lin = (px) => [srgbToLinear(px[0]), srgbToLinear(px[1]), srgbToLinear(px[2])];
  let c0 = [mean.r, mean.g, mean.b];

  let farthest = pixels[0];
  let farDist = -1;
  for (const px of pixels) {
    const p = lin(px);
    const d = (p[0] - c0[0]) ** 2 + (p[1] - c0[1]) ** 2 + (p[2] - c0[2]) ** 2;
    if (d > farDist) { farDist = d; farthest = px; }
  }
  let c1 = lin(farthest); // eslint-disable-line prefer-const -- 迭代中原地更新
  const pts = pixels.map(lin);

  for (let iter = 0; iter < iterations; iter++) {
    const s0 = [0, 0, 0];
    const s1 = [0, 0, 0];
    let n0 = 0;
    let n1 = 0;
    for (const p of pts) {
      const d0 = (p[0] - c0[0]) ** 2 + (p[1] - c0[1]) ** 2 + (p[2] - c0[2]) ** 2;
      const d1 = (p[0] - c1[0]) ** 2 + (p[1] - c1[1]) ** 2 + (p[2] - c1[2]) ** 2;
      if (d0 <= d1) { s0[0] += p[0]; s0[1] += p[1]; s0[2] += p[2]; n0++; }
      else { s1[0] += p[0]; s1[1] += p[1]; s1[2] += p[2]; n1++; }
    }
    if (!n0 || !n1) break;
    c0 = [s0[0] / n0, s0[1] / n0, s0[2] / n0];
    c1 = [s1[0] / n1, s1[1] / n1, s1[2] / n1];
  }

  // 覆盖权重更高的簇（A：coverage 更高的簇）
  let n0 = 0;
  let n1 = 0;
  for (const p of pts) {
    const d0 = (p[0] - c0[0]) ** 2 + (p[1] - c0[1]) ** 2 + (p[2] - c0[2]) ** 2;
    const d1 = (p[0] - c1[0]) ** 2 + (p[1] - c1[1]) ** 2 + (p[2] - c1[2]) ** 2;
    if (d0 <= d1) n0++; else n1++;
  }
  return n0 >= n1 ? { rgb: linearToSrgb(c0), coverage: n0 / pts.length }
    : { rgb: linearToSrgb(c1), coverage: n1 / pts.length };
}

function linearToSrgb([r, g, b]) {
  const enc = (x) => {
    const c = Math.min(1, Math.max(0, x));
    return Math.round(255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055));
  };
  return [enc(r), enc(g), enc(b)];
}

/**
 * robust-mean —— **LOCAL_UNVERIFIED**：任何被审仓库都没有这个实现。
 * 因此：① 只在显式 `mode='robust-mean'` 时启用；② `adaptive` 永远不会选中它；
 * ③ 报告里必须单列。定义：按亮度剔除两端各 trimFraction 后做面积加权线性均值。
 */
export function robustMean(pixels, trimFraction = S.trimFraction.value) {
  if (!pixels.length) return null;
  const ranked = pixels
    .map((px) => ({ px, l: LUMA(px[0], px[1], px[2]) }))
    .sort((a, b) => a.l - b.l);
  const cut = Math.floor(ranked.length * trimFraction);
  const kept = ranked.slice(cut, ranked.length - cut);
  const list = kept.length ? kept.map((e) => e.px) : pixels;
  return linearMean(list);
}

/* ────────────────────────────────────────────────────────────
 * 统一入口
 * ──────────────────────────────────────────────────────────── */

/**
 * @param {Array} sourceRegion 格内像素数组（[r,g,b,a] 的数组），来自 collectCell
 * @param {object} context { mode, neighborMaxLinearDelta, meanVsDominantDelta, config }
 * @returns {{rgb:number[]|null, mode:string, features:object, empty:boolean, diagnostics:object}}
 */
export function sampleCell(sourceRegion, context = {}) {
  const cfg = context.config || {};
  const cv = (key, fallback) => (cfg[key] === undefined ? fallback : cfg[key]);
  const mode = context.mode || SAMPLING_MODE.ADAPTIVE;
  const pixels = sourceRegion || [];

  if (!pixels.length) {
    return { rgb: null, mode: "empty", features: { count: 0 }, empty: true, diagnostics: { reason: "no-pixels" } };
  }

  const mean = linearMean(pixels);
  const alpha = mean.alpha;
  // A：alpha 权重大于前景权重 → 留空
  if (alpha < cv("alphaEmptyThreshold", v(S.alphaEmptyThreshold))) {
    return { rgb: null, mode: "empty", features: { count: pixels.length, alpha }, empty: true, diagnostics: { reason: "transparent", alpha } };
  }

  const { variance, luminanceSpan } = cellVariance(pixels, mean);
  const dom = dominantBucket(pixels, cv("dominantBucketBits", v(S.dominantBucketBits)));
  const linearRgb = [linearToSrgb([mean.r, mean.g, mean.b])[0], linearToSrgb([mean.r, mean.g, mean.b])[1], linearToSrgb([mean.r, mean.g, mean.b])[2]];

  const features = {
    count: pixels.length,
    alpha,
    variance,
    luminanceSpan,
    dominantShare: dom.share,
    linearMean: linearRgb,
    dominant: dom.rgb,
  };

  const twoMeansResult = cv("precomputedTwoMeans", null);
  const meanVsDominant = distance(linearRgb, dom.rgb || linearRgb);

  let chosen = mode;
  let rgb = linearRgb;

  if (mode === SAMPLING_MODE.ADAPTIVE) {
    // ── 互斥短路：先判结构/边缘触发，再退回平坦 ──
    const structureTrigger =
      variance > cv("varianceThresholdTwoMeans", v(S.varianceThresholdTwoMeans)) ||
      variance > cv("varianceThresholdDominant", v(S.varianceThresholdDominant)) ||
      luminanceSpan > cv("luminanceSpanThreshold", v(S.luminanceSpanThreshold));
    const neighborTrigger =
      (context.neighborMaxLinearDelta ?? 0) >= cv("neighborDeltaTrigger", v(S.neighborDeltaTrigger));

    if (structureTrigger || neighborTrigger) {
      if (dom.share >= cv("dominantShare", v(S.dominantShare))) {
        chosen = SAMPLING_MODE.DOMINANT;
        rgb = dom.rgb;
      } else {
        const tm = twoMeansResult || twoMeans(pixels, mean, cv("twoMeansIterations", v(S.twoMeansIterations)));
        if (tm) {
          chosen = SAMPLING_MODE.TWO_MEANS;
          rgb = tm.rgb;
        } else {
          chosen = SAMPLING_MODE.LINEAR_MEAN;
          rgb = linearRgb;
        }
      }
    } else {
      chosen = SAMPLING_MODE.LINEAR_MEAN;
      rgb = linearRgb;
    }
  } else if (mode === SAMPLING_MODE.DOMINANT) {
    chosen = SAMPLING_MODE.DOMINANT;
    rgb = dom.rgb || linearRgb;
  } else if (mode === SAMPLING_MODE.TWO_MEANS) {
    const tm = twoMeansResult || twoMeans(pixels, mean, cv("twoMeansIterations", v(S.twoMeansIterations)));
    chosen = tm ? SAMPLING_MODE.TWO_MEANS : SAMPLING_MODE.LINEAR_MEAN;
    rgb = tm ? tm.rgb : linearRgb;
  } else if (mode === SAMPLING_MODE.ROBUST_MEAN) {
    // LOCAL_UNVERIFIED —— 只有显式指定才走这里
    const rm = robustMean(pixels, cv("trimFraction", v(S.trimFraction)));
    chosen = SAMPLING_MODE.ROBUST_MEAN;
    rgb = rm ? linearToSrgb([rm.r, rm.g, rm.b]) : linearRgb;
  } else {
    chosen = SAMPLING_MODE.LINEAR_MEAN;
    rgb = linearRgb;
  }

  return {
    rgb,
    mode: chosen,
    features,
    empty: false,
    diagnostics: {
      meanVsDominant,
      neighborMaxLinearDelta: context.neighborMaxLinearDelta ?? null,
      structureTrigger: mode === SAMPLING_MODE.ADAPTIVE
        ? variance > cv("varianceThresholdTwoMeans", v(S.varianceThresholdTwoMeans))
          || variance > cv("varianceThresholdDominant", v(S.varianceThresholdDominant))
          || luminanceSpan > cv("luminanceSpanThreshold", v(S.luminanceSpanThreshold))
        : null,
      localUnverified: chosen === SAMPLING_MODE.ROBUST_MEAN ? PROVENANCE.LOCAL_UNVERIFIED : null,
    },
  };
}

function distance(a, b) {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/** 一次性算完整网格的采样（含 F 的格间邻域差）。 */
export function sampleGrid(source, cols, rows, options = {}) {
  const mode = options.mode || SAMPLING_MODE.ADAPTIVE;
  const cfg = options.config || {};
  const colors = [];
  const features = [];
  const alphas = new Float32Array(cols * rows);
  const modes = new Array(cols * rows).fill("empty");

  // 第一遍：线性均值（供格间差用）
  const means = new Array(cols * rows).fill(null);
  const pixelSets = new Array(cols * rows).fill(null);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const b = cellBounds(x, y, source.width, source.height, cols, rows);
      const px = collectCell(source, b);
      pixelSets[y * cols + x] = px;
      means[y * cols + x] = px.length ? linearMean(px) : null;
    }
  }

  // 第二遍：格间最大邻域差（F 思想）
  const neighborDelta = new Float32Array(cols * rows);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      let max = 0;
      const self = means[y * cols + x];
      if (!self) continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const other = means[ny * cols + nx];
        if (!other) continue;
        const d = distance(linearToSrgb([self.r, self.g, self.b]), linearToSrgb([other.r, other.g, other.b]));
        if (d > max) max = d;
      }
      neighborDelta[y * cols + x] = max;
    }
  }

  // 第三遍：定模式
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      const res = sampleCell(pixelSets[i], {
        mode,
        config: cfg,
        neighborMaxLinearDelta: neighborDelta[i],
      });
      colors[i] = res.rgb;
      features[i] = res.features;
      alphas[i] = res.features.alpha ?? 0;
      modes[i] = res.mode;
    }
  }

  return { colors, features, alphas, modes, neighborDelta, cols, rows };
}
