/**
 * segmentation/sobel3.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`autoCutout` 内联的边缘检测（app.js:99–115）
 *
 * ```js
 * const edgeMap = new Float32Array(w * h);
 * for (let y = 1; y < h - 1; y++) {
 *   for (let x = 1; x < w - 1; x++) {
 *     let gx = 0, gy = 0;
 *     for (let dy = -1; dy <= 1; dy++) {
 *       for (let dx = -1; dx <= 1; dx++) {
 *         const i = ((y + dy) * w + (x + dx)) * 4;
 *         const gray = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
 *         const kx = [-1, 0, 1, -2, 0, 2, -1, 0, 1][(dy + 1) * 3 + (dx + 1)];
 *         const ky = [-1, -2, -1, 0, 0, 0, 1, 2, 1][(dy + 1) * 3 + (dx + 1)];
 *         gx += gray * kx;
 *         gy += gray * ky;
 *       }
 *     }
 *     edgeMap[y * w + x] = Math.sqrt(gx * gx + gy * gy);
 *   }
 * }
 * ```
 *
 * 忠实移植，只有两处非语义改动：
 *   ① 把 `gray` 提到卷积之外预先算好（上游在内层循环里对同一像素算了 9 次）；
 *   ② 两个核提到常量表（上游每层循环都重建一次字面量数组）。
 * 结果与上游**逐位相同**。
 *
 * 保留的上游特性：
 *   - luma 用 Rec.601 权重 `0.299 / 0.587 / 0.114`；
 *   - **边框 1 像素恒为 0**（循环从 1 到 h-2）；
 *   - 不读 alpha。
 */

import { PW_CONFIG } from "../config.js";

/** 水平导数核（3×3 展开为 9 元素，按 (dy+1)*3+(dx+1) 索引）。 */
export const SOBEL3_KX = PW_CONFIG.sobel3.kx;
/** 垂直导数核。 */
export const SOBEL3_KY = PW_CONFIG.sobel3.ky;

/** Rec.601 亮度权重。 */
export const LUMA_WEIGHTS = PW_CONFIG.luma.weights;

/**
 * RGBA → 亮度平面。**上游的 gray 就是这个式子**（只是上游在内层循环里重复计算）。
 * @param {{data:ArrayLike<number>, width:number, height:number}} raster
 * @returns {Float32Array} 长度 width*height
 */
export function toLuma(raster, weights = LUMA_WEIGHTS) {
  const { width, height } = raster;
  const data = raster.data;
  const out = new Float32Array(width * height);
  const [wr, wg, wb] = weights;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = data[p] * wr + data[p + 1] * wg + data[p + 2] * wb;
  }
  return out;
}

/**
 * 3×3 Sobel。返回梯度分量与幅值。
 *
 * @param {Float32Array} luma 亮度平面
 * @param {number} width
 * @param {number} height
 * @returns {{magnitude:Float32Array, gx:Float32Array, gy:Float32Array, borderValue:number}}
 */
export function sobel3(luma, width, height) {
  const kx = SOBEL3_KX;
  const ky = SOBEL3_KY;
  const borderValue = PW_CONFIG.sobel3.borderValue;

  const gxPlane = new Float32Array(width * height);
  const gyPlane = new Float32Array(width * height);
  const magnitude = new Float32Array(width * height);

  // 上游：边框保持 Float32Array 的初值 0。
  if (borderValue !== 0) magnitude.fill(borderValue);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sumX = 0;
      let sumY = 0;
      let k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const rowBase = (y + dy) * width;
        for (let dx = -1; dx <= 1; dx++, k++) {
          const gray = luma[rowBase + x + dx];
          sumX += gray * kx[k];
          sumY += gray * ky[k];
        }
      }
      const index = y * width + x;
      gxPlane[index] = sumX;
      gyPlane[index] = sumY;
      magnitude[index] = Math.sqrt(sumX * sumX + sumY * sumY);
    }
  }

  return { magnitude, gx: gxPlane, gy: gyPlane, borderValue };
}

/** 3×3 Sobel 的核能量（用于跨尺度归一化）。 */
export function sobel3Energy() {
  let e = 0;
  for (let i = 0; i < SOBEL3_KX.length; i++) e += SOBEL3_KX[i] * SOBEL3_KX[i];
  return Math.sqrt(e);
}
