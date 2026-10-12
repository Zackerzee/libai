import { paletteIdOf } from './palette-identity.js';
import { rgbToLab } from '../smart-preprocessing/palette-engine.mjs';
import { buildProtectionMap, ProtectionTier } from '../smart-preprocessing/detail-protection-v2.mjs';
import { candidateCost, resolveToleranceLimits, buildLocalContrastReference } from './smart-color-tolerance-quality.mjs';
import { createToleranceProfiler } from './smart-color-tolerance-perf.mjs';
import { materializeToleranceChunks } from './smart-tolerance-materialization.mjs';
import { createToleranceBuildScheduler, cloneToleranceSnapshotAsync } from './smart-tolerance-build-scheduler.mjs';

const clone = value => structuredClone(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rgbValid = rgb => Array.isArray(rgb) && rgb.length === 3 && rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 255);
const rgbEqual = (a, b) => a.every((v, i) => v === b[i]);

/** Experimental quality-first hierarchy; baseline must be captured after cleanup,
 * before budget. No generation, UI, export or hard color budget is invoked here. */
export function createSmartColorTolerance({ baselineGrid, palette, protection, limits = {}, onProfile } = {}) {
  const profiler = createToleranceProfiler(onProfile);
  const measure = (name, operation) => profiler ? profiler.measure(name, operation) : operation();
  const totalStart = profiler ? performance.now() : 0;
  if (!Array.isArray(baselineGrid) || baselineGrid.some(row => !Array.isArray(row) || row.length !== (baselineGrid[0]?.length ?? 0))) throw new TypeError('baselineGrid must be rectangular');
  for (let y = 0; y < baselineGrid.length; y++) {
    if (!(y in baselineGrid)) throw new TypeError('baselineGrid must not be sparse');
    for (let x = 0; x < baselineGrid[y].length; x++) if (!(x in baselineGrid[y])) throw new TypeError('baselineGrid rows must not be sparse');
  }
  if (!Array.isArray(palette)) throw new TypeError('palette must be an array');
  const baseline = measure('baseline preparation', () => clone(baselineGrid)), legal = new Map();
  measure('palette indexing', () => { for (const color of clone(palette)) {
    const id = paletteIdOf(color);
    if (!id || !color.code || !rgbValid(color.rgb) || legal.has(id)) throw new TypeError('palette requires unique identities and valid code/rgb');
    legal.set(id, color);
  } });
  const used = new Set(), histogram = new Map();
  measure('grid histogram', () => { for (let y = 0; y < baseline.length; y++) for (let x = 0; x < baseline[y].length; x++) {
    const cell = baseline[y][x];
    if (cell === null) continue;
    const id = paletteIdOf(cell), color = legal.get(id);
    if (!color || cell.code !== color.code || !rgbValid(cell.rgb) || !rgbEqual(cell.rgb, color.rgb) || (cell.paletteId ?? null) !== (color.paletteId ?? null)) throw new TypeError('baseline color must match legal palette identity/code/rgb');
    used.add(id);
    let entry = histogram.get(id);
    if (!entry) { entry = { count: 0, protectedCount: 0, cells: [] }; histogram.set(id, entry); }
    entry.count++; entry.cells.push(y * baseline[y].length + x);
  } });
  const ids = [...used].sort(compare), width = baseline[0]?.length ?? 0;
  const frozenLimits = resolveToleranceLimits(clone(limits));
  const maps = measure('protection aggregation', () => protection ?? buildProtectionMap({ grid: baseline, width, height: baseline.length, sameCell: (a, b) => !!a && !!b && paletteIdOf(a) === paletteIdOf(b) }));
  if (!maps || typeof maps !== 'object' || Array.isArray(maps) || (!maps.protectionMap && !maps.tierMap)) throw new TypeError('protection requires protectionMap or tierMap');
  const size = width * baseline.length;
  for (const key of ['protectionMap', 'tierMap']) if (maps[key] != null) {
    if (!Array.isArray(maps[key]) && !(ArrayBuffer.isView(maps[key]) && !(maps[key] instanceof DataView))) throw new TypeError(`${key} must be a numeric array`);
    if (maps[key].length !== size) throw new TypeError(`${key} size mismatch`);
    if (Array.from(maps[key]).some(v => !Number.isFinite(v) || v < 0 || v > (key === 'tierMap' ? ProtectionTier.CRITICAL : 1) || (key === 'tierMap' && !Number.isInteger(v)))) throw new TypeError(`${key} contains invalid values`);
  }
  const protectedCells = measure('protection aggregation', () => Array.from({ length: size }, (_, i) => (maps.protectionMap?.[i] ?? 0) >= 0.5 || (maps.tierMap?.[i] ?? 0) >= ProtectionTier.MEDIUM));
  measure('protection aggregation', () => { for (const entry of histogram.values()) for (const i of entry.cells) if (protectedCells[i]) entry.protectedCount++; });
  const labs = measure('RGB→Lab', () => new Map([...legal].map(([id, color]) => [id, rgbToLab(color.rgb)])));
  // Ordered identities deliberately retain the original floating-point direction.
  // Equal RGB identities still have separate entries and never imply a legal merge.
  const pairs = new Map();
  const metric = (from, to) => {
    let targets = pairs.get(from);
    if (!targets) { targets = new Map(); pairs.set(from, targets); }
    let value = targets.get(to);
    if (!value) {
      value = candidateCost(labs.get(from), labs.get(to), frozenLimits, profiler);
      value.signedDeltaL = measure('ΔL checks', () => labs.get(from)[0] - labs.get(to)[0]);
      targets.set(to, value);
    }
    return value;
  };
  const cache = { lab: cell => labs.get(paletteIdOf(cell)), metric: (a, b) => metric(paletteIdOf(a), paletteIdOf(b)) };
  const contrastReference = measure('local contrast evidence', () => buildLocalContrastReference(baseline, frozenLimits, profiler, cache));
  // Equivalent edges share identity endpoints and frozen protection status.
  // Retain every original edge and its order for exactly the same rejection details.
  const edgeGroups = [], edgeGroupIndices = new Uint32Array(contrastReference.edges.length);
  measure('local contrast evidence', () => {
    const index = new Map();
    for (let i = 0; i < contrastReference.edges.length; i++) {
      const edge = contrastReference.edges[i], ai = edge.y * width + edge.x, bi = edge.ny * width + edge.nx;
      const a = paletteIdOf(baseline[edge.y][edge.x]), b = paletteIdOf(baseline[edge.ny][edge.nx]);
      let byB = index.get(a); if (!byB) { byB = new Map(); index.set(a, byB); }
      let groups = byB.get(b); if (!groups) { groups = []; byB.set(b, groups); }
      const flags = (protectedCells[ai] ? 1 : 0) | (protectedCells[bi] ? 2 : 0);
      let groupIndex = groups[flags];
      if (groupIndex === undefined) {
        groupIndex = edgeGroups.length; groups[flags] = groupIndex;
        edgeGroups.push({ a, b, keepA: !!(flags & 1), keepB: !!(flags & 2), edge,
          minimum: Math.max(edge.contrast * frozenLimits.minContrastRatio, edge.contrast - frozenLimits.maxContrastLoss) });
      }
      edgeGroupIndices[i] = groupIndex;
    }
  });
  const validateMapping = map => {
    const failures = new Map();
    for (let i = 0; i < edgeGroups.length; i++) {
      const group = edgeGroups[i], pair = metric(group.keepA ? group.a : map.get(group.a), group.keepB ? group.b : map.get(group.b));
      const loss = pair.deltaE + 1e-9 < group.minimum;
      const order = Math.abs(group.edge.deltaL) >= frozenLimits.maxDeltaL && pair.signedDeltaL * group.edge.deltaL <= 0;
      if (loss || order) failures.set(i, { pair, loss, order, minimum: group.minimum });
    }
    const reasons = [];
    if (failures.size) for (let i = 0; i < contrastReference.edges.length; i++) {
      const failure = failures.get(edgeGroupIndices[i]); if (!failure) continue;
      const edge = contrastReference.edges[i];
      if (failure.loss) reasons.push({ code: 'LOCAL_CONTRAST_LOSS', ...edge, actualContrast: failure.pair.deltaE, minimumContrast: failure.minimum });
      if (failure.order) reasons.push({ code: 'LIGHTNESS_ORDER_CHANGED', ...edge, actualDeltaL: failure.pair.signedDeltaL });
    }
    return { valid: reasons.length === 0, reasons };
  };
  const colorCount = map => {
    const present = new Set();
    for (const [id, entry] of histogram) {
      if (entry.protectedCount) present.add(id);
      if (entry.count > entry.protectedCount) present.add(map.get(id));
    }
    return present.size;
  };
  const mapping = new Map(ids.map(id => [id, id])), members = new Map(ids.map(id => [id, new Set([id])])), steps = [], rejections = [];
  const candidates = [];
  measure('candidate generation', () => { for (const from of ids) for (const to of ids) if (from !== to) candidates.push({ from, to, ...metric(from, to) }); });
  measure('candidate sorting', () => candidates.sort((a, b) => a.cost - b.cost || compare(a.to, b.to) || compare(a.from, b.from)));
  let lastStrength = 0;
  measure('hierarchy construction', () => { for (const candidate of candidates) {
    const { from, to } = candidate;
    if (!members.has(from) || !members.has(to)) continue;
    const originals = new Set([...members.get(from), ...members.get(to)]);
    let cost = 0, rejection = null;
    const rgbIdentities = new Set();
    for (const id of [...originals].sort(compare)) {
      const rgbKey = legal.get(id).rgb.join(',');
      if (rgbIdentities.has(rgbKey)) { rejection = 'distinct-identity-identical-rgb'; break; }
      rgbIdentities.add(rgbKey);
    }
    if (rejection) { rejections.push({ from, to, reason: rejection }); continue; }
    for (const id of originals) {
      const source = legal.get(id), target = legal.get(to);
      if (id !== to && rgbEqual(source.rgb, target.rgb)) { rejection = 'distinct-identity-identical-rgb'; break; }
      const distance = measure('cluster validation', () => metric(id, to));
      cost = Math.max(cost, distance.cost);
      if (!Number.isFinite(distance.cost) || distance.cost > 1) { rejection = 'original-member-distance'; break; }
    }
    if (rejection) { rejections.push({ from, to, reason: rejection }); continue; }
    const next = new Map(mapping);
    for (const id of originals) next.set(id, to);
    const quality = measure('cluster validation', () => validateMapping(next));
    if (!quality.valid) { rejections.push({ from, to, reason: 'local-contrast', details: clone(quality.reasons) }); continue; }
    const before = measure('final validation', () => colorCount(mapping));
    const after = measure('final validation', () => colorCount(next));
    if (after > before) { rejections.push({ from, to, reason: 'color-count-increase' }); continue; }
    lastStrength = Math.max(lastStrength, 1, Math.ceil(cost * 100));
    mapping.clear(); for (const [id, target] of next) mapping.set(id, target);
    members.delete(from); members.set(to, originals);
    steps.push({ strength: lastStrength, from, to, members: [...originals].sort(compare), mapping: Object.fromEntries(mapping), finalColorCount: after, protectedColorRetained: after === before });
  } });
  const controller = measure('final validation', () => createEvaluationController({ baseline, legal, protectedCells, steps, rejections, ids, width, histogram }));
  profiler?.finish({ totalMs: performance.now() - totalStart, cellCount: size, nonNullCellCount: [...histogram.values()].reduce((n,entry)=>n+entry.count,0), uniquePaletteIdentityCount:ids.length, candidatePairCount:candidates.length, protectedCellCount:protectedCells.filter(Boolean).length, materializedBuildGrids: 0, localContrastGroupCount: edgeGroups.length, localContrastEdgeCount: contrastReference.edges.length, distancePairCount: [...pairs.values()].reduce((n,entry)=>n+entry.size,0) });
  return controller;
}

