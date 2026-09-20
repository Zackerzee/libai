/**
 * segmentation/feather-mask.js
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **来源：本仓库补全（ORIGIN.LIBMS_FILL）**
 *
 * 上游 README 宣称：
 *   > 「**边缘羽化**：高斯模糊 mask 边缘，过渡更自然」
 * 但实际上：`config.feather` 在三档预设里声明了 `0 / 1 / 2`（app.js:93–96），
 * **全文再没有任何一处读取过它**（`grep -n feather app.js` → 4 次命中，全在配置字面量）。
 * 审计缺陷 **S-7**：边缘羽化在上游完全不存在，是三档参数里的死值。
 *
 * 本文件把这三档真正接上：
 *   - 可分离一维高斯（先横后纵，复杂度 O(n·r) 而非 O(n·r²)）；
 *   - 边界用**夹取**延拓（clamp），保证边框像素不被虚拟的黑色拉暗；
 *   - 输出**连续 alpha**（Float32 0–1），保留软过渡；
 *     需要二值掩码时可再按 `binaryThreshold` 取阈。
 *
 * 羽化的用途：抠图边界本质上是一个硬 0/1 判定，会把「半透明残留」
 * （抗锯齿边缘、压缩噪声）整体推给某一边。羽化给出置信度，
 * 让下游可以按 alpha 加权（例如面积均值采样时按 alpha 加权，
 * 或对 alpha 处于中间带的格子单独处理）。
 */

import { PW_CONFIG } from "../config.js";
import { PRECISION } from "../config.js";

/**
 * 一维高斯核（已归一化）。
 * @param {number} sigma
 * @param {number} [radius] 默认 `ceil(2 * sigma)`，最小 1
 * @returns {Float32Array}
 */
export function gaussianKernel(sigma, radius) {
  const s = Math.max(1e-6, Number(sigma) || 0);
  const r = Math.max(1, radius ?? Math.ceil(2 * s));
  const size = r * 2 + 1;
  const kernel = new Float32Array(size);
  const denom = 2 * s * s;
  let sum = 0;
  for (let i = -r; i <= r; i++) {
    const value = Math.exp(-(i * i) / denom);
    kernel[i + r] = value;
    sum += value;
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum;
  return kernel;
}

/**
 * 单通道可分离高斯模糊，边界夹取。
 * @param {Float32Array|Float64Array} src
 * @param {number} width
 * @param {number} height
 * @param {{sigma?:number, radius?:number}} [options]
 * @returns {{data:Float32Array, sigma:number, radius:number}}
 */
export function blurChannel(src, width, height, options = {}) {
  const sigma = options.sigma ?? PW_CONFIG.feather.sigma;
  const radius = Math.max(1, options.radius ?? Math.ceil(2 * sigma));
  if (sigma <= 0 || radius <= 0) return { data: Float32Array.from(src), sigma: 0, radius: 0 };

  const kernel = gaussianKernel(sigma, radius);
  const horizontal = new Float32Array(width * height);

  for (let y = 0; y < height; y++) {
    const rowBase = y * width;
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sx = x + k < 0 ? 0 : x + k >= width ? width - 1 : x + k;
        acc += src[rowBase + sx] * kernel[k + radius];
      }
      horizontal[rowBase + x] = acc;
    }
  }

  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = -radius; k <= radius; k++) {
        const sy = y + k < 0 ? 0 : y + k >= height ? height - 1 : y + k;
        acc += horizontal[sy * width + x] * kernel[k + radius];
      }
      out[y * width + x] = acc;
    }
  }

  return { data: out, sigma, radius };
}

/**
 * 按精度档取羽化半径。上游只声明了值，从未使用；这里给出可用的解析。
 * @param {string} precision
 */
export function featherRadiusForPrecision(precision) {
  const table = PW_CONFIG.feather.radiusByPrecision;
  return Object.prototype.hasOwnProperty.call(table, precision) ? table[precision] : table[PRECISION.BALANCED];
}

/**
 * 把二值掩码羽化成连续 alpha。
 *
 * @param {Uint8Array} mask 0/1
 * @param {number} width
 * @param {number} height
 * @param {{radius?:number, sigma?:number, threshold?:number}} [options]
 * @returns {{alpha:Float32Array, binary:Uint8Array, radius:number, sigma:number}}
 */
export function featherMask(mask, width, height, options = {}) {
  const radius = options.radius ?? PW_CONFIG.feather.radiusByPrecision.balanced;
  const sigma = options.sigma ?? PW_CONFIG.feather.sigma;
  const threshold = options.threshold ?? PW_CONFIG.feather.binaryThreshold;

  if (!radius || radius <= 0 || sigma <= 0) {
    // 半径 0 = 不羽化。上游 fast 档的 feather:0 就是这个语义。
    const alpha = new Float32Array(width * height);
    const binary = new Uint8Array(width * height);
    for (let i = 0; i < alpha.length; i++) {
      alpha[i] = mask[i] ? 1 : 0;
      binary[i] = mask[i] ? 1 : 0;
    }
    return { alpha, binary, radius: 0, sigma: 0 };
  }

  const source = new Float32Array(width * height);
  for (let i = 0; i < source.length; i++) source[i] = mask[i] ? 1 : 0;

  const blurred = blurChannel(source, width, height, { sigma, radius });

  const alpha = new Float32Array(width * height);
  const binary = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i++) {
    const value = blurred.data[i] < 0 ? 0 : blurred.data[i] > 1 ? 1 : blurred.data[i];
    alpha[i] = value;
    binary[i] = value >= threshold ? 1 : 0;
  }

  return { alpha, binary, radius, sigma };
}

/**
 * 对 RGB 栅格做高斯模糊（用于多尺度边缘的「模糊层」）。
 * @param {{data:Float32Array, width:number, height:number}} raster
 * @param {{sigma?:number, radius?:number}} [options]
 */
export function blurRaster(raster, options = {}) {
  const { width, height } = raster;
  const out = new Float32Array(width * height * 4);
  for (let c = 0; c < 4; c++) {
    const plane = new Float32Array(width * height);
    for (let i = 0; i < plane.length; i++) plane[i] = raster.data[i * 4 + c];
    const blurred = blurChannel(plane, width, height, options);
    for (let i = 0; i < plane.length; i++) out[i * 4 + c] = blurred.data[i];
  }
  return { data: out, width, height };
}

export const DEFAULT_FEATHER = Object.freeze({
  radius: PW_CONFIG.feather.radiusByPrecision.balanced,
  sigma: PW_CONFIG.feather.sigma,
  threshold: PW_CONFIG.feather.binaryThreshold,
});
