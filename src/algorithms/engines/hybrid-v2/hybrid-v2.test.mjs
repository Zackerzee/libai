/**
 * Hybrid V2 单元测试 + 回归夹具。
 * 运行：node --test src/algorithms/engines/hybrid-v2/hybrid-v2.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  runHybridV2, HYBRID_V2_ENGINE_ID, HYBRID_V2_STAGES,
  HybridV2Config, flattenConfig, buildConfigMeta, PROVENANCE,
  SAMPLING_MODE, sampleCell, sampleGrid, cellBounds,
  COMPONENT_CATEGORY, classifySmallComponent,
  TopologyGuard, connectedComponents, backgroundHoles, openingCount, isConnectedWithout,
  buildProtectedDetailMask, requestChange, selectAccentKeys, MASK_LAYER,
  snapshot, diffSnapshot, METRIC_KEYS,
  evaluateCandidateSizes, CANDIDATE_STATUS,
} from "./index.mjs";
import { FIXTURES, runFixtureSuite, FIXTURE_KIND, PALETTE } from "./fixtures.mjs";
import { linearMean, dominantBucket, twoMeans, robustMean } from "./sampling.mjs";

const CODE = (cell) => (cell == null ? null : typeof cell === "string" ? cell : cell.code);

function image(cols, rows, painter) {
  const data = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const rgb = painter(x, y);
      const i = (y * cols + x) * 4;
      if (!rgb) { data[i + 3] = 0; continue; }
      data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
    }
  }
  return { width: cols, height: rows, data };
}

function gridFrom(rowsSpec) {
  return rowsSpec.map((row) => row.map((c) => (c === "." ? null : { code: c, rgb: rgbOf(c) })));
}
function rgbOf(code) {
  const hit = PALETTE.find((e) => e.code === code);
  return hit ? hit.rgb : [128, 128, 128];
}

/* ============================================================
 * 配置与溯源
 * ========================================================== */

test("配置里每个阈值都带 provenance，且没有 ga0my", () => {
  const meta = buildConfigMeta();
  const leaves = Object.keys(meta);
  assert.ok(leaves.length > 30);
  for (const [path, m] of Object.entries(meta)) {
    assert.ok(Object.values(PROVENANCE).includes(m.origin), `${path} origin 非法`);
    assert.ok(m.source, `${path} 缺 source`);
  }
  // 整个引擎目录不得把 ga0my 当依据
  assert.ok(!JSON.stringify(meta).includes("ga0my"));
});

test("LOCAL_UNVERIFIED 的参数默认不进入默认链路", () => {
  const meta = buildConfigMeta();
  const unverified = Object.entries(meta).filter(([, m]) => m.origin === PROVENANCE.LOCAL_UNVERIFIED);
  assert.ok(unverified.length >= 2);
  const flat = flattenConfig();
  // robustMeanSampling 与 adaptive 默认都不会用到 trimFraction
  assert.equal(flat.featureFlags.robustMeanSampling, false);
  assert.equal(flat.featureFlags.icmSpatialRefinement, false);
  assert.equal(flat.featureFlags.dithering, false);
  assert.equal(flat.featureFlags.aggressiveRegionMerge, false);
  assert.equal(flat.featureFlags.experimentalDominantSampling, false);
});

test("flattenConfig 剥掉包装，叶子是原始值", () => {
  const flat = flattenConfig();
  assert.equal(typeof flat.sampling.varianceThresholdTwoMeans, "number");
  assert.equal(flat.sampling.varianceThresholdTwoMeans, 0.008);
  assert.equal(flat.cleanup.noiseConfidenceThreshold, 0.75);
  assert.deepEqual(flat.resolution.candidates, [52, 78, 104, 120, 140, 160]);
});

test("四个实验 Feature Flag 默认 OFF", () => {
  const flat = flattenConfig();
  for (const key of ["icmSpatialRefinement", "dithering", "aggressiveRegionMerge", "experimentalDominantSampling", "robustMeanSampling"]) {
    assert.equal(flat.featureFlags[key], false, `${key} 默认必须 OFF`);
  }
});

