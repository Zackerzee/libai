/**
 * Generation Engine V2 — Protected Palette Budget
 *
 * 用户 maxColors 限制时，不「删除数量最少的颜色」。
 * 每个颜色计算 usage / protectedUsage / mergeCost，
 * 优先合并 protectedUsage 低 + usage 少 + 与大色接近 的颜色。
 * 高保护颜色（如 eye highlight）不会因数量少被优先删。
 *
 * maxColors === 0：跳过主动 budget。
 * 复用 palette-engine 的 rgbToLab / deltaE2000。
 */

import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";

function cellRgb(cell) {
  if (!cell) return null;
  if (Array.isArray(cell.rgb)) return [cell.rgb[0], cell.rgb[1], cell.rgb[2]];
  if (typeof cell.r === "number") return [cell.r, cell.g, cell.b];
  return null;
}

export function countGridColors(grid, getColorKey) {
  const usage = new Map();
  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      const key = getColorKey(cell);
      if (key == null) continue;
      usage.set(key, (usage.get(key) || 0) + 1);
    }
  }
  return usage;
}

/**
 * 从 protectionMap 汇总每个颜色的平均保护分（0..1）。
 */
function colorProtectedUsage(grid, getColorKey, protectionMap) {
  const width = grid[0]?.length || 0;
  const sums = new Map();
  const counts = new Map();
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      const key = getColorKey(cell);
      const p = protectionMap ? protectionMap[y * width + x] : 0;
      sums.set(key, (sums.get(key) || 0) + p);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const result = new Map();
  for (const [key, sum] of sums) result.set(key, sum / (counts.get(key) || 1));
  return result;
}

/**
 * 返回 merge plan：[{ from, to, count, criticalUsage, highUsage, importance, distance, forcedProtected, protectedByAnchor }]。
 * Phase 2：颜色 importance 综合 critical/high/source-supported/structural usage，不是简单 protectedUsage*1000+count。
 *
 * protectedKeys（可选）：一组「强调色锚点」colorKey。它们与 critical 同级，阶段一不会被主动合并；
 * 只有确实降不到 maxColors 时，才在阶段二被 forcedProtected 标记后合并。
 */
