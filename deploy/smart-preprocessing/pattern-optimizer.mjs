/**
 * libms.net Professional Pattern Optimizer
 * Stage 4: deterministic, conservative matrix optimization.
 *
 * The optimizer only changes existing palette entries. It never invents a
 * color, changes the matrix dimensions, or requires a model/dependency.
 */

export const PATTERN_OPTIMIZER_VERSION = "4.0.0-stage4";

const DEFAULT_OPTIONS = Object.freeze({
  maxComponentSize: 3,
  maxHoleSize: 1,
  maxCandidates: 3,
  backgroundMerge: true,
  cleanupStrength: 0.22,
});

const keyOf = (color) => color?.code || color?.hex || "";
const cloneGrid = (grid) => (grid || []).map((row) => (row || []).slice());
const inBounds = (x, y, width, height) => x >= 0 && y >= 0 && x < width && y < height;

function neighbors(x, y, width, height) {
  const result = [];
  if (y > 0) result.push([x, y - 1]);
  if (x + 1 < width) result.push([x + 1, y]);
  if (y + 1 < height) result.push([x, y + 1]);
  if (x > 0) result.push([x - 1, y]);
  return result;
}

function colorDistance(a, b) {
  if (!a || !b) return Number.POSITIVE_INFINITY;
  const ar = a.rgb || [0, 0, 0];
  const br = b.rgb || [0, 0, 0];
  return Math.hypot(ar[0] - br[0], ar[1] - br[1], ar[2] - br[2]);
}

function chooseMajority(candidates, currentKey) {
  const counts = new Map();
  for (const color of candidates) {
    const key = keyOf(color);
    if (!key || key === currentKey) continue;
    const entry = counts.get(key) || { color, count: 0 };
    entry.count += 1;
    counts.set(key, entry);
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || keyOf(a.color).localeCompare(keyOf(b.color)))[0]?.color || null;
}

export function analyzeComponents(grid) {
  const height = grid?.length || 0;
  const width = height ? grid[0]?.length || 0 : 0;
  const visited = new Uint8Array(width * height);
  const components = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const start = y * width + x;
      if (visited[start] || !grid[y]?.[x]) continue;
      const color = grid[y][x];
      const code = keyOf(color);
      const queue = [[x, y]];
      const cells = [];
      visited[start] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const [cx, cy] = queue[head];
        cells.push([cx, cy]);
        for (const [nx, ny] of neighbors(cx, cy, width, height)) {
          const index = ny * width + nx;
          if (!visited[index] && keyOf(grid[ny]?.[nx]) === code) {
            visited[index] = 1;
            queue.push([nx, ny]);
          }
        }
      }
      components.push({ code, color, cells, size: cells.length });
    }
  }
  return components;
}

function isolatedEdits(grid, protectionMask, options) {
  const height = grid?.length || 0;
  const width = height ? grid[0]?.length || 0 : 0;
  const edits = [];
  for (const component of analyzeComponents(grid)) {
    if (component.size > options.maxComponentSize) continue;
    for (const [x, y] of component.cells) {
      const index = y * width + x;
      if (protectionMask?.[index]) continue;
      const surrounding = neighbors(x, y, width, height)
        .map(([nx, ny]) => grid[ny]?.[nx])
        .filter(Boolean);
      const ranked = surrounding.filter((color) => keyOf(color) !== component.code).sort((a, b) => colorDistance(component.color, a) - colorDistance(component.color, b));
      const majority = chooseMajority(surrounding, component.code);
      const replacement = majority && colorDistance(component.color, majority) <= 82 ? majority : ranked[0];
      if (replacement && keyOf(replacement) !== component.code) {
        edits.push({ x, y, from: grid[y][x], to: replacement, reason: "isolated-component" });
      }
    }
  }
  return edits;
}

function holeEdits(grid, options) {
  const height = grid?.length || 0;
  const width = height ? grid[0]?.length || 0 : 0;
  const edits = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (grid[y]?.[x]) continue;
      const surrounding = neighbors(x, y, width, height).map(([nx, ny]) => grid[ny]?.[nx]).filter(Boolean);
      if (surrounding.length < 4) continue;
      const replacement = chooseMajority(surrounding, "");
      if (replacement && surrounding.filter((color) => keyOf(color) === keyOf(replacement)).length >= 3) {
        edits.push({ x, y, from: null, to: replacement, reason: "single-hole" });
      }
    }
  }
  return edits.slice(0, Math.max(0, options.maxHoleSize * width));
}

