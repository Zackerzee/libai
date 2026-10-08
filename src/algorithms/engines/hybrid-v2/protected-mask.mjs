/**
 * ProtectedDetailMask —— Hybrid V2 的**统一保护层**（阶段 6 / 11 的载体）。
 *
 * 用户要求：Cleanup、MaxColors 后处理、Region Merge **不得绕过该 Gate**。
 * 因此本模块对外只暴露 `requestChange()`：所有改格必须走它，内部先查 Mask 再查 TopologyGuard。
 *
 * Phase B.1 扩展：
 *   - 保护**分层**（用户第 7 条）：HARD_PROTECT / SOFT_PROTECT / UNPROTECTED。
 *     先分类诊断，**不改行为**：Gate 仍用 `mask[i]` 布尔（与历史一致）。
 *   - `requestChange()` 增加**可解释提案记录**（用户第 4 条）+ STRICT/TRACE_ONLY 双模式
 *     （用户第 6 条）。TRACE_ONLY 仅模拟，不真正用于最终结果。
 *
 * 五层的证据来源：
 *   structure  CURRENT `detail-protection-v2.buildProtectionMap`（tier / reason）
 *   outline    CURRENT 轮廓保护（protectionReasonMap 的 STRUCTURAL_EDGE + 边缘图）
 *   eye/high   CURRENT `detectEyeLike` / `detectHighlight`
 *   accent     G（Apache-2.0）：OKLab 色度 × log2(使用数+2)，色相角距 > 0.55 rad，≤3
 *   smallSep   classifySmallComponent 判为 SEPARATED_COMPONENT / BRIDGE / DETAIL 的组件
 */

import { buildProtectionMap, ProtectionTier } from "../../../../smart-preprocessing/detail-protection-v2.mjs";
import { rgbToOklab, oklabChroma, isVisiblyChromatic } from "../../bgs/color-space.mjs";
import { HybridV2Config } from "./config.mjs";
import { COMPONENT_CATEGORY } from "./classify.mjs";
import {
  PROTECTION_LAYER, DECISION, classifyCleanupBenefit, classifyDamageRisk,
} from "./trace.mjs";

const P = HybridV2Config.protection;
const v = (node) => node.value;

export const MASK_LAYER = Object.freeze({
  STRUCTURE: "structure",
  OUTLINE: "outline",
  EYE_HIGHLIGHT: "eye-highlight",
  ACCENT: "accent",
  SMALL_SEPARATED: "small-separated-component",
  NONE: "none",
});

const REASON = Object.freeze({ STRUCTURAL_EDGE: 16 });

