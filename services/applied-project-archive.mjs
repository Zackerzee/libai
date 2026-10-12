import { validateAppliedCell, validateAppliedGrid } from './applied-export-grid.mjs';

export function encodeAppliedGrid(grid, width = grid?.[0]?.length ?? 0, height = grid?.length) {
  validateAppliedGrid(grid, width, height);
  const cells = [], indices = new Map();
  const rows = grid.map(row => row.map(cell => {
    if (cell === null) return null;
    const key = JSON.stringify(cell);
    if (!indices.has(key)) { indices.set(key, cells.length); cells.push(structuredClone(cell)); }
    return indices.get(key);
  }));
  return { schemaVersion: 1, width, height, cells, rows };
}

export function decodeAppliedGrid(archive) {
  if (!archive || archive.schemaVersion !== 1 || !Array.isArray(archive.cells) || !Array.isArray(archive.rows)) throw new TypeError('Invalid applied grid archive');
  if (!Number.isInteger(archive.width) || archive.width < 0 || !Number.isInteger(archive.height) || archive.height < 0) throw new TypeError('Missing or invalid archive dimensions');
  for (let i = 0; i < archive.cells.length; i++) {
    if (archive.cells[i] === null) throw new TypeError('Null must use an archive null index');
    validateAppliedCell(archive.cells[i]);
  }
  const grid = archive.rows.map(row => {
    if (!Array.isArray(row)) throw new TypeError('Invalid archive row');
    return Array.from(row, index => {
      if (index === null) return null;
      if (!Number.isInteger(index) || index < 0 || index >= archive.cells.length) throw new TypeError('Invalid applied archive index');
      return structuredClone(archive.cells[index]);
    });
  });
  return validateAppliedGrid(grid, archive.width, archive.height);
}

export function validateSmartToleranceMetadata(metadata) {
  if (metadata == null) return null;
  if (typeof metadata.enabled !== 'boolean' || !Number.isFinite(metadata.strength) || metadata.strength < 0 || metadata.strength > 100
    || typeof metadata.algorithmVersion !== 'string' || !metadata.algorithmVersion.trim()
    || typeof metadata.paletteKey !== 'string' || !metadata.paletteKey.trim()) throw new TypeError('Invalid applied Smart tolerance metadata');
  const result = { enabled: metadata.enabled, strength: metadata.strength, algorithmVersion: metadata.algorithmVersion, paletteKey: metadata.paletteKey };
  for (const key of ['baselineRevision', 'appliedRevision']) {
    const value = metadata[key];
    if (value == null) continue;
    if (!(typeof value === 'string' && value.length > 0) && !(typeof value === 'number' && Number.isFinite(value) && value >= 0)) throw new TypeError('Invalid applied revision');
    result[key] = value;
  }
  return result;
}

export function restoreProjectArchiveGrid(payload, { palette = [] } = {}) {
  const width = payload?.canvas?.width, height = payload?.canvas?.height;
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new TypeError('Invalid saved canvas dimensions');
  if (payload.appliedGrid != null) {
    const grid = decodeAppliedGrid(payload.appliedGrid);
    validateAppliedGrid(grid, width, height);
    return { grid, width, height, legacyFallbackCount: 0, source: 'saved-applied-grid' };
  }
  const archived = new Map((payload.colors || []).map(cell => [String(cell.code).toUpperCase(), cell]));
  const active = new Map(palette.map(cell => [String(cell.code).toUpperCase(), cell]));
  let legacyFallbackCount = 0;
  if (!Array.isArray(payload.grid)) throw new TypeError('Missing saved grid');
  const grid = payload.grid.map(row => {
    if (!Array.isArray(row)) throw new TypeError('Invalid saved row');
    return Array.from(row, code => {
      if (code === null) return null;
      if (typeof code !== 'string' || !code.trim()) throw new TypeError('Invalid saved color code');
      const key = code.toUpperCase();
      let cell = archived.get(key);
      if (!cell) { cell = active.get(key); legacyFallbackCount++; }
      if (!cell) throw new TypeError(`Saved color ${code} has no archived or legal palette entry`);
      return structuredClone(validateAppliedCell(cell));
    });
  });
  validateAppliedGrid(grid, width, height);
  return { grid, width, height, legacyFallbackCount, source: 'legacy-saved-grid' };
}
