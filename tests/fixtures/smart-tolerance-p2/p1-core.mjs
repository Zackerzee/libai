// Immutable P2 oracle: exact P1 BASE source, only relative imports relocated.
// BASE b52a80b99e98b6d3859cf7a556401e580fe85622 (services/smart-color-tolerance.mjs).
import { paletteIdOf } from '../../../services/palette-identity.js';
import { rgbToLab } from '../../../smart-preprocessing/palette-engine.mjs';
import { buildProtectionMap, ProtectionTier } from '../../../smart-preprocessing/detail-protection-v2.mjs';
import { candidateCost, resolveToleranceLimits, buildLocalContrastReference } from '../../../services/smart-color-tolerance-quality.mjs';
import { createToleranceProfiler } from '../../../services/smart-color-tolerance-perf.mjs';

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

function createEvaluationController({ baseline, legal, protectedCells, steps, rejections, ids, width, histogram }) {
  const entries = histogram ?? new Map(), protectedDescriptors = [], protectedOrder = new Map(), copies = new WeakMap();
  const indexedRows = baseline.map((row, y) => row.map((cell, x) => {
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
  const render = map => indexedRows.map(row => row.map(cell => {
    if (cell === null) return null;
    const target = cell.keep ? cell.id : map.get(cell.id);
    return target === cell.id ? cell.copy() : paletteCopies.get(target)();
  }));
  return Object.freeze({
    evaluate(strength = 0) {
      if (!Number.isFinite(strength) || strength < 0 || strength > 100) throw new RangeError('strength must be 0..100');
      let low = 0, high = steps.length;
      while (low < high) { const mid = (low + high) >>> 1; if (steps[mid].strength <= strength) low = mid + 1; else high = mid; }
      const level = levels[low], grid = render(level.map), finalColorCount = level.finalColorCount;
      return { grid, baselineColorCount: ids.length, finalColorCount, mergedColorCount: ids.length - finalColorCount,
        rejectedMergeCount: rejections.length, protectedConflictCount: level.conflicts.length,
        reasons: [...clone(rejections), ...clone(level.conflicts)],
        mapping: clone(level.mapping), protectedCells: clone(protectedDescriptors), strength };
    },
    getHierarchy() { return clone(steps); },
    getCompiledHierarchy() { return clone({ format: 'smart-tolerance-hierarchy-v1', ids, protectedCells, steps, rejections }); },
  });
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
