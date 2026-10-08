/**
 * Small Component Classification —— Hybrid V2 阶段 7/8 的核心安全门。
 *
 * 目标（用户要求 + TOPOLOGY_AUDIT.md）：**不要 small component → delete。**
 * 七分类：`NOISE / DETAIL / HIGHLIGHT / STRUCTURE / BRIDGE / SEPARATED_COMPONENT / UNKNOWN`
 *
 * 准确定位（HYBRID_V2_IMPLEMENTATION_PLAN.md §1.3）：
 *   这个 **七分类本身是本项目本地策略**（ORIGIN: LOCAL_POLICY，审计标为 CONCEPT ONLY），
 *   但**喂给分类器的每一条证据都必须可溯源**到 SOURCE VERIFIED 或 CURRENT VERIFIED：
 *     - HIGHLIGHT / 眼点：CURRENT `detail-protection-v2.detectHighlight` / `detectEyeLike`
 *     - STRUCTURE：CURRENT protectionMap tier + ProtectionReason.STRUCTURAL_EDGE
 *     - DETAIL：CURRENT sourceEvidence / ProtectionTier
 *     - BRIDGE：G `ownerConnectedWithout`（本仓库 topology.mjs 复现思路）
 *     - NOISE：G 彩色小域准入（≤2 格 / cellSupport<0.42 / 邻色数 ≥ size+2）
 *              + B 允许的源图 ΔE00 增量 ≤ 3.5
 *     - UNKNOWN：证据冲突 / 保护图缺失 → **默认保留并报告**
 */

import { deltaE2000, rgbToLab } from "../../../../smart-preprocessing/palette-engine.mjs";
import { HybridV2Config, PROVENANCE } from "./config.mjs";
import { isConnectedWithout, CONNECTIVITY } from "./topology.mjs";

export const COMPONENT_CATEGORY = Object.freeze({
  NOISE: "NOISE",
  DETAIL: "DETAIL",
  HIGHLIGHT: "HIGHLIGHT",
  STRUCTURE: "STRUCTURE",
  BRIDGE: "BRIDGE",
  SEPARATED_COMPONENT: "SEPARATED_COMPONENT",
  UNKNOWN: "UNKNOWN",
});

const C = HybridV2Config.cleanup;
const v = (node) => node.value;

/** CURRENT ProtectionReason 位（detail-protection-v2.mjs）。 */
const REASON = Object.freeze({ STRUCTURAL_EDGE: 16, SOURCE_SUPPORTED: 32 });

/**
 * @param {object} component { key, size, pixels:[[x,y],...] }
 * @param {object} context {
 *   grid, cols, rows,
 *   tierMap, protectionMap, protectionReasonMap, highlightMap, eyeLikeMap, edgeMap,  // 全部可为空
 *   cellFeatures,   // 每格采样特征（含 dominantShare / variance）
 *   getRGB,         // key -> [r,g,b]
 *   config
 * }
 * @returns {{category:string, confidence:number, allowAutoAction:boolean, reasons:string[], evidence:object}}
 */
