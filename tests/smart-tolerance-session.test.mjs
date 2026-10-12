import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartToleranceSession } from '../services/smart-tolerance-session.mjs';

const palette = [
  { paletteId: 'a:A01', code: 'A01', rgb: [200, 180, 160] },
  { paletteId: 'b:A01', code: 'A01', rgb: [200, 180, 160] },
  { paletteId: 'a:A02', code: 'A02', rgb: [202, 182, 162] },
];
const makeBaseline = () => ({ baselineRevision: 'rev-1', algorithmVersion: 'v1-optin-1',
  grid: [[palette[0], palette[1], null, palette[2]]], palette,
  protection: { protectionMap: [0, 0, 0, 0], tierMap: [0, 0, 0, 0] }, budgetConfig: { maxColors: 0 },
  context: { image: 'image-a', crop: [0, 0, 1, 1], size: 52, engine: 'v2.5', palette: 'a+b', availability: ['A01', 'A02'], cleanup: 1, protection: 1, refine: false, algorithmVersion: 'v1-optin-1' } });

test('strength replay reuses hierarchy, caches evaluation, and cannot accumulate baseline damage', async () => {
  let current = 1, evaluations = 0;
  const commits = [];
  const session = createSmartToleranceSession({ isCurrent: (id, revision) => id === current && revision === 'rev-1', commit: value => commits.push(value),
    compute: (controller, strength) => { evaluations++; return controller.evaluate(strength); } });
  const baseline = makeBaseline();
  session.adoptBaseline(baseline);
  const original = structuredClone(baseline.grid);
  baseline.grid[0][0] = null;
  for (const strength of [0, 20, 50, 80, 0]) {
    await session.evaluate({ strength, requestId: current, baselineRevision: 'rev-1' });
    current++;
  }
  assert.equal(evaluations, 4);
  assert.equal(commits.length, 5);
  assert.deepEqual(commits.at(-1).grid, original);
  assert.equal(commits.at(-1).diagnostics.smartColorTolerance.cacheHit, true);
  assert.equal(session.getCache().evaluatedResults.size, 4);
  assert.ok(commits.at(-1).grid[0].some(cell => cell?.paletteId === 'a:A01'));
  assert.ok(commits.at(-1).grid[0].some(cell => cell?.paletteId === 'b:A01'));
});

test('async 20 → 80 → 30 rejects old results by requestId and baseline revision', async () => {
  let current = 1;
  const pending = [], commits = [];
  const session = createSmartToleranceSession({ isCurrent: (id, revision) => id === current && revision === 'rev-1', commit: value => commits.push(value),
    compute: (controller, strength) => new Promise(resolve => pending.push(() => resolve(controller.evaluate(strength)))) });
  session.adoptBaseline(makeBaseline());
  const first = session.evaluate({ strength: 20, requestId: 1, baselineRevision: 'rev-1' });
  current = 2;
  const second = session.evaluate({ strength: 80, requestId: 2, baselineRevision: 'rev-1' });
  current = 3;
  const third = session.evaluate({ strength: 30, requestId: 3, baselineRevision: 'rev-1' });
  pending[2](); assert.equal((await third).committed, true);
  pending[0](); pending[1]();
  assert.equal((await first).stale, true); assert.equal((await second).stale, true);
  assert.equal(commits.length, 1);
  assert.equal(commits[0].diagnostics.smartColorTolerance.strength, 30);
  assert.equal((await session.evaluate({ strength: 30, requestId: 3, baselineRevision: 'old-revision' })).stale, true);
});

for (const key of ['image', 'crop', 'size', 'engine', 'palette', 'availability', 'cleanup', 'protection', 'refine', 'algorithmVersion']) {
  test(`context invalidation: ${key}`, () => {
    const baseline = makeBaseline();
    const session = createSmartToleranceSession({ isCurrent: () => true, commit: () => {} });
    session.adoptBaseline(baseline);
    assert.equal(session.invalidate(structuredClone(baseline.context)), false);
    assert.equal(session.invalidate({ ...baseline.context, [key]: 'changed' }), true);
    assert.equal(session.getCache(), null);
  });
}

test('context key order is irrelevant; same revision cannot reuse different evidence', () => {
  const session = createSmartToleranceSession({ isCurrent: () => true, commit: () => {} });
  const baseline = makeBaseline();
  assert.equal(session.adoptBaseline(baseline), true);
  assert.equal(session.adoptBaseline(baseline, Object.fromEntries(Object.entries(baseline.context).reverse())), false);
  const changed = structuredClone(baseline); changed.grid[0][2] = changed.palette[0];
  assert.equal(session.adoptBaseline(changed), true);
});

test('baseline replacement invalidates an outstanding calculation even with same requestId', async () => {
  let resolve;
  const commits = [];
  const session = createSmartToleranceSession({ isCurrent: () => true, commit: value => commits.push(value),
    compute: (controller, strength) => new Promise(done => { resolve = () => done(controller.evaluate(strength)); }) });
  session.adoptBaseline(makeBaseline());
  const job = session.evaluate({ strength: 80, requestId: 1, baselineRevision: 'rev-1' });
  session.adoptBaseline({ ...makeBaseline(), baselineRevision: 'rev-2' });
  resolve();
  assert.equal((await job).stale, true); assert.equal(commits.length, 0);
});

test('derived result cache is bounded and metadata does not copy evaluated grids', async () => {
  const session = createSmartToleranceSession({ isCurrent: () => true, commit: () => {} });
  session.adoptBaseline(makeBaseline(), 'context-key');
  for (let strength = 0; strength <= 10; strength++) await session.evaluate({ strength, requestId: 1, baselineRevision: 'rev-1' });
  assert.equal(session.getCache().evaluatedResults.size, 8);
  assert.deepEqual(session.getMetadata(), { baselineRevision: 'rev-1', configHash: '"context-key"', context: 'context-key' });
  assert.equal(session.getCache().evaluatedResults.has(0), false);
  assert.equal((await session.evaluate({ strength: 0, requestId: 1, baselineRevision: 'rev-1' })).diagnostics.smartColorTolerance.cacheHit, false);
});

test('callback contract is validated at the session boundary', () => {
  assert.throws(() => createSmartToleranceSession(), TypeError);
});

test('invalid strength never computes, caches or commits', async () => {
  let calls=0;
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:()=>{calls++;},compute:()=>{calls++;}});
  session.adoptBaseline(makeBaseline());
  for(const strength of [NaN,-1,101,'20']) await assert.rejects(session.evaluate({strength,requestId:1,baselineRevision:'rev-1'}),RangeError);
  assert.equal(calls,0);
  assert.equal(session.getCache().evaluatedResults.size,0);
});
