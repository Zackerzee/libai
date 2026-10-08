/**
 * BGS algorithm module — unified public entry point.
 *
 *   convertImageToBeads(imageData, options) → {width, height, matrix, colorIds,
 *                                              palette, statistics, diagnostics}
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0). See NOTICE in this
 * directory for the attribution and modification statement required by §4(b)/(d),
 * and ../../ALGORITHM_AUDIT.md for the full analysis of what was taken and why.
 *
 * ── Contract ─────────────────────────────────────────────────────────────
 *  • **No UI state.** The `matrix` is bead colours only. Nothing here knows about
 *    selection, zoom, view mode, undo, project files, i18n, or the DOM.
 *  • **No DOM / Canvas / Worker requirement.** The caller supplies one
 *    `{data, width, height}` ImageData; everything after that is pure typed-array
 *    maths and runs in a browser, a Worker, or `node --test`.
 *  • **Deterministic.** Same pixels + same options ⇒ byte-identical output. There is
 *    no random seed anywhere in the pipeline (upstream: "There is no random k-means
 *    seed").
 *  • **No silent size clamping.** Out-of-range grid requests are reported in
 *    `diagnostics.geometry.limits`, never rewritten.
 */

import { BGS_CONFIG } from './config.mjs';
import { preparePalette, clamp } from './color-space.mjs';
import { resolveGrid, fitGeometryMetrics } from './geometry.mjs';
import { asRaster, prepareConversionRaster, fitRaster, cropRaster, resizeRaster } from './raster.mjs';
import {
  computeLuminance, resolveBackgroundMask, markEdgeArtifacts, resolveDarkThreshold,
  analyzeContent, analyzeLineArt,
} from './analyze.mjs';
import { createMatcher } from './matcher.mjs';
import {
  SAMPLING_MODE, resolveSamplingMode, sampleAll, applyLocalContrast, createScratch,
} from './sampling.mjs';
import { applyTopologyProtection } from './topology.mjs';
import {
  countCells, cleanupSpeckles, detectAnchors, mergeSimilarColors, limitColors,
} from './refine.mjs';
import { computeStatistics } from './statistics.mjs';

export const BGS_ENGINE_ID = 'bgs';
export const BGS_MODULE_VERSION = '1.0.0';

/** Defaults applied before any option is read. */
export const DEFAULT_OPTIONS = Object.freeze({
  width: null,
  height: null,
  maxColors: 0,
  palette: null,
  preserveAspectRatio: true,
  samplingMode: SAMPLING_MODE.AUTO,
  topologyProtection: 'auto',
  edgeProtection: 1,
  cleanupStrength: 0.5,

  /* 扩展选项（非必需，但决定成图口径） */
  whiteMode: 'auto',
  fitMode: 'auto',
  autoCrop: false,
  protectDark: true,
  preserveExactColors: true,
  pixelBudget: BGS_CONFIG.budget.defaultMaxRasterPixels,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  transforms: [],
  whiteCode: 'H2',
  blackCode: 'H7',
  mergeStrength: 0,
});

function normalizeOptions(options) {
  const merged = { ...DEFAULT_OPTIONS, ...(options || {}) };
  merged.edgeProtection = clamp(Number(merged.edgeProtection ?? 1), 0, 2);
  merged.cleanupStrength = clamp(Number(merged.cleanupStrength ?? 0.5), 0, 1);
  merged.maxColors = Math.max(0, Math.round(Number(merged.maxColors) || 0));
  merged.mergeStrength = clamp(Number(merged.mergeStrength) || 0, 0, BGS_CONFIG.merge.strengthMax);
  merged.pixelBudget = Math.max(1, Math.round(Number(merged.pixelBudget) || BGS_CONFIG.budget.defaultMaxRasterPixels));
  return merged;
}

/**
 * Place the working raster inside a box whose aspect matches the target grid.
 * Only used when `fitMode` is `contain`/`cover` on an explicitly-sized grid.
 */
