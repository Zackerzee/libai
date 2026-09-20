/**
 * core/hybrid.js
 * ─────────────────────────────────────────────────────────────
 * 第五阶段：`hybrid-pw` 混合管线。
 *
 * 用户指定的链路：
 *   原图
 *    → pw 多尺度 Sobel          ← 上游唯一真正新增的资产（3×3 + 5×5 融合）
 *    → 结构边缘 Mask
 *    → 我们的 Linear RGB sampling      ← libms `sampling-engine-v2.mjs` 的 `linear-mean`
 *    → 我们的 Lab / CIEDE2000 色板匹配  ← libms 口径（CIELAB + CIEDE2000）
 *    → maxColors                       ← libms `protected-palette-budget-v2.mjs`
 *    → structure protection            ← libms `detail-protection-v2.mjs` + pw 的结构掩码
 *    → eye highlight protection        ← pw 的镜面高光检测（本模块）
 *    → isolated noise cleanup          ← libms `smart-cleanup-v2.mjs`
 *    → edge contamination cleanup      ← pw 的抠图残留清理（本模块）
 *    → 最终拼豆矩阵
 *
 * ⚠️ **一处刻意的顺序偏差（必须记录）**
 *   上面把「maxColors」列在「structure protection」之前，但**保护必须先于降色**，
 *   否则降色已经把颜色合并掉了，再算保护毫无意义。libms V2.5 的真实顺序就是
 *   保护在前、降色在后，且降色通过 `buildPaletteBudgetPlan` 的 `protectedKeys`
 *   在**计划构建期**保护（这是 C 批踩过坑后定下的规矩：
 *   `applyAnchorProtectionToPlan` 那种「plan 后处理」因为 `applyBudgetPlan`
 *   一次性应用全部条目而静默失效）。
 *
 *   因此本模块执行的是**有效顺序**：
 *     多尺度边缘 → 结构掩码 → 采样 → 匹配 → 保护扫描（含结构掩码 + 高光）
 *     → maxColors（带 protectedKeys）→ 孤立清理 → 边缘污染清理
 *   `diagnostics.pipelineOrder` 同时给出「请求顺序」与「有效顺序」，
 *   便于对照，不藏这个决定。
 *
 * 依赖方向：`pw → libms smart-preprocessing/`（单向）。
 * libms 侧一行未改。所有 libms 模块都是动态 import —— 只有真的跑到 hybrid
 * 才会加载它们，选了 current / bgs / pw-original 的用户不会多付这份下载。
 */

import {
  PW_CONFIG, PALETTE_MATCH_MODE, PIPELINE_PROFILE, GRID_SAMPLE_MODE,
  BACKGROUND_MODE, ERODE_MODE, THRESHOLD_MODE,
} from "../config.js";
import { resizeToGrid, asRaster, FIT_MODE, RESAMPLE_FILTER } from "../sampling/cover-resize.js";
import { sampleCells, cellBounds } from "../sampling/grid-sampling.js";
import { toLuma } from "../segmentation/sobel3.js";
import { multiScaleEdge } from "../segmentation/multi-scale-edge.js";
import { resolveThreshold, binarize } from "../segmentation/adaptive-threshold.js";
import { dilate, connectedComponents } from "../segmentation/morphology.js";
import { estimateBackground } from "../segmentation/background-kmeans.js";
import { segmentForeground } from "../segmentation/index.js";
import { createPaletteMatcher } from "../color/palette-match.js";
import { rgbToCielab, deltaE2000 } from "../../bgs/color-space.mjs";
import { resolveGrid } from "./pipeline.js";
import { countGridColors } from "./grid-stats.js";

export const HYBRID_ENGINE_ID = "hybrid-pw";
export const HYBRID_MODULE_VERSION = "1.0.0";

/** 请求顺序（用户给的）与有效顺序（实际执行的）。 */
export const HYBRID_STAGES = Object.freeze({
  requested: Object.freeze([
    "pw 多尺度 Sobel",
    "结构边缘 Mask",
    "Linear RGB sampling",
    "Lab/CIEDE2000 色板匹配",
    "maxColors",
    "structure protection",
    "eye highlight protection",
    "isolated noise cleanup",
    "edge contamination cleanup",
  ]),
  effective: Object.freeze([
    "pw 多尺度 Sobel",
    "结构边缘 Mask",
    "Linear RGB sampling",
    "Lab/CIEDE2000 色板匹配",
    "protection scan（structure + highlight）",
    "maxColors（protectedKeys）",
    "isolated noise cleanup",
    "edge contamination cleanup",
  ]),
  deviationNote: "保护必须在降色之前扫描，降色通过 protectedKeys 在计划构建期生效；否则保护形同虚设。",
});