/** Cooperative equivalent of the synchronous builder. Input data must remain
 * stable until completion; production sessions use immutable baseline evidence.
 * Cancellation returns null and never publishes a partially built controller. */
export async function createSmartColorToleranceAsync({ baselineGrid, palette, protection, limits = {} } = {}, options = {}) {
  const scheduler = createToleranceBuildScheduler(options);
  const check = (stage, iterations = 1) => scheduler.checkpoint(stage, iterations);
  const cancel = () => { scheduler.finish('cancelled'); return null; };
  try {
    if (!Array.isArray(baselineGrid)) throw new TypeError('baselineGrid must be rectangular');
    const width = baselineGrid[0]?.length ?? 0;
    let visited = 0;
    for (let y = 0; y < baselineGrid.length; y++) {
      if (!Array.isArray(baselineGrid[y]) || baselineGrid[y].length !== width) throw new TypeError('baselineGrid must be rectangular');
      if (!(y in baselineGrid)) throw new TypeError('baselineGrid must not be sparse');
      for (let x = 0; x < width; x++) {
        if (!(x in baselineGrid[y])) throw new TypeError('baselineGrid rows must not be sparse');
        if (++visited % 256 === 0 && !await check('baseline validation', 256)) return cancel();
      }
    }
    if (!Array.isArray(palette)) throw new TypeError('palette must be an array');
    const baseline = await cloneToleranceSnapshotAsync(baselineGrid, { scheduler, stage: 'baseline snapshot' });
    if (baseline === null) return cancel();
    const paletteSnapshot = await cloneToleranceSnapshotAsync(palette, { scheduler, stage: 'palette context prep' });
    if (paletteSnapshot === null) return cancel();
    const legal = new Map();
    for (const color of paletteSnapshot) {
      const id = paletteIdOf(color);
      if (!id || !color.code || !rgbValid(color.rgb) || legal.has(id)) throw new TypeError('palette requires unique identities and valid code/rgb');
      legal.set(id, color);
      if (!await check('palette context prep')) return cancel();
    }
    const used = new Set(), histogram = new Map(); visited = 0;
    for (let y = 0; y < baseline.length; y++) for (let x = 0; x < width; x++) {
      const cell = baseline[y][x];
      if (cell !== null) {
        const id = paletteIdOf(cell), color = legal.get(id);
        if (!color || cell.code !== color.code || !rgbValid(cell.rgb) || !rgbEqual(cell.rgb, color.rgb) || (cell.paletteId ?? null) !== (color.paletteId ?? null)) throw new TypeError('baseline color must match legal palette identity/code/rgb');
        used.add(id);
        let entry = histogram.get(id);
        if (!entry) { entry = { count: 0, protectedCount: 0, cells: [] }; histogram.set(id, entry); }
        entry.count++; entry.cells.push(y * width + x);
      }
      if (++visited % 256 === 0 && !await check('histogram', 256)) return cancel();
    }
    const ids = [...used].sort(compare), frozenLimits = resolveToleranceLimits(clone(limits));
    const maps = protection ?? buildProtectionMap({ grid: baseline, width, height: baseline.length, sameCell: (a, b) => !!a && !!b && paletteIdOf(a) === paletteIdOf(b) });
    if (!maps || typeof maps !== 'object' || Array.isArray(maps) || (!maps.protectionMap && !maps.tierMap)) throw new TypeError('protection requires protectionMap or tierMap');
    const size = width * baseline.length;
    for (const key of ['protectionMap', 'tierMap']) if (maps[key] != null) {
      const values = maps[key];
      if (!Array.isArray(values) && !(ArrayBuffer.isView(values) && !(values instanceof DataView))) throw new TypeError(`${key} must be a numeric array`);
      if (values.length !== size) throw new TypeError(`${key} size mismatch`);
      for (let i = 0; i < values.length; i++) {
        const v = values[i];
        if (!Number.isFinite(v) || v < 0 || v > (key === 'tierMap' ? ProtectionTier.CRITICAL : 1) || (key === 'tierMap' && !Number.isInteger(v))) throw new TypeError(`${key} contains invalid values`);
        if ((i & 255) === 255 && !await check('protection checks', 256)) return cancel();
      }
    }
    const protectedCells = new Array(size);
    for (let i = 0; i < size; i++) {
      protectedCells[i] = (maps.protectionMap?.[i] ?? 0) >= 0.5 || (maps.tierMap?.[i] ?? 0) >= ProtectionTier.MEDIUM;
      if ((i & 255) === 255 && !await check('protection checks', 256)) return cancel();
    }
    visited = 0;
    for (const entry of histogram.values()) for (const i of entry.cells) {
      if (protectedCells[i]) entry.protectedCount++;
      if (++visited % 256 === 0 && !await check('protection checks', 256)) return cancel();
    }
    const labs = new Map();
    for (const [id, color] of legal) { labs.set(id, rgbToLab(color.rgb)); if (!await check('Lab / distance matrix')) return cancel(); }
    const pairs = new Map();
    const metric = (from, to) => {
      let targets = pairs.get(from);
      if (!targets) { targets = new Map(); pairs.set(from, targets); }
      let value = targets.get(to);
      if (!value) {
        value = candidateCost(labs.get(from), labs.get(to), frozenLimits);
        value.signedDeltaL = labs.get(from)[0] - labs.get(to)[0]; targets.set(to, value);
      }
      return value;
    };
    const edges = []; visited = 0;
    for (let y = 0; y < baseline.length; y++) for (let x = 0; x < width; x++) {
      const cell = baseline[y][x];
      if (cell !== null) for (const [dx, dy] of [[1, 0], [0, 1]]) {
        const nx = x + dx, ny = y + dy, neighbor = baseline[ny]?.[nx];
        if (!neighbor) continue;
        const pair = metric(paletteIdOf(cell), paletteIdOf(neighbor));
        if (pair.deltaE < frozenLimits.minBaselineContrast) continue;
        edges.push(Object.freeze({ x, y, nx, ny, contrast: pair.deltaE, deltaL: pair.signedDeltaL }));
      }
      if (++visited % 256 === 0 && !await check('contrast evidence', 256)) return cancel();
    }
    const edgeGroups = [], edgeGroupIndices = new Uint32Array(edges.length), index = new Map();
    for (let i = 0; i < edges.length; i++) {
      const edge = edges[i], ai = edge.y * width + edge.x, bi = edge.ny * width + edge.nx;
      const a = paletteIdOf(baseline[edge.y][edge.x]), b = paletteIdOf(baseline[edge.ny][edge.nx]);
      let byB = index.get(a); if (!byB) { byB = new Map(); index.set(a, byB); }
      let groups = byB.get(b); if (!groups) { groups = []; byB.set(b, groups); }
      const flags = (protectedCells[ai] ? 1 : 0) | (protectedCells[bi] ? 2 : 0);
      let groupIndex = groups[flags];
      if (groupIndex === undefined) {
        groupIndex = edgeGroups.length; groups[flags] = groupIndex;
        edgeGroups.push({ a, b, keepA: !!(flags & 1), keepB: !!(flags & 2), edge,
          minimum: Math.max(edge.contrast * frozenLimits.minContrastRatio, edge.contrast - frozenLimits.maxContrastLoss) });
      }
      edgeGroupIndices[i] = groupIndex;
      if ((i & 255) === 255 && !await check('contrast evidence', 256)) return cancel();
    }
    const validateMapping = async map => {
      const failures = new Map(), reasons = [];
      for (let i = 0; i < edgeGroups.length; i++) {
        const group = edgeGroups[i], pair = metric(group.keepA ? group.a : map.get(group.a), group.keepB ? group.b : map.get(group.b));
        const loss = pair.deltaE + 1e-9 < group.minimum;
        const order = Math.abs(group.edge.deltaL) >= frozenLimits.maxDeltaL && pair.signedDeltaL * group.edge.deltaL <= 0;
        if (loss || order) failures.set(i, { pair, loss, order, minimum: group.minimum });
        if ((i & 127) === 127 && !await check('candidate validation', 128)) return null;
      }
      if (failures.size) for (let i = 0; i < edges.length; i++) {
        const failure = failures.get(edgeGroupIndices[i]);
        if (failure) {
          const edge = edges[i];
          if (failure.loss) reasons.push({ code: 'LOCAL_CONTRAST_LOSS', ...edge, actualContrast: failure.pair.deltaE, minimumContrast: failure.minimum });
          if (failure.order) reasons.push({ code: 'LIGHTNESS_ORDER_CHANGED', ...edge, actualDeltaL: failure.pair.signedDeltaL });
        }
        if ((i & 255) === 255 && !await check('candidate validation', 256)) return null;
      }
      return { valid: reasons.length === 0, reasons };
    };
    const colorCount = map => {
      const present = new Set();
      for (const [id, entry] of histogram) {
        if (entry.protectedCount) present.add(id);
        if (entry.count > entry.protectedCount) present.add(map.get(id));
      }
      return present.size;
    };
    const mapping = new Map(ids.map(id => [id, id])), members = new Map(ids.map(id => [id, new Set([id])])), steps = [], rejections = [], candidates = [];
    for (const from of ids) for (const to of ids) if (from !== to) {
      candidates.push({ from, to, ...metric(from, to) });
      if (!await check('candidate construction')) return cancel();
    }
    if (!await stableSortToleranceAsync(candidates, (a, b) => a.cost - b.cost || compare(a.to, b.to) || compare(a.from, b.from), scheduler)) return cancel();
    let lastStrength = 0;
    for (const candidate of candidates) {
      if (!await check('hierarchy append')) return cancel();
      const { from, to } = candidate;
      if (!members.has(from) || !members.has(to)) continue;
      const originals = new Set([...members.get(from), ...members.get(to)]);
      let cost = 0, rejection = null;
      const rgbIdentities = new Set();
      for (const id of [...originals].sort(compare)) {
        const rgbKey = legal.get(id).rgb.join(',');
        if (rgbIdentities.has(rgbKey)) { rejection = 'distinct-identity-identical-rgb'; break; }
        rgbIdentities.add(rgbKey);
        if (!await check('cluster/member validation')) return cancel();
      }
      if (rejection) { rejections.push({ from, to, reason: rejection }); continue; }
      for (const id of originals) {
        const source = legal.get(id), target = legal.get(to);
        if (id !== to && rgbEqual(source.rgb, target.rgb)) { rejection = 'distinct-identity-identical-rgb'; break; }
        const distance = metric(id, to); cost = Math.max(cost, distance.cost);
        if (!Number.isFinite(distance.cost) || distance.cost > 1) { rejection = 'original-member-distance'; break; }
        if (!await check('cluster/member validation')) return cancel();
      }
      if (rejection) { rejections.push({ from, to, reason: rejection }); continue; }
      const next = new Map(mapping); for (const id of originals) next.set(id, to);
      const quality = await validateMapping(next);
      if (quality === null) return cancel();
      if (!quality.valid) {
        const details = await cloneToleranceSnapshotAsync(quality.reasons, { scheduler, stage: 'candidate validation' });
        if (details === null) return cancel();
        rejections.push({ from, to, reason: 'local-contrast', details }); continue;
      }
      const before = colorCount(mapping), after = colorCount(next);
      if (after > before) { rejections.push({ from, to, reason: 'color-count-increase' }); continue; }
      lastStrength = Math.max(lastStrength, 1, Math.ceil(cost * 100));
      mapping.clear(); for (const [id, target] of next) mapping.set(id, target);
      members.delete(from); members.set(to, originals);
      steps.push({ strength: lastStrength, from, to, members: [...originals].sort(compare), mapping: Object.fromEntries(mapping), finalColorCount: after, protectedColorRetained: after === before });
    }
    const controller = await createEvaluationControllerAsync({ baseline, legal, protectedCells, steps, rejections, ids, width, histogram }, scheduler);
    if (!controller || !scheduler.current()) return cancel();
    scheduler.finish(); return controller;
  } catch (error) { scheduler.finish('error'); throw error; }
}

