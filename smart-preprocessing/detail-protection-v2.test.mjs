import test from "node:test";
import assert from "node:assert/strict";
import {
  detectHighlight,
  detectDarkDetail,
  detectEyeLike,
  calculateSourceEvidence,
  buildProtectionMap,
} from "./detail-protection-v2.mjs";

function makeImage(w, h) {
  return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h };
}
function setPixel(img, x, y, r, g, b, a = 255) {
  const i = (y * img.width + x) * 4;
  img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = a;
}

const WHITE = { code: "A1", rgb: [255, 255, 255] };
const DARK = { code: "H7", rgb: [17, 17, 17] };

function grid3x3(center, surround) {
  return [
    [surround, surround, surround],
    [surround, center, surround],
    [surround, surround, surround],
  ];
}

function sourceWithCenterHighlight() {
  const img = makeImage(3, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(img, x, y, 17, 17, 17);
  setPixel(img, 1, 1, 255, 255, 255);
  return img;
}

test("real highlight (source has bright pixel) is protected", () => {
  const grid = grid3x3(WHITE, DARK);
  const source = sourceWithCenterHighlight();
  const bounds = { x0: 1, y0: 1, x1: 2, y1: 2 };
  const evidence = calculateSourceEvidence(source, bounds, [255, 255, 255]);
  assert.ok(evidence > 0.5, `source evidence should be high, got ${evidence}`);
  const score = detectHighlight(grid, 1, 1, evidence);
  assert.ok(score > 0.5, `highlight score should be high, got ${score}`);
});

test("fake highlight (source has no bright pixel) is NOT protected", () => {
  const grid = grid3x3(WHITE, DARK);
  const source = makeImage(3, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(source, x, y, 17, 17, 17); // all dark, no highlight
  const bounds = { x0: 1, y0: 1, x1: 2, y1: 2 };
  const evidence = calculateSourceEvidence(source, bounds, [255, 255, 255]);
  assert.equal(evidence, 0);
  const score = detectHighlight(grid, 1, 1, evidence);
  assert.equal(score, 0, "fake highlight must not be protected");
});

test("real dark micro-detail (pupil-like) is protected", () => {
  const grid = grid3x3(DARK, WHITE);
  const source = makeImage(3, 3);
  for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setPixel(source, x, y, 255, 255, 255);
  setPixel(source, 1, 1, 17, 17, 17);
  const evidence = calculateSourceEvidence(source, { x0: 1, y0: 1, x1: 2, y1: 2 }, [17, 17, 17]);
  const score = detectDarkDetail(grid, 1, 1, evidence);
  assert.ok(score > 0.5, `dark detail should be protected, got ${score}`);
});

test("buildProtectionMap returns Float32Array metadata, not a second grid", () => {
  const grid = grid3x3(WHITE, DARK);
  const source = sourceWithCenterHighlight();
  const result = buildProtectionMap({
    grid,
    width: 3,
    height: 3,
    sourceImageData: source,
    sameCell: (a, b) => a.code === b.code,
  });
  assert.ok(result.protectionMap instanceof Float32Array);
  assert.equal(result.protectionMap.length, 9);
  assert.ok(result.highlightMap instanceof Float32Array);
  assert.ok(result.darkDetailMap instanceof Float32Array);
  assert.ok(result.eyeLikeMap instanceof Float32Array);
  assert.ok(result.edgeMap instanceof Float32Array);
  // 中央高光应该被保护（protection >= 0.5）
  assert.ok(result.protectionMap[4] >= 0.5, `center highlight protection=${result.protectionMap[4]}`);
});
