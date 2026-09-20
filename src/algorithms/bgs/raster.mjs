/**
 * BGS algorithm module — pure raster operations (the host boundary).
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0).
 * Upstream equivalent: `renderReferenceRaster()` at src/app.js:1435–1520, which is
 * the ONLY Canvas-dependent stage of the conversion pipeline
 * (see ALGORITHM_AUDIT.md §G).
 *
 * Modified for libms-studio: reimplemented as pure typed-array maths so the module
 * runs identically in a browser, in a Web Worker, and under `node --test` with no
 * DOM. The caller is responsible for producing the first `ImageData` (via `<img>` +
 * Canvas, `createImageBitmap` + `OffscreenCanvas`, or `sharp`/`node-canvas` on a
 * server); everything after that is handled here.
 *
 * Two documented behaviour differences from upstream:
 *
 *  - **Correct alpha handling.** Canvas `drawImage` with smoothing blends in
 *    premultiplied space. The box filter below also works in premultiplied space, so
 *    translucent edges do not pick up dark fringes. Upstream relied on the browser
 *    to do this correctly.
 *  - **Standard contain/cover geometry.** Upstream computed an intermediate raster
 *    whose aspect matched the target and centered the image inside it; this module
 *    computes the destination rect directly. The visible result is the same (the
 *    padding becomes blank cells) but the maths is auditable.
 */

import { BGS_CONFIG } from './config.mjs';
import { clamp } from './color-space.mjs';

/** @typedef {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} Raster */

/** Validate and normalize an ImageData-like object. */
export function asRaster(input, label = 'imageData') {
  if (!input || !input.data || !input.width || !input.height) {
    throw new Error(`bgs: ${label} must be {data, width, height}`);
  }
  const width = Math.max(1, Math.round(Number(input.width)));
  const height = Math.max(1, Math.round(Number(input.height)));
  const expected = width * height * 4;
  if (input.data.length < expected) {
    throw new Error(`bgs: ${label}.data is too short (${input.data.length} < ${expected})`);
  }
  const data = input.data instanceof Uint8ClampedArray
    ? input.data
    : new Uint8ClampedArray(input.data.buffer ? input.data.buffer.slice(input.data.byteOffset, input.data.byteOffset + expected) : input.data);
  return { data, width, height };
}

export function createRaster(width, height) {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}

/* ─────────────────────────────────────────────────────────────
 * 归一化裁剪矩形（upstream app.js:161–170）
 * ───────────────────────────────────────────────────────────── */

export function normalizeCrop(crop) {
  const x = clamp(crop?.x ?? 0, 0, 1);
  const y = clamp(crop?.y ?? 0, 0, 1);
  const w = clamp(crop?.w ?? 1, 0.01, 1 - x);
  const h = clamp(crop?.h ?? 1, 0.01, 1 - y);
  return { x, y, w, h };
}

export function cropSourceRect(width, height, crop) {
  const value = normalizeCrop(crop);
  return { x: value.x * width, y: value.y * height, w: value.w * width, h: value.h * height };
}

/**
 * Crop to a rect in source pixels. The output keeps the source alpha; it is NOT
 * composited over white here (upstream's `whiteMode` handles that later).
 */
export function cropRaster(source, rect) {
  const src = asRaster(source);
  const x0 = clamp(Math.round(rect.x), 0, src.width - 1);
  const y0 = clamp(Math.round(rect.y), 0, src.height - 1);
  const w = clamp(Math.round(rect.w), 1, src.width - x0);
  const h = clamp(Math.round(rect.h), 1, src.height - y0);
  const out = createRaster(w, h);
  for (let y = 0; y < h; y++) {
    const srcStart = ((y0 + y) * src.width + x0) * 4;
    out.data.set(src.data.subarray(srcStart, srcStart + w * 4), y * w * 4);
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
 * 几何变换（upstream app.js:1445–1453）
 * ───────────────────────────────────────────────────────────── */

export const TRANSFORM = Object.freeze({ ROTATE_CW: 'rotate', MIRROR_H: 'mirrorH', MIRROR_V: 'mirrorV' });

export function rotateRasterCW(source) {
  const src = asRaster(source);
  const out = createRaster(src.height, src.width);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sx = x * 4 + y * src.width * 4;
      const dx = (src.height - 1 - y);
      const dy = x;
      const target = (dy * out.width + dx) * 4;
      out.data[target] = src.data[sx];
      out.data[target + 1] = src.data[sx + 1];
      out.data[target + 2] = src.data[sx + 2];
      out.data[target + 3] = src.data[sx + 3];
    }
  }
  return out;
}