async function stableSortToleranceAsync(values, comparator, scheduler) {
  let source = values.slice(), target = new Array(values.length), operations = 0;
  for (let run = 1; run < values.length; run *= 2) {
    for (let start = 0; start < values.length; start += run * 2) {
      const middle = Math.min(start + run, values.length), end = Math.min(start + run * 2, values.length);
      let a = start, b = middle;
      for (let i = start; i < end; i++) {
        target[i] = b >= end || a < middle && comparator(source[a], source[b]) <= 0 ? source[a++] : source[b++];
        if (++operations % 256 === 0 && !await scheduler.checkpoint('stable sort', 256)) return false;
      }
    }
    [source, target] = [target, source];
  }
  for (let i = 0; i < values.length; i++) {
    values[i] = source[i];
    if ((i & 255) === 255 && !await scheduler.checkpoint('stable sort', 256)) return false;
  }
  return scheduler.current();
}

// Fast copies are restricted to the already-snapshotted plain scalar/RGB shape.
// Rich metadata, cycles and aliases retain structuredClone's full semantics.
function cellCopier(cell) {
  if (Object.getPrototypeOf(cell) !== Object.prototype || Object.getPrototypeOf(cell.rgb) !== Array.prototype
      || Object.keys(cell.rgb).join(',') !== '0,1,2') return () => clone(cell);
  const keys = Object.keys(cell);
  if (keys.some(key => key === '__proto__' || key !== 'rgb' && cell[key] !== null && (typeof cell[key] === 'object' || typeof cell[key] === 'function' || typeof cell[key] === 'symbol'))) return () => clone(cell);
  return () => {
    const result = {};
    for (const key of keys) result[key] = key === 'rgb' ? [cell.rgb[0], cell.rgb[1], cell.rgb[2]] : cell[key];
    return result;
  };
}