/* ============================================================
 * 采样
 * ========================================================== */

test("cellBounds 不重叠也不越界（栅格小于格数时）", () => {
  const coverage = new Int32Array(16);
  for (let y = 0; y < 6; y++) {
    for (let x = 0; x < 6; x++) {
      const b = cellBounds(x, y, 4, 4, 6, 6);
      assert.ok(b.x0 >= 0 && b.x1 <= 4 && b.y0 >= 0 && b.y1 <= 4);
      for (let py = b.y0; py < b.y1; py++) for (let px = b.x0; px < b.x1; px++) coverage[py * 4 + px]++;
    }
  }
  for (let i = 0; i < coverage.length; i++) assert.equal(coverage[i], 1, "每个像素恰好被一格覆盖");
});

test("linearMean 做 alpha 加权", () => {
  const px = [[255, 255, 255, 255], [0, 0, 0, 0]];
  const m = linearMean(px);
  assert.ok(m.count === 2);
  assert.ok(m.alpha > 0.4 && m.alpha < 0.6);
});

test("dominantBucket 取最高频桶并给出占比", () => {
  const px = [[200, 200, 200, 255], [200, 200, 200, 255], [200, 200, 200, 255], [10, 10, 10, 255]];
  const d = dominantBucket(px);
  assert.equal(d.share, 0.75);
  assert.ok(d.rgb[0] > 150);
});

test("twoMeans 在双色格上分出两簇且覆盖更高者胜出", () => {
  const px = [];
  for (let i = 0; i < 3; i++) px.push([240, 240, 240, 255]);
  for (let i = 0; i < 7; i++) px.push([20, 20, 20, 255]);
  const mean = linearMean(px);
  const tm = twoMeans(px, mean);
  assert.ok(tm);
  assert.ok(tm.rgb[0] < 80, "多数簇是暗色，应胜出");
  assert.ok(tm.coverage > 0.5);
});

test("twoMeans 在像素不足时返回 null（A 要求 ≥4 像素）", () => {
  const px = [[10, 10, 10, 255], [200, 200, 200, 255]];
  assert.equal(twoMeans(px, linearMean(px)), null);
});

test("robustMean 是 LOCAL_UNVERIFIED —— adaptive 永不选中它", () => {
  const px = [];
  for (let i = 0; i < 10; i++) px.push([100, 100, 100, 255]);
  px.push([255, 255, 255, 255]);
  const rm = robustMean(px);
  assert.ok(rm);
  // adaptive 跑一张图，模式里不应出现 robust-mean
  const src = image(16, 16, (x, y) => (x > 8 ? [20, 20, 20] : [230, 230, 230]));
  const s = sampleGrid(src, 8, 8, { mode: SAMPLING_MODE.ADAPTIVE });
  assert.ok(!s.modes.includes(SAMPLING_MODE.ROBUST_MEAN));
});

test("sampleCell 在平坦区选 linear-mean", () => {
  const px = [];
  for (let i = 0; i < 16; i++) px.push([120, 120, 120, 255]);
  const r = sampleCell(px, { mode: SAMPLING_MODE.ADAPTIVE });
  assert.equal(r.mode, SAMPLING_MODE.LINEAR_MEAN);
  assert.ok(Math.abs(r.rgb[0] - 120) <= 2);
});

test("sampleCell 在高方差 + dominant 有优势时选 dominant", () => {
  const px = [];
  for (let i = 0; i < 12; i++) px.push([240, 240, 240, 255]);
  for (let i = 0; i < 4; i++) px.push([10, 10, 10, 255]);
  const r = sampleCell(px, { mode: SAMPLING_MODE.ADAPTIVE });
  assert.equal(r.mode, SAMPLING_MODE.DOMINANT);
  assert.ok(r.rgb[0] > 200);
});

