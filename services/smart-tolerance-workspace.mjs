import { createSmartToleranceSession } from './smart-tolerance-session.mjs';
import { createSmartToleranceHistory } from './smart-tolerance-history.mjs';
import { createEditorCommand } from './editor-command.js';

/** One disposable preview controller. Only an explicit history command writes the work grid. */
export function createSmartToleranceWorkspace({ captureBaseline, getContext, getGrid, publishGrid,
  onChange = () => {}, onProfile = () => {}, setConfig = () => {}, getPaletteKey = getContext,
  preparePublication = async grid => grid }) {
  let enabled = false, strength = 0, status = 'idle', error = null, stats = null;
  let session = null, baseline = null, preview = null, requestId = 0, context = null, official = null;
  let hierarchyBuildCount = 0, enableStart = 0, lastBuild = {}, lastEvaluation = {};
  let initializing = false;
  const state = () => ({ enabled, strength, previewStrength: strength, status, error, stats,
    canApply: Boolean(preview && status === 'ready'), hierarchyBuildCount,
    baselineRevision: baseline?.baselineRevision ?? null });
  const notify = () => onChange(state());
  const current = id => enabled && requestId === id && official === getGrid() && context === getContext();
  const clear = (disable = false) => {
    requestId++; session?.clear(); session = null; baseline = preview = stats = null;
    official = context = null;
    status = 'idle'; error = null; initializing = false;
    if (disable) { enabled = false; setConfig({ enabled: false, strength }); }
    notify();
  };
  const fail = (id, caught) => {
    if (id !== requestId) return false;
    clear(true); error = String(caught?.message || '颜色分析失败，请重新尝试'); notify(); return false;
  };
  const evaluate = async (value, initial = false) => {
    if (!Number.isFinite(value) || value < 0 || value > 100) throw new RangeError('strength must be 0..100');
    strength = value; setConfig({ enabled, strength });
    // Coalesce slider changes while adoption/first build owns its request token.
    if (initializing && !initial) { notify(); return false; }
    if (!enabled || !session || !baseline) { notify(); return false; }
    const id = ++requestId;
    status = hierarchyBuildCount ? 'evaluating' : 'building'; preview = null; notify();
    try {
      const result = await session.evaluate({ strength, requestId: id, baselineRevision: baseline.baselineRevision });
      if (!current(id) || !result.committed) return false;
      status = 'ready'; notify();
      onProfile({ ...lastBuild, ...lastEvaluation, enableToReadyMs: performance.now() - enableStart,
        requestId: id, baselineRevision: baseline.baselineRevision, hierarchyBuildCount,
        cacheHit: stats?.cacheHit ?? false });
      return true;
    } catch (caught) { return fail(id, caught); }
  };
  return Object.freeze({
    getState: state,
    getPreview: () => enabled && official === getGrid() && context === getContext() ? preview : null,
    invalidate: () => clear(true),
    async enable(value) {
      if (!value) { clear(true); return true; }
      clear(); enabled = true; strength = 0; hierarchyBuildCount = 0;
      lastBuild = {}; lastEvaluation = {};
      setConfig({ enabled: true, strength });
      const id = ++requestId; context = getContext(); official = getGrid(); enableStart = performance.now();
      status = 'building'; initializing = true; notify();
      try {
        let captured = await captureBaseline({ requestId: id, context, isCurrent: () => current(id) });
        if (!current(id)) return false;
        if (!captured?.grid || !captured?.palette || !captured?.protection) throw new Error('请先生成 V2.5 图纸，再开启智能色彩容差');
        // The session owns the immutable evidence. The UI only needs its token;
        // retaining the raw captured grid here duplicates hundreds of thousands
        // of cell objects throughout hierarchy construction.
        baseline = { baselineRevision: captured.baselineRevision, algorithmVersion: captured.algorithmVersion };
        session = createSmartToleranceSession({ buildMode: 'async',
          isCurrent: (candidate, revision) => current(candidate) && revision === baseline?.baselineRevision,
          onBuildProfile: report => {
            if (report.stages?.['palette context prep']) {
              if (!report.cancelled) hierarchyBuildCount++;
              lastBuild = { ...lastBuild, hierarchyBuildMs: report.wallClockMs,
                longestBuildTaskMs: report.longestSyncTaskMs };
            } else {
              lastBuild = { ...lastBuild, baselineAdoptionMs: report.wallClockMs,
                longestBaselineAdoptionTaskMs: report.longestSyncTaskMs };
            }
          },
          onProfile: report => { lastEvaluation = {
            sliderEvaluateMs: report.stages['evaluate(strength)'] ?? 0,
            sliderMaterializeMs: report.stages['grid materialization'] ?? 0,
            longestSliderTaskMs: report.longestSyncMs, sliderTransactionMs: report.totalMs }; },
          commit: result => {
            if (!current(result.requestId)) return;
            preview = result.grid; stats = result.diagnostics.smartColorTolerance;
          },
        });
        const adopted = await session.adoptBaselineAsync(captured,
          { palette: getPaletteKey(), contextKey: context }, null, { requestId: id });
        captured = null;
        if (!adopted || !current(id)) return false;
        const firstStrength = strength;
        const ready = await evaluate(firstStrength, true);
        if (!ready) return false;
        initializing = false;
        return strength !== firstStrength ? evaluate(strength) : ready;
      } catch (caught) { return fail(id, caught); }
    },
    evaluate,
    cancel() {
      if (initializing) { clear(true); return; }
      requestId++; preview = null; status = session ? 'ready' : 'idle'; notify();
    },
    reset: () => evaluate(0),
    async apply(editor) {
      if (!preview || status !== 'ready' || !current(requestId)) return false;
      const id = requestId, revision = baseline.baselineRevision;
      status = 'applying'; notify();
      try {
      const appliedStrength = strength;
      const payload = await createSmartToleranceHistory(getGrid(), preview, { isCurrent: () => current(id) });
      if (!payload || !current(id)) return false;
      // Prepare both directions before recording a synchronous history command.
      // Neither preparation is allowed to write the official work grid.
      let before = await preparePublication(getGrid(), { isCurrent: () => current(id), direction: 'before' });
      if (!before || !current(id)) return false;
      let after = await preparePublication(preview, { isCurrent: () => current(id), direction: 'after',
        statistics: payload.afterStats, applicationMetadata: {
          enabled: true, strength: appliedStrength, algorithmVersion: baseline.algorithmVersion,
          paletteKey: getPaletteKey(), baselineRevision: revision, appliedRevision: `${revision}:apply:${id}`,
        } });
      if (!after || !current(id)) return false;
      const descriptor = prepared => Array.isArray(prepared) ? null : Object.freeze({ ...prepared, grid: undefined });
      before = descriptor(before); after = descriptor(after);
      const commit = (prepared, direction) => {
        clear(true);
        const started = performance.now(), grid = payload.restore(direction);
        const historyRestoreMs = performance.now() - started;
        const result = publishGrid(prepared ? { ...prepared, grid, ownedGrid: true } : grid);
        onProfile({ commitMs: performance.now() - started, requestId: id, baselineRevision: revision,
          operation: 'SMART_COLOR_TOLERANCE_APPLY', ...lastBuild, ...lastEvaluation,
          ...payload.metrics, historyRestoreMs, applyHierarchyBuildCount: 0, applyEvaluateCount: 0,
          applyFullMaterializeCount: 1 });
        return result;
      };
      const command = createEditorCommand({ kind: 'structure', type: 'SMART_COLOR_TOLERANCE_APPLY',
        label: `智能色彩容差：${appliedStrength}`, width: payload.width,
        height: payload.height, execute: () => commit(after, 'after'),
        undo: () => commit(before, 'before'), redo: () => commit(after, 'after') });
      return editor.executeCommand(command);
      } catch (caught) { return fail(id, caught); }
    },
  });
}
