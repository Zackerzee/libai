import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartColorTolerance, createSmartColorToleranceAsync, restoreSmartColorToleranceAsync } from '../services/smart-color-tolerance.mjs';
import { cloneToleranceSnapshotAsync, createToleranceBuildScheduler } from '../services/smart-tolerance-build-scheduler.mjs';
import { cases } from './fixtures/smart-tolerance-p1/cases.mjs';

const immediate = () => new Promise(resolve => setImmediate(resolve));
const palette = [{ paletteId: 'p:A', code: 'A', rgb: [100, 100, 100] }, { paletteId: 'p:B', code: 'B', rgb: [103, 103, 103] }];
function fixture(size) {
  return { baselineGrid: Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => palette[(x + y) % 2])),
    palette, protection: { protectionMap: new Float32Array(size * size), tierMap: new Uint8Array(size * size) } };
}

for (const { name, input } of cases()) test(`P3 synchronous/asynchronous exact fixture: ${name}`, async () => {
  const sync = createSmartColorTolerance(input);
  const async = await createSmartColorToleranceAsync(input, { yieldTask: immediate, timeBudgetMs: 0.5 });
  assert.deepEqual(async.getHierarchy(), sync.getHierarchy());
  assert.deepEqual(async.getCompiledHierarchy(), sync.getCompiledHierarchy());
  for (let strength = 0; strength <= 100; strength += 10) assert.deepEqual(async.evaluate(strength), sync.evaluate(strength));
  const restored = await restoreSmartColorToleranceAsync({ baselineGrid: input.baselineGrid, palette: input.palette, compiled: sync.getCompiledHierarchy() }, { yieldTask: immediate });
  assert.deepEqual(restored.getCompiledHierarchy(), sync.getCompiledHierarchy());
  assert.deepEqual(restored.evaluate(100), sync.evaluate(100));
});

for (const size of [52, 78, 104, 250, 500]) test(`P3 fixed-size ${size} hierarchy and all eleven evaluations`, async () => {
  const input = fixture(size), sync = createSmartColorTolerance(input), reports = [];
  const async = await createSmartColorToleranceAsync(input, { yieldTask: immediate, onProfile: value => reports.push(value) });
  assert.deepEqual(async.getCompiledHierarchy(), sync.getCompiledHierarchy());
  for (let strength = 0; strength <= 100; strength += 10) assert.deepEqual(async.evaluate(strength), sync.evaluate(strength));
  assert.equal(reports.length, 1);
  assert.ok(reports[0].yieldCount > 0);
  assert.ok(reports[0].cpuMs <= reports[0].wallClockMs);
});

test('P3 twenty builds remain byte-identical with differing yield budgets', async () => {
  const input = cases().find(value => value.name === 'contrast-multiple-edge-order').input;
  const expected = JSON.stringify(createSmartColorTolerance(input).getCompiledHierarchy());
  for (let i = 0; i < 20; i++) {
    const actual = await createSmartColorToleranceAsync(input, { yieldTask: immediate, timeBudgetMs: i % 2 ? 0.01 : 8 });
    assert.equal(JSON.stringify(actual.getCompiledHierarchy()), expected);
  }
});

test('P3 snapshots preserve cycles, aliases, sparse arrays and shared typed buffers', async () => {
  const buffer = new ArrayBuffer(24), typed = new Uint8Array(buffer, 2, 8), shared = { label: 'shared' };
  const value = { a: shared, b: shared, buffer, typed, view: new DataView(buffer, 4, 4), sparse: new Array(4) };
  value.self = value; value.sparse[2] = shared;
  const actual = await cloneToleranceSnapshotAsync(value, { yieldTask: immediate });
  assert.deepEqual(actual, structuredClone(value));
  assert.equal(actual.self, actual); assert.equal(actual.a, actual.b); assert.equal(actual.typed.buffer, actual.buffer);
  assert.equal(actual.view.buffer, actual.buffer); assert.equal(0 in actual.sparse, false);
});

test('P3 exotic snapshot fallback invokes accessor once and retains native metadata', async () => {
  let reads = 0;
  const value = { date: new Date(123), map: new Map([['a', 2]]) };
  Object.defineProperty(value, 'getter', { enumerable: true, get() { reads++; return { x: 4 }; } });
  const reports = [], actual = await cloneToleranceSnapshotAsync(value, { onProfile: report => reports.push(report), yieldTask: immediate });
  assert.equal(reads, 1); assert.equal(actual.getter.x, 4); assert.equal(actual.date.getTime(), 123);
  assert.equal(actual.map.get('a'), 2); assert.equal(reports[0].nativeFallbackCount, 1);
});

test('P3 shared typed backing buffers preserve native shared-memory semantics', async () => {
  const buffer = new SharedArrayBuffer(16), typed = new Uint8Array(buffer, 2, 4);
  const actual = await cloneToleranceSnapshotAsync({ buffer, typed }, { yieldTask: immediate });
  assert.equal(actual.typed.buffer, actual.buffer);
  actual.typed[0] = 7; assert.equal(typed[0], 7);
});

test('P3 cancellation before allocation, between chunks and before publication returns no controller', async () => {
  const signal = new AbortController(); signal.abort();
  assert.equal(await createSmartColorToleranceAsync(fixture(52), { signal: signal.signal }), null);
  let alive = true, yields = 0;
  const states = [];
  const result = await createSmartColorToleranceAsync(fixture(250), { isCurrent: () => alive, timeBudgetMs: 0.01,
    yieldTask: async () => { if (++yields === 3) alive = false; await immediate(); }, onState: state => states.push(state.status) });
  assert.equal(result, null); assert.deepEqual(states, ['building', 'cancelled']); assert.equal(yields, 3);
});

test('P3 context guard binds request, revision, palette and version', async () => {
  const context = { requestId: 1, baselineRevision: 'a', paletteKey: 'p', algorithmVersion: 'v' };
  let current = { ...context };
  const result = await createSmartColorToleranceAsync(fixture(52), { context, timeBudgetMs: 0.01,
    isCurrent: captured => Object.keys(context).every(key => captured[key] === current[key]),
    yieldTask: async () => { current = { ...current, paletteKey: 'changed' }; await immediate(); } });
  assert.equal(result, null);
});

test('P3 invalid data rejects without publishing ready status', async () => {
  const states = [];
  await assert.rejects(createSmartColorToleranceAsync({ baselineGrid: [[{}]], palette }, { onState: value => states.push(value.status) }), TypeError);
  assert.deepEqual(states, ['building', 'error']);
  assert.throws(() => createToleranceBuildScheduler({ timeBudgetMs: 0 }), RangeError);
});
