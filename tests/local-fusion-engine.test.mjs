import test from 'node:test';
import assert from 'node:assert/strict';
import { downsample } from '../src/algorithms/pindou-full/quantize.mjs';
import { LOCAL_FUSION_SAMPLERS, sampleGridLocalFusion } from '../smart-preprocessing/local-fusion-sampler.mjs';
import { generateV2, SAMPLING_CONFIG_V2 } from '../smart-preprocessing/generation-engine-v2.mjs';
import { runGenerationPipeline } from '../services/generation-pipeline.mjs';
import { runLocalFusionEngine, selectLocalFusionStrategy } from '../services/local-fusion-engine.mjs';

const palette = [{ code: 'dark', rgb: [16, 16, 16] }, { code: 'skin', rgb: [220, 170, 140] }, { code: 'white', rgb: [255, 255, 255] }];
function fixture(width = 8, height = 6) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const rgb = x === 3 && y === 2 ? palette[0].rgb : x < width / 2 ? palette[1].rgb : palette[2].rgb;
    data.set([...rgb, x === 0 ? 0 : 255], (y * width + x) * 4);
  }
  return { data, width, height };
}
for (const name of LOCAL_FUSION_SAMPLERS) test(`${name}: native raw parity, bounds, alpha and source immutability`, () => {
  const source = fixture(), before = source.data.slice();
  for (const [w, h] of [[1, 1], [4, 3], [12, 9]]) {
    const actual = sampleGridLocalFusion(source, w, h, name, SAMPLING_CONFIG_V2);
    const expected = downsample(source.data, source.width, source.height, w, h, name.slice('fusion-pindou-'.length), 1);
    assert.equal(actual.colors.length, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      assert.deepEqual(actual.colors[y][x], expected[i + 3] <= 8 ? null : { r: expected[i], g: expected[i + 1], b: expected[i + 2] });
      assert.ok(Number.isFinite(actual.features[y][x].bounds.x0));
    }
    assert.deepEqual(actual, sampleGridLocalFusion(source, w, h, name, SAMPLING_CONFIG_V2));
  }
  assert.deepEqual(source.data, before);
});
test('transparent source stays null through all native samplers and V2', () => {
  const source = fixture(); source.data.fill(0);
  for (const name of LOCAL_FUSION_SAMPLERS) {
    const result = generateV2({ source, width: 3, height: 2, palette, options: { experimentalSampler: name } });
    assert.ok(result.grid.flat().every(cell => cell === null));
  }
});
test('named pipeline outputs are deterministic and use legal palette colors', () => {
  const request = { image: fixture(), size: { width: 4, height: 3 }, palette };
  for (const sampler of LOCAL_FUSION_SAMPLERS) {
    const a = runLocalFusionEngine({ ...request, sampler }), b = runLocalFusionEngine({ ...request, sampler });
    assert.deepEqual(a.grid, b.grid);
    for (const cell of a.grid.flat().filter(Boolean)) assert.ok(palette.some(p => p.code === cell.code && p.rgb.every((v, i) => v === cell.rgb[i])));
    assert.equal(a.diagnostics.experimentalSampler.quantization, 'v2-palette-engine-only');
  }
});
test('explicit baseline equals existing pipeline, and auto is confidence gated', () => {
  const request = { image: fixture(), size: { width: 4, height: 3 }, palette };
  assert.deepEqual(runLocalFusionEngine({ ...request, sampler: 'v2-baseline' }).grid, runGenerationPipeline(request).grid);
  for (const mode of ['pixel', 'logo']) {
    assert.equal(selectLocalFusionStrategy({ routing: { mode, confidence: 0.75 } }).sampler, mode === 'pixel' ? 'fusion-pixel-art-fixer' : 'fusion-image-to-pixel');
    assert.equal(selectLocalFusionStrategy({ routing: { mode, confidence: 0.74 } }).sampler, null);
  }
  for (const mode of ['portrait', 'anime', 'illustration', 'photo', 'auto']) assert.equal(selectLocalFusionStrategy({ routing: { mode, confidence: 1 } }).sampler, null);
});
test('unknown fusion namespace fails loudly in adapter, runner and direct V2', () => {
  assert.throws(() => sampleGridLocalFusion(fixture(), 2, 2, 'fusion-pindou-missing'), RangeError);
  assert.throws(() => runLocalFusionEngine({ image: fixture(), sampler: 'fusion-pindou-missing' }), RangeError);
  assert.throws(() => generateV2({ source: fixture(), width: 2, height: 2, palette, options: { experimentalSampler: 'fusion-pindou-missing' } }), RangeError);
});
