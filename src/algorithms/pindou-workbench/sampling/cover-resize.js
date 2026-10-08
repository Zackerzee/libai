/**
 * sampling/cover-resize.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：app.js:417–425 的 offscreen Canvas
 *   ```js
 *   const scale = Math.max(w / img.width, h / img.height);   // cover
 *   const sw = img.width * scale, sh = img.height * scale;
 *   offCtx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);  // 居中裁切
 *   const imageData = offCtx.getImageData(0, 0, w, h);
 *   ```
 *
 * 这是上游**唯一的宿主边界**（DOM + Canvas）。本模块把它换成纯数学：
 *   ① `fitGeometry()` —— cover / contain / stretch 的可见源区域，纯几何；
 *   ② `resample()`    —— 确定性重采样（面积均值 / 双线性 / 最近邻）。
 *
 * 为什么不能照搬 Canvas：
 *   - 依赖 DOM，无法在 Node / Worker 里跑（上游那段代码因此不可单测）；
 *   - 上游未设置 `imageSmoothingEnabled`，默认滤波器与 `quality` 由**浏览器**决定，
 *     同一张图在 Chrome / Safari / Firefox 上会得到不完全相同的像素 ——
 *     PWA 场景下这是可复现性缺陷（审计缺陷 E-1）。
 */

import { PW_CONFIG } from "../config.js";

/** 重采样滤波器。 */
export const RESAMPLE_FILTER = Object.freeze({
  /** 按缩放方向自动选择：缩小用面积均值，放大用双线性（贴近浏览器默认行为）。 */
  AUTO: "auto",
  /** 面积加权均值（正确的缩小滤波器）。 */
  AREA: "area-average",
  /** 双线性插值。 */
  BILINEAR: "bilinear",
  /** 最近邻（保留硬边，不产生中间色）。 */
  NEAREST: "nearest",
});

/** 适配方式。 */
export const FIT_MODE = Object.freeze({
  /** 铺满并居中裁切。**上游行为**。 */
  COVER: "cover",
  /** 完整装入并留边。 */
  CONTAIN: "contain",
  /** 拉伸到目标尺寸（变形）。 */
  STRETCH: "stretch",
});

const clamp = (value, min, max) => (value < min ? min : value > max ? max : value);

/**
 * 计算适配几何。
 *
 * 返回的 `sx/sy/sw/sh` 是**源图坐标系**里那块要被映射到整个目标框的区域。
 * contain / stretch 下 `sw/sh` 就是整幅源图；contain 会额外给出 `padX/padY`。
 *
 * @param {string} fitMode FIT_MODE 之一
 * @param {number} srcWidth
 * @param {number} srcHeight
 * @param {number} dstWidth
 * @param {number} dstHeight
 * @returns {{fitMode:string, scale:number, sx:number, sy:number, sw:number, sh:number,
 *            padX:number, padY:number, innerWidth:number, innerHeight:number,
 *            croppedFraction:number, letterboxFraction:number, scaleX:number, scaleY:number}}
 */
export function fitGeometry(fitMode, srcWidth, srcHeight, dstWidth, dstHeight) {
  if (!(srcWidth > 0) || !(srcHeight > 0)) throw new Error("fitGeometry: 源尺寸必须为正");
  if (!(dstWidth > 0) || !(dstHeight > 0)) throw new Error("fitGeometry: 目标尺寸必须为正");

  const mode = Object.values(FIT_MODE).includes(fitMode) ? fitMode : FIT_MODE.COVER;

  if (mode === FIT_MODE.STRETCH) {
    return Object.freeze({
      fitMode: mode,
      scale: 0,
      scaleX: dstWidth / srcWidth,
      scaleY: dstHeight / srcHeight,
      sx: 0,
      sy: 0,
      sw: srcWidth,
      sh: srcHeight,
      padX: 0,
      padY: 0,
      innerWidth: dstWidth,
      innerHeight: dstHeight,
      croppedFraction: 0,
      letterboxFraction: 1 - (srcWidth * srcHeight) / (dstWidth * dstHeight),
    });
  }

  // 上游用 max()：取较大的缩放比 -> 铺满 -> 另一个方向必然溢出 -> 裁掉。
  const scale = mode === FIT_MODE.COVER
    ? Math.max(dstWidth / srcWidth, dstHeight / srcHeight)
    : Math.min(dstWidth / srcWidth, dstHeight / srcHeight);

  const innerWidth = mode === FIT_MODE.COVER ? dstWidth : srcWidth * scale;
  const innerHeight = mode === FIT_MODE.COVER ? dstHeight : srcHeight * scale;

  // 可见源区域：宽度取 min(源宽, 目标宽/scale)，再居中。
  const sw = Math.min(srcWidth, dstWidth / scale);
  const sh = Math.min(srcHeight, dstHeight / scale);

  return Object.freeze({
    fitMode: mode,
    scale,
    scaleX: scale,
    scaleY: scale,
    sx: (srcWidth - sw) / 2,
    sy: (srcHeight - sh) / 2,
    sw,
    sh,
    padX: Math.floor((dstWidth - innerWidth) / 2),
    padY: Math.floor((dstHeight - innerHeight) / 2),
    innerWidth,
    innerHeight,
    croppedFraction: mode === FIT_MODE.COVER ? 1 - (sw * sh) / (srcWidth * srcHeight) : 0,
    letterboxFraction: mode === FIT_MODE.COVER ? 0 : 1 - (innerWidth * innerHeight) / (dstWidth * dstHeight),
  });
}