test("sampleCell 在透明占多数时留空（A 的规则）", () => {
  const px = [[255, 0, 0, 255], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]];
  const r = sampleCell(px, { mode: SAMPLING_MODE.ADAPTIVE });
  assert.equal(r.empty, true);
  assert.equal(r.rgb, null);
});

test("sampleCell 显式 robust-mean 时标注 LOCAL_UNVERIFIED", () => {
  const px = [];
  for (let i = 0; i < 20; i++) px.push([100, 100, 100, 255]);
  const r = sampleCell(px, { mode: SAMPLING_MODE.ROBUST_MEAN });
  assert.equal(r.mode, SAMPLING_MODE.ROBUST_MEAN);
  assert.equal(r.diagnostics.localUnverified, PROVENANCE.LOCAL_UNVERIFIED);
});

/* ============================================================
 * 七分类
 * ========================================================== */

test("classifySmallComponent：高光/眼点 → HIGHLIGHT", () => {
  const grid = gridFrom([["S1", "S1"], ["S1", "K1"]]);
  const r = classifySmallComponent({ key: "K1", size: 1, pixels: [[1, 1]] }, {
    grid, cols: 2, rows: 2, getColorKey: CODE, getRGB: rgbOf,
    highlightMap: Float32Array.from([0, 0, 0, 0.9]),
  });
  assert.equal(r.category, COMPONENT_CATEGORY.HIGHLIGHT);
  assert.equal(r.allowAutoAction, false);
});

test("classifySmallComponent：结构保护命中 → STRUCTURE", () => {
  const grid = gridFrom([["W1", "W1"], ["W1", "K1"]]);
  const r = classifySmallComponent({ key: "K1", size: 1, pixels: [[1, 1]] }, {
    grid, cols: 2, rows: 2, getColorKey: CODE, getRGB: rgbOf,
    tierMap: Uint8Array.from([0, 0, 0, 3]),
  });
  assert.equal(r.category, COMPONENT_CATEGORY.STRUCTURE);
});

test("classifySmallComponent：证据不足 → UNKNOWN 且不可自动删", () => {
  const grid = gridFrom([["W1", "W1"], ["W1", "K1"]]);
  const r = classifySmallComponent({ key: "K1", size: 1, pixels: [[1, 1]] }, {
    grid, cols: 2, rows: 2, getColorKey: CODE, getRGB: rgbOf,
  });
  assert.equal(r.category, COMPONENT_CATEGORY.UNKNOWN);
  assert.equal(r.allowAutoAction, false);
  assert.equal(r.confidence <= 0.5, true);
});

test("classifySmallComponent：单格全支持时判不出 NOISE（support ≥ 0.42）", () => {
  const grid = gridFrom([["W1", "W1", "W1"], ["W1", "K1", "W1"], ["W1", "W1", "W1"]]);
  const r = classifySmallComponent({ key: "K1", size: 1, pixels: [[1, 1]] }, {
    grid, cols: 3, rows: 3, getColorKey: CODE, getRGB: rgbOf,
    cellFeatures: Array(9).fill(null).map(() => ({ dominantShare: 1.0 })),
  });
  // 关键：不能因为「只有 1 格」就删
  assert.notEqual(r.category, COMPONENT_CATEGORY.NOISE);
  assert.equal(r.allowAutoAction, false);
});

test("classifySmallComponent：低支持 + 邻色充足时可判 NOISE", () => {
  const grid = gridFrom([
    ["W1", "W1", "W1", "W1"],
    ["W1", "K1", "W1", "W1"],
    ["W1", "W1", "G1", "W1"],
    ["W1", "W1", "W1", "B1"],
  ]);
  const r = classifySmallComponent({ key: "K1", size: 1, pixels: [[1, 1]] }, {
    grid, cols: 4, rows: 4, getColorKey: CODE, getRGB: rgbOf,
    cellFeatures: Array(16).fill(null).map(() => ({ dominantShare: 0.2 })),
    tierMap: new Uint8Array(16),
    protectionMap: new Float32Array(16),
    protectionReasonMap: new Uint8Array(16),
    highlightMap: new Float32Array(16),
    eyeLikeMap: new Float32Array(16),
  });
  assert.notEqual(r.category, COMPONENT_CATEGORY.UNKNOWN);
  if (r.category === COMPONENT_CATEGORY.NOISE) {
    assert.ok(r.confidence >= 0.5);
    assert.ok(r.allowAutoAction === (r.confidence >= 0.75));
  }
});