function createEvaluationController({ baseline, legal, protectedCells, steps, rejections, ids, width, histogram }, prepared = null) {
  const entries = prepared?.entries ?? histogram ?? new Map(), protectedDescriptors = prepared?.protectedDescriptors ?? [], protectedOrder = prepared?.protectedOrder ?? new Map(), copies = new WeakMap();
  const indexedRows = prepared?.indexedRows ?? baseline.map((row, y) => row.map((cell, x) => {
    const i = y * width + x, id = paletteIdOf(cell);
    if (protectedCells[i]) protectedDescriptors.push({ x, y, paletteId: id });
    if (cell === null) return null;
    if (!histogram) {
      let entry = entries.get(id); if (!entry) { entry = { count: 0, protectedCount: 0 }; entries.set(id, entry); }
      entry.count++; if (protectedCells[i]) entry.protectedCount++;
    }
    if (protectedCells[i]) protectedOrder.set(id, (protectedOrder.get(id) ?? 0) + 1);
    if (!copies.has(cell)) copies.set(cell, cellCopier(cell));
    return { id, keep: protectedCells[i], copy: copies.get(cell) };
  }));
  const paletteCopies = new Map([...legal].map(([id, cell]) => [id, cellCopier(cell)]));
  const levels = [Object.fromEntries(ids.map(id => [id, id])), ...steps.map(step => step.mapping)].map(mapping => {
    const map = new Map(Object.entries(mapping)), present = new Set(), conflicts = [];
    for (const [id, entry] of entries) {
      if (entry.protectedCount) present.add(id);
      if (entry.count > entry.protectedCount) present.add(map.get(id));
    }
    for (const [id, retainedCells] of protectedOrder) if (map.get(id) !== id) conflicts.push({ reason: 'protected-color-retained', from: id, to: map.get(id), retainedCells });
    return { map, mapping, finalColorCount: present.size, conflicts };
  });
  const copyCell = (map, cell) => {
    if (cell === null) return null;
    const target = cell.keep ? cell.id : map.get(cell.id);
    return target === cell.id ? cell.copy() : paletteCopies.get(target)();
  };
  const render = map => indexedRows.map(row => row.map(cell => copyCell(map, cell)));
  // Tokens carry no grids or repeated per-strength evidence. Only this controller
  // can resolve them, so a plan from another baseline cannot be materialized.
  const plans = new WeakMap();
  const resolvePlan = plan => {
    const value = plans.get(plan);
    if (!value) throw new TypeError('plan must belong to this tolerance controller');
    return value;
  };
  const evaluatePlan = (strength = 0) => {
    if (!Number.isFinite(strength) || strength < 0 || strength > 100) throw new RangeError('strength must be 0..100');
    let low = 0, high = steps.length;
    while (low < high) { const mid = (low + high) >>> 1; if (steps[mid].strength <= strength) low = mid + 1; else high = mid; }
    const plan = Object.freeze({ strength });
    plans.set(plan, { level: levels[low], strength });
    return plan;
  };
  const statistics = (plan, includeProtectedCells = true) => {
    const { level, strength } = resolvePlan(plan), finalColorCount = level.finalColorCount;
    return { baselineColorCount: ids.length, finalColorCount, mergedColorCount: ids.length - finalColorCount,
      rejectedMergeCount: rejections.length, protectedConflictCount: level.conflicts.length,
      reasons: [...clone(rejections), ...clone(level.conflicts)], mapping: clone(level.mapping),
      ...(includeProtectedCells ? { protectedCells: clone(protectedDescriptors) } : {}), strength };
  };
  return Object.freeze({
    evaluate(strength = 0) {
      const plan = evaluatePlan(strength);
      return { grid: render(resolvePlan(plan).level.map), ...statistics(plan) };
    },
    evaluatePlan,
    getPlanStatistics: statistics,
    materialize(plan) { return render(resolvePlan(plan).level.map); },
    materializeAsync(plan, options = {}) {
      const { level } = resolvePlan(plan);
      return materializeToleranceChunks({ ...options, height: indexedRows.length, width,
        copyCell: (y, x) => copyCell(level.map, indexedRows[y][x]) });
    },
    getHierarchy() { return clone(steps); },
    getCompiledHierarchy() { return clone({ format: 'smart-tolerance-hierarchy-v1', ids, protectedCells, steps, rejections }); },
  });
}