/** cover 的便捷入口（上游语义）。 */
export function coverGeometry(srcWidth, srcHeight, dstWidth, dstHeight) {
  return fitGeometry(FIT_MODE.COVER, srcWidth, srcHeight, dstWidth, dstHeight);
}

/** 把任意输入规整成 `{data, width, height}`。 */
export function asRaster(source) {
  if (!source || !source.data || !(source.width > 0) || !(source.height > 0)) {
    throw new Error("cover-resize: source 必须是 { data, width, height }");
  }
  return { data: source.data, width: source.width | 0, height: source.height | 0 };
}

/** 读一个源像素，返回 `[r,g,b,a]`（越界返回全透明黑）。 */
function readPixel(data, width, height, x, y) {
  if (x < 0 || y < 0 || x >= width || y >= height) return [0, 0, 0, 0];
  const p = (y * width + x) * 4;
  return [data[p], data[p + 1], data[p + 2], data[p + 3]];
}

/**
 * 双线性插值。坐标以「像素中心」为采样点：纹素索引 = 连续坐标 - 0.5。
 */
function sampleBilinear(data, width, height, x, y) {
  const fx = x - 0.5;
  const fy = y - 0.5;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const tx = fx - x0;
  const ty = fy - y0;

  const p00 = readPixel(data, width, height, x0, y0);
  const p10 = readPixel(data, width, height, x0 + 1, y0);
  const p01 = readPixel(data, width, height, x0, y0 + 1);
  const p11 = readPixel(data, width, height, x0 + 1, y0 + 1);

  const out = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = p00[c] + (p10[c] - p00[c]) * tx;
    const bottom = p01[c] + (p11[c] - p01[c]) * tx;
    out[c] = top + (bottom - top) * ty;
  }
  return out;
}

/**
 * 面积加权均值。dst 像素 (dx,dy) 覆盖源图上的一个矩形，
 * 对与该矩形相交的每个源像素按**重叠面积**加权。
 * 这是缩小时正确的滤波器，也是浏览器 `quality:'low'` 下最接近的行为。
 */
function sampleArea(data, width, height, rect, dx, dy, dstWidth, dstHeight, stepX, stepY) {
  const x0 = rect.sx + dx * stepX;
  const x1 = x0 + stepX;
  const y0 = rect.sy + dy * stepY;
  const y1 = y0 + stepY;

  const ix0 = Math.floor(x0);
  const ix1 = Math.ceil(x1);
  const iy0 = Math.floor(y0);
  const iy1 = Math.ceil(y1);

  let sumR = 0;
  let sumG = 0;
  let sumB = 0;
  let sumA = 0;
  let sumW = 0;

  for (let sy = iy0; sy < iy1; sy++) {
    const wy = Math.min(y1, sy + 1) - Math.max(y0, sy);
    if (wy <= 0) continue;
    for (let sx = ix0; sx < ix1; sx++) {
      const wx = Math.min(x1, sx + 1) - Math.max(x0, sx);
      if (wx <= 0) continue;
      const w = wx * wy;
      const [r, g, b, a] = readPixel(data, width, height, sx, sy);
      const aw = (a / 255) * w;
      sumR += r * aw;
      sumG += g * aw;
      sumB += b * aw;
      sumA += (a / 255) * w;
      sumW += w;
    }
  }

  if (sumW <= 0) return sampleBilinear(data, width, height, (x0 + x1) / 2, (y0 + y1) / 2);
  // 透明区不参与颜色平均，避免出现「黑边」。
  if (sumA > 1e-9) return [sumR / sumA, sumG / sumA, sumB / sumA, (sumA / sumW) * 255];
  return [sumR / sumW, sumG / sumW, sumB / sumW, 0];
}

/**
 * 把源图的一块矩形重采样到 `dstWidth × dstHeight`。
 *
 * @param {{data:Uint8ClampedArray|Uint8Array, width:number, height:number}} source
 * @param {{sx:number, sy:number, sw:number, sh:number}} rect 源图坐标下的矩形（可含小数）
 * @param {number} dstWidth
 * @param {number} dstHeight
 * @param {{filter?:string}} [options]
 * @returns {{data:Float32Array, width:number, height:number, filter:string}}
 *   `data` 为 RGBA 浮点（长度 dstWidth*dstHeight*4），意图是给采样层用，不做 8bit 截断。
 */
