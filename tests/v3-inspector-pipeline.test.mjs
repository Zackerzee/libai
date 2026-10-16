import test from 'node:test';
import assert from 'node:assert/strict';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';

test('opt-in inspector captures real stages without changing production output', () => {
  const data = new Uint8ClampedArray(16 * 16 * 4);
  for (let i = 0; i < 256; i++) data.set([i % 2 ? 255 : 0, i % 3 ? 90 : 220, i % 5 ? 80 : 250, 255], i * 4);
  const palette = [
    { code: 'black', rgb: [0, 0, 0] }, { code: 'white', rgb: [255, 255, 255] },
    { code: 'red', rgb: [255, 90, 80] }, { code: 'green', rgb: [0, 220, 80] },
  ];
  const args = { image: { width: 16, height: 16, data }, size: { width: 8, height: 8 }, palette, mode: 'photo', maxColors: 2 };
  const normal = runGenerationPipeline(args);
  const inspected = runGenerationPipeline({ ...args, inspect: true });
  assert.deepEqual(inspected.grid, normal.grid);
  assert.equal(normal.diagnostics.inspector, undefined);
  const { stages, executionOrder } = inspected.diagnostics.inspector;
  assert.deepEqual(executionOrder, ['S1', 'S2', 'S3', 'S5', 'S4', 'S6']);
  assert.equal(stages.S6.grid, inspected.grid);
  assert.notEqual(stages.S1.source.data, data);
  assert.deepEqual(stages.S1.source.data, data);
  const before = structuredClone(stages.S3.grid);
  const finalCell = inspected.grid.flat().find(Boolean);
  if (finalCell) finalCell.rgb[0] = 123;
  assert.deepEqual(stages.S3.grid, before);
  assert.notEqual(stages.S4.grid, inspected.grid);
});
