import test from "node:test";
import assert from "node:assert/strict";
import { computeSamplingScores, sampleGridAdaptive, SamplingModeIndex } from "../../smart-preprocessing/sampling-engine-v2.mjs";
import { buildProtectionMap, ProtectionTier } from "../../smart-preprocessing/detail-protection-v2.mjs";
import { generateV2 } from "../../smart-preprocessing/generation-engine-v2.mjs";
import { getMardPalette } from "../../smart-preprocessing/palette-data.mjs";

function makeImage(w, h, fn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const [r, g, b] = fn(x, y);
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("computeSamplingScores picks dominant for flat blocks, edgeAware for hard edges", () => {
  const flat = { pixels: [{ r: 10, g: 10, b: 10 }], edgeScore: 0.1, luminanceVariance: 0.05, clusterSeparation: 0.2, gradient: 0.1, clusters: [{ coverage: 10 }], totalWeight: 10 };
  assert.equal(computeSamplingScores(flat, "photo").mode, SamplingModeIndex.DOMINANT);

  const hardEdge = { pixels: [{ r: 10, g: 10, b: 10 }, { r: 220, g: 220, b: 220 }], edgeScore: 0.8, luminanceVariance: 0.7, clusterSeparation: 0.9, gradient: 0.9, clusters: [{ coverage: 5 }, { coverage: 5 }], totalWeight: 10 };
  assert.equal(computeSamplingScores(hardEdge, "photo").mode, SamplingModeIndex.EDGE_AWARE);
});

test("sampleGridAdaptive: flat block -> dominant, hard edge -> edgeAware, multi-mode", () => {
  const source = makeImage(32, 32, (x, y) => {
    if (x < 16 && y < 16) return [x * 8, y * 8, 128]; // 左上渐变
    if (x >= 16 && y < 16) return [200, 50, 50]; // 右上色块 (flat)
    if (x < 16 && y >= 16) return [x < 10 ? 20 : 220, 30, 30]; // 左下硬边 x=10
    return [((x >> 1) + (y >> 1)) % 2 === 0 ? 255 : 30, 30, 30]; // 右下棋盘格
  });
  const r = sampleGridAdaptive(source, 8, 8, { preset: "photo" });
  assert.equal(r.resolvedMode, "adaptive");
  assert.ok(r.modeMap instanceof Uint8Array);
  const modes = new Set();
  for (let i = 0; i < 64; i++) modes.add(r.modeMap[i]);
  assert.ok(modes.size >= 2, `expected >=2 modes, got ${modes.size}`);

  // 右上色块内部区域 (x 5-6, y 1-2) 应 dominant（避开与渐变相邻的边缘 cell）
  for (let y = 1; y < 3; y++) for (let x = 5; x < 7; x++) {
    assert.equal(r.modeMap[y * 8 + x], SamplingModeIndex.DOMINANT, `flat cell (${x},${y}) should be dominant`);
  }
  // 左下硬边区域 (x 0-3, y 4-7) 应至少含 edgeAware（硬边在 x=2 内部）
  let hasEdge = false;
  for (let y = 4; y < 8; y++) for (let x = 0; x < 4; x++) if (r.modeMap[y * 8 + x] === SamplingModeIndex.EDGE_AWARE) hasEdge = true;
  assert.ok(hasEdge, "hard edge region should contain edge-aware cells");
});

test("pixel preset strongly favors center sampling", () => {
  const source = makeImage(16, 16, (x, y) => [(x + y) % 2 === 0 ? 255 : 30, 30, 30]);
  const r = sampleGridAdaptive(source, 8, 8, { preset: "pixel" });
  const d = r.distribution;
  assert.ok(d.center > d.linearMean && d.center > d.dominant, `pixel preset should favor center, got ${JSON.stringify(d)}`);
});

test("large flat white region is not CRITICAL/HIGH protection", () => {
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ code: "H2", rgb: [254, 255, 255] })));
  const source = { data: new Uint8ClampedArray(5 * 5 * 4).fill(255), width: 5, height: 5 };
  const p = buildProtectionMap({ grid, width: 5, height: 5, sourceImageData: source, sameCell: (a, b) => a.code === b.code });
  const tiers = new Set();
  for (let i = 0; i < 25; i++) tiers.add(p.tierMap[i]);
  assert.ok(!tiers.has(ProtectionTier.CRITICAL), "flat white must not be critical");
  assert.ok(!tiers.has(ProtectionTier.HIGH), "flat white must not be high");
});

test("manual mode uses single-mode grid, AUTO uses adaptive with distribution", () => {
  const source = makeImage(16, 16, (x, y) => [x * 10, y * 10, 100]);
  const PALETTE = getMardPalette(221);
  const manual = generateV2({ source, width: 8, height: 8, palette: PALETTE, options: { preset: "photo", sampling: "linear-mean" } });
  assert.equal(manual.diagnostics.samplingMode, "linear-mean");
  assert.equal(manual.diagnostics.samplingDistribution, null);

  const auto = generateV2({ source, width: 8, height: 8, palette: PALETTE, options: { preset: "photo", sampling: "auto" } });
  assert.equal(auto.diagnostics.samplingMode, "adaptive");
  assert.ok(auto.diagnostics.samplingDistribution);
  assert.ok(auto.diagnostics.samplingModeMap instanceof Uint8Array);
});

test("adaptive AUTO is deterministic across runs", () => {
  const source = makeImage(24, 24, (x, y) => [(x * 7) % 256, (y * 13) % 256, (x + y) % 256]);
  const PALETTE = getMardPalette(221);
  const results = [];
  for (let i = 0; i < 3; i++) {
    const r = generateV2({ source, width: 8, height: 8, palette: PALETTE, options: { preset: "portrait", sampling: "auto" } });
    results.push(JSON.stringify(r.grid.map((row) => row.map((c) => (c ? c.code : null)))));
  }
  assert.equal(results[1], results[0]);
  assert.equal(results[2], results[0]);
});
