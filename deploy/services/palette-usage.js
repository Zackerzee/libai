import { paletteIdOf } from "./palette-identity.js";

// 统一按 paletteId 统计，显示色号或 RGB 相同但 paletteId 不同的颜色不会混算。
export function getPaletteUsageCounts(grid = []) {
  return new Map([...getPaletteIndex(grid)].map(([paletteId, entry]) => [paletteId, entry.count]));
}

export function getPaletteIndex(grid = []) {
  const index = new Map();
  for (let y = 0; y < grid.length; y++) {
    const row = grid[y] || [];
    for (let x = 0; x < row.length; x++) {
      const color = row[x];
      const paletteId = paletteIdOf(color);
      if (!paletteId) continue;
      const entry = index.get(paletteId) || { paletteId, code: color.code, color, count: 0, cells: [] };
      entry.count += 1;
      entry.cells.push({ x, y });
      index.set(paletteId, entry);
    }
  }
  return index;
}

export function inspectPaletteCell(grid, x, y, counts = getPaletteUsageCounts(grid)) {
  const color = grid?.[y]?.[x] || null;
  const paletteId = paletteIdOf(color);
  return paletteId ? { color, paletteId, count: counts.get(paletteId) || 0 } : null;
}