/** G accent 规则：OKLab 色度 × log2(使用数+2)，贪心保留，色相角距 > 0.55 rad，≤3。 */
export function selectAccentKeys(grid, getColorKey, getRGB, config = {}) {
  const counts = new Map();
  for (const row of grid) {
    for (const cell of row) {
      if (cell == null) continue;
      const key = getColorKey(cell);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const scored = [];
  for (const [key, count] of counts) {
    if (!isVisiblyChromatic(getRGB(key))) continue;
    const oklab = rgbToOklab(getRGB(key));
    const chroma = oklabChroma(oklab);
    const hue = Math.atan2(oklab[2], oklab[1]);
    const score = chroma * Math.log2(count + 2);
    scored.push({ key, score, hue, chroma });
  }
  scored.sort((a, b) => b.score - a.score);

  const maxCount = config.accentMaxCount ?? v(P.accentMaxCount);
  const minAngle = config.accentHueDistance ?? v(P.accentHueDistance);
  const kept = [];
  for (const entry of scored) {
    if (kept.length >= maxCount) break;
    const ok = kept.every((k) => Math.abs(angleDelta(entry.hue, k.hue)) > minAngle);
    if (ok) kept.push(entry);
  }
  return { accents: kept.map((e) => e.key), scored };
}

function angleDelta(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

/**
 * 保护分层（用户第 7 条）。纯诊断：**不改变 Gate 行为**（Gate 仍用 `mask[i]`）。
 *   HARD_PROTECT：眼/高光、桥、分离部件、关键结构（高 tier）。
 *   SOFT_PROTECT：普通轮廓、低置信结构、accent 候选。
 *   UNPROTECTED：无保护。
 */
export function classifyProtectionLayer({ layer, tier, category }) {
  if (layer === MASK_LAYER.EYE_HIGHLIGHT) return PROTECTION_LAYER.HARD_PROTECT;
  if (layer === MASK_LAYER.OUTLINE) return PROTECTION_LAYER.SOFT_PROTECT;
  if (layer === MASK_LAYER.ACCENT) return PROTECTION_LAYER.SOFT_PROTECT;
  if (layer === MASK_LAYER.SMALL_SEPARATED) {
    if (category === COMPONENT_CATEGORY.BRIDGE || category === COMPONENT_CATEGORY.SEPARATED_COMPONENT) {
      return PROTECTION_LAYER.HARD_PROTECT;
    }
    return tier >= v(P.minHardTier) ? PROTECTION_LAYER.HARD_PROTECT : PROTECTION_LAYER.SOFT_PROTECT;
  }
  if (layer === MASK_LAYER.STRUCTURE) {
    return tier >= v(P.minHardTier) ? PROTECTION_LAYER.HARD_PROTECT : PROTECTION_LAYER.SOFT_PROTECT;
  }
  return PROTECTION_LAYER.UNPROTECTED;
}

/**
 * @param {object} input { grid, cols, rows, getColorKey, getRGB, sourceImageData, cellBoundsFn, components, config }
 */
export function buildProtectedDetailMask(input) {
  const { grid, cols, rows, getColorKey, getRGB, sourceImageData, cellBoundsFn, components = [], config = {} } = input;
  const size = cols * rows;

  // ── CURRENT 保护图（唯一来源）──────────────────────────────
  let protection = null;
  if (sourceImageData) {
    protection = buildProtectionMap({
      grid,
      width: cols,
      height: rows,
      getRGB,
      sameCell: (a, b) => (a == null && b == null) || (a != null && b != null && getColorKey(a) === getColorKey(b)),
      sourceImageData,
      cellBoundsFn,
      options: {
        detailProtection: config.detailProtection ?? v(P.detailProtection),
        edgeProtection: config.edgeProtection ?? v(P.edgeProtection),
        highlightProtection: config.highlightProtection ?? v(P.highlightProtection),
        eyeProtection: config.eyeProtection ?? v(P.eyeProtection),
      },
    });
  }

  const tierMap = protection?.tierMap || new Uint8Array(size);
  const reasonMap = protection?.protectionReasonMap || new Uint8Array(size);
  const highlightMap = protection?.highlightMap || new Float32Array(size);
  const eyeLikeMap = protection?.eyeLikeMap || new Float32Array(size);
  const edgeMap = protection?.edgeMap || new Float32Array(size);

  // ── G accent ──────────────────────────────────────────────
  const { accents, scored } = selectAccentKeys(grid, getColorKey, getRGB, config);
  const accentSet = new Set(accents);

  // ── 小部件层：来自七分类（带 category，用于分层）─────────────
  const smallSep = new Uint8Array(size);
  const categoryMap = new Map(); // index -> COMPONENT_CATEGORY
  for (const entry of components) {
    const keep = entry.category === COMPONENT_CATEGORY.SEPARATED_COMPONENT
      || entry.category === COMPONENT_CATEGORY.BRIDGE
      || entry.category === COMPONENT_CATEGORY.DETAIL
      || entry.category === COMPONENT_CATEGORY.HIGHLIGHT
      || entry.category === COMPONENT_CATEGORY.STRUCTURE;
    if (!keep) continue;
    for (const [x, y] of entry.component.pixels) {
      const i = y * cols + x;
      smallSep[i] = 1;
      categoryMap.set(i, entry.category);
    }
  }

  const layerMap = new Array(size).fill(MASK_LAYER.NONE);
  const mask = new Uint8Array(size);
  const protectionLayerMap = new Uint8Array(size); // 0=UNPROTECTED 1=SOFT 2=HARD
  const protectionLayerName = new Array(size).fill(PROTECTION_LAYER.UNPROTECTED);

  for (let i = 0; i < size; i++) {
    const y = Math.floor(i / cols);
    const x = i % cols;
    const cell = grid[y]?.[x];
    const key = cell == null ? null : getColorKey(cell);
    let layer = MASK_LAYER.NONE;

    if (highlightMap[i] >= 0.5 || eyeLikeMap[i] >= 0.5) layer = MASK_LAYER.EYE_HIGHLIGHT;
    else if ((reasonMap[i] & REASON.STRUCTURAL_EDGE) && tierMap[i] >= v(P.minProtectionTier)) layer = MASK_LAYER.OUTLINE;
    else if (tierMap[i] >= v(P.minProtectionTier)) layer = MASK_LAYER.STRUCTURE;
    else if (smallSep[i]) layer = MASK_LAYER.SMALL_SEPARATED;
    else if (key != null && accentSet.has(key)) layer = MASK_LAYER.ACCENT;

    if (layer !== MASK_LAYER.NONE) {
      layerMap[i] = layer;
      mask[i] = 1;
    }
    const cat = categoryMap.get(i) || null;
    const pl = classifyProtectionLayer({ layer, tier: tierMap[i], category: cat });
    protectionLayerName[i] = pl;
    protectionLayerMap[i] = pl === PROTECTION_LAYER.HARD_PROTECT ? 2 : pl === PROTECTION_LAYER.SOFT_PROTECT ? 1 : 0;
  }

  return {
    cols,
    rows,
    mask,
    layerMap,
    protectionLayerMap,
    protectionLayerName,
    categoryMap,
    tierMap,
    reasonMap,
    highlightMap,
    eyeLikeMap,
    edgeMap,
    accents,
    accentScores: scored,
    protectedCount: mask.reduce((a, b) => a + b, 0),
    layers: MASK_LAYER,
    source: {
      structure: "CURRENT detail-protection-v2.buildProtectionMap",
      outline: "CURRENT protectionReasonMap.STRUCTURAL_EDGE",
      eyeHighlight: "CURRENT detectEyeLike/detectHighlight",
      accent: "G bead-grid-studio L2459–2470 (Apache-2.0)",
      smallSeparated: "classifySmallComponent 七分类",
    },
  };
}

/**
 * 统一改格入口。**Cleanup / MaxColors 后处理 / Region Merge 都必须走这里。**
 *
 * @param {object} mask buildProtectedDetailMask 的结果
 * @param {object} guard TopologyGuard 实例
 * @param {number} x
 * @param {number} y
 * @param {string|object} toCell 目标色号（字符串 key，或 {code} 对象）
 * @param {object} [options]
 *   - grid, getColorKey：用于读取 fromColor（缺省则记录 null）
 *   - tracer：ProposalTracer 实例（缺省则不记录）
 *   - stage：阶段名（STAGE.*）
 *   - mode：'STRICT'（默认，保护生效）| 'TRACE_ONLY'（绕过保护门仅模拟）
 *   - context：{ reason, confidence, localVariance, componentSize, boundaryRatio, deltaE, edgeStrength, category, minConfidence }
 * @returns {{applied:boolean, verdict:string, reasons:string[], layer:string}}
 */
export function requestChange(mask, guard, x, y, toCell, options = {}) {
  const { grid, getColorKey, tracer, stage, context = {} } = options;
  const mode = options.mode === "TRACE_ONLY" ? "TRACE_ONLY" : "STRICT";
  const i = y * mask.cols + x;

  const layer = (mask.layerMap && mask.layerMap[i]) || MASK_LAYER.NONE;
  const protectionLayer = (mask.protectionLayerName && mask.protectionLayerName[i]) || PROTECTION_LAYER.UNPROTECTED;
  const category = (mask.categoryMap && mask.categoryMap.get(i)) || context.category || null;
  const fromColor = (grid && getColorKey && grid[y] && grid[y][x] != null) ? getColorKey(grid[y][x]) : null;
  const toColor = typeof toCell === "string" ? toCell : (toCell?.code ?? null);

  const makeProposal = (extra) => ({
    x, y,
    fromColor,
    toColor,
    stage: stage || null,
    reason: context.reason || null,
    confidence: context.confidence ?? null,
    localVariance: context.localVariance ?? null,
    componentSize: context.componentSize ?? null,
    boundaryRatio: context.boundaryRatio ?? null,
    deltaE: context.deltaE ?? null,
    edgeStrength: context.edgeStrength ?? null,
    protectedFlags: layer,
    topologyFlags: null,
    category,
    protectionLayer,
    decision: null,
    cleanupBenefit: classifyCleanupBenefit(stage),
    damageRisk: classifyDamageRisk({ protectionLayer, protectedFlags: layer, category }),
    ...extra,
  });

  const protectionBlocks = mask.mask[i] && !options.force;

  if (protectionBlocks) {
    if (mode === "TRACE_ONLY") {
      // 仅模拟：绕过保护门。仍走拓扑/置信门；通过则记 TRACE_HYPOTHETICAL 并（在 TRACE_ONLY 下）实际应用。
      const decision = guard.check({ x, y, to: toCell });
      if (decision.verdict === "REJECT") {
        const p = makeProposal({ decision: DECISION.REJECT_TOPOLOGY, topologyFlags: decision.reasons });
        tracer && tracer.record(p);
        return { applied: false, verdict: "REJECT", reasons: decision.reasons, layer };
      }
      const p = makeProposal({ decision: DECISION.TRACE_HYPOTHETICAL });
      tracer && tracer.record(p);
      return { applied: true, verdict: "ALLOW", reasons: ["trace-only-hypothetical"], layer };
    }
    // STRICT：保护门生效。HARD = REJECT_STRUCTURE，SOFT = REJECT_PROTECTION。
    const decision = protectionLayer === PROTECTION_LAYER.HARD_PROTECT
      ? DECISION.REJECT_STRUCTURE
      : DECISION.REJECT_PROTECTION;
    const p = makeProposal({ decision });
    tracer && tracer.record(p);
    return { applied: false, verdict: "REJECT", reasons: [`protected:${layer}`], layer };
  }

  // 未被保护拦截 → 拓扑门
  const decision = guard.check({ x, y, to: toCell });
  if (decision.verdict === "REJECT") {
    const p = makeProposal({ decision: DECISION.REJECT_TOPOLOGY, topologyFlags: decision.reasons });
    tracer && tracer.record(p);
    return { applied: false, verdict: "REJECT", reasons: decision.reasons, layer };
  }

  // 置信门（如有）
  if (context.confidence != null && context.minConfidence != null && context.confidence < context.minConfidence) {
    const p = makeProposal({ decision: DECISION.REJECT_CONFIDENCE });
    tracer && tracer.record(p);
    return { applied: false, verdict: "REJECT", reasons: ["low-confidence"], layer };
  }

  const p = makeProposal({ decision: DECISION.ACCEPT });
  tracer && tracer.record(p);
  return { applied: true, verdict: "ALLOW", reasons: decision.reasons, layer };
}

export { ProtectionTier };
