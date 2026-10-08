/**
 * Generation Engine V2.5 — Accent Protection（强调色锚点保护）
 *
 * 量化降色（把色数合并进 maxColors）时，小面积但视觉关键的色（眼睛/描边/高光）
 * 容易被并掉。参考 bead-grid-studio 的思路：认定「锚点色」，在合并损失上给极大权重，
 * 使合并算法几乎永远不选它。
 *
 * 锚点分两类：
 *  - 中性锚点：最暗 / 最亮的中性色（彩度低于门槛），即黑描边与高光的稳定端点。
 *  - 鲜艳锚点：色相彼此间隔足够大的高饱和色，最多 N 个，保护关键彩色细节。
 *
 * 复用 palette-engine 的 rgbToLab / deltaE2000，保证全项目色差口径一致。
 */

import { rgbToLab } from "./palette-engine.mjs";

// 默认配置：中性彩度门槛、鲜艳锚点上限、色相环形间隔、鲜艳最低彩度、损失放大倍数。
export const DEFAULT_ACCENT_CONFIG = Object.freeze({
  neutralChromaThreshold: 12, // 中性锚点：Lab 彩度 sqrt(a²+b²) 上限
  maxChromaticAnchors: 3, // 鲜艳锚点最多几个
  hueSeparation: 0.55, // 鲜艳锚点间最小「环形」色相差（弧度）
  chromaThreshold: 15, // 鲜艳锚点：最低彩度
  anchorLossWeight: 40, // 锚点合并损失放大倍数（×）
});

// 取得 cell 的 [r,g,b]：色卡色可能存 rgb 数组，也可能是 {r,g,b}。
function defaultGetRGB(cell) {
  if (!cell) return null;
  if (Array.isArray(cell.rgb)) return [cell.rgb[0], cell.rgb[1], cell.rgb[2]];
  if (typeof cell.r === "number") return [cell.r, cell.g, cell.b];
  return null;
}

// 环形最短色相差：Lab 色相角 atan2(b,a) ∈ (-π, π]，整圈是 2π。
// 0 与 2π 是同一方向，间隔要取环形最短角距（如 0.1 与 6.1 实际相邻）。
function hueDistance(a, b) {
  if (a == null || b == null) return Infinity;
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/**
 * 在已调色板匹配好的 grid 上检测锚点色。
 * grid[y][x] 为 null（真空豆）或 { code, name, hex, rgb }。
 * 返回 anchors(Set) / neutralAnchors / chromaticAnchors / profiles / diagnostics。
 */
export function detectAnchorColors({
  grid,
  getColorKey = (cell) => (cell ? cell.code : null),
  getRGB = defaultGetRGB,
  options = {},
} = {}) {
  const { neutralChromaThreshold, maxChromaticAnchors, hueSeparation, chromaThreshold } = {
    ...DEFAULT_ACCENT_CONFIG,
    ...options,
  };

  // 汇总每个 colorKey 的代表 Lab / 彩度 / 色相 / 出现颗数
  const colorInfo = new Map();
  const height = grid?.length || 0;
  const width = grid?.[0]?.length || 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y]?.[x];
      if (!cell) continue;
      const key = getColorKey(cell);
      if (key == null) continue;
      const existing = colorInfo.get(key);
      if (existing) {
        existing.count += 1;
        continue;
      }
      const rgb = getRGB(cell);
      if (!rgb) continue;
      const lab = rgbToLab(rgb);
      const chroma = Math.hypot(lab[1], lab[2]);
      const hue = chroma < 1e-6 ? null : Math.atan2(lab[2], lab[1]); // 近中性无色相
      colorInfo.set(key, { count: 1, lab, chroma, hue, rgb });
    }
  }

  // 1) 中性锚点：按 L* 排序，但只在「中性色（彩度<=门槛）」里取最暗 / 最亮。
  //    若最暗/最亮整体不是中性色，则向下找最近的中性色；完全没有中性色则置 null。
  const neutral = [...colorInfo.entries()].filter(([, i]) => i.chroma <= neutralChromaThreshold);
  neutral.sort((a, b) => a[1].lab[0] - b[1].lab[0]); // L* 升序
  const darkNeutral = neutral.length ? neutral[0][0] : null;
  const brightNeutral = neutral.length ? neutral[neutral.length - 1][0] : null;

  // 2) 鲜艳锚点：按「颗数 × 彩度」降序，贪心挑；要求与已选的每个锚点环形色相差 > 门槛。
  const chromaticCandidates = [...colorInfo.entries()]
    .filter(([, i]) => i.hue !== null && i.chroma > chromaThreshold)
    .sort((a, b) => (b[1].count * b[1].chroma) - (a[1].count * a[1].chroma));
  const chromaticAnchors = [];
  for (const [key, info] of chromaticCandidates) {
    if (chromaticAnchors.length >= maxChromaticAnchors) break;
    const conflict = chromaticAnchors.some(
      (ak) => hueDistance(info.hue, colorInfo.get(ak).hue) <= hueSeparation,
    );
    if (conflict) continue; // 与已选锚点环形太近 → 跳过
    chromaticAnchors.push(key);
  }

  const anchors = new Set([darkNeutral, brightNeutral, ...chromaticAnchors].filter((k) => k != null));

  // 每个颜色的画像：reason 标记它为何成为锚点
  const profiles = new Map();
  for (const [key, info] of colorInfo) {
    let reason = null;
    if (key === darkNeutral) reason = "dark-neutral";
    else if (key === brightNeutral) reason = "bright-neutral";
    else if (chromaticAnchors.includes(key)) reason = "vivid";
    profiles.set(key, { lab: info.lab, chroma: info.chroma, hue: info.hue, count: info.count, reason });
  }

  const totalColors = colorInfo.size;
  const diagnostics = {
    totalColors,
    considered: totalColors,
    neutralCount: neutral.length,
    chromaticCandidates: chromaticCandidates.length,
    chromaticChosen: chromaticAnchors.length,
    maxChromaticAnchors,
    hueSeparation,
    neutralChromaThreshold,
    chromaThreshold,
  };

  return {
    anchors,
    neutralAnchors: { dark: darkNeutral, bright: brightNeutral },
    chromaticAnchors,
    profiles,
    diagnostics,
  };
}

