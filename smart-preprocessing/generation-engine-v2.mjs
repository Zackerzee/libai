/**
 * Generation Engine V2.5 — Orchestrator / Pipeline Coordinator
 *
 * V2 生成链路：
 *   Source → [Subject Crop] → Sampling Engine V2 → Palette Matching (palette-engine)
 *          → [Auto Background] → [Stroke Mask] → Detail Protection
 *          → Smart Cleanup → Protected Palette Budget ([Accent Protection]) → Final Grid
 *
 * 方括号里的四步是 V2.5 新增的「智能辅助」，全部**默认关闭**：
 * 只有显式打开对应开关（或选「小白一键」预设）才会进入，保证既有默认链路逐位不变。
 *   - Subject Crop   ：先自动裁到主体，让图案铺满画布（subject-crop.mjs）
 *   - Auto Background：把与边框连通的浅色区域判为真空豆（auto-background.mjs）
 *   - Stroke Mask    ：把线稿描边位置抬进保护图，避免描边被清理糊掉（stroke-mask.mjs）
 *   - Accent        ：降色时把关键强调色（眼睛/描边/高光）标为不主动合并（accent-protection.mjs）
 *
 * 本文件只负责编排与 diagnostics，不承载具体算法实现。
 * 算法分属：sampling-engine-v2 / detail-protection-v2 / smart-cleanup-v2 / protected-palette-budget-v2
 *          / subject-crop / auto-background / stroke-mask / accent-protection。
 *
 * Legacy Engine（app.js 的 processImage / nearestColor）保持不动，作为可回退生成路径。
 */

import { sampleGrid, sampleGridAdaptive, analyzeImageFeatures, resolveSamplingMode, cellBounds, SamplingMode } from "./sampling-engine-v2.mjs";
import { buildProtectionMap, calculateSourceEvidence } from "./detail-protection-v2.mjs";
import { smartCleanup } from "./smart-cleanup-v2.mjs";
import { buildPaletteBudgetPlan, applyBudgetPlan, countGridColors } from "./protected-palette-budget-v2.mjs";
import { createPaletteEngine } from "./palette-engine.mjs";
import { cropToSubject } from "./subject-crop.mjs";
import { resolveBackgroundMask, applyBackgroundBlanks } from "./auto-background.mjs";
import { extractStrokeMask } from "./stroke-mask.mjs";
import { detectAnchorColors } from "./accent-protection.mjs";

export { SamplingMode };

/* =========================================================
 * Preset（只是 config，不建立六套生成器）
 * ======================================================= */

export const GenerationProfiles = Object.freeze({
  photo: Object.freeze({ id: "photo", sampling: "edge-aware", detailProtection: 0.7, edgeProtection: 0.5, highlightProtection: 0.7, eyeProtection: 0.9, microDetailProtection: 0.6, cleanupProtectionThreshold: 0.5 }),
  portrait: Object.freeze({ id: "portrait", sampling: "edge-aware", detailProtection: 0.9, edgeProtection: 0.5, highlightProtection: 0.9, eyeProtection: 1.0, microDetailProtection: 0.8, cleanupProtectionThreshold: 0.45 }),
  anime: Object.freeze({ id: "anime", sampling: "dominant", detailProtection: 0.9, edgeProtection: 0.9, highlightProtection: 1.0, eyeProtection: 1.0, microDetailProtection: 0.9, cleanupProtectionThreshold: 0.4 }),
  illustration: Object.freeze({ id: "illustration", sampling: "dominant", detailProtection: 0.7, edgeProtection: 0.9, highlightProtection: 0.5, eyeProtection: 0.5, microDetailProtection: 0.7, cleanupProtectionThreshold: 0.5 }),
  pixel: Object.freeze({ id: "pixel", sampling: "center", detailProtection: 0.9, edgeProtection: 0.9, highlightProtection: 0.5, eyeProtection: 0.5, microDetailProtection: 0.9, cleanupProtectionThreshold: 0.2 }),
  logo: Object.freeze({ id: "logo", sampling: "dominant", detailProtection: 0.4, edgeProtection: 0.9, highlightProtection: 0.3, eyeProtection: 0.3, microDetailProtection: 0.4, cleanupProtectionThreshold: 0.6 }),
  auto: Object.freeze({ id: "auto", sampling: "auto", detailProtection: 0.7, edgeProtection: 0.7, highlightProtection: 0.8, eyeProtection: 0.9, microDetailProtection: 0.8, cleanupProtectionThreshold: 0.5 }),
  // 小白一键：面向「不懂参数、只想一键出好图」的新手。
  // 采样走 auto（自适应），保护档偏保守（宁可多留细节），清理温和；配合四个智能辅助开关使用。
  beginner: Object.freeze({ id: "beginner", sampling: "auto", detailProtection: 0.8, edgeProtection: 0.9, highlightProtection: 0.9, eyeProtection: 1.0, microDetailProtection: 0.9, cleanupProtectionThreshold: 0.45 }),
});

