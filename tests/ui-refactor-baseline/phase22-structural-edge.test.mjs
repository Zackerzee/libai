import test from "node:test";
import assert from "node:assert/strict";
import { sampleGridAdaptive, spatialCoherencePass, SamplingModeIndex, computeEdgeContinuity } from "../../smart-preprocessing/sampling-engine-v2.mjs";

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = fn(x, y);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

function makeFeature(edgeScore, clusterSeparation, gradient) {
  return { edgeScore, clusterSeparation, gradient, microDetailCandidate: 0, luminanceVariance: 0, dominantCoverage: 0 };
}

test("spatialCoherencePass preserves continuous vertical structural edge", () => {
  const W = 8, H = 8;
  const modeMap = new Uint8Array(W * H);
  const confidenceMap = new Float32Array(W * H);
  const featuresGrid = [];
  for (let y = 0; y < H; y++) {
    featuresGrid[y] = [];
    for (let x = 0; x < W; x++) {
      const isEdge = x === 4;
      featuresGrid[y][x] = makeFeature(isEdge ? 0.8 : 0.1, isEdge ? 0.8 : 0.1, isEdge ? 0.7 : 0.05);
      modeMap[y * W + x] = isEdge ? SamplingModeIndex.EDGE_AWARE : SamplingModeIndex.DOMINANT;
      confidenceMap[y * W + x] = isEdge ? 0.15 : 0.7;
    }
  }
  const r = spatialCoherencePass(modeMap, confidenceMap, featuresGrid, W, H);
  for (let y = 0; y < H; y++) {
    assert.equal(r.modeMap[y * W + 4], SamplingModeIndex.EDGE_AWARE, `continuous edge (4,${y}) should be preserved`);
  }
  assert.ok(r.postCoherenceEdgeCount >= H, `edge line should be preserved, got ${r.postCoherenceEdgeCount}`);
});

test("spatialCoherencePass redirects isolated edge noise", () => {
  const W = 8, H = 8;
  const modeMap = new Uint8Array(W * H);
  const confidenceMap = new Float32Array(W * H);
  const featuresGrid = [];
  for (let y = 0; y < H; y++) {
    featuresGrid[y] = [];
    for (let x = 0; x < W; x++) {
      const isolated = x === 4 && y === 4;
      featuresGrid[y][x] = makeFeature(isolated ? 0.8 : 0.1, isolated ? 0.8 : 0.1, isolated ? 0.7 : 0.05);
      modeMap[y * W + x] = isolated ? SamplingModeIndex.EDGE_AWARE : SamplingModeIndex.DOMINANT;
      confidenceMap[y * W + x] = isolated ? 0.15 : 0.7;
    }
  }
  const r = spatialCoherencePass(modeMap, confidenceMap, featuresGrid, W, H);
  assert.equal(r.modeMap[4 * W + 4], SamplingModeIndex.DOMINANT, "isolated edge noise should be redirected to dominant");
  assert.ok(r.redirects.edgeToDominant >= 1, `should record edge->dominant redirect, got ${JSON.stringify(r.redirects)}`);
});

test("vertical stripe source: edge cells preserved after coherence", () => {
  // 32×32 竖条纹（宽 5px，非 cell 对齐），形成连续垂直轮廓
  const source = makeImage(32, 32, (x, y) => {
    const stripe = Math.floor(x / 5);
    return stripe % 2 === 0 ? [20, 20, 20] : [240, 240, 240];
  });
  const r = sampleGridAdaptive(source, 8, 8, { preset: "portrait" });
  assert.ok(r.preCoherenceEdgeCount > 0, "stripes should produce edge cells");
  // edge 保留率：coherence 后仍有相当比例的 edge
  const preserveRate = r.preCoherenceEdgeCount ? r.postCoherenceEdgeCount / r.preCoherenceEdgeCount : 0;
  assert.ok(preserveRate > 0.4, `edge should be largely preserved, rate=${preserveRate.toFixed(2)}`);
});

test("computeEdgeContinuity detects vertical line continuity", () => {
  const W = 8, H = 8;
  const modeMap = new Uint8Array(W * H);
  const featuresGrid = [];
  for (let y = 0; y < H; y++) {
    featuresGrid[y] = [];
    for (let x = 0; x < W; x++) {
      featuresGrid[y][x] = makeFeature(x === 4 ? 0.8 : 0.1, 0.1, 0.1);
      modeMap[y * W + x] = x === 4 ? SamplingModeIndex.EDGE_AWARE : SamplingModeIndex.DOMINANT;
    }
  }
  // (4,4) 上下都是 edge → continuity 高
  const cont = computeEdgeContinuity(modeMap, featuresGrid, 4, 4, W, H);
  assert.ok(cont > 0.3, `vertical line should have high continuity, got ${cont}`);
  // (1,1) 孤立（周围无 edge）→ continuity 低
  const iso = computeEdgeContinuity(modeMap, featuresGrid, 1, 1, W, H);
  assert.ok(iso < 0.1, `isolated should have low continuity, got ${iso}`);
});
