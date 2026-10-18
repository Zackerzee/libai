import test from 'node:test';
import assert from 'node:assert/strict';
import { samplePixelArtFixer } from '../smart-preprocessing/pixel-art-fixer-sampler.mjs';

function image(width, height, pixels) {
  return { width, height, data: new Uint8ClampedArray(pixels.flat()) };
}
const red = [255, 0, 0, 255], blue = [0, 0, 255, 255];

test('fixer is deterministic and never mutates source', () => {
  const source = image(3, 2, [red, blue, red, blue, red, blue]);
  const before = source.data.slice();
  assert.deepEqual(samplePixelArtFixer(source, 2, 1), samplePixelArtFixer(source, 2, 1));
  assert.deepEqual(source.data, before);
});
test('fixer explicit non-square target and enlargement preserve full image extent', () => {
  const source = image(2, 1, [red, blue]);
  const { rgba } = samplePixelArtFixer(source, 4, 3);
  assert.equal(rgba.length, 4 * 3 * 4);
  for (let y = 0; y < 3; y++) {
    assert.deepEqual([...rgba.slice(y * 16, y * 16 + 4)], red);
    assert.deepEqual([...rgba.slice(y * 16 + 12, y * 16 + 16)], blue);
  }
});
test('fixer transparent hidden RGB cannot tint visible output', () => {
  const a = image(3, 1, [red, red, [0, 255, 0, 0]]);
  const b = image(3, 1, [red, red, [0, 0, 255, 0]]);
  assert.deepEqual(samplePixelArtFixer(a, 1, 1).rgba, new Uint8ClampedArray(red));
  assert.deepEqual(samplePixelArtFixer(a, 1, 1).rgba, samplePixelArtFixer(b, 1, 1).rgba);
});
test('fixer uses strict opaque majority and clears transparent RGB', () => {
  assert.deepEqual([...samplePixelArtFixer(image(2, 1, [red, [250, 250, 0, 0]]), 1, 1).rgba], [0, 0, 0, 0]);
  assert.deepEqual([...samplePixelArtFixer(image(1, 1, [[255, 255, 255, 255]]), 1, 1).rgba], [255, 255, 255, 255]);
});
test('fixer all-transparent source has no structure colors or invented output', () => {
  const result = samplePixelArtFixer(image(1, 1, [[255, 0, 255, 0]]), 4, 2);
  assert.equal(result.diagnostics.structureColors, 0);
  assert.ok(result.rgba.every(v => v === 0));
});
test('fixer rare single-cell color is drawn from original RGB, not cluster center', () => {
  const pixels = Array.from({ length: 100 }, () => [100, 100, 100, 255]);
  pixels[49] = [103, 104, 105, 255]; // same coarse bin, rare identity must survive.
  const result = samplePixelArtFixer(image(100, 1, pixels), 100, 1);
  assert.deepEqual([...result.rgba.slice(49 * 4, 50 * 4)], pixels[49]);
});
test('fixer center-weighted structural vote does not average distinct region colors', () => {
  const result = samplePixelArtFixer(image(3, 1, [blue, red, blue]), 1, 1);
  assert.deepEqual([...result.rgba], red);
});
test('fixer supports project maximum target size', () => {
  const result = samplePixelArtFixer(image(1, 1, [red]), 1000, 1000);
  assert.equal(result.rgba.length, 4_000_000);
  assert.deepEqual([...result.rgba.slice(-4)], red);
});
test('fixer guards invalid and oversized dimensions explicitly', () => {
  const source = image(1, 1, [red]);
  for (const [w, h] of [[0, 1], [1.5, 2], [1001, 1], [1, Infinity]])
    assert.throws(() => samplePixelArtFixer(source, w, h), RangeError);
  assert.throws(() => samplePixelArtFixer({ width: 2001, height: 2000, data: [] }, 1, 1), RangeError);
  assert.throws(() => samplePixelArtFixer({ width: 1, height: 1, data: [NaN, 0, 0, 255] }, 1, 1), RangeError);
  assert.throws(() => samplePixelArtFixer({ width: 1, height: 1, data: new Float64Array(4) }, 1, 1), RangeError);
  assert.throws(() => samplePixelArtFixer(source, 1, 1, { alphaThreshold: 255 }), RangeError);
});
