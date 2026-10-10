import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartColorTolerance } from '../services/smart-color-tolerance.mjs';
import { paletteIdOf } from '../services/palette-identity.js';
import { candidateCost } from '../services/smart-color-tolerance-quality.mjs';
import { rgbToLab } from '../smart-preprocessing/palette-engine.mjs';
import { ProtectionTier } from '../smart-preprocessing/detail-protection-v2.mjs';

const color = (id, rgb, brand = 'one') => ({ paletteId: `${brand}:${id}`, code: id, rgb, brand, metadata: { value: [1] } });
const palette = [color('A', [100, 100, 100]), color('B', [110, 110, 110]), color('C', [120, 120, 120])];
const grid = [[palette[0], palette[1], null], [palette[2], palette[1], palette[0]]];
const make = (extra = {}) => createSmartColorTolerance({ baselineGrid: grid, palette, protection: { protectionMap: new Float32Array(6) }, limits: { minBaselineContrast: 100 }, ...extra });

test('strength zero is exact baseline, including nested data and null', () => {
  const result = make().evaluate(0);
  assert.equal(result.protectedConflictCount, 0);
  assert.deepEqual(result.grid, grid);
  result.grid[0][0].metadata.value[0] = 99;
  assert.equal(grid[0][0].metadata.value[0], 1);
});
test('protected conflict count uses retained identities, not step or cell counts', () => {
  const p = [color('A', [100, 100, 100]), color('B', [105, 105, 105])];
  const engine = createSmartColorTolerance({ baselineGrid: [[p[0], p[1], p[1], p[1]]], palette: p,
    protection: { protectionMap: [0, 1, 1, 0] }, limits: { minBaselineContrast: 100 } });
  const result = engine.evaluate(100);
  assert.equal(result.protectedConflictCount, 1);
  const reason = result.reasons.find(r => r.reason === 'protected-color-retained');
  assert.equal(reason.retainedCells, 2);
  assert.equal(result.grid[0][1].paletteId, p[1].paletteId);
  assert.equal(result.grid[0][3].paletteId, p[0].paletteId);
  assert.equal(result.finalColorCount, 2);
});
test('deterministic and palette input order independent', () => {
  assert.deepEqual(make().getHierarchy(), make({ palette: [...palette].reverse() }).getHierarchy());
  assert.deepEqual(make().evaluate(100), make().evaluate(100));
});
test('every integer strength is monotonic and preserves legal identity, shape and beads', () => {
  const engine = make(); let previous = 3;
  for (let strength = 0; strength <= 100; strength++) {
    const result = engine.evaluate(strength);
    assert.ok(result.finalColorCount <= previous); previous = result.finalColorCount;
    assert.equal(result.grid.length, 2);
    assert.equal(result.grid.flat().filter(Boolean).length, 5);
    result.grid.forEach((row, y) => row.forEach((cell, x) => {
      assert.equal(cell === null, grid[y][x] === null);
      if (cell) assert.deepEqual(palette.find(p => p.paletteId === cell.paletteId), cell);
    }));
  }
  assert.ok(previous < 3);
});
test('direct mappings contain no cycles or recursive A to B to C drift', () => {
  const engine = make({ limits: { maxDeltaE: 6, maxDeltaL: 6, minBaselineContrast: 100 } });
  assert.ok(engine.getHierarchy().length > 0);
  for (const step of engine.getHierarchy()) {
    for (const [source, target] of Object.entries(step.mapping)) {
      assert.equal(step.mapping[target], target);
      const metric = candidateCost(rgbToLab(palette.find(p => p.paletteId === source).rgb), rgbToLab(palette.find(p => p.paletteId === target).rgb), { maxDeltaE: 6, maxDeltaL: 6 });
      assert.ok(metric.cost <= 1);
    }
  }
});
test('color encounter order does not affect representative selection without spatial gates', () => {
  const a = make({ baselineGrid: [palette], protection: { protectionMap: [0, 0, 0] } }).evaluate(100);
  const b = make({ baselineGrid: [[...palette].reverse()], protection: { protectionMap: [0, 0, 0] } }).evaluate(100);
  assert.deepEqual(a.mapping, b.mapping);
  assert.equal(a.finalColorCount, b.finalColorCount);
});
test('local protected original is retained while unprotected copies may change', () => {
  const p = [palette[0], palette[1]], g = [[p[1], p[1], p[0]]];
  const result = createSmartColorTolerance({ palette: p, baselineGrid: g, protection: { protectionMap: [1, 0, 0] }, limits: { minBaselineContrast: 100 } }).evaluate(100);
  assert.deepEqual(result.grid[0][0], p[1]);
  assert.deepEqual(result.grid[0][1], p[0]);
  assert.equal(result.finalColorCount, 2);
  assert.equal(result.protectedConflictCount, 1);
  assert.deepEqual(result.protectedCells, [{ x: 0, y: 0, paletteId: p[1].paletteId }]);
});
test('same RGB identities without brand metadata also stay distinct', () => {
  const p = [{ paletteId: 'one:A', code: 'A', rgb: [100, 100, 100] }, { paletteId: 'two:A', code: 'A', rgb: [100, 100, 100] }];
  const result = createSmartColorTolerance({ palette: p, baselineGrid: [p], protection: { protectionMap: [0, 0] } }).evaluate(100);
  assert.equal(result.finalColorCount, 2);
});
test('third nearby representative cannot bypass equal RGB identity separation', () => {
  const p = [color('A', [100, 100, 100], 'one'), color('A', [100, 100, 100], 'two'), color('C', [101, 101, 101], 'third')];
  const result = createSmartColorTolerance({ palette: p, baselineGrid: [p], protection: { protectionMap: [0, 0, 0] }, limits: { minBaselineContrast: 100 } }).evaluate(100);
  assert.notEqual(result.mapping[p[0].paletteId], result.mapping[p[1].paletteId]);
  assert.ok(result.finalColorCount >= 2);
});
test('invalid frozen maps and empty-grid limits fail closed', () => {
  assert.throws(() => make({ protection: {} }), TypeError);
  assert.throws(() => make({ protection: { accidental: [0, 0, 0, 0, 0, 0] } }), TypeError);
  assert.throws(() => make({ protection: { protectionMap: [NaN, 0, 0, 0, 0, 0] } }), TypeError);
  assert.throws(() => make({ protection: { tierMap: [1.5, 0, 0, 0, 0, 0] } }), TypeError);
  assert.throws(() => createSmartColorTolerance({ baselineGrid: [], palette: [], limits: { maxDeltaE: -1 } }), RangeError);
});
test('frozen protection preserves selected cell and ignores later mutations', () => {
  const protectionMap = new Float32Array([1, 0, 0, 0, 0, 0]);
  const engine = make({ protection: { protectionMap } });
  const before = engine.evaluate(100);
  protectionMap.fill(0);
  assert.deepEqual(engine.evaluate(100), before);
  assert.deepEqual(before.grid[0][0], grid[0][0]);
});
test('existing critical tier 4 is accepted and never remapped', () => {
  const engine = make({ protection: { tierMap: new Uint8Array([ProtectionTier.CRITICAL, 0, 0, 0, 0, 0]) } });
  assert.deepEqual(engine.evaluate(100).grid[0][0], grid[0][0]);
  assert.throws(() => make({ protection: { tierMap: [5, 0, 0, 0, 0, 0] } }), TypeError);
  assert.throws(() => make({ protection: { protectionMap: false, tierMap: [0, 0, 0, 0, 0, 0] } }), TypeError);
});
test('repeated zero/high strength and returned hierarchy edits cannot accumulate damage', () => {
  const engine = make(), high = engine.evaluate(100);
  engine.getHierarchy().forEach(s => { s.mapping = {}; });
  for (let i = 0; i < 20; i++) {
    assert.deepEqual(engine.evaluate(0).grid, grid);
    assert.deepEqual(engine.evaluate(100), high);
  }
});
test('same RGB from different brands keeps separate palette identities', () => {
  const p = [color('A', [100, 100, 100], 'one'), color('A', [100, 100, 100], 'two')];
  const engine = createSmartColorTolerance({ palette: p, baselineGrid: [p], protection: { protectionMap: [0, 0] } });
  assert.equal(engine.evaluate(100).finalColorCount, 2);
  assert.ok(engine.evaluate(100).reasons.some(r => r.reason === 'distinct-identity-identical-rgb'));
});
test('local contrast protects distinct neighboring detail', () => {
  const result = createSmartColorTolerance({ palette, baselineGrid: [palette], protection: { protectionMap: [0, 0, 0] } }).evaluate(100);
  assert.ok(result.finalColorCount > 1);
  assert.ok(result.reasons.some(r => r.reason === 'local-contrast'));
});
test('baseline and palette are deep snapshots', () => {
  const p = structuredClone(palette), g = structuredClone(grid);
  const engine = make({ palette: p, baselineGrid: g });
  const before = engine.evaluate(100);
  p[0].rgb.fill(255); g[0][0].rgb.fill(0); g[0][0].metadata.value.push(5);
  assert.deepEqual(engine.evaluate(100), before);
});
test('malformed baseline, duplicate identity, and invalid strength reject explicitly', () => {
  assert.throws(() => make({ baselineGrid: new Array(1) }), TypeError);
  assert.throws(() => make({ baselineGrid: [new Array(1)] }), TypeError);
  assert.throws(() => make({ baselineGrid: [[palette[0]], []] }), TypeError);
  assert.throws(() => make({ palette: [...palette, palette[0]] }), TypeError);
  assert.throws(() => make({ baselineGrid: [[{ ...palette[0], rgb: [0, 0, 0] }]] }), TypeError);
  assert.throws(() => make().evaluate(101), RangeError);
  assert.throws(() => make().evaluate(NaN), RangeError);
});
test('empty and single-color grids remain unchanged', () => {
  const empty = createSmartColorTolerance({ baselineGrid: [], palette: [] });
  assert.deepEqual(empty.evaluate(100).grid, []);
  assert.equal(empty.evaluate(100).finalColorCount, 0);
  const single = createSmartColorTolerance({ baselineGrid: [[palette[0]]], palette });
  assert.equal(single.evaluate(100).finalColorCount, 1);
});
