import test from 'node:test';
import assert from 'node:assert/strict';
import { getAppliedExportGrid, getAppliedGridUsage, createAppliedExportDebug } from '../services/applied-export-grid.mjs';
import { encodeAppliedGrid, decodeAppliedGrid, restoreProjectArchiveGrid, validateSmartToleranceMetadata } from '../services/applied-project-archive.mjs';
import { createSmartColorTolerance } from '../services/smart-color-tolerance.mjs';
import { assertGridIdentityEqual } from './helpers/assert-grid-identity.mjs';

const palette = [
  { paletteId: 'mard:A01', code: 'A01', rgb: [100, 100, 100], brand: 'mard', metadata: { tags: ['original'] } },
  { paletteId: 'mard:A02', code: 'A02', rgb: [105, 105, 105], brand: 'mard' },
  { paletteId: 'perler:A01', code: 'A01', rgb: [100, 100, 100], brand: 'perler' },
];
const fixture = size => Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x + y) % 17 === 0 ? null : palette[(x + y) % palette.length]));
for (const size of [52, 78, 104, 250, 500]) test(`formal snapshot and project archive preserve exact identity at ${size}`, () => {
  const grid = fixture(size), project = { grid, width: size, height: size, maxColors: 1, previewGrid: [[palette[1]]], smartToleranceCache: {} };
  assertGridIdentityEqual(getAppliedExportGrid(project), grid);
  const archived = JSON.parse(JSON.stringify(encodeAppliedGrid(grid, size, size)));
  assertGridIdentityEqual(decodeAppliedGrid(archived), grid);
  const restored = restoreProjectArchiveGrid({ canvas: { width: size, height: size }, appliedGrid: archived }, { palette: [palette[1]] });
  assertGridIdentityEqual(restored.grid, grid);
  assert.equal(restored.legacyFallbackCount, 0);
});

test('actual V1 preview/apply/undo/redo/manual/cache exports use only formal work', () => {
  const baseline = [[palette[1], palette[1], palette[0], null], [palette[2], palette[0], palette[0], palette[0]]];
  const engine = createSmartColorTolerance({ baselineGrid: baseline, palette, protection: { protectionMap: [1, 0, 0, 0, 1, 0, 0, 0] }, limits: { minBaselineContrast: 100 } });
  const project = { width: 4, height: 2, grid: structuredClone(baseline), maxColors: 1, smartToleranceCache: engine };
  for (const strength of [20, 60, 100]) {
    project.previewGrid = engine.evaluate(strength).grid;
    assertGridIdentityEqual(getAppliedExportGrid(project), baseline);
    project.grid = structuredClone(project.previewGrid);
    const applied = structuredClone(project.grid);
    assertGridIdentityEqual(getAppliedExportGrid(project), applied);
    assert.deepEqual(project.grid[0][0], baseline[0][0], 'protected cell remains exact');
    project.previewGrid = engine.evaluate(80).grid;
    assertGridIdentityEqual(getAppliedExportGrid(project), applied);
    project.smartToleranceCache = null;
    assertGridIdentityEqual(getAppliedExportGrid(project), applied);
    project.grid = structuredClone(baseline); // formal Undo
    assertGridIdentityEqual(getAppliedExportGrid(project), baseline);
    project.grid = structuredClone(applied); // formal Redo
    assertGridIdentityEqual(getAppliedExportGrid(project), applied);
    project.grid[1][1] = structuredClone(palette[2]); // manual edit after Apply
    assert.deepEqual(getAppliedExportGrid(project)[1][1], palette[2]);
    const reload = decodeAppliedGrid(JSON.parse(JSON.stringify(encodeAppliedGrid(project.grid))));
    assertGridIdentityEqual(reload, project.grid);
    project.grid = structuredClone(baseline);
  }
});

test('exports do not mutate formal project and nested metadata is detached', () => {
  const project = { grid: [[palette[0], null]], width: 2, height: 1, config: { maxColors: 1 } };
  const before = structuredClone(project), exported = getAppliedExportGrid(project);
  exported[0][0].metadata.tags.push('changed'); exported[0][0].rgb[0] = 0;
  assert.deepEqual(project, before);
  const repeated = getAppliedExportGrid({ grid: [[palette[0], palette[0]]] });
  repeated[0][0].metadata.tags.push('first-only');
  assert.deepEqual(repeated[0][1].metadata.tags, ['original'], 'repeated nested cells are independently owned');
  const ordinary = { code: 'A03', paletteId: 'mard:A03', rgb: [1, 2, 3], hex: '#010203', note: null, count: 4 };
  const simple = getAppliedExportGrid({ grid: [[ordinary, ordinary]] });
  assert.deepEqual(simple[0][0], ordinary);
  simple[0][0].rgb[0] = 255;
  assert.deepEqual(simple[0][1].rgb, [1, 2, 3]);assert.deepEqual(ordinary.rgb, [1, 2, 3]);
  const decorated = structuredClone(ordinary);decorated.rgb.note = { value: ['keep'] };
  const decoratedCopy = getAppliedExportGrid({ grid: [[decorated]] });
  assert.deepEqual(decoratedCopy[0][0], decorated);
  decoratedCopy[0][0].rgb.note.value.push('copy-only');assert.deepEqual(decorated.rgb.note.value, ['keep']);
  const exotic = { ...ordinary, rgb: [...ordinary.rgb], [Symbol('not-cloned')]: { ignored: true } };
  Object.defineProperty(exotic, 'hidden', { value: { ignored: true }, enumerable: false });
  assert.deepEqual(getAppliedExportGrid({ grid: [[exotic]] })[0][0], structuredClone(exotic));
  const protoKey = JSON.parse('{"code":"A03","paletteId":"mard:A03","rgb":[1,2,3],"__proto__":{"safe":true}}');
  assert.deepEqual(getAppliedExportGrid({ grid: [[protoKey]] })[0][0], structuredClone(protoKey));
  assert.throws(() => getAppliedExportGrid({ grid: [[{ ...ordinary, uncloneable: Symbol('value') }]] }), /clone/i);
});

