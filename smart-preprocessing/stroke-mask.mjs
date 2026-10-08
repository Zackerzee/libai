/**
 * 线稿（描边）掩码（V2.5 智能生成引擎 · stroke-mask）
 *
 * 用途：线稿 / 漫画里黑色描边是画面骨架。把描边位置提取成掩码，
 * 让生成引擎在这些位置提高边缘保护权重，避免描边在采样与清理阶段被糊掉或断开。
 *
 * 流程：线性空间 Rec.709 灰度 → Sobel 梯度幅值 → Otsu 自动阈值（含退化回退）→
 * 沿梯度方向非极大值抑制（NMS）细线化 → 连续强度 Float32 掩码。
 *
 * 复用 palette-engine 的 srgbToLinear（不自建色彩空间）。
 */

import { srgbToLinear } from "./palette-engine.mjs";

export const DEFAULT_STROKE_CONFIG = Object.freeze({
  // 绝对阈值：非 null 时直接覆盖 Otsu（0 仍表示「全部归前景」，慎用）
  absoluteThreshold: null,
  // Otsu 直方图分箱数
  otsuBins: 256,
});

/* =========================================================
 * 1. 灰度（线性空间 Rec.709 亮度）
 * ======================================================= */

// 在线性空间做灰度：先 srgbToLinear 每个通道，再按 Rec.709 加权。
// 线性空间比 sRGB 直接加权更符合人眼对「边缘强度」的感知。结果存 0..255。
function toLinearGray(imageData) {
  const { data, width, height } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    const r = srgbToLinear(data[i * 4]);
    const g = srgbToLinear(data[i * 4 + 1]);
    const b = srgbToLinear(data[i * 4 + 2]);
    gray[i] = (0.2126 * r + 0.7152 * g + 0.0722 * b) * 255;
  }
  return gray;
}

/* =========================================================
 * 2. Sobel 梯度幅值
 * ======================================================= */

// 边界策略：越界邻域用「夹取」（clamp / 边缘复制），即把越界坐标夹到 [0,W-1]/[0,H-1]。
// 选 clamp 而非补 0：补 0 会在图像四边人为制造强梯度（假描边），clamp 更像「边缘外同色延伸」，
// 对贴边描边更友好。代价：贴边若真有强对比，clamp 可能稍弱其梯度，但比假边更可控。

const SOBEL_X = [[-1, 0, 1], [-2, 0, 2], [-1, 0, 1]];
const SOBEL_Y = [[-1, -2, -1], [0, 0, 0], [1, 2, 1]];

function clampCoord(v, max) {
  return v < 0 ? 0 : v >= max ? max - 1 : v;
}

function sobel(gray, W, H) {
  const size = W * H;
  const gx = new Float32Array(size);
  const gy = new Float32Array(size);
  const mag = new Float32Array(size);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx = 0, sy = 0;
      for (let ky = -1; ky <= 1; ky++) {
        for (let kx = -1; kx <= 1; kx++) {
          const ny = clampCoord(y + ky, H);
          const nx = clampCoord(x + kx, W);
          const v = gray[ny * W + nx];
          sx += SOBEL_X[ky + 1][kx + 1] * v;
          sy += SOBEL_Y[ky + 1][kx + 1] * v;
        }
      }
      const idx = y * W + x;
      gx[idx] = sx;
      gy[idx] = sy;
      mag[idx] = Math.hypot(sx, sy);
    }
  }
  return { gx, gy, mag };
}

/* =========================================================
 * 3. Otsu 自动阈值（+ 纯双峰退化回退）
 * ======================================================= */

