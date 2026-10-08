/**
 * segmentation/multi-scale-edge.js
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **来源：本仓库补全（ORIGIN.LIBMS_FILL）**
 *
 * 上游 README 宣称「3×3 + 5×5 Sobel **融合**」，代码里既没有 5×5 也没有融合。
 * 本文件补出融合层 —— 这也是第五阶段 hybrid 管线里唯一真正属于 pw 的新算法。
 *
 * 三个必须处理的技术点：
 *
 * ① **核能量差异**。5×5 核的平方和是 3×3 的约 4.4 倍，直接融合等于让粗尺度
 *    单方面压制细尺度。因此每个尺度先按 `E_ref / E_i` 缩放到同一量纲，
 *    这样融合后的幅值仍然与「单个 3×3 Sobel 的原始幅值」同量纲，
 *    上游那套 `edgeThresh: 60/45/40` 才有可比性。
 *
 * ② **多尺度有两种含义**。「同一算子的不同尺寸核」（3×3 vs 5×5）与
 *    「同一算子在不同模糊层上重复」（scale-space）是两回事。本模块两者都支持：
 *    `scales` 里每项是 `{kernel, sigma}`，`sigma > 0` 表示先对该层做高斯模糊。
 *
 * ③ **有效区不同**。3×3 的边框 1 像素为 0，5×5 的边框 2 像素为 0。
 *    融合时以**最小有效区**为准（半径取各尺度的最大值），否则粗尺度会在边框
 *    附近被细尺度的 0 拉低，凭空造出一圈假边缘。
 */

import { PW_CONFIG, EDGE_FUSE } from "../config.js";
import { toLuma, sobel3, sobel3Energy } from "./sobel3.js";
import { sobel5, sobel5Energy } from "./sobel5.js";
import { blurRaster } from "./feather-mask.js";

/** 默认尺度集：README 宣称的「3×3 + 5×5」。 */
export function defaultScales(options = {}) {
  const scales = [
    { kernel: 3, sigma: 0 },
    { kernel: 5, sigma: 0 },
  ];
  if (options.deep === true) {
    const sigmas = (options.blurSigmas || PW_CONFIG.multiScale.blurSigmas).filter((s) => s > 0);
    for (const sigma of sigmas) scales.push({ kernel: 5, sigma });
  }
  return scales;
}

/**
 * 取分位数（在非零值上）。用于稳健归一化，避开单个极值。
 * @param {Float32Array} values
 * @param {number} q 0–1
 */
export function nonzeroQuantile(values, q) {
  const nonZero = [];
  for (let i = 0; i < values.length; i++) if (values[i] > 0) nonZero.push(values[i]);
  if (!nonZero.length) return 0;
  nonZero.sort((a, b) => a - b);
  const index = Math.min(nonZero.length - 1, Math.max(0, Math.round(q * (nonZero.length - 1))));
  return nonZero[index];
}

/**
 * 单个尺度的边缘响应（含可选高斯前置模糊）。
 * @param {Float32Array} luma
 * @param {number} width
 * @param {number} height
 * @param {{kernel:number, sigma:number}} scale
 */
function edgeAtScale(luma, width, height, scale) {
  let plane = luma;
  let blurred = null;
  if (scale.sigma > 0) {
    blurred = blurRaster({ data: lumaToRgba(luma), width, height }, { sigma: scale.sigma });
    plane = toLuma({ data: blurred.data, width, height });
  }

  if (scale.kernel === 5) {
    const result = sobel5(plane, width, height);
    return { ...result, kernel: 5, sigma: scale.sigma, energy: sobel5Energy() };
  }
  const result = sobel3(plane, width, height);
  return { ...result, kernel: 3, sigma: scale.sigma, energy: sobel3Energy() };
}

/** luma 平面包成 RGBA（blurRaster 只吃 RGBA）。灰阶下 R=G=B。 */
function lumaToRgba(luma) {
  const out = new Float32Array(luma.length * 4);
  for (let i = 0; i < luma.length; i++) {
    out[i * 4] = luma[i];
    out[i * 4 + 1] = luma[i];
    out[i * 4 + 2] = luma[i];
    out[i * 4 + 3] = 255;
  }
  return out;
}