export function classifySmallComponent(component, context = {}) {
  const { grid, cols } = context;
  const cfg = context.config || {};
  const cv = (key, fallback) => (cfg[key] === undefined ? fallback : cfg[key]);
  const pixels = component?.pixels || [];
  const size = pixels.length;
  const reasons = [];
  const idxOf = ([x, y]) => y * cols + x;

  if (!size) {
    return {
      category: COMPONENT_CATEGORY.UNKNOWN,
      confidence: 0,
      allowAutoAction: false,
      reasons: ["empty-component"],
      evidence: {},
    };
  }

  // ── 收集证据（每项都标出处）────────────────────────────────
  const tiers = [];
  let maxTier = 0;
  let structural = false;
  let sourceSupported = false;
  let highlight = 0;
  let eyeLike = 0;
  let protection = 0;
  let maxSupport = 0;
  for (const p of pixels) {
    const i = idxOf(p);
    const tier = context.tierMap ? context.tierMap[i] : 0;
    tiers.push(tier);
    if (tier > maxTier) maxTier = tier;
    const reason = context.protectionReasonMap ? context.protectionReasonMap[i] : 0;
    if (reason & REASON.STRUCTURAL_EDGE) structural = true;
    if (reason & REASON.SOURCE_SUPPORTED) sourceSupported = true;
    highlight = Math.max(highlight, context.highlightMap ? context.highlightMap[i] : 0);
    eyeLike = Math.max(eyeLike, context.eyeLikeMap ? context.eyeLikeMap[i] : 0);
    protection = Math.max(protection, context.protectionMap ? context.protectionMap[i] : 0);
    const f = context.cellFeatures ? context.cellFeatures[i] : null;
    if (f) maxSupport = Math.max(maxSupport, f.dominantShare ?? 1);
  }

  // 邻域异色数（G：邻色支持数 ≥ 组件大小 + 2）
  const neighborColors = new Set();
  let neighborBeads = 0;
  for (const [x, y] of pixels) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= (context.rows || grid.length)) continue;
      const cell = grid[ny][nx];
      if (cell == null) continue;
      const key = context.getKey ? context.getKey(cell) : cell;
      if (key === component.key) continue;
      neighborBeads++;
      neighborColors.add(key);
    }
  }

  // 桥接：去掉任一格后该组件是否分裂（G `ownerConnectedWithout` 思路）
  let bridge = false;
  if (size > 1) {
    for (const p of pixels) {
      const rest = pixels.filter((q) => q !== p && !(q[0] === p[0] && q[1] === p[1]));
      if (!isConnectedWithout(rest.length ? rest : [p], p, cv("ownerConnectivity", 8))) {
        // 若去掉该格后剩余格不再连通 → 该格是关节（桥）
        if (rest.length > 1) { bridge = true; break; }
      }
    }
  }

  // 分离部件：被单一异色完全包围（不接触背景、不接触画布边）
  let separated = false;
  if (size > 0) {
    const surrounding = new Set();
    let touchesBgOrBorder = false;
    for (const [x, y] of pixels) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= (context.rows || grid.length)) { touchesBgOrBorder = true; continue; }
        const cell = grid[ny][nx];
        if (cell == null) { touchesBgOrBorder = true; continue; }
        const key = context.getKey ? context.getKey(cell) : cell;
        if (key !== component.key) surrounding.add(key);
      }
    }
    separated = !touchesBgOrBorder && surrounding.size === 1;
  }

  const evidence = {
    size,
    maxTier,
    structural,
    sourceSupported,
    highlight,
    eyeLike,
    protection,
    maxSupport,
    neighborColorCount: neighborColors.size,
    neighborBeads,
    bridge,
    separated,
  };

  // ── 判定（顺序 = 从最该保留到最可删）────────────────────────
  const decide = (category, confidence, extra = []) => ({
    category,
    confidence,
    allowAutoAction: category === COMPONENT_CATEGORY.NOISE
      && confidence >= cv("noiseConfidenceThreshold", v(C.noiseConfidenceThreshold)),
    reasons: [...reasons, ...extra],
    evidence,
  });

  if (highlight >= 0.5 || eyeLike >= 0.5) {
    reasons.push("CURRENT detectHighlight/detectEyeLike 命中");
    return decide(COMPONENT_CATEGORY.HIGHLIGHT, 0.9, ["source:CURRENT detail-protection-v2"]);
  }
  if (bridge) {
    reasons.push("去掉任一格后组件分裂 —— 桥接格");
    return decide(COMPONENT_CATEGORY.BRIDGE, 0.85, ["source:G ownerConnectedWithout"]);
  }
  if (separated) {
    reasons.push("被单一异色完整包围的独立部件");
    return decide(COMPONENT_CATEGORY.SEPARATED_COMPONENT, 0.8, ["source:G 源 owner 分离"]);
  }
  if (structural || maxTier >= v(HybridV2Config.protection.minProtectionTier)) {
    reasons.push("CURRENT protectionMap 命中的结构/高保护格");
    return decide(COMPONENT_CATEGORY.STRUCTURE, 0.8, ["source:CURRENT detail-protection-v2"]);
  }
  if (sourceSupported || maxTier >= 3) {
    reasons.push("CURRENT sourceEvidence / ProtectionTier ≥ HIGH");
    return decide(COMPONENT_CATEGORY.DETAIL, 0.7, ["source:CURRENT detail-protection-v2"]);
  }

  // 到这里才可能判 NOISE —— 必须同时满足 G 的三条准入 + B 的误差增量
  const sizeOk = size <= cv("maxComponentSize", v(C.maxComponentSize));
  const supportOk = maxSupport < cv("cellSupportMax", v(C.cellSupportMax));
  const neighborOk = neighborColors.size >= size + cv("neighborColorBonus", v(C.neighborColorBonus));
  const deltaOk = estimateDeltaEIncrement(component, context) <= cv("maxSourceDeltaEIncrement", v(C.maxSourceDeltaEIncrement));

  if (sizeOk && supportOk && neighborOk && deltaOk) {
    let score = 0.5;
    if (size === 1) score += 0.15;
    if (maxTier === 0) score += 0.15;
    if (neighborColors.size >= size + 3) score += 0.15;
    if (estimateDeltaEIncrement(component, context) <= 1.5) score += 0.1;
    if (protection > 0) score -= 0.2;
    const confidence = Math.max(0, Math.min(1, score));
    reasons.push(`G 彩色小域准入成立（size=${size} support=${maxSupport.toFixed(2)} 邻色=${neighborColors.size}）`);
    reasons.push("B 源图 ΔE00 增量在允许范围内");
    return decide(COMPONENT_CATEGORY.NOISE, confidence, ["source:G L2398–2429", "source:B regionCleanup"]);
  }

  // 证据不足 → 保留并报告（审计明确要求：UNKNOWN 绝不因为小就删）
  if (!sizeOk) reasons.push(`size=${size} 超过准入 ${cv("maxComponentSize", v(C.maxComponentSize))}`);
  if (!supportOk) reasons.push(`cellSupport=${maxSupport.toFixed(2)} ≥ ${cv("cellSupportMax", v(C.cellSupportMax))}`);
  if (!neighborOk) reasons.push(`邻色数 ${neighborColors.size} < size+${cv("neighborColorBonus", v(C.neighborColorBonus))}`);
  if (!deltaOk) reasons.push("ΔE00 增量超过 B 的允许值");
  if (!context.tierMap) reasons.push("保护图缺失 —— 证据不足");
  return decide(COMPONENT_CATEGORY.UNKNOWN, 0.3, ["policy:UNKNOWN 默认保留"]);
}