function otsuThreshold(mag, size, bins) {
  let maxMag = 0;
  for (let i = 0; i < size; i++) if (mag[i] > maxMag) maxMag = mag[i];
  if (maxMag <= 0) return 0; // 无梯度（纯黑 / 纯白）→ 交给上层返回空掩码
  const hist = new Float64Array(bins);
  const scale = (bins - 1) / maxMag;
  for (let i = 0; i < size; i++) {
    let b = (mag[i] * scale) | 0;
    if (b >= bins) b = bins - 1;
    hist[b] += 1;
  }
  const total = size;
  let sum = 0;
  for (let b = 0; b < bins; b++) sum += b * hist[b];
  let sumB = 0, wB = 0, maxVar = -1, thresholdBin = 0;
  for (let b = 0; b < bins; b++) {
    wB += hist[b];
    if (wB === 0) continue;
    const wF = total - wB;
    if (wF === 0) break;
    sumB += b * hist[b];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const variance = wB * wF * (mB - mF) * (mB - mF);
    if (variance > maxVar) { maxVar = variance; thresholdBin = b; }
  }
  // 阈值取分箱下界对应幅值（非 +0.5）：纯双峰时阈值落在最低分箱 → 0，
  // 使「整幅归前景」被下方退化检测捕获并触发回退。
  return (thresholdBin / scale);
}

/**
 * 计算最终阈值。
 * 退化回退：当 Otsu 阈值把整幅图判成同一侧（前景或背景其一为空）时，
 * 改用「梯度幅值非零区间的中点」作为阈值，避免纯黑白 / 纯双峰图被整张误判。
 */
function resolveThreshold(mag, size, options) {
  if (options.absoluteThreshold != null) {
    return { threshold: options.absoluteThreshold, otsu: null, usedFallback: false };
  }
  const bins = options.otsuBins ?? DEFAULT_STROKE_CONFIG.otsuBins;
  const otsu = otsuThreshold(mag, size, bins);
  let threshold = otsu;
  let usedFallback = false;
  let fg = 0, bg = 0;
  for (let i = 0; i < size; i++) { if (mag[i] >= threshold) fg++; else bg++; }
  if (fg === 0 || bg === 0) {
    // 回退：取非零幅值区间 [min, max] 的中点
    let mn = Infinity, mx = -Infinity;
    for (let i = 0; i < size; i++) {
      if (mag[i] > 0) { if (mag[i] < mn) mn = mag[i]; if (mag[i] > mx) mx = mag[i]; }
    }
    if (mx > mn) { threshold = (mn + mx) / 2; usedFallback = true; }
    else if (mx > 0) { threshold = mn; usedFallback = true; }
  }
  return { threshold, otsu, usedFallback };
}

/* =========================================================
 * 4. 非极大值抑制（沿梯度方向细线化到 ~1px）
 * ======================================================= */

// 梯度方向量化到 4 个扇区，返回「正方向」邻居偏移：
//   0 → 水平（左右比较，竖边）   1 → 45°（对角）   2 → 垂直（上下比较，横边）   3 → 135°（对角）
function gradientSector(gx, gy, idx) {
  const angle = Math.atan2(gy[idx], gx[idx]) * 180 / Math.PI; // [-180,180]
  const a = angle < 0 ? angle + 180 : angle; // [0,180)
  if (a < 22.5 || a >= 157.5) return 0;
  if (a < 67.5) return 1;
  if (a < 112.5) return 2;
  return 3;
}

const NMS_OFFSET = [[1, 0], [1, 1], [0, 1], [1, -1]];

// 沿梯度方向做 NMS：只有不小于两个方向邻居的点保留为局部极大，描边收细到 ~1px。
// 用「不小于」（>=）而非严格大于：Sobel 在硬边（二值描边）上会得到 2px 宽的脊，
// 严格大于会把脊两侧都抑制掉（对角 1px 线、棋盘格直线因此整条消失）；>= 保留脊、仍把粗描边收细。
// 实现取舍：用标准 Canny 式 NMS（4 扇区）而非形态学骨架化——NMS 直接吃梯度方向、成本低、
// 对斜线描边也连续，足够把粗带收成细线；骨架化更准但实现重、边界拐角易断裂，故不采用。
function nonMaximumSuppression(mag, gx, gy, W, H) {
  const size = W * H;
  const out = new Float32Array(size);
  let suppressed = 0;
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const idx = y * W + x;
      const sector = gradientSector(gx, gy, idx);
      const [dx, dy] = NMS_OFFSET[sector];
      const nx1 = clampCoord(x + dx, W), ny1 = clampCoord(y + dy, H);
      const nx2 = clampCoord(x - dx, W), ny2 = clampCoord(y - dy, H);
      const v = mag[idx];
      const n1 = mag[ny1 * W + nx1];
      const n2 = mag[ny2 * W + nx2];
      if (v >= n1 && v >= n2) out[idx] = v;
      else suppressed++;
    }
  }
  return { out, suppressed };
}

