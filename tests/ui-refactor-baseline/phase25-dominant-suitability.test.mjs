import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleGridAdaptive,
  analyzeStableRegions,
  extractCellFeatures,
  cellBounds,
  analyzeImageProfile,
  IMAGE_PROFILE,
  SamplingModeIndex,
} from "../../smart-preprocessing/sampling-engine-v2.mjs";

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = fn(x, y);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function extractFeatures(img, gw, gh) {
  const grid = [];
  for (let y = 0; y < gh; y++) {
    grid[y] = [];
    for (let x = 0; x < gw; x++) {
      grid[y][x] = extractCellFeatures(img, cellBounds(x, y, img.width, img.height, gw, gh), {});
    }
  }
  return grid;
}

// Test 1 — Continuous grayscale gradient: shading high, suitability lower than flat block
test("grayscale gradient: high shading, lower suitability than flat block", () => {
  const grad = makeImage(32, 32, (x, y) => [100 + x * 2, 100 + x * 2, 100 + x * 2]);
  const block = makeImage(32, 32, (x, y) => { const v = (x * 7 + y * 13) % 5; return [22 + v, 20 + v, 20 + v]; });
  const rg = analyzeStableRegions(extractFeatures(grad, 8, 8), 8, 8);
  const rb = analyzeStableRegions(extractFeatures(block, 8, 8), 8, 8);
  // 渐变图应有较高 shading（连续 L* 变化）
  const gradShading = Math.max(...Array.from(rg.shadingScoreMap).filter((v) => v > 0));
  const blockShading = Math.max(...Array.from(rb.shadingScoreMap).filter((v) => v > 0));
  assert.ok(gradShading > 0.3, `gradient should have shading, got ${gradShading}`);
  // 黑块的 suitability 应高于渐变图的 suitability
  const gradSuit = Math.max(...Array.from(rg.dominantSuitabilityMap).filter((v) => v > 0), 0);
  const blockSuit = Math.max(...Array.from(rb.dominantSuitabilityMap).filter((v) => v > 0), 0);
  assert.ok(blockSuit > gradSuit, `flat block suitability (${blockSuit}) should exceed gradient suitability (${gradSuit})`);
});

// Test 2 — Large black stable block: high suitability, Dominant still boosted
test("large black stable block: high suitability, Dominant boosted", () => {
  const img = makeImage(32, 32, (x, y) => { const v = (x * 7 + y * 13) % 5; return [22 + v, 20 + v, 20 + v]; });
  const r = analyzeStableRegions(extractFeatures(img, 8, 8), 8, 8);
  const suit = Math.max(...Array.from(r.dominantSuitabilityMap).filter((v) => v > 0), 0);
  assert.ok(suit > 0.5, `black block should be dominant-suitable, got ${suit}`);
  const s = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  assert.ok(s.distribution.dominant > 0, "black block should produce dominant");
});

// Test 3 — Strict flat illustration block: strict stable, high suitability
test("strict flat illustration block: high suitability", () => {
  const img = makeImage(32, 32, (x, y) => [200, 40, 40]); // 纯色
  const r = analyzeStableRegions(extractFeatures(img, 8, 8), 8, 8);
  let strictCount = 0;
  for (let i = 0; i < 64; i++) if (r.strictStable[i]) strictCount++;
  assert.ok(strictCount > 50, `pure block should be strict stable, got ${strictCount}`);
  const suit = Math.max(...Array.from(r.dominantSuitabilityMap).filter((v) => v > 0), 0);
  assert.ok(suit >= 0.75, `strict block should have high suitability, got ${suit}`);
});