/**
 * 跑 hybrid-pw。
 *
 * @param {{data:ArrayLike<number>, width:number, height:number}} imageData
 * @param {object} options
 * @returns {Promise<object>} 与 `convertImageToBeadsPw` 同形
 */
export async function runHybridPw(imageData, options = {}) {
  const startedAt = Date.now();
  const source = asRaster(imageData);
  if (!Array.isArray(options.palette) || !options.palette.length) {
    throw new Error("hybrid-pw: options.palette 必填");
  }

  const grid = resolveGrid({
    width: options.width,
    height: options.height,
    preserveAspectRatio: options.preserveAspectRatio,
    sourceWidth: source.width,
    sourceHeight: source.height,
  });
  const cols = grid.width;
  const rows = grid.height;
  const maxColors = Math.max(0, Number(options.maxColors) || 0);
  const matchMode = options.paletteMatchMode || PALETTE_MATCH_MODE.CIEDE2000;
  const transparentBg = options.transparentBg !== false;
  const timings = {};

  /* ═══ ① pw 多尺度 Sobel ═══════════════════════════════════
   * 在**源图分辨率**（而非格分辨率）上跑 —— 这是相对上游的一处真实改进：
   * 上游在 52×52 的缩略图上做 Sobel，细边缘早已被缩放抹平。
   * 为了让代价可控，先把工作分辨率限制在 workingLongSide 以内。 */
  const tEdge = Date.now();
  const working = buildWorkingRaster(source, options.workingLongSide ?? 512);
  const luma = toLuma(working);
  const multi = multiScaleEdge(luma, working.width, working.height, {
    scales: options.scales,
    fuse: options.fuse,
    weights: options.weights,
  });
  const structureThreshold = resolveThreshold(multi.magnitude, {
    mode: options.structureThresholdMode || THRESHOLD_MODE.OTSU,
    floor: options.structureFloor ?? 0,
    medianFactor: options.structureMedianFactor,
  });
  const rawStructure = binarize(multi.magnitude, structureThreshold.value);
  // 细线在一个格子里可能只占几个像素，先膨胀 1 圈再聚合，避免结构边整条漏掉。
  const structurePixels = (options.structureDilate ?? 1) > 0
    ? dilate(rawStructure, working.width, working.height, { iterations: options.structureDilate ?? 1 }).mask
    : rawStructure;
  const structureMask = aggregateMaskToCells(structurePixels, working.width, working.height, cols, rows, options.structureCellThreshold ?? 0.08);
  timings.structureEdge = Date.now() - tEdge;

  /* ═══ ② 前景掩码（边缘污染清理需要知道「边界带」在哪） ═══ */
  const tSeg = Date.now();
  const segmentation = segmentForeground(working, {
    profile: PIPELINE_PROFILE.IMPROVED,
    precision: options.precision,
    useMultiScale: options.useMultiScale !== false,
    multiScale: { scales: options.scales, fuse: options.fuse, weights: options.weights },
    backgroundMode: options.backgroundMode || BACKGROUND_MODE.BORDER_KMEANS_NEAREST,
    backgroundK: options.backgroundK,
    erodeMode: options.erodeMode || ERODE_MODE.MIN_FILTER,
    filterConnectivity: options.filterConnectivity !== false,
    minComponentSize: options.minComponentSize ?? 2,
    feather: options.feather ?? 0,
    alphaThreshold: options.alphaThreshold,
  });
  const foregroundMask = aggregateMaskToCells(segmentation.mask, working.width, working.height, cols, rows, options.foregroundCellThreshold ?? 0.5);
  const bgColor = segmentation.bgColor;
  timings.segmentation = Date.now() - tSeg;

  /* ═══ ③ 我们的 Linear RGB sampling ═════════════════════════
   * libms `sampling-engine-v2.mjs` 的 `linear-mean`：在**线性 RGB 空间**求均值再转回 sRGB。
   * 直接用 libms 的真实实现，不是它的重写版。 */
  const tSample = Date.now();
  const { sampleGrid: libmsSampleGrid, SamplingMode } = await import("../../../../smart-preprocessing/sampling-engine-v2.mjs");
  const samplingSource = options.samplingAtSource === true ? source : working;
  const sampledGrid = libmsSampleGrid(samplingSource, cols, rows, { mode: SamplingMode.LINEAR_MEAN });
  timings.sampling = Date.now() - tSample;

  /* ═══ ④ 我们的 Lab / CIEDE2000 色板匹配 ════════════════════ */
  const tMatch = Date.now();
  const matcher = createPaletteMatcher(options.palette, { mode: matchMode });
  const cells = [];
  let unknownCodes = 0;
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) {
      const sampled = sampledGrid.colors?.[y]?.[x];
      const isEmpty = transparentBg && !foregroundMask[y * cols + x];
      if (!sampled || isEmpty) { row.push(null); continue; }
      const rgb = [sampled.r, sampled.g, sampled.b];
      const matched = matcher.match(rgb);
      if (!matched) { unknownCodes++; row.push(null); continue; }
      row.push({ code: matched.code, rgb: [...matched.entry.rgb], hex: matched.entry.hex, name: matched.entry.name });
    }
    cells.push(row);
  }
  timings.matching = Date.now() - tMatch;

  /* ═══ ⑤ 保护扫描（libms detail-protection + pw 结构掩码 + pw 高光） ═══ */
  const tProtect = Date.now();
  const { buildProtectionMap, ProtectionTier, ProtectionReason } = await import("../../../../smart-preprocessing/detail-protection-v2.mjs");
  const getRGB = (cell) => (cell && cell.rgb ? cell.rgb : null);
  const getColorKey = (cell) => (cell ? cell.code : null);
  const sameCell = (a, b) => Boolean(a && b && a.code === b.code);

  const protection = buildProtectionMap({
    grid: cells,
    width: cols,
    height: rows,
    getRGB,
    sameCell,
    sourceImageData: samplingSource,
    cellBoundsFn: (x, y) => cellBounds(x, y, samplingSource.width, samplingSource.height, cols, rows),
    options: {
      detailProtection: options.detailProtection ?? 0.7,
      edgeProtection: options.edgeProtection ?? 0.7,
      highlightProtection: options.highlightProtection ?? 0.8,
      eyeProtection: options.eyeProtection ?? 1.0,
      microDetailProtection: options.microDetailProtection ?? 0.8,
    },
  });

  // ⑤a 结构掩码 → 保护：pw 在源分辨率上判定的结构边，全部提升到 HIGH 以上
  let structureProtectedCells = 0;
  for (let i = 0; i < cols * rows; i++) {
    if (!structureMask[i]) continue;
    if (!cells[(i / cols) | 0]?.[i % cols]) continue;
    if (protection.tierMap[i] < ProtectionTier.HIGH) protection.tierMap[i] = ProtectionTier.HIGH;
    protection.protectionReasonMap[i] |= ProtectionReason.STRUCTURAL_EDGE;
    if (protection.protectionMap[i] < 0.6) protection.protectionMap[i] = 0.6;
    structureProtectedCells++;
  }

  // ⑤b pw 的眼睛高光保护（上游没有；libms 的 detectHighlight 用的是格内统计，
  //     这里补一个「源图局部亮度极值 + 低彩度」的镜面高光判据）
  const highlights = detectSpecularHighlights(samplingSource, cols, rows, options);
  let highlightProtectedCells = 0;
  for (const index of highlights.cells) {
    if (protection.tierMap[index] < ProtectionTier.HIGH) protection.tierMap[index] = ProtectionTier.HIGH;
    protection.protectionReasonMap[index] |= ProtectionReason.HIGHLIGHT;
    if (protection.protectionMap[index] < 0.7) protection.protectionMap[index] = 0.7;
    highlightProtectedCells++;
  }

  // 保护色号集合（tier >= HIGH）—— 降色阶段的 protectedKeys
  const protectedKeys = new Set();
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x;
      const cell = cells[y][x];
      if (!cell) continue;
      if (protection.tierMap[index] >= ProtectionTier.HIGH) protectedKeys.add(cell.code);
    }
  }
  timings.protection = Date.now() - tProtect;

  /* ═══ ⑥ maxColors（libms protected-palette-budget，带 protectedKeys） ═══ */
  const tBudget = Date.now();
  let budget = null;
  const colorsBeforeBudget = countGridColors(cells).usedColors.length;
  if (maxColors > 0 && colorsBeforeBudget > maxColors) {
    const { buildPaletteBudgetPlan, applyBudgetPlan } = await import("../../../../smart-preprocessing/protected-palette-budget-v2.mjs");
    const keyToCell = new Map();
    for (const row of cells) {
      for (const cell of row) {
        if (cell && !keyToCell.has(cell.code)) keyToCell.set(cell.code, cell);
      }
    }
    const byKey = new Map();
    for (const row of cells) for (const cell of row) if (cell) byKey.set(cell.code, cell.rgb);

    const plan = buildPaletteBudgetPlan({
      grid: cells,
      getColorKey,
      getRGBByKey: (key) => byKey.get(key) || null,
      maxColors,
      protectionMap: protection.protectionMap,
      tierMap: protection.tierMap,
      protectionReasonMap: protection.protectionReasonMap,
      protectedKeys,
      options: { protectionThreshold: 0.5 },
    });
    const applied = applyBudgetPlan(cells, getColorKey, plan, (key) => keyToCell.get(key));
    budget = {
      requested: maxColors,
      colorsBefore: colorsBeforeBudget,
      planMerges: plan.length,
      appliedMerges: applied.applied,
      protectedKeys: [...protectedKeys].sort(),
      colorsAfter: countGridColors(cells).usedColors.length,
    };
  } else {
    budget = {
      requested: maxColors,
      colorsBefore: colorsBeforeBudget,
      planMerges: 0,
      appliedMerges: 0,
      protectedKeys: [...protectedKeys].sort(),
      colorsAfter: colorsBeforeBudget,
      skippedReason: maxColors <= 0 ? "maxColors 为 0（AUTO）" : "当前色数未超过上限",
    };
  }
  timings.budget = Date.now() - tBudget;

  /* ═══ ⑦ 孤立杂色清理（libms smart-cleanup-v2） ═══ */
  const tCleanup = Date.now();
  const { smartCleanup } = await import("../../../../smart-preprocessing/smart-cleanup-v2.mjs");
  const cleanup = smartCleanup({
    grid: cells,
    getColorKey,
    getRGB,
    protectionMap: protection.protectionMap,
    tierMap: protection.tierMap,
    options: { maxComponentSize: options.cleanupMaxComponentSize ?? 3 },
  });
  timings.cleanup = Date.now() - tCleanup;

  /* ═══ ⑧ 边缘污染清理（pw 新增：抠图残留光晕） ═══ */
  const tContamination = Date.now();
  const contamination = cleanupEdgeContamination(cells, foregroundMask, bgColor, {
    action: options.edgeContaminationAction || "recolor",
    maxDeltaE: options.contaminationDeltaE ?? PW_CONFIG.edgeContamination.maxDeltaE,
    distanceFn: matcher.measure,
  });
  timings.contamination = Date.now() - tContamination;

  /* ═══ 输出 ═══ */
  const matrix = [];
  const colorIds = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    const idRow = [];
    for (let x = 0; x < cols; x++) {
      const cell = cells[y][x];
      if (!cell) { row.push(null); idRow.push(null); continue; }
      row.push(cell.code);
      const position = matcher.positionByCode(cell.code);
      idRow.push(position === undefined ? null : position);
    }
    matrix.push(row);
    colorIds.push(idRow);
  }

  const stats = countGridColors(matrix);

  return {
    width: cols,
    height: rows,
    matrix,
    colorIds,
    palette: matcher.entries.map((entry) => ({
      position: entry.position,
      index: entry.index,
      code: entry.code,
      name: entry.name,
      hex: entry.hex,
      rgb: entry.rgb,
      transparent: entry.transparent,
    })),
    statistics: {
      width: cols,
      height: rows,
      cellCount: cols * rows,
      beadCount: stats.beadCount,
      emptyCount: stats.emptyCount,
      usedColorCount: stats.usedColors.length,
      usedColors: stats.usedColors,
      colorUsage: stats.usage,
      foregroundCells: foregroundMask.reduce((sum, value) => sum + value, 0),
    },
    diagnostics: {
      engine: HYBRID_ENGINE_ID,
      moduleVersion: HYBRID_MODULE_VERSION,
      pipelineOrder: { requested: HYBRID_STAGES.requested, effective: HYBRID_STAGES.effective, deviationNote: HYBRID_STAGES.deviationNote },
      grid: grid.limits,
      structure: {
        workingResolution: { width: working.width, height: working.height },
        scaleCount: multi.perScale.length,
        perScale: multi.perScale,
        fuse: multi.fuse,
        threshold: { value: structureThreshold.value, mode: structureThreshold.mode },
        structurePixels: structurePixels.reduce((sum, value) => sum + value, 0),
        structureCells: structureMask.reduce((sum, value) => sum + value, 0),
        protectedCells: structureProtectedCells,
      },
      sampling: { engine: "libms sampling-engine-v2.linear-mean", atSource: options.samplingAtSource === true },
      matching: { ...matcher.diagnostics, unknownCodes, paletteEngineOverride: options.useLibmsPaletteEngine === true },
      segmentation: segmentation.diagnostics,
      protection: {
        libmsProtectedCells: protection.protectedCells,
        structureProtectedCells,
        highlightProtectedCells,
        protectedKeys: [...protectedKeys].sort(),
        distribution: protection.protectionDistribution,
        reasonCounts: protection.protectionReasonCounts,
        highlightDetection: highlights,
      },
      budget,
      cleanup: { merges: cleanup.records.length },
      contamination,
      timingMs: Date.now() - startedAt,
      timings,
    },
  };
}

