import { rgbToLab, deltaE2000 } from '../smart-preprocessing/palette-engine.mjs';

// Conservative experimental gates, not calibrated recommendations or a quality score.
export const SMART_TOLERANCE_LIMITS = Object.freeze({
  maxDeltaE: 12,
  maxDeltaL: 6,
  minBaselineContrast: 3,
  minContrastRatio: 0.65,
  maxContrastLoss: 2,
});

export function resolveToleranceLimits(overrides = {}) {
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new TypeError('limits must be an object');
  const limits = { ...SMART_TOLERANCE_LIMITS };
  for (const [key, value] of Object.entries(overrides)) {
    if (!Object.hasOwn(limits, key)) throw new RangeError(`Unknown quality limit: ${key}`);
    if (!Number.isFinite(value)) throw new RangeError(`Invalid quality limit: ${key}`);
    limits[key] = value;
  }
  if (limits.maxDeltaE <= 0 || limits.maxDeltaL <= 0 || limits.minBaselineContrast < 0 ||
      limits.minContrastRatio < 0 || limits.minContrastRatio > 1 || limits.maxContrastLoss < 0) {
    throw new RangeError('Quality limits outside their valid ranges');
  }
  return Object.freeze(limits);
}

function validLab(lab) {
  if (!Array.isArray(lab) || lab.length !== 3 || !lab.every(Number.isFinite)) throw new TypeError('Expected three finite Lab channels');
}

export function candidateCost(sourceLab, targetLab, overrides = {}, profiler = null) {
  validLab(sourceLab); validLab(targetLab);
  const limits = resolveToleranceLimits(overrides);
  const deltaE = profiler ? profiler.measure('ΔE00 calculation', () => deltaE2000(sourceLab, targetLab)) : deltaE2000(sourceLab, targetLab);
  const deltaL = profiler ? profiler.measure('ΔL checks', () => Math.abs(sourceLab[0] - targetLab[0])) : Math.abs(sourceLab[0] - targetLab[0]);
  return { cost: Math.max(deltaE / limits.maxDeltaE, deltaL / limits.maxDeltaL), deltaE, deltaL };
}

function validateGrid(grid) {
  if (!Array.isArray(grid) || grid.some(row => !Array.isArray(row) || row.length !== (grid[0]?.length || 0))) {
    throw new TypeError('Expected rectangular grid');
  }
  for (let y = 0; y < grid.length; y++) {
    if (!Object.hasOwn(grid, y)) throw new TypeError('Sparse grids are not supported');
    for (let x = 0; x < grid[y].length; x++) {
      if (!Object.hasOwn(grid[y], x)) throw new TypeError('Sparse grid rows are not supported');
    }
  }
  for (const row of grid) for (const cell of row) {
    if (cell === null) continue;
    if (!cell || !Array.isArray(cell.rgb) || cell.rgb.length !== 3 || !cell.rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 255)) {
      throw new TypeError('Expected palette RGB or null');
    }
  }
}

/** Build frozen baseline edge evidence once. No image, store or renderer access. */
export function buildLocalContrastReference(baselineGrid, overrides = {}, profiler = null, cache = null) {
  if (profiler) profiler.measure('baseline preparation', () => validateGrid(baselineGrid)); else validateGrid(baselineGrid);
  const limits = resolveToleranceLimits(overrides);
  const height = baselineGrid.length, width = baselineGrid[0]?.length || 0;
  const buildLabs = () => baselineGrid.map(row => row.map(cell => cell === null ? null : cache ? cache.lab(cell) : rgbToLab(cell.rgb)));
  const labs = profiler ? profiler.measure('RGB→Lab', buildLabs) : buildLabs();
  const edges = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (!labs[y][x]) continue;
    for (const [dx, dy] of [[1, 0], [0, 1]]) {
      const nx = x + dx, ny = y + dy;
      const neighbor = labs[ny]?.[nx];
      if (!neighbor) continue;
      const contrast = cache ? cache.metric(baselineGrid[y][x], baselineGrid[ny][nx]).deltaE : profiler ? profiler.measure('ΔE00 calculation', () => deltaE2000(labs[y][x], neighbor)) : deltaE2000(labs[y][x], neighbor);
      if (contrast < limits.minBaselineContrast) continue;
      const deltaL = cache ? cache.metric(baselineGrid[y][x], baselineGrid[ny][nx]).signedDeltaL : profiler ? profiler.measure('ΔL checks', () => labs[y][x][0] - neighbor[0]) : labs[y][x][0] - neighbor[0];
      edges.push(Object.freeze({ x, y, nx, ny, contrast, deltaL }));
    }
  }
  return Object.freeze({ width, height, limits, edges: Object.freeze(edges) });
}