export const DEFAULT_GENERATION_V2_CONFIG = Object.freeze({
  preset: "photo",
  sampling: "auto",
  detailProtection: 0.7,
  edgeProtection: 0.7,
  highlightProtection: 1.0,
  eyeProtection: 1.0,
  microDetailProtection: 1.0,
  maxColors: 0,
});

function resolveOptions(options = {}) {
  const preset = GenerationProfiles[options.preset] || GenerationProfiles.photo;
  return {
    sampling: options.sampling ?? preset.sampling,
    detailProtection: options.detailProtection ?? preset.detailProtection,
    edgeProtection: options.edgeProtection ?? preset.edgeProtection,
    highlightProtection: options.highlightProtection ?? preset.highlightProtection,
    eyeProtection: options.eyeProtection ?? preset.eyeProtection,
    microDetailProtection: options.microDetailProtection ?? preset.microDetailProtection,
    cleanupProtectionThreshold: options.cleanupProtectionThreshold ?? preset.cleanupProtectionThreshold,
    maxColors: options.maxColors ?? DEFAULT_GENERATION_V2_CONFIG.maxColors,
    // V2.5 智能辅助：默认全关（=== true 严格判定，避免 undefined/真值混淆）
    subjectCrop: options.subjectCrop === true,
    autoBackground: options.autoBackground === true,
    strokeProtection: options.strokeProtection === true,
    accentProtection: options.accentProtection === true,
    // 线稿掩码抬升保护图的增益（1 表示直接取掩码强度）
    strokeProtectionGain: options.strokeProtectionGain ?? 1,
    // 各辅助模块的细项配置（透传，null 时用模块默认）
    subjectCropConfig: options.subjectCropConfig || null,
    backgroundConfig: options.backgroundConfig || null,
    strokeConfig: options.strokeConfig || null,
    accentConfig: options.accentConfig || null,
  };
}

/* =========================================================
 * generateV2 主入口
 * ======================================================= */

/**
 * source: { data: Uint8ClampedArray, width, height }（ImageData 格式）
 * palette: [{ code, rgb: [r,g,b], hex?, name? }]
 * options: { preset, sampling, detailProtection, edgeProtection, highlightProtection, eyeProtection, microDetailProtection, maxColors }
 */
