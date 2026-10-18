import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { sampleImageToPixel, IMAGE_TO_PIXEL_REVISION } from '../smart-preprocessing/image-to-pixel-sampler.mjs';
import { resample } from '../vendor/image-to-pixel/resample.mjs';

const source = (width, height, pixels) => ({ width, height, data: new Uint8ClampedArray(pixels) });

test('upstream box sampling preserves non-square dimensions, deterministic output and source', () => {
  const image = source(2, 1, [255, 0, 0, 255, 0, 0, 255, 255]);
  const before = image.data.slice();
  const first = sampleImageToPixel(image, 1, 3);
  assert.equal(first.rgba.length, 12);
  assert.deepEqual(first.rgba, new Uint8ClampedArray([128, 0, 128, 255, 128, 0, 128, 255, 128, 0, 128, 255]));
  assert.deepEqual(sampleImageToPixel(image, 1, 3), first);
  assert.deepEqual(image.data, before);
  assert.equal(first.diagnostics.revision, IMAGE_TO_PIXEL_REVISION);
});

test('single-cell upscale preserves all channels', () => {
  const result = sampleImageToPixel(source(1, 1, [32, 47, 63, 255]), 7, 2);
  for (let o = 0; o < result.rgba.length; o += 4) assert.deepEqual([...result.rgba.slice(o, o + 4)], [32, 47, 63, 255]);
});

test('hidden RGB in transparent texels does not whiten visible samples', () => {
  const result = sampleImageToPixel(source(2, 1, [255, 255, 255, 0, 12, 24, 48, 255]), 1, 1);
  assert.deepEqual([...result.rgba], [12, 24, 48, 128]);
});

test('fully transparent image and below-threshold alpha remain transparent black', () => {
  assert.deepEqual([...sampleImageToPixel(source(1, 1, [255, 128, 0, 0]), 1, 1, { alphaThreshold: 0 }).rgba], [0, 0, 0, 0]);
  assert.deepEqual([...sampleImageToPixel(source(1, 1, [255, 128, 0, 7]), 1, 1).rgba], [0, 0, 0, 0]);
  assert.equal(sampleImageToPixel(source(1, 1, [255, 128, 0, 8]), 1, 1).rgba[3], 8);
});

test('RGBA result is upstream float resample with byte conversion only', () => {
  const bytes = Uint8ClampedArray.from({ length: 13 * 7 * 4 }, (_, i) => (i * 37 + 19) % 256);
  const image = { width: 13, height: 7, data: bytes };
  for (const [width, height] of [[1, 1], [3, 5], [29, 11]]) {
    const expected = resample(image, width, height, 'box');
    const { rgba } = sampleImageToPixel(image, width, height, { alphaThreshold: 0 });
    for (let i = 0; i < rgba.length; i++) assert.equal(rgba[i], Math.round(expected[i] * 255));
  }
});

test('vendor is pinned and standalone without DOM or GPU', () => {
  const vendored = readFileSync(new URL('../vendor/image-to-pixel/resample.mjs', import.meta.url), 'utf8');
  assert.ok(vendored.includes(IMAGE_TO_PIXEL_REVISION));
  assert.doesNotMatch(vendored, /document\.|window\.|WebGL|^import /m);
  assert.match(readFileSync(new URL('../vendor/image-to-pixel/LICENSE', import.meta.url), 'utf8'), /Copyright \(c\) 2023-2026 Tezumie/);
});

test('invalid dimensions, oversized output, malformed input and threshold reject before allocation', () => {
  const image = source(1, 1, [0, 0, 0, 255]);
  for (const size of [0, -1, 1.5, NaN, Infinity, 1001]) assert.throws(() => sampleImageToPixel(image, size, 1), RangeError);
  assert.throws(() => sampleImageToPixel({ width: 10000, height: 10000, data: [] }, 1, 1), RangeError);
  assert.throws(() => sampleImageToPixel(source(2, 2, [0, 0, 0, 255]), 1, 1), TypeError);
  assert.throws(() => sampleImageToPixel({ width: 1, height: 1, data: [0, 0, 0, 255] }, 1, 1), TypeError);
  for (const alphaThreshold of [-1, 256, NaN]) assert.throws(() => sampleImageToPixel(image, 1, 1, { alphaThreshold }), RangeError);
});
