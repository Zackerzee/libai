import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSmartToleranceSession } from '../services/smart-tolerance-session.mjs';
import { applySmartToleranceBudget } from '../services/smart-tolerance-budget.mjs';
import { createSmartColorTolerance } from '../services/smart-color-tolerance.mjs';
import { resolveSmartTolerancePaletteContext } from '../services/smart-color-tolerance-palette-adapter.mjs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const store = readFileSync(new URL('../state/store.js', import.meta.url), 'utf8');
const project = readFileSync(new URL('../state/project-store.js', import.meta.url), 'utf8');

test('V2.5 options default tolerance off and pass explicit configuration/context', () => {
  const source = app.slice(app.indexOf('function buildV25Options('), app.indexOf('/** 实验室直调'));
  const context = vm.createContext({ els: {}, state: {}, mapDetailProtectionValue: () => 0.7 });
  vm.runInContext(source, context);
  assert.equal(context.buildV25Options().smartColorTolerance.enabled, false);
  assert.equal(context.buildV25Options().smartColorTolerance.strength, 0);
  assert.equal(context.buildV25Options().smartColorTolerance.policy, 'quality-first');
  const result = context.buildV25Options({ smartColorTolerance: { enabled: true, strength: 80 }, smartToleranceContext: 'revision' });
  assert.equal(result.smartColorTolerance.strength, 80);
  assert.equal(result.smartToleranceContext, 'revision');
});

test('Smart production blocks have no optional availability helper dependencies', () => {
  const generation = app.slice(app.indexOf('async function processImageV2('), app.indexOf('async function processProductionV2('));
  const helpers = app.slice(app.indexOf('let smartToleranceSession'), app.indexOf('async function processImageV2('));
  const bridgeBegin = app.indexOf('  async updateSmartColorTolerance(');
  const bridge = app.slice(bridgeBegin, app.indexOf('  /**', bridgeBegin));
  assert.doesNotMatch(generation + helpers + bridge, /getAvailablePaletteIds|getGenerationPaletteColors/);
  assert.match(generation, /paletteEntries: palette, paletteKey \}/);
  assert.match(generation, /paletteContext: tolerancePaletteContext/);
});

test('actual production adaptation branch skips loading when disabled and passes actual subset when enabled', async () => {
  const begin = app.indexOf('  let tolerancePaletteContext = null;');
  const end = app.indexOf('  // §13：', begin);
  const branch = app.slice(begin, end).replace('await import("./services/smart-color-tolerance-palette-adapter.mjs")', 'await loadPaletteAdapter()');
  const palette = [{ code: 'B', paletteId: 'brand:B', rgb: [1, 2, 3] }];
  for (const toleranceEnabled of [false, true]) {
    let loads = 0;
    const state = {};
    const sandbox = { palette, toleranceEnabled, state, width: 52, height: 52, maxColors: 0, reqId: 1,
      resolved: {}, smartToleranceGenerationRevision: 0, smartToleranceSession: null,
      getCurrentPaletteKey: () => 'brand-24', getCurrentPalette: () => palette, isStaleGenerationRequest: () => false,
      smartToleranceContext: (_w, _h, _m, context) => JSON.stringify(context),
      loadPaletteAdapter: async () => { loads++; return { resolveSmartTolerancePaletteContext }; } };
    const context = vm.createContext(sandbox);
    const result = await vm.runInContext(`(async () => { ${branch}; return resolved; })()`, context);
    assert.equal(loads, toleranceEnabled ? 1 : 0);
    if (toleranceEnabled) {
      assert.deepEqual(result.smartToleranceContext.paletteContext.paletteEntries, palette);
      assert.deepEqual(result.smartToleranceContext.paletteContext.paletteIds, ['brand:B']);
    } else assert.equal(result.smartToleranceContext, undefined);
  }
});

test('explicit availability subset and live registry/key changes invalidate the context', () => {
  const palette = [{ code: 'A', rgb: [1, 2, 3] }, { code: 'B', rgb: [4, 5, 6] }];
  let key = 'brand-24', registry = palette;
  const source = app.slice(app.indexOf('function smartToleranceContext('), app.indexOf('async function getSmartToleranceSession('));
  const sandbox = { window: { libmsStore: { getState: () => ({ processingState: {} }) } }, els: {}, state: {},
    smartTolerancePaletteContext: resolveSmartTolerancePaletteContext({ paletteEntries: palette, paletteKey: key }),
    getCurrentPaletteKey: () => key, getCurrentPalette: () => registry, buildV25Options: () => ({}) };
  const context = vm.createContext(sandbox);
  vm.runInContext(source, context);
  const original = context.smartToleranceContext(52, 52, 0);
  const subset = resolveSmartTolerancePaletteContext({ paletteEntries: [palette[1]], paletteKey: key });
  assert.notEqual(context.smartToleranceContext(52, 52, 0, subset), original);
  registry = [palette[0]];
  assert.notEqual(context.smartToleranceContext(52, 52, 0), original);
  registry = palette; key = 'brand-48';
  assert.notEqual(context.smartToleranceContext(52, 52, 0), original);
});