export function generateV2({ source, width, height, palette, options = {} }) {
  if (!source || !source.data || !source.width || !source.height) throw new Error("generateV2: source (ImageData) required");
  if (!width || !height) throw new Error("generateV2: width/height required");
  if (!Array.isArray(palette) || !palette.length) throw new Error("generateV2: palette required");

  const cfg = resolveOptions(options);
  // 阶段上报（Stage B3）：给 Worker 用的进度钩子。
  // **刻意从 options.onPhase 单独读**，不进 cfg —— 它是函数，不能混进要结构化克隆的配置里。
  // 主线程直跑时传 undefined，零开销、行为逐位不变。
  const reportPhase = typeof options.onPhase === "function" ? options.onPhase : null;
  const phase = (name) => { if (reportPhase) reportPhase(name); };
  const timing = {};
  const t0 = performance.now();
  const paletteEngine = createPaletteEngine(palette);
  const getColorKey = (cell) => (cell ? cell.code : null);

  const samplingConfig = {
    extraction: { ignoreTransparent: true, alphaThreshold: 8 },
    dominant: { threshold: 12 },
    edgeAware: { edgeThreshold: 0.42, strongEdgeThreshold: 0.62, clusterThreshold: 10, centerBias: 0.2, continuityWeight: 0.25 },
  };

  // 0. Subject Crop（可选）：先把画面裁到主体，让图案铺满画布。
  //    裁的是「源图」，网格宽高（width/height）不变，因此不会改变图纸尺寸口径。
  const tCrop = performance.now();
  let samplingSource = source;
  let subjectCropDiag = null;
  if (cfg.subjectCrop) {
    const crop = cropToSubject(source, cfg.subjectCropConfig || {});
    samplingSource = { data: crop.data, width: crop.width, height: crop.height };
    subjectCropDiag = {
      applied: crop.coverage > 0 && (crop.width !== source.width || crop.height !== source.height),
      box: crop.box,
      sourceBox: crop.sourceBox,
      coverage: Math.round(crop.coverage * 10000) / 10000,
      sourceSize: { width: source.width, height: source.height },
      croppedSize: { width: crop.width, height: crop.height },
    };
  }
  timing.subjectCrop = Math.round(performance.now() - tCrop);

  // 1. Sampling（AUTO 用 Region-Adaptive，manual 全图单 mode）
  phase("sampling");
  const tSampling = performance.now();
  const sampled = cfg.sampling === SamplingMode.AUTO
    ? sampleGridAdaptive(samplingSource, width, height, { preset: options.preset || "photo", autoProfile: (options.preset || "photo") === "auto", ...samplingConfig })
    : sampleGrid(samplingSource, width, height, { mode: cfg.sampling, ...samplingConfig });
  timing.sampling = Math.round(performance.now() - tSampling);
  const resolvedMode = sampled.resolvedMode;

  // 2. Palette Matching（复用 palette-engine）
  phase("matching");
  const tMatch = performance.now();
  const grid = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      const rgb = sampled.colors[y][x];
      if (!rgb) { grid[y][x] = null; continue; }
      const matched = paletteEngine.match([rgb.r, rgb.g, rgb.b]);
      grid[y][x] = matched ? { ...matched } : null;
    }
  }
  timing.paletteMatching = Math.round(performance.now() - tMatch);

  // 2.5 Auto Background（可选）：只把「与边框连通的浅色区」判为真空豆，封闭浅色区保留。
  //     用采样色（而非量化后的色卡色）判定，保留原图层次。
  let backgroundDiag = null;
  if (cfg.autoBackground) {
    const tBg = performance.now();
    const { backgroundMask, regionCount, diagnostics: bgDiag } = resolveBackgroundMask({
      rgbGrid: sampled.colors, width, height, options: cfg.backgroundConfig || {},
    });
    const { blankCells } = applyBackgroundBlanks({ grid, mask: backgroundMask, width, height });
    backgroundDiag = { ...bgDiag, regionCount, blankedCells: blankCells.length };
    timing.autoBackground = Math.round(performance.now() - tBg);
  }

  // 3. Detail Protection Map（metadata + reason + tier）
  const tProtection = performance.now();
  const protection = buildProtectionMap({
    grid, width, height,
    sameCell: (a, b) => (a && b ? a.code === b.code : a === b),
    sourceImageData: samplingSource,
    cellBoundsFn: (x, y) => cellBounds(x, y, samplingSource.width, samplingSource.height, width, height),
    options: cfg,
  });
  timing.protection = Math.round(performance.now() - tProtection);

  // 3.5 Stroke Mask（可选）：提取线稿描边强度，下采样到格子分辨率后抬升保护图。
  //     只在开关打开时计算 —— 关闭时不做任何事，默认链路零开销、逐位不变。
  let strokeDiag = null;
  if (cfg.strokeProtection) {
    const tStroke = performance.now();
    const strokeMask = extractStrokeMask(samplingSource, cfg.strokeConfig || {});
    const sw = samplingSource.width;
    const sh = samplingSource.height;
    const threshold = cfg.cleanupProtectionThreshold;
    let raised = 0;
    let strokeCells = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const b = cellBounds(x, y, sw, sh, width, height);
        const x0 = Math.max(0, Math.floor(b.x0));
        const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil(b.x1)));
        const y0 = Math.max(0, Math.floor(b.y0));
        const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil(b.y1)));
        let strength = 0;
        for (let sy = y0; sy < y1; sy++) {
          const row = sy * sw;
          for (let sx = x0; sx < x1; sx++) { const v = strokeMask.mask[row + sx]; if (v > strength) strength = v; }
        }
        if (strength <= 0) continue;
        strokeCells += 1;
        const boost = Math.min(1, strength * cfg.strokeProtectionGain);
        const idx = y * width + x;
        if (boost > protection.protectionMap[idx]) {
          if (protection.protectionMap[idx] < threshold && boost >= threshold) raised += 1;
          protection.protectionMap[idx] = boost;
        }
      }
    }
    strokeDiag = {
      density: strokeMask.density,
      threshold: strokeMask.threshold,
      maskSize: { width: sw, height: sh },
      strokeCells,
      raisedAboveThreshold: raised,
      gain: cfg.strokeProtectionGain,
    };
    timing.strokeProtection = Math.round(performance.now() - tStroke);
  }

  // 4. Smart Cleanup（sampling-aware + tier 分层）
  phase("cleanup");
  const tCleanup = performance.now();
  const colorsBeforeCleanup = countGridColors(grid, getColorKey).size;
  const cleanupResult = smartCleanup({
    grid, getColorKey,
    getRGB: (cell) => (cell ? cell.rgb : null),
    protectionMap: protection.protectionMap,
    tierMap: protection.tierMap,
    samplingModeMap: sampled.modeMap || null,
    getSourceEvidence: (x, y, rgb) => calculateSourceEvidence(samplingSource, cellBounds(x, y, samplingSource.width, samplingSource.height, width, height), rgb),
    options: { protectionThreshold: cfg.cleanupProtectionThreshold, sourceEvidenceThreshold: 0.3, maxComponentSize: 5 },
  });
  const colorsAfterCleanup = countGridColors(grid, getColorKey).size;
  timing.cleanup = Math.round(performance.now() - tCleanup);

  // 5. Protected Palette Budget（tier/reason 感知 + 可选强调色锚点保护）
  const tBudget = performance.now();
  let budgetPlan = [];
  let forcedProtectedMerges = 0;
  let accentDiag = null;
  let protectedByAccent = 0;

  // 5a. 强调色锚点（可选）：只要开关打开就识别并出诊断（这样即使未触发降色，
  //     用户/诊断也能看到「认到了哪些锚点」）。真正影响降色的是下一步把锚点作为
  //     protectedKeys 传给预算计划 —— 阶段一不主动合并它们，只有确实降不到目标
  //     （阶段二）才会被 forcedProtected 记录后合并。这样眼睛/描边/高光不会因颗数少被优先删。
  let anchorKeys = null;
  if (cfg.accentProtection) {
    const accent = detectAnchorColors({ grid, getColorKey, options: cfg.accentConfig || {} });
    anchorKeys = accent.anchors;
    protectedByAccent = accent.anchors.size;
    const inGrid = new Set();
    for (const row of grid) for (const cell of row) if (cell) inGrid.add(cell.code);
    accentDiag = {
      ...accent.diagnostics,
      anchors: [...accent.anchors],
      neutralAnchors: accent.neutralAnchors,
      chromaticAnchors: [...accent.chromaticAnchors],
      anchorsInGrid: [...accent.anchors].filter((key) => inGrid.has(key)),
      budgetApplied: false,
      anchorForcedMerges: 0,
    };
  }

  if (cfg.maxColors > 0 && colorsAfterCleanup > cfg.maxColors) {
    budgetPlan = buildPaletteBudgetPlan({
      grid, getColorKey,
      getRGBByKey: (key) => { const cell = grid.flat().find((c) => c && c.code === key); return cell ? cell.rgb : null; },
      maxColors: cfg.maxColors,
      protectionMap: protection.protectionMap,
      tierMap: protection.tierMap,
      protectionReasonMap: protection.protectionReasonMap,
      protectedKeys: anchorKeys,
    });
    const keyToCell = (key) => { const cell = grid.flat().find((c) => c && c.code === key); return cell || null; };
    applyBudgetPlan(grid, getColorKey, budgetPlan, keyToCell);
    forcedProtectedMerges = budgetPlan.filter((p) => p.forcedProtected).length;
    if (accentDiag) {
      accentDiag.budgetApplied = true;
      accentDiag.anchorForcedMerges = budgetPlan.filter((p) => p.protectedByAnchor && p.forcedProtected).length;
    }
  }
  timing.paletteBudget = Math.round(performance.now() - tBudget);

  phase("finalize");

  // 6. cleanupMap（被修改的 cell）
  const cleanupMap = new Float32Array(width * height);
  for (const record of cleanupResult.records) cleanupMap[record.y * width + record.x] = 1;

  const diagnostics = {
    samplingMode: resolvedMode,
    requestedSampling: cfg.sampling,
    samplingDistribution: sampled.distribution || null,
    preCoherenceDistribution: sampled.preCoherenceDistribution || null,
    samplingConfidenceStats: sampled.confidenceStats || null,
    coherenceChanges: sampled.coherenceChanges || null,
    preCoherenceEdgeCount: sampled.preCoherenceEdgeCount ?? 0,
    postCoherenceEdgeCount: sampled.postCoherenceEdgeCount ?? 0,
    imageProfile: sampled.imageProfile || null,
    stableRegionSizeMap: sampled.stableRegions ? sampled.stableRegions.regionSizeMap : null,
    stableRegionConfidenceMap: sampled.stableRegions ? sampled.stableRegions.regionConfidenceMap : null,
    stableRegionTypeMap: sampled.stableRegions ? sampled.stableRegions.regionTypeMap : null,
    stableInteriorMap: sampled.stableRegions ? sampled.stableRegions.interiorMap : null,
    stableRegionIdMap: sampled.stableRegions ? sampled.stableRegions.regionIdMap : null,
    stabilityScores: sampled.stableRegions ? sampled.stableRegions.stabilityScores : null,
    strictStableMap: sampled.stableRegions ? sampled.stableRegions.strictStable : null,
    perceptualStableMap: sampled.stableRegions ? sampled.stableRegions.perceptualStable : null,
    stableRegionCount: sampled.stableRegions ? sampled.stableRegions.regionCount : 0,
    dominantSuitabilityMap: sampled.stableRegions ? sampled.stableRegions.dominantSuitabilityMap : null,
    shadingScoreMap: sampled.stableRegions ? sampled.stableRegions.shadingScoreMap : null,
    paletteCompactnessMap: sampled.stableRegions ? sampled.stableRegions.paletteCompactnessMap : null,
    luminanceRangeMap: sampled.stableRegions ? sampled.stableRegions.luminanceRangeMap : null,
    gradientCoherenceMap: sampled.stableRegions ? sampled.stableRegions.gradientCoherenceMap : null,
    generationMs: Math.round(performance.now() - t0),
    timing,
    protectedCells: protection.protectedCells,
    protectionDistribution: protection.protectionDistribution,
    protectionReasonCounts: protection.protectionReasonCounts,
    colorsBeforeCleanup,
    colorsAfterCleanup,
    colorsAfterBudget: countGridColors(grid, getColorKey).size,
    cleanupMerges: cleanupResult.records.length,
    budgetMerges: budgetPlan.length,
    forcedProtectedMerges,
    // V2.5 智能辅助 diagnostics（未启用时为 null，便于判断是否真的跑过）
    smartFeatures: {
      subjectCrop: cfg.subjectCrop,
      autoBackground: cfg.autoBackground,
      strokeProtection: cfg.strokeProtection,
      accentProtection: cfg.accentProtection,
    },
    subjectCrop: subjectCropDiag,
    autoBackground: backgroundDiag,
    strokeProtection: strokeDiag,
    accentProtection: accentDiag,
    accentProtectedColors: protectedByAccent,
    paletteMatcher: "palette-engine",
    edgeMap: protection.edgeMap,
    protectionMap: protection.protectionMap,
    protectionReasonMap: protection.protectionReasonMap,
    tierMap: protection.tierMap,
    samplingModeMap: sampled.modeMap || null,
    samplingConfidenceMap: sampled.confidenceMap || null,
    preSamplingModeMap: sampled.preModeMap || null,
    structuralEdgeMap: sampled.structuralEdgeMap || null,
    edgeContinuityMap: sampled.edgeContinuityMap || null,
    regionContexts: sampled.regionContexts || null,
    samplingScoresGrid: sampled.scoresGrid || null,
    highlightMap: protection.highlightMap,
    darkDetailMap: protection.darkDetailMap,
    eyeLikeMap: protection.eyeLikeMap,
    cleanupMap,
    cleanupRecords: cleanupResult.records,
  };

  return { grid, width, height, diagnostics };
}

