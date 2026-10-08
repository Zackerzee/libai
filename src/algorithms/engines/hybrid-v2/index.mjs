/**
 * Hybrid V2 —— 实验引擎（Phase B）。
 *
 * ⚠️ 定位：**受控实验臂**，不是产品主链。
 *   - 不修改 CURRENT、不修改网站 UI、不接生产链、不改变默认 104 行为。
 *   - 不声称优于 CURRENT；只输出可比较的指标（见 stageMetrics）。
 *
 * 统一接口：
 *   runHybridV2(input, options) ->
 *     { matrix, cols, rows, palette, usedColors, diagnostics, stageMetrics }
 *
 * 链路（docs/research/HYBRID_V2_IMPLEMENTATION_PLAN.md §3）：
 *   Geometry/Crop → Cell Mapping → Adaptive Cell Sampling → Palette Matching
 *   → MaxColors → Structure Protection → Region Analysis → Safe Fragment Cleanup
 *   → Topology Protection → Edge Contamination Cleanup → Eye/Highlight Protection
 *   → Flat Region Regularization → Final BeadMatrix
 *
 * 顺序偏差（与 Batch F 同一套处理）：用户要求的顺序里 MaxColors 在 Structure Protection
 * **之前**，但降色若没有 protectedKeys 会把结构色挤掉。因此：
 *   - 先在**采样网格**上算结构/高光保护（前置扫描），把受保护色号作为 protectedKeys 交给 MaxColors；
 *   - MaxColors 之后再在**最终矩阵**上重建权威保护掩码，供清理阶段用。
 * 两套顺序都写进 `diagnostics.pipelineOrder`，不藏这个决定。
 */

import { HybridV2Config, HYBRID_V2_ENGINE_ID, HYBRID_V2_VERSION, flattenConfig, buildConfigMeta, PROVENANCE } from "./config.mjs";
import { asRaster, sampleGrid, cellBounds, SAMPLING_MODE } from "./sampling.mjs";
import { createPaletteEngine } from "../../../../smart-preprocessing/palette-engine.mjs";
import { buildPaletteBudgetPlan, applyBudgetPlan } from "../../../../smart-preprocessing/protected-palette-budget-v2.mjs";
import { buildProtectedDetailMask, selectAccentKeys } from "./protected-mask.mjs";
import { classifySmallComponent, COMPONENT_CATEGORY } from "./classify.mjs";
import { TopologyGuard, connectedComponents } from "./topology.mjs";
import { safeFragmentCleanup, edgeContaminationCleanup, flatRegionRegularization } from "./cleanup.mjs";
import { snapshot, diffSnapshot, METRIC_KEYS } from "./metrics.mjs";
import { evaluateCandidateSizes } from "./resolution.mjs";
import { ProposalTracer, STAGE, DECISION, PROTECTION_LAYER } from "./trace.mjs";

const v = (node) => node.value;

export const HYBRID_V2_STAGES = Object.freeze({
  requested: Object.freeze([
    "Geometry / Crop",
    "Cell Mapping",
    "Adaptive Cell Sampling",
    "Palette Matching",
    "MaxColors",
    "Structure Protection",
    "Region Analysis",
    "Safe Fragment Cleanup",
    "Topology Protection",
    "Edge Contamination Cleanup",
    "Eye / Highlight Protection",
    "Flat Region Regularization",
    "Final BeadMatrix",
  ]),
  effective: Object.freeze([
    "Geometry / Crop",
    "Cell Mapping",
    "Adaptive Cell Sampling",
    "Palette Matching",
    "Structure Protection (pre-scan, for protectedKeys)",
    "MaxColors (with protectedKeys)",
    "Structure Protection (authoritative mask)",
    "Region Analysis",
    "Safe Fragment Cleanup",
    "Topology Protection",
    "Edge Contamination Cleanup",
    "Flat Region Regularization",
    "Final BeadMatrix",
  ]),
  deviationNote: "保护必须在降色之前扫描；降色通过 protectedKeys 在计划构建期生效。用户要求的顺序里 MaxColors 先于 Structure Protection，若不前置扫描，结构色会被挤掉。两套顺序都记录在案。",
});

const FEATURE_FLAG_KEYS = Object.freeze([
  "icmSpatialRefinement",
  "dithering",
  "aggressiveRegionMerge",
  "experimentalDominantSampling",
  "robustMeanSampling",
]);

function resolveFeatureFlags(overrides = {}) {
  const flags = {};
  for (const key of FEATURE_FLAG_KEYS) {
    flags[key] = overrides[key] === undefined ? v(HybridV2Config.featureFlags[key]) : Boolean(overrides[key]);
  }
  return flags;
}