/**
 * 把源图限制到工作分辨率（保持长边不超过 maxLongSide）。
 * 不改变宽高比；只用于「在源分辨率上做边缘检测」这一步的代价控制。
 */
function buildWorkingRaster(source, maxLongSide) {
  const longSide = Math.max(source.width, source.height);
  if (!(maxLongSide > 0) || longSide <= maxLongSide) return { data: source.data, width: source.width, height: source.height };
  const scale = maxLongSide / longSide;
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const resized = resizeToGrid(source, { cols: width, rows: height, fitMode: FIT_MODE.STRETCH, filter: RESAMPLE_FILTER.AUTO });
  return { data: resized.data, width, height };
}

/** 把像素级掩码按「占比超阈值」聚合到格。 */
function aggregateMaskToCells(mask, rasterWidth, rasterHeight, cols, rows, threshold) {
  const out = new Uint8Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bounds = cellBounds(cx, cy, rasterWidth, rasterHeight, cols, rows);
      const total = bounds.width * bounds.height;
      if (!total) continue;
      let sum = 0;
      for (let py = bounds.y0; py < bounds.y1; py++) {
        for (let px = bounds.x0; px < bounds.x1; px++) sum += mask[py * rasterWidth + px] ? 1 : 0;
      }
      out[cy * cols + cx] = sum / total >= threshold ? 1 : 0;
    }
  }
  return out;
}

