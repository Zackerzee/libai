import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartColorTolerance, restoreSmartColorTolerance } from '../services/smart-color-tolerance.mjs';
import { createSmartToleranceSession } from '../services/smart-tolerance-session.mjs';

const palette = [
  { paletteId: 'a:A', code: 'A', rgb: [100, 100, 100] },
  { paletteId: 'a:B', code: 'B', rgb: [103, 103, 103] },
];
const input = () => ({ baselineGrid: [[palette[0], palette[1], null, { ...palette[0], metadata: { label: 'detail' } }]],
  palette, protection: { protectionMap: [0, 1, 0, 0], tierMap: [0, 2, 0, 0] } });
const baseline = () => { const value = input(); return { grid: value.baselineGrid, palette: value.palette,
  protection: value.protection, baselineRevision: 'p2', context: 'p2', budgetConfig: { maxColors: 0 } }; };
const deferredScheduler = () => {
  const pending = [];
  return { pending, yieldTask: () => new Promise(resolve => pending.push(resolve)) };
};

test('opaque compact plans materialize equivalent owned cells in original and restored controllers', async () => {
  const fixture = input(), controller = createSmartColorTolerance(fixture);
  const restored = restoreSmartColorTolerance({ ...fixture, compiled: controller.getCompiledHierarchy() });
  for (const engine of [controller, restored]) for (const strength of [0, 10, 40, 80, 100]) {
    const plan = engine.evaluatePlan(strength), expected = engine.evaluate(strength);
    const grid = await engine.materializeAsync(plan, { chunkCells: 2 });
    assert.deepEqual({ grid, ...engine.getPlanStatistics(plan) }, expected);
    assert.deepEqual(engine.materialize(plan), expected.grid);
    assert.equal(Object.isFrozen(plan), true);
    assert.equal('grid' in plan, false);
    grid[0][0].rgb[0] = 0;
    assert.deepEqual(engine.materialize(plan), expected.grid);
  }
  assert.throws(() => restored.materialize(controller.evaluatePlan(0)), TypeError);
  assert.throws(() => controller.materialize({ strength: 0 }), TypeError);
});

test('default cache retains no derived grids and explicit snapshots preserve evaluation output', async () => {
  const value = baseline(), controller = createSmartColorTolerance(input());
  const session = createSmartToleranceSession({ isCurrent: () => true, commit: () => {} });
  session.adoptBaseline(value);
  for (let strength = 0; strength <= 10; strength++) await session.evaluate({ strength, requestId: 1, baselineRevision: 'p2' });
  assert.deepEqual(session.getCacheRepresentation(), { baselineRevision: 'p2', mode: 'compact',
    cachedStrengths: [3, 4, 5, 6, 7, 8, 9, 10], cacheEntries: 8, retainedFullGrids: 0 });
  const snapshot = session.getCache();
  assert.deepEqual(snapshot.evaluatedResults.get(10), controller.evaluate(10));
  snapshot.evaluatedResults.get(10).grid[0][0].rgb[0] = 0;
  const replay = await session.evaluate({ strength: 10, requestId: 1, baselineRevision: 'p2' });
  assert.deepEqual(replay.grid, controller.evaluate(10).grid);
  assert.equal(replay.diagnostics.smartColorTolerance.cacheHit, true);
  assert.deepEqual(value, baseline());
});

test('a rapid request burst yields before allocating and commits only the last request', async () => {
  const scheduler = deferredScheduler(), commits = [], reports = [];
  let requestId = 0;
  const session = createSmartToleranceSession({ isCurrent: id => id === requestId,
    commit: value => commits.push(value), yieldTask: scheduler.yieldTask, chunkCells: 4,
    onProfile: value => reports.push(value) });
  session.adoptBaseline(baseline());
  const jobs = [0, 80, 20, 100, 35, 60, 0].map(strength => session.evaluate({ strength, requestId: ++requestId, baselineRevision: 'p2' }));
  assert.equal(scheduler.pending.length, 7);
  for (const resume of scheduler.pending.splice(0)) resume();
  const results = await Promise.all(jobs);
  assert.deepEqual(results.map(result => result.committed), [false, false, false, false, false, false, true]);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].requestId, 7);
  assert.deepEqual(session.getCacheRepresentation().cachedStrengths, [0]);
  assert.equal(reports.filter(report => report.stale).every(report => report.chunks.length === 0), true);
  assert.deepEqual(commits[0].grid, baseline().grid);
});