/**
 * @param {object} input { imageData, palette, cols, rows, maxColors?, crop? }
 * @param {object} options { samplingMode, featureFlags, config, includeBlockArt }
 */
export function runHybridV2(input, options = {}) {
  const startedAt = Date.now();
  const source = asRaster(input.imageData);
  const palette = input.palette;
  if (!Array.isArray(palette) || !palette.length) throw new Error("hybrid-v2: palette 必填（本模块不内置色卡）");

  const flags = resolveFeatureFlags(options.featureFlags);
  const cfg = { ...flattenConfig(HybridV2Config), ...(options.config || {}) };
  const protectionMode = (input.protectionMode || options.protectionMode) === "TRACE_ONLY" ? "TRACE_ONLY" : "STRICT";
  const tracer = new ProposalTracer({ mode: protectionMode });
  const cols = Math.max(1, Math.round(input.cols ?? input.width ?? 0));
  const rows = Math.max(1, Math.round(input.rows ?? input.height ?? 0));
  if (!cols || !rows) throw new Error("hybrid-v2: cols / rows 必填");
  const maxColors = Math.max(0, Number(input.maxColors) || 0);

  const codeToRgb = new Map(palette.map((e) => [String(e.code), e.rgb]));
  const getColorKey = (cell) => (typeof cell === "string" ? cell : cell?.code);
  const getRGB = (key) => codeToRgb.get(String(key)) || [0, 0, 0];

  const stageMetrics = [];
  const recordStage = (stage, before, after) => {
    stageMetrics.push({ stage, before, after, delta: diffSnapshot(before, after) });
  };

  /* ── ① Geometry / Crop ─────────────────────────────────── */
  const raster = applyCrop(source, input.crop);
  const geometry = { source: { width: source.width, height: source.height }, cropped: { width: raster.width, height: raster.height }, crop: input.crop || null };

  /* ── ② Cell Mapping ────────────────────────────────────── */
  const mapping = { cols, rows, cellBoundsFn: (x, y) => cellBounds(x, y, raster.width, raster.height, cols, rows) };

  /* ── ③ Adaptive Cell Sampling ──────────────────────────── */
  const samplingMode = options.samplingMode || SAMPLING_MODE.ADAPTIVE;
  const sampled = sampleGrid(raster, cols, rows, { mode: samplingMode, config: cfg });
  const cellSourceRgb = sampled.colors;
  const sourceLuma = buildSourceLuma(sampled.colors, cols, rows);

  /* ── ④ Palette Matching ──────────────────────────────────
   * 内部工作网格用**色对象**（`{code, rgb}` 或 null）—— `applyBudgetPlan` 会原地改
   * `cell.code`，字符串格会抛错。对外输出的 `matrix` 再转成色号二维行数组。 */
  const engine = createPaletteEngine(palette);
  const matrix = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const rgb = sampled.colors[y * cols + x];
      if (!rgb) { row.push(null); continue; }
      const matched = engine.match(rgb);
      row.push(matched ? { code: String(matched.code), rgb: getRGB(matched.code) } : null);
    }
    matrix.push(row);
  }

  const metricsCtx = {
    getColorKey,
    getRGB,
    cellFeatures: sampled.features,
    varianceMax: cfg.varianceMax ?? v(HybridV2Config.flatRegion.varianceMax),
    sourceLuma,
  };
  let before = snapshot(matrix, metricsCtx);

  /* ── 前置：Structure Protection 扫描（在已匹配矩阵上算，供 MaxColors 的 protectedKeys 用）── */
  const preMask = buildProtectedDetailMask({
    grid: matrix,
    cols,
    rows,
    getColorKey: (cell) => cell?.code,
    getRGB: (key) => codeToRgb.get(String(key)) || [0, 0, 0],
    sourceImageData: raster,
    cellBoundsFn: mapping.cellBoundsFn,
    components: [],
    config: cfg,
  });
  const baselineProtectedKeys = protectedKeysFrom(preMask, matrix, getColorKey);

  /* ── ⑤ MaxColors（带 protectedKeys）────────────────────── */
  let maxColorsReport = { applied: false };
  if (maxColors > 0) {
    const plan = buildPaletteBudgetPlan({
      grid: matrix,
      getColorKey,
      getRGBByKey: getRGB,
      maxColors,
      protectionMap: preMask.mask,
      tierMap: preMask.tierMap,
      protectionReasonMap: preMask.reasonMap,
      // protectedKeys 必须是 Set（protected-palette-budget-v2 调用 .has()）
      protectedKeys: baselineProtectedKeys,
      options: {},
    });
    if (plan && plan.length) {
      const applied = applyBudgetPlan(matrix, getColorKey, plan, (key) => ({ code: key, rgb: getRGB(key) }));
      maxColorsReport = { applied: true, planSize: plan.length, removed: plan.length, grid: applied ? "applied" : "unchanged" };
    }
  }
  let after = snapshot(matrix, { ...metricsCtx, baselineProtectedKeys });
  recordStage("MaxColors", before, after);
  before = after;

  /* ── ⑥ Structure Protection（权威掩码）───────────────────── */
  const objectGrid = matrix;
  const comps = connectedComponents(matrix, getColorKey, 4);
  const smallComps = comps.filter((c) => c.size <= (cfg.maxComponentSize ?? v(HybridV2Config.cleanup.maxComponentSize)));
  const classifications = smallComps.map((c) => ({
    component: { key: c.key, size: c.size, pixels: c.pixels },
    ...classifySmallComponent(c, {
      grid: matrix, cols, rows, getColorKey, getRGB,
      tierMap: preMask.tierMap, protectionMap: preMask.mask, protectionReasonMap: preMask.reasonMap,
      highlightMap: preMask.highlightMap, eyeLikeMap: preMask.eyeLikeMap, edgeMap: preMask.edgeMap,
      cellFeatures: sampled.features, cellSourceRgb, config: cfg,
    }),
  }));
  const protectedMask = buildProtectedDetailMask({
    grid: objectGrid, cols, rows,
    getColorKey: (cell) => cell?.code,
    getRGB: (key) => codeToRgb.get(String(key)) || [0, 0, 0],
    sourceImageData: raster,
    cellBoundsFn: mapping.cellBoundsFn,
    components: classifications,
    config: cfg,
  });
  after = snapshot(matrix, { ...metricsCtx, baselineProtectedKeys, protectedMask });
  recordStage("Structure Protection", before, after);
  before = after;

  /* ── ⑦⑧⑨ Safe Fragment Cleanup + Topology Guard ─────────── */
  const guard = new TopologyGuard(matrix, getColorKey, {
    allowHoleChange: cfg.allowHoleChange ?? v(HybridV2Config.topology.allowHoleChange),
    allowOpeningClosure: cfg.allowOpeningClosure ?? v(HybridV2Config.topology.allowOpeningClosure),
    ownerConnectivity: cfg.ownerConnectivity ?? v(HybridV2Config.topology.ownerConnectivity),
  });
  const cleanupCtx = {
    cols, rows, getColorKey, getRGB,
    cellFeatures: sampled.features,
    cellSourceRgb,
    protectedMask,
    guard,
    config: cfg,
    tracer,
    mode: protectionMode,
  };
  const fragment = safeFragmentCleanup(matrix, cleanupCtx);
  after = snapshot(matrix, { ...metricsCtx, baselineProtectedKeys, protectedMask });
  recordStage("Safe Fragment Cleanup", before, after);
  before = after;

  /* ── ⑩ Edge Contamination Cleanup ──────────────────────── */
  const edge = edgeContaminationCleanup(matrix, cleanupCtx);
  after = snapshot(matrix, { ...metricsCtx, baselineProtectedKeys, protectedMask });
  recordStage("Edge Contamination Cleanup", before, after);
  before = after;

  /* ── ⑫ Flat Region Regularization ──────────────────────── */
  const flat = flatRegionRegularization(matrix, cleanupCtx);
  after = snapshot(matrix, { ...metricsCtx, baselineProtectedKeys, protectedMask });
  recordStage("Flat Region Regularization", before, after);

  /* ── 输出 ──────────────────────────────────────────────── */
  const used = new Set();
  for (const row of matrix) for (const cell of row) if (cell != null) used.add(getColorKey(cell));

  const codeMatrix = matrix.map((row) => row.map((cell) => (cell ? String(cell.code) : null)));

  return {
    engine: HYBRID_V2_ENGINE_ID,
    matrix: codeMatrix,
    cols,
    rows,
    palette,
    usedColors: [...used].sort(),
    diagnostics: {
      engine: HYBRID_V2_ENGINE_ID,
      version: HYBRID_V2_VERSION,
      geometry,
      mapping,
      sampling: {
        mode: samplingMode,
        modeCounts: countBy(sampled.modes),
        localUnverifiedModes: sampled.modes.filter((m) => m === SAMPLING_MODE.ROBUST_MEAN).length,
      },
      featureFlags: flags,
      pipelineOrder: {
        requested: HYBRID_V2_STAGES.requested,
        effective: HYBRID_V2_STAGES.effective,
        deviationNote: HYBRID_V2_STAGES.deviationNote,
      },
      classifications: summarizeClassifications(classifications),
      topology: guard.report,
      cleanup: {
        fragmentChanged: fragment.changed,
        fragmentRejected: fragment.rejected,
        fragmentComponents: fragment.componentCount,
        edgeChanged: edge.changed,
        edgeRejected: edge.rejected,
        edgeCandidates: edge.candidateCount,
        flatChanged: flat.changed,
        flatRejected: flat.rejected,
        flatBlocks: flat.blockCount,
      },
      maxColors: maxColorsReport,
      accents: protectedMask.accents,
      protectedCount: protectedMask.protectedCount,
      configMeta: buildConfigMeta(),
      timingMs: Date.now() - startedAt,
    },
    stageMetrics,
    // ── Phase B.1 可解释性诊断（不影响生成；仅记录）──────────
    protectionMode,
    proposalTrace: tracer.proposals,
    gateAudit: tracer.audit(),
    hypothetical: tracer.hypothetical,
  };
}

