/**
 * Generation Engine V2 — Smart Cleanup（基础版）
 *
 * 决策对象是 same-color connected component，不是整个 palette color。
 * 只合并：protection 低 + source evidence 低 + region 小 + 邻域一致 + 替代色接近 的杂色。
 * 保存 cleanupRecords（仅被修改的 cell）。
 *
 * getRGB(cell) 契约：返回 [r,g,b] 数组。
 * 复用 palette-engine 的 rgbToLab / deltaE2000。
 */

import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const FOUR_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const EIGHT_OFFSETS = [...FOUR_OFFSETS, [1, 1], [1, -1], [-1, 1], [-1, -1]];

function cellRgb(cell) {
  if (!cell) return null;
  if (Array.isArray(cell.rgb)) return [cell.rgb[0], cell.rgb[1], cell.rgb[2]];
  if (typeof cell.r === "number") return [cell.r, cell.g, cell.b];
  return null;
}

/* =========================================================
 * Connected Components
 * ======================================================= */

export function findConnectedComponents(grid, getColorKey) {
  const height = grid.length;
  const width = grid[0]?.length || 0;
  const visited = new Uint8Array(width * height);
  const components = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (visited[idx]) continue;
      const cell = grid[y][x];
      if (!cell) { visited[idx] = 1; continue; }
      const key = getColorKey(cell);
      const cells = [];
      const queue = [[x, y]];
      visited[idx] = 1;
      while (queue.length) {
        const [cx, cy] = queue.shift();
        cells.push({ x: cx, y: cy });
        for (const [dx, dy] of FOUR_OFFSETS) {
          const nx = cx + dx, ny = cy + dy;
          if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
          const nidx = ny * width + nx;
          if (visited[nidx]) continue;
          const ncell = grid[ny][nx];
          if (!ncell || getColorKey(ncell) !== key) continue;
          visited[nidx] = 1;
          queue.push([nx, ny]);
        }
      }
      components.push({ key, cells });
    }
  }
  return components;
}

/* =========================================================
 * Replacement Candidate（优先来自邻域，不是全局最近色）
 * ======================================================= */

export function findReplacement(grid, x, y, cell, getColorKey, getRGB = cellRgb) {
  const ownKey = getColorKey(cell);
  const ownRgb = getRGB(cell);
  if (!ownRgb) return null;
  const ownLab = rgbToLab(ownRgb);

  const neighborCounts = new Map();
  const neighborCells = new Map();
  for (const [dx, dy] of EIGHT_OFFSETS) {
    const nx = x + dx, ny = y + dy;
    const ncell = grid[ny]?.[nx];
    if (!ncell) continue;
    const key = getColorKey(ncell);
    if (key === ownKey) continue;
    neighborCounts.set(key, (neighborCounts.get(key) || 0) + 1);
    if (!neighborCells.has(key)) neighborCells.set(key, ncell);
  }
  if (!neighborCounts.size) return null;

  let best = null;
  let bestScore = Infinity;
  for (const [key, count] of neighborCounts) {
    const ncell = neighborCells.get(key);
    const nrgb = getRGB(ncell);
    if (!nrgb) continue;
    const distance = deltaE2000(ownLab, rgbToLab(nrgb));
    const score = distance - Math.min(6, count * 0.5);
    if (score < bestScore) { bestScore = score; best = { key, cell: ncell, count, distance }; }
  }
  return best;
}

/* =========================================================
 * Smart Cleanup 主入口
 * ======================================================= */

function modeIndexToName(m) {
  return m <= 0 ? "linearMean" : m === 1 ? "center" : m === 2 ? "dominant" : "edgeAware";
}