// Test 4 — Smooth skin-like shading: shading high, suitability lowered
test("smooth skin-like shading: shading high, suitability lowered", () => {
  // 亮度连续变化，chroma 变化很小
  const img = makeImage(32, 32, (x, y) => {
    const l = 180 + Math.floor(x / 2) * 3; // 亮度渐变
    return [l, l - 10, l - 20];
  });
  const r = analyzeStableRegions(extractFeatures(img, 8, 8), 8, 8);
  const shading = Math.max(...Array.from(r.shadingScoreMap).filter((v) => v > 0), 0);
  const suit = Math.max(...Array.from(r.dominantSuitabilityMap).filter((v) => v > 0), 0);
  assert.ok(shading > 0.2, `skin shading should be detected, got ${shading}`);
  assert.ok(suit < 0.75, `skin shading should lower suitability, got ${suit}`);
});

// Test 5 — Hair highlight: sampling doesn't break
test("hair highlight: sampling mode doesn't break", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x >= 12 && x <= 15 && y >= 12 && y <= 15) return [90, 88, 86]; // 高光
    return [22, 20, 20]; // 黑发
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  assert.ok(r.grid === undefined || r.colors, "sampling should produce colors");
});

// Test 6 — Structural hard edge between two stable blocks
test("structural hard edge: boundary still EdgeAware", () => {
  const img = makeImage(32, 32, (x, y) => (x < 14 ? [20, 18, 18] : [220, 200, 180]));
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  let hasEdge = false;
  for (let y = 0; y < 8; y++) if (r.modeMap[y * 8 + 3] === SamplingModeIndex.EDGE_AWARE) hasEdge = true;
  assert.ok(hasEdge, "boundary should still have edge-aware");
});

// Test 7 — Micro detail inside stable block: Center/Edge protected
test("micro detail inside stable block: Center/Edge protected", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x >= 12 && x <= 13 && y >= 12 && y <= 13) return [255, 255, 255];
    return [22, 19, 19];
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  const hasCenterOrEdge = r.distribution.center > 0 || r.modeMap[3 * 8 + 3] === SamplingModeIndex.EDGE_AWARE || r.modeMap[4 * 8 + 4] === SamplingModeIndex.EDGE_AWARE;
  assert.ok(hasCenterOrEdge, "micro detail should trigger center/edge");
});

// Test 8 — Neutral texture: not locked to Dominant
test("neutral texture: not locked to Dominant", () => {
  const img = makeImage(32, 32, (x, y) => {
    const v = (x * 13 + y * 7) % 60; // 复杂纹理
    return [v, v * 2 % 255, (255 - v)];
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  const d = r.distribution;
  assert.ok(d.linearMean > 0 || d.center > 0 || d.edgeAware > 0, `texture should not be all dominant, got ${JSON.stringify(d)}`);
});

// Test 9 — Manual preset override
test("manual preset override: auto logic doesn't pollute manual modes", () => {
  const img = makeImage(32, 32, (x, y) => [x * 8, x * 8, x * 8]);
  const r = sampleGridAdaptive(img, 8, 8, { preset: "photo" }); // 不传 autoProfile
  assert.equal(r.imageProfile, null, "manual preset should not run profile");
});

// Test 10 — Profile classifier regression
test("profile classifier unchanged: PHOTO/ILLUSTRATION/PIXEL", () => {
  const photo = makeImage(32, 32, (x, y) => [x * 8, x * 8, x * 8]);
  const illu = makeImage(32, 32, (x, y) => {
    if (x < 16 && y < 16) return [20, 20, 20];
    if (x >= 16 && y < 16) return [200, 50, 50];
    if (x < 16 && y >= 16) return [50, 200, 50];
    return [50, 50, 200];
  });
  const pixel = makeImage(32, 32, (x, y) => (x < 16 ? [0, 0, 0] : [255, 255, 255]));
  assert.equal(analyzeImageProfile(extractFeatures(photo, 8, 8), 8, 8).profile, IMAGE_PROFILE.PHOTO);
  assert.equal(analyzeImageProfile(extractFeatures(illu, 8, 8), 8, 8).profile, IMAGE_PROFILE.ILLUSTRATION);
  assert.equal(analyzeImageProfile(extractFeatures(pixel, 8, 8), 8, 8).profile, IMAGE_PROFILE.PIXEL_GRAPHIC);
});
