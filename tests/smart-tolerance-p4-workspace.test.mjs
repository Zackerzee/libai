import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartToleranceWorkspace } from '../services/smart-tolerance-workspace.mjs';
import { createEditorService } from '../services/editor-service.js';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';

const palette = [{ code: 'A01', paletteId: 'brand:A01', rgb: [120, 120, 120] },
  { code: 'A02', paletteId: 'brand:A02', rgb: [121, 121, 121] },
  { code: 'C01', paletteId: 'brand:C01', rgb: [200, 60, 50] }];
function harness({ maxColors = 0, captureError = null, delay = 0, protectedFixture = false,
  size = 12, observeChange = () => {}, observeCapture = () => {}, preparePublication } = {}) {
  const width = size, height = size, data = new Uint8ClampedArray(width * height * 4);
  const colors = protectedFixture ? [{ code: 'H02', paletteId: 'brand:H02', rgb: [255, 255, 255] },
    { code: 'H07', paletteId: 'brand:H07', rgb: [0, 0, 0] },
    { code: 'F01', paletteId: 'brand:F01', rgb: [200, 20, 20] }] : palette;
  for (let i = 0; i < width * height; i++) data.set([...colors[protectedFixture ? i % 3 : i % width < 5 ? 0 : i % width < 10 ? 1 : 2].rgb, 255], i * 4);
  const args = { image: { data, width, height }, size: { width, height }, mode: 'photo', palette: colors, maxColors,
    overrides: { sampling: 'center', ...(protectedFixture ? { accentProtection: true } : {}) } };
  let formal = runGenerationPipeline(args).grid, context = 'palette-brand:size-12:revision-1';
  const original = structuredClone(formal), changes = [], profiles = [], configs = [], phases = [];
  let captures = 0, publications = 0;
  const workspace = createSmartToleranceWorkspace({
    preparePublication,
    getContext: () => context, getGrid: () => formal,
    publishGrid: grid => { formal = structuredClone(grid); publications++; return true; },
    onChange: value => { changes.push(value); observeChange(value); }, onProfile: value => profiles.push(value), setConfig: value => configs.push(value),
    captureBaseline: async ({ requestId, context: capturedContext }) => {
      captures++;
      if (delay) await new Promise(resolve => setTimeout(resolve, delay));
      if (captureError) throw captureError;
      const captured = runGenerationPipeline({ ...args, onPhase: phase => phases.push(phase), overrides: { ...args.overrides,
        smartColorTolerance: { enabled: false, strength: 0, policy: 'quality-first' },
        smartToleranceCaptureBaseline: true, smartToleranceBaselineRevision: `p4:${requestId}`,
        smartToleranceContext: capturedContext } }).diagnostics.smartToleranceBaselineCapture;
      observeCapture(captured);
      return captured;
    },
  });
  const editor = createEditorService({ getResult: () => ({ grid: formal, width, height }), getPaletteColors: () => palette });
  return { workspace, editor, original, changes, profiles, configs, phases,
    grid: () => formal, counts: () => ({ captures, publications }), changeContext: value => { context = value; } };
}
test('workspace default-off does not capture, cache, build or alter production grid', async () => {
  const h = harness();
  assert.equal(h.workspace.getState().enabled, false);
  await h.workspace.evaluate(100);
  assert.deepEqual(h.counts(), { captures: 0, publications: 0 });
  assert.equal(h.workspace.getPreview(), null);
  assert.equal(h.workspace.getState().hierarchyBuildCount, 0);
  assert.deepEqual(h.grid(), h.original);
});

test('P5 preparation records one synchronous command and never shares mutable history cells', async () => {
  let calls = 0;
  const h = harness({ preparePublication: async grid => { calls++; await new Promise(r => setTimeout(r, 1)); return grid; } });
  await h.workspace.enable(true); await h.workspace.evaluate(80);
  const applying = h.workspace.apply(h.editor);
  assert.equal(h.workspace.getState().status, 'applying');
  assert.equal(await h.workspace.apply(h.editor), false);
  assert.deepEqual(h.grid(), h.original);
  assert.equal(await applying, true); assert.equal(calls, 2);
  h.grid()[0][0].rgb[0] = 1;
  assert.equal(h.editor.undo(), true); assert.deepEqual(h.grid(), h.original);
  assert.equal(h.editor.redo(), true); assert.notEqual(h.grid()[0][0].rgb[0], 1);
  assert.equal(calls, 2);
});

