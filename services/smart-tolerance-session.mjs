import { createSmartColorTolerance, createSmartColorToleranceAsync, restoreSmartColorTolerance, restoreSmartColorToleranceAsync } from './smart-color-tolerance.mjs';
import { applySmartToleranceBudget, freezeToleranceBaseline } from './smart-tolerance-budget.mjs';
import { paletteIdOf } from './palette-identity.js';
import { freezeToleranceBaselineAsync } from './smart-tolerance-baseline-async.mjs';

const clone = value => structuredClone(value);
const canonical = value => {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value) || ArrayBuffer.isView(value)) return Array.from(value, canonical);
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
};
export const smartToleranceContextKey = context => JSON.stringify(canonical(context));

// Measured P3 historical + 32-identity fixtures: <=104² cells P95 <18ms;
// 250² stress P95 >100ms. Identity cap avoids a small but dense pair workload.
export function useSmartToleranceSyncBuild(grid) {
  if (!Array.isArray(grid) || grid.length * (grid[0]?.length ?? 0) > 104 * 104) return false;
  const ids = new Set();
  for (const row of grid) for (const cell of row) {
    if (cell !== null) ids.add(paletteIdOf(cell));
    if (ids.size > 32) return false;
  }
  return true;
}

function tokenContext(requestId, baselineRevision, context, algorithmVersion) {
  let parsed = context;
  if (typeof context === 'string') {
    try { parsed = JSON.parse(context); } catch { parsed = null; }
  }
  return Object.freeze({ requestId, baselineRevision,
    paletteKey: parsed?.paletteContext?.paletteKey ?? parsed?.palette ?? smartToleranceContextKey(context),
    algorithmVersion: algorithmVersion ?? parsed?.algorithmVersion ?? null });
}

