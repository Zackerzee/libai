import { paletteIdOf } from './palette-identity.js';

const validRgbChannel = value => Number.isFinite(value) && value >= 0 && value <= 255;
// Export is a snapshot of formal work. Preview/configuration/budget are deliberately absent.
export function validateAppliedCell(cell) {
  if (cell === null) return cell;
  if (!cell || typeof cell !== 'object' || Array.isArray(cell) || typeof cell.code !== 'string' || !cell.code.trim()
    || (cell.paletteId != null && (typeof cell.paletteId !== 'string' || !cell.paletteId.trim()))
    || !Array.isArray(cell.rgb) || cell.rgb.length !== 3
    || !validRgbChannel(cell.rgb[0]) || !validRgbChannel(cell.rgb[1]) || !validRgbChannel(cell.rgb[2])) {
    throw new TypeError('Invalid applied bead identity/code/rgb');
  }
  return cell;
}

function validateGridShape(grid, width, height) {
  if (!Array.isArray(grid) || !Number.isInteger(width) || width < 0 || !Number.isInteger(height) || height < 0 || grid.length !== height) {
    throw new TypeError('Invalid applied grid dimensions');
  }
}

export function validateAppliedGrid(grid, width = grid?.[0]?.length ?? 0, height = grid?.length) {
  validateGridShape(grid, width, height);
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    if (!Array.isArray(row) || row.length !== width) throw new TypeError('Applied grid must be rectangular');
    for (let x = 0; x < width; x++) validateAppliedCell(row[x]);
  }
  return grid;
}

export function getAppliedExportGrid(project) {
  if (!project || typeof project !== 'object') throw new TypeError('Formal project required');
  const grid = project.grid, width = project.width === undefined ? grid?.[0]?.length ?? 0 : project.width,
    height = project.height === undefined ? grid?.length : project.height;
  validateGridShape(grid, width, height);
  const snapshot = new Array(height);
  for (let y = 0; y < height; y++) {
    const row = grid[y];
    if (!Array.isArray(row) || row.length !== width) throw new TypeError('Applied grid must be rectangular');
    const copied = new Array(width);
    for (let x = 0; x < width; x++) {
      const cell = validateAppliedCell(row[x]);
      if (cell === null) { copied[x] = null; continue; }
      // Ordinary palette cells contain scalar descriptors and one RGB array.
      // Avoid a whole-grid structuredClone traversal, but retain its deep-copy
      // semantics for imported cells carrying arbitrary nested metadata.
      let simple = true;
      for (const key in cell.rgb) {
        if (Object.hasOwn(cell.rgb, key) && key !== '0' && key !== '1' && key !== '2') { simple = false; break; }
      }
      const copy = {};
      // structuredClone copies own enumerable string keys, not symbol or
      // non-enumerable keys. Preserve that contract without per-cell key arrays.
      if (simple) for (const key in cell) {
        if (!Object.hasOwn(cell, key)) continue;
        if (key === '__proto__') { simple = false; break; }
        if (key === 'rgb') { copy.rgb = [cell.rgb[0], cell.rgb[1], cell.rgb[2]]; continue; }
        const value = cell[key], type = typeof value;
        if (value !== null && (type === 'object' || type === 'function' || type === 'symbol')) { simple = false; break; }
        copy[key] = value;
      }
      copied[x] = simple ? copy : structuredClone(cell);
    }
    snapshot[y] = copied;
  }
  return snapshot;
}

export function getAppliedGridUsage(projectOrGrid) {
  const grid = Array.isArray(projectOrGrid) ? validateAppliedGrid(projectOrGrid) : validateAppliedGrid(projectOrGrid?.grid, projectOrGrid?.width, projectOrGrid?.height);
  const usage = new Map();
  for (const row of grid) for (const cell of row) {
    if (!cell) continue;
    const key = paletteIdOf(cell);
    let item = usage.get(key);
    if (!item) { item = { ...structuredClone(cell), count: 0 }; usage.set(key, item); }
    // A malformed project must not silently coalesce conflicting colors under one identity.
    else if (item.code !== cell.code || item.rgb.some((value, i) => value !== cell.rgb[i])) throw new TypeError('Conflicting applied palette identity');
    item.count++;
  }
  return [...usage.values()];
}

export function createAppliedExportDebug(project, exportType) {
  const grid = validateAppliedGrid(project.grid, project.width, project.height);
  const usage = getAppliedGridUsage(grid);
  return {
    projectId: project.projectId ?? project.workId ?? null,
    workId: project.workId ?? project.projectId ?? null,
    gridRevision: project.gridRevision ?? null,
    appliedRevision: project.appliedRevision ?? null,
    exportType, source: 'applied-grid', legacyFallback: false, recomputed: false,
    width: grid[0]?.length ?? 0, height: grid.length,
    cellCount: usage.reduce((sum, item) => sum + item.count, 0), colorCount: usage.length,
  };
}
