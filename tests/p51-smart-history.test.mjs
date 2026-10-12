import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartToleranceHistory } from '../services/smart-tolerance-history.mjs';

const color = (brand, code, rgb) => ({ paletteId: `${brand}:${code}`, code, rgb, extra: undefined });
test('compact history preserves full metadata, brands, undefined, null and exact replay', async () => {
  const a = color('A', 'H02', [255, 255, 255]), b = color('B', 'H02', [255, 255, 255]);
  a.metadata = { tags: ['skin', undefined], weight: -0 };
  const before = [[a, b, null], [structuredClone(a), null, b]];
  const after = structuredClone(before); after[0][0] = color('A', 'H07', [0, 0, 0]);
  const history = await createSmartToleranceHistory(before, after);
  assert.deepEqual(history.restore('before'), before); assert.deepEqual(history.restore('after'), after);
  assert.equal(history.metrics.changedCellCount, 1); assert.equal(history.metrics.objectSnapshotCount, 0);
  before[1][0].rgb[0] = 12; after[0][0].rgb[0] = 12;
  assert.equal(history.restore('before')[1][0].rgb[0], 255);
  assert.equal(history.restore('after')[0][0].rgb[0], 0);
  const restored = history.restore('before'); restored[0][0].rgb[0] = 9;
  assert.equal(restored[1][0].rgb[0], 255);
  assert.equal(history.restore('before')[0][0].rgb[0], 255);
});
test('undefined differs from omitted metadata and sparse metadata remains sparse', async () => {
  const first = { code: 'A', rgb: [1, 2, 3], data: new Array(2) };
  const second = { ...first, extra: undefined, data: [undefined, undefined] };
  const history = await createSmartToleranceHistory([[first]], [[second]]);
  assert.deepEqual(history.restore('before'), [[first]]);
  assert.deepEqual(history.restore('after'), [[second]]);
  assert.equal(history.metrics.changedCellCount, 1);
});
test('cyclic aliases and exotic metadata survive fresh independent restoration', async () => {
  const metadata = { kind: 'detail' }; metadata.self = metadata;
  const map = new Map([['date', new Date('2026-10-11T00:00:00Z')]]);
  const cell = { code: 'A01', paletteId: 'A:A01', rgb: [1, 2, 3], metadata, map, secondMap: map };
  const history = await createSmartToleranceHistory([[cell]], [[cell]]);
  const restored = history.restore('before');
  assert.deepEqual(restored, [[cell]]);
  assert.equal(restored[0][0].metadata.self, restored[0][0].metadata);
  assert.equal(restored[0][0].map, restored[0][0].secondMap);
  restored[0][0].map.set('new', 1);
  assert.equal(history.restore('before')[0][0].map.has('new'), false);
});
test('compact construction cooperatively cancels without exposing a payload', async () => {
  let active = true, yields = 0;
  const grid = Array.from({ length: 52 }, () => Array.from({ length: 52 }, () => color('A', 'A01', [1, 2, 3])));
  assert.equal(await createSmartToleranceHistory(grid, grid, { isCurrent: () => active,
    yieldTask: async () => { yields++; active = false; } }), null);
  assert.equal(yields, 1);
});
test('after statistics reuse the compact pass and preserve established code grouping and order', async () => {
  const a = color('A', 'H02', [255, 255, 255]), b = color('B', 'H02', [255, 255, 255]);
  const c = color('A', 'A01', [1, 2, 3]), d = color('A', 'A02', [4, 5, 6]);
  const grid = [[a, b, null], [c, d, null]];
  const history = await createSmartToleranceHistory(grid, grid);
  assert.deepEqual(history.afterStats, [{ ...a, count: 2 }, { ...c, count: 1 }, { ...d, count: 1 }]);
  assert.equal(history.metrics.nonEmptyCellCount, 4);
  const stats = history.afterStats; stats[0].rgb[0] = 0; stats[0].count = 900;
  assert.equal(history.afterStats[0].rgb[0], 255); assert.equal(history.afterStats[0].count, 2);
  assert.deepEqual(history.restore('after'), grid);
});
test('500 compact payload retains one ID baseline and sparse overrides, no object grids', async () => {
  const a = color('A', 'A01', [1, 2, 3]), b = color('A', 'A02', [2, 3, 4]);
  const before = Array.from({ length: 500 }, () => Array(500).fill(a));
  const after = before.map(row => row.slice()); after[1][1] = b;
  const history = await createSmartToleranceHistory(before, after);
  assert.equal(history.metrics.changedCellCount, 1);
  assert.equal(history.metrics.dictionaryCellCount, 2);
  assert.ok(history.metrics.historyPayloadBytes < 1_010_000);
  assert.deepEqual(history.restore('after'), after);
  assert.equal(history.metrics.objectSnapshotCount, 0);
});