export function mirrorRaster(source, axis = 'h') {
  const src = asRaster(source);
  const out = createRaster(src.width, src.height);
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const sx = (x + y * src.width) * 4;
      const dx = axis === 'h' ? src.width - 1 - x : x;
      const dy = axis === 'h' ? y : src.height - 1 - y;
      const target = (dy * out.width + dx) * 4;
      out.data[target] = src.data[sx];
      out.data[target + 1] = src.data[sx + 1];
      out.data[target + 2] = src.data[sx + 2];
      out.data[target + 3] = src.data[sx + 3];
    }
  }
  return out;
}

/** Apply a transform chain in order. `['rotate','mirrorH']` = rotate then mirror. */
export function applyTransforms(source, transforms = []) {
  let current = asRaster(source);
  for (const type of transforms) {
    if (type === TRANSFORM.ROTATE_CW || type === 'rotate') current = rotateRasterCW(current);
    else if (type === TRANSFORM.MIRROR_H || type === 'mirrorH') current = mirrorRaster(current, 'h');
    else if (type === TRANSFORM.MIRROR_V || type === 'mirrorV') current = mirrorRaster(current, 'v');
  }
  return current;
}

/* ─────────────────────────────────────────────────────────────
 * 重采样
 * ───────────────────────────────────────────────────────────── */

/**
 * Resample to `dstWidth × dstHeight`.
 *
 * Downscaling uses an exact **area-average (box) filter** in premultiplied alpha
 * space — the same family of result Canvas gives with
 * `imageSmoothingQuality='high'`, and the correct choice when the target grid is
 * much coarser than the source (which is the normal case here).
 *
 * Upscaling uses bilinear interpolation.
 */
export function resizeRaster(source, dstWidth, dstHeight) {
  const src = asRaster(source);
  const dw = Math.max(1, Math.round(dstWidth));
  const dh = Math.max(1, Math.round(dstHeight));
  if (dw === src.width && dh === src.height) return src;

  const out = createRaster(dw, dh);
  const downScale = dw < src.width || dh < src.height;

  if (downScale) {
    const scaleX = src.width / dw;
    const scaleY = src.height / dh;
    for (let dy = 0; dy < dh; dy++) {
      const sy0 = dy * scaleY;
      const sy1 = (dy + 1) * scaleY;
      const iy0 = Math.max(0, Math.floor(sy0));
      const iy1 = Math.min(src.height, Math.ceil(sy1));
      for (let dx = 0; dx < dw; dx++) {
        const sx0 = dx * scaleX;
        const sx1 = (dx + 1) * scaleX;
        const ix0 = Math.max(0, Math.floor(sx0));
        const ix1 = Math.min(src.width, Math.ceil(sx1));

        let rAcc = 0;
        let gAcc = 0;
        let bAcc = 0;
        let aAcc = 0;
        let weight = 0;

        for (let sy = iy0; sy < iy1; sy++) {
          const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
          if (wy <= 0) continue;
          for (let sx = ix0; sx < ix1; sx++) {
            const wx = Math.min(sx + 1, sx1) - Math.max(sx, sx0);
            if (wx <= 0) continue;
            const w = wx * wy;
            const p = (sx + sy * src.width) * 4;
            const alpha = src.data[p + 3] / 255;
            rAcc += src.data[p] * alpha * w;
            gAcc += src.data[p + 1] * alpha * w;
            bAcc += src.data[p + 2] * alpha * w;
            aAcc += alpha * w;
            weight += w;
          }
        }

        const target = (dx + dy * dw) * 4;
        if (weight > 0 && aAcc > 0) {
          out.data[target] = clamp(Math.round(rAcc / aAcc), 0, 255);
          out.data[target + 1] = clamp(Math.round(gAcc / aAcc), 0, 255);
          out.data[target + 2] = clamp(Math.round(bAcc / aAcc), 0, 255);
          out.data[target + 3] = clamp(Math.round((aAcc / weight) * 255), 0, 255);
        }
      }
    }
    return out;
  }

  // Upscale: bilinear in premultiplied space.
  const scaleX = src.width / dw;
  const scaleY = src.height / dh;
  for (let dy = 0; dy < dh; dy++) {
    const fy = (dy + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.floor(fy));
    const y1 = Math.min(src.height - 1, y0 + 1);
    const ty = clamp(fy - y0, 0, 1);
    for (let dx = 0; dx < dw; dx++) {
      const fx = (dx + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.floor(fx));
      const x1 = Math.min(src.width - 1, x0 + 1);
      const tx = clamp(fx - x0, 0, 1);

      const sample = (x, y) => {
        const p = (x + y * src.width) * 4;
        const alpha = src.data[p + 3] / 255;
        return [src.data[p] * alpha, src.data[p + 1] * alpha, src.data[p + 2] * alpha, alpha];
      };
      const p00 = sample(x0, y0);
      const p10 = sample(x1, y0);
      const p01 = sample(x0, y1);
      const p11 = sample(x1, y1);

      const mix = (i) => {
        const top = p00[i] * (1 - tx) + p10[i] * tx;
        const bottom = p01[i] * (1 - tx) + p11[i] * tx;
        return top * (1 - ty) + bottom * ty;
      };
      const alpha = mix(3);
      const target = (dx + dy * dw) * 4;
      if (alpha > 0) {
        out.data[target] = clamp(Math.round(mix(0) / alpha), 0, 255);
        out.data[target + 1] = clamp(Math.round(mix(1) / alpha), 0, 255);
        out.data[target + 2] = clamp(Math.round(mix(2) / alpha), 0, 255);
        out.data[target + 3] = clamp(Math.round(alpha * 255), 0, 255);
      }
    }
  }
  return out;
}

