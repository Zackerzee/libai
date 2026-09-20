import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";

export const PIXEL_READY_STYLIZER_VERSION = "1.0.0";
export const STYLIZATION_MODES = Object.freeze(["none", "portrait", "pet", "illustration", "flat", "anime", "pixel_ready"]);
export const DEFAULT_STYLIZATION_CONFIG = Object.freeze({
  mode: "pixel_ready", strength: 35, shadowSimplification: 55, backgroundMode: "simplify",
  detailLevel: "high", faceProtection: true, edgeProtection: true, regionMergeStrength: 40,
});
const clamp = (v, a = 0, b = 255) => Math.min(b, Math.max(a, v));
const luma = (r, g, b) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

function gridAwareStrength(config, width, height) {
  const target = Math.max(config.targetGridWidth || width, config.targetGridHeight || height);
  const sizeBoost = target <= 52 ? 1.28 : target <= 78 ? 1.14 : target <= 104 ? 1 : 0.82;
  return clamp((config.strength ?? 35) / 100 * sizeBoost, 0, 1);
}

export function calculatePixelSurvivalMap(pixels, width, height, targetWidth, targetHeight) {
  const result = new Float32Array(width * height);
  const footprint = Math.max(width / Math.max(1, targetWidth), height / Math.max(1, targetHeight));
  for (let y = 1; y + 1 < height; y += 1) for (let x = 1; x + 1 < width; x += 1) {
    const i = y * width + x; const p = i * 4; const center = luma(pixels[p], pixels[p + 1], pixels[p + 2]);
    let contrast = 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = ((y + dy) * width + x + dx) * 4;
      contrast = Math.max(contrast, Math.abs(center - luma(pixels[q], pixels[q + 1], pixels[q + 2])));
    }
    result[i] = clamp(contrast / 72 * Math.min(1.5, footprint / 2), 0, 1);
  }
  return result;
}

export function stylizePixelReady(input, width, height, options = {}) {
  const config = { ...DEFAULT_STYLIZATION_CONFIG, ...options };
  if (config.mode === "none" || config.strength <= 0) return { pixels: new Uint8ClampedArray(input), survivalMap: new Float32Array(width * height), config };
  const strength = gridAwareStrength(config, width, height);
  const survivalMap = calculatePixelSurvivalMap(input, width, height, config.targetGridWidth || width, config.targetGridHeight || height);
  const out = new Uint8ClampedArray(input);
  const radius = strength > 0.58 ? 2 : 1;
  const mergeThreshold = 4 + (config.regionMergeStrength / 100) * 12;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const i = y * width + x; const p = i * 4;
    if (input[p + 3] < 24) continue;
    const center = [input[p], input[p + 1], input[p + 2]]; const centerLab = rgbToLab(center);
    let sums = [0, 0, 0]; let weightSum = 0;
    for (let dy = -radius; dy <= radius; dy += 1) for (let dx = -radius; dx <= radius; dx += 1) {
      const nx = x + dx; const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const q = (ny * width + nx) * 4; const rgb = [input[q], input[q + 1], input[q + 2]];
      const distance = deltaE2000(centerLab, rgbToLab(rgb));
      if (distance > mergeThreshold + survivalMap[i] * 12) continue;
      const spatial = 1 / (1 + Math.abs(dx) + Math.abs(dy)); const weight = spatial * (1 - survivalMap[i] * 0.72);
      for (let c = 0; c < 3; c += 1) sums[c] += rgb[c] * weight;
      weightSum += weight;
    }
    if (!weightSum) continue;
    const smoothed = sums.map((v) => v / weightSum);
    const keep = config.edgeProtection ? survivalMap[i] : 0;
    let rgb = center.map((v, c) => v * keep + smoothed[c] * (1 - keep));
    const y0 = luma(...rgb); const shadow = 1 - clamp(y0 / 105, 0, 1);
    const levels = config.mode === "flat" ? 4 : config.mode === "anime" ? 6 : 8;
    const step = 255 / (levels - 1); const quantizedY = Math.round(y0 / step) * step;
    const shadowAmount = (config.shadowSimplification / 100) * strength * shadow * (1 - keep);
    const targetY = y0 * (1 - shadowAmount) + quantizedY * shadowAmount;
    const scale = targetY / Math.max(1, y0);
    rgb = rgb.map((v) => clamp(v * scale));
    for (let c = 0; c < 3; c += 1) out[p + c] = center[c] * keep + rgb[c] * (1 - keep);
  }
  return { pixels: out, survivalMap, config };
}

export class LocalStylizationProvider {
  stylize(image, mode = "pixel_ready", strength = 35, targetSize = {}, options = {}) {
    return stylizePixelReady(image.pixels, image.width, image.height, { ...options, mode, strength, targetGridWidth: targetSize.width, targetGridHeight: targetSize.height });
  }
}

export function buildStylizationPrompt(options = {}) {
  return `Pixel-art-ready intermediate; preserve ${options.subjectType || "subject"} identity and silhouette; simplify texture, gradients and random shadows; protect recognizable features; target ${options.targetGridWidth || "auto"}x${options.targetGridHeight || "auto"}; do not create a pixel grid or bead codes.`;
}

const api = { PIXEL_READY_STYLIZER_VERSION, STYLIZATION_MODES, DEFAULT_STYLIZATION_CONFIG, calculatePixelSurvivalMap, stylizePixelReady, LocalStylizationProvider, buildStylizationPrompt };
if (typeof window !== "undefined") window.LibmsPixelReadyStylizer = api;