/* ============================================================
 * Topology
 * ========================================================== */

test("connectedComponents 数出同色 4 邻连通域", () => {
  const grid = gridFrom([["W1", "W1", "K1"], ["W1", "K1", "K1"]]);
  assert.equal(connectedComponents(grid, CODE).length, 2);
});

test("backgroundHoles 数出不接边的空腔", () => {
  const grid = gridFrom([
    ["R1", "R1", "R1", "R1"],
    ["R1", ".", ".", "R1"],
    ["R1", ".", ".", "R1"],
    ["R1", "R1", "R1", "R1"],
  ]);
  assert.equal(backgroundHoles(grid).length, 1);
});

test("isConnectedWithout：去掉关节格后不再连通", () => {
  const line = [[0, 0], [1, 0], [2, 0]];
  assert.equal(isConnectedWithout(line, [1, 0], 4), false, "去掉中间格 → 断成两截");
  assert.equal(isConnectedWithout(line, [0, 0], 4), true);
});

test("TopologyGuard 默认拒绝会改变孔洞数的提案", () => {
  // 单格孔洞：填掉它就真的没了（2×2 的孔填一格仍剩一个孔，测不出变化）
  const grid = gridFrom([
    ["R1", "R1", "R1"],
    ["R1", ".", "R1"],
    ["R1", "R1", "R1"],
  ]);
  assert.equal(backgroundHoles(grid).length, 1);
  const guard = new TopologyGuard(grid, CODE);
  const d = guard.check({ x: 1, y: 1, to: { code: "R1", rgb: rgbOf("R1") } });
  assert.equal(d.verdict, "REJECT");
  assert.ok(d.reasons.some((r) => r.startsWith("hole-change")));
});

test("TopologyGuard 拒绝会拆散组件的提案（桥）", () => {
  const grid = gridFrom([["G1", "G1", "G1"]]);
  const guard = new TopologyGuard(grid, CODE);
  const d = guard.check({ x: 1, y: 0, to: { code: "W1", rgb: rgbOf("W1") } });
  assert.equal(d.verdict, "REJECT");
  assert.ok(d.reasons.some((r) => r.includes("bridge-removal")));
});

test("TopologyGuard 放行同色内部的无副作用改动", () => {
  const grid = gridFrom([["G1", "G1"], ["G1", "G1"]]);
  const guard = new TopologyGuard(grid, CODE);
  const d = guard.check({ x: 0, y: 0, to: { code: "G1", rgb: rgbOf("G1") } });
  assert.equal(d.verdict, "ALLOW");
  assert.deepEqual(d.reasons, ["no-change"]);
});

/* ============================================================
 * ProtectedDetailMask
 * ========================================================== */

test("selectAccentKeys 按 G 规则选 ≤3 个高色度色", () => {
  const grid = gridFrom([
    ["R1", "R1", "G1", "G1"],
    ["B1", "B1", "Y1", "Y1"],
    ["W1", "W1", "K1", "K1"],
  ]);
  const { accents } = selectAccentKeys(grid, CODE, rgbOf);
  assert.ok(accents.length <= 3);
  assert.ok(accents.every((c) => ["R1", "G1", "B1", "Y1"].includes(c)), `实际 ${accents}`);
});

test("ProtectedDetailMask 阻挡受保护格的改动", () => {
  const grid = gridFrom([["S1", "S1"], ["S1", "K1"]]);
  const mask = buildProtectedDetailMask({
    grid, cols: 2, rows: 2,
    getColorKey: (c) => c?.code, getRGB: rgbOf,
    components: [],
  });
  // 手动把 (1,1) 标成受保护
  mask.mask[3] = 1;
  mask.layerMap[3] = MASK_LAYER.EYE_HIGHLIGHT;
  const guard = new TopologyGuard(grid, CODE);
  const d = requestChange(mask, guard, 1, 1, { code: "S1", rgb: rgbOf("S1") });
  assert.equal(d.applied, false);
  assert.equal(d.verdict, "REJECT");
  assert.ok(d.reasons[0].startsWith("protected:"));
});