test('usage preserves distinct brands with identical RGB/code and reflects manual beads', () => {
  const grid = [[palette[0], palette[2], palette[2], null]];
  const usage = getAppliedGridUsage(grid);
  assert.equal(usage.length, 2);
  assert.deepEqual(usage.map(item => [item.paletteId, item.count]), [['mard:A01', 1], ['perler:A01', 2]]);
  usage[0].metadata.tags.push('mutated');
  assert.deepEqual(palette[0].metadata.tags, ['original']);
  assert.throws(() => getAppliedGridUsage([[palette[0], { ...palette[0], rgb: [1, 2, 3] }]]), /Conflicting/);
});

test('export debug observes same applied grid without requiring Smart cache', () => {
  const debug = createAppliedExportDebug({ grid: [[palette[0], palette[2], null]], width: 3, height: 1, workId: 'work', gridRevision: 4, appliedRevision: 'apply-2' }, 'png');
  assert.equal(debug.source, 'applied-grid'); assert.equal(debug.cellCount, 2); assert.equal(debug.colorCount, 2);
  assert.equal(debug.appliedRevision, 'apply-2'); assert.equal(debug.recomputed, false);
});

test('legacy saved RGB precedes current palette; fallback is observable and missing bead fails closed', () => {
  const payload = { canvas: { width: 2, height: 1 }, grid: [['A01', null]], colors: [palette[2]] };
  const restored = restoreProjectArchiveGrid(payload, { palette: [palette[0]] });
  assert.deepEqual(restored.grid[0][0], palette[2]); assert.equal(restored.legacyFallbackCount, 0);
  const fallback = restoreProjectArchiveGrid({ ...payload, colors: [] }, { palette: [palette[0]] });
  assert.equal(fallback.legacyFallbackCount, 1); assert.equal(fallback.source, 'legacy-saved-grid');
  assert.throws(() => restoreProjectArchiveGrid({ ...payload, colors: [] }), /no archived/);
});

test('authoritative archive does not consult ambiguous legacy code grid or active palette', () => {
  const grid = [[palette[0], palette[2], null]];
  const result = restoreProjectArchiveGrid({ canvas: { width: 3, height: 1 }, appliedGrid: encodeAppliedGrid(grid), grid: [['WRONG', 'WRONG', 'WRONG']], colors: [] }, { palette: [] });
  assertGridIdentityEqual(result.grid, grid);
});

test('malformed dimensions/null/rgb/identity and archive indices fail closed', () => {
  for (const grid of [[[undefined]], [[{ ...palette[0], rgb: [NaN, 0, 0] }]], [[{ ...palette[0], rgb: new Array(3) }]], [[{ ...palette[0], paletteId: '' }]], [[palette[0]], []]]) assert.throws(() => getAppliedExportGrid({ grid }));
  assert.throws(() => getAppliedExportGrid({ grid: [[palette[0]]], width: 2, height: 1 }));
  assert.throws(() => getAppliedExportGrid({ grid: [[palette[0]]], width: null, height: 1 }));
  const valid = encodeAppliedGrid([[palette[0], null]]);
  for (const index of [-1, 1, 0.5, undefined]) assert.throws(() => decodeAppliedGrid({ ...valid, rows: [[index, null]] }));
  assert.throws(() => decodeAppliedGrid({ ...valid, cells: [null] }));
  assert.throws(() => decodeAppliedGrid({ ...valid, height: 2 }));
});

test('Smart provenance is minimal and cache/hierarchy are not project data', () => {
  const metadata = { enabled: true, strength: 60, algorithmVersion: 'smart-v1', paletteKey: 'mard:221', baselineRevision: 2, appliedRevision: 'apply-3', hierarchy: [1], cache: {} };
  const clean = validateSmartToleranceMetadata(metadata);
  assert.deepEqual(Object.keys(clean), ['enabled', 'strength', 'algorithmVersion', 'paletteKey', 'baselineRevision', 'appliedRevision']);
  assert.equal(validateSmartToleranceMetadata(null), null);
  for (const change of [{ strength: 101 }, { enabled: 1 }, { paletteKey: '' }, { algorithmVersion: '' }, { appliedRevision: NaN }]) assert.throws(() => validateSmartToleranceMetadata({ ...metadata, ...change }));
});

test('archive returns independently owned cells even when dictionary index is repeated', () => {
  const restored = decodeAppliedGrid(encodeAppliedGrid([[palette[0], palette[0]]]));
  restored[0][0].metadata.tags.push('only-first');
  assert.deepEqual(restored[0][1].metadata.tags, ['original']);
});
