import test from 'node:test';
import assert from 'node:assert/strict';
import { previewEditorColorReduction } from '../services/editor-color-reduction.mjs';
import { paletteIdOf } from '../services/palette-identity.js';

const color = (id, rgb, code = id) => ({ paletteId: id, code, rgb, hex: '#123456', name: id });

test('preview is immutable, rectangular and keeps empty cells', () => {
  const grid = [[color('black', [0, 0, 0]), null, color('red', [220, 30, 30])], [color('white', [255, 255, 255]), color('pink', [210, 35, 35]), null]];
  const original = structuredClone(grid);
  const result = previewEditorColorReduction(grid, 3);
  assert.deepEqual(grid, original);
  assert.equal(result.beforeColors, 4);
  assert.equal(result.afterColors, 3);
  assert.equal(result.grid[0][1], null);
  assert.equal(result.grid[1][2], null);
  assert.deepEqual(result.grid.map(row => row.length), [3, 3]);
  assert.ok(result.changedCells > 0);
  assert.notEqual(result.grid[0][0], grid[0][0]);
  assert.notEqual(result.grid[0][0].rgb, grid[0][0].rgb);
});

test('same RGB / same displayed code retain separate palette identities before reduction', () => {
  const grid = [[color('brand-a:01', [120, 120, 120], '01'), color('brand-b:01', [120, 120, 120], '01')]];
  const unchanged = previewEditorColorReduction(grid, 2);
  assert.equal(unchanged.beforeColors, 2);
  assert.equal(unchanged.afterColors, 2);
  assert.deepEqual(unchanged.grid, grid);
  const reduced = previewEditorColorReduction(grid, 1);
  assert.equal(reduced.afterColors, 1);
  assert.equal(reduced.changedCells, 1);
  assert.equal(paletteIdOf(reduced.grid[0][0]), paletteIdOf(reduced.grid[0][1]));
  assert.deepEqual(reduced.grid[0][0], reduced.grid[0][1]);
});

test('current-grid neutral anchors survive while an unprotected near red can merge', () => {
  const grid = [[color('black', [0, 0, 0]), color('white', [255, 255, 255]), color('red', [230, 30, 30]), color('near-red', [220, 35, 35])]];
  const result = previewEditorColorReduction(grid, 3);
  assert.equal(result.afterColors, 3);
  assert.equal(result.forcedProtected, 0);
  assert.ok(!result.plan.some(merge => merge.from === 'black' || merge.from === 'white'));
  assert.equal(result.plan[0].from, 'near-red');
});

test('an aggressive target flags protected merges instead of claiming all details protected', () => {
  const result = previewEditorColorReduction([[color('black', [0, 0, 0]), color('white', [255, 255, 255]), color('red', [230, 30, 30])]], 1);
  assert.equal(result.afterColors, 1);
  assert.equal(result.forcedProtected, 2);
  assert.ok(result.plan.every(merge => merge.forcedProtected));
});

test('chain merges do not resurrect an intermediate palette identity', () => {
  const grid = [[color('a', [100, 100, 100]), color('b', [102, 102, 102]), color('c', [105, 105, 105]), color('d', [108, 108, 108])]];
  const result = previewEditorColorReduction(grid, 1);
  assert.equal(result.afterColors, 1);
  assert.equal(new Set(result.grid.flat().map(paletteIdOf)).size, 1);
  for (const merge of result.plan) assert.ok(!result.grid.flat().some(cell => paletteIdOf(cell) === merge.from));
});

test('empty grid, singleton and no-op targets are safe', () => {
  assert.deepEqual(previewEditorColorReduction([], 1).grid, []);
  const grid = [[color('only', [40, 40, 40]), null]];
  const result = previewEditorColorReduction(grid, 10);
  assert.deepEqual(result.grid, grid);
  assert.equal(result.changedCells, 0);
  assert.deepEqual(result.plan, []);
});

test('invalid targets and malformed grid are rejected', () => {
  for (const value of [0, -1, NaN, Infinity, 'bad']) assert.throws(() => previewEditorColorReduction([], value));
  assert.throws(() => previewEditorColorReduction([[null], []], 1));
  assert.throws(() => previewEditorColorReduction([[{ code: 'bad', rgb: [NaN, 1, 2] }]], 1));
});
