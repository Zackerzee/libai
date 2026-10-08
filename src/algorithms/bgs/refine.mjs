/**
 * BGS algorithm module — post-sampling refinement: noise cleanup, anchor detection,
 * similar-colour merging and the maximum-colour limit.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0):
 *   - cartoon 1–2 cell noise cleanup   src/app.js:2402–2429
 *   - anchor detection                 src/app.js:2451–2471
 *   - `mergeStrength` merging           src/app.js:2473–2493
 *   - `maxColors` reduction             src/app.js:2495–2515
 *
 * Modified for libms-studio:
 *  - pure functions, thresholds from config.js;
 *  - the cleanup neighbour margin is exposed (`cleanupStrength`) instead of being
 *    hard-wired to a condition that rarely fires (ALGORITHM_AUDIT.md §K-3).
 */

import { BGS_CONFIG } from './config.mjs';
import { oklabDistance, oklabChroma } from './color-space.mjs';

/* ─────────────────────────────────────────────────────────────
 * 计数工具
 * ───────────────────────────────────────────────────────────── */

/** Count cells per palette index and accumulate importance mass. */
export function countCells(grid, importance = null) {
  const counts = new Map();
  const importanceMass = new Map();
  for (let i = 0; i < grid.length; i++) {
    const value = grid[i];
    if (value < 0) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
    importanceMass.set(value, (importanceMass.get(value) || 0) + (importance ? importance[i] : 1));
  }
  return { counts, importanceMass };
}

/* ─────────────────────────────────────────────────────────────
 * 杂色 / 孤立像素清理
 * ───────────────────────────────────────────────────────────── */

/**
 * Assimilate 1–2 cell chromatic specks that no neighbour votes for.
 * Upstream src/app.js:2402–2429.
 *
 * Upstream never touches a component larger than 2 cells, requires the cell support
 * to be below 0.42, AND requires `bestCount >= component.length + 2`. The last
 * condition makes most real edge noise survive, so `neighborMargin` is exposed:
 * `cleanupStrength` maps onto it, with `0` reproducing upstream exactly.
 *
 * Greyscale detail is deliberately excluded (`chroma < 0.075`): a lone grey pixel is
 * usually a real highlight or a shadow, not noise.
 */
export function cleanupSpeckles({
  grid, cols, rows, support, matcher, paletteLength,
  cleanupStrength = 0.5,
  maxComponentSize = BGS_CONFIG.cleanup.maxComponentSize,
}) {
  const cfg = BGS_CONFIG.cleanup;
  const snapshot = Int32Array.from(grid);
  const visited = new Uint8Array(snapshot.length);
  let cleaned = 0;
  const records = [];

  // cleanupStrength 0 → upstream's `+2`; 1 → `0` (aggressive but still neighbour-justified).
  const requiredMargin = Math.round((1 - Math.min(1, Math.max(0, cleanupStrength))) * cfg.neighborMargin);

  for (let cell = 0; cell < snapshot.length; cell++) {
    const index = snapshot[cell];
    if (index < 0 || visited[cell]) continue;
    const entry = matcher.entryOf(index);
    const lab = entry?.lab;
    if (!lab || oklabChroma(lab) < cfg.chromaticChromaMin) continue;

    const component = [];
    const stack = [cell];
    visited[cell] = 1;
    while (stack.length) {
      const current = stack.pop();
      const x = current % cols;
      const y = (current - x) / cols;
      component.push(current);
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (!visited[next] && snapshot[next] === index) {
            visited[next] = 1;
            stack.push(next);
          }
        }
      }
    }

    if (component.length > maxComponentSize) continue;
    if (component.some((position) => support[position] >= cfg.supportVeto)) continue;

    const neighbours = new Map();
    for (const position of component) {
      const x = position % cols;
      const y = (position - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const neighbour = snapshot[ny * cols + nx];
          if (neighbour >= 0 && neighbour !== index) {
            neighbours.set(neighbour, (neighbours.get(neighbour) || 0) + 1);
          }
        }
      }
    }

    let replacement = -1;
    let bestCount = 0;
    for (const [candidate, count] of neighbours) {
      if (count > bestCount || (count === bestCount && (replacement < 0 || candidate < replacement))) {
        replacement = candidate;
        bestCount = count;
      }
    }
    if (replacement >= 0 && bestCount >= component.length + requiredMargin) {
      for (const position of component) grid[position] = replacement;
      cleaned += component.length;
      records.push({ cells: component.slice(), from: index, to: replacement, neighbourVotes: bestCount });
    }
  }

  return { grid, cleaned, records, requiredMargin, paletteLength };
}

/* ─────────────────────────────────────────────────────────────
 * 锚点保护
 * ───────────────────────────────────────────────────────────── */