export function resample(source, rect, dstWidth, dstHeight, options = {}) {
  const { data, width, height } = asRaster(source);
  const w = Math.max(1, dstWidth | 0);
  const h = Math.max(1, dstHeight | 0);
  const stepX = rect.sw / w;
  const stepY = rect.sh / h;

  let filter = options.filter || RESAMPLE_FILTER.AUTO;
  if (filter === RESAMPLE_FILTER.AUTO) {
    filter = stepX >= 1 || stepY >= 1 ? RESAMPLE_FILTER.AREA : RESAMPLE_FILTER.BILINEAR;
  }
  if (!Object.values(RESAMPLE_FILTER).includes(filter)) filter = RESAMPLE_FILTER.BILINEAR;

  const out = new Float32Array(w * h * 4);

  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) {
      let rgba;
      if (filter === RESAMPLE_FILTER.NEAREST) {
        rgba = readPixel(data, width, height, Math.floor(rect.sx + (dx + 0.5) * stepX), Math.floor(rect.sy + (dy + 0.5) * stepY));
      } else if (filter === RESAMPLE_FILTER.AREA) {
        rgba = sampleArea(data, width, height, rect, dx, dy, w, h, stepX, stepY);
      } else {
        rgba = sampleBilinear(data, width, height, rect.sx + (dx + 0.5) * stepX, rect.sy + (dy + 0.5) * stepY);
      }
      const p = (dy * w + dx) * 4;
      out[p] = rgba[0];
      out[p + 1] = rgba[1];
      out[p + 2] = rgba[2];
      out[p + 3] = rgba[3];
    }
  }

  return { data: out, width: w, height: h, filter };
}

/**
 * 按适配方式把源图栅格化到目标尺寸。这是上游那段 Canvas 代码的纯函数替代物。
 *
 * @param {object} source `{data, width, height}`
 * @param {{cols:number, rows:number, fitMode?:string, filter?:string, background?:number[]}} options
 * @returns {{data:Float32Array, width:number, height:number, filter:string,
 *            geometry:ReturnType<typeof fitGeometry>}}
 */
export function resizeToGrid(source, options = {}) {
  const raster = asRaster(source);
  const cols = Math.max(1, (options.cols ?? 0) | 0);
  const rows = Math.max(1, (options.rows ?? 0) | 0);
  const fitMode = options.fitMode || FIT_MODE.COVER;
  const filter = options.filter || RESAMPLE_FILTER.AUTO;

  if (fitMode === FIT_MODE.COVER) {
    const geometry = fitGeometry(fitMode, raster.width, raster.height, cols, rows);
    const result = resample(raster, geometry, cols, rows, { filter });
    return { ...result, geometry };
  }

  // contain / stretch：先把整幅源图重采样到 inner 尺寸，再（必要时）居中贴进目标框。
  const geometry = fitGeometry(fitMode, raster.width, raster.height, cols, rows);
  const inner = resample(raster, { sx: 0, sy: 0, sw: raster.width, sh: raster.height }, Math.max(1, Math.round(geometry.innerWidth)), Math.max(1, Math.round(geometry.innerHeight)), { filter });

  if (fitMode === FIT_MODE.STRETCH) {
    return { data: inner.data, width: inner.width, height: inner.height, filter: inner.filter, geometry };
  }

  const bg = Array.isArray(options.background) && options.background.length >= 3
    ? [options.background[0], options.background[1], options.background[2], options.background[3] ?? 255]
    : [0, 0, 0, 0];
  const out = new Float32Array(cols * rows * 4);
  for (let i = 0; i < cols * rows; i++) {
    out[i * 4] = bg[0];
    out[i * 4 + 1] = bg[1];
    out[i * 4 + 2] = bg[2];
    out[i * 4 + 3] = bg[3];
  }
  for (let y = 0; y < inner.height; y++) {
    for (let x = 0; x < inner.width; x++) {
      const tx = x + geometry.padX;
      const ty = y + geometry.padY;
      if (tx < 0 || ty < 0 || tx >= cols || ty >= rows) continue;
      const sp = (y * inner.width + x) * 4;
      const dp = (ty * cols + tx) * 4;
      out[dp] = inner.data[sp];
      out[dp + 1] = inner.data[sp + 1];
      out[dp + 2] = inner.data[sp + 2];
      out[dp + 3] = inner.data[sp + 3];
    }
  }
  return { data: out, width: cols, height: rows, filter: inner.filter, geometry };
}

/** 把浮点栅格转回 8bit Uint8ClampedArray（供只需要整数的下游使用）。 */
export function toByteRaster(raster) {
  const out = new Uint8ClampedArray(raster.data.length);
  for (let i = 0; i < raster.data.length; i++) out[i] = raster.data[i];
  return { data: out, width: raster.width, height: raster.height };
}

/** 模块级默认值（来自 PW_CONFIG，便于诊断时回显）。 */
export const DEFAULT_SAMPLING_OPTIONS = Object.freeze({
  fitMode: FIT_MODE.COVER,
  filter: RESAMPLE_FILTER.AUTO,
  supersample: PW_CONFIG.sampling.supersample,
});