/**
 * pw 的镜面高光检测（上游没有这个算法）。
 *
 * 判据三条同时成立：
 *   ① 该格源亮度显著高于 4 邻域均值（`minRelativeLuma`）；
 *   ② 该格源彩度低（OKLab 彩度 ≤ `maxChroma`）—— 镜面高光通常接近中性；
 *   ③ 局部亮度差绝对值 ≥ `minLocalDelta`，避免把「整片亮背景」误判成高光。
 *
 * 这三个条件合起来指向的正是眼睛高光 / 金属反光那类小面积亮点 ——
 * 它们面积小、ΔE 大，是最容易被降色与孤立清理吃掉的东西。
 */
export function detectSpecularHighlights(raster, cols, rows, options = {}) {
  const { data, width, height } = raster;
  const cells = [];
  const scores = new Float32Array(cols * rows);
  const minRelative = options.minRelativeLuma ?? PW_CONFIG.highlightProtection.minRelativeLuma;
  const maxChroma = options.maxChroma ?? PW_CONFIG.highlightProtection.maxChroma;
  const minLocalDelta = options.minLocalDelta ?? PW_CONFIG.highlightProtection.minLocalDelta;

  // 逐格源亮度
  const lumaGrid = new Float32Array(cols * rows);
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const bounds = cellBounds(cx, cy, width, height, cols, rows);
      let sum = 0;
      let count = 0;
      for (let py = bounds.y0; py < bounds.y1; py++) {
        for (let px = bounds.x0; px < bounds.x1; px++) {
          const p = (py * width + px) * 4;
          sum += data[p] * 0.299 + data[p + 1] * 0.587 + data[p + 2] * 0.114;
          count++;
        }
      }
      lumaGrid[cy * cols + cx] = count ? sum / count : 0;
    }
  }

  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const index = cy * cols + cx;
      const bounds = cellBounds(cx, cy, width, height, cols, rows);
      // 格内平均色 → 彩度
      let r = 0;
      let g = 0;
      let b = 0;
      let count = 0;
      for (let py = bounds.y0; py < bounds.y1; py++) {
        for (let px = bounds.x0; px < bounds.x1; px++) {
          const p = (py * width + px) * 4;
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
          count++;
        }
      }
      if (!count) continue;
      const rgb = [r / count, g / count, b / count];
      const lab = rgbToCielab(rgb);
      const chroma = Math.hypot(lab[1], lab[2]);

      // 4 邻域亮度均值
      let neighborSum = 0;
      let neighborCount = 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        neighborSum += lumaGrid[ny * cols + nx];
        neighborCount++;
      }
      if (!neighborCount) continue;
      const neighborMean = neighborSum / neighborCount;
      const own = lumaGrid[index];

      const relativelyBright = own > neighborMean * minRelative;
      const localDelta = own - neighborMean;
      const isLowChroma = chroma <= maxChroma;
      if (relativelyBright && isLowChroma && localDelta >= minLocalDelta) {
        const score = Math.min(1, (localDelta / 60) * (1 - Math.min(1, chroma / (maxChroma || 1))));
        scores[index] = score;
        cells.push(index);
      }
    }
  }

  return { cells, scores, count: cells.length, criteria: { minRelative, maxChroma, minLocalDelta } };
}

