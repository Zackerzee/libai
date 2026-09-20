/**
 * BGS algorithm module — statistics, diagnostics and the A/B comparison metrics.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0) only in the sense of
 * reproducing its `diagnostics` record shape (src/app.js:2519). The quality metrics
 * below are new to libms: they exist so that `current` and `bgs` can be compared on
 * the same input without either engine being declared the winner
 * (see docs/ALGORITHM_AB_TEST.md).
 *
 * All metrics are pure functions of (matrix, palette, optional source raster) and are
 * unit-testable without a browser.
 */

import { BGS_CONFIG } from './config.mjs';
import {
  luminance255, compositeOverWhite, rgbToOklab, rgbToCielab, oklabDistance, deltaE2000,
} from './color-space.mjs';
import { otsuThreshold } from './color-space.mjs';

/* ─────────────────────────────────────────────────────────────
 * 基础统计
 * ───────────────────────────────────────────────────────────── */

/** Distinct non-empty colours, with counts, sorted by count desc then code asc. */
export function summarizeColors({ colorIds, cols, rows, palette, indexToCode }) {
  const counts = new Map();
  let nonEmpty = 0;
  for (let i = 0; i < colorIds.length; i++) {
    const value = colorIds[i];
    if (value < 0) continue;
    nonEmpty++;
    counts.set(value, (counts.get(value) || 0) + 1);
  }

  const colors = Array.from(counts.entries())
    .map(([index, count]) => ({
      index,
      code: indexToCode ? indexToCode(index) : String(index),
      count,
      share: nonEmpty ? count / nonEmpty : 0,
    }))
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  return { nonEmpty, colorCount: counts.size, colors, totalCells: cols * rows };
}

/* ─────────────────────────────────────────────────────────────
 * 邻域结构指标
 * ───────────────────────────────────────────────────────────── */

/**
 * Isolated / low-agreement cells.
 *
 * "孤立像素" is defined as a non-empty cell with **zero** same-colour 8-neighbours:
 * a bead that touches nothing of its own colour is almost always a quantisation
 * speck rather than an intended detail. `lowAgreementCells` is the softer variant
 * (fewer than 34% of its *non-empty* neighbours share its colour) and catches specks
 * sitting inside a differently-coloured region.
 */
export function measureIsolation({ colorIds, cols, rows }) {
  const cfg = BGS_CONFIG.metrics;
  let isolatedPixels = 0;
  let lowAgreementCells = 0;
  const isolatedCells = [];
  const lowAgreementSample = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      const value = colorIds[cell];
      if (value < 0) continue;

      let same = 0;
      let occupied = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const neighbour = colorIds[ny * cols + nx];
          if (neighbour < 0) continue;
          occupied++;
          if (neighbour === value) same++;
        }
      }

      if (same === 0) {
        isolatedPixels++;
        if (isolatedCells.length < 200) isolatedCells.push(cell);
      }
      if (occupied > 0 && same / occupied < cfg.isolateMaxNeighborAgreement) {
        lowAgreementCells++;
        if (lowAgreementSample.length < 200) lowAgreementSample.push(cell);
      }
    }
  }

  return { isolatedPixels, isolatedCells, lowAgreementCells, lowAgreementSample };
}

/**
 * Edge noise: cells sitting on a colour boundary that disagree with the dominant
 * colour around them.
 *
 * This is the metric that catches "the outline is there but it is fuzzy" — a boundary
 * cell whose colour is far from every neighbour is a misfit, whereas a boundary cell
 * that merely differs from a *different* neighbour as part of a real edge is fine.
 */
