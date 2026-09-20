/**
 * core/pipeline.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`generatePattern()`（app.js:399–491）的算法部分。
 * 上游那个函数同时做 DOM 读写、Canvas 绘制、UI 更新和算法，**不可整体提取**；
 * 本文件只抽它的算法内核，并把三条与 UI 相关的行为改掉：
 *   - 尺寸**不再静默 clamp**（上游 `Math.min(256, Math.max(16, …))`，缺陷 E-2）：
 *     越界只写进 `diagnostics.grid.limits`，请求什么就返回什么；
 *   - 色板是**参数**，不是模块内全局（修复 K-1）；
 *   - 返回值里**不含任何 UI 状态** —— 矩阵只说「哪一格是什么豆号」。
 *
 * 上游完整流程（本模块逐条对应）：
 *   Canvas cover 缩放到 w×h → getImageData → autoCutout 抠图
 *   → 全部像素喂 K-means(colorLimit) → 逐格 findClosestBead → 双矩阵
 *
 * 两个 `profile`：
 *   `upstream` —— 语义对齐上游：cover + 1 格 1 像素 + 3×3 Sobel + 边框均值背景
 *                  + 多数腐蚀 + 不做连通性过滤 + 不读 alpha + 无羽化
 *   `improved` —— 同一骨架，但读 alpha、加连通性过滤、接上羽化、
 *                  可开多尺度边缘与 K-means 背景（默认仍保守）
 */

import {
  PW_CONFIG, PIPELINE_PROFILE, PALETTE_MATCH_MODE, GRID_SAMPLE_MODE,
  BACKGROUND_MODE, ERODE_MODE, THRESHOLD_MODE,
} from "../config.js";
import { sampleCells, cellBounds } from "../sampling/grid-sampling.js";
import { FIT_MODE, RESAMPLE_FILTER, asRaster, resizeToGrid } from "../sampling/cover-resize.js";
import { segmentForeground } from "../segmentation/index.js";
import { createPaletteMatcher, preparePalette } from "../color/palette-match.js";
import { kMeansPalette } from "../quantization/kmeans.js";
import { dominantColors, medianCut, colorsToPalette } from "../quantization/dominant-colors.js";
import { countGridColors } from "./grid-stats.js";

export const PW_ENGINE_ID = "pindou-workbench";
export const PW_MODULE_VERSION = "1.0.0";

/** 量化器选择。 */
export const QUANTIZER = Object.freeze({
  /** 上游：K-means 压到 maxColors 再落色板 */
  KMEANS: "kmeans",
  /** 补全：直方图频次主色 */
  DOMINANT: "dominant",
  /** 补全：中位切分 */
  MEDIAN_CUT: "median-cut",
  /** 不做量化，直接全色板最近色匹配 */
  NONE: "none",
});

/**
 * 解析网格尺寸。**报告越界，绝不改写。**
 *
 * 这是 libms 的既有铁律（`docs/BLANK_BOARD_SIZE_FIX.md`）：
 * 用户给的尺寸只能如实回报，不能悄悄换成别的值 ——
 * 否则用户看到的摘要就是唯一线索，夹取后无法察觉拿到的是另一个画板。
 *
 * @param {{width:number, height:number, preserveAspectRatio?:boolean,
 *          sourceWidth?:number, sourceHeight?:number}} request
 * @returns {{width:number, height:number, limits:object, derived:object|null}}
 */
