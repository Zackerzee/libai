import { rgbToLab, deltaE2000 } from "../smart-preprocessing/palette-engine.mjs";
import { paletteIdOf } from "./palette-identity.js";

const hueDistance = (a, b) => {
  const delta = Math.abs(a - b) % 360;
  return Math.min(delta, 360 - delta);
};

export function createPaletteMetricCache(palette = []) {
  const metrics = new Map();
  palette.forEach((color, order) => {
    if (!color?.rgb) return;
    const lab = rgbToLab(color.rgb);
    const [lightness,a,b]=lab;
    const chroma = Math.hypot(a, b);
    const hue = (Math.atan2(b, a) * 180 / Math.PI + 360) % 360;
    metrics.set(paletteIdOf(color), { paletteId: paletteIdOf(color), color, lab, lightness, chroma, hue, order });
  });
  return metrics;
}

function candidates(cache, base, direction) {
  const grayscale = base.chroma < 10;
  return [...cache.values()].filter((entry) => entry.paletteId !== base.paletteId && (direction < 0 ? entry.lightness < base.lightness : entry.lightness > base.lightness)).map((entry) => {
    const hue = hueDistance(base.hue, entry.hue);
    const chromaDelta = Math.abs(base.chroma - entry.chroma);
    const huePenalty = grayscale ? entry.chroma * 2.8 : hue * 1.7;
    const extremeHuePenalty = !grayscale && hue > 70 ? 1000 + hue * 4 : 0;
    const score = huePenalty + extremeHuePenalty + chromaDelta * 0.55 + deltaE2000(base.lab, entry.lab) * 0.45;
    return { ...entry, score };
  }).sort((a, b) => a.score - b.score || a.order - b.order || a.paletteId.localeCompare(b.paletteId));
}

function pickLevels(list, count) {
  if (!count || !list.length) return [];
  return list.slice(0, count).sort((a, b) => a.lightness - b.lightness || a.score - b.score || a.order - b.order);
}

export function buildRamp(palette, basePaletteId, { size = 5, cache = null } = {}) {
  const metrics = cache || createPaletteMetricCache(palette);
  const base = metrics.get(basePaletteId);
  if (!base) return [];
  const requested = [3, 5, 7].includes(Number(size)) ? Number(size) : 5;
  const half = Math.floor(requested / 2);
  const darker = pickLevels(candidates(metrics, base, -1), half);
  const lighter = pickLevels(candidates(metrics, base, 1), half);
  return [...darker, base, ...lighter]
    .sort((a, b) => a.lightness - b.lightness || a.order - b.order)
    .map((entry) => ({ ...entry.color, paletteId: entry.paletteId, lightness: entry.lightness }));
}

export const rankDarkerCandidates = (palette, basePaletteId) => {
  const cache = createPaletteMetricCache(palette), base = cache.get(basePaletteId);
  return base ? candidates(cache, base, -1).map((entry) => ({ ...entry.color, paletteId: entry.paletteId, lightness: entry.lightness })) : [];
};

export const rankLighterCandidates = (palette, basePaletteId) => {
  const cache = createPaletteMetricCache(palette), base = cache.get(basePaletteId);
  return base ? candidates(cache, base, 1).map((entry) => ({ ...entry.color, paletteId: entry.paletteId, lightness: entry.lightness })) : [];
};

export function stepRamp(rampPaletteIds, paletteId, direction) {
  const index = rampPaletteIds.indexOf(paletteId);
  if (index < 0) return paletteId;
  const next = Math.max(0, Math.min(rampPaletteIds.length - 1, index + (direction === "lighter" ? 1 : -1)));
  return rampPaletteIds[next];
}

export const stepDarker = (rampPaletteIds, paletteId) => stepRamp(rampPaletteIds, paletteId, "darker");
export const stepLighter = (rampPaletteIds, paletteId) => stepRamp(rampPaletteIds, paletteId, "lighter");