export function measureEdgeNoise({ colorIds, cols, rows, matcher, palette }) {
  const cfg = BGS_CONFIG.metrics;
  const labByIndex = new Map();
  const labOf = (index) => {
    if (!labByIndex.has(index)) {
      const entry = matcher?.entryOf?.(index);
      const rgb = entry?.rgb ?? palette?.find?.((c) => c.index === index)?.rgb;
      labByIndex.set(index, rgb ? rgbToOklab(rgb) : [0, 0, 0]);
    }
    return labByIndex.get(index);
  };

  let boundaryCells = 0;
  let edgeNoiseCells = 0;
  const noiseCells = [];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      const value = colorIds[cell];
      if (value < 0) continue;

      const neighbourCounts = new Map();
      let differing = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const neighbour = colorIds[ny * cols + nx];
          if (neighbour < 0) continue;
          if (neighbour !== value) differing++;
          neighbourCounts.set(neighbour, (neighbourCounts.get(neighbour) || 0) + 1);
        }
      }
      if (differing === 0) continue;
      boundaryCells++;

      // Ignore the cell's own colour when looking for the surrounding consensus.
      let dominant = -1;
      let dominantVotes = 0;
      for (const [neighbour, votes] of neighbourCounts) {
        if (neighbour === value) continue;
        if (votes > dominantVotes) { dominant = neighbour; dominantVotes = votes; }
      }
      if (dominant < 0) continue;

      const distance = oklabDistance(labOf(value), labOf(dominant));
      // A boundary cell that is also a minority among its neighbours is a misfit.
      const isMinority = neighbourCounts.get(value) === undefined || neighbourCounts.get(value) < differing;
      if (distance >= cfg.edgeNeighborDistanceMin && isMinority) {
        edgeNoiseCells++;
        if (noiseCells.length < 200) noiseCells.push({ cell, distance });
      }
    }
  }

  return { boundaryCells, edgeNoiseCells, noiseCells };
}

/* ─────────────────────────────────────────────────────────────
 * 连通性
 * ───────────────────────────────────────────────────────────── */

/** Connected components of non-empty cells (4-connectivity), plus colour-wise runs. */
export function measureComponents({ colorIds, cols, rows }) {
  const visited = new Uint8Array(colorIds.length);
  let total = 0;
  let largest = 0;
  const stack = [];

  for (let start = 0; start < colorIds.length; start++) {
    if (colorIds[start] < 0 || visited[start]) continue;
    total++;
    let size = 0;
    stack.length = 0;
    stack.push(start);
    visited[start] = 1;
    while (stack.length) {
      const current = stack.pop();
      size++;
      const x = current % cols;
      const y = (current - x) / cols;
      if (x > 0) { const n = current - 1; if (!visited[n] && colorIds[n] >= 0) { visited[n] = 1; stack.push(n); } }
      if (x + 1 < cols) { const n = current + 1; if (!visited[n] && colorIds[n] >= 0) { visited[n] = 1; stack.push(n); } }
      if (y > 0) { const n = current - cols; if (!visited[n] && colorIds[n] >= 0) { visited[n] = 1; stack.push(n); } }
      if (y + 1 < rows) { const n = current + cols; if (!visited[n] && colorIds[n] >= 0) { visited[n] = 1; stack.push(n); } }
    }
    if (size > largest) largest = size;
  }

  return { componentCount: total, largestComponent: largest };
}

/* ─────────────────────────────────────────────────────────────
 * 色差（重建误差）
 * ───────────────────────────────────────────────────────────── */

/**
 * Reconstruction error: how far each bead's colour is from the mean colour of the
 * source region it represents.
 *
 * Reported both as CIEDE2000 (perceptually uniform, the number that matters) and as
 * per-channel sRGB RMSE (the number that matches what you see when diffing images).
 */
