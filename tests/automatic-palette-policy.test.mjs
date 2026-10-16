import test from 'node:test';
import assert from 'node:assert/strict';
import '../services/automatic-palette-policy.js';
import { generateV2 } from '../smart-preprocessing/generation-engine-v2.mjs';
const { automaticPaletteColors: filter, isMardTransparentBead: transparent } = globalThis.LibmsAutomaticPalettePolicy;
const clear = { code: 'H01', sourceCode: 'H1', brand: 'MARD 2026', rgb: [253,251,255] };
const white = { code: 'H02', sourceCode: 'H2', brand: 'MARD 2026', rgb: [254,255,255] };
test('MARD transparent H1/H01 is not an automatic RGB candidate; H02 stays', () => {
  assert.deepEqual(filter([clear, white], 'mard'), [white]);
  assert.equal(transparent({ ...clear, code: 'H1' }, 'mard'), true);
});
test('other brand H01 mapped from C13 is retained', () => {
  const blue = { code: 'H01', sourceCode: 'C13', brand: 'COCO', rgb: [205,232,255] };
  assert.deepEqual(filter([blue], 'coco'), [blue]);
});
test('explicit palette identity wins over current brand context', () => {
  assert.equal(transparent({ ...clear, paletteId: 'coco:H01' }, 'mard'), false);
  assert.equal(transparent({ ...clear, paletteId: 'mard:H01' }, 'coco'), true);
});
test('availability still applies, including transparent-only selection', () => {
  assert.deepEqual(filter([clear, white], 'mard', ['H01']), []);
  assert.deepEqual(filter([clear, white], 'mard', ['H02']), [white]);
  assert.deepEqual(filter([clear, white], 'mard', []), []);
});
test('manual catalog and cell identity are not mutated', () => {
  const palette = [clear,white]; const snapshot = structuredClone(palette);
  assert.equal(filter(palette, 'mard')[0], white);
  assert.deepEqual(palette, snapshot);
  const grid = [[null, clear, white]];
  filter(palette, 'mard'); assert.deepEqual(grid, [[null,clear,white]]);
});
test('V2 generation preserves true alpha null and maps near-white to legal opaque H02', () => {
  const data = new Uint8ClampedArray([253,251,255,0, 253,251,255,255, 254,255,255,255]);
  const result = generateV2({ source: { width:3, height:1, data }, width:3, height:1,
    palette: filter([clear,white], 'mard'), options: { sampling:'average', cleanup:{enabled:false} } });
  assert.equal(result.grid[0][0], null);
  assert.equal(result.grid[0][1].code, 'H02');
  assert.equal(result.grid[0][2].code, 'H02');
});

import { runLocalFusionEngine } from '../services/local-fusion-engine.mjs';
test('native nearest fusion preserves alpha and excludes MARD H01 without deleting white', () => {
  const image = {width:3,height:1,data:new Uint8ClampedArray([253,251,255,0,253,251,255,255,254,255,255,255])};
  const before = new Uint8ClampedArray(image.data);
  const result = runLocalFusionEngine({image,size:{width:3,height:1},mode:'pixel',palette:filter([clear,white],'mard'),maxColors:0,sampler:'fusion-pindou-nearest',overrides:{cleanupStrength:0}});
  assert.equal(result.grid[0][0],null);
  assert.equal(result.grid[0][1].code,'H02');
  assert.equal(result.grid[0][2].code,'H02');
  assert.deepEqual(image.data,before);
});
