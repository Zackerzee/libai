// Extracted unchanged from lib/core/cpu/stages.js, resample only.
// Tezumie/Image-to-Pixel, 3dc4cf82c52b7bcdfc3866a88a8c417d83c3a064. MIT; see LICENSE.
/**
 * Resample to w × h. 'box' averages up to 16×16 evenly spaced source texels per output pixel
 * (alpha-weighted); 'nearest' takes the centre texel. Integer maths, identical on the GPU.
 */
export function resample(src, w, h, mode = 'box', crop = null) {
  const ox = crop ? crop.x : 0, oy = crop ? crop.y : 0;
  const sw = crop ? crop.w : src.width, sh = crop ? crop.h : src.height, d = src.data, stride = src.width;
  const out = new Float32Array(w * h * 4);
  const nx = mode === 'nearest' ? 1 : Math.min(16, Math.max(1, Math.ceil(sw / w)));
  const ny = mode === 'nearest' ? 1 : Math.min(16, Math.max(1, Math.ceil(sh / h)));
  const xs = new Int32Array(w * nx), ys = new Int32Array(h * ny);
  for (let x = 0; x < w; x++) for (let i = 0; i < nx; i++) xs[x * nx + i] = ox + Math.min(sw - 1, Math.floor(((2 * (x * nx + i) + 1) * sw) / (2 * w * nx)));
  for (let y = 0; y < h; y++) for (let j = 0; j < ny; j++) ys[y * ny + j] = oy + Math.min(sh - 1, Math.floor(((2 * (y * ny + j) + 1) * sh) / (2 * h * ny)));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ny; j++) {
        const row = ys[y * ny + j] * stride;
        for (let i = 0; i < nx; i++) {
          const o = (row + xs[x * nx + i]) * 4;
          const al = d[o + 3] / 255;
          r += d[o] / 255 * al; g += d[o + 1] / 255 * al; b += d[o + 2] / 255 * al; a += al;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) { out[o] = r / a; out[o + 1] = g / a; out[o + 2] = b / a; }
      out[o + 3] = a / (nx * ny);
    }
  }
  return out;
}