export function measureColorError({ colorIds, cols, rows, matcher, raster }) {
  if (!raster || !raster.data) return null;
  const { width, height } = raster;
  const deltas = [];
  let sumSq = 0;
  let samples = 0;

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const index = colorIds[gy * cols + gx];
      if (index < 0) continue;
      const entry = matcher.entryOf(index);
      if (!entry) continue;

      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.ceil(((gx + 1) * width) / cols));
      const y0 = Math.floor((gy * height) / rows);
      const y1 = Math.max(y0 + 1, Math.ceil(((gy + 1) * height) / rows));

      let r = 0;
      let g = 0;
      let b = 0;
      let weight = 0;
      const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 64)));
      for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
          const p = (y * width + x) * 4;
          const alpha = raster.data[p + 3] / 255;
          const [cr, cg, cb] = compositeOverWhite(raster.data[p], raster.data[p + 1], raster.data[p + 2], alpha);
          r += cr * alpha;
          g += cg * alpha;
          b += cb * alpha;
          weight += alpha;
        }
      }
      if (weight <= 0) continue;
      const meanRgb = [r / weight, g / weight, b / weight];
      const meanCie = rgbToCielab(meanRgb);
      const delta = deltaE2000(meanCie, entry.cieLab);
      deltas.push(delta);

      const dr = meanRgb[0] - entry.rgb[0];
      const dg = meanRgb[1] - entry.rgb[1];
      const db = meanRgb[2] - entry.rgb[2];
      sumSq += dr * dr + dg * dg + db * db;
      samples++;
    }
  }

  if (!samples) return null;
  deltas.sort((a, b) => a - b);
  const mean = deltas.reduce((sum, value) => sum + value, 0) / deltas.length;
  const percentile = (p) => deltas[Math.min(deltas.length - 1, Math.floor(deltas.length * p))];

  return {
    meanCiede2000: mean,
    medianCiede2000: percentile(0.5),
    p95Ciede2000: percentile(0.95),
    maxCiede2000: deltas[deltas.length - 1],
    rmseSrgb: Math.sqrt(sumSq / samples),
    samples,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 结构保持率
 * ───────────────────────────────────────────────────────────── */

/**
 * Structure retention.
 *
 * Source structure is taken as the set of cells whose **luminance gradient** survives
 * Otsu thresholding on the cell-resolution luma plane (this is the cell-level analogue
 * of the edge map libms already computes in `stroke-mask.mjs`). Output structure is the
 * set of cells lying on a colour boundary or on the pattern silhouette.
 *
 * `retention` = recall = share of source structure cells that the output represents.
 * `precision` = share of output boundaries that correspond to real source structure.
 * `f1` balances the two. Reported separately on purpose: a high-recall / low-precision
 * result means the output is noisy, the reverse means it is blurred.
 */
export function measureStructure({ colorIds, cols, rows, raster }) {
  if (!raster || !raster.data) return null;
  const { width, height } = raster;
  const cellCount = cols * rows;
  const luma = new Float32Array(cellCount);

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const x0 = Math.floor((gx * width) / cols);
      const x1 = Math.max(x0 + 1, Math.ceil(((gx + 1) * width) / cols));
      const y0 = Math.floor((gy * height) / rows);
      const y1 = Math.max(y0 + 1, Math.ceil(((gy + 1) * height) / rows));
      let sum = 0;
      let weight = 0;
      const step = Math.max(1, Math.floor(Math.sqrt(((x1 - x0) * (y1 - y0)) / 64)));
      for (let y = y0; y < y1; y += step) {
        for (let x = x0; x < x1; x += step) {
          const p = (y * width + x) * 4;
          const alpha = raster.data[p + 3] / 255;
          const [r, g, b] = compositeOverWhite(raster.data[p], raster.data[p + 1], raster.data[p + 2], alpha);
          sum += luminance255(r, g, b) * alpha;
          weight += alpha;
        }
      }
      luma[gy * cols + gx] = weight > 0 ? sum / weight : NaN;
    }
  }

  // Source gradient magnitude at cell resolution.
  const gradient = new Float32Array(cellCount);
  const histogram = new Uint32Array(256);
  let histogramTotal = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      if (Number.isNaN(luma[cell])) continue;
      const left = x > 0 && !Number.isNaN(luma[cell - 1]) ? luma[cell - 1] : luma[cell];
      const right = x + 1 < cols && !Number.isNaN(luma[cell + 1]) ? luma[cell + 1] : luma[cell];
      const up = y > 0 && !Number.isNaN(luma[cell - cols]) ? luma[cell - cols] : luma[cell];
      const down = y + 1 < rows && !Number.isNaN(luma[cell + cols]) ? luma[cell + cols] : luma[cell];
      const magnitude = Math.sqrt((right - left) ** 2 + (down - up) ** 2);
      gradient[cell] = magnitude;
      const bin = Math.min(255, Math.round(magnitude));
      histogram[bin]++;
      histogramTotal++;
    }
  }

  const otsu = histogramTotal ? otsuThreshold(histogram, histogramTotal) : null;
  const edgeThreshold = Math.max(6, otsu ? otsu.threshold : 24);

  const sourceEdge = new Uint8Array(cellCount);
  let sourceEdgeCells = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    if (Number.isNaN(luma[cell])) continue;
    if (gradient[cell] > edgeThreshold) { sourceEdge[cell] = 1; sourceEdgeCells++; }
  }

  // Output structure: colour boundary or silhouette.
  const outputEdge = new Uint8Array(cellCount);
  let outputBoundaryCells = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      const value = colorIds[cell];
      let boundary = false;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        if (colorIds[ny * cols + nx] !== value) { boundary = true; break; }
      }
      if (boundary) { outputEdge[cell] = 1; outputBoundaryCells++; }
    }
  }

  let truePositive = 0;
  for (let cell = 0; cell < cellCount; cell++) {
    if (sourceEdge[cell] && outputEdge[cell]) truePositive++;
  }
  const retention = sourceEdgeCells ? truePositive / sourceEdgeCells : 1;
  const precision = outputBoundaryCells ? truePositive / outputBoundaryCells : 1;
  const f1 = retention + precision > 0 ? (2 * retention * precision) / (retention + precision) : 0;

  return {
    retention,
    precision,
    f1,
    sourceEdgeCells,
    outputBoundaryCells,
    matchedCells: truePositive,
    edgeThreshold,
    edgeThresholdSource: otsu ? (otsu.flatPlateau ? 'otsu-plateau-midpoint' : 'otsu') : 'floor',
  };
}