export function validateContrastReference(reference, candidateGrid, profiler = null, cache = null) {
  if (profiler) profiler.measure('final validation', () => validateGrid(candidateGrid)); else validateGrid(candidateGrid);
  if (candidateGrid.length !== reference.height || (candidateGrid[0]?.length || 0) !== reference.width) throw new RangeError('Grid dimensions changed');
  const buildLabs = () => candidateGrid.map(row => row.map(cell => cell === null ? null : cache ? cache.lab(cell) : rgbToLab(cell.rgb)));
  const labs = profiler ? profiler.measure('RGB→Lab', buildLabs) : buildLabs();
  const reasons = [];
  for (const edge of reference.edges) {
    const a = labs[edge.y][edge.x], b = labs[edge.ny][edge.nx];
    if (!a || !b) { reasons.push({ code: 'NULL_BOUNDARY_CHANGED', ...edge }); continue; }
    const contrast = cache ? cache.metric(candidateGrid[edge.y][edge.x], candidateGrid[edge.ny][edge.nx]).deltaE : profiler ? profiler.measure('ΔE00 calculation', () => deltaE2000(a, b)) : deltaE2000(a, b);
    const deltaL = cache ? cache.metric(candidateGrid[edge.y][edge.x], candidateGrid[edge.ny][edge.nx]).signedDeltaL : profiler ? profiler.measure('ΔL checks', () => a[0] - b[0]) : a[0] - b[0];
    const minimum = Math.max(edge.contrast * reference.limits.minContrastRatio, edge.contrast - reference.limits.maxContrastLoss);
    if (contrast + 1e-9 < minimum) reasons.push({ code: 'LOCAL_CONTRAST_LOSS', ...edge, actualContrast: contrast, minimumContrast: minimum });
    if (Math.abs(edge.deltaL) >= reference.limits.maxDeltaL && deltaL * edge.deltaL <= 0) {
      reasons.push({ code: 'LIGHTNESS_ORDER_CHANGED', ...edge, actualDeltaL: deltaL });
    }
  }
  return { valid: reasons.length === 0, reasons };
}

export function validateLocalContrast(baselineGrid, candidateGrid, { limits = {} } = {}) {
  return validateContrastReference(buildLocalContrastReference(baselineGrid, limits), candidateGrid);
}

/** Diagnostics only: no auto-recommendation, weighted score or claimed losslessness. */
export function measureToleranceQuality(baselineGrid, candidateGrid, { limits = {} } = {}) {
  validateGrid(baselineGrid); validateGrid(candidateGrid);
  if (baselineGrid.length !== candidateGrid.length || (baselineGrid[0]?.length || 0) !== (candidateGrid[0]?.length || 0)) throw new RangeError('Grid dimensions changed');
  let count = 0, changedCells = 0, totalDeltaE = 0, totalDeltaL = 0, maxDeltaE = 0, maxDeltaL = 0;
  for (let y = 0; y < baselineGrid.length; y++) for (let x = 0; x < baselineGrid[y].length; x++) {
    const before = baselineGrid[y][x], after = candidateGrid[y][x];
    if ((before === null) !== (after === null)) throw new RangeError('Null distribution changed');
    if (before === null) continue;
    const cost = candidateCost(rgbToLab(before.rgb), rgbToLab(after.rgb), limits);
    count++; totalDeltaE += cost.deltaE; totalDeltaL += cost.deltaL;
    maxDeltaE = Math.max(maxDeltaE, cost.deltaE); maxDeltaL = Math.max(maxDeltaL, cost.deltaL);
    if ((before.paletteId ?? before.code) !== (after.paletteId ?? after.code)) changedCells++;
  }
  return { nonEmptyCells: count, changedCells, meanDeltaE: count ? totalDeltaE / count : 0,
    meanDeltaL: count ? totalDeltaL / count : 0, maxDeltaE, maxDeltaL,
    localContrast: validateLocalContrast(baselineGrid, candidateGrid, { limits }) };
}
