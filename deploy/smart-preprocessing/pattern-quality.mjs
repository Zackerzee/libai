import { analyzeComponents } from "./pattern-optimizer.mjs";

const luma = (rgb) => 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
export function calculatePatternQualityMetrics(grid, options = {}) {
  const components = analyzeComponents(grid); const sizes = components.map((item) => item.size);
  const colors = new Map(); let neutralColorCount = 0; let darkColorCount = 0; let skinToneLevelCount = 0;
  for (const row of grid || []) for (const color of row || []) if (color && !colors.has(color.code || color.hex)) {
    colors.set(color.code || color.hex, color); const rgb = color.rgb || [0, 0, 0];
    if (Math.max(...rgb) - Math.min(...rgb) < 22) neutralColorCount += 1;
    if (luma(rgb) < 78) darkColorCount += 1;
    if (rgb[0] > rgb[1] && rgb[1] > rgb[2] && rgb[0] - rgb[2] > 18) skinToneLevelCount += 1;
  }
  const histogram = {};
  for (const size of sizes) histogram[size <= 3 ? String(size) : size <= 8 ? "4-8" : "9+"] = (histogram[size <= 3 ? String(size) : size <= 8 ? "4-8" : "9+"] || 0) + 1;
  const protectedMask = options.protectedMask; const baseline = options.baseline; let protectedTotal = 0; let protectedKept = 0; let changed = 0;
  for (let y = 0; y < grid.length; y += 1) for (let x = 0; x < (grid[y]?.length || 0); x += 1) {
    const i = y * grid[y].length + x;
    if (protectedMask?.[i]) { protectedTotal += 1; if (!baseline || (baseline[y]?.[x]?.code || "") === (grid[y]?.[x]?.code || "")) protectedKept += 1; }
    if (baseline && (baseline[y]?.[x]?.code || "") !== (grid[y]?.[x]?.code || "")) changed += 1;
  }
  return { usedColorCount: colors.size, singletonComponentCount: sizes.filter((n) => n === 1).length, componentSizeHistogram: histogram, averageComponentSize: sizes.length ? sizes.reduce((a, b) => a + b, 0) / sizes.length : 0, neutralColorCount, darkColorCount, skinToneLevelCount, edgePreservationRatio: protectedTotal ? protectedKept / protectedTotal : 1, optimizerChangedCells: changed };
}

if (typeof window !== "undefined") window.LibmsPatternQuality = { calculatePatternQualityMetrics };