async function createEvaluationControllerAsync(input, scheduler) {
  const { baseline, protectedCells, width, histogram } = input;
  const entries = histogram ?? new Map(), protectedDescriptors = [], protectedOrder = new Map(), copies = new WeakMap();
  const indexedRows = new Array(baseline.length);
  let visited = 0;
  for (let y = 0; y < baseline.length; y++) {
    const row = indexedRows[y] = new Array(width);
    for (let x = 0; x < width; x++) {
      const cell = baseline[y][x], i = y * width + x, id = paletteIdOf(cell);
      if (protectedCells[i]) protectedDescriptors.push({ x, y, paletteId: id });
      if (cell === null) row[x] = null;
      else {
        if (!histogram) {
          let entry = entries.get(id); if (!entry) { entry = { count: 0, protectedCount: 0 }; entries.set(id, entry); }
          entry.count++; if (protectedCells[i]) entry.protectedCount++;
        }
        if (protectedCells[i]) protectedOrder.set(id, (protectedOrder.get(id) ?? 0) + 1);
        if (!copies.has(cell)) copies.set(cell, cellCopier(cell));
        row[x] = { id, keep: protectedCells[i], copy: copies.get(cell) };
      }
      if (++visited % 128 === 0 && !await scheduler.checkpoint('controller preparation / final invariant validation', 128)) return null;
    }
  }
  if (!scheduler.current()) return null;
  return createEvaluationController(input, { entries, protectedDescriptors, protectedOrder, indexedRows });
}

