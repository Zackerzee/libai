import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import color from '../src/algorithms/pindou-full/color.mjs';
import quantize from '../src/algorithms/pindou-full/quantize.mjs';

const referenceRoot = new URL('../vendor/pindou/reference/', import.meta.url);
const source = name => readFileSync(new URL(name, referenceRoot), 'utf8');
const context = vm.createContext({});
for (const name of ['color', 'palettes', 'quantize']) {
  vm.runInContext(source(`js/${name}.js`), context, { filename: `reference/${name}.js` });
}
const reference = context.PD;
const plain = value => {
  if (ArrayBuffer.isView(value) || Array.isArray(value)) return Array.from(value, plain);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, plain(v)]));
  return value;
};
const equal = (a, b) => assert.deepEqual(plain(a), plain(b));

function image(w, h, alpha = true) {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    out[i] = (x * 13 + y * 31) % 256;
    out[i + 1] = (x * 7 + y * 29) % 256;
    out[i + 2] = (x * 19 + y * 3) % 256;
    out[i + 3] = !alpha ? 255 : [0, 7, 64, 127, 128, 200, 255][(x + y) % 7];
  }
  return out;
}

for (const name of ['color', 'quantize']) {
  test(`${name}: upstream algorithm body remains byte-for-byte unchanged`, () => {
    const port = readFileSync(new URL(`../src/algorithms/pindou-full/${name}.mjs`, import.meta.url), 'utf8');
    const original = source(`js/${name}.js`);
    assert.ok(port.includes(original.replace("})(typeof window !== 'undefined' ? window : this);", '})(privateHost);')));
    assert.ok(port.includes('Copyright (c) 2026 Hon-Wong'));
    assert.ok(port.includes('ad668369a648027208ed188e44322a868a67f6a9'));
  });
}

test('ESM imports do not publish a PD global', () => {
  assert.equal(Object.hasOwn(globalThis, 'PD'), false);
});

test('all original unit.js checks pass against the ESM algorithms', () => {
  const logs = [];
  const sandbox = vm.createContext({ PD: { color, quantize }, print: line => logs.push(line) });
  sandbox.load = name => {
    if (name.endsWith('/palettes.js')) vm.runInContext(source('js/palettes.js'), sandbox);
    else if (!/\/(color|quantize)\.js$/.test(name)) throw new Error(`Unexpected reference module ${name}`);
  };
  vm.runInContext(source('tests/unit.js'), sandbox, { timeout: 15000 });
  assert.equal(sandbox.fails, 0, logs.filter(line => line.startsWith('FAIL')).join('\n'));
  assert.ok(logs.filter(line => line.startsWith('ok')).length >= 50);
});

const officialVectors = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  [[22.7233, 20.0904, -46.694], [23.0331, 14.973, -42.5619], 2.0373],
  [[2.0776, 0.0795, -1.135], [0.9033, -0.0636, -0.5514], 0.9082]
];
officialVectors.forEach(([a, b, expected], i) => test(`CIEDE2000 Sharma official vector ${i + 1}`, () => {
  assert.ok(Math.abs(color.deltaE2000(...a, ...b) - expected) < 0.0002);
  assert.equal(color.deltaE2000(...a, ...b), reference.color.deltaE2000(...a, ...b));
}));

const samplers = ['area', 'nearest', 'dominant', 'edge', 'dpid', 'ssim'];
for (const mode of samplers) {
  for (const [sw, sh, tw, th] of [[31, 17, 7, 5], [1, 19, 1, 3], [3, 2, 9, 7]]) {
    test(`${mode}: reference equality mixed alpha ${sw}x${sh} → ${tw}x${th}`, () => {
      const input = image(sw, sh), saved = input.slice();
      const actual = quantize.downsample(input, sw, sh, tw, th, mode, 1);
      equal(actual, reference.quantize.downsample(input, sw, sh, tw, th, mode, 1));
      assert.equal(actual.length, tw * th * 4);
      assert.ok(actual.every(Number.isFinite));
      equal(input, saved);
    });
  }
  test(`${mode}: fully transparent reference semantics`, () => {
    const input = image(8, 8);
    for (let i = 3; i < input.length; i += 4) input[i] = 0;
    const output = quantize.downsample(input, 8, 8, 2, 2, mode);
    equal(output, reference.quantize.downsample(input, 8, 8, 2, 2, mode));
    for (let i = 3; i < output.length; i += 4) assert.equal(output[i], 0);
  });
}

test('area premultiplied alpha does not inject transparent black into visible red', () => {
  equal(quantize.downsample(new Uint8ClampedArray([255, 0, 0, 255, 0, 0, 0, 0]), 2, 1, 1, 1, 'area'), [255, 0, 0, 127.5]);
});

test('edge reference intentionally retains first-256-valid-pixel scan bias', () => {
  const input = new Uint8ClampedArray(32 * 32 * 4);
  for (let p = 0; p < 1024; p++) { input[p * 4] = p < 256 ? 255 : 0; input[p * 4 + 3] = 255; }
  const actual = quantize.downsample(input, 32, 32, 1, 1, 'edge');
  equal(actual, reference.quantize.downsample(input, 32, 32, 1, 1, 'edge'));
  assert.equal(actual[0], 255);
  assert.notEqual(actual[0], quantize.downsample(input, 32, 32, 1, 1, 'area')[0]);
});

