import test from "node:test";
import assert from "node:assert/strict";
import { sampleGridAdaptive, SamplingModeIndex, computeRegionContext, computeSamplingScores, extractCellFeatures, cellBounds } from "../../smart-preprocessing/sampling-engine-v2.mjs";

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = fn(x, y);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("pure gradient region produces Linear Mean, not all Dominant", () => {
  const source = makeImage(32, 32, (x, y) => [x * 8, x * 8, x * 8]);
  const r = sampleGridAdaptive(source, 8, 8, { preset: "photo" });
  const d = r.distribution;
  assert.ok(d.linearMean > d.dominant, `gradient should favor linearMean, got ${JSON.stringify(d)}`);
  assert.ok(r.preCoherenceDistribution, "pre-coherence distribution should exist");
});

test("pseudo portrait: dark beard -> Dominant, skin/beard boundary -> EdgeAware", () => {
  const source = makeImage(32, 32, (x, y) => {
    if (y < 16) return [200 + (x % 16) * 3, 160 + (x % 16) * 2, 140 + (x % 16)]; // 上半皮肤渐变
    if (x < 14) return [30, 25, 22]; // 下半左黑胡须
    return [220, 180, 150]; // 下半右亮皮肤（硬边在 x=14，cell 3 内部）
  });
  const r = sampleGridAdaptive(source, 8, 8, { preset: "portrait" });
  const d = r.distribution;
  assert.ok(d.linearMean > 0, "skin gradient should produce some linearMean");
  // 黑胡须内部 (x 0-2, y 5-6) 应 dominant
  let beardDominant = 0;
  for (let y = 5; y < 7; y++) for (let x = 0; x < 3; x++) if (r.modeMap[y * 8 + x] === SamplingModeIndex.DOMINANT) beardDominant++;
  assert.ok(beardDominant >= 3, `beard should be dominant, got ${beardDominant}/6`);
  // 硬边在 x=14（source），cell 3 内部 (x=3, y 4-7) 应含 edgeAware
  let boundaryEdge = 0;
  for (let y = 4; y < 8; y++) if (r.modeMap[y * 8 + 3] === SamplingModeIndex.EDGE_AWARE) boundaryEdge++;
  assert.ok(boundaryEdge >= 1, "boundary should contain edge-aware");
});

test("computeSamplingScores boosts center for micro-detail candidate", () => {
  // micro detail features：高 microDetailCandidate + 低 dominantCoverage
  const micro = { pixels: [{ r: 255, g: 255, b: 255 }, { r: 30, g: 30, b: 30 }, { r: 30, g: 30, b: 30 }, { r: 30, g: 30, b: 30 }, { r: 30, g: 30, b: 30 }], edgeScore: 0.3, luminanceVariance: 0.6, clusterSeparation: 0.7, gradient: 0.7, clusters: [{ coverage: 4 }, { coverage: 1 }], totalWeight: 5, microDetailCandidate: 0.9 };
  const s = computeSamplingScores(micro, "portrait");
  assert.ok(s.center > 0.3, `micro detail should boost center, got center=${s.center}`);
});

test("computeRegionContext reports smooth gradient between neighboring cells", () => {
  const source = makeImage(16, 16, (x, y) => [x * 8, x * 8, x * 8]);
  const featuresGrid = [];
  for (let y = 0; y < 4; y++) {
    featuresGrid[y] = [];
    for (let x = 0; x < 4; x++) {
      const b = cellBounds(x, y, 16, 16, 4, 4);
      featuresGrid[y][x] = extractCellFeatures(source, b, {});
    }
  }
  const rc = computeRegionContext(featuresGrid, 1, 1, 4, 4);
  assert.ok(rc.regionalSmoothGradient > 0.3, `smooth gradient should be detected, got ${rc.regionalSmoothGradient}`);
});
