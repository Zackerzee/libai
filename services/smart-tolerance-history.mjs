import { createToleranceBuildScheduler } from './smart-tolerance-build-scheduler.mjs';

// Tagged graph keys preserve undefined, sparse slots, aliases and palette identity.
// Exotic values are deliberately not deduplicated across distinct objects.
function graphKey(value) {
  const seen = new Map();
  const visit = item => {
    if (item === null) return ['null'];
    if (typeof item !== 'object') return [typeof item, typeof item === 'number'
      ? Object.is(item, -0) ? '-0' : String(item) : String(item)];
    if (seen.has(item)) return ['ref', seen.get(item)];
    const id = seen.size; seen.set(item, id);
    const proto = Object.getPrototypeOf(item);
    if (proto !== Object.prototype && proto !== Array.prototype) throw new Error('exotic');
    return [Array.isArray(item) ? 'array' : 'object', id, Array.isArray(item) ? item.length : null,
      Object.keys(item).sort().map(key => [key, visit(item[key])])];
  };
  return JSON.stringify(visit(value));
}
function cloneCell(value, seen = new Map()) {
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return seen.get(value);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== Array.prototype) return structuredClone(value);
  const out = Array.isArray(value) ? new Array(value.length) : {};
  seen.set(value, out);
  for (const key of Object.keys(value)) {
    const child = cloneCell(value[key], seen);
    if (key === '__proto__') Object.defineProperty(out, key,
      { value: child, enumerable: true, writable: true, configurable: true });
    else out[key] = child;
  }
  return out;
}

function cellFactory(cell) {
  // Established palette-cell shape: scalar metadata and an ordinary numeric RGB.
  // Copying that shape directly avoids allocating a graph map per restoration.
  if (cell && Object.getPrototypeOf(cell) === Object.prototype &&
    Object.keys(cell).every(key => key === 'rgb' ? Array.isArray(cell.rgb) &&
      Object.keys(cell.rgb).length === cell.rgb.length &&
      Object.keys(cell.rgb).every(index => /^(0|[1-9][0-9]*)$/.test(index) &&
        Number(index) < cell.rgb.length && typeof cell.rgb[index] === 'number') :
      cell[key] === null || typeof cell[key] !== 'object')) {
    return () => ({ ...cell, ...(Object.hasOwn(cell, 'rgb') ? { rgb: cell.rgb.slice() } : {}) });
  }
  const seen = new Set();
  const ordinary = item => {
    if (item === null || typeof item !== 'object' || seen.has(item)) return true;
    seen.add(item);
    const prototype = Object.getPrototypeOf(item);
    return (prototype === Object.prototype || prototype === Array.prototype) && Object.keys(item).every(key => ordinary(item[key]));
  };
  return ordinary(cell) ? () => cloneCell(cell) : () => structuredClone(cell);
}

/** Private immutable-by-ownership dictionary + baseline IDs + sparse after IDs.
 * No full object-grid snapshots are retained; every restoration owns fresh cells. */
export async function createSmartToleranceHistory(before, after, options = {}) {
  const scheduler = createToleranceBuildScheduler(options);
  const dictionary = [], keys = new Map(), objectIds = new WeakMap();
  const lengths = before.map(row => row.length), count = lengths.reduce((sum, n) => sum + n, 0);
  if (after.length !== before.length || after.some((row, y) => row.length !== lengths[y]))
    throw new Error('Smart tolerance history dimensions changed');
  const baselineIds = new Uint32Array(count), changedPositions = [], changedIds = [], counts = new Map();
  let nonEmptyCellCount = 0;
  let dictionaryBytes = 0;
  const identify = cell => {
    if (cell && typeof cell === 'object' && objectIds.has(cell)) return objectIds.get(cell);
    let key;
    try { key = graphKey(cell); } catch { key = null; }
    let id = key === null ? undefined : keys.get(key);
    if (id === undefined) {
      id = dictionary.length; dictionary.push(structuredClone(cell));
      if (key !== null) { keys.set(key, id); dictionaryBytes += new TextEncoder().encode(key).byteLength; }
      else dictionaryBytes += 0; // Exotic payload cannot be estimated reliably.
    }
    if (cell && typeof cell === 'object') objectIds.set(cell, id);
    return id;
  };
  try {
    if (!await scheduler.checkpoint('compact history', 0, true)) { scheduler.finish('cancelled'); return null; }
    let position = 0;
    for (let y = 0; y < before.length; y++) for (let x = 0; x < lengths[y]; x++, position++) {
      const first = identify(before[y][x]), second = identify(after[y][x]);
      baselineIds[position] = first;
      const color = after[y][x];
      if (color) {
        nonEmptyCellCount++;
        const entry = counts.get(color.code);
        if (entry) entry.count++;
        else counts.set(color.code, { ...structuredClone(color), count: 1 });
      }
      if (first !== second) { changedPositions.push(position); changedIds.push(second); }
      if ((position & 255) === 255 && !await scheduler.checkpoint('compact history', 256)) {
        scheduler.finish('cancelled'); return null;
      }
    }
    const positions = Uint32Array.from(changedPositions), overrides = Uint32Array.from(changedIds);
    if (!scheduler.current()) { scheduler.finish('cancelled'); return null; }
    const factories = [];
    for (let i = 0; i < dictionary.length; i++) {
      factories.push(cellFactory(dictionary[i]));
      if ((i & 127) === 127 && !await scheduler.checkpoint('history restoration factories', 128)) {
        scheduler.finish('cancelled'); return null;
      }
    }
    const statistics = [...counts.values()].sort((a, b) => b.count - a.count || a.code.localeCompare(b.code));
    const report = scheduler.finish();
    const metrics = Object.freeze({ changedCellCount: positions.length,
      historyPayloadBytes: baselineIds.byteLength + positions.byteLength + overrides.byteLength + dictionaryBytes + lengths.length * 4,
      objectSnapshotCount: 0, dictionaryCellCount: dictionary.length, nonEmptyCellCount,
      longestHistoryBuildTaskMs: report.longestSyncTaskMs });
    return Object.freeze({ width: lengths[0] ?? 0, height: lengths.length, metrics,
      get afterStats() { return structuredClone(statistics); },
      restore(direction) {
        if (direction !== 'before' && direction !== 'after') throw new Error('Invalid history direction');
        let position = 0, change = 0;
        return lengths.map(length => Array.from({ length }, () => {
          let id = baselineIds[position];
          if (direction === 'after' && positions[change] === position) id = overrides[change++];
          position++; return factories[id]();
        }));
      },
    });
  } catch (error) { scheduler.finish('error'); throw error; }
}
