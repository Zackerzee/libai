/**
 * BGS algorithm module — A/B comparison.
 *
 * Runs `current` (libms's existing pipeline) and `bgs` on the same input and reports
 * the six requested metrics side by side:
 *
 *   1. 使用颜色数量      usedColorCount
 *   2. 孤立像素数量      isolatedPixelCount
 *   3. 边缘杂色数量      edgeNoiseCount
 *   4. 色差              colorDifference (CIEDE2000 + sRGB RMSE vs source)
 *   5. 结构保持率        structureRetention
 *   6. 输出矩阵          matrix (+ a textual diff)
 *
 * **This module does not rank the engines.** There is no "winner" field, no score, no
 * recommendation. Choosing between the two is a human judgement call that depends on
 * the source image, which is exactly why both are kept (see docs/ALGORITHM_AB_TEST.md).
 *
 * Pure functions only — the whole comparison is unit-testable without a browser.
 */

import { preparePalette } from './color-space.mjs';
import { createMatcher } from './matcher.mjs';
import { computeStatistics } from './statistics.mjs';
import { convertImageToBeads, DEFAULT_OPTIONS, BGS_ENGINE_ID } from './index.mjs';
import { asRaster } from './raster.mjs';

/* ─────────────────────────────────────────────────────────────
 * 矩阵归一化
 * ───────────────────────────────────────────────────────────── */

/**
 * Accept the several matrix shapes the two engines produce and normalize.
 *
 * Cell values may be:
 *   - `null` / `undefined` / `-1` → empty
 *   - a number → palette `index` (NOT array position)
 *   - a string → palette `code`
 *   - `{code}` / `{index}` / `{id}` → an object cell (libms's `state.grid` shape)
 *
 * @returns {{colorIds: Int16Array, codes: Array<string|null>, cols:number, rows:number}}
 */
export function normalizeMatrix(matrix, palette) {
  const rows = Array.isArray(matrix) ? matrix.length : 0;
  const cols = rows && Array.isArray(matrix[0]) ? matrix[0].length : 0;
  const colorIds = new Int16Array(rows * cols).fill(-1);
  const codes = new Array(rows * cols).fill(null);

  const positionByCode = new Map();
  const positionByIndex = new Map();
  palette.forEach((entry, position) => {
    if (!positionByCode.has(entry.code)) positionByCode.set(entry.code, position);
    if (!positionByIndex.has(entry.index)) positionByIndex.set(entry.index, position);
  });

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = matrix[y]?.[x];
      const slot = y * cols + x;
      if (cell === null || cell === undefined) continue;

      let position = -1;
      if (typeof cell === 'number') {
        if (cell < 0) continue;
        position = positionByIndex.has(cell) ? positionByIndex.get(cell) : cell;
      } else if (typeof cell === 'string') {
        position = positionByCode.get(cell) ?? -1;
      } else if (typeof cell === 'object') {
        if (cell.code !== undefined) position = positionByCode.get(cell.code) ?? -1;
        else if (cell.index !== undefined || cell.id !== undefined) {
          const value = Number(cell.index ?? cell.id);
          position = positionByIndex.has(value) ? positionByIndex.get(value) : value;
        }
      }
      if (position < 0 || position >= palette.length) continue;
      colorIds[slot] = palette[position].index;
      codes[slot] = palette[position].code;
    }
  }

  return { colorIds, codes, cols, rows };
}

/** Turn colorIds back into the pure `matrix` form (2-D array of codes / null). */
export function matrixFromColorIds(colorIds, cols, rows, palette) {
  const codeByIndex = new Map(palette.map((entry) => [entry.index, entry.code]));
  const matrix = [];
  for (let y = 0; y < rows; y++) {
    const row = new Array(cols);
    for (let x = 0; x < cols; x++) {
      const value = colorIds[y * cols + x];
      row[x] = value < 0 ? null : (codeByIndex.get(value) ?? String(value));
    }
    matrix.push(row);
  }
  return matrix;
}

/* ─────────────────────────────────────────────────────────────
 * 指标
 * ───────────────────────────────────────────────────────────── */

const METRIC_KEYS = Object.freeze([
  'usedColorCount',
  'isolatedPixelCount',
  'edgeNoiseCount',
  'structureRetention',
]);

function pickMetrics(statistics) {
  if (!statistics) return null;
  return {
    usedColorCount: statistics.usedColorCount,
    isolatedPixelCount: statistics.isolatedPixelCount,
    edgeNoiseCount: statistics.edgeNoiseCount,
    beadCount: statistics.beadCount,
    fillRatio: statistics.fillRatio,
    lowAgreementCellCount: statistics.lowAgreementCellCount,
    componentCount: statistics.componentCount,
    largestComponent: statistics.largestComponent,
    colorDifference: statistics.colorDifference,
    structureRetention: statistics.structureRetention,
    structure: statistics.structure,
  };
}