export function buildPaletteBudgetPlan({
  grid,
  getColorKey,
  getRGBByKey = cellRgb,
  maxColors,
  protectionMap = null,
  tierMap = null,
  protectionReasonMap = null,
  protectedKeys = null,
  options = {},
}) {
  const { protectionThreshold = 0.5 } = options;

  // maxColors === 0 → AUTO，不强制 budget
  if (!maxColors || maxColors <= 0) return [];

  const usage = countGridColors(grid, getColorKey);
  if (usage.size <= maxColors) return [];

  // 每颜色统计 critical / high / source-supported / structural usage
  const width = grid[0]?.length || 0;
  const criticalUsage = new Map();
  const highUsage = new Map();
  const sourceSupported = new Map();
  const structural = new Map();
  for (let y = 0; y < grid.length; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      const key = getColorKey(cell);
      const idx = y * width + x;
      const tier = tierMap ? tierMap[idx] : 0;
      if (tier >= 4) criticalUsage.set(key, (criticalUsage.get(key) || 0) + 1);
      else if (tier >= 3) highUsage.set(key, (highUsage.get(key) || 0) + 1);
      if (protectionReasonMap) {
        const r = protectionReasonMap[idx];
        if (r & 32) sourceSupported.set(key, (sourceSupported.get(key) || 0) + 1); // SOURCE_SUPPORTED
        if (r & 16) structural.set(key, (structural.get(key) || 0) + 1); // STRUCTURAL_EDGE
      }
    }
  }

  const entries = [...usage.entries()].map(([key, count]) => {
    const rgb = getRGBByKey(key);
    const crit = criticalUsage.get(key) || 0;
    const high = highUsage.get(key) || 0;
    const src = sourceSupported.get(key) || 0;
    const str = structural.get(key) || 0;
    // protectedKeys（强调色锚点）：与 critical 同等对待 —— 阶段一绝不主动合并，
    // 只有确实降不到目标（阶段二）才会被 forcedProtected 记录后合并。
    // 不传该参数时 hasCritical 的取值与旧版完全一致，行为逐位不变。
    const byAnchor = protectedKeys ? protectedKeys.has(key) : false;
    return {
      key,
      count,
      rgb,
      lab: rgb ? rgbToLab(rgb) : null,
      criticalUsage: crit,
      highUsage: high,
      sourceSupported: src,
      structural: str,
      importance: crit * 10000 + high * 1000 + src * 100 + str * 10 + count,
      hasCritical: crit > 0,
      protectedByAnchor: byAnchor,
      protected: crit > 0 || byAnchor,
    };
  });

  // 第一阶段：合并无 critical / 非锚点保护的颜色，importance 低优先
  const removable = entries
    .filter((e) => !e.protected)
    .sort((a, b) => a.importance - b.importance || String(a.key).localeCompare(String(b.key)));

  const remaining = new Set(entries.map((e) => e.key));
  const plan = [];

  for (const source of removable) {
    if (remaining.size <= maxColors) break;
    if (!remaining.has(source.key)) continue;
    const target = nearestTarget(source, entries, remaining);
    if (!target) break;
    plan.push({ from: source.key, to: target.key, count: source.count, criticalUsage: source.criticalUsage, highUsage: source.highUsage, importance: source.importance, distance: Math.round(target.distance * 10) / 10, forcedProtected: false, protectedByAnchor: source.protectedByAnchor });
    remaining.delete(source.key);
  }

  // 第二阶段：确实无法满足时，才触碰含 critical 的颜色（记录 forcedProtected）
  if (remaining.size > maxColors) {
    const forced = entries
      .filter((e) => remaining.has(e.key))
      .sort((a, b) => a.importance - b.importance || String(a.key).localeCompare(String(b.key)));
    for (const source of forced) {
      if (remaining.size <= maxColors) break;
      if (!remaining.has(source.key)) continue;
      const target = nearestTarget(source, entries, remaining);
      if (!target) break;
      plan.push({ from: source.key, to: target.key, count: source.count, criticalUsage: source.criticalUsage, highUsage: source.highUsage, importance: source.importance, distance: Math.round(target.distance * 10) / 10, forcedProtected: true, protectedByAnchor: source.protectedByAnchor });
      remaining.delete(source.key);
    }
  }

  return plan;
}

function nearestTarget(source, entries, remaining) {
  let best = null;
  let bestDistance = Infinity;
  for (const candidate of entries) {
    if (candidate.key === source.key) continue;
    if (!remaining.has(candidate.key)) continue;
    if (!source.lab || !candidate.lab) continue;
    const distance = deltaE2000(source.lab, candidate.lab);
    if (distance < bestDistance) { bestDistance = distance; best = { key: candidate.key, distance }; }
  }
  return best;
}

/**
 * 应用 merge plan 到 grid（就地），返回统计。
 */
export function applyBudgetPlan(grid, getColorKey, plan, keyToCell) {
  const fromTo = new Map(plan.map((p) => [p.from, p.to]));
  // 传递闭包：解析链式合并 A→B→C → A→C，避免中间颜色「复活」
  const resolve = (key) => {
    let k = key;
    const seen = new Set();
    while (fromTo.has(k) && !seen.has(k)) { seen.add(k); k = fromTo.get(k); }
    return k;
  };
  const resolved = new Map();
  for (const key of fromTo.keys()) resolved.set(key, resolve(key));

  let applied = 0;
  for (const row of grid) {
    for (const cell of row) {
      if (!cell) continue;
      const key = getColorKey(cell);
      const target = resolved.get(key);
      if (target == null) continue;
      const targetCell = keyToCell(target);
      if (!targetCell) continue;
      if (targetCell.code === key) continue;
      cell.code = targetCell.code;
      cell.rgb = Array.isArray(targetCell.rgb) ? [...targetCell.rgb] : targetCell.rgb;
      if (targetCell.hex) cell.hex = targetCell.hex;
      if (targetCell.name) cell.name = targetCell.name;
      applied++;
    }
  }
  return { applied, merges: plan.length };
}

export const DEFAULT_BUDGET_CONFIG = Object.freeze({
  protectionThreshold: 0.5,
  protectedUsageWeight: 1000,
});

export default {
  DEFAULT_BUDGET_CONFIG,
  countGridColors,
  buildPaletteBudgetPlan,
  applyBudgetPlan,
};
