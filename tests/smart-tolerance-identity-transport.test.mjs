import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationRequest, createGenerationResult, normalizeGenerationCell } from '../services/generation-request.mjs';
import { encodeGenerationResult, decodeGenerationResult } from '../services/generation-result-codec.mjs';

const colors = [
  { paletteId: 'brand-a:A01', code: 'A01', rgb: [240, 230, 210], hex: '#F0E6D2' },
  { paletteId: 'brand-b:A01', code: 'A01', rgb: [240, 230, 210], hex: '#F0E6D2' },
];

test('optional palette identities survive request structured cloning without RGB deduplication', () => {
  const request = createGenerationRequest({ requestId: 1, image: { width: 1, height: 1, data: new Uint8ClampedArray(4) }, size: { width: 10, height: 10 }, palette: colors, overrides: { smartColorTolerance: { enabled: true } } });
  const cloned = structuredClone(request);
  assert.deepEqual(cloned.palette.map(color => color.paletteId), colors.map(color => color.paletteId));
  assert.equal(cloned.palette.length, 2);
  assert.ok(Object.isFrozen(request.palette[0]));
});

test('disabled requests retain historical palette shape even for new branded palettes', () => {
  for (const smartColorTolerance of [undefined, { enabled: false, strength: 100 }]) {
    const request=createGenerationRequest({requestId:1,palette:colors,overrides:{smartColorTolerance}});
    assert.ok(request.palette.every(color=>!Object.hasOwn(color,'paletteId')));
  }
});

test('same code and RGB across brands remain separate through result normalization and codec', () => {
  const result = createGenerationResult({ requestId: 2, width: 3, height: 2, grid: [[colors[0], colors[1], null], [colors[1], null, colors[0]]] });
  assert.equal(result.metrics.usedColors, 2);
  const compact = encodeGenerationResult(result);
  assert.equal(compact.palette.length, 2);
  assert.deepEqual([...compact.indices], [0, 1, -1, 1, -1, 0]);
  const decoded = decodeGenerationResult(structuredClone(compact));
  assert.deepEqual(decoded.grid, result.grid);
  decoded.grid[0][0].rgb[0] = 0;
  assert.equal(decoded.grid[1][2].rgb[0], 240);
  assert.equal(result.grid[0][0].rgb[0], 240);
});

test('legacy cells and palettes do not acquire an optional paletteId field', () => {
  const legacy = { code: 'A01', rgb: [240, 230, 210], hex: '#F0E6D2' };
  assert.deepEqual(normalizeGenerationCell(legacy), legacy);
  const request = createGenerationRequest({ requestId: 1, palette: [legacy] });
  assert.deepEqual(request.palette, [{ ...legacy, name: null }]);
  const result = createGenerationResult({ requestId: 1, width: 2, height: 1, grid: [[legacy, legacy]] });
  const compact = encodeGenerationResult(result);
  assert.deepEqual(compact.palette, [legacy]);
  assert.deepEqual(decodeGenerationResult(compact).grid, result.grid);
  assert.equal(result.metrics.usedColors, 1);
});