/** Sum of absolute per-metric differences. Diagnostics only — NOT a ranking score. */
function metricDelta(current, bgs) {
  if (!current || !bgs) return null;
  const delta = {};
  for (const key of METRIC_KEYS) {
    const a = current[key];
    const b = bgs[key];
    delta[key] = (typeof a === 'number' && typeof b === 'number') ? b - a : null;
  }
  delta.meanCiede2000 = (current.colorDifference && bgs.colorDifference)
    ? bgs.colorDifference.meanCiede2000 - current.colorDifference.meanCiede2000
    : null;
  delta.rmseSrgb = (current.colorDifference && bgs.colorDifference)
    ? bgs.colorDifference.rmseSrgb - current.colorDifference.rmseSrgb
    : null;
  return delta;
}

/* ─────────────────────────────────────────────────────────────
 * 矩阵差分
 * ───────────────────────────────────────────────────────────── */

/** Cell-by-cell diff of two normalized matrices of the same size. */
export function diffMatrices(a, b) {
  const cols = Math.max(a.cols, b.cols);
  const rows = Math.max(a.rows, b.rows);
  let changed = 0;
  let bothEmpty = 0;
  let onlyCurrent = 0;
  let onlyBgs = 0;
  const changes = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const left = a.codes[y * a.cols + x] ?? null;
      const right = b.codes[y * b.cols + x] ?? null;
      if (left === right) {
        if (left === null) bothEmpty++;
        continue;
      }
      changed++;
      if (left === null) onlyBgs++;
      else if (right === null) onlyCurrent++;
      if (changes.length < 5000) changes.push({ x, y, current: left, bgs: right });
    }
  }

  const total = rows * cols;
  return {
    cols,
    rows,
    totalCells: total,
    changedCells: changed,
    changedPercent: total ? changed / total : 0,
    bothEmpty,
    onlyCurrent,   // 只有 current 有豆
    onlyBgs,       // 只有 bgs 有豆
    changes,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 文本预览（CLI 用）
 * ───────────────────────────────────────────────────────────── */

/**
 * Render a matrix as block art so a human can eyeball topology differences in a
 * terminal. Each distinct colour gets a stable glyph derived from the palette order.
 */
export function renderMatrixAsBlockArt(colorIds, cols, rows, palette, { empty = '·' } = {}) {
  const glyphs = '█▓▒░▚▞◧◨◩◪◫◰◱◲◳◴◵◶◷△▽◇◆○●□■';
  const glyphByIndex = new Map();
  palette.forEach((entry, position) => {
    glyphByIndex.set(entry.index, glyphs[position % glyphs.length]);
  });

  const lines = [];
  for (let y = 0; y < rows; y++) {
    let line = '';
    for (let x = 0; x < cols; x++) {
      const value = colorIds[y * cols + x];
      line += value < 0 ? empty : (glyphByIndex.get(value) ?? '?');
    }
    lines.push(line);
  }
  return lines.join('\n');
}

/* ─────────────────────────────────────────────────────────────
 * 同引擎两矩阵比较
 * ───────────────────────────────────────────────────────────── */

/**
 * Evaluate any two matrices against the same source and palette.
 * Used when the caller already has both grids in hand (e.g. from the browser bridge).
 *
 * @param {{currentMatrix: any, bgsMatrix: any, palette: Array, raster: object,
 *          currentLabel?: string, bgsLabel?: string, includeMatrix?: boolean}} args
 */
export function compareMatrices({
  currentMatrix, bgsMatrix, palette, raster,
  currentLabel = 'current', bgsLabel = BGS_ENGINE_ID, includeMatrix = true,
}) {
  const prepared = preparePalette(palette);
  const matcher = createMatcher(prepared);
  const rasterLike = raster ? asRaster(raster, 'raster') : null;

  const current = normalizeMatrix(currentMatrix, prepared);
  const bgs = normalizeMatrix(bgsMatrix, prepared);

  const currentStats = computeStatistics({
    colorIds: current.colorIds, cols: current.cols, rows: current.rows,
    matcher, palette: prepared, raster: rasterLike,
  });
  const bgsStats = computeStatistics({
    colorIds: bgs.colorIds, cols: bgs.cols, rows: bgs.rows,
    matcher, palette: prepared, raster: rasterLike,
  });

  const currentMetrics = pickMetrics(currentStats);
  const bgsMetrics = pickMetrics(bgsStats);

  return {
    generatedAt: new Date().toISOString(),
    engines: { current: currentLabel, bgs: bgsLabel },
    size: { current: { cols: current.cols, rows: current.rows }, bgs: { cols: bgs.cols, rows: bgs.rows } },
    metrics: { current: currentMetrics, bgs: bgsMetrics },
    delta: metricDelta(currentMetrics, bgsMetrics),
    diff: diffMatrices(current, bgs),
    matrices: includeMatrix
      ? { current: matrixFromColorIds(current.colorIds, current.cols, current.rows, prepared), bgs: matrixFromColorIds(bgs.colorIds, bgs.cols, bgs.rows, prepared) }
      : undefined,
    colorIds: includeMatrix
      ? { current: current.colorIds, bgs: bgs.colorIds }
      : undefined,
    palette: prepared.map((entry) => ({ index: entry.index, code: entry.code, name: entry.name, hex: entry.hex, rgb: [...entry.rgb] })),
    /** Deliberately absent: any field that declares one engine better. */
    verdict: null,
    note: 'No automatic winner is produced. Compare the metrics and the block art yourself.',
  };
}

/* ─────────────────────────────────────────────────────────────
 * 跨引擎比较（current 由调用方提供）
 * ───────────────────────────────────────────────────────────── */

/**
 * Run both engines on one input.
 *
 * `currentRunner` must be supplied by the host, because libms's existing pipeline is
 * inseparable from its DOM/Canvas/state layer. Signature:
 *
 *   currentRunner({ imageData, palette, width, height, options }) → matrix | {matrix} | null
 *
 * **`palette` is the caller's own array, not BGS's `preparePalette` output.** This matters:
 * libms's `palette-engine` treats a pre-existing `lab` field as authoritative CIELAB and
 * breaks its own ties on `index`. BGS's prepared entries carry OKLab in `lab` plus a
 * position-derived `index`, so handing those to the production engine silently changes
 * which colours it picks (measured: 60 distinct colours collapse to 30 and the chosen
 * colour is wrong). Each engine therefore receives the palette in its own dialect.
 *
 * In the browser this is wired to the existing `processImage()` path; in Node it can be
 * a fixture matrix or omitted entirely (in which case only the BGS side is reported).
 */
export async function compareEngines({
  imageData, palette, width, height,
  options = {}, currentRunner = null, raster = null,
  currentLabel = 'current', bgsLabel = BGS_ENGINE_ID, includeMatrix = true,
}) {
  if (!palette) throw new Error('bgs/ab-test: palette is required');
  const prepared = preparePalette(palette);
  const source = asRaster(imageData, 'imageData');

  const bgsResult = convertImageToBeads(source, {
    ...DEFAULT_OPTIONS,
    ...options,
    width: width ?? options.width,
    height: height ?? options.height,
    palette: prepared,
  });

  let currentMatrix = null;
  let currentError = null;
  if (currentRunner) {
    try {
      // NOTE: pass the *caller's* palette, never `prepared` — see the doc comment above.
      const raw = await currentRunner({ imageData: source, palette, width, height, options });
      currentMatrix = raw && raw.matrix ? raw.matrix : raw;
    } catch (error) {
      currentError = error?.message || String(error);
    }
  }

  const comparisonRaster = raster ? asRaster(raster, 'raster') : source;
  const matcher = createMatcher(prepared);

  const bgsStats = bgsResult.statistics;
  const bgsMetrics = pickMetrics(bgsStats);

  let currentMetrics = null;
  let diff = null;
  let currentNormalized = null;
  if (currentMatrix) {
    currentNormalized = normalizeMatrix(currentMatrix, prepared);
    const currentStats = computeStatistics({
      colorIds: currentNormalized.colorIds,
      cols: currentNormalized.cols,
      rows: currentNormalized.rows,
      matcher,
      palette: prepared,
      raster: comparisonRaster,
    });
    currentMetrics = pickMetrics(currentStats);
    const bgsNormalized = normalizeMatrix(bgsResult.matrix, prepared);
    diff = diffMatrices(currentNormalized, bgsNormalized);
  }

  const bgsNormalized = normalizeMatrix(bgsResult.matrix, prepared);

  return {
    generatedAt: new Date().toISOString(),
    engines: { current: currentLabel, bgs: bgsLabel },
    currentError,
    size: {
      current: currentNormalized ? { cols: currentNormalized.cols, rows: currentNormalized.rows } : null,
      bgs: { cols: bgsResult.width, rows: bgsResult.height },
    },
    metrics: { current: currentMetrics, bgs: bgsMetrics },
    delta: metricDelta(currentMetrics, bgsMetrics),
    diff,
    matrices: includeMatrix
      ? {
        current: currentNormalized ? matrixFromColorIds(currentNormalized.colorIds, currentNormalized.cols, currentNormalized.rows, prepared) : null,
        bgs: bgsResult.matrix,
      }
      : undefined,
    diagnostics: { bgs: bgsResult.diagnostics },
    palette: bgsResult.palette,
    verdict: null,
    note: 'No automatic winner is produced. Compare the metrics and the block art yourself.',
  };
}

export default {
  normalizeMatrix,
  matrixFromColorIds,
  diffMatrices,
  renderMatrixAsBlockArt,
  compareMatrices,
  compareEngines,
};
