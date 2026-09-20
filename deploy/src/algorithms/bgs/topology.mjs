/**
 * BGS algorithm module — small line-art topology protection.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0).
 * Upstream: `smallLineArtRefinement` at src/app.js:1962–2373 (~410 lines).
 *
 * **This is the single most valuable asset in the upstream repository for libms**
 * (see ALGORITHM_AUDIT.md §J-1). libms has no equivalent: `stroke-mask.mjs` produces
 * a continuous *protection weight*, which is an orthogonal concern — it says "do not
 * clean this cell away", not "these two features must stay two features".
 *
 * The problem it solves: independent per-cell majority voting thickens thin lines and
 * merges features that were separate in the source, purely because the source raster
 * was finer than the target grid.
 *
 * The upstream answer, faithfully reproduced here:
 *
 *  1. remove only high-confidence uniform scan-edge artefacts;
 *  2. analyse the subject on an **intermediate raster independent of the final grid**
 *     (long side ≥192 px), so the projection is not the thing that merges features;
 *  3. label connected ink components **at source-pixel resolution** (`sourceOwners`);
 *  4. accumulate per-owner support for each target cell, keeping the top-N candidate
 *     cells per owner so a small feature can still claim a free cell;
 *  5. skeletonize with **Zhang–Suen** thinning, never treating all dark pixels as one
 *     component;
 *  6. resolve collisions while **protecting articulation cells** — a cell may only be
 *     removed if its owner stays connected without it;
 *  7. give an unclaimed tiny owner its best non-conflicting supported cell;
 *  8. report owners the grid genuinely cannot represent instead of inventing beads.
 *
 * Modified for libms-studio: pure functions, thresholds from config.js, no closure
 * state. Step 8's diagnostics are surfaced rather than discarded, because
 * "grid too small" and "algorithm failed" are different problems that upstream's
 * single `lineUnrepresentableComponents` counter conflates.
 */

import { BGS_CONFIG } from './config.mjs';

const TOPO = BGS_CONFIG.topology;

/* ─────────────────────────────────────────────────────────────
 * 1. 源像素级连通域标注
 * ───────────────────────────────────────────────────────────── */

/**
 * Label 8-connected components of "ink" pixels (dark and low-chroma).
 * Upstream src/app.js:1981–1997.
 *
 * Doing this at source resolution — rather than on the already-reduced micro grid —
 * is what keeps a nostril dot or an eyebrow from disappearing before refinement runs.
 */
export function labelSourceOwners({ raster, width, height, luminance, background, rasterCutoff }) {
  const count = width * height;
  const owners = new Int32Array(count);
  const queue = new Int32Array(count);
  const areaList = [0];
  let components = 0;

  for (let start = 0; start < count; start++) {
    if (owners[start] || background[start] || raster.data[start * 4 + 3] < BGS_CONFIG.background.transparentAlpha) continue;
    const p = start * 4;
    const chroma = Math.max(raster.data[p], raster.data[p + 1], raster.data[p + 2])
      - Math.min(raster.data[p], raster.data[p + 1], raster.data[p + 2]);
    if (chroma > TOPO.componentChromaMax || luminance[start] > rasterCutoff) continue;

    const owner = ++components;
    let head = 0;
    let tail = 0;
    let area = 0;
    owners[start] = owner;
    queue[tail++] = start;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = (current - x) / width;
      area++;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (owners[next] || background[next] || raster.data[next * 4 + 3] < BGS_CONFIG.background.transparentAlpha) continue;
          const np = next * 4;
          const nextChroma = Math.max(raster.data[np], raster.data[np + 1], raster.data[np + 2])
            - Math.min(raster.data[np], raster.data[np + 1], raster.data[np + 2]);
          if (nextChroma <= TOPO.componentChromaMax && luminance[next] <= rasterCutoff) {
            owners[next] = owner;
            queue[tail++] = next;
          }
        }
      }
    }
    areaList[owner] = area;
  }

  return { owners, ownerAreas: Int32Array.from(areaList), components };
}

/* ─────────────────────────────────────────────────────────────
 * 2. 中间栅格投影
 * ───────────────────────────────────────────────────────────── */

/**
 * Build the intermediate raster and project ink coverage onto it.
 * Upstream src/app.js:1978–2018.
 *
 * Fractional area intersection is used rather than dropping pixel centres into a
 * bucket: this is precisely why the same image supplied at 0.5×/2× pixel resolution
 * yields the same coverage, and therefore the same grid.
 */
