import { resample } from '../vendor/image-to-pixel/resample.mjs';

export const IMAGE_TO_PIXEL_REVISION = '3dc4cf82c52b7bcdfc3866a88a8c417d83c3a064';
const MAX_PIXELS = 16_777_216;

function dimensions(width, height, name) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 1 || height < 1 || width * height > MAX_PIXELS) {
    throw new RangeError(`${name}尺寸必须为正整数，且不得超过 ${MAX_PIXELS} 像素`);
  }
}

/** Worker-safe, palette-neutral upstream sampling. Source bytes are never mutated. */
export function sampleImageToPixel(source, width, height, { alphaThreshold = 8 } = {}) {
  dimensions(source?.width, source?.height, '输入');
  dimensions(width, height, '输出');
  if (width > 1000 || height > 1000) throw new RangeError('输出宽高不得超过 1000 格');
  if (!(source.data instanceof Uint8Array || source.data instanceof Uint8ClampedArray)
      || source.data.length !== source.width * source.height * 4) {
    throw new TypeError('输入必须为完整 RGBA 字节矩阵');
  }
  if (!Number.isFinite(alphaThreshold) || alphaThreshold < 0 || alphaThreshold > 255) {
    throw new RangeError('透明阈值必须在 0–255 之间');
  }
  const sampled = resample(source, width, height, 'box');
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    const alpha = sampled[offset + 3] * 255;
    if (alpha <= 0 || alpha < alphaThreshold) continue;
    rgba[offset] = Math.round(sampled[offset] * 255);
    rgba[offset + 1] = Math.round(sampled[offset + 1] * 255);
    rgba[offset + 2] = Math.round(sampled[offset + 2] * 255);
    rgba[offset + 3] = Math.max(1, Math.round(alpha));
  }
  return {
    rgba,
    diagnostics: {
      algorithm: 'image-to-pixel', revision: IMAGE_TO_PIXEL_REVISION,
      sampling: 'alpha-weighted-box', width, height, alphaThreshold,
      sampleLimitPerAxis: 16, paletteQuantization: 'libms',
    },
  };
}