/**
 * Place `source` inside a `dstWidth × dstHeight` raster.
 *
 * @param {'contain'|'cover'|'stretch'} fitMode
 *  - `contain` keeps all content, pads the remainder with transparent cells
 *    (which the grid stage turns into blank beads). Reports `letterboxFraction`.
 *  - `cover` fills the target by cropping the source. Reports `cropFraction`.
 *  - `stretch` is provided for completeness but is NOT used by default: upstream
 *    states "Non-uniform scaling is never used" (docs/algorithm.md).
 * @param {boolean} smooth `false` disables resampling (upstream's `pixel` mode).
 */
export function fitRaster(source, dstWidth, dstHeight, { fitMode = 'contain', smooth = true } = {}) {
  const src = asRaster(source);
  const dw = Math.max(1, Math.round(dstWidth));
  const dh = Math.max(1, Math.round(dstHeight));

  if (fitMode === 'stretch') {
    return {
      raster: smooth ? resizeRaster(src, dw, dh) : nearestRaster(src, dw, dh),
      placement: { dx: 0, dy: 0, dw, dh, sourceRect: { x: 0, y: 0, w: src.width, h: src.height } },
      letterboxFraction: 0,
      cropFraction: 0,
    };
  }

  const scale = fitMode === 'cover'
    ? Math.max(dw / src.width, dh / src.height)
    : Math.min(dw / src.width, dh / src.height);

  const drawW = Math.max(1, Math.round(src.width * scale));
  const drawH = Math.max(1, Math.round(src.height * scale));

  if (fitMode === 'cover') {
    const sourceW = Math.min(src.width, dw / scale);
    const sourceH = Math.min(src.height, dh / scale);
    const sx = (src.width - sourceW) / 2;
    const sy = (src.height - sourceH) / 2;
    const cropped = cropRaster(src, { x: sx, y: sy, w: sourceW, h: sourceH });
    const raster = smooth ? resizeRaster(cropped, dw, dh) : nearestRaster(cropped, dw, dh);
    return {
      raster,
      placement: { dx: 0, dy: 0, dw, dh, sourceRect: { x: sx, y: sy, w: sourceW, h: sourceH } },
      letterboxFraction: 0,
      cropFraction: 1 - (sourceW * sourceH) / (src.width * src.height),
    };
  }

  const scaled = smooth ? resizeRaster(src, drawW, drawH) : nearestRaster(src, drawW, drawH);
  const out = createRaster(dw, dh);
  const dx = Math.floor((dw - scaled.width) / 2);
  const dy = Math.floor((dh - scaled.height) / 2);
  for (let y = 0; y < scaled.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dh) continue;
    const rowStart = y * scaled.width * 4;
    out.data.set(scaled.data.subarray(rowStart, rowStart + scaled.width * 4), (ty * dw + dx) * 4);
  }

  return {
    raster: out,
    placement: { dx, dy, dw: scaled.width, dh: scaled.height, sourceRect: { x: 0, y: 0, w: src.width, h: src.height } },
    letterboxFraction: 1 - (scaled.width * scaled.height) / (dw * dh),
    cropFraction: 0,
  };
}