export function resolveGrid(request) {
  const minSide = PW_CONFIG.grid.minSide;
  const maxSide = PW_CONFIG.grid.maxSide;

  // null / undefined / "" 一律视为「这一轴没给」。
  // 注意不能直接用 Number(request.height)：Number(null) === 0，
  // 会把「没给高度」误判成「高度填了 0」，进而绕过下面的比例推导。
  const readAxis = (value) => {
    if (value === null || value === undefined || value === "") return NaN;
    return Number(value);
  };
  const requestedWidth = readAxis(request.width);
  const requestedHeight = readAxis(request.height);
  const outOfRange = [];

  const check = (axis, value) => {
    if (!Number.isFinite(value)) outOfRange.push({ axis, kind: "notFinite", value: request[axis], limit: axis === "width" ? requestedWidth : requestedHeight });
    else if (value < minSide) outOfRange.push({ axis, kind: "belowMin", value, limit: minSide });
    else if (value > maxSide) outOfRange.push({ axis, kind: "aboveMax", value, limit: maxSide });
  };
  check("width", requestedWidth);
  check("height", requestedHeight);

  // 缺失的一轴按源图比例推导（与 libms 的 getGenerationTargetHeight 同语义）。
  let derived = null;
  let width = Number.isFinite(requestedWidth) ? Math.round(requestedWidth) : null;
  let height = Number.isFinite(requestedHeight) ? Math.round(requestedHeight) : null;
  const preserve = request.preserveAspectRatio !== false;

  if ((width == null || height == null) && preserve && request.sourceWidth > 0 && request.sourceHeight > 0) {
    const ratio = request.sourceHeight / request.sourceWidth;
    if (width == null && height != null) {
      width = Math.max(1, Math.round(height / ratio));
      derived = { axis: "width", from: "height", ratio };
    } else if (height == null && width != null) {
      height = Math.max(1, Math.round(width * ratio));
      derived = { axis: "height", from: "width", ratio };
    }
  }
  if (width == null) width = PW_CONFIG.grid.defaultColorLimit * 0 + minSide;
  if (height == null) height = width;

  return {
    width,
    height,
    derived,
    limits: {
      ok: outOfRange.length === 0,
      outOfRange,
      minSide,
      maxSide,
      requested: { width: request.width ?? null, height: request.height ?? null },
      resolved: { width, height },
      policy: "report-only",
      note: "越界只报告不改写（libms 铁律）。调用方若需要合法尺寸，请自行修正后重试。",
    },
  };
}

