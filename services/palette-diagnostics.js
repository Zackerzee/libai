import { rgbToLab, deltaE2000 } from "../smart-preprocessing/palette-engine.mjs";
import { paletteIdOf } from "./palette-identity.js";

export function findSimilarPaletteColors(palette, paletteId, { limit = 6, excludeSelf = true } = {}) {
  const source = palette.find((color) => paletteIdOf(color) === paletteId);
  if (!source?.rgb) return [];
  const sourceLab = rgbToLab(source.rgb);
  return palette
    .filter((color) => color?.rgb && (!excludeSelf || paletteIdOf(color) !== paletteId))
    .map((color, order) => ({ ...color, paletteId: paletteIdOf(color), distance: deltaE2000(sourceLab, rgbToLab(color.rgb)), order }))
    .sort((a, b) => a.distance - b.distance || a.order - b.order || a.paletteId.localeCompare(b.paletteId))
    .slice(0, Math.max(0, limit))
    .map(({ order, ...color }) => color);
}

export function detectRarePaletteColors(index, { maxCount = 3 } = {}) {
  const threshold = Math.max(0, Math.floor(Number(maxCount) || 0));
  return [...index.values()]
    .filter((entry) => entry.count <= threshold)
    .map((entry) => ({ paletteId: entry.paletteId, code: entry.code, count: entry.count, cells: entry.cells.map((cell) => ({ ...cell })) }))
    .sort((a, b) => a.count - b.count || a.code.localeCompare(b.code) || a.paletteId.localeCompare(b.paletteId));
}