export function buildMicroProjection({ owners, width, height, cols, rows, supersample }) {
  const microWidth = cols * supersample;
  const microHeight = rows * supersample;
  const microCount = microWidth * microHeight;
  const microTotal = new Float32Array(microCount);
  const microInk = new Float32Array(microCount);
  const microOwners = new Int32Array(microCount);
  const microOwnerVotes = new Float32Array(microCount);
  const microConflicts = new Map();

  for (let my = 0; my < microHeight; my++) {
    for (let mx = 0; mx < microWidth; mx++) {
      const micro = my * microWidth + mx;
      const sx0 = (mx * width) / microWidth;
      const sx1 = ((mx + 1) * width) / microWidth;
      const sy0 = (my * height) / microHeight;
      const sy1 = ((my + 1) * height) / microHeight;
      microTotal[micro] = (sx1 - sx0) * (sy1 - sy0);

      for (let y = Math.floor(sy0); y < Math.ceil(sy1); y++) {
        for (let x = Math.floor(sx0); x < Math.ceil(sx1); x++) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const area = Math.max(0, Math.min(x + 1, sx1) - Math.max(x, sx0))
            * Math.max(0, Math.min(y + 1, sy1) - Math.max(y, sy0));
          if (area <= 0) continue;
          const owner = owners[y * width + x];
          if (!owner) continue;
          microInk[micro] += area;

          const conflict = microConflicts.get(micro);
          if (conflict) conflict.set(owner, (conflict.get(owner) || 0) + area);
          else if (!microOwners[micro] || microOwners[micro] === owner) {
            microOwners[micro] = owner;
            microOwnerVotes[micro] += area;
          } else {
            microConflicts.set(micro, new Map([[microOwners[micro], microOwnerVotes[micro]], [owner, area]]));
          }
        }
      }
    }
  }

  return { microWidth, microHeight, microCount, microTotal, microInk, microOwners, microConflicts };
}

/** Resolve contested micro cells by vote count, tie-broken by owner area. */
export function resolveMicroOwners({ microOwners, microConflicts, ownerAreas }) {
  for (const [micro, votes] of microConflicts) {
    let bestOwner = 0;
    let bestVotes = -1;
    for (const [owner, vote] of votes) {
      if (vote > bestVotes
        || (vote === bestVotes && (ownerAreas[owner] || 0) > (ownerAreas[bestOwner] || 0))) {
        bestOwner = owner;
        bestVotes = vote;
      }
    }
    microOwners[micro] = bestOwner;
  }
  return microOwners;
}

/* ─────────────────────────────────────────────────────────────
 * 3. Zhang–Suen 细化
 * ───────────────────────────────────────────────────────────── */

/**
 * Zhang–Suen thinning on the micro raster.
 * Upstream src/app.js:2019–2039.
 *
 * The upstream comment states the point exactly: this preserves 8-connectivity along
 * curves while solid areas (an eye, say) are still kept by their area coverage, and it
 * does not inflate the anti-aliasing halo into a second ring of beads.
 *
 * @returns {{thinned: Uint8Array, rounds: number, hitRoundLimit: boolean}}
 */
export function thinMicro({ microInk, microTotal, microWidth, microHeight, inkCoverageThreshold = TOPO.inkCoverageThreshold }) {
  const microCount = microWidth * microHeight;
  const thinned = new Uint8Array(microCount);
  for (let i = 0; i < microCount; i++) {
    if (microTotal[i] && microInk[i] / microTotal[i] >= inkCoverageThreshold) thinned[i] = 1;
  }

  const pending = new Uint8Array(microCount);
  const neighbours = new Uint8Array(8);
  let changed = true;
  let rounds = 0;

  while (changed && rounds++ < TOPO.thinMaxRounds) {
    changed = false;
    for (let phase = 0; phase < 2; phase++) {
      pending.fill(0);
      for (let y = 1; y + 1 < microHeight; y++) {
        for (let x = 1; x + 1 < microWidth; x++) {
          const i = y * microWidth + x;
          if (!thinned[i]) continue;

          neighbours[0] = thinned[i - microWidth];       // P2 up
          neighbours[1] = thinned[i - microWidth + 1];   // P3 up-right
          neighbours[2] = thinned[i + 1];                // P4 right
          neighbours[3] = thinned[i + microWidth + 1];   // P5 down-right
          neighbours[4] = thinned[i + microWidth];       // P6 down
          neighbours[5] = thinned[i + microWidth - 1];   // P7 down-left
          neighbours[6] = thinned[i - 1];                // P8 left
          neighbours[7] = thinned[i - microWidth - 1];   // P9 up-left

          let count = 0;
          let transitions = 0;
          for (let n = 0; n < 8; n++) {
            count += neighbours[n];
            if (!neighbours[n] && neighbours[(n + 1) % 8]) transitions++;
          }
          if (count < 2 || count > 6 || transitions !== 1) continue;

          const first = phase === 0
            ? neighbours[0] * neighbours[2] * neighbours[4]
            : neighbours[0] * neighbours[2] * neighbours[6];
          const second = phase === 0
            ? neighbours[2] * neighbours[4] * neighbours[6]
            : neighbours[0] * neighbours[4] * neighbours[6];
          if (!first && !second) pending[i] = 1;
        }
      }
      for (let i = 0; i < microCount; i++) {
        if (pending[i]) { thinned[i] = 0; changed = true; }
      }
    }
  }

  return { thinned, rounds, hitRoundLimit: rounds >= TOPO.thinMaxRounds };
}