/* =========================================================
 * 5. 主入口
 * ======================================================= */

/**
 * 提取描边掩码。
 * @returns { mask, width, height, threshold, density, diagnostics }
 *   mask        Float32Array，长度 width*height，0..1 连续强度（供引擎做加权，不是硬 0/1）
 *   threshold   最终使用阈值
 *   density     前景占比（非零像素比例）
 *   diagnostics { gradientMean, gradientMax, otsuThreshold, usedFallback, nmsSuppressed }
 */
export function extractStrokeMask(imageData, options = {}) {
  const W = imageData.width;
  const H = imageData.height;
  const size = W * H;
  const cfg = { ...DEFAULT_STROKE_CONFIG, ...options };
  const doNms = options.enableNms !== false;

  const gray = toLinearGray(imageData);
  const { gx, gy, mag } = sobel(gray, W, H);

  let gradientMean = 0, gradientMax = 0;
  for (let i = 0; i < size; i++) {
    gradientMean += mag[i];
    if (mag[i] > gradientMax) gradientMax = mag[i];
  }
  gradientMean = size ? gradientMean / size : 0;

  if (gradientMax <= 0) {
    return {
      mask: new Float32Array(size),
      width: W, height: H,
      threshold: 0,
      density: 0,
      diagnostics: { gradientMean: 0, gradientMax: 0, otsuThreshold: 0, usedFallback: false, nmsSuppressed: 0 },
    };
  }

  const { threshold, otsu, usedFallback } = resolveThreshold(mag, size, cfg);
  const { out: thinned, suppressed } = doNms
    ? nonMaximumSuppression(mag, gx, gy, W, H)
    : { out: mag, suppressed: 0 };

  const mask = new Float32Array(size);
  let nonzero = 0;
  for (let i = 0; i < size; i++) {
    if (thinned[i] > 0 && thinned[i] >= threshold) {
      mask[i] = thinned[i] / gradientMax; // 归一化到 0..1 连续强度
      nonzero++;
    }
  }
  const density = size ? nonzero / size : 0;

  return {
    mask,
    width: W,
    height: H,
    threshold,
    density,
    diagnostics: {
      gradientMean,
      gradientMax,
      otsuThreshold: otsu == null ? threshold : otsu,
      usedFallback,
      nmsSuppressed: suppressed,
    },
  };
}

/* =========================================================
 * 6. 膨胀（容忍像素级错位）
 * ======================================================= */

/**
 * 半径内最大值膨胀，返回新的 Float32Array（不修改入参）。
 * 用于让描边掩码容忍采样/清理阶段的像素级错位。
 */
export function dilateMask(mask, width, height, radius = 1) {
  const r = Math.max(0, Math.round(radius));
  const size = width * height;
  const out = new Float32Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let m = 0;
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          const ny = clampCoord(y + dy, height);
          const nx = clampCoord(x + dx, width);
          const v = mask[ny * width + nx];
          if (v > m) m = v;
        }
      }
      out[y * width + x] = m;
    }
  }
  return out;
}

/* =========================================================
 * 7. 掩码密度
 * ======================================================= */

/** 返回掩码的非零占比（0..1）。 */
export function maskDensity(mask) {
  let n = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++;
  return mask.length ? n / mask.length : 0;
}

export default {
  DEFAULT_STROKE_CONFIG,
  extractStrokeMask,
  dilateMask,
  maskDensity,
};