/* ────────────────────────────────────────────────────────────
 * 辅助
 * ──────────────────────────────────────────────────────────── */

function applyCrop(source, crop) {
  if (!crop) return source;
  const x0 = Math.max(0, Math.floor(crop.x0 ?? 0));
  const y0 = Math.max(0, Math.floor(crop.y0 ?? 0));
  const x1 = Math.min(source.width, Math.ceil(crop.x1 ?? source.width));
  const y1 = Math.min(source.height, Math.ceil(crop.y1 ?? source.height));
  const w = Math.max(1, x1 - x0);
  const h = Math.max(1, y1 - y0);
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const si = ((y + y0) * source.width + (x + x0)) * 4;
      const di = (y * w + x) * 4;
      data[di] = source.data[si];
      data[di + 1] = source.data[si + 1];
      data[di + 2] = source.data[si + 2];
      data[di + 3] = source.data[si + 3];
    }
  }
  return { width: w, height: h, data };
}

function toObjectGrid(colors, cols, rows, codeToRgb) {
  const grid = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const cell = colors[y * cols + x];
      if (cell == null) { row.push(null); continue; }
      const code = typeof cell === "string" ? cell : cell.code;
      row.push({ code, rgb: codeToRgb.get(String(code)) || [0, 0, 0] });
    }
    grid.push(row);
  }
  return grid;
}