test("requestChange 在非保护格且拓扑放行时才写入", () => {
  const grid = gridFrom([["W1", "W1", "W1"], ["W1", "W1", "W1"], ["W1", "W1", "W1"]]);
  const mask = buildProtectedDetailMask({
    grid, cols: 3, rows: 3, getColorKey: (c) => c?.code, getRGB: rgbOf, components: [],
  });
  const guard = new TopologyGuard(grid, CODE);
  const d = requestChange(mask, guard, 1, 1, { code: "W1", rgb: rgbOf("W1") });
  assert.equal(d.verdict, "ALLOW");
});

/* ============================================================
 * Metrics
 * ========================================================== */

test("snapshot 覆盖九项指标且都是有限数", () => {
  const grid = gridFrom([["W1", "W1"], ["W1", "K1"]]);
  const s = snapshot(grid, { getColorKey: CODE, getRGB: rgbOf });
  for (const key of METRIC_KEYS) {
    const val = s[key];
    if (typeof val === "number") assert.ok(Number.isFinite(val), `${key}=${val}`);
  }
  assert.equal(s.paletteSize, 2);
  assert.equal(s.componentCount, 2);
});

test("diffSnapshot 给出 BEFORE/AFTER 差值", () => {
  const a = snapshot(gridFrom([["W1", "W1"], ["R1", "R1"]]), { getColorKey: CODE, getRGB: rgbOf });
  const b = snapshot(gridFrom([["W1", "W1"], ["W1", "W1"]]), { getColorKey: CODE, getRGB: rgbOf });
  const d = diffSnapshot(a, b);
  assert.equal(d.paletteSize, -1);
  assert.equal(d.componentCount, -1);
});

/* ============================================================
 * Adaptive Resolution
 * ========================================================== */

test("候选尺寸评估不声称最优，且输出四档状态", () => {
  const src = image(128, 128, (x, y) => ((x + y) % 16 < 8 ? [30, 30, 30] : [230, 230, 230]));
  const r = evaluateCandidateSizes({ imageData: src, sourceWidth: 128, sourceHeight: 128 });
  assert.equal(r.status, "candidate-evaluation-not-optimized");
  assert.ok(r.disclaimer.includes("不声称"));
  assert.equal(r.candidates.length, 6);
  for (const c of r.candidates) {
    assert.ok(Object.values(CANDIDATE_STATUS).includes(c.status), `${c.longSide} 状态非法`);
    assert.ok(Array.isArray(c.assessment.reasons));
  }
  assert.ok(Array.isArray(r.reasons));
});

test("manualSize 原样保留，不被 AUTO 覆盖", () => {
  const src = image(64, 64, () => [128, 128, 128]);
  const r = evaluateCandidateSizes({
    imageData: src, sourceWidth: 64, sourceHeight: 64, manualSize: { cols: 40, rows: 40 },
  });
  assert.equal(r.manualOverride, true);
  assert.ok(r.reasons.includes("manualSizePreserved"));
  assert.equal(r.advice.recommendedCols, 40);
  assert.equal(r.advice.recommendedRows, 40);
});

test("候选长边就是 52/78/104/120/140/160", () => {
  const src = image(64, 64, () => [128, 128, 128]);
  const r = evaluateCandidateSizes({ imageData: src, sourceWidth: 64, sourceHeight: 64 });
  assert.deepEqual(r.candidates.map((c) => c.longSide), [52, 78, 104, 120, 140, 160]);
});

/* ============================================================
 * 全链路
 * ========================================================== */