test('P5 cancelled preparation cannot publish or record stale history', async () => {
  let h;
  h = harness({ preparePublication: async grid => { h.workspace.cancel(); return grid; } });
  await h.workspace.enable(true);
  assert.equal(await h.workspace.apply(h.editor), false);
  assert.equal(h.counts().publications, 0); assert.equal(h.editor.undo(), false);
  assert.deepEqual(h.grid(), h.original);
});

test('P5 preparation failure preserves formal grid and reports recoverable error', async () => {
  const h = harness({ preparePublication: async () => { throw new Error('PNG failed'); } });
  await h.workspace.enable(true);
  assert.equal(await h.workspace.apply(h.editor), false);
  assert.equal(h.counts().publications, 0); assert.deepEqual(h.grid(), h.original);
  assert.match(h.workspace.getState().error, /PNG failed/);
});
test('real V2.5 capture, async hierarchy and strength replay remain disposable until explicit apply', async () => {
  const h = harness();
  assert.equal(await h.workspace.enable(true), true);
  assert.ok(h.changes.some(value => value.status === 'building'));
  assert.equal(h.workspace.getState().status, 'ready');
  for (const strength of [10, 40, 80, 25, 100, 0]) {
    assert.equal(await h.workspace.evaluate(strength), true);
    assert.deepEqual(h.grid(), h.original);
  }
  assert.equal(h.workspace.getState().hierarchyBuildCount, 1);
  assert.equal(h.counts().captures, 1);
  assert.equal(h.counts().publications, 0);
  assert.equal(h.phases.includes('smart-color-tolerance'), false);
  assert.deepEqual(h.workspace.getPreview(), h.original);
  assert.ok(h.profiles.at(-1).cacheHit);
});
test('apply creates one editor operation; undo and redo restore complete exact identities', async () => {
  const h = harness();
  await h.workspace.enable(true);
  await h.workspace.evaluate(60);
  const expected = structuredClone(h.workspace.getPreview());
  assert.equal(await h.workspace.apply(h.editor), true);
  assert.deepEqual(h.grid(), expected);
  assert.equal(h.workspace.getState().enabled, false);
  assert.equal(h.editor.undo(), true);
  assert.deepEqual(h.grid(), h.original);
  assert.equal(h.editor.redo(), true);
  assert.deepEqual(h.grid(), expected);
  assert.equal(h.counts().publications, 3);
});
test('cancel discards preview, reset restores zero without disabling, disable leaves official grid untouched', async () => {
  const h = harness();
  await h.workspace.enable(true); await h.workspace.evaluate(80);
  h.workspace.cancel();
  assert.equal(h.workspace.getPreview(), null);
  assert.equal(await h.workspace.apply(h.editor), false);
  assert.equal(await h.workspace.reset(), true);
  assert.equal(h.workspace.getState().enabled, true);
  assert.equal(h.workspace.getState().strength, 0);
  await h.workspace.enable(false);
  assert.equal(h.workspace.getPreview(), null);
  assert.deepEqual(h.grid(), h.original);
});
for (const change of ['palette-two:size-12:revision-2', 'palette-brand:size-104:revision-3']) {
  test(`in-flight capture invalidation cannot publish stale palette/size ${change}`, async () => {
    const h = harness({ delay: 15 });
    const pending = h.workspace.enable(true);
    h.changeContext(change); h.workspace.invalidate();
    assert.equal(await pending, false);
    assert.equal(h.workspace.getPreview(), null);
    assert.equal(h.workspace.getState().enabled, false);
    assert.deepEqual(h.grid(), h.original);
    assert.equal(h.counts().publications, 0);
  });
}
test('actual capture errors safely disable preview without applying partial state', async () => {
  const h = harness({ captureError: new Error('invalid palette context') });
  assert.equal(await h.workspace.enable(true), false);
  assert.equal(h.workspace.getState().enabled, false);
  assert.match(h.workspace.getState().error, /invalid palette/);
  assert.equal(h.workspace.getPreview(), null);
  assert.deepEqual(h.grid(), h.original);
});
test('rapid real evaluations retain only newest strength result, with no official publication', async () => {
  const h = harness();
  await h.workspace.enable(true);
  const old = h.workspace.evaluate(20), middle = h.workspace.evaluate(80), newest = h.workspace.evaluate(30);
  const outcomes = await Promise.all([old, middle, newest]);
  assert.equal(outcomes.at(-1), true);
  assert.equal(h.workspace.getState().strength, 30);
  assert.equal(h.workspace.getState().stats.strength, 30);
  assert.equal(h.counts().publications, 0);
  assert.deepEqual(h.grid(), h.original);
});
test('invalid strength rejects before modifying the valid preview', async () => {
  const h = harness();
  await h.workspace.enable(true);
  const before = h.workspace.getPreview();
  for (const strength of [-1, 101, NaN]) await assert.rejects(h.workspace.evaluate(strength), /strength/);
  assert.equal(h.workspace.getPreview(), before);
  assert.equal(h.workspace.getState().strength, 0);
});
test('strength changes during initial capture coalesce into the latest ready preview', async () => {
  const h = harness({ delay: 15 });
  const pending = h.workspace.enable(true);
  await h.workspace.evaluate(10);
  await h.workspace.evaluate(80);
  await h.workspace.evaluate(25);
  assert.equal(await pending, true);
  assert.equal(h.workspace.getState().status, 'ready');
  assert.equal(h.workspace.getState().stats.strength, 25);
  assert.equal(h.workspace.getState().hierarchyBuildCount, 1);
  assert.deepEqual(h.grid(), h.original);
});
test('strength changes as asynchronous adoption starts and first build begins do not strand loading', async () => {
  let h, firstBuildChanged = false, adoptionChanged = false;
  h = harness({ size: 52,
    observeCapture: () => queueMicrotask(() => { adoptionChanged = true; void h.workspace.evaluate(40); }),
    observeChange: state => {
      if (state.status === 'building' && state.baselineRevision && !firstBuildChanged) {
        firstBuildChanged = true;
        void h.workspace.evaluate(100);
        void h.workspace.evaluate(30);
      }
    },
  });
  assert.equal(await h.workspace.enable(true), true);
  assert.equal(adoptionChanged, true);
  assert.equal(firstBuildChanged, true);
  assert.equal(h.workspace.getState().status, 'ready');
  assert.equal(h.workspace.getState().stats.strength, 30);
  assert.equal(h.workspace.getState().hierarchyBuildCount, 1);
  assert.equal(h.counts().captures, 1);
  assert.deepEqual(h.grid(), h.original);
});
test('cancel during initial analysis safely clears pending work and re-enable reaches ready', async () => {
  const h = harness({ delay: 15 });
  const pending = h.workspace.enable(true);
  h.workspace.cancel();
  assert.equal(await pending, false);
  assert.equal(h.workspace.getState().status, 'idle');
  assert.equal(h.workspace.getState().enabled, false);
  assert.equal(h.workspace.getPreview(), null);
  assert.equal(await h.workspace.enable(true), true);
  assert.equal(h.workspace.getState().status, 'ready');
  assert.equal(h.workspace.getState().hierarchyBuildCount, 1);
  assert.equal(h.counts().publications, 0);
});
test('hard budget statistics distinguish baseline, tolerance and final colors with protected warning evidence', async () => {
  const h = harness({ maxColors: 1, protectedFixture: true });
  assert.equal(await h.workspace.enable(true), true);
  const stats = h.workspace.getState().stats;
  assert.equal(stats.colorsAfterBudget, 1);
  assert.ok(stats.colorsBefore > stats.colorsAfterBudget);
  assert.equal(stats.colorsAfterTolerance, stats.colorsBefore);
  assert.ok(stats.forcedProtected > 0);
  assert.match(stats.notice, /hard palette budget/);
  assert.deepEqual(h.grid(), h.original);
});