/**
 * Pick protected anchors.
 * Upstream src/app.js:2451–2471.
 *
 * Two families:
 *  - **neutral anchors**: the darkest and the lightest surviving neutral colour, so
 *    black outlines and white highlights never lose to a larger pastel area;
 *  - **chromatic anchors**: up to three vivid colours whose hues are at least 0.55 rad
 *    apart around the ring, ranked by `chroma × log2(count+2)`. This is what keeps an
 *    eye, a flower centre or a logo accent alive when the colour limit bites.
 */
export function detectAnchors({ counts, matcher }) {
  const cfg = BGS_CONFIG.anchors;
  const anchors = new Set();
  const neutralAnchors = [];
  const chromaticAnchors = [];
  const diagnostics = { neutralCandidates: 0, chromaticCandidates: 0, hueGaps: [] };

  const activeKeys = Array.from(counts.keys()).sort((a, b) => a - b);
  if (!activeKeys.length) {
    return { anchors, neutralAnchors, chromaticAnchors, diagnostics };
  }

  const chromaticOf = (index) => matcher.isChromaticIndex(index);
  const labOf = (index) => matcher.labOf(index);

  const neutrals = activeKeys.filter((index) => !chromaticOf(index));
  diagnostics.neutralCandidates = neutrals.length;
  if (neutrals.length) {
    const darkest = neutrals.reduce((a, b) => (labOf(a)[0] <= labOf(b)[0] ? a : b));
    const lightest = neutrals.reduce((a, b) => (labOf(a)[0] >= labOf(b)[0] ? a : b));
    neutralAnchors.push(darkest, lightest);
    anchors.add(darkest);
    anchors.add(lightest);
  }

  const saturated = activeKeys
    .filter((index) => chromaticOf(index))
    .sort((a, b) => {
      const sa = oklabChroma(labOf(a)) * Math.log2((counts.get(a) || 0) + 2);
      const sb = oklabChroma(labOf(b)) * Math.log2((counts.get(b) || 0) + 2);
      return sb - sa || a - b;
    });
  diagnostics.chromaticCandidates = saturated.length;

  const hues = [];
  for (const index of saturated) {
    const lab = labOf(index);
    const hue = Math.atan2(lab[2], lab[1]);
    const minGap = hues.reduce((min, old) => {
      const delta = Math.abs(Math.atan2(Math.sin(hue - old), Math.cos(hue - old)));
      return Math.min(min, delta);
    }, Infinity);
    if (minGap > cfg.saturatedHueMinGap) {
      anchors.add(index);
      hues.push(hue);
      chromaticAnchors.push(index);
      diagnostics.hueGaps.push(Number.isFinite(minGap) ? minGap : null);
      if (hues.length >= cfg.saturatedCountMax) break;
    }
  }

  return { anchors, neutralAnchors, chromaticAnchors, diagnostics };
}

/* ─────────────────────────────────────────────────────────────
 * 相近色合并
 * ───────────────────────────────────────────────────────────── */

// The matcher exposes O(1) lookups addressed by palette `index`; the grid stores that
// index, not the array position, so these must not be conflated.
const labOfIndex = (matcher, index) => matcher.labOf(index);
const isChromaticIndex = (matcher, index) => matcher.isChromaticIndex(index);

/** `colorPriority` — how much a colour "deserves" to survive. Upstream src/app.js:2440–2443. */
export function colorPriority({ index, counts, importanceMass, matcher }) {
  const cfg = BGS_CONFIG.merge;
  const lab = labOfIndex(matcher, index);
  const count = counts.get(index) || 0;
  const chroma = oklabChroma(lab);
  return count * (1
    + cfg.priorityChromaGain * chroma
    + (lab[0] < cfg.darkLightnessThreshold ? cfg.priorityDarkBonus : 0)
    + (lab[0] > cfg.brightLightnessThreshold ? cfg.priorityBrightBonus : 0))
    + cfg.priorityImportanceGain * (importanceMass.get(index) || 0);
}

function applyMerge({ grid, counts, importanceMass, from, to }) {
  if (from === to || !counts.has(from) || !counts.has(to)) return 0;
  let moved = 0;
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === from) { grid[i] = to; moved++; }
  }
  counts.set(to, (counts.get(to) || 0) + (counts.get(from) || 0));
  counts.delete(from);
  importanceMass.set(to, (importanceMass.get(to) || 0) + (importanceMass.get(from) || 0));
  importanceMass.delete(from);
  return moved;
}

/**
 * Merge perceptually close colours while a merge budget lasts.
 * Upstream src/app.js:2473–2493.
 *
 * Two invariants from upstream worth keeping:
 *  - a chromatic colour is never merged into a neutral one (or vice versa), so
 *    greys do not steal saturation and saturated colours do not grey out;
 *  - two anchors are never merged into each other.
 */