/** Async trusted compiled-data restoration, with the same evidence checks. */
export async function restoreSmartColorToleranceAsync({ baselineGrid, palette, compiled } = {}, options = {}) {
  const scheduler = createToleranceBuildScheduler(options);
  const cancel = () => { scheduler.finish('cancelled'); return null; };
  try {
    if (compiled?.format !== 'smart-tolerance-hierarchy-v1') throw new TypeError('Unsupported compiled smart tolerance hierarchy');
    const baseline = await cloneToleranceSnapshotAsync(baselineGrid, { scheduler, stage: 'baseline snapshot' });
    if (baseline === null) return cancel();
    const data = await cloneToleranceSnapshotAsync(compiled, { scheduler, stage: 'compiled hierarchy snapshot' });
    if (data === null) return cancel();
    const paletteSnapshot = await cloneToleranceSnapshotAsync(palette, { scheduler, stage: 'palette context prep' });
    if (paletteSnapshot === null) return cancel();
    const width = baseline?.[0]?.length ?? 0;
    if (!Array.isArray(baseline) || baseline.some(row => !Array.isArray(row) || row.length !== width)) throw new TypeError('Invalid compiled baseline');
    const legal = new Map(paletteSnapshot.map(color => [paletteIdOf(color), color])), used = new Set();
    let visited = 0;
    for (const row of baseline) for (const cell of row) {
      if (cell) used.add(paletteIdOf(cell));
      if (++visited % 256 === 0 && !await scheduler.checkpoint('final invariant validation', 256)) return cancel();
    }
    if (!Array.isArray(data.ids) || data.ids.length !== used.size || data.ids.some(id => !used.has(id) || !legal.has(id))
      || !Array.isArray(data.protectedCells) || data.protectedCells.length !== baseline.length * width
      || !Array.isArray(data.steps) || !Array.isArray(data.rejections)) throw new TypeError('Invalid compiled hierarchy evidence');
    for (let i = 0; i < data.protectedCells.length; i++) {
      if (typeof data.protectedCells[i] !== 'boolean') throw new TypeError('Invalid compiled hierarchy evidence');
      if ((i & 255) === 255 && !await scheduler.checkpoint('final invariant validation', 256)) return cancel();
    }
    let strength = 0;
    for (const step of data.steps) {
      if (!Number.isFinite(step.strength) || step.strength < strength || step.strength > 100
        || !step.mapping || data.ids.some(id => !legal.has(step.mapping[id]))) throw new TypeError('Invalid compiled hierarchy mapping');
      strength = step.strength;
      if (!await scheduler.checkpoint('final invariant validation')) return cancel();
    }
    const controller = await createEvaluationControllerAsync({ baseline, legal, ...data, width }, scheduler);
    if (!controller || !scheduler.current()) return cancel();
    scheduler.finish(); return controller;
  } catch (error) { scheduler.finish('error'); throw error; }
}