/** Disposable derived cache; no editable work grid is owned by this session. */
export function createSmartToleranceSession({ isCurrent, commit, compute, onProfile, yieldTask, chunkCells = 8192,
  buildMode = 'auto', buildTimeBudgetMs = 6, onBuildProfile, onBuildProgress } = {}) {
  if (typeof isCurrent !== 'function' || typeof commit !== 'function' || compute !== undefined && typeof compute !== 'function') throw new TypeError('session requires isCurrent, commit and compute functions');
  if (onProfile !== undefined && typeof onProfile !== 'function') throw new TypeError('onProfile must be a function');
  if (yieldTask !== undefined && typeof yieldTask !== 'function') throw new TypeError('yieldTask must be a function');
  if (!Number.isInteger(chunkCells) || chunkCells < 1) throw new RangeError('chunkCells must be a positive integer');
  if (!['auto', 'sync', 'async'].includes(buildMode)) throw new RangeError('buildMode must be auto, sync or async');
  if (!Number.isFinite(buildTimeBudgetMs) || buildTimeBudgetMs <= 0) throw new RangeError('buildTimeBudgetMs must be positive');
  if (onBuildProfile !== undefined && typeof onBuildProfile !== 'function' || onBuildProgress !== undefined && typeof onBuildProgress !== 'function') throw new TypeError('build observers must be functions');
  // An explicit injected compute can produce arbitrary grids and metadata. Keep
  // its existing clone/cache ownership contract; production uses compact plans.
  const customCompute = compute !== undefined;
  let baseline = null, controller = null, hierarchy = null, contextKey = null, contextValue = null, epoch = 0;
  let buildSerial = 0, buildAbort = null, pendingContextKey = null, buildState = { status: 'idle' };
  const results = new Map();
  const abortBuild = () => { buildAbort?.abort(); buildAbort = null; pendingContextKey = null; buildSerial++; };
  const clear = () => { abortBuild(); baseline = controller = hierarchy = contextKey = contextValue = null; results.clear(); epoch++; buildState = { status: 'idle' }; };
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
        buildState = { status: 'ready', mode: 'restored-sync' };
      }
      return true;
    },
    /** Opt-in async adoption for future callers; legacy adoption remains intact.
     * Do not mutate value/context/compiled while the promise is pending. */
    async adoptBaselineAsync(value, context = value.context, compiled = null, options = {}) {
      clear();
      const capturedEpoch = epoch, serial = buildSerial, abort = buildAbort = new AbortController();
      const key = smartToleranceContextKey(context);
      const token = tokenContext(options.requestId, value.baselineRevision, context, value.algorithmVersion);
      pendingContextKey = key;
      const current = () => epoch === capturedEpoch && buildSerial === serial && !abort.signal.aborted
        && !options.signal?.aborted && isCurrent(token.requestId, token.baselineRevision, token);
      buildState = { status: 'building', mode: 'adopting', ...token };
      const settings = { signal: abort.signal, isCurrent: current, context: token,
        timeBudgetMs: buildTimeBudgetMs, ...(yieldTask ? { yieldTask } : {}),
        onProfile: onBuildProfile, onProgress: onBuildProgress };
      try {
        const owned = await freezeToleranceBaselineAsync(value, settings);
        if (!owned || !current()) {
          if (buildSerial === serial) { buildAbort = null; pendingContextKey = null; buildState = { status: 'cancelled', ...token }; }
          return false;
        }
        const restored = compiled ? await restoreSmartColorToleranceAsync({ baselineGrid: owned.grid,
          palette: owned.palette, compiled }, settings) : null;
        if (compiled && !restored || !current()) {
          if (buildSerial === serial) { buildAbort = null; pendingContextKey = null; buildState = { status: 'cancelled', ...token }; }
          return false;
        }
        baseline = owned; contextKey = key; contextValue = clone(context);
        controller = restored; hierarchy = restored?.getHierarchy() ?? null;
        buildAbort = null; pendingContextKey = null; buildState = { status: restored ? 'ready' : 'idle', mode: 'adopted-async', ...token };
        return true;
      } catch (error) {
        if (buildSerial === serial) { buildAbort = null; pendingContextKey = null; buildState = { status: 'error', ...token }; }
        throw error;
      }
    },
    getBuildState() { return clone(buildState); },
    invalidate(context) {
      const key = smartToleranceContextKey(context);
      if (!baseline && !buildAbort || (baseline ? contextKey : pendingContextKey) === key) return false;
      clear(); return true;
    },
    getMetadata() {
      return baseline ? { baselineRevision: baseline.baselineRevision, configHash: contextKey, context: clone(contextValue) } : null;
    },
    getCache() {
      return baseline ? { baselineRevision: baseline.baselineRevision, configHash: contextKey,
        context: clone(contextValue),
        hierarchy: clone(hierarchy), evaluatedResults: new Map([...results].map(([key, value]) => [key,
          customCompute ? clone(value) : { grid: controller.materialize(value), ...controller.getPlanStatistics(value) }])) } : null;
    },
    getCacheRepresentation() {
      return baseline ? { baselineRevision: baseline.baselineRevision,
        mode: customCompute ? 'custom-compute-compatibility' : 'compact',
        cachedStrengths: [...results.keys()], cacheEntries: results.size,
        retainedFullGrids: customCompute ? results.size : 0 } : null;
    },
    async evaluate({ strength, requestId, baselineRevision }) {
      if (!Number.isFinite(strength) || strength < 0 || strength > 100) throw new RangeError('strength must be 0..100');
      if (!baseline || baseline.baselineRevision !== baselineRevision) return { committed: false, stale: true };
      const captured = baseline, capturedEpoch = epoch, started = performance.now();
      const current = () => epoch === capturedEpoch && baseline === captured && isCurrent(requestId, baselineRevision);
      const stages = {}, chunks = [];
      let segmentStarted = started, longestSyncMs = 0;
      const measure = (name, operation) => {
        if (!onProfile) return operation();
        const start = performance.now();
        try { return operation(); }
        finally { stages[name] = (stages[name] ?? 0) + performance.now() - start; }
      };
      const boundary = phase => {
        if (!onProfile) return;
        if (phase === 'before') longestSyncMs = Math.max(longestSyncMs, performance.now() - segmentStarted);
        else segmentStarted = performance.now();
      };
      const finish = result => {
        if (onProfile) {
          boundary('before');
          onProfile({ stages, chunks, longestSyncMs, totalMs: performance.now() - started,
            mode: customCompute ? 'custom-compute-compatibility' : 'compact',
            requestId, baselineRevision, strength, committed: result.committed, stale: result.stale,
            fusedMaterializationStages: ['cell object cloning', 'palette identity reconstruction', 'protection restoration'],
            scope: 'session transaction; commit callback included, adoption and later renderer tasks excluded' });
        }
        return result;
      };
      const stale = () => finish({ committed: false, stale: true });
      if (!measure('validation', current)) return stale();
      if (!controller) {
        abortBuild();
        const serial = buildSerial, abort = buildAbort = new AbortController();
        const token = tokenContext(requestId, baselineRevision, contextValue, captured.algorithmVersion);
        const buildCurrent = () => current() && serial === buildSerial && !abort.signal.aborted
          && isCurrent(requestId, baselineRevision, token);
        const sync = customCompute || buildMode === 'sync' || buildMode === 'auto' && useSmartToleranceSyncBuild(captured.grid);
        buildState = { status: 'building', mode: sync ? 'sync' : 'async', ...token };
        try {
          let built;
          const input = { baselineGrid: captured.grid, palette: captured.palette, protection: captured.protection };
          if (sync) built = measure('hierarchy construction', () => createSmartColorTolerance(input));
          else {
            // Core has its own true-yield segment profiler. Do not time an await
            // as if scheduler wait were uninterrupted main-thread work.
            boundary('before');
            built = await createSmartColorToleranceAsync(input, { signal: abort.signal,
              isCurrent: buildCurrent, context: token, timeBudgetMs: buildTimeBudgetMs,
              ...(yieldTask ? { yieldTask } : {}), onProgress: onBuildProgress,
              onProfile: report => { onBuildProfile?.(report);
                if (onProfile) longestSyncMs = Math.max(longestSyncMs, report.longestSyncTaskMs); } });
            boundary('after');
          }
          if (!built || !buildCurrent()) {
            if (buildSerial === serial) { buildAbort = null; buildState = { status: 'cancelled', ...token }; }
            return stale();
          }
          const builtHierarchy = built.getHierarchy();
          if (!buildCurrent()) return stale();
          controller = built; hierarchy = builtHierarchy; buildAbort = null;
          buildState = { status: 'ready', mode: sync ? 'sync' : 'async', ...token };
        } catch (error) {
          if (buildSerial === serial) { buildAbort = null; buildState = { status: 'error', ...token }; }
          throw error;
        }
      }
      const cacheHit = measure('hierarchy cache lookup', () => results.has(strength));
      const capturedController = controller;
      let evaluated, plan, grid;
      if (customCompute) {
        if (cacheHit) evaluated = measure('cache read', () => clone(results.get(strength)));
        else {
          const calculation = measure('evaluate(strength)', () => compute(capturedController, strength));
          boundary('before');
          evaluated = await calculation;
          boundary('after');
        }
        if (!measure('validation', current)) return stale();
        grid = measure('budget input cloning', () => clone(evaluated.grid));
      } else {
        plan = measure('evaluate(strength)', () => cacheHit ? results.get(strength) : capturedController.evaluatePlan(strength));
        grid = await capturedController.materializeAsync(plan, { isCurrent: current, yieldTask, chunkCells,
          onYield: boundary,
          ...(onProfile ? { onChunk: chunk => {
            chunks.push(chunk); stages['grid materialization'] = (stages['grid materialization'] ?? 0) + chunk.ms;
          } } : {}) });
        if (!grid || !measure('validation', current)) return stale();
        evaluated = measure('mapping resolution', () => capturedController.getPlanStatistics(plan, false));
      }
      const budget = measure('budget', () => applySmartToleranceBudget({ grid, protection: captured.protection, cfg: captured.budgetConfig }));
      // This stage mutates cells only through budgetPlan. For a controller plan,
      // its histogram already proves the exact count when there were no steps.
      const afterBudget = measure('statistics/counting', () => !customCompute && budget.budgetPlan.length === 0
        ? evaluated.finalColorCount : new Set(budget.grid.flat().filter(Boolean).map(paletteIdOf)).size);
      const diagnostics = measure('state payload construction', () => ({
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
          reasons: customCompute ? clone(evaluated.reasons) : evaluated.reasons, notice: evaluated.finalColorCount > afterBudget ? 'Smart tolerance preserved protected colors, hard palette budget subsequently forced additional merges.' : null },
      }));
      if (!measure('validation', current)) return stale();
      measure('cache write', () => {
        if (cacheHit) results.delete(strength);
        results.set(strength, customCompute ? clone(evaluated) : plan);
        while (results.size > 8) results.delete(results.keys().next().value);
      });
      if (!measure('validation', current)) return stale();
      const result = { grid: budget.grid, diagnostics, requestId, baselineRevision };
      measure('state/store commit', () => commit(result));
      return finish({ ...result, committed: true, stale: false });
    },
  });
}