test('replacement and clear cancel between chunks even when request IDs are reused', async () => {
  for (const replace of [session => session.clear(), session => session.adoptBaseline({ ...baseline(), baselineRevision: 'next' })]) {
    const scheduler = deferredScheduler(), commits = [];
    const session = createSmartToleranceSession({ isCurrent: () => true, commit: value => commits.push(value),
      yieldTask: scheduler.yieldTask, chunkCells: 2 });
    session.adoptBaseline(baseline());
    const job = session.evaluate({ strength: 80, requestId: 1, baselineRevision: 'p2' });
    scheduler.pending.shift()();
    // Let the first two cells run, stopping at the next real task boundary.
    await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    assert.equal(scheduler.pending.length, 1);
    replace(session);
    scheduler.pending.shift()();
    assert.equal((await job).stale, true);
    assert.equal(commits.length, 0);
    assert.equal(session.getCacheRepresentation()?.cacheEntries ?? 0, 0);
  }
});

test('default scheduler yields to a timer before the first large materialization chunk', async () => {
  const controller = createSmartColorTolerance(input());
  let timerRan = false, chunks = 0;
  const timer = new Promise(resolve => setTimeout(() => { timerRan = true; resolve(); }, 0));
  const result = await controller.materializeAsync(controller.evaluatePlan(0), { chunkCells: 2,
    onChunk: () => { assert.equal(timerRan, true); chunks++; } });
  await timer;
  assert.deepEqual(result, input().baselineGrid);
  assert.equal(chunks, 2);
});

test('custom compute preserves arbitrary grids, aliases, rich metadata and cache isolation', async () => {
  let calls = 0, custom;
  const session = createSmartToleranceSession({ isCurrent: () => true, commit: value => { value.grid[0][0].metadata.get('x').value = 99; },
    compute: (controller, strength) => {
      calls++;
      custom = controller.evaluate(strength);
      const cell = { ...palette[1], metadata: new Map([['x', { value: 7 }]]) };
      cell.owner = cell;
      custom.grid = [[cell, cell, null, cell]];
      custom.alias = cell;
      custom.reasons = [{ reason: 'custom', payload: new Uint8Array([1, 2]) }];
      return custom;
    } });
  session.adoptBaseline(baseline());
  await session.evaluate({ strength: 0, requestId: 1, baselineRevision: 'p2' });
  assert.equal(custom.grid[0][0].metadata.get('x').value, 7);
  const snapshot = session.getCache().evaluatedResults.get(0);
  assert.deepEqual(snapshot, custom);
  assert.equal(snapshot.alias, snapshot.grid[0][0]);
  assert.equal(snapshot.grid[0][0], snapshot.grid[0][1]);
  snapshot.grid[0][0].metadata.get('x').value = 88;
  const replay = await session.evaluate({ strength: 0, requestId: 1, baselineRevision: 'p2' });
  assert.equal(calls, 1);
  assert.equal(replay.grid[0][0], replay.grid[0][1]);
  assert.equal(session.getCache().evaluatedResults.get(0).grid[0][0].metadata.get('x').value, 7);
  assert.equal(session.getCacheRepresentation().mode, 'custom-compute-compatibility');
  assert.equal(session.getCacheRepresentation().retainedFullGrids, 1);
});

test('profiling observes chunks and one commit without changing grid or diagnostics evidence', async () => {
  const reports = [];
  let commits = 0;
  const session = createSmartToleranceSession({ isCurrent: () => true, commit: () => commits++,
    chunkCells: 2, onProfile: value => reports.push(value) });
  session.adoptBaseline(baseline());
  const result = await session.evaluate({ strength: 20, requestId: 1, baselineRevision: 'p2' });
  assert.deepEqual(result.grid, createSmartColorTolerance(input()).evaluate(20).grid);
  assert.equal(commits, 1);
  assert.equal(reports.length, 1);
  assert.equal(reports[0].chunks.reduce((count, chunk) => count + chunk.cellCount, 0), 4);
  assert.equal(reports[0].mode, 'compact');
  assert.ok(reports[0].longestSyncMs >= 0);
  assert.ok(reports[0].totalMs >= reports[0].longestSyncMs);
  assert.equal('protectedCells' in result.diagnostics.smartColorTolerance, false);
});