/** 把超采样分辨率的掩码塌缩到格分辨率。 */
export function collapseMask(mask, rasterWidth, rasterHeight, cols, rows, threshold = 0.5) {
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

/** 默认选项。 */
const DEFAULT_OPTIONS = Object.freeze({
  preserveAspectRatio: true,
  transparentBg: true,
  paletteMatchMode: PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB,
  quantizer: QUANTIZER.KMEANS,
  skipTransparent: true,
});

/**
 * pw 主入口。
 *
 * @param {{data:ArrayLike<number>, width:number, height:number}} imageData
 * @param {object} options 见文件头
 * @returns {{width:number, height:number, matrix:(string|null)[][], colorIds:(number|null)[][],
 *            palette:Array, statistics:object, diagnostics:object}}
 */
export function convertImageToBeadsPw(imageData, options = {}) {
  const startedAt = Date.now();
  const source = asRaster(imageData);
  const opts = { ...DEFAULT_OPTIONS, ...options };

  if (!Array.isArray(opts.palette) || !opts.palette.length) {
    throw new Error("pindou-workbench: options.palette 必填（本模块不内置任何色卡数据）");
  }

  const profile = opts.profile === PIPELINE_PROFILE.UPSTREAM ? PIPELINE_PROFILE.UPSTREAM : PIPELINE_PROFILE.IMPROVED;
  const upstream = profile === PIPELINE_PROFILE.UPSTREAM;

  const grid = resolveGrid({
    width: opts.width,
    height: opts.height,
    preserveAspectRatio: opts.preserveAspectRatio,
    sourceWidth: source.width,
    sourceHeight: source.height,
  });

  // ── 采样（一次栅格化，采样与抠图共用同一份栅格，避免不一致） ──
  const supersample = Math.max(1, Math.min(4, opts.supersample ?? (upstream ? 1 : PW_CONFIG.sampling.supersample)));
  const samplingMode = opts.samplingMode ?? (upstream ? GRID_SAMPLE_MODE.POINT : GRID_SAMPLE_MODE.AREA);
  const fitMode = opts.fitMode ?? FIT_MODE.COVER;
  const filter = opts.filter ?? RESAMPLE_FILTER.AUTO;

  const rasterWidth = grid.width * supersample;
  const rasterHeight = grid.height * supersample;
  const raster = resizeToGrid(source, { cols: rasterWidth, rows: rasterHeight, fitMode, filter });
  const sampled = sampleCells(raster, {
    cols: grid.width,
    rows: grid.height,
    mode: samplingMode,
    space: opts.samplingSpace || "srgb",
  });
  // 采样层与采样模块的字段名对齐
  sampled.rasterWidth = rasterWidth;
  sampled.rasterHeight = rasterHeight;
  sampled.rasterFilter = raster.filter;
  sampled.geometry = raster.geometry;

  // ── 抠图 ────────────────────────────────────────────────
  const segmentation = segmentForeground(raster, {
    profile,
    precision: opts.precision,
    edgeThresh: opts.edgeThresh,
    colorThresh: opts.colorThresh,
    morphIter: opts.morphIter,
    thresholdMode: opts.thresholdMode,
    backgroundMode: opts.backgroundMode,
    backgroundK: opts.backgroundK,
    erodeMode: opts.erodeMode,
    alphaThreshold: opts.alphaThreshold,
    filterConnectivity: opts.filterConnectivity,
    minComponentSize: opts.minComponentSize,
    keepBorderContact: opts.keepBorderContact,
    feather: opts.feather,
    useMultiScale: opts.useMultiScale === true,
    multiScale: opts.multiScale,
    distanceFn: opts.distanceFn,
  });

  const cellMask = supersample === 1
    ? segmentation.mask
    : collapseMask(segmentation.mask, rasterWidth, rasterHeight, grid.width, grid.height, opts.maskCollapseThreshold ?? 0.5);

  // ── 色板匹配器（三档之一） ────────────────────────────────
  const matcher = createPaletteMatcher(opts.palette, {
    mode: opts.paletteMatchMode,
    skipTransparent: opts.skipTransparent,
  });

  // ── 量化 ────────────────────────────────────────────────
  const cellCount = grid.width * grid.height;
  const allPixels = [];
  const foregroundPixels = [];
  for (let i = 0; i < cellCount; i++) {
    const point = [sampled.samples[i * 3], sampled.samples[i * 3 + 1], sampled.samples[i * 3 + 2]];
    allPixels.push(point);
    if (cellMask[i]) foregroundPixels.push(point);
  }

  // 上游：`if (state.colorLimit && state.colorLimit < palette.length)`
  // 即「maxColors 小于色板长度才量化」。保持这条语义。
  const maxColors = Math.max(0, Number(opts.maxColors) || 0);
  const quantize = maxColors > 0 && maxColors < matcher.size && opts.quantizer !== QUANTIZER.NONE;

  // 上游把**全部像素**（含背景）喂给 K-means —— 背景照样消耗色板配额。
  // improved 档在掩码足够大时只喂前景（修复点，可通过 useForegroundOnly 关掉）。
  const useForegroundOnly = opts.useForegroundOnly ?? (!upstream);
  const pool = useForegroundOnly && foregroundPixels.length >= Math.max(maxColors * 4, 16)
    ? foregroundPixels
    : allPixels;

  let effectivePalette = matcher.entries;
  let quantization = null;

  if (quantize) {
    const quantizer = opts.quantizer ?? QUANTIZER.KMEANS;
    if (quantizer === QUANTIZER.DOMINANT) {
      const dominant = dominantColors(pool, { count: maxColors, bits: opts.dominantBits ?? 5 });
      const mapped = colorsToPalette(dominant.map((entry) => entry.rgb), matcher);
      effectivePalette = mapped.beads;
      quantization = { quantizer, requestedK: maxColors, effectiveK: mapped.uniqueCount, duplicates: mapped.duplicates, clusters: dominant.length, profile: "dominant" };
    } else if (quantizer === QUANTIZER.MEDIAN_CUT) {
      const cut = medianCut(pool, { count: maxColors });
      const mapped = colorsToPalette(cut.centroids, matcher);
      effectivePalette = mapped.beads;
      quantization = { quantizer, requestedK: maxColors, effectiveK: mapped.uniqueCount, duplicates: mapped.duplicates, clusters: cut.count, profile: "median-cut" };
    } else {
      const clustered = kMeansPalette(pool, maxColors, matcher, {
        distanceFn: matcher.measure,
        // 上游：strided 初始化、跑满 10 轮、无收敛判据、无空簇处理
        init: opts.kmeansInit ?? PW_CONFIG.kmeans.init,
        maxIterations: opts.kmeansIterations ?? PW_CONFIG.kmeans.maxIterations,
        tolerance: opts.kmeansTolerance ?? (upstream ? 0 : 1e-4),
        reseedEmptyClusters: opts.reseedEmptyClusters ?? (!upstream),
      });
      effectivePalette = clustered.beads.length ? clustered.beads : matcher.entries;
      quantization = {
        quantizer,
        requestedK: maxColors,
        effectiveK: clustered.uniqueCount,
        duplicates: clustered.duplicates,
        clusters: clustered.centroids.length,
        iterations: clustered.iterations,
        converged: clustered.converged,
        emptyClusters: clustered.emptyClusters,
        reseeded: clustered.reseeded,
        samplePool: pool.length,
        usedForegroundOnly: pool === foregroundPixels,
      };
    }
  }

  // ── 逐格映射 ────────────────────────────────────────────
  // 量化后色板变了，重开一个匹配器（色板变了，缓存必须失效）
  const finalMatcher = quantize
    ? createPaletteMatcher(effectivePalette, { mode: matcher.mode, skipTransparent: opts.skipTransparent })
    : matcher;

  const matrix = [];
  const colorIds = [];
  let unknownCodes = 0;
  const transparentBg = opts.transparentBg !== false;

  for (let y = 0; y < grid.height; y++) {
    const row = [];
    const idRow = [];
    for (let x = 0; x < grid.width; x++) {
      const index = y * grid.width + x;
      if (transparentBg && !cellMask[index]) {
        row.push(null);
        idRow.push(null);
        continue;
      }
      const point = [sampled.samples[index * 3], sampled.samples[index * 3 + 1], sampled.samples[index * 3 + 2]];
      const matched = finalMatcher.match(point);
      if (!matched) { unknownCodes++; row.push(null); idRow.push(null); continue; }
      row.push(matched.code);
      idRow.push(matched.index);
    }
    matrix.push(row);
    colorIds.push(idRow);
  }

  const colorStats = countGridColors(matrix);

  return {
    width: grid.width,
    height: grid.height,
    matrix,
    colorIds,
    palette: preparePalette(effectivePalette).map((entry) => ({
      position: entry.position,
      index: entry.index,
      code: entry.code,
      name: entry.name,
      hex: entry.hex,
      rgb: entry.rgb,
      transparent: entry.transparent,
    })),
    statistics: {
      width: grid.width,
      height: grid.height,
      cellCount,
      beadCount: colorStats.beadCount,
      emptyCount: colorStats.emptyCount,
      usedColorCount: colorStats.usedColors.length,
      usedColors: colorStats.usedColors,
      colorUsage: colorStats.usage,
      foregroundCells: cellMask.reduce((sum, value) => sum + value, 0),
    },
    diagnostics: {
      engine: PW_ENGINE_ID,
      moduleVersion: PW_MODULE_VERSION,
      profile,
      upstreamRegion: "app.js:47–253",
      grid: grid.limits,
      gridDerived: grid.derived,
      sampling: {
        requestedMode: samplingMode,
        supersample,
        fitMode,
        filter: sampled.rasterFilter,
        rasterSize: { width: sampled.rasterWidth, height: sampled.rasterHeight },
        geometry: {
          croppedFraction: sampled.geometry.croppedFraction,
          letterboxFraction: sampled.geometry.letterboxFraction,
          scale: sampled.geometry.scale,
        },
      },
      quantization,
      segmentation: segmentation.diagnostics,
      segmentationStages: opts.includeStages === true ? segmentation.stages : null,
      matching: {
        ...finalMatcher.diagnostics,
        unknownCodes,
        requantized: quantize,
      },
      sourcePaletteSize: matcher.entries.length,
      effectivePaletteSize: effectivePalette.length,
      timingMs: Date.now() - startedAt,
    },
  };
}

export { GRID_SAMPLE_MODE, PALETTE_MATCH_MODE, BACKGROUND_MODE, ERODE_MODE, THRESHOLD_MODE, PIPELINE_PROFILE, QUANTIZER as QUANTIZERS };
export { sampleCells, resizeToGrid };
