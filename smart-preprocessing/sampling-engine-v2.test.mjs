import test from "node:test";
import assert from "node:assert/strict";
import {
  SamplingMode,
  cellBounds,
  extractCellPixels,
  sampleLinearMean,
  sampleCenter,
  sampleDominantCluster,
  extractCellFeatures,
  resolveSampling,
  sampleGrid,
} from "./sampling-engine-v2.mjs";

function makeImage(w, h) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}
function setPixel(img, x, y, r, g, b, a = 255) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}
function fillRect(img, x0, y0, x1, y1, r, g, b, a = 255) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) setPixel(img, x, y, r, g, b, a);
}

test("linear mean of 50% black + 50% white is Linear-RGB mean (~187), not naive 127", () => {
  const img = makeImage(2, 1);
  setPixel(img, 0, 0, 0, 0, 0);
  setPixel(img, 1, 0, 255, 255, 255);
  const pixels = extractCellPixels(img, { x0: 0, y0: 0, x1: 2, y1: 1 });
  const mean = sampleLinearMean(pixels);
  assert.ok(mean.r > 175 && mean.r < 200, `expected ~187, got ${mean.r}`);
  assert.ok(Math.abs(mean.r - 127) > 45, "must not be naive 127/128 sRGB mean");
});

test("cell bounds map continuous source rect for non-integer scaling", () => {
  // source 3px wide, grid 2 cells -> each cell 1.5px
  const b0 = cellBounds(0, 0, 3, 1, 2, 1);
  const b1 = cellBounds(1, 0, 3, 1, 2, 1);
  assert.deepEqual({ x0: b0.x0, x1: b0.x1 }, { x0: 0, x1: 1.5 });
  assert.deepEqual({ x0: b1.x0, x1: b1.x1 }, { x0: 1.5, x1: 3 });
});

test("overlap-area weighting: 3px -> 2 cells gives partial-pixel weights", () => {
  const img = makeImage(3, 1);
  setPixel(img, 0, 0, 255, 0, 0); // red, full in cell0
  setPixel(img, 1, 0, 0, 255, 0); // green, half in cell0 half in cell1
  setPixel(img, 2, 0, 0, 0, 255); // blue, full in cell1
  const b0 = cellBounds(0, 0, 3, 1, 2, 1);
  const p0 = extractCellPixels(img, b0);
  // cell0 covers pixel0 (area 1) + pixel1 (area 0.5)
  const weights = p0.map((p) => p.weight).sort((a, b) => a - b);
  assert.deepEqual(weights, [0.5, 1]);
  // red full + green half -> mean should be red-dominant
  const mean = sampleLinearMean(p0);
  assert.ok(mean.r > mean.b, "red (full weight) should dominate blue");
});

test("center sampling reads cell-center source pixel (nearest semantics)", () => {
  const img = makeImage(4, 4);
  fillRect(img, 0, 0, 4, 4, 0, 0, 0);
  setPixel(img, 1, 1, 255, 255, 255); // center-ish
  const b = cellBounds(1, 1, 4, 4, 2, 2); // cell (1,1) covers [2,4)x[2,4)
  const c = sampleCenter(img, b);
  // center of [2,4)x[2,4) is (3,3)
  assert.deepEqual([c.r, c.g, c.b], [0, 0, 0]); // (3,3) is black
});

test("dominant cluster picks yellow region over scattered blue despite similar RGBs", () => {
  const img = makeImage(10, 1);
  const yellows = [[255, 226, 32], [253, 227, 33], [255, 227, 31], [254, 225, 34], [255, 228, 30], [252, 226, 35], [255, 225, 33]];
  for (let x = 0; x < 7; x++) setPixel(img, x, 0, ...yellows[x]);
  for (let x = 7; x < 10; x++) setPixel(img, x, 0, 30, 60, 200); // blue
  const pixels = extractCellPixels(img, { x0: 0, y0: 0, x1: 10, y1: 1 });
  const dominant = sampleDominantCluster(pixels, { threshold: 12 });
  assert.ok(dominant.r > 200 && dominant.g > 180 && dominant.b < 80, `expected yellow-ish, got ${JSON.stringify(dominant)}`);
});

test("edge-aware does not average 55% dark-brown + 45% white into a third gray", () => {
  const img = makeImage(20, 20);
  // 55% dark brown (left 11 columns), 45% white (right 9 columns)
  fillRect(img, 0, 0, 11, 20, 90, 60, 40);
  fillRect(img, 11, 0, 20, 20, 255, 255, 255);
  const features = extractCellFeatures(img, { x0: 0, y0: 0, x1: 20, y1: 20 });
  const resolved = resolveSampling(features, SamplingMode.EDGE_AWARE, null);
  // result should be close to one of the two real clusters, not a gray midpoint (~172,157,147)
  const isDarkBrown = Math.abs(resolved.r - 90) < 45 && Math.abs(resolved.g - 60) < 45;
  const isWhite = resolved.r > 235 && resolved.g > 235 && resolved.b > 235;
  assert.ok(isDarkBrown || isWhite, `expected a real cluster color, got ${JSON.stringify(resolved)}`);
});

test("alpha-weighted extraction skips transparent pixels (no transparent-black edge)", () => {
  const img = makeImage(4, 1);
  setPixel(img, 0, 0, 0, 0, 0, 0); // transparent black
  setPixel(img, 1, 0, 0, 0, 0, 0); // transparent black
  setPixel(img, 2, 0, 255, 255, 255); // opaque white
  setPixel(img, 3, 0, 255, 255, 255); // opaque white
  const pixels = extractCellPixels(img, { x0: 0, y0: 0, x1: 4, y1: 1 });
  assert.equal(pixels.length, 2);
  const mean = sampleLinearMean(pixels);
  assert.deepEqual([mean.r, mean.g, mean.b], [255, 255, 255]);
});

test("sampling is deterministic across 5 runs", () => {
  const img = makeImage(24, 24);
  for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) {
    const v = (x * 7 + y * 13) % 256;
    setPixel(img, x, y, v, (v * 3) % 256, (v * 5) % 256);
  }
  const results = [];
  for (let i = 0; i < 5; i++) {
    const { colors } = sampleGrid(img, 8, 8, { mode: SamplingMode.EDGE_AWARE });
    results.push(JSON.stringify(colors));
  }
  for (let i = 1; i < results.length; i++) assert.equal(results[i], results[0]);
});

test("non-square grid (104x98) sampling produces full grid without errors", () => {
  const img = makeImage(104, 98);
  for (let y = 0; y < 98; y++) for (let x = 0; x < 104; x++) setPixel(img, x, y, x, y, (x + y) % 256);
  const { colors } = sampleGrid(img, 52, 49, { mode: SamplingMode.LINEAR_MEAN });
  assert.equal(colors.length, 49);
  assert.equal(colors[0].length, 52);
  assert.ok(colors[48][51], "last cell must be populated");
});