/* ─────────────────────────────────────────────────────────────
 * 汇总
 * ───────────────────────────────────────────────────────────── */

/**
 * Build the `statistics` block of `convertImageToBeads`'s return value.
 * Everything here is derived from the matrix, so it can be recomputed for any
 * external matrix (which is what the A/B harness does for `current`).
 */
export function computeStatistics({ colorIds, cols, rows, matcher, palette, raster, indexToCode }) {
  const summary = summarizeColors({ colorIds, cols, rows, palette, indexToCode });
  const isolation = measureIsolation({ colorIds, cols, rows });
  const edgeNoise = measureEdgeNoise({ colorIds, cols, rows, matcher, palette });
  const components = measureComponents({ colorIds, cols, rows });
  const colorError = measureColorError({ colorIds, cols, rows, matcher, raster });
  const structure = measureStructure({ colorIds, cols, rows, raster });

  return {
    /* 需求指标 */
    usedColorCount: summary.colorCount,
    isolatedPixelCount: isolation.isolatedPixels,
    edgeNoiseCount: edgeNoise.edgeNoiseCells,
    colorDifference: colorError,
    structureRetention: structure ? structure.retention : null,

    /* 细节 */
    beadCount: summary.nonEmpty,
    totalCells: summary.totalCells,
    fillRatio: summary.totalCells ? summary.nonEmpty / summary.totalCells : 0,
    colors: summary.colors,
    lowAgreementCellCount: isolation.lowAgreementCells,
    boundaryCellCount: edgeNoise.boundaryCells,
    componentCount: components.componentCount,
    largestComponent: components.largestComponent,
    structure,
    isolatedCells: isolation.isolatedCells,
    noiseCells: edgeNoise.noiseCells,
  };
}

export default {
  summarizeColors,
  measureIsolation,
  measureEdgeNoise,
  measureComponents,
  measureColorError,
  measureStructure,
  computeStatistics,
};