test("runHybridV2 输出契约完整", () => {
  const src = image(48, 48, (x, y) => (x > 24 ? [30, 30, 30] : [230, 230, 230]));
  const r = runHybridV2({ imageData: src, palette: PALETTE, cols: 24, rows: 24, maxColors: 4 });
  assert.equal(r.engine, HYBRID_V2_ENGINE_ID);
  assert.equal(r.matrix.length, 24);
  assert.equal(r.matrix[0].length, 24);
  assert.equal(r.cols, 24);
  assert.equal(r.rows, 24);
  assert.ok(Array.isArray(r.usedColors));
  assert.ok(r.diagnostics);
  assert.ok(Array.isArray(r.stageMetrics));
  assert.ok(r.stageMetrics.length >= 4);
  const known = new Set(PALETTE.map((e) => e.code));
  for (const row of r.matrix) for (const c of row) if (c != null) assert.ok(known.has(c), `未知色号 ${c}`);
});

test("runHybridV2 记录 requested 与 effective 两套顺序", () => {
  const src = image(32, 32, () => [128, 128, 128]);
  const r = runHybridV2({ imageData: src, palette: PALETTE, cols: 16, rows: 16 });
  assert.equal(r.diagnostics.pipelineOrder.requested.length, 13);
  assert.ok(r.diagnostics.pipelineOrder.effective.length >= 13);
  assert.ok(r.diagnostics.pipelineOrder.deviationNote.includes("保护"));
});

test("runHybridV2 尊重 maxColors", () => {
  const src = image(32, 32, (x, y) => [[220, 60, 60], [70, 170, 80], [60, 110, 200], [245, 215, 70], [16, 16, 16]][(x + y) % 5]);
  const r = runHybridV2({ imageData: src, palette: PALETTE, cols: 16, rows: 16, maxColors: 3 });
  assert.ok(r.usedColors.length <= 3, `实际 ${r.usedColors.length}`);
});

test("runHybridV2 缺色板时抛错（不内置色卡）", () => {
  const src = image(8, 8, () => [128, 128, 128]);
  assert.throws(() => runHybridV2({ imageData: src, palette: [], cols: 4, rows: 4 }), /palette/);
});

test("runHybridV2 每个阶段都有 before/after/delta", () => {
  const src = image(32, 32, (x, y) => (x % 8 < 4 ? [40, 40, 40] : [220, 220, 220]));
  const r = runHybridV2({ imageData: src, palette: PALETTE, cols: 16, rows: 16 });
  for (const s of r.stageMetrics) {
    assert.ok(s.before, `${s.stage} 缺 before`);
    assert.ok(s.after, `${s.stage} 缺 after`);
    assert.ok(s.delta, `${s.stage} 缺 delta`);
  }
});

/* ============================================================
 * 回归夹具（10 类）
 * ========================================================== */

test("回归夹具：10 类全部通过不变量", () => {
  const results = runFixtureSuite((f) => runHybridV2({
    imageData: f.imageData, palette: f.palette, cols: f.cols, rows: f.rows, maxColors: f.maxColors,
  }));
  assert.equal(results.length, 10);
  for (const r of results) {
    for (const c of r.checks) {
      assert.ok(c.pass, `${r.kind} · ${c.name} 失败：${c.detail}`);
    }
  }
});

test("回归夹具覆盖用户点名的全部类别", () => {
  const kinds = new Set(FIXTURES.map((f) => f.kind));
  for (const k of Object.values(FIXTURE_KIND)) assert.ok(kinds.has(k), `缺少夹具 ${k}`);
});

test("保护优先：眼睛夹具的瞳孔格不会被任何阶段改色", () => {
  const fixture = FIXTURES.find((f) => f.kind === FIXTURE_KIND.PORTRAIT_EYE);
  const r = runHybridV2({
    imageData: fixture.imageData, palette: fixture.palette, cols: fixture.cols, rows: fixture.rows, maxColors: 2,
  });
  // 即便 maxColors=2 强压，瞳孔仍应保留
  assert.equal(r.matrix[9][7], "K1");
  assert.equal(r.matrix[10][12], "K1");
});
