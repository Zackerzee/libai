import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartColorTolerance, restoreSmartColorTolerance } from '../services/smart-color-tolerance.mjs';

const base = () => ({ paletteId: 'brand:A', code: 'A', rgb: [100, 101, 102] });
const variants = {
  'scalar undefined null and bigint': cell => Object.assign(cell, { missing: undefined, empty: null, large: 9007199254740993n, bool: false }),
  'own proto scalar': cell => Object.defineProperty(cell, '__proto__', { value: 'own property', enumerable: true, writable: true }),
  'Map metadata': cell => Object.assign(cell, { metadata: new Map([['nested', { x: 1 }]]) }),
  'Date metadata': cell => Object.assign(cell, { metadata: new Date('2026-10-10T00:00:00Z') }),
  'typed metadata': cell => Object.assign(cell, { metadata: new Uint8Array([1, 2, 3]) }),
  'circular metadata': cell => { cell.metadata = { owner: cell }; return cell; },
  'RGB extra property': cell => { cell.rgb.note = 'retained'; return cell; },
  'RGB alias': cell => Object.assign(cell, { alias: cell.rgb }),
};

for (const [name, decorate] of Object.entries(variants)) test(`materialization preserves structuredClone semantics: ${name}`, () => {
  const cell = decorate(base()), palette = [cell], baselineGrid = [[cell, cell]];
  const controller = createSmartColorTolerance({ baselineGrid, palette, protection: { protectionMap: [0, 1] } });
  for (const engine of [controller, restoreSmartColorTolerance({ baselineGrid, palette, compiled: controller.getCompiledHierarchy() })]) {
    for (const strength of [0, 100, 0]) {
      const result = engine.evaluate(strength);
      assert.deepEqual(result.grid[0][0], structuredClone(cell));
      assert.deepEqual(result.grid[0][1], structuredClone(cell));
      assert.notEqual(result.grid[0][0], result.grid[0][1]);
      assert.notEqual(result.grid[0][0].rgb, result.grid[0][1].rgb);
      result.grid[0][0].rgb[0] = 0;
      assert.deepEqual(engine.evaluate(strength).grid[0][0], structuredClone(cell));
    }
  }
});

test('same identity retains distinct per-cell metadata and scalar shapes', () => {
  const paletteCell = base(), first = { ...base(), scalar: 1 }, second = { ...base(), metadata: { scalar: 2 } };
  const engine = createSmartColorTolerance({ baselineGrid: [[first, second]], palette: [paletteCell], protection: { protectionMap: [0, 0] } });
  assert.deepEqual(engine.evaluate(100).grid, [[first, second]]);
  const output = engine.evaluate(0); output.grid[0][1].metadata.scalar = 99;
  assert.equal(engine.evaluate(0).grid[0][1].metadata.scalar, 2);
});

test('profiling opt-in changes no hierarchy or evaluation output', () => {
  const a = base(), b = { ...base(), paletteId: 'brand:B', code: 'B', rgb: [102, 103, 104] };
  const input = { baselineGrid: [[a, b, null]], palette: [a, b], protection: { protectionMap: [0, 0, 1] } };
  let profile;
  const plain = createSmartColorTolerance(input), profiled = createSmartColorTolerance({ ...input, onProfile: value => { profile = value; } });
  assert.deepEqual(profiled.getCompiledHierarchy(), plain.getCompiledHierarchy());
  for (const strength of [0, 20, 50, 80, 100]) assert.deepEqual(profiled.evaluate(strength), plain.evaluate(strength));
  assert.equal(profile.materializedBuildGrids, 0);
  assert.equal(profile.cellCount, 3);
  assert.equal(profile.protectedCellCount, 1);
});
