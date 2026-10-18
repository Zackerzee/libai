import test from 'node:test';
import assert from 'node:assert/strict';
import { creativePaletteFingerprint, validateCreativeResult, planCreativeGrid } from '../services/creative-tool-result.mjs';

const palette = [{ code: 'H02', paletteId: 'mard', rgb: [255, 255, 255], name: '白' }, { code: 'A01', paletteId: 'mard', rgb: [255, 0, 0] }];
const result = grid => ({ cols: grid[0].length, rows: grid.length, grid });
test('maps exact current palette identity, preserves null and deep clones', () => {
  const mapped = validateCreativeResult(result([['H02', null, 'A01']]), palette);
  assert.deepEqual(mapped.grid, [[palette[0], null, palette[1]]]);
  assert.equal(mapped.coloredCount, 2);
  mapped.grid[0][0].rgb[0] = 0;
  assert.equal(palette[0].rgb[0], 255);
});
test('fingerprint is order independent and identity sensitive even for same RGB', () => {
  assert.equal(creativePaletteFingerprint(palette), creativePaletteFingerprint([...palette].reverse()));
  const other = structuredClone(palette); other[0].paletteId = 'perler';
  assert.notEqual(creativePaletteFingerprint(palette), creativePaletteFingerprint(other));
  other[0].paletteId = 'mard'; other[0].rgb[0] = 254;
  assert.notEqual(creativePaletteFingerprint(palette), creativePaletteFingerprint(other));
});
test('rejects unknown codes, raw objects, empty results and ambiguous code identities', () => {
  for (const grid of [[['H01']], [[{}]], [[null]], [[undefined]]]) assert.throws(() => validateCreativeResult(result(grid), palette));
  assert.throws(() => validateCreativeResult(result([['H02']]), [...palette, { ...palette[0], paletteId: 'other' }]));
});
test('rejects invalid dimensions and malformed rows', () => {
  for (const invalid of [null, {}, { cols: 0, rows: 1, grid: [] }, { cols: 1001, rows: 1, grid: [] }, { cols: 501, rows: 500, grid: [] }, { cols: 1.5, rows: 1, grid: [] }, { cols: 2, rows: 2, grid: [['H02'], ['H02', null]] }]) assert.throws(() => validateCreativeResult(invalid, palette));
  assert.throws(() => validateCreativeResult(result([['H02']]), []));
  assert.throws(() => validateCreativeResult(result([['H02']]), [{ code: 'H02', rgb: [300, 0, 0] }]));
});
test('text overlays centered without null erasure or mutation', () => {
  const current = { width: 3, height: 3, grid: Array.from({ length: 3 }, () => Array.from({ length: 3 }, () => structuredClone(palette[0]))) };
  const before = structuredClone(current);
  const planned = planCreativeGrid(result([['A01', null]]), palette, current, 'text');
  assert.deepEqual(planned.grid[1], [palette[1], palette[0], palette[0]]);
  assert.deepEqual(current, before);
  assert.equal(planned.templateLockedMask, null);
});
test('text expands without cropping existing pixels and respects locks', () => {
  const current = { width: 1, height: 1, grid: [[palette[0]]], templateLockedMask: [[true]] };
  const planned = planCreativeGrid(result([['A01', 'A01', 'A01'], [null, 'A01', null]]), palette, current, 'text');
  assert.equal(planned.width, 3); assert.equal(planned.height, 2);
  assert.deepEqual(planned.grid[0], [palette[0], palette[1], palette[1]]);
  assert.deepEqual(planned.templateLockedMask, [[true, false, false], [false, false, false]]);
  planned.grid[0][0].rgb[0] = 0;
  assert.equal(current.grid[0][0].rgb[0], 255);
});
test('pattern replacement preserves imported dimensions/null and rejects locked work', () => {
  assert.throws(() => planCreativeGrid(result([['A01']]), palette, { templateLockedMask: [[true]] }, 'pattern'), /解除母版锁定/);
  const planned = planCreativeGrid(result([[null, 'A01']]), palette, { templateLockedMask: [[false]] }, 'pattern');
  assert.deepEqual(planned, { grid: [[null, palette[1]]], width: 2, height: 1, templateLockedMask: null });
});
test('empty workspace accepts text and expanded area cannot exceed guard', () => {
  assert.equal(planCreativeGrid(result([['H02']]), palette, {}, 'text').width, 1);
  const current = { width: 1000, height: 250, grid: Array.from({ length: 250 }, () => Array(1000).fill(null)) };
  assert.throws(() => planCreativeGrid(result(Array.from({ length: 1000 }, () => ['H02'])), palette, current, 'text'));
});