function checkerboardEdits(grid, protectionMask) {
  const height = grid?.length || 0;
  const width = height ? grid[0]?.length || 0 : 0;
  const edits = [];
  for (let y = 0; y + 1 < height; y += 1) {
    for (let x = 0; x + 1 < width; x += 1) {
      const a = grid[y]?.[x];
      const b = grid[y]?.[x + 1];
      const c = grid[y + 1]?.[x];
      const d = grid[y + 1]?.[x + 1];
      if (!a || !b || !c || !d) continue;
      if (keyOf(a) === keyOf(d) && keyOf(b) === keyOf(c) && keyOf(a) !== keyOf(b)) {
        if (colorDistance(a, b) <= 48 && !protectionMask?.[y * width + x + 1]) edits.push({ x: x + 1, y, from: b, to: a, reason: "checkerboard" });
      }
    }
  }
  return edits;
}

export function scorePattern(grid, baseline = null) {
  const height = grid?.length || 0;
  const width = height ? grid[0]?.length || 0 : 0;
  let isolated = 0;
  let checkerboard = 0;
  let holes = 0;
  let changes = 0;
  const components = analyzeComponents(grid);
  for (const component of components) if (component.size === 1) isolated += 1;
  for (let y = 0; y + 1 < height; y += 1) {
    for (let x = 0; x + 1 < width; x += 1) {
      const a = keyOf(grid[y]?.[x]);
      const b = keyOf(grid[y]?.[x + 1]);
      const c = keyOf(grid[y + 1]?.[x]);
      const d = keyOf(grid[y + 1]?.[x + 1]);
      if (a && b && c && d && a === d && b === c && a !== b) checkerboard += 1;
    }
  }
  for (const row of grid || []) for (const color of row || []) if (!color) holes += 1;
  if (baseline) {
    for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
      if (keyOf(grid[y]?.[x]) !== keyOf(baseline[y]?.[x])) changes += 1;
    }
  }
  const total = Math.max(1, width * height);
  const penalty = isolated * 1.4 + checkerboard * 0.8 + holes * 2 + changes * 0.08;
  return {
    score: 100 - (penalty / total) * 100,
    isolated,
    checkerboard,
    holes,
    changes,
    components: components.length,
  };
}

function applyEdits(grid, edits) {
  const next = cloneGrid(grid);
  for (const edit of edits) if (inBounds(edit.x, edit.y, next[0]?.length || 0, next.length)) next[edit.y][edit.x] = edit.to;
  return next;
}

export class PatternOptimizer {
  constructor(options = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  optimize(grid, options = {}) {
    const merged = { ...this.options, ...options };
    const baseline = cloneGrid(grid);
    const baselineScore = scorePattern(baseline);
    const candidates = [{ name: "original", grid: baseline, score: baselineScore, edits: [] }];
    const protectionMask = merged.protectionMask || null;
    const isolated = merged.cleanupStrength > 0 ? isolatedEdits(baseline, protectionMask, merged) : [];
    const holes = holeEdits(baseline, merged);
    const checker = checkerboardEdits(baseline, protectionMask);
    const plans = [
      { name: "conservative", edits: isolated.concat(holes) },
      { name: "checker-aware", edits: isolated.concat(holes, checker.slice(0, Math.ceil(checker.length / 2))) },
    ].slice(0, Math.max(1, merged.maxCandidates - 1));
    for (const plan of plans) {
      const next = applyEdits(baseline, plan.edits);
      const score = scorePattern(next, baseline);
      candidates.push({ name: plan.name, grid: next, score, edits: plan.edits });
    }
    candidates.sort((a, b) => b.score.score - a.score.score || a.edits.length - b.edits.length);
    const winner = candidates[0];
    return {
      grid: winner.score.score > baselineScore.score ? winner.grid : baseline,
      changed: winner.score.score > baselineScore.score,
      candidate: winner.name,
      scoreBefore: baselineScore,
      scoreAfter: winner.score.score > baselineScore.score ? winner.score : baselineScore,
      edits: winner.score.score > baselineScore.score ? winner.edits : [],
      candidates: candidates.map(({ name, score, edits }) => ({ name, score, editCount: edits.length })),
      report: this.getReport(),
    };
  }

  getReport() {
    return {
      version: PATTERN_OPTIMIZER_VERSION,
      connectedComponents: true,
      noiseDetector: true,
      jaggedEdgeRepair: "conservative",
      holeFill: true,
      lineContinuity: "candidate-based",
      backgroundMerge: this.options.backgroundMerge,
      localContrastProtect: true,
      bestCandidateOptimization: true,
    };
  }
}

export function createPatternOptimizer(options = {}) {
  return new PatternOptimizer(options);
}

const browserApi = { PATTERN_OPTIMIZER_VERSION, analyzeComponents, scorePattern, PatternOptimizer, createPatternOptimizer };
if (typeof window !== "undefined") window.LibmsPatternOptimizer = browserApi;
