import { createSmartColorTolerance, restoreSmartColorTolerance } from './smart-color-tolerance.mjs';
import { applySmartToleranceBudget, freezeToleranceBaseline } from './smart-tolerance-budget.mjs';
import { paletteIdOf } from './palette-identity.js';

const clone = value => structuredClone(value);
const canonical = value => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value, canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
};
export const smartToleranceContextKey = context => JSON.stringify(canonical(context));

/** Disposable derived cache; no editable work grid is owned by this session. */
export function createSmartToleranceSession({ isCurrent, commit, compute = (controller, strength) => controller.evaluate(strength) } = {}) {
  if (typeof isCurrent !== 'function' || typeof commit !== 'function' || typeof compute !== 'function') throw new TypeError('session requires isCurrent, commit and compute functions');
  let baseline = null, controller = null, hierarchy = null, contextKey = null, contextValue = null, epoch = 0;
  const results = new Map();
  const clear = () => { baseline = controller = hierarchy = contextKey = contextValue = null; results.clear(); epoch++; };
  return Object.freeze({
    clear,
    adoptBaseline(value, context = value.context, compiled = null) {
      const key = smartToleranceContextKey(context);
      if (baseline && baseline.baselineRevision === value.baselineRevision && contextKey === key
          && smartToleranceContextKey(baseline) === smartToleranceContextKey(value)) return false;
      clear();
      baseline = freezeToleranceBaseline(value);
      contextKey = key;
      contextValue = clone(context);
      if (compiled) {
        controller = restoreSmartColorTolerance({ baselineGrid: baseline.grid, palette: baseline.palette, compiled });
        hierarchy = controller.getHierarchy();
      }
      return true;
    },
    invalidate(context) {
      if (!baseline || contextKey === smartToleranceContextKey(context)) return false;
      clear(); return true;
    },
    getMetadata() {
      return baseline ? { baselineRevision: baseline.baselineRevision, configHash: contextKey, context: clone(contextValue) } : null;
    },
    getCache() {
      return baseline ? { baselineRevision: baseline.baselineRevision, configHash: contextKey,
        context: clone(contextValue),
        hierarchy: clone(hierarchy), evaluatedResults: new Map([...results].map(([key, value]) => [key, clone(value)])) } : null;
    },
    async evaluate({ strength, requestId, baselineRevision }) {
      if (!Number.isFinite(strength) || strength < 0 || strength > 100) throw new RangeError('strength must be 0..100');
      if (!baseline || baseline.baselineRevision !== baselineRevision) return { committed: false, stale: true };
      const captured = baseline, capturedEpoch = epoch, started = performance.now();
      const current = () => epoch === capturedEpoch && baseline === captured && isCurrent(requestId, baselineRevision);
      if (!current()) return { committed: false, stale: true };
      if (!controller) {
        controller = createSmartColorTolerance({ baselineGrid: baseline.grid, palette: baseline.palette, protection: baseline.protection });
        hierarchy = controller.getHierarchy();
      }
      const cacheHit = results.has(strength);
      let evaluated = cacheHit ? clone(results.get(strength)) : await compute(controller, strength);
      if (!current()) return { committed: false, stale: true };
      if (cacheHit) results.delete(strength);
      results.set(strength, clone(evaluated));
      // Retain only eight evaluations; large boards must not accumulate 101 grids.
      while (results.size > 8) results.delete(results.keys().next().value);
      const budget = applySmartToleranceBudget({ grid: clone(evaluated.grid), protection: captured.protection, cfg: captured.budgetConfig });
      const afterBudget = new Set(budget.grid.flat().filter(Boolean).map(paletteIdOf)).size;
      const diagnostics = {
        colorsAfterCleanup: captured.colorsAfterCleanup ?? evaluated.baselineColorCount,
        colorsAfterTolerance: evaluated.finalColorCount, colorsAfterBudget: afterBudget,
        toleranceMergedColors: evaluated.mergedColorCount, budgetMergedColors: evaluated.finalColorCount - afterBudget,
        budgetForcedProtected: budget.forcedProtectedMerges,
        smartColorTolerance: { enabled: true, strength, baselineRevision, colorsBefore: evaluated.baselineColorCount,
          colorsAfterCleanup: captured.colorsAfterCleanup ?? evaluated.baselineColorCount,
          colorsAfterTolerance: evaluated.finalColorCount, colorsAfterBudget: afterBudget,
          mergedByTolerance: evaluated.mergedColorCount, mergedByBudget: evaluated.finalColorCount - afterBudget,
          protectedConflicts: evaluated.protectedConflictCount, forcedProtected: budget.forcedProtectedMerges,
          hierarchyLevel: hierarchy.filter(step => step.strength <= strength).length, cacheHit, runtimeMs: performance.now() - started,
          reasons: clone(evaluated.reasons), notice: evaluated.finalColorCount > afterBudget ? 'Smart tolerance preserved protected colors, hard palette budget subsequently forced additional merges.' : null },
      };
      if (!current()) return { committed: false, stale: true };
      const result = { grid: budget.grid, diagnostics, requestId, baselineRevision };
      commit(result);
      return { ...result, committed: true, stale: false };
    },
  });
}