/**
 * 多尺度 Sobel 融合。
 *
 * @param {Float32Array} luma
 * @param {number} width
 * @param {number} height
 * @param {{scales?:Array, fuse?:string, weights?:number[], normalizeQuantile?:number}} [options]
 * @returns {{
 *   magnitude:Float32Array,   // 融合幅值，与单个 3×3 Sobel 同量纲
 *   normalized:Float32Array,  // 归一化到 [0,1]，供统计/可视化
 *   perScale:Array<{kernel:number, sigma:number, energy:number, energyScale:number,
 *                   quantile:number, maxRaw:number}>,
 *   fuse:string, validRadius:number
 * }}
 */
export function multiScaleEdge(luma, width, height, options = {}) {
  const scales = options.scales && options.scales.length ? options.scales : defaultScales();
  const fuse = Object.values(EDGE_FUSE).includes(options.fuse) ? options.fuse : PW_CONFIG.multiScale.fuse;
  const weights = Array.isArray(options.weights) && options.weights.length === scales.length
    ? options.weights
    : PW_CONFIG.multiScale.weights.slice(0, scales.length);
  const quantile = options.normalizeQuantile ?? PW_CONFIG.multiScale.normalizeQuantile;

  const referenceEnergy = sobel3Energy();
  const planes = scales.map((scale) => edgeAtScale(luma, width, height, scale));

  // ① 能量归一化到 3×3 的量纲
  const scaledPlanes = planes.map((plane) => {
    const energyScale = referenceEnergy / plane.energy;
    const scaled = new Float32Array(plane.magnitude.length);
    for (let i = 0; i < scaled.length; i++) scaled[i] = plane.magnitude[i] * energyScale;
    return { ...plane, energyScale, scaled };
  });

  // ③ 最小有效区 = 各尺度半径的最大值
  const validRadius = Math.max(...planes.map((plane) => (plane.kernel === 5 ? 2 : 1)));

  const magnitude = new Float32Array(width * height);
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const index = y * width + x;
      const insideValid = y >= validRadius && y < height - validRadius && x >= validRadius && x < width - validRadius;
      if (!insideValid) {
        magnitude[index] = 0;
        continue;
      }
      if (fuse === EDGE_FUSE.MAX) {
        let best = 0;
        for (const plane of scaledPlanes) if (plane.scaled[index] > best) best = plane.scaled[index];
        magnitude[index] = best;
      } else {
        let acc = 0;
        for (let s = 0; s < scaledPlanes.length; s++) {
          const value = scaledPlanes[s].scaled[index];
          acc += fuse === EDGE_FUSE.RMS ? weights[s] * value * value : weights[s] * value;
        }
        magnitude[index] = fuse === EDGE_FUSE.RMS ? Math.sqrt(acc / weightSum) : acc / weightSum;
      }
    }
  }

  // ② 稳健归一化只用于 normalized（与阈值口径解耦）
  const referenceQuantile = nonzeroQuantile(magnitude, quantile) || 1;
  const normalized = new Float32Array(width * height);
  for (let i = 0; i < magnitude.length; i++) {
    normalized[i] = magnitude[i] / referenceQuantile > 1 ? 1 : magnitude[i] / referenceQuantile;
  }

  return {
    magnitude,
    normalized,
    perScale: scaledPlanes.map((plane, i) => ({
      kernel: plane.kernel,
      sigma: plane.sigma,
      energy: plane.energy,
      energyScale: plane.energyScale,
      weight: weights[i],
      quantile: nonzeroQuantile(plane.scaled, quantile),
      maxRaw: plane.magnitude.reduce((a, b) => (b > a ? b : a), 0),
    })),
    fuse,
    validRadius,
    referenceQuantile,
  };
}

/**
 * 便捷入口：RGBA 栅格 → 多尺度边缘幅值。
 * @param {{data:ArrayLike<number>, width:number, height:number}} raster
 */
export function multiScaleEdgeFromRaster(raster, options = {}) {
  const luma = toLuma(raster);
  return multiScaleEdge(luma, raster.width, raster.height, options);
}

export const DEFAULT_MULTI_SCALE = Object.freeze({
  fuse: PW_CONFIG.multiScale.fuse,
  weights: PW_CONFIG.multiScale.weights,
  normalizeQuantile: PW_CONFIG.multiScale.normalizeQuantile,
});