/* =========================================================
 * A/B API（不覆盖 Legacy）
 * ======================================================= */

/**
 * 同一输入比较 legacy grid 与 v2 grid。
 * 只统计 diagnostics，不作为质量标准。
 */
export function compareGrids(legacyGrid, v2Grid) {
  const getCode = (cell) => (cell ? cell.code : null);
  const height = Math.max(legacyGrid?.length || 0, v2Grid?.length || 0);
  const width = Math.max(legacyGrid?.[0]?.length || 0, v2Grid?.[0]?.length || 0);
  let changedCells = 0;
  let totalCells = 0;
  const legacyColors = new Set();
  const v2Colors = new Set();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = legacyGrid?.[y]?.[x];
      const b = v2Grid?.[y]?.[x];
      totalCells++;
      if (getCode(a) !== getCode(b)) changedCells++;
      if (a) legacyColors.add(getCode(a));
      if (b) v2Colors.add(getCode(b));
    }
  }
  return {
    changedCells,
    changedPercent: totalCells ? changedCells / totalCells : 0,
    colorCountLegacy: legacyColors.size,
    colorCountV2: v2Colors.size,
  };
}

export default {
  SamplingMode,
  GenerationProfiles,
  DEFAULT_GENERATION_V2_CONFIG,
  generateV2,
  compareGrids,
};
