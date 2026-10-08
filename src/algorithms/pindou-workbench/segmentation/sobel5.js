/**
 * segmentation/sobel5.js
 * ─────────────────────────────────────────────────────────────
 * ⚠️ **来源：本仓库补全（ORIGIN.LIBMS_FILL）**
 *
 * 上游 README 明确宣称：
 *   > 「多尺度边缘检测：**3×3 + 5×5 Sobel 融合**，捕捉粗细边缘」
 * 但上游 `app.js` 里**只有一处 3×3 Sobel，没有 5×5，也没有任何融合**
 * （`grep -ci "5x5\|sobel5" app.js` → 0）。审计文档 §0.2 已记录此项虚标。
 *
 * 本文件按 Sobel 的标准构造补出 5×5 版本：
 *   一阶差分序列 `[-1, -2, 0, 2, 1]`（中心对称、和为 0）
 *   × 方向平滑序列 `[1, 4, 6, 4, 1]`
 *   → KX = 差分(列) ⊗ 平滑(行)，KY = 其转置。
 *
 * 核能量是 3×3 版的约 4.4 倍，因此跨尺度融合前**必须**归一化
 * （见 multi-scale-edge.js；本文件同时导出 `sobel5Energy()`）。
 */

import { PW_CONFIG } from "../config.js";

/** 5×5 水平导数核（25 元素，行优先）。 */
export const SOBEL5_KX = PW_CONFIG.sobel5.kx;

/** 5×5 垂直导数核 = KX 的转置。 */
export const SOBEL5_KY = Object.freeze(
  (() => {
    const kx = SOBEL5_KX;
    const out = new Array(25);
    for (let y = 0; y < 5; y++) for (let x = 0; x < 5; x++) out[y * 5 + x] = kx[x * 5 + y];
    return out;
  })(),
);

/** 5×5 邻域半径（= 2）。 */
export const SOBEL5_RADIUS = PW_CONFIG.sobel5.radius;

/**
 * 5×5 Sobel。
 *
 * 边框 2 像素保持 0 —— 与 3×3 版同样的纪律（该处梯度不可靠，
 * 且上游也是这么处理的，融合时两尺度需要一致的无效区才能比较）。
 *
 * @param {Float32Array} luma
 * @param {number} width
 * @param {number} height
 * @returns {{magnitude:Float32Array, gx:Float32Array, gy:Float32Array, radius:number}}
 */
export function sobel5(luma, width, height) {
  const kx = SOBEL5_KX;
  const ky = SOBEL5_KY;
  const r = SOBEL5_RADIUS;

  const gxPlane = new Float32Array(width * height);
  const gyPlane = new Float32Array(width * height);
  const magnitude = new Float32Array(width * height);

  for (let y = r; y < height - r; y++) {
    for (let x = r; x < width - r; x++) {
      let sumX = 0;
      let sumY = 0;
      let k = 0;
      for (let dy = -r; dy <= r; dy++) {
        const rowBase = (y + dy) * width;
        for (let dx = -r; dx <= r; dx++, k++) {
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

  return { magnitude, gx: gxPlane, gy: gyPlane, radius: r };
}

/** 5×5 核能量。 */
export function sobel5Energy() {
  let e = 0;
  for (let i = 0; i < SOBEL5_KX.length; i++) e += SOBEL5_KX[i] * SOBEL5_KX[i];
  return Math.sqrt(e);
}
