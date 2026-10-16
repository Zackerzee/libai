import { buildPaletteBudgetPlan, applyBudgetPlan, countGridColors } from '../smart-preprocessing/protected-palette-budget-v2.mjs';
import { detectAnchorColors } from '../smart-preprocessing/accent-protection.mjs';
import { paletteIdOf } from './palette-identity.js';

export const SMART_TOLERANCE_ALGORITHM_VERSION = 'v1-optin-1';
export function smartToleranceBaselineRevision(value) {
  // Full serialized evidence is retained by the cache for collision verification.
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619);
  return `${SMART_TOLERANCE_ALGORITHM_VERSION}:${text.length}:${(hash >>> 0).toString(16)}`;
}

/** Same protected-budget stage for opt-in generation and strength-only replay.
 * Input grid is disposable; immutable tolerance baseline must never be passed. */
export function applySmartToleranceBudget({ grid, protection, cfg }) {
  const getColorKey = paletteIdOf;
  let budgetPlan = [], accentDiag = null, protectedByAccent = 0, anchorKeys = null;
  if (cfg.accentProtection) {
    const accent = detectAnchorColors({ grid, getColorKey, options: cfg.accentConfig || {} });
    anchorKeys = accent.anchors;
    protectedByAccent = anchorKeys.size;
    const inGrid = new Set(grid.flat().filter(Boolean).map(getColorKey));
    accentDiag = { ...accent.diagnostics, anchors: [...anchorKeys], neutralAnchors: accent.neutralAnchors,
      chromaticAnchors: [...accent.chromaticAnchors], anchorsInGrid: [...anchorKeys].filter(key => inGrid.has(key)),
      budgetApplied: false, anchorForcedMerges: 0 };
  }
  if (cfg.maxColors > 0 && countGridColors(grid, getColorKey).size > cfg.maxColors) {
    const cells = new Map(grid.flat().filter(Boolean).map(cell => [getColorKey(cell), cell]));
    budgetPlan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey: key => cells.get(key)?.rgb ?? null,
      maxColors: cfg.maxColors, protectionMap: protection.protectionMap, tierMap: protection.tierMap,
      protectionReasonMap: protection.protectionReasonMap, protectedKeys: anchorKeys });
    // Legacy applyBudgetPlan only copies code/rgb, not paletteId. Preserve its
    // plan and closure but materialize immutable legal target identities here.
    const mapping = new Map(budgetPlan.map(step => [step.from, step.to]));
    const replacements = [];
    for (const row of grid) for (const cell of row) {
      if (!cell) continue;
      let target = getColorKey(cell);
      const seen = new Set();
      while (mapping.has(target) && !seen.has(target)) { seen.add(target); target = mapping.get(target); }
      if (target !== getColorKey(cell) && cells.has(target)) replacements.push([cell, structuredClone(cells.get(target))]);
    }
    applyBudgetPlan(grid, getColorKey, budgetPlan, key => cells.get(key) ?? null);
    for (const [cell, target] of replacements) {
      cell.code = target.code; cell.rgb = [...target.rgb];
      if (target.paletteId == null) delete cell.paletteId; else cell.paletteId = target.paletteId;
      if (target.hex != null) cell.hex = target.hex;
      if (target.name != null) cell.name = target.name;
    }
    if (accentDiag) {
      accentDiag.budgetApplied = true;
      accentDiag.anchorForcedMerges = budgetPlan.filter(p => p.protectedByAnchor && p.forcedProtected).length;
    }
  }
  return { grid, budgetPlan, forcedProtectedMerges: budgetPlan.filter(p => p.forcedProtected).length, accentDiag, protectedByAccent };
}

export function freezeToleranceBaseline(value) {
  // Typed arrays cannot be frozen; encode evidence as ordinary arrays first.
  const copy = structuredClone(value);
  const freeze = object => {
    if (!object || typeof object !== 'object') return object;
    for (const key of Object.keys(object)) {
      if (ArrayBuffer.isView(object[key])) object[key] = Array.from(object[key]);
      freeze(object[key]);
    }
    return Object.freeze(object);
  };
  return freeze(copy);
}