export function mergeSimilarColors({ grid, counts, importanceMass, matcher, anchors, mergeStrength }) {
  const cfg = BGS_CONFIG.merge;
  const threshold = Math.max(0, Math.min(cfg.strengthMax, mergeStrength)) / cfg.strengthDivisor;
  const plan = [];
  if (threshold <= 0) return { plan, movedCells: 0 };

  let movedCells = 0;
  for (let guard = 0; guard < 4096; guard++) {
    const active = Array.from(counts.keys()).sort((a, b) => a - b);
    let bestPair = null;
    let bestDistance = Infinity;

    for (let i = 0; i < active.length; i++) {
      for (let j = i + 1; j < active.length; j++) {
        const a = active[i];
        const b = active[j];
        if (isChromaticIndex(matcher, a) !== isChromaticIndex(matcher, b)) continue;
        const distance = oklabDistance(labOfIndex(matcher, a), labOfIndex(matcher, b));
        if (distance >= threshold) continue;
        if (anchors.has(a) && anchors.has(b)) continue;
        if (distance < bestDistance - 1e-12) { bestDistance = distance; bestPair = [a, b]; }
      }
    }
    if (!bestPair) break;

    const [a, b] = bestPair;
    let from;
    let to;
    if (anchors.has(a)) { from = b; to = a; }
    else if (anchors.has(b)) { from = a; to = b; }
    else if (colorPriority({ index: a, counts, importanceMass, matcher }) <= colorPriority({ index: b, counts, importanceMass, matcher })) {
      from = a; to = b;
    } else { from = b; to = a; }

    movedCells += applyMerge({ grid, counts, importanceMass, from, to });
    plan.push({ from, to, distance: bestDistance, reason: 'merge-strength' });
  }

  return { plan, movedCells, threshold };
}

/* ─────────────────────────────────────────────────────────────
 * 最大色数
 * ───────────────────────────────────────────────────────────── */

/**
 * Reduce to `maxColors` by repeatedly folding the least valuable colour into its
 * nearest same-family neighbour.
 * Upstream src/app.js:2495–2515.
 *
 * `loss = count × d² × (0.7 + avgImportance)` — a rare colour that is also far away
 * costs more to lose. Anchors get a ×40 multiplier so they are only sacrificed when
 * nothing else remains, and the whole loss is scaled by chroma so saturated colours
 * survive longer than muddy ones.
 */
export function limitColors({ grid, counts, importanceMass, matcher, anchors, maxColors, paletteLength }) {
  const cfg = BGS_CONFIG.merge;
  const limit = Math.max(1, Math.min(Math.round(maxColors) || 1, paletteLength, grid.length));
  const plan = [];
  let forcedAnchorMerges = 0;

  while (counts.size > limit) {
    const active = Array.from(counts.keys()).sort((a, b) => a - b);
    let remove = -1;
    let target = -1;
    let bestLoss = Infinity;

    for (const candidate of active) {
      let nearest = -1;
      let nearestDistance = Infinity;
      for (const other of active) {
        if (other === candidate) continue;
        if (isChromaticIndex(matcher, candidate) !== isChromaticIndex(matcher, other)) continue;
        const distance = oklabDistance(labOfIndex(matcher, candidate), labOfIndex(matcher, other));
        if (distance < nearestDistance - 1e-12
          || (Math.abs(distance - nearestDistance) < 1e-12 && other < nearest)) {
          nearestDistance = distance;
          nearest = other;
        }
      }
      if (nearest < 0) continue;

      const count = counts.get(candidate) || 0;
      const avgImportance = (importanceMass.get(candidate) || count) / Math.max(1, count);
      let loss = count * nearestDistance * nearestDistance * (cfg.limitImportanceBase + avgImportance);
      const protectedByAnchor = anchors.has(candidate);
      if (protectedByAnchor) loss *= cfg.limitAnchorLossMultiplier;
      loss *= 1 + cfg.limitChromaPenalty * oklabChroma(labOfIndex(matcher, candidate));

      if (loss < bestLoss - 1e-12 || (Math.abs(loss - bestLoss) < 1e-12 && (remove < 0 || candidate < remove))) {
        bestLoss = loss;
        remove = candidate;
        target = nearest;
      }
    }

    if (remove < 0 || target < 0) break;
    const protectedByAnchor = anchors.has(remove);
    const moved = applyMerge({ grid, counts, importanceMass, from: remove, to: target });
    if (protectedByAnchor) forcedAnchorMerges++;
    plan.push({ from: remove, to: target, loss: bestLoss, protectedByAnchor, movedCells: moved, reason: 'max-colors' });
  }

  return { plan, limit, forcedAnchorMerges, reached: counts.size <= limit };
}

export default {
  countCells,
  cleanupSpeckles,
  detectAnchors,
  colorPriority,
  mergeSimilarColors,
  limitColors,
};