/** 改格后源图 ΔE00 增量估计（B 的闸门量）：目标邻色 vs 当前色 对源格色的误差差。 */
export function estimateDeltaEIncrement(component, context) {
  const { grid, cols, rows } = context;
  if (!context.getRGB || !context.cellSourceRgb) return 0;
  const cell = grid[component.pixels[0][1]][component.pixels[0][0]];
  if (cell == null) return 0;
  const key = context.getKey ? context.getKey(cell) : cell;
  const source = context.cellSourceRgb[component.pixels[0][1] * cols + component.pixels[0][0]];
  if (!source) return 0;
  const currentLab = rgbToLab(context.getRGB(key));
  const sourceLab = rgbToLab(source);
  // 取邻域中最多的异色作为候选替换色
  const counts = new Map();
  for (const [x, y] of component.pixels) {
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= (rows || grid.length)) continue;
      const other = grid[ny][nx];
      if (other == null) continue;
      const k = context.getKey ? context.getKey(other) : other;
      if (k === key) continue;
      counts.set(k, (counts.get(k) || 0) + 1);
    }
  }
  if (!counts.size) return 0;
  let bestKey = null;
  let bestN = 0;
  for (const [k, n] of counts) if (n > bestN) { bestN = n; bestKey = k; }
  const candidateLab = rgbToLab(context.getRGB(bestKey));
  const before = deltaE2000(sourceLab, currentLab);
  const after = deltaE2000(sourceLab, candidateLab);
  return Math.max(0, after - before);
}

export { CONNECTIVITY, PROVENANCE };
