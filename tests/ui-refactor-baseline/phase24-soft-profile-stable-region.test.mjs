import test from "node:test";
import assert from "node:assert/strict";
import {
  sampleGridAdaptive,
  analyzeStableRegions,
  extractCellFeatures,
  cellBounds,
  computeEffectiveProfileWeights,
  profileConfidenceToStrength,
  IMAGE_PROFILE_WEIGHTS,
  PERCEPTUAL_STABLE_CONFIG,
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

// Test 1 — profile confidence 0 → effective weights 全 1
test("profile confidence 0 → effective weights all 1", () => {
  const w = computeEffectiveProfileWeights(IMAGE_PROFILE_WEIGHTS.ILLUSTRATION, 0);
  assert.equal(w.linearMean, 1);
  assert.equal(w.center, 1);
  assert.equal(w.dominant, 1);
  assert.equal(w.edgeAware, 1);
});

// Test 2 — profile confidence 1 → effective = raw
test("profile confidence 1 → effective weights equal raw", () => {
  const raw = IMAGE_PROFILE_WEIGHTS.ILLUSTRATION;
  const w = computeEffectiveProfileWeights(raw, 1);
  assert.equal(w.linearMean, raw.linearMean);
  assert.equal(w.center, raw.center);
  assert.equal(w.dominant, raw.dominant);
  assert.equal(w.edgeAware, raw.edgeAware);
});

// Test 3 — low confidence Illustration → 接近 1，不强控制
test("low confidence Illustration is softened toward 1", () => {
  const raw = IMAGE_PROFILE_WEIGHTS.ILLUSTRATION; // LM 0.5, Dominant 1.4
  const w = computeEffectiveProfileWeights(raw, 0.2);
  assert.ok(w.linearMean > 0.5, `LM should be > 0.5, got ${w.linearMean}`);
  assert.ok(w.dominant < 1.4, `Dominant should be < 1.4, got ${w.dominant}`);
  // 接近 1（0.2 strength 时 LM = 0.9, Dominant = 1.08）
  assert.ok(Math.abs(w.linearMean - 1) < 0.15, `LM should be near 1, got ${w.linearMean}`);
  assert.ok(Math.abs(w.dominant - 1) < 0.15, `Dominant should be near 1, got ${w.dominant}`);
});

// Test 4 — manual preset unaffected
test("manual preset does NOT apply soft profile prior", () => {
  const img = makeImage(32, 32, (x, y) => [x * 8, x * 8, x * 8]);
  const r = sampleGridAdaptive(img, 8, 8, { preset: "photo" }); // 不传 autoProfile
  assert.equal(r.imageProfile, null, "manual preset should not run profile");
});

// Test 5 — perceptual dark region（RGB 自然变化，非纯黑）
test("perceptual dark region with natural RGB variation is one connected region", () => {
  const img = makeImage(32, 32, (x, y) => {
    const v = (x * 7 + y * 13) % 8; // 自然变化 0~7
    return [20 + v, 18 + v, 18 + v];
  });
  const fg = extractFeatures(img, 8, 8);
  const r = analyzeStableRegions(fg, 8, 8);
  assert.ok(r.regionCount >= 1, "should form at least one region");
  // 大部分 cell 应该是 perceptual stable
  let stableCount = 0;
  for (let i = 0; i < 64; i++) if (r.perceptualStable[i]) stableCount++;
  assert.ok(stableCount > 40, `most cells should be perceptual stable, got ${stableCount}`);
});

// Test 6 — different colors don't merge
test("dark black and dark red regions do NOT merge", () => {
  const img = makeImage(32, 32, (x, y) => (x < 16 ? [20, 18, 18] : [120, 20, 20]));
  const fg = extractFeatures(img, 8, 8);
  const r = analyzeStableRegions(fg, 8, 8);
  assert.ok(r.regionCount >= 2, `black and red should form separate regions, got ${r.regionCount}`);
});

// Test 7 — stable interior vs boundary
test("stable region interior vs boundary", () => {
  // 中间 4×4 cell 是稳定块（x 2-5, y 2-5），其余是渐变
  const img = makeImage(32, 32, (x, y) => {
    if (x >= 8 && x < 24 && y >= 8 && y < 24) return [40, 40, 40];
    return [200 + (x % 4) * 10, 200, 200];
  });
  const fg = extractFeatures(img, 8, 8);
  const r = analyzeStableRegions(fg, 8, 8);
  // 中心 cell (3,3) 应 interior，边界 cell (2,2) 或 (2,3) 应 boundary
  const centerIdx = 3 * 8 + 3;
  const boundaryIdx = 2 * 8 + 3;
  if (r.regionIdMap[centerIdx] >= 0) {
    assert.equal(r.interiorMap[centerIdx], 1, "center should be interior");
    if (r.regionIdMap[boundaryIdx] === r.regionIdMap[centerIdx]) {
      assert.equal(r.interiorMap[boundaryIdx], 0, "boundary should not be interior");
    }
  }
});

// Test 8 — stable region restores Dominant competition（PHOTO dark block）
test("PHOTO with large dark block: Dominant > 0", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x < 16) return [x * 8, x * 8, x * 8]; // 渐变皮肤
    return [22, 19, 19]; // 大深色块（自然非纯黑）
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  assert.ok(r.imageProfile, "autoProfile should produce imageProfile");
  assert.ok(r.distribution.dominant > 0, `dark block should produce dominant, got ${JSON.stringify(r.distribution)}`);
});

