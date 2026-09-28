import { paletteIdOf } from "./palette-identity.js";

// 统一按 paletteId 统计，显示色号或 RGB 相同但 paletteId 不同的颜色不会混算。
export function getPaletteUsageCounts(grid = []) {
  const counts = new Map();
  for (const row of grid) {
    for (const color of row || []) {
      const paletteId = paletteIdOf(color);
      if (paletteId) counts.set(paletteId, (counts.get(paletteId) || 0) + 1);
    }
  }
  return counts;
}

export function inspectPaletteCell(grid, x, y, counts = getPaletteUsageCounts(grid)) {
  const color = grid?.[y]?.[x] || null;
  const paletteId = paletteIdOf(color);
  return paletteId ? { color, paletteId, count: counts.get(paletteId) || 0 } : null;
}