function fitToTargetAspect(raster, cols, rows, { fitMode, pixelBudget, resolutionFactor = 4 }) {
  const targetLongSide = Math.max(cols, rows) * resolutionFactor;
  const scale = targetLongSide / Math.max(raster.width, raster.height);
  const targetWidth = Math.max(cols, Math.round(raster.width * scale));
  const targetHeight = Math.max(rows, Math.round(raster.height * scale));
  const fitted = fitRaster(raster, targetWidth, targetHeight, { fitMode });
  if (fitted.raster.width * fitted.raster.height <= pixelBudget) return fitted;
  const budgetScale = Math.sqrt(pixelBudget / (fitted.raster.width * fitted.raster.height));
  return {
    ...fitted,
    raster: resizeRaster(fitted.raster, Math.round(fitted.raster.width * budgetScale), Math.round(fitted.raster.height * budgetScale)),
    budgetRescaled: true,
  };
}

/**
 * Convert an image into a pure bead-colour matrix.
 *
 * @param {{data: Uint8ClampedArray|Uint8Array, width: number, height: number}} imageData
 * @param {{
 *   width?: number, height?: number,
 *   maxColors?: number,
 *   palette: Array<{code?: string, index?: number, name?: string, hex?: string, rgb?: number[], transparent?: boolean}>,
 *   preserveAspectRatio?: boolean,
 *   samplingMode?: 'auto'|'center'|'linear'|'dominant'|'edge-aware'|'document',
 *   topologyProtection?: boolean|'auto',
 *   edgeProtection?: number,
 *   cleanupStrength?: number,
 *   whiteMode?: 'auto'|'keep',
 *   fitMode?: 'auto'|'contain'|'cover'|'stretch',
 *   autoCrop?: boolean,
 *   protectDark?: boolean,
 *   preserveExactColors?: boolean,
 *   pixelBudget?: number,
 *   crop?: {x:number,y:number,w:number,h:number},
 *   transforms?: Array<'rotate'|'mirrorH'|'mirrorV'>,
 *   whiteCode?: string, blackCode?: string, mergeStrength?: number,
 * }} options
 * @returns {{
 *   width: number, height: number,
 *   matrix: Array<Array<string|null>>,
 *   colorIds: Int16Array,
 *   palette: Array<object>,
 *   statistics: object,
 *   diagnostics: object,
 * }}
 */