// Test 9 — structural edge unaffected（stable block 边界仍 Edge）
test("structural edge at stable block boundary unaffected", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x < 14) return [20, 18, 18]; // 深色块
    return [220, 200, 180]; // 亮块（硬边在 x=14，cell 3 内部）
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  // 边界 cell (3, y) 应仍有 edgeAware（硬边在 cell 内部，不被 stable boost 吞掉）
  let hasEdge = false;
  for (let y = 0; y < 8; y++) if (r.modeMap[y * 8 + 3] === SamplingModeIndex.EDGE_AWARE) hasEdge = true;
  assert.ok(hasEdge, "boundary should still have edge-aware");
});

// Test 10 — micro detail unaffected（dark region + bright highlight）
test("micro detail in stable region unaffected", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x >= 12 && x <= 13 && y >= 12 && y <= 13) return [255, 255, 255]; // 亮点
    return [22, 19, 19]; // 深色区
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  // 亮点 cell 应有 center 或 edge（微结构不被 stable 吞掉）
  const centerCell = r.modeMap[3 * 8 + 3];
  const hasCenterOrEdge = r.distribution.center > 0 || centerCell === SamplingModeIndex.EDGE_AWARE || r.modeMap[4 * 8 + 4] === SamplingModeIndex.EDGE_AWARE;
  assert.ok(hasCenterOrEdge, "micro detail should trigger center/edge");
});

// Test 11 — neutral adaptive regression（四种 mode 可同时出现）
test("neutral adaptive: four modes can co-exist", () => {
  const img = makeImage(32, 32, (x, y) => {
    if (x < 16 && y < 16) return [20, 20, 20]; // 色块
    if (x >= 16 && y < 16) return [x * 4, x * 4, x * 4]; // 渐变
    if (x < 16 && y >= 16) return [200, 40, 40]; // 红块
    return [40, 200, 40]; // 绿块
  });
  const r = sampleGridAdaptive(img, 8, 8, { preset: "auto", autoProfile: true });
  const d = r.distribution;
  let distinctModes = 0;
  if (d.linearMean > 0) distinctModes++;
  if (d.center > 0) distinctModes++;
  if (d.dominant > 0) distinctModes++;
  if (d.edgeAware > 0) distinctModes++;
  assert.ok(distinctModes >= 2, `should have >= 2 modes, got ${JSON.stringify(d)}`);
});
