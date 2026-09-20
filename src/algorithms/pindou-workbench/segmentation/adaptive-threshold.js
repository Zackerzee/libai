/**
 * segmentation/adaptive-threshold.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`autoCutout` 的阈值段（app.js:117–125）
 *
 * ```js
 * const edgeValues = Array.from(edgeMap).filter(v => v > 0).sort((a, b) => a - b);
 * const median = edgeValues[Math.floor(edgeValues.length / 2)] || 50;
 * const adaptiveThresh = Math.max(config.edgeThresh, median * 0.8);
 * ```
 *
 * 忠实移植，并补齐上游 README 宣称却并不存在的两件事：
 *   - **edge histogram**（README：「基于边缘强度直方图动态调整」→ 代码里没有直方图）；
 *   - **Otsu**（libms / bgs 的口径，作为另一种阈值模式供 A/B）。
 *
 * 上游 median 档的三个细节（全部保留）：
 *   ① 只在**非零**边缘值上取中位数（边框的 0 不参与）；
 *   ② 取的是 `sorted[floor(n/2)]`，即**上中位数**，不是中间两值的均值；
 *   ③ 中位数为 0 / 取不到时**回退到 50**（`|| 50`）。
 */

import { PW_CONFIG, THRESHOLD_MODE } from "../config.js";
import { otsuThreshold } from "../../bgs/color-space.mjs";

export { THRESHOLD_MODE };

/**
 * 边缘强度直方图。
 *
 * @param {Float32Array} magnitude
 * @param {{bins?:number, max?:number}} [options] `max` 缺省取实际最大值
 * @returns {{counts:Uint32Array, edges:Float32Array, max:number, binWidth:number, total:number}}
 */
export function edgeHistogram(magnitude, options = {}) {
  const bins = Math.max(2, (options.bins ?? PW_CONFIG.threshold.histogramBins) | 0);
  let max = options.max;
  if (!(max > 0)) {
    max = 0;
    for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > max) max = magnitude[i];
  }
  const binWidth = max > 0 ? max / bins : 1;

  const counts = new Uint32Array(bins);
  const edges = new Float32Array(bins + 1);
  for (let i = 0; i <= bins; i++) edges[i] = i * binWidth;

  let total = 0;
  for (let i = 0; i < magnitude.length; i++) {
    const value = magnitude[i];
    if (!(value > 0)) continue;
    let bin = Math.floor(value / binWidth);
    if (bin >= bins) bin = bins - 1;
    if (bin < 0) bin = 0;
    counts[bin]++;
    total++;
  }

  return { counts, edges, max, binWidth, total };
}

/**
 * 上游口径的中位数：非零值的**上中位数**，取不到则回退 50。
 * @param {Float32Array} magnitude
 */
export function medianOfNonZero(magnitude, fallback = 50) {
  const values = [];
  for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > 0) values.push(magnitude[i]);
  if (!values.length) return fallback;
  values.sort((a, b) => a - b);
  return values[Math.floor(values.length / 2)] || fallback;
}

/**
 * 256 桶直方图 + Otsu。复用 bgs/color-space.mjs 的实现（含纯双峰平台退化修正）。
 * @param {Float32Array} magnitude
 * @returns {{value:number, histogram256:Uint32Array, otsu:object|null}}
 */
export function otsuOnMagnitude(magnitude, { scale = 1 } = {}) {
  let max = 0;
  for (let i = 0; i < magnitude.length; i++) if (magnitude[i] > max) max = magnitude[i];
  const histogram256 = new Uint32Array(256);
  let total = 0;
  if (max <= 0) return { value: 0, histogram256, otsu: null };

  for (let i = 0; i < magnitude.length; i++) {
    const value = magnitude[i];
    if (!(value > 0)) continue;
    let bin = Math.floor((value / max) * 255);
    if (bin > 255) bin = 255;
    if (bin < 0) bin = 0;
    histogram256[bin]++;
    total++;
  }

  const otsu = otsuThreshold(histogram256, total);
  if (!otsu) return { value: 0, histogram256, otsu: null };
  // 把桶号映射回幅值量纲
  const value = ((otsu.threshold + 0.5) / 255) * max * scale;
  return { value, histogram256, otsu };
}

/**
 * 解析阈值。上游只有 median 一种模式；其余三种为 libms 补全。
 *
 * @param {Float32Array} magnitude
 * @param {{
 *   mode?:string, floor?:number, medianFactor?:number,
 *   meanStdK?:number, fixedValue?:number, histogramBins?:number
 * }} [options]
 * @returns {{
 *   value:number, mode:string, floor:number,
 *   components:{median?:number, mean?:number, std?:number, otsu?:number},
 *   histogram:{counts:Uint32Array, edges:Float32Array, max:number, binWidth:number, total:number}
 * }}
 */
export function resolveThreshold(magnitude, options = {}) {
  const mode = Object.values(THRESHOLD_MODE).includes(options.mode) ? options.mode : PW_CONFIG.threshold.mode;
  const floor = Number.isFinite(options.floor) ? options.floor : 0;
  const medianFactor = options.medianFactor ?? PW_CONFIG.threshold.medianFactor;
  const meanStdK = options.meanStdK ?? PW_CONFIG.threshold.meanStdK;

  const histogram = edgeHistogram(magnitude, { bins: options.histogramBins ?? PW_CONFIG.threshold.histogramBins });
  const components = {};

  let raw;
  if (mode === THRESHOLD_MODE.MEDIAN) {
    const median = medianOfNonZero(magnitude);
    components.median = median;
    raw = median * medianFactor;
  } else if (mode === THRESHOLD_MODE.OTSU) {
    const result = otsuOnMagnitude(magnitude);
    components.otsu = result.value;
    raw = result.value;
  } else if (mode === THRESHOLD_MODE.MEAN_STD) {
    let sum = 0;
    let sumSq = 0;
    let n = 0;
    for (let i = 0; i < magnitude.length; i++) {
      if (!(magnitude[i] > 0)) continue;
      sum += magnitude[i];
      sumSq += magnitude[i] * magnitude[i];
      n++;
    }
    const mean = n ? sum / n : 0;
    const variance = n ? Math.max(0, sumSq / n - mean * mean) : 0;
    const std = Math.sqrt(variance);
    components.mean = mean;
    components.std = std;
    raw = mean + meanStdK * std;
  } else {
    raw = Number.isFinite(options.fixedValue) ? options.fixedValue : floor;
  }

  return {
    // 上游关键语义：阈值**不低于** floor（= edgeThresh）
    value: Math.max(floor, raw),
    raw,
    mode,
    floor,
    medianFactor,
    components,
    histogram,
  };
}

/** 按阈值二值化。返回 0/1 的 Uint8Array。 */
export function binarize(magnitude, threshold) {
  const out = new Uint8Array(magnitude.length);
  for (let i = 0; i < magnitude.length; i++) out[i] = magnitude[i] > threshold ? 1 : 0;
  return out;
}

export const DEFAULT_THRESHOLD = Object.freeze({
  mode: PW_CONFIG.threshold.mode,
  medianFactor: PW_CONFIG.threshold.medianFactor,
  meanStdK: PW_CONFIG.threshold.meanStdK,
  histogramBins: PW_CONFIG.threshold.histogramBins,
});