/* ─────────────────────────────────────────────────────────────
 * 4. 回投影到目标格
 * ───────────────────────────────────────────────────────────── */

/** Upstream src/app.js:2040–2062. */
export function projectToCells({
  microOwners, microInk, microConflicts, thinned,
  cols, rows, supersample, sourceWidth, sourceHeight, components, ownerAreas,
}) {
  const cellCount = cols * rows;
  const skeletonCells = new Uint8Array(cellCount);
  const ownerCells = new Int32Array(cellCount);
  const ownerCandidates = Array.from({ length: components + 1 }, () => []);
  const targetCellArea = Math.max(0.001, (sourceWidth / cols) * (sourceHeight / rows));

  for (let gy = 0; gy < rows; gy++) {
    for (let gx = 0; gx < cols; gx++) {
      const cell = gy * cols + gx;
      const skeletonVotes = new Map();
      const inkVotes = new Map();

      for (let my = gy * supersample; my < (gy + 1) * supersample; my++) {
        for (let mx = gx * supersample; mx < (gx + 1) * supersample; mx++) {
          const micro = my * (cols * supersample) + mx;
          const owner = microOwners[micro];
          if (!owner) continue;
          const splitVotes = microConflicts.get(micro);
          if (splitVotes) {
            for (const [candidateOwner, vote] of splitVotes) {
              inkVotes.set(candidateOwner, (inkVotes.get(candidateOwner) || 0) + vote);
            }
          } else {
            inkVotes.set(owner, (inkVotes.get(owner) || 0) + microInk[micro]);
          }
          if (thinned[micro]) skeletonVotes.set(owner, (skeletonVotes.get(owner) || 0) + 1);
        }
      }

      // Keep real coverage candidates for every owner, even when it loses the vote.
      // This is what lets a nostril dot or a mouth dot land a bead in a free cell.
      for (const [owner, vote] of inkVotes) {
        const candidates = ownerCandidates[owner];
        candidates.push({ cell, score: vote / targetCellArea });
        candidates.sort((a, b) => b.score - a.score || a.cell - b.cell);
        if (candidates.length > TOPO.candidatesPerOwner) candidates.length = TOPO.candidatesPerOwner;
      }

      const votes = skeletonVotes.size ? skeletonVotes : inkVotes;
      let bestOwner = 0;
      let bestVotes = -1;
      for (const [owner, vote] of votes) {
        if (vote > bestVotes
          || (vote === bestVotes
            && (ownerAreas?.[owner] || 0) > (ownerAreas?.[bestOwner] || 0))) {
          bestOwner = owner;
          bestVotes = vote;
        }
      }
      if (skeletonVotes.size) skeletonCells[cell] = 1;
      ownerCells[cell] = bestOwner;
    }
  }

  return { skeletonCells, ownerCells, ownerCandidates, targetCellArea };
}

/* ─────────────────────────────────────────────────────────────
 * 5./6./7. 归属、补位、冲突消解
 * ───────────────────────────────────────────────────────────── */

function ownerConnectedWithout({ active, ownerCells, cols, rows, ownerCounts, owner, removed, seen, queue, mark }) {
  const target = ownerCounts[owner] - 1;
  if (target < 1) return false;
  let start = -1;
  for (let i = 0; i < active.length; i++) {
    if (i !== removed && active[i] && ownerCells[i] === owner) { start = i; break; }
  }
  if (start < 0) return false;

  let head = 0;
  let tail = 0;
  let reached = 0;
  seen[start] = mark;
  queue[tail++] = start;
  while (head < tail) {
    const current = queue[head++];
    const x = current % cols;
    const y = (current - x) / cols;
    reached++;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (next !== removed && active[next] && ownerCells[next] === owner && seen[next] !== mark) {
          seen[next] = mark;
          queue[tail++] = next;
        }
      }
    }
  }
  return reached === target;
}

