/** Conservative, dependency-free preprocessing for the portrait-premium mode. */
export const PORTRAIT_PREPROCESSOR_VERSION = "1.0.0";

const clamp = (v, lo = 0, hi = 255) => Math.min(hi, Math.max(lo, v));
const smoothstep = (a, b, x) => {
  const t = clamp((x - a) / Math.max(0.0001, b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

export function buildSkinMask(pixels, width, height) {
  const mask = new Float32Array(width * height);
  for (let i = 0; i < mask.length; i += 1) {
    const p = i * 4;
    const r = pixels[p]; const g = pixels[p + 1]; const b = pixels[p + 2];
    if (pixels[p + 3] < 24) continue;
    const y = luma(r, g, b);
    const cb = 128 - 0.168736 * r - 0.331264 * g + 0.5 * b;
    const cr = 128 + 0.5 * r - 0.418688 * g - 0.081312 * b;
    const max = Math.max(r, g, b); const min = Math.min(r, g, b);
    const saturation = max ? (max - min) / max : 0;
    const chromaFit = smoothstep(72, 96, cb) * (1 - smoothstep(132, 151, cb))
      * smoothstep(126, 139, cr) * (1 - smoothstep(176, 194, cr));
    const lightFit = smoothstep(22, 58, y) * (1 - smoothstep(242, 255, y));
    const satFit = smoothstep(0.035, 0.11, saturation) * (1 - smoothstep(0.78, 0.98, saturation));
    const warmFit = smoothstep(-5, 8, r - g) * smoothstep(4, 22, r - b);
    mask[i] = clamp(chromaFit * lightFit * (0.45 + 0.35 * satFit + 0.2 * warmFit), 0, 0.98);
  }
  // One soft spatial pass suppresses isolated false positives without a hard face rectangle.
  const softened = new Float32Array(mask);
  for (let y = 1; y + 1 < height; y += 1) for (let x = 1; x + 1 < width; x += 1) {
    let sum = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) sum += mask[(y + dy) * width + x + dx];
    softened[y * width + x] = clamp(mask[y * width + x] * 0.68 + (sum / 9) * 0.32, 0, 1);
  }
  return softened;
}

export function applySkinToneRemap(pixels, skinMask, strength = 35) {
  if (!(strength > 0)) return new Uint8ClampedArray(pixels);
  const out = new Uint8ClampedArray(pixels);
  const amount = clamp(strength, 0, 100) / 100;
  for (let i = 0; i < skinMask.length; i += 1) {
    const weight = skinMask[i] * amount;
    if (weight < 0.01) continue;
    const p = i * 4; const r = out[p]; const g = out[p + 1]; const b = out[p + 2];
    const y = luma(r, g, b);
    // Piecewise tonal targets keep deep features, compress mid-shadow, and enlarge clean highlights.
    const targetY = y < 62 ? mix(y, 66, 0.18) : y < 116 ? mix(y, 132, 0.34) : y < 178 ? mix(y, 190, 0.26) : mix(y, 226, 0.16);
    const scale = targetY / Math.max(1, y);
    out[p] = mix(r, clamp(r * scale + 3), weight);
    out[p + 1] = mix(g, clamp(g * scale + 1), weight);
    out[p + 2] = mix(b, clamp(b * scale - 2), weight);
  }
  return out;
}

export function compressDarkRegions(pixels, strength = 40) {
  if (!(strength > 0)) return new Uint8ClampedArray(pixels);
  const out = new Uint8ClampedArray(pixels); const amount = clamp(strength, 0, 100) / 100;
  for (let p = 0; p < out.length; p += 4) {
    const r = out[p]; const g = out[p + 1]; const b = out[p + 2]; const y = luma(r, g, b);
    if (y >= 92 || out[p + 3] < 24) continue;
    const weight = (1 - smoothstep(35, 92, y)) * amount;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    const target = y < 28 ? 23 : y < 52 ? 43 : y < 72 ? 62 : 79;
    const neutral = chroma < 18;
    out[p] = mix(r, target + (neutral ? 1 : (r - y) * 0.55), weight * 0.45);
    out[p + 1] = mix(g, target + (neutral ? 0 : (g - y) * 0.55), weight * 0.45);
    out[p + 2] = mix(b, target + (neutral ? 1 : (b - y) * 0.55), weight * 0.45);
  }
  return out;
}

export function cleanupNeutralColors(pixels, strength = 65) {
  if (!(strength > 0)) return new Uint8ClampedArray(pixels);
  const out = new Uint8ClampedArray(pixels); const amount = clamp(strength, 0, 100) / 100;
  for (let p = 0; p < out.length; p += 4) {
    const r = out[p]; const g = out[p + 1]; const b = out[p + 2];
    const max = Math.max(r, g, b); const min = Math.min(r, g, b); const sat = max ? (max - min) / max : 0;
    const weight = (1 - smoothstep(0.045, 0.2, sat)) * amount * 0.58;
    if (weight <= 0 || out[p + 3] < 24) continue;
    const y = luma(r, g, b);
    out[p] = mix(r, y, weight); out[p + 1] = mix(g, y, weight); out[p + 2] = mix(b, y, weight);
  }
  return out;
}

export function enhanceWarmReds(pixels, skinMask, strength = 40) {
  if (!(strength > 0)) return new Uint8ClampedArray(pixels);
  const out = new Uint8ClampedArray(pixels); const amount = clamp(strength, 0, 100) / 100;
  for (let i = 0; i < out.length / 4; i += 1) {
    const p = i * 4; const r = out[p]; const g = out[p + 1]; const b = out[p + 2];
    const redFit = smoothstep(12, 48, r - Math.max(g, b)) * smoothstep(55, 130, r);
    const weight = redFit * amount * (1 - (skinMask?.[i] || 0) * 0.88);
    out[p] = clamp(r + 15 * weight); out[p + 1] = clamp(g - 5 * weight); out[p + 2] = clamp(b - 3 * weight);
  }
  return out;
}

export function preprocessPortrait(pixels, width, height, options = {}) {
  const skinMask = buildSkinMask(pixels, width, height);
  let output = applySkinToneRemap(pixels, skinMask, options.skinBrightening ?? 35);
  output = compressDarkRegions(output, options.shadowCompression ?? 40);
  output = cleanupNeutralColors(output, options.neutralCleanup ?? 65);
  output = enhanceWarmReds(output, skinMask, options.redEnhancement ?? 40);
  return { pixels: output, skinMask };
}

const browserApi = { PORTRAIT_PREPROCESSOR_VERSION, buildSkinMask, applySkinToneRemap, compressDarkRegions, cleanupNeutralColors, enhanceWarmReds, preprocessPortrait };
if (typeof window !== "undefined") window.LibmsPortraitPreprocessor = browserApi;
