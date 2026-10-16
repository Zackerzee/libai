import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseTemplateJson, createTemplateFromGrid, overlayTemplate } from '../services/template-service.mjs';
const red = { code: 'H01', rgb: [255, 0, 0], paletteId: 'brand:H01' };
const blue = { code: 'A02', rgb: [0, 0, 255], paletteId: 'brand:A02' };
const capture = (grid, extra = {}) => createTemplateFromGrid({ grid, paletteKey: 'brand', ...extra });

test('104 x 104 actual archived fixture retains dimensions, colors and nulls', async () => {
  const data = JSON.parse(await readFile(new URL('./fixtures/editor-104x104.libms-project', import.meta.url), 'utf8'));
  const template = parseTemplateJson(data);
  assert.equal(template.width, 104); assert.equal(template.height, 104);
  assert.deepEqual(template.grid.map(row => row.map(c => c?.code ?? null)), data.grid);
  assert.equal(template.grid.flat().filter(Boolean).length, 9604);
});
test('canonical capture round trip is deeply cloned and H01 remains opaque', () => {
  const grid = [[red, null], [blue, red]];
  const template = capture(grid);
  const parsed = parseTemplateJson(JSON.stringify(template));
  assert.equal(parsed.grid[0][0].code, 'H01');
  template.grid[0][0].rgb[0] = 0;
  assert.equal(grid[0][0].rgb[0], 255); assert.equal(parsed.grid[0][0].rgb[0], 255);
});
test('selection crops bounds and respects mask; locked and opaque retain canvas', () => {
  const grid = [[red, blue, null], [blue, red, blue]];
  const selection = capture(grid, { scope: 'selection', selection: { x0: 1, y0: 0, x1: 2, y1: 1, mask: new Set(['1,0', '2,1']) } });
  assert.deepEqual(selection.grid.map(row => row.map(c => c?.code ?? null)), [['A02', null], [null, 'A02']]);
  const locked = capture(grid, { scope: 'locked', lockedMask: new Set(['1,1']) });
  assert.equal(locked.width, 3); assert.equal(locked.height, 2); assert.equal(locked.grid.flat().filter(Boolean).length, 1);
  assert.equal(capture(grid, { scope: 'opaque' }).width, 3);
});
test('overlay clips offsets, skips null and locks, preserves dimensions and clones', () => {
  const template = capture([[red, null], [blue, red]]);
  const target = { paletteKey: 'brand', grid: [[null, blue], [null, null]] };
  const result = overlayTemplate(target, template, { lockedMask: new Set(['0,1']) });
  assert.equal(result.changes, 2); assert.deepEqual(result.mask, [[true, false], [false, true]]);
  assert.equal(result.grid[0][1].code, blue.code); assert.equal(result.grid[1][0], null);
  result.grid[0][0].rgb[0] = 1; assert.equal(template.grid[0][0].rgb[0], 255); assert.equal(target.grid[0][0], null);
  assert.equal(overlayTemplate(target, template, { offsetX: -1, offsetY: -1 }).changes, 1);
  assert.equal(overlayTemplate(target, template, { offsetX: 10 }).changes, 0);
  const identical = overlayTemplate({ paletteKey: 'brand', grid: [[red]] }, capture([[red]]));
  assert.equal(identical.changes, 0); assert.deepEqual(identical.mask, [[true]]);
  const alreadyLocked = overlayTemplate({ paletteKey: 'brand', grid: [[red]] }, capture([[red]]), { lockedMask: [[true]] });
  assert.deepEqual(alreadyLocked.mask, [[false]]);
});
test('strict palette checks reject brands, identity and RGB mismatches', () => {
  const template = capture([[red]]);
  assert.throws(() => parseTemplateJson(template, { paletteKey: 'other' }), /模板色卡与当前画布不一致/);
  assert.throws(() => parseTemplateJson(template, { palette: [{ ...red, paletteId: 'other:H01' }] }));
  assert.throws(() => parseTemplateJson(template, { palette: [{ ...red, rgb: [254, 0, 0] }] }));
  assert.throws(() => overlayTemplate({ paletteKey: 'other', grid: [[null]] }, template));
  assert.equal(parseTemplateJson(template, { palette: [red] }).grid[0][0].paletteId, red.paletteId);
});
test('project references use exact archived identity even when codes collide', () => {
  const data = { format: 'libms-project', version: 1, canvas: { width: 1, height: 1 }, palette: { key: 'mixed' }, colors: [red, { ...blue, code: 'H01' }], grid: [['H01']], gridPaletteIds: [[red.paletteId]] };
  assert.deepEqual(parseTemplateJson(data).grid[0][0].rgb, red.rgb);
  assert.throws(() => parseTemplateJson({ ...data, gridPaletteIds: undefined }));
  assert.throws(() => parseTemplateJson({ ...data, gridPaletteIds: [['missing']] }));
  assert.throws(() => parseTemplateJson({ ...data, gridPaletteIds: [] }));
});
test('identity-free archive accepts only unique exact color with explicit equal palette keys', () => {
  const archived = { code: red.code, rgb: [...red.rgb] };
  const template = capture([[archived]]);
  const parsed = parseTemplateJson(template, { paletteKey: 'brand', palette: [red, blue] });
  assert.equal(parsed.grid[0][0].paletteId, undefined);
  assert.equal(template.grid[0][0].paletteId, undefined);
  assert.throws(() => parseTemplateJson(template, { palette: [red] }));
  assert.throws(() => parseTemplateJson(template, { palette: [archived] }));
  assert.throws(() => parseTemplateJson(template, { paletteKey: 'other', palette: [red] }));
  assert.throws(() => parseTemplateJson(template, { paletteKey: 'brand', palette: [red, { ...red, paletteId: 'other:H01' }] }));
  assert.throws(() => parseTemplateJson(template, { paletteKey: 'brand', palette: [{ ...red, rgb: [254, 0, 0] }] }));
  assert.throws(() => parseTemplateJson(capture([[red]]), { paletteKey: 'brand', palette: [archived] }));
  const result = overlayTemplate({ paletteKey: 'brand', palette: [red], grid: [[null]] }, template);
  assert.equal(result.changes, 1); assert.equal(result.grid[0][0].paletteId, undefined);
});
test('legacy gridData preserves archived RGB and identity without fallback', () => {
  const legacy = { type: 'libai-maker-project', paletteKey: 'brand', width: 2, height: 1, gridData: 'H01|#ff0000|brand:H01,.' };
  const parsed = parseTemplateJson(legacy);
  assert.deepEqual(parsed.grid[0][0].rgb, red.rgb); assert.equal(parsed.grid[0][1], null);
  for (const gridData of ['H01,.', 'H01|#zz0000,.', 'H01|#ff0000,.;.']) assert.throws(() => parseTemplateJson({ ...legacy, gridData }));
});
test('malformed, oversized, nonfinite and unknown inputs reject', () => {
  const template = capture([[red]]);
  for (const input of ['{', null, {}, { ...template, version: 2 }, { ...template, width: 0 }, { ...template, width: Infinity }, { ...template, width: 2049 }, { ...template, height: 1.5 }, { ...template, grid: [[]] }, { ...template, grid: [[undefined]] }, { ...template, grid: [[{ code: 'X', rgb: [NaN, 0, 0] }]] }, { ...template, grid: [[{ code: 'X', rgb: [256, 0, 0] }]] }, { ...template, grid: [[{ code: 'X', rgb: [1, 2, 3], hex: '#ffffff' }]] }]) assert.throws(() => parseTemplateJson(input));
  assert.throws(() => overlayTemplate([[null]], template, { offsetX: 0.5 }), /模板偏移必须为整数格/);
  assert.throws(() => capture([[red]], { scope: 'selection' }));
});