/**
 * pw 的边缘污染清理：抠图残留的「半透明光晕」在拼豆里会变成一圈脏边。
 *
 * 判据：该格属于前景、且 4 邻域里有**非前景**格（即它处在边界带上），
 * 且它的豆色与估计背景色的 ΔE ≤ `maxDeltaE` → 判为污染。
 *
 * 处置：
 *   `recolor`（默认）—— 换成邻域里出现最多的、未污染的前景豆色。避免打洞。
 *   `erase`            —— 直接置空。
 *
 * 注意这条只在有前景掩码时才有意义；没有掩码时返回 0。
 */
export function cleanupEdgeContamination(cells, foregroundMask, bgColor, options = {}) {
  const rows = cells.length;
  const cols = cells[0]?.length || 0;
  if (!cols || !rows || !foregroundMask || !bgColor) {
    return { contaminationFound: 0, recolored: 0, erased: 0, action: options.action || "recolor" };
  }
  const action = options.action === "erase" ? "erase" : "recolor";
  const maxDeltaE = options.maxDeltaE ?? PW_CONFIG.edgeContamination.maxDeltaE;
  const bgLab = rgbToCielab([bgColor[0], bgColor[1], bgColor[2]]);

  const contaminated = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const index = y * cols + x;
      if (!foregroundMask[index]) continue;
      const cell = cells[y][x];
      if (!cell) continue;
      let boundary = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (!foregroundMask[ny * cols + nx]) { boundary = true; break; }
      }
      if (!boundary) continue;
      if (deltaE2000(rgbToCielab(cell.rgb), bgLab) <= maxDeltaE) contaminated.push([x, y]);
    }
  }

  let recolored = 0;
  let erased = 0;
  for (const [x, y] of contaminated) {
    if (action === "erase") {
      cells[y][x] = null;
      erased++;
      continue;
    }
    // 邻域投票：只统计「前景 且 未被污染」的格子
    const votes = new Map();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const neighbor = cells[ny][nx];
      if (!neighbor) continue;
      if (deltaE2000(rgbToCielab(neighbor.rgb), bgLab) <= maxDeltaE) continue;
      const key = neighbor.code;
      const bucket = votes.get(key) || { count: 0, cell: neighbor };
      bucket.count++;
      votes.set(key, bucket);
    }
    let best = null;
    // 平票按色号升序 —— 确定性
    for (const key of [...votes.keys()].sort()) {
      const bucket = votes.get(key);
      if (!best || bucket.count > best.count) best = bucket;
    }
    if (best) {
      cells[y][x] = { ...best.cell };
      recolored++;
    } else {
      cells[y][x] = null;
      erased++;
    }
  }

  return { contaminationFound: contaminated.length, recolored, erased, action, maxDeltaE };
}

/** 供诊断：前景掩码与结构掩码的交集规模。 */
export function maskOverlap(a, b) {
  let both = 0;
  for (let i = 0; i < a.length; i++) if (a[i] && b[i]) both++;
  return both;
}

export { GRID_SAMPLE_MODE, PALETTE_MATCH_MODE, BACKGROUND_MODE, ERODE_MODE, THRESHOLD_MODE, PIPELINE_PROFILE };
export { connectedComponents, estimateBackground, resizeToGrid, sampleCells };