function buildSourceLuma(colors, cols, rows) {
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    const c = colors[i];
    out[i] = c ? 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2] : 0;
  }
  return out;
}

/** 保护掩码 → 受保护的**色号**集合（protectedKeys 必须是色号，不能是索引）。 */
function protectedKeysFrom(mask, grid, getColorKey) {
  const out = new Set(mask.accents || []);
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < grid[y].length; x++) {
      const cell = grid[y][x];
      if (cell == null) continue;
      if (mask.mask[y * grid[y].length + x]) out.add(getColorKey(cell));
    }
  }
  return out;
}

function countBy(list) {
  const out = {};
  for (const item of list) out[item] = (out[item] || 0) + 1;
  return out;
}

function summarizeClassifications(list) {
  const out = {};
  for (const entry of list) {
    out[entry.category] = (out[entry.category] || 0) + 1;
    if (entry.category === COMPONENT_CATEGORY.NOISE && entry.allowAutoAction) out.autoActionable = (out.autoActionable || 0) + 1;
  }
  return out;
}

/* ────────────────────────────────────────────────────────────
 * 导出
 * ──────────────────────────────────────────────────────────── */

export {
  HybridV2Config, flattenConfig, buildConfigMeta, PROVENANCE, HYBRID_V2_ENGINE_ID, HYBRID_V2_VERSION,
};
export { SAMPLING_MODE, sampleCell, sampleGrid, cellBounds, asRaster } from "./sampling.mjs";
export {
  COMPONENT_CATEGORY, classifySmallComponent,
} from "./classify.mjs";
export { TopologyGuard, connectedComponents, backgroundHoles, openingCount, isConnectedWithout } from "./topology.mjs";
export { buildProtectedDetailMask, requestChange, selectAccentKeys, MASK_LAYER, classifyProtectionLayer } from "./protected-mask.mjs";
export { safeFragmentCleanup, edgeContaminationCleanup, flatRegionRegularization } from "./cleanup.mjs";
export { ProposalTracer, STAGE, DECISION, PROTECTION_LAYER, classifyCleanupBenefit, classifyDamageRisk, mergeAudit, mergeHypothetical } from "./trace.mjs";
export { snapshot, diffSnapshot, METRIC_KEYS, isolatedCellCount, edgeContaminationCount, dominantColorRatio, structureSimilarity } from "./metrics.mjs";
export { evaluateCandidateSizes, preEvaluateCandidate, CANDIDATE_STATUS, CANDIDATE_LONG_SIDES } from "./resolution.mjs";

export default { runHybridV2 };
