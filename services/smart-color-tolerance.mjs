import { paletteIdOf } from './palette-identity.js';
import { rgbToLab } from '../smart-preprocessing/palette-engine.mjs';
import { buildProtectionMap, ProtectionTier } from '../smart-preprocessing/detail-protection-v2.mjs';
import { candidateCost, resolveToleranceLimits, buildLocalContrastReference, validateContrastReference } from './smart-color-tolerance-quality.mjs';

const clone = value => structuredClone(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rgbValid = rgb => Array.isArray(rgb) && rgb.length === 3 && rgb.every(v => Number.isFinite(v) && v >= 0 && v <= 255);
const rgbEqual = (a, b) => a.every((v, i) => v === b[i]);

/** Experimental quality-first hierarchy; baseline must be captured after cleanup,
 * before budget. No generation, UI, export or hard color budget is invoked here. */
export function createSmartColorTolerance({ baselineGrid, palette, protection, limits = {} } = {}) {
  if (!Array.isArray(baselineGrid) || baselineGrid.some(row => !Array.isArray(row) || row.length !== (baselineGrid[0]?.length ?? 0))) throw new TypeError('baselineGrid must be rectangular');
  for (let y = 0; y < baselineGrid.length; y++) {
    if (!(y in baselineGrid)) throw new TypeError('baselineGrid must not be sparse');
    for (let x = 0; x < baselineGrid[y].length; x++) if (!(x in baselineGrid[y])) throw new TypeError('baselineGrid rows must not be sparse');
  }
  if (!Array.isArray(palette)) throw new TypeError('palette must be an array');
  const baseline = clone(baselineGrid), legal = new Map();
  for (const color of clone(palette)) {
    const id = paletteIdOf(color);
    if (!id || !color.code || !rgbValid(color.rgb) || legal.has(id)) throw new TypeError('palette requires unique identities and valid code/rgb');
    legal.set(id, color);
  }
  const used = new Set();
  for (const cell of baseline.flat()) {
    if (cell === null) continue;
    const id = paletteIdOf(cell), color = legal.get(id);
    if (!color || cell.code !== color.code || !rgbValid(cell.rgb) || !rgbEqual(cell.rgb, color.rgb) || (cell.paletteId ?? null) !== (color.paletteId ?? null)) throw new TypeError('baseline color must match legal palette identity/code/rgb');
    used.add(id);
  }
  const ids = [...used].sort(compare), width = baseline[0]?.length ?? 0;
  const frozenLimits = resolveToleranceLimits(clone(limits));
  const maps = protection ?? buildProtectionMap({ grid: baseline, width, height: baseline.length, sameCell: (a, b) => !!a && !!b && paletteIdOf(a) === paletteIdOf(b) });
  if (!maps || typeof maps !== 'object' || Array.isArray(maps) || (!maps.protectionMap && !maps.tierMap)) throw new TypeError('protection requires protectionMap or tierMap');
  const size = width * baseline.length;
  for (const key of ['protectionMap', 'tierMap']) if (maps[key] != null) {
    if (!Array.isArray(maps[key]) && !(ArrayBuffer.isView(maps[key]) && !(maps[key] instanceof DataView))) throw new TypeError(`${key} must be a numeric array`);
    if (maps[key].length !== size) throw new TypeError(`${key} size mismatch`);
    if (Array.from(maps[key]).some(v => !Number.isFinite(v) || v < 0 || v > (key === 'tierMap' ? ProtectionTier.CRITICAL : 1) || (key === 'tierMap' && !Number.isInteger(v)))) throw new TypeError(`${key} contains invalid values`);
  }
  const protectedCells = Array.from({ length: size }, (_, i) => (maps.protectionMap?.[i] ?? 0) >= 0.5 || (maps.tierMap?.[i] ?? 0) >= ProtectionTier.MEDIUM);
  const labs = new Map([...legal].map(([id, color]) => [id, rgbToLab(color.rgb)]));
  const contrastReference = buildLocalContrastReference(baseline, frozenLimits);
  const mapping = new Map(ids.map(id => [id, id])), members = new Map(ids.map(id => [id, new Set([id])])), steps = [], rejections = [];
  const render = map => baseline.map((row, y) => row.map((cell, x) => {
    if (cell === null) return null;
    const id = paletteIdOf(cell), target = protectedCells[y * width + x] ? id : map.get(id);
    return clone(target === id ? cell : legal.get(target));
  }));
  const candidates = [];
  for (const from of ids) for (const to of ids) if (from !== to) candidates.push({ from, to, ...candidateCost(labs.get(from), labs.get(to), frozenLimits) });
  candidates.sort((a, b) => a.cost - b.cost || compare(a.to, b.to) || compare(a.from, b.from));
  let lastStrength = 0;
  for (const candidate of candidates) {
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
      const metric = candidateCost(labs.get(id), labs.get(to), frozenLimits);
      cost = Math.max(cost, metric.cost);
      if (!Number.isFinite(metric.cost) || metric.cost > 1) { rejection = 'original-member-distance'; break; }
    }
    if (rejection) { rejections.push({ from, to, reason: rejection }); continue; }
    const next = new Map(mapping);
    for (const id of originals) next.set(id, to);
    const proposed = render(next);
    const quality = validateContrastReference(contrastReference, proposed);
    if (!quality.valid) { rejections.push({ from, to, reason: 'local-contrast', details: clone(quality.reasons) }); continue; }
    const before = new Set(render(mapping).flat().filter(Boolean).map(paletteIdOf)).size;
    const after = new Set(proposed.flat().filter(Boolean).map(paletteIdOf)).size;
    if (after > before) { rejections.push({ from, to, reason: 'color-count-increase' }); continue; }
    lastStrength = Math.max(lastStrength, 1, Math.ceil(cost * 100));
    mapping.clear(); for (const [id, target] of next) mapping.set(id, target);
    members.delete(from); members.set(to, originals);
    steps.push({ strength: lastStrength, from, to, members: [...originals].sort(compare), mapping: Object.fromEntries(mapping), finalColorCount: after, protectedColorRetained: after === before });
  }
  return createEvaluationController({ baseline, legal, protectedCells, steps, rejections, ids, width });
}