for (const lambda of [0, 0.001, 0.5, 1, 2, 3]) test(`DPID lambda=${lambda} preserves reference and does not mutate input`, () => {
  const input = image(31, 17), original = input.slice();
  const actual = quantize.downsample(input, 31, 17, 7, 5, 'dpid', lambda);
  equal(actual, reference.quantize.downsample(input, 31, 17, 7, 5, 'dpid', lambda));
  if (lambda <= 0.001) equal(actual, quantize.downsample(input, 31, 17, 7, 5, 'area'));
  equal(input, original);
});

for (const sampleMode of samplers) for (const quantMode of ['kmeans', 'medianCut']) for (const dither of ['none', 'fs', 'ordered']) {
  test(`${sampleMode} × ${quantMode} × ${dither}: centers/palette/indices exactly equal reference`, () => {
    const input = image(40, 24), palette = reference.palettes.get('mard221').colors;
    const grid = quantize.downsample(input, 40, 24, 10, 6, sampleMode, 1);
    const refGrid = reference.quantize.downsample(input, 40, 24, 10, 6, sampleMode, 1);
    equal(grid, refGrid);
    const samples = quantize.collectLab(grid, 10, 6, 128, 24000);
    const refSamples = reference.quantize.collectLab(refGrid, 10, 6, 128, 24000);
    equal(samples, refSamples);
    const cluster = quantize[quantMode](samples.lab, samples.n, 6, 26, 20240815);
    const refCluster = reference.quantize[quantMode](refSamples.lab, refSamples.n, 6, 26, 20240815);
    equal(cluster, refCluster);
    equal(cluster, quantize[quantMode](samples.lab, samples.n, 6, 26, 20240815));
    const selected = quantize.centersToPalette(cluster.centers, cluster.k, cluster.weights, palette, true);
    const refSelected = reference.quantize.centersToPalette(refCluster.centers, refCluster.k, refCluster.weights, palette, true);
    equal(selected, refSelected);
    const subset = quantize.refinePalette(grid, 10, 6, palette, selected.map(i => palette[i]), 6, 128);
    const refSubset = reference.quantize.refinePalette(refGrid, 10, 6, palette, refSelected.map(i => palette[i]), 6, 128);
    equal(subset.map(c => c.code), refSubset.map(c => c.code));
    const options = { dither, amount: 0.85, alphaTh: 128 };
    const indices = quantize.remap(grid, 10, 6, subset, options);
    equal(indices, reference.quantize.remap(refGrid, 10, 6, refSubset, options));
    for (let i = 0; i < indices.length; i++) {
      if (grid[i * 4 + 3] < 128) assert.equal(indices[i], -1);
      else assert.ok(indices[i] >= 0 && indices[i] < subset.length);
    }
    equal(grid, refGrid);
  });
}

test('mosaic, adjustment, sharpen, sampling limits retain upstream return/mutation contracts', () => {
  const grid = quantize.downsample(image(40, 24), 40, 24, 10, 6, 'area');
  assert.equal(quantize.mosaic(grid, 10, 6, 1), grid);
  for (const m of [2, 3, 10]) equal(quantize.mosaic(grid, 10, 6, m), reference.quantize.mosaic(grid, 10, 6, m));
  for (const opts of [{}, { brightness: -100, contrast: -100, saturation: -100, gamma: 50 }, { brightness: 100, contrast: 100, saturation: 100, gamma: 200 }]) {
    const actual = grid.slice(), expected = grid.slice();
    assert.equal(quantize.adjust(actual, opts), actual);
    reference.quantize.adjust(expected, opts);
    equal(actual, expected);
  }
  assert.equal(quantize.sharpen(grid, 10, 6, 0), grid);
  for (const amount of [1, 50, 100]) equal(quantize.sharpen(grid, 10, 6, amount), reference.quantize.sharpen(grid, 10, 6, amount));
  equal(quantize.collectLab(grid, 10, 6, 128, 7), reference.quantize.collectLab(grid, 10, 6, 128, 7));
});

for (const mode of ['none', 'fs', 'ordered']) test(`${mode}: defaults, zero amount, all transparent and empty palette`, () => {
  const grid = quantize.downsample(image(24, 24), 24, 24, 8, 8, 'nearest');
  const subset = reference.palettes.get('basic').colors;
  for (const opts of [{}, { dither: mode }, { dither: mode, amount: 0 }, { dither: mode, amount: 1, alphaTh: 255 }]) {
    equal(quantize.remap(grid, 8, 8, subset, opts), reference.quantize.remap(grid, 8, 8, subset, opts));
  }
  assert.ok(quantize.remap(grid, 8, 8, [], {}).every(i => i === -1));
  const transparent = grid.slice();
  for (let i = 3; i < transparent.length; i += 4) transparent[i] = 0;
  assert.ok(quantize.remap(transparent, 8, 8, subset, { dither: mode }).every(i => i === -1));
});

test('empty clustering output and RNG defaults are reference-compatible', () => {
  for (const mode of ['kmeans', 'medianCut']) equal(quantize[mode](new Float32Array(), 0, 6), reference.quantize[mode](new Float32Array(), 0, 6));
  for (const seed of [0, 1, 20240815, 0xffffffff]) {
    const actual = quantize.rng(seed), expected = reference.quantize.rng(seed);
    for (let i = 0; i < 100; i++) assert.equal(actual(), expected());
  }
});
