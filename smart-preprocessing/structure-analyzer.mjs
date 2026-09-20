import { rgbToLab } from "./palette-engine.mjs";

export const STRUCTURE_ANALYZER_VERSION = "1.0.0";
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));
const luminanceAt = (pixels, i) => 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2];

export function buildEdgeImportanceMap(pixels, width, height) {
  const map = new Float32Array(width * height);
  const lum = new Float32Array(width * height);
  for (let i = 0; i < lum.length; i += 1) lum[i] = luminanceAt(pixels, i * 4);
  for (let y = 1; y + 1 < height; y += 1) for (let x = 1; x + 1 < width; x += 1) {
    const i = y * width + x;
    const gx = -lum[i - width - 1] + lum[i - width + 1] - 2 * lum[i - 1] + 2 * lum[i + 1] - lum[i + width - 1] + lum[i + width + 1];
    const gy = -lum[i - width - 1] - 2 * lum[i - width] - lum[i - width + 1] + lum[i + width - 1] + 2 * lum[i + width] + lum[i + width + 1];
    const left = rgbToLab([pixels[(i - 1) * 4], pixels[(i - 1) * 4 + 1], pixels[(i - 1) * 4 + 2]]);
    const right = rgbToLab([pixels[(i + 1) * 4], pixels[(i + 1) * 4 + 1], pixels[(i + 1) * 4 + 2]]);
    const labGradient = Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
    map[i] = clamp(Math.hypot(gx, gy) / 480 * 0.72 + labGradient / 90 * 0.28);
  }
  return map;
}

export function buildDetailProtectionMask(edgeMap, pixels, width, height, options = {}) {
  const mask = new Uint8Array(width * height);
  const threshold = options.edgeThreshold ?? 0.34;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x; const p = i * 4;
    if (pixels[p + 3] < 24) continue;
    const y0 = luminanceAt(pixels, p); let lo = 255; let hi = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const value = luminanceAt(pixels, (ny * width + nx) * 4); lo = Math.min(lo, value); hi = Math.max(hi, value);
    }
    const extremum = (y0 <= lo - 18 || y0 >= hi + 18) && hi - lo >= 22;
    mask[i] = edgeMap[i] >= threshold || extremum || y0 <= 30 || y0 >= 246 ? 1 : 0;
  }
  return mask;
}

const browserApi = { STRUCTURE_ANALYZER_VERSION, buildEdgeImportanceMap, buildDetailProtectionMask };
if (typeof window !== "undefined") window.LibmsStructureAnalyzer = browserApi;