test('actual bridge discards old delayed palette adaptation after newer strength or baseline changes', async () => {
  const begin = app.indexOf('  async updateSmartColorTolerance(');
  const source = app.slice(begin, app.indexOf('  /**', begin)).trim().replace(/,$/, '')
    .replace('await import("./services/smart-color-tolerance-palette-adapter.mjs")', 'await loadPaletteAdapter()');
  for (const change of ['new-strength', 'disabled', 'baseline', 'source']) {
    let release;
    const pending = new Promise(resolve => { release = resolve; });
    const grid = [[{ code: 'A', rgb: [1, 2, 3] }]];
    const state = { grid, generationRequestId: 0, smartToleranceBaselineRevision: 'r1',
      smartColorTolerance: { enabled: true, strength: 0, policy: 'quality-first' }, productionGenerationOptions: {} };
    const calls = [];
    const sandbox = { state, smartToleranceCommittedGrid: grid, smartTolerancePaletteContext: null,
      structuredClone, smartToleranceContext: () => state.sourceDataUrl || 'original',
      loadPaletteAdapter: () => pending,
      getSmartToleranceSession: async () => ({ invalidate: () => false,
        evaluate: async value => { calls.push(value); return { committed: true }; } }) };
    const context = vm.createContext(sandbox);
    vm.runInContext(`bridge = ({ ${source} });`, context);
    const old = context.bridge.updateSmartColorTolerance({ strength: 20, paletteContext: { paletteEntries: grid[0], paletteKey: 'brand' } });
    assert.equal(state.generationRequestId, 1);
    if (change === 'new-strength') await context.bridge.updateSmartColorTolerance({ strength: 30 });
    if (change === 'disabled') state.smartColorTolerance.enabled = false;
    if (change === 'baseline') state.smartToleranceBaselineRevision = 'r2';
    if (change === 'source') state.sourceDataUrl = 'new-source';
    release({ resolveSmartTolerancePaletteContext });
    const result = await old;
    assert.equal(result.stale, true);
    assert.equal(context.smartTolerancePaletteContext, null);
    assert.deepEqual(calls.map(value => value.strength), change === 'new-strength' ? [30] : []);
    assert.notEqual(state.smartColorTolerance.strength, 20);
  }
});