/**
 * 由锚点集合产出损失权重 Map。锚点 → anchorLossWeight；非锚点不出现（等价权重 1）。
 */
export function buildAnchorLossWeights(anchors, options = {}) {
  const { anchorLossWeight = DEFAULT_ACCENT_CONFIG.anchorLossWeight } = options;
  const weights = new Map();
  if (!anchors) return weights;
  for (const key of anchors) weights.set(key, anchorLossWeight);
  return weights;
}

/**
 * 把锚点信息「塞进」既有的调色板预算计划（buildPaletteBudgetPlan 的产物）。
 *
 * buildPaletteBudgetPlan 已经按 importance 升序一次性排好合并优先级（plan 首项最优先合并），
 * 计划项里没有 cost 字段。因此这里做后处理：
 *  - 锚点条目移到 plan 末尾（即便下游按 plan 顺序应用，也最后才考虑）；
 *  - 给锚点条目的 cost 乘上 anchorLossWeight（若下游按 cost 排序，锚点几乎不会被选）；
 *  - 打 anchorProtected: true 供诊断。
 * 非锚点条目保持原相对顺序，cost 为基准值（×1）。
 *
 * 向后兼容：无锚点（空或未传）时原样返回 plan（同一数组引用 / 顺序 / 结构不变），
 * 保证既有测试与冻结基线不受影响。
 */
export function applyAnchorProtectionToPlan(plan, anchors, options = {}) {
  const { anchorLossWeight = DEFAULT_ACCENT_CONFIG.anchorLossWeight } = options;
  if (!plan || !plan.length || !anchors || anchors.size === 0) return plan;

  const normal = [];
  const protectedEntries = [];
  for (const entry of plan) {
    const isAnchor = entry.from != null && anchors.has(entry.from);
    // 基准合并损失取既有 distance（到最近目标的 CIEDE2000）；缺失时退化为 importance
    const base = typeof entry.distance === "number" ? entry.distance : (entry.importance ?? 0);
    if (isAnchor) {
      protectedEntries.push({ ...entry, cost: base * anchorLossWeight, anchorProtected: true });
    } else {
      normal.push({ ...entry, cost: base, anchorProtected: false });
    }
  }
  return [...normal, ...protectedEntries];
}

export default {
  DEFAULT_ACCENT_CONFIG,
  detectAnchorColors,
  buildAnchorLossWeights,
  applyAnchorProtectionToPlan,
};