/**
 * Refine the raw grid using owner ownership.
 * Upstream src/app.js:2306–2373.
 *
 * @returns {{grid: Int32Array, active: Uint8Array, ownerCells: Int32Array, ownerCounts: Int32Array,
 *            separatedConflicts:number, unresolvedConflicts:number, unrepresentableComponents:number,
 *            forcedCandidatePlacements:number}}
 */
export function refineTopology({
  grid, cols, rows, components, ownerCells, skeletonCells, ownerCandidates, ownerAreas,
  lineCoreCoverage, lineSoftCoverage, lineBackgroundCoverage,
  matcher, outlinePosition, whitePosition,
}) {
  const cellCount = cols * rows;
  const active = new Uint8Array(cellCount);
  const ownerCounts = new Int32Array(components + 1);

  for (let cell = 0; cell < cellCount; cell++) {
    const core = lineCoreCoverage[cell];
    const soft = lineSoftCoverage[cell];
    const strongFill = core >= TOPO.strongFillCore
      || (core >= TOPO.strongFillCoreRelaxed && soft >= TOPO.strongFillSoft);
    if ((skeletonCells[cell] || strongFill) && ownerCells[cell] > 0) {
      active[cell] = 1;
      ownerCounts[ownerCells[cell]]++;
    }
  }

  // Unclaimed small owners: place one bead only where there is real ink support and no
  // risk of welding to another part. Otherwise report it honestly — do not invent beads.
  let forcedCandidatePlacements = 0;
  let unrepresentableComponents = 0;

  for (let owner = 1; owner <= components; owner++) {
    if (ownerCounts[owner]) continue;
    let best = -1;
    let bestScore = 0;
    let fallback = -1;
    let fallbackScore = 0;

    for (const candidate of ownerCandidates[owner] || []) {
      const cell = candidate.cell;
      if (active[cell]) continue;
      const x = cell % cols;
      const y = (cell - x) / cols;
      let conflict = false;
      for (let dy = -1; dy <= 1 && !conflict; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (active[next] && ownerCells[next] !== owner) { conflict = true; break; }
        }
      }
      if (candidate.score >= TOPO.minCandidateScore && candidate.score > fallbackScore) {
        fallback = cell;
        fallbackScore = candidate.score;
      }
      if (!conflict && candidate.score >= TOPO.minCandidateScore && candidate.score > bestScore) {
        best = cell;
        bestScore = candidate.score;
      }
    }

    const chosen = best >= 0 ? best : fallback;
    if (chosen >= 0) {
      ownerCells[chosen] = owner;
      active[chosen] = 1;
      ownerCounts[owner] = 1;
      if (best < 0) forcedCandidatePlacements++;
    } else {
      unrepresentableComponents++;
    }
  }

  // Where two source components end up 8-adjacent on the target grid, remove a cell
  // from the LARGER component's edge — but only if that component stays connected
  // without it. Single-cell details (an eyebrow, a nostril dot) are therefore never
  // the thing that gets sacrificed.
  const seen = new Uint32Array(cellCount);
  const queue = new Int32Array(cellCount);
  let seenMark = 0;
  let separatedConflicts = 0;
  let unresolvedConflicts = 0;

  for (let round = 0; round < active.length; round++) {
    let removal = -1;
    let removalScore = -Infinity;
    let conflicts = 0;
    const connectivityCache = new Map();

    for (let cell = 0; cell < active.length; cell++) {
      if (!active[cell]) continue;
      const x = cell % cols;
      const y = (cell - x) / cols;
      const owner = ownerCells[cell];
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (next <= cell || !active[next] || ownerCells[next] === owner) continue;
          conflicts++;

          for (const candidate of [cell, next]) {
            const candidateOwner = ownerCells[candidate];
            if (ownerCounts[candidateOwner] <= 1) continue;
            let connected = connectivityCache.get(candidate);
            if (connected === undefined) {
              seenMark++;
              connected = ownerConnectedWithout({
                active, ownerCells, cols, rows, ownerCounts,
                owner: candidateOwner, removed: candidate, seen, queue, mark: seenMark,
              });
              connectivityCache.set(candidate, connected);
            }
            if (!connected) continue;
            const score = ownerCounts[candidateOwner] * TOPO.conflictOwnerWeight
              - lineCoreCoverage[candidate] * TOPO.conflictCoverageWeight
              + (ownerAreas[candidateOwner] || 0) * TOPO.conflictAreaWeight;
            if (score > removalScore) { removal = candidate; removalScore = score; }
          }
        }
      }
    }

    if (!conflicts) break;
    if (removal < 0) { unresolvedConflicts = conflicts; break; }
    active[removal] = 0;
    ownerCounts[ownerCells[removal]]--;
    separatedConflicts++;
  }

  // Write the refined result back onto the grid.
  for (let cell = 0; cell < cellCount; cell++) {
    if (active[cell]) {
      grid[cell] = matcher.palette[outlinePosition].index;
      continue;
    }
    if (grid[cell] === matcher.palette[outlinePosition].index) {
      grid[cell] = lineBackgroundCoverage[cell] < TOPO.backgroundCoverageKeepBlank
        ? matcher.palette[whitePosition].index
        : -1;
    }
    if (!active[cell]
      && grid[cell] === matcher.palette[whitePosition].index
      && lineBackgroundCoverage[cell] >= TOPO.backgroundCoverageKeepBlank) {
      grid[cell] = -1;
    }
  }

  return {
    grid,
    active,
    ownerCells,
    ownerCounts,
    separatedConflicts,
    unresolvedConflicts,
    unrepresentableComponents,
    forcedCandidatePlacements,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 编排放
 * ───────────────────────────────────────────────────────────── */

/**
 * Full topology pass. Call after sampling, before cleanup / colour reduction.
 *
 * @param {object} args
 * @param {number[]} args.lineCoreCoverage  per-cell core ink coverage (0–1)
 * @param {number[]} args.lineSoftCoverage  per-cell soft ink coverage (0–1)
 * @param {number[]} args.lineBackgroundCoverage per-cell background coverage (0–1)
 */
export function applyTopologyProtection({
  grid, raster, width, height, cols, rows, luminance, background, rasterCutoff,
  lineCoreCoverage, lineSoftCoverage, lineBackgroundCoverage, matcher,
}) {
  const started = Date.now();
  const supersample = Math.max(TOPO.microSupersampleMin, Math.ceil(TOPO.microLongSide / Math.max(cols, rows)));

  const { owners, ownerAreas, components } = labelSourceOwners({
    raster, width, height, luminance, background, rasterCutoff,
  });

  if (!components) {
    return {
      grid,
      diagnostics: {
        applied: true, components: 0, supersample,
        microSize: { width: cols * supersample, height: rows * supersample },
        separatedConflicts: 0, unresolvedConflicts: 0,
        unrepresentableComponents: 0, forcedCandidatePlacements: 0,
        milliseconds: Date.now() - started,
      },
      active: null,
    };
  }

  const projection = buildMicroProjection({ owners, width, height, cols, rows, supersample });
  resolveMicroOwners({
    microOwners: projection.microOwners,
    microConflicts: projection.microConflicts,
    ownerAreas,
  });

  const { thinned, rounds, hitRoundLimit } = thinMicro({
    microInk: projection.microInk,
    microTotal: projection.microTotal,
    microWidth: projection.microWidth,
    microHeight: projection.microHeight,
  });

  const projected = projectToCells({
    microOwners: projection.microOwners,
    microInk: projection.microInk,
    microConflicts: projection.microConflicts,
    thinned,
    cols, rows, supersample, sourceWidth: width, sourceHeight: height, components, ownerAreas,
  });

  const refined = refineTopology({
    grid, cols, rows, components,
    ownerCells: projected.ownerCells,
    skeletonCells: projected.skeletonCells,
    ownerCandidates: projected.ownerCandidates,
    ownerAreas,
    lineCoreCoverage, lineSoftCoverage, lineBackgroundCoverage,
    matcher,
    outlinePosition: matcher.outlinePosition,
    whitePosition: matcher.whitePosition,
  });

  return {
    grid: refined.grid,
    active: refined.active,
    diagnostics: {
      applied: true,
      components,
      supersample,
      microSize: { width: projection.microWidth, height: projection.microHeight },
      thinningRounds: rounds,
      thinningHitRoundLimit: hitRoundLimit,
      totalInkPixels: owners.reduce((sum, value) => sum + (value ? 1 : 0), 0),
      separatedConflicts: refined.separatedConflicts,
      unresolvedConflicts: refined.unresolvedConflicts,
      unrepresentableComponents: refined.unrepresentableComponents,
      forcedCandidatePlacements: refined.forcedCandidatePlacements,
      ownersRepresented: refined.ownerCounts.reduce((sum, count) => sum + (count > 0 ? 1 : 0), 0),
      milliseconds: Date.now() - started,
    },
  };
}

export default {
  labelSourceOwners,
  buildMicroProjection,
  resolveMicroOwners,
  thinMicro,
  projectToCells,
  refineTopology,
  applyTopologyProtection,
};