/** Nearest-neighbour resample — upstream uses this for `processMode === 'pixel'`. */
export function nearestRaster(source, dstWidth, dstHeight) {
  const src = asRaster(source);
  const dw = Math.max(1, Math.round(dstWidth));
  const dh = Math.max(1, Math.round(dstHeight));
  const out = createRaster(dw, dh);
  for (let dy = 0; dy < dh; dy++) {
    const sy = Math.min(src.height - 1, Math.floor((dy + 0.5) * src.height / dh));
    for (let dx = 0; dx < dw; dx++) {
      const sx = Math.min(src.width - 1, Math.floor((dx + 0.5) * src.width / dw));
      const p = (sx + sy * src.width) * 4;
      const t = (dx + dy * dw) * 4;
      out.data[t] = src.data[p];
      out.data[t + 1] = src.data[p + 1];
      out.data[t + 2] = src.data[p + 2];
      out.data[t + 3] = src.data[p + 3];
    }
  }
  return out;
}

/**
 * Downscale so the raster fits inside a pixel budget, preserving aspect.
 * Upstream equivalent: `maxRasterPixels` (src/app.js:1455) + `DEVICE_LIMITS`
 * (src/app.js:124–128), which read `navigator` — replaced by an explicit option so
 * the module stays host-neutral.
 */
export function applyPixelBudget(source, maxPixels = BGS_CONFIG.budget.defaultMaxRasterPixels) {
  const src = asRaster(source);
  const budget = Math.max(1, Math.round(maxPixels));
  const total = src.width * src.height;
  if (total <= budget) return { raster: src, scale: 1, downscaled: false };
  const scale = Math.sqrt(budget / total);
  return {
    raster: resizeRaster(src, Math.max(1, Math.round(src.width * scale)), Math.max(1, Math.round(src.height * scale))),
    scale,
    downscaled: true,
  };
}

/**
 * Full source → conversion-raster preparation. Replaces upstream
 * `renderReferenceRaster({contentOnly:true})` (src/app.js:1456–1462).
 *
 * Order matters and matches upstream: **crop → transforms → fit → budget**.
 */
export function prepareConversionRaster(source, {
  crop = { x: 0, y: 0, w: 1, h: 1 },
  transforms = [],
  fitMode = 'contain',
  targetWidth,
  targetHeight,
  pixelBudget = BGS_CONFIG.budget.defaultMaxRasterPixels,
  smooth = true,
} = {}) {
  const src = asRaster(source);
  const rect = cropSourceRect(src.width, src.height, crop);
  let current = cropRaster(src, rect);
  const croppedSize = { width: current.width, height: current.height };

  if (transforms.length) current = applyTransforms(current, transforms);

  const target = (fitMode === 'stretch' || !Number.isFinite(targetWidth) || !Number.isFinite(targetHeight))
    ? { raster: current, letterboxFraction: 0, cropFraction: 0, placement: null }
    : fitRaster(current, targetWidth, targetHeight, { fitMode, smooth });

  const budgeted = applyPixelBudget(target.raster, pixelBudget);

  return {
    raster: budgeted.raster,
    sourceSize: { width: src.width, height: src.height },
    croppedSize,
    transformedSize: { width: current.width, height: current.height },
    targetSize: Number.isFinite(targetWidth) ? { width: targetWidth, height: targetHeight } : null,
    placement: target.placement,
    letterboxFraction: target.letterboxFraction ?? 0,
    cropFraction: target.cropFraction ?? 0,
    downscaledByBudget: budgeted.downscaled,
    budgetScale: budgeted.scale,
  };
}

export default {
  asRaster,
  createRaster,
  normalizeCrop,
  cropSourceRect,
  cropRaster,
  applyTransforms,
  rotateRasterCW,
  mirrorRaster,
  resizeRaster,
  nearestRaster,
  fitRaster,
  applyPixelBudget,
  prepareConversionRaster,
};
