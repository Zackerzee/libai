import test from 'node:test';
import assert from 'node:assert/strict';
import { generateV2 } from '../smart-preprocessing/generation-engine-v2.mjs';
import { createSmartToleranceSession } from '../services/smart-tolerance-session.mjs';

const palette = [
  { code: 'A01', paletteId: 'one:A01', rgb: [120, 120, 120], hex: '#787878', name: 'a' },
  { code: 'A02', paletteId: 'one:A02', rgb: [121, 121, 121], hex: '#797979', name: 'b' },
  { code: 'C01', paletteId: 'one:C01', rgb: [200, 60, 50], hex: '#c83c32', name: 'c' },
];
function run(extra = {}, lab = null) {
  const width = 12, height = 12, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...palette[i % width < 5 ? 0 : i % width < 10 ? 1 : 2].rgb, 255], i * 4);
  return generateV2({ source: { data, width, height }, width, height, palette,
    options: { sampling: 'center', ...extra }, lab });
}
test('default-off generation has no capture fields, hierarchy or tolerance phase', () => {
  const phases = [];
  const output = run({ onPhase: phase => phases.push(phase) });
  assert.equal(output.diagnostics.smartToleranceBaselineCapture, undefined);
  assert.equal(output.diagnostics.smartToleranceHierarchy, undefined);
  assert.equal(output.diagnostics.smartToleranceBaseline, undefined);
  assert.equal(phases.includes('smart-color-tolerance'), false);
});
test('capture-only preserves exact legacy budget output and untouched pre-budget evidence', () => {
  for (const maxColors of [0, 1, 2]) {
    const phases = [];
    const output = run({ maxColors, smartToleranceCaptureBaseline: true,
      smartToleranceBaselineRevision: 'request-1:revision-3', smartToleranceContext: { requestId: 1, gridRevision: 3 },
      onPhase: phase => phases.push(phase) });
    assert.deepEqual(output.grid, run({ maxColors }).grid);
    const baseline = output.diagnostics.smartToleranceBaselineCapture;
    assert.deepEqual(baseline.grid, run().grid);
    assert.equal(baseline.baselineRevision, 'request-1:revision-3');
    assert.deepEqual(baseline.context, { requestId: 1, gridRevision: 3 });
    assert.equal(baseline.budgetConfig.maxColors, maxColors);
    assert.equal(output.diagnostics.smartToleranceHierarchy, undefined);
    assert.equal(output.diagnostics.smartColorTolerance, undefined);
    assert.equal(phases.includes('smart-color-tolerance'), false);
  }
});
test('capture-only rejects accidentally requesting old synchronous enabled pipeline', () => {
  assert.throws(() => run({ smartToleranceCaptureBaseline: true, smartColorTolerance: { enabled: true, strength: 60 } }), /Capture-only/);
});
test('capture occurs after optional spatial refine and before hard budget', () => {
  const refined = [[structuredClone(palette[0]), structuredClone(palette[2])],
    [null, structuredClone(palette[1])]];
  const output = run({ maxColors: 1, smartToleranceCaptureBaseline: true },
    { id: 'capture-test', refineGrid: () => structuredClone(refined) });
  assert.deepEqual(output.diagnostics.smartToleranceBaselineCapture.grid, refined);
  assert.equal(output.diagnostics.colorsBeforeBudget, 3);
  assert.equal(output.diagnostics.colorsAfterBudget, 1);
  assert.equal(output.grid[1][0], null);
});
test('detached captured baseline can be asynchronously owned and evaluated without regeneration', async () => {
  const output = run({ maxColors: 0, smartToleranceCaptureBaseline: true, smartToleranceBaselineRevision: 'p4:1' });
  const capture = output.diagnostics.smartToleranceBaselineCapture;
  const profiles = [], commits = [];
  const session = createSmartToleranceSession({ buildMode: 'async', isCurrent: () => true,
    onBuildProfile: profile => profiles.push(profile), commit: result => commits.push(result) });
  await session.adoptBaselineAsync(capture, capture.context, null, { requestId: 1 });
  await session.evaluate({ strength: 60, requestId: 1, baselineRevision: 'p4:1' });
  assert.equal(profiles.length, 2); // cooperative adoption and hierarchy build
  assert.equal(commits.length, 1);
  const original = structuredClone(capture.grid);
  capture.grid[0][0].code = 'edited-later';
  const zero = await session.evaluate({ strength: 0, requestId: 1, baselineRevision: 'p4:1' });
  assert.deepEqual(zero.grid, original);
  assert.equal(profiles.length, 2);
});