test('canonical store owns config/report/revision, without an editable tolerance grid', () => {
  assert.match(store, /smartColorTolerance: \{ enabled: false, strength: 0, policy: "quality-first" \}/);
  assert.match(store, /smartToleranceReport: \["patternState"/);
  assert.match(store, /smartToleranceBaselineRevision: \["patternState"/);
  assert.match(project, /smartColorTolerance: \{ \.\.\.s\.processingState\.smartColorTolerance \}/);
  assert.doesNotMatch(store, /smartToleranceGrid\s*:/);
});

test('context observes actual panel changes before production options are refreshed', () => {
  const processing={detailProtection:70,cleanupStrength:50,smartColorTolerance:{strength:0},generationRequestId:1};
  const source=app.slice(app.indexOf('function smartToleranceContext('),app.indexOf('async function getSmartToleranceSession('));
  const context=vm.createContext({window:{libmsStore:{getState:()=>({processingState:processing})}},els:{},state:{productionGenerationOptions:{detailProtection:70}},
    smartTolerancePaletteContext: { paletteEntries: [], paletteIds: [], paletteKey: 'brand' },
    getCurrentPaletteKey:()=> 'brand',getCurrentPalette:()=>[],buildV25Options:()=>({})});
  vm.runInContext(source,context);
  const original=context.smartToleranceContext(52,52,0);
  processing.smartColorTolerance.strength=80; processing.generationRequestId=2;
  assert.equal(context.smartToleranceContext(52,52,0),original);
  processing.detailProtection=80;
  assert.notEqual(context.smartToleranceContext(52,52,0),original);
  processing.detailProtection=70; processing.cleanupStrength=80;
  assert.notEqual(context.smartToleranceContext(52,52,0),original);
});

test('strength-only bridge invokes cached evaluate without generation stages', () => {
  const bridge = app.slice(app.indexOf('  async updateSmartColorTolerance('), app.indexOf('  /**', app.indexOf('  async updateSmartColorTolerance(')));
  assert.match(bridge, /session\.evaluate\(\{ strength, requestId, baselineRevision:/);
  assert.doesNotMatch(bridge, /imageToImageData|loadImage|runGenerationJob|processImageV2/);
  assert.ok(/state\.grid = grid;[\s\S]{0,120}state\.stats = calculateStats\(grid\)/.test(app));
});

test('production commit guards context and preserves optional palette identity', () => {
  const source = app.slice(app.indexOf('async function processImageV2('), app.indexOf('async function processProductionV2('));
  const commit = source.indexOf('state.grid = result.grid');
  assert.ok(source.indexOf('isStaleGenerationRequest(reqId)') < commit);
  assert.ok(source.indexOf('toleranceContext !== smartToleranceContext') < commit);
  assert.match(source, /cell\.paletteId != null \? \{ paletteId: cell\.paletteId \}/);
  assert.match(source, /adoptBaseline\(result\.diagnostics\.smartToleranceBaseline, toleranceContext, result\.diagnostics\.smartToleranceHierarchy\)/);
});

test('actual bridge replay commits tolerance plus budget to canonical grid without generation stages', async () => {
  const palette = [
    { paletteId: 'brand:A01', code: 'A01', rgb: [100, 100, 100] },
    { paletteId: 'brand:A02', code: 'A02', rgb: [105, 105, 105] },
    { paletteId: 'brand:A03', code: 'A03', rgb: [180, 180, 180] },
  ];
  const baseline = { grid: [[palette[0], palette[1], null, palette[2]]], palette,
    protection: { protectionMap: [0, 0, 0, 0], tierMap: [0, 0, 0, 0] },
    budgetConfig: { maxColors: 1 }, baselineRevision: 'runtime-1', algorithmVersion: 'v1-optin-1', context: 'context-1' };
  const state = { grid: structuredClone(baseline.grid), width: 4, height: 1, manualEdited: false,
    smartToleranceBaselineRevision: baseline.baselineRevision, generationRequestId: 0,
    paletteBudget: { effective: 1 }, productionGenerationOptions: {},
    smartColorTolerance: { enabled: true, strength: 0, policy: 'quality-first' } };
  let frontStageCalls = 0;
  const sandbox = { state, smartToleranceCommittedGrid: state.grid, smartToleranceContext: () => baseline.context,
    loadImage: () => { frontStageCalls++; }, imageToImageData: () => { frontStageCalls++; },
    runGenerationJob: () => { frontStageCalls++; }, processImageV2: () => { frontStageCalls++; } };
  const session = createSmartToleranceSession({
    isCurrent: (id, revision) => state.generationRequestId === id && state.smartToleranceBaselineRevision === revision,
    commit: ({ grid, diagnostics }) => {
      state.grid = grid;
      sandbox.smartToleranceCommittedGrid = grid;
      state.smartToleranceReport = diagnostics.smartColorTolerance;
    },
  });
  session.adoptBaseline(baseline);
  sandbox.getSmartToleranceSession = async () => session;
  const context = vm.createContext(sandbox);
  const begin = app.indexOf('  async updateSmartColorTolerance(');
  const source = app.slice(begin, app.indexOf('  /**', begin)).trim().replace(/,$/, '');
  vm.runInContext(`bridge = ({ ${source} });`, context);
  const controller = createSmartColorTolerance({ baselineGrid: baseline.grid, palette, protection: baseline.protection });
  for (const strength of [0, 20, 50, 80, 0]) {
    const result = await context.bridge.updateSmartColorTolerance({ strength });
    const expected = applySmartToleranceBudget({ grid: controller.evaluate(strength).grid, protection: baseline.protection, cfg: baseline.budgetConfig });
    assert.equal(result.committed, true);
    assert.deepEqual(state.grid, expected.grid);
    assert.equal(state.smartToleranceReport.strength, strength);
  }
  assert.equal(frontStageCalls, 0);
  assert.equal(state.generationRequestId, 5);
  assert.equal(state.smartToleranceReport.cacheHit, true);
  assert.equal(new Set(state.grid.flat().filter(Boolean).map(cell => cell.paletteId)).size, 1);
});