export function smartCleanup({
  grid,
  getColorKey,
  getRGB = cellRgb,
  protectionMap = null,
  tierMap = null,
  samplingModeMap = null,
  getSourceEvidence = null,
  options = {},
}) {
  const {
    protectionThreshold = 0.5,
    sourceEvidenceThreshold = 0.3,
    maxComponentSize = 5,
    // 分层 replacement cost（按 tier）；critical 禁止 merge
    replacementCostByTier = { none: 50, low: 50, medium: 35, high: 20, critical: 0 },
    // sampling-aware cost bias（越高越积极清理）
    samplingCostBias = { linearMean: 1.15, center: 0.8, dominant: 0.7, edgeAware: 0.9 },
  } = options;

  const height = grid.length;
  const width = grid[0]?.length || 0;
  const components = findConnectedComponents(grid, getColorKey);
  const records = [];

  for (const component of components) {
    if (component.cells.length > maxComponentSize) continue;

    let protectionSum = 0, evidenceSum = 0, evidenceCount = 0;
    let hasCritical = false;
    let modeSum = 0, modeCount = 0;
    for (const { x, y } of component.cells) {
      const idx = y * width + x;
      protectionSum += protectionMap ? protectionMap[idx] : 0;
      if (tierMap && tierMap[idx] >= 4) hasCritical = true;
      if (samplingModeMap) { modeSum += samplingModeMap[idx]; modeCount++; }
      if (getSourceEvidence) {
        const rgb = getRGB(grid[y][x]);
        const ev = rgb ? getSourceEvidence(x, y, rgb) : 0;
        evidenceSum += ev;
        evidenceCount++;
      }
    }
    const avgProtection = protectionSum / component.cells.length;
    const avgEvidence = evidenceCount ? evidenceSum / evidenceCount : 0;
    const avgMode = modeCount ? modeSum / modeCount : -1;

    // CRITICAL 组件禁止 merge；高保护 / 有 source evidence → 跳过
    if (hasCritical) continue;
    if (avgProtection >= protectionThreshold) continue;
    if (avgEvidence >= sourceEvidenceThreshold) continue;

    const modeName = modeIndexToName(avgMode);
    const costBias = samplingCostBias[modeName] ?? 1.0;

    for (const { x, y } of component.cells) {
      const idx = y * width + x;
      const cell = grid[y][x];
      const replacement = findReplacement(grid, x, y, cell, getColorKey, getRGB);
      if (!replacement) continue;

      const ownRgb = getRGB(cell);
      const replacementCost = ownRgb ? deltaE2000(rgbToLab(ownRgb), rgbToLab(getRGB(replacement.cell))) : Infinity;

      // 分层 replacement cost + sampling-aware bias
      const tier = tierMap ? tierMap[idx] : 2;
      const tierName = tier >= 4 ? "critical" : tier === 3 ? "high" : tier === 2 ? "medium" : tier === 1 ? "low" : "none";
      let maxCost = tier >= 4 ? 0 : (replacementCostByTier[tierName] ?? 50);
      maxCost *= costBias;
      if (replacementCost > maxCost) continue;

      const replacementScore = replacementCost - Math.min(6, replacement.count * 0.5);

      const before = { ...cell, rgb: Array.isArray(cell.rgb) ? [...cell.rgb] : cell.rgb };
      grid[y][x] = { ...replacement.cell };

      records.push({
        x, y,
        before,
        after: grid[y][x],
        reason: "isolated-low-value-component",
        componentSize: component.cells.length,
        protectionScore: avgProtection,
        protectionTier: tierName,
        samplingMode: modeName,
        sourceEvidence: avgEvidence,
        neighborSupport: replacement.count,
        replacementCost: Math.round(replacementCost * 10) / 10,
        replacementScore: Math.round(replacementScore * 10) / 10,
      });
    }
  }

  return { grid, records };
}

export const DEFAULT_CLEANUP_CONFIG = Object.freeze({
  protectionThreshold: 0.5,
  sourceEvidenceThreshold: 0.3,
  maxComponentSize: 5,
  replacementCostByTier: { none: 50, low: 50, medium: 35, high: 20, critical: 0 },
  samplingCostBias: { linearMean: 1.15, center: 0.8, dominant: 0.7, edgeAware: 0.9 },
});

export default {
  DEFAULT_CLEANUP_CONFIG,
  findConnectedComponents,
  findReplacement,
  smartCleanup,
};
