import { paletteIdOf } from './palette-identity.js';
import { buildProtectionMap } from '../smart-preprocessing/detail-protection-v2.mjs';
import { detectAnchorColors } from '../smart-preprocessing/accent-protection.mjs';
import { buildPaletteBudgetPlan, applyBudgetPlan, countGridColors } from '../smart-preprocessing/protected-palette-budget-v2.mjs';

const cloneCell = cell => cell == null ? null : { ...cell, ...(Array.isArray(cell.rgb) ? { rgb: [...cell.rgb] } : {}) };

/** Pure preview of the edited grid. No original-image evidence is available here.
 * Structural continuity and current-grid accent anchors are reused; the generation
 * algorithm and palette matching are not changed. The caller owns apply/undo.
 */
export function previewEditorColorReduction(grid, targetColors) {
  if (!Array.isArray(grid) || grid.some(row => !Array.isArray(row) || row.length !== (grid[0]?.length || 0))) {
    throw new TypeError('降色预览需要矩形网格');
  }
  if (!Number.isFinite(Number(targetColors)) || Number(targetColors) < 1) throw new RangeError('目标色数必须大于零');
  const target = Math.floor(Number(targetColors));
  const colors = new Map();
  for (const row of grid) for (const cell of row) {
    if (!cell) continue;
    const key = paletteIdOf(cell);
    if (!key) throw new TypeError('降色预览需要有效色号身份');
    const rgb = cell.rgb || [cell.r, cell.g, cell.b];
    if (!Array.isArray(rgb) || rgb.length < 3 || !rgb.slice(0, 3).every(value => Number.isFinite(value) && value >= 0 && value <= 255)) {
      throw new TypeError('降色预览需要有效 RGB');
    }
    if (!colors.has(key)) colors.set(key, cell);
  }
  const beforeColors = colors.size;
  if (beforeColors <= target) return {
    grid: grid.map(row => row.map(cloneCell)), plan: [], beforeColors, afterColors: beforeColors,
    changedCells: 0, forcedProtected: 0, protectedColors: 0, targetColors: target,
  };
  const working = grid.map(row => row.map(cell => cell ? { code: paletteIdOf(cell), rgb: [...(cell.rgb || [cell.r, cell.g, cell.b])] } : null));
  const protection = buildProtectionMap({
    grid: working, width: working[0]?.length || 0, height: working.length,
    sameCell: (a, b) => !!a && !!b && a.code === b.code,
  });
  const { anchors } = detectAnchorColors({ grid: working });
  const plan = buildPaletteBudgetPlan({
    grid: working, getColorKey: cell => cell.code,
    getRGBByKey: key => { const cell = colors.get(key); return cell.rgb || [cell.r, cell.g, cell.b]; },
    maxColors: target, ...protection, protectedKeys: anchors,
  });
  // The legacy writer uses code as identity and resolves A -> B -> C chains.
  // Only temporary cells pass through it; restore complete actual palette entries.
  applyBudgetPlan(working, cell => cell.code, plan, key => {
    const cell = colors.get(key);
    return cell ? { code: key, rgb: cell.rgb || [cell.r, cell.g, cell.b] } : null;
  });
  let changedCells = 0;
  const preview = working.map((row, y) => row.map((cell, x) => {
    if (!cell) return null;
    if (cell.code === paletteIdOf(grid[y][x])) return cloneCell(grid[y][x]);
    changedCells++;
    return cloneCell(colors.get(cell.code));
  }));
  return {
    grid: preview, plan, beforeColors,
    afterColors: countGridColors(preview, paletteIdOf).size,
    changedCells, forcedProtected: plan.filter(merge => merge.forcedProtected).length,
    protectedColors: anchors.size, targetColors: target,
  };
}