export function convertImageToBeads(imageData, options) {
  const startedAt = Date.now();
  const opts = normalizeOptions(options);
  const source = asRaster(imageData, 'imageData');

  if (!opts.palette) throw new Error('bgs: options.palette is required');
  const palette = preparePalette(opts.palette);
  const paletteLength = palette.length;

  const matcher = createMatcher(palette, {
    protectDark: opts.protectDark,
    preserveExactColors: opts.preserveExactColors,
    whiteCode: opts.whiteCode,
    blackCode: opts.blackCode,
  });

  /* ── 1. 栅格准备：crop → transforms →（可选）按目标比例 fit → 像素预算 ── */
  const geometry = fitGeometryMetrics(source.width, source.height, opts.width ?? 1, opts.height ?? 1, 'contain');
  const prepared = prepareConversionRaster(source, {
    crop: opts.crop,
    transforms: opts.transforms,
    fitMode: 'stretch', // grid mapping itself handles aspect; see resolveGrid below
    pixelBudget: opts.pixelBudget,
    smooth: opts.samplingMode !== 'center',
  });

  /* ── 2. 网格尺寸 ── */
  const gridInfo = resolveGrid({
    sourceWidth: prepared.raster.width,
    sourceHeight: prepared.raster.height,
    width: opts.width,
    height: opts.height,
    preserveAspectRatio: opts.preserveAspectRatio,
  });
  const cols = gridInfo.cols;
  const rows = gridInfo.rows;

  /* ── 3. 可选显式取景（contain / cover） ── */
  let workingRaster = prepared.raster;
  let fitInfo = null;
  if ((opts.fitMode === 'contain' || opts.fitMode === 'cover') && Number.isFinite(opts.width) && Number.isFinite(opts.height) && opts.preserveAspectRatio === false) {
    const fitted = fitToTargetAspect(workingRaster, cols, rows, {
      fitMode: opts.fitMode,
      pixelBudget: opts.pixelBudget,
    });
    workingRaster = fitted.raster;
    fitInfo = {
      fitMode: opts.fitMode,
      letterboxFraction: fitted.letterboxFraction,
      cropFraction: fitted.cropFraction,
      budgetRescaled: Boolean(fitted.budgetRescaled),
    };
  }

  /* ── 4. 内容分析 ── */
  const rasterAfterCrop = workingRaster;
  const classification = analyzeContent(rasterAfterCrop, {
    sourceWidth: prepared.croppedSize.width,
    sourceHeight: prepared.croppedSize.height,
  });
  const lineArtAnalysis = analyzeLineArt(rasterAfterCrop);

  let raster = rasterAfterCrop;
  let cropApplied = null;
  if (opts.autoCrop && lineArtAnalysis.autoCrop) {
    const rect = {
      x: lineArtAnalysis.autoCrop.x * raster.width,
      y: lineArtAnalysis.autoCrop.y * raster.height,
      w: lineArtAnalysis.autoCrop.w * raster.width,
      h: lineArtAnalysis.autoCrop.h * raster.height,
    };
    raster = cropRaster(raster, rect);
    cropApplied = { rect, trimFraction: lineArtAnalysis.trimFraction, retainedInkRatio: lineArtAnalysis.retainedInkRatio };
  }

  const width = raster.width;
  const height = raster.height;
  const luminance = computeLuminance(raster);

  /* ── 5. 透明 / 背景 / 扫描边 / 暗阈值 ── */
  const backgroundResult = resolveBackgroundMask(raster, luminance, { whiteMode: opts.whiteMode });
  const edgeResult = markEdgeArtifacts(raster, luminance, backgroundResult.mask);
  const background = edgeResult.background;
  const thresholdResult = resolveDarkThreshold(raster, luminance, background);
  const lineRasterCutoff = clamp(
    thresholdResult.darkThreshold,
    BGS_CONFIG.topology.rasterCutoffMin,
    BGS_CONFIG.topology.rasterCutoffMax,
  );

  /* ── 6. 单色线稿判定（决定是否走拓扑保护） ── */
  let usablePixels = 0;
  let chromaticPixels = 0;
  let brightNeutralPixels = 0;
  let darkNeutralPixels = 0;
  for (let i = 0; i < width * height; i++) {
    const p = i * 4;
    const alpha = raster.data[p + 3];
    if (alpha < BGS_CONFIG.background.transparentAlpha || background[i]) continue;
    const r = raster.data[p];
    const g = raster.data[p + 1];
    const b = raster.data[p + 2];
    const maximum = Math.max(r, g, b);
    const chroma = maximum - Math.min(r, g, b);
    const relative = chroma / Math.max(1, maximum);
    const lum = luminance[i];
    usablePixels++;
    if (chroma >= 18 && relative >= 0.15) chromaticPixels++;
    if (chroma <= 18 && lum >= 225) brightNeutralPixels++;
    if (chroma <= 22 && lum <= 175) darkNeutralPixels++;
  }
  const monochromeLineArt = usablePixels > 0
    && chromaticPixels / usablePixels <= 0.012
    && brightNeutralPixels / usablePixels >= 0.45
    && darkNeutralPixels / usablePixels >= 0.015;

  const samplingMode = resolveSamplingMode(opts.samplingMode, classification);
  const topologyWanted = opts.topologyProtection === 'auto'
    ? monochromeLineArt && Math.max(cols, rows) <= BGS_CONFIG.topology.refinementMaxLongSide
    : opts.topologyProtection === true;
  const smallLineArtRefinement = topologyWanted
    && monochromeLineArt
    && Math.max(cols, rows) <= BGS_CONFIG.topology.refinementMaxLongSide
    && samplingMode !== SAMPLING_MODE.CENTER
    && samplingMode !== SAMPLING_MODE.LINEAR;

  /* ── 7. 采样 ── */
  const scratch = createScratch(paletteLength, BGS_CONFIG.sampling.photoMaxSamplesPerAxis);
  const sampleContext = {
    raster, width, height, cols, rows, luminance, background, matcher, scratch,
    samplingMode, smallLineArtRefinement, monochromeLineArt,
    darkThreshold: thresholdResult.darkThreshold,
    outlineCutoff: thresholdResult.outlineCutoff,
    lineRasterCutoff,
    whiteMode: opts.whiteMode,
    protectDark: opts.protectDark,
    isVisiblyChromatic: (rgb) => {
      const maximum = Math.max(rgb[0], rgb[1], rgb[2]);
      const spread = maximum - Math.min(rgb[0], rgb[1], rgb[2]);
      return spread >= BGS_CONFIG.chromatic.spreadMin && spread / Math.max(1, maximum) >= BGS_CONFIG.chromatic.spreadRatioMin;
    },
    exactIndex: matcher.exactIndex,
  };

  const sampled = sampleAll(sampleContext);

  const grid = Int32Array.from(sampled.positions);
  let importance = Float32Array.from(sampled.importance);
  const support = sampled.support;

  /* ── 8. 线稿拓扑保护 ── */
  const cellCount = cols * rows;
  const lineCoreCoverage = new Float32Array(cellCount);
  const lineSoftCoverage = new Float32Array(cellCount);
  const lineInteriorWhiteCoverage = new Float32Array(cellCount);
  const lineBackgroundCoverage = new Float32Array(cellCount);
  for (let cell = 0; cell < cellCount; cell++) {
    const coverage = sampled.coverage[cell];
    if (!coverage) continue;
    const capacity = Math.max(0.001, coverage.sampleCapacity);
    lineCoreCoverage[cell] = coverage.lineCoreSamples / capacity;
    lineSoftCoverage[cell] = coverage.lineSoftSamples / capacity;
    lineInteriorWhiteCoverage[cell] = coverage.nearWhiteSamples / capacity;
    lineBackgroundCoverage[cell] = coverage.lineBackgroundSamples / capacity;
  }

  let topologyDiagnostics = { applied: false, reason: smallLineArtRefinement ? 'not-requested' : 'not-small-monochrome-line-art' };
  if (smallLineArtRefinement) {
    const topology = applyTopologyProtection({
      grid, raster, width, height, cols, rows, luminance, background, rasterCutoff: lineRasterCutoff,
      lineCoreCoverage, lineSoftCoverage, lineBackgroundCoverage, matcher,
    });
    topologyDiagnostics = topology.diagnostics;
  }

  /* ── 9. 局部反差锐化（linear 模式，无抖动） ── */
  if (sampled.detailValid) {
    const contrastImportance = applyLocalContrast(
      sampleContext,
      grid,
      sampled.detailRgb,
      sampled.detailValid,
      sampled.detailWhite,
      sampled.detailNeutralDark,
    );
    for (let cell = 0; cell < cellCount; cell++) {
      if (contrastImportance[cell] > importance[cell]) importance[cell] = contrastImportance[cell];
    }
  }

  /* ── 10. 杂色清理 ── */
  const cleanupResult = cleanupSpeckles({
    grid, cols, rows, support, matcher, paletteLength,
    cleanupStrength: opts.cleanupStrength,
  });

  /* ── 11. 锚点 / 合并 / 降色 ── */
  const { counts, importanceMass } = countCells(grid, importance);
  const usedBeforeReduction = counts.size;
  const anchorsResult = detectAnchors({ counts, matcher });
  const mergeResult = mergeSimilarColors({
    grid, counts, importanceMass, matcher, anchors: anchorsResult.anchors, mergeStrength: opts.mergeStrength,
  });
  const limitResult = opts.maxColors > 0
    ? limitColors({
      grid, counts, importanceMass, matcher, anchors: anchorsResult.anchors,
      maxColors: opts.maxColors, paletteLength,
    })
    : { plan: [], limit: Infinity, forcedAnchorMerges: 0, reached: true };

  /* ── 12. 输出 ── */
  const codeByIndex = new Map(palette.map((entry) => [entry.index, entry.code]));
  const indexToCode = (index) => codeByIndex.get(index) ?? String(index);

  const colorIds = new Int16Array(cellCount);
  for (let i = 0; i < cellCount; i++) colorIds[i] = grid[i];
  const matrix = [];
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const value = grid[y * cols + x];
      row[x] = value < 0 ? null : indexToCode(value);
    }
    matrix.push(row);
  }

  const statistics = computeStatistics({
    colorIds, cols, rows, matcher, palette, raster, indexToCode,
  });

  const diagnostics = {
    engine: BGS_ENGINE_ID,
    moduleVersion: BGS_MODULE_VERSION,
    grid: { cols, rows, totalCells: cols * rows, derived: gridInfo.derived, limits: gridInfo.limits },
    geometry: {
      sourceSize: { width: source.width, height: source.height },
      croppedSize: prepared.croppedSize,
      transformedSize: prepared.transformedSize,
      sampledSize: { width, height },
      downscaledByBudget: prepared.downscaledByBudget,
      budgetScale: prepared.budgetScale,
      fit: fitInfo,
      aspect: geometry,
      autoCrop: cropApplied,
      autoCropCandidate: lineArtAnalysis.autoCrop
        ? {
          trimFraction: lineArtAnalysis.trimFraction,
          retainedInkRatio: lineArtAnalysis.retainedInkRatio,
          confidence: lineArtAnalysis.confidence,
        }
        : null,
    },
    classification,
    lineArt: {
      likelyLineArt: lineArtAnalysis.likelyLineArt,
      monochromeLineArt,
      componentCount: lineArtAnalysis.componentCount,
      excludedComponentCount: lineArtAnalysis.excludedComponentCount,
      trimFraction: lineArtAnalysis.trimFraction,
      retainedInkRatio: lineArtAnalysis.retainedInkRatio,
    },
    background: {
      mode: opts.whiteMode,
      applied: backgroundResult.applied,
      reason: backgroundResult.reason,
      baseColor: backgroundResult.baseColor ?? null,
      backgroundPixels: backgroundResult.backgroundPixels,
      edgeArtifactPixels: edgeResult.edgeArtifactPixels,
    },
    threshold: {
      darkThreshold: thresholdResult.darkThreshold,
      outlineCutoff: thresholdResult.outlineCutoff,
      lineRasterCutoff,
      source: thresholdResult.source,
      otsu: thresholdResult.otsu,
    },
    sampling: {
      requested: opts.samplingMode,
      resolved: samplingMode,
      topologyProtectionRequested: opts.topologyProtection,
      smallLineArtRefinement,
      edgeProtection: opts.edgeProtection,
      cleanupStrength: opts.cleanupStrength,
    },
    topology: topologyDiagnostics,
    cleanup: {
      cleanedCells: cleanupResult.cleaned,
      records: cleanupResult.records.length,
      requiredNeighborMargin: cleanupResult.requiredMargin,
    },
    colors: {
      usedBeforeReduction,
      usedAfterCleanup: usedBeforeReduction,
      usedAfterMerge: counts.size,
      usedAfterLimit: limitResult.reached ? counts.size : counts.size,
      limitApplied: opts.maxColors > 0,
      limitRequested: opts.maxColors || null,
      forcedAnchorMerges: limitResult.forcedAnchorMerges,
      anchors: Array.from(anchorsResult.anchors),
      neutralAnchors: anchorsResult.neutralAnchors,
      chromaticAnchors: anchorsResult.chromaticAnchors,
      anchorDiagnostics: anchorsResult.diagnostics,
      mergePlan: mergeResult.plan.length,
      limitPlan: limitResult.plan.length,
    },
    matcher: matcher.stats(),
    palette: { size: paletteLength, autoMatchable: palette.filter((entry) => !entry.transparent).length },
    milliseconds: Date.now() - startedAt,
  };

  return {
    width: cols,
    height: rows,
    matrix,
    colorIds,
    palette: palette.map((entry) => ({
      index: entry.index,
      code: entry.code,
      name: entry.name,
      hex: entry.hex,
      rgb: [...entry.rgb],
      transparent: entry.transparent,
    })),
    statistics,
    diagnostics,
  };
}

export { SAMPLING_MODE } from './sampling.mjs';
export { preparePalette, deltaE2000, rgbToOklab, rgbToCielab } from './color-space.mjs';
export { createMatcher } from './matcher.mjs';
export { computeStatistics } from './statistics.mjs';
export { resolveGrid, fitGeometryMetrics, fitPatternInsideBoard, gridForLongSide, gridFromAspectAnchor, orientedSourceDimensions } from './geometry.mjs';
export { compareEngines, compareMatrices, renderMatrixAsBlockArt } from './ab-test.mjs';

export default { BGS_ENGINE_ID, BGS_MODULE_VERSION, DEFAULT_OPTIONS, convertImageToBeads };