function createEvaluationController({ baseline, legal, protectedCells, steps, rejections, ids, width }) {
  const render = map => baseline.map((row, y) => row.map((cell, x) => {
    if (cell === null) return null;
    const id = paletteIdOf(cell), target = protectedCells[y * width + x] ? id : map.get(id);
    return clone(target === id ? cell : legal.get(target));
  }));
  return Object.freeze({
    evaluate(strength = 0) {
      if (!Number.isFinite(strength) || strength < 0 || strength > 100) throw new RangeError('strength must be 0..100');
      const prefix = steps.filter(step => step.strength <= strength);
      const map = prefix.length ? new Map(Object.entries(prefix.at(-1).mapping)) : new Map(ids.map(id => [id, id]));
      const grid = render(map), finalColorCount = new Set(grid.flat().filter(Boolean).map(paletteIdOf)).size;
      const protectedConflicts = new Map();
      protectedCells.forEach((keep, i) => {
        const cell = baseline[Math.floor(i / width)]?.[i % width];
        if (!keep || !cell) return;
        const id = paletteIdOf(cell), intendedTarget = map.get(id);
        if (intendedTarget === id) return;
        const conflict = protectedConflicts.get(id) ?? { reason: 'protected-color-retained', from: id, to: intendedTarget, retainedCells: 0 };
        conflict.retainedCells++;
        protectedConflicts.set(id, conflict);
      });
      return { grid, baselineColorCount: ids.length, finalColorCount, mergedColorCount: ids.length - finalColorCount,
        rejectedMergeCount: rejections.length, protectedConflictCount: protectedConflicts.size,
        reasons: [...clone(rejections), ...clone([...protectedConflicts.values()])],
        mapping: Object.fromEntries(map), protectedCells: protectedCells.flatMap((keep, i) => keep ? [{ x: i % width, y: Math.floor(i / width), paletteId: paletteIdOf(baseline[Math.floor(i / width)][i % width]) }] : []), strength };
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