/** Restore trusted internally-produced derived data. No protection, distance,
 * contrast or hierarchy analysis is repeated. This is not a project-import API. */
export function restoreSmartColorTolerance({ baselineGrid, palette, compiled } = {}) {
  if (compiled?.format !== 'smart-tolerance-hierarchy-v1') throw new TypeError('Unsupported compiled smart tolerance hierarchy');
  const baseline = clone(baselineGrid), data = clone(compiled);
  const width = baseline?.[0]?.length ?? 0;
  if (!Array.isArray(baseline) || baseline.some(row => !Array.isArray(row) || row.length !== width)) throw new TypeError('Invalid compiled baseline');
  const legal = new Map(clone(palette).map(color => [paletteIdOf(color), color]));
  const used = new Set(baseline.flat().filter(Boolean).map(paletteIdOf));
  if (!Array.isArray(data.ids) || data.ids.length !== used.size || data.ids.some(id => !used.has(id) || !legal.has(id))
    || !Array.isArray(data.protectedCells) || data.protectedCells.length !== baseline.length * width
    || data.protectedCells.some(value => typeof value !== 'boolean') || !Array.isArray(data.steps) || !Array.isArray(data.rejections)) throw new TypeError('Invalid compiled hierarchy evidence');
  let strength = 0;
  for (const step of data.steps) {
    if (!Number.isFinite(step.strength) || step.strength < strength || step.strength > 100
      || !step.mapping || data.ids.some(id => !legal.has(step.mapping[id]))) throw new TypeError('Invalid compiled hierarchy mapping');
    strength = step.strength;
  }
  return createEvaluationController({ baseline, legal, ...data, width });
}
