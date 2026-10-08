/**
 * Change Proposal Trace + Protection Gate Audit —— Hybrid V2 Phase B.1。
 *
 * 目标（用户第 4/5/7/8 条）：
 *   - 每个 requestChange() 都必须留下**可解释**的诊断记录。
 *   - 统计：总提案数 / 被 CURRENT 保护拦截数 / 各类拦截来源 / 各阶段来源。
 *   - 保护分层：HARD_PROTECT / SOFT_PROTECT / UNPROTECTED（先分类诊断，不改行为）。
 *   - Proposal Value：cleanupBenefit / damageRisk（先收集，不自动决定）。
 *
 * 铁律：本模块**只记录与分析**，不决定任何改格；最终是否改格仍由 requestChange
 *       在 STRICT 模式下的保护门决定。不直接放松 buildProtectionMap。
 */

/** 决策枚举（用户第 4 条）。 */
export const DECISION = Object.freeze({
  ACCEPT: "ACCEPT",
  REJECT_PROTECTION: "REJECT_PROTECTION", // SOFT 类保护拦截
  REJECT_TOPOLOGY: "REJECT_TOPOLOGY",
  REJECT_CONFIDENCE: "REJECT_CONFIDENCE",
  REJECT_STRUCTURE: "REJECT_STRUCTURE", // HARD 类结构保护拦截（眼/高光/桥/分离/关键结构）
  REJECT_OTHER: "REJECT_OTHER",
  TRACE_HYPOTHETICAL: "TRACE_HYPOTHETICAL", // TRACE_ONLY 模式：保护被绕过、假设会改
});

/** 保护分层（用户第 7 条）。 */
export const PROTECTION_LAYER = Object.freeze({
  HARD_PROTECT: "HARD_PROTECT",
  SOFT_PROTECT: "SOFT_PROTECT",
  UNPROTECTED: "UNPROTECTED",
});

export const STAGE = Object.freeze({
  FRAGMENT: "Safe Fragment Cleanup",
  EDGE: "Edge Contamination Cleanup",
  FLAT: "Flat Region Regularization",
});

export const CLEANUP_BENEFIT = Object.freeze({
  EDGE_CONTAMINATION: "edge-contamination",
  ISOLATED_NOISE: "isolated-noise",
  FRAGMENTATION: "fragmentation",
  PALETTE_NOISE: "palette-noise",
});

export const DAMAGE_RISK = Object.freeze({
  STRUCTURE: "structure",
  HIGHLIGHT: "highlight",
  BRIDGE: "bridge",
  SEPARATED: "separated-component",
  OUTLINE: "outline",
  ACCENT: "accent",
  OTHER: "other",
});

/** 由 stage 推断这次修改能带来哪类清理收益。 */
export function classifyCleanupBenefit(stage) {
  if (stage === STAGE.EDGE) return CLEANUP_BENEFIT.EDGE_CONTAMINATION;
  if (stage === STAGE.FRAGMENT) return CLEANUP_BENEFIT.ISOLATED_NOISE;
  if (stage === STAGE.FLAT) return CLEANUP_BENEFIT.FRAGMENTATION;
  return null;
}

/**
 * 由被改格的分层/层/分类推断这次修改会威胁哪类资产。
 * @param {object} o { protectionLayer, protectedFlags, category }
 */
export function classifyDamageRisk(o = {}) {
  const layer = o.protectionLayer;
  const flags = o.protectedFlags;
  const cat = o.category;
  if (layer === PROTECTION_LAYER.HARD_PROTECT) {
    if (flags === "eye-highlight") return DAMAGE_RISK.HIGHLIGHT;
    if (flags === "structure") return DAMAGE_RISK.STRUCTURE;
    if (cat === "BRIDGE") return DAMAGE_RISK.BRIDGE;
    if (cat === "SEPARATED_COMPONENT") return DAMAGE_RISK.SEPARATED;
    return DAMAGE_RISK.STRUCTURE; // HARD 兜底：结构类
  }
  if (layer === PROTECTION_LAYER.SOFT_PROTECT) {
    if (flags === "outline") return DAMAGE_RISK.OUTLINE;
    if (flags === "accent") return DAMAGE_RISK.ACCENT;
    return DAMAGE_RISK.OTHER;
  }
  return null; // UNPROTECTED：无保护资产受损风险
}

const stageShort = (s) => (s ? s.replace(/\s+/g, "-").slice(0, 24) : "unknown");

/**
 * 提案追踪器。每个 requestChange() 调一次 record()。
 */
export class ProposalTracer {
  constructor(opts = {}) {
    this.mode = opts.mode === "TRACE_ONLY" ? "TRACE_ONLY" : "STRICT";
    this.proposals = [];
    // TRACE_ONLY 假设计数器（用户第 6 条）
    this.hypothetical = {
      gridDiff: 0,
      potentialNoiseRemoved: 0,
      potentialEdgeCleaned: 0,
      potentialFragmentRegularized: 0,
      potentialStructureDamage: 0,
      potentialHighlightDamage: 0,
      potentialBridgeDamage: 0,
      potentialSeparatedDamage: 0,
      potentialOutlineDamage: 0,
      potentialAccentDamage: 0,
      byLayer: { HARD_PROTECT: 0, SOFT_PROTECT: 0, UNPROTECTED: 0 },
    };
  }

  /**
   * @param {object} p 完整提案记录（见用户第 4 条字段）
   */
  record(p) {
    this.proposals.push(p);
    if (p.decision === DECISION.TRACE_HYPOTHETICAL) this._noteHypothetical(p);
    return p;
  }

  _noteHypothetical(p) {
    this.hypothetical.gridDiff++;
    const layer = p.protectionLayer || PROTECTION_LAYER.UNPROTECTED;
    this.hypothetical.byLayer[layer] = (this.hypothetical.byLayer[layer] || 0) + 1;
    const benefit = p.cleanupBenefit;
    const damage = p.damageRisk;
    if (benefit === CLEANUP_BENEFIT.EDGE_CONTAMINATION) this.hypothetical.potentialEdgeCleaned++;
    else if (benefit === CLEANUP_BENEFIT.ISOLATED_NOISE) this.hypothetical.potentialNoiseRemoved++;
    else if (benefit === CLEANUP_BENEFIT.FRAGMENTATION) this.hypothetical.potentialFragmentRegularized++;
    switch (damage) {
      case DAMAGE_RISK.STRUCTURE: this.hypothetical.potentialStructureDamage++; break;
      case DAMAGE_RISK.HIGHLIGHT: this.hypothetical.potentialHighlightDamage++; break;
      case DAMAGE_RISK.BRIDGE: this.hypothetical.potentialBridgeDamage++; break;
      case DAMAGE_RISK.SEPARATED: this.hypothetical.potentialSeparatedDamage++; break;
      case DAMAGE_RISK.OUTLINE: this.hypothetical.potentialOutlineDamage++; break;
      case DAMAGE_RISK.ACCENT: this.hypothetical.potentialAccentDamage++; break;
      default: break;
    }
  }

  /** 单次运行的聚合审计（供报告跨夹具再汇总）。 */
  audit() {
    const a = {
      proposalCount: 0,
      acceptedCount: 0,
      rejectedCount: 0,
      rejectedByProtection: 0,
      rejectedByStructure: 0,
      rejectedByTopology: 0,
      rejectedByConfidence: 0,
      rejectedByOther: 0,
      byDecision: {},
      byStage: {},
      byLayer: { HARD_PROTECT: 0, SOFT_PROTECT: 0, UNPROTECTED: 0 },
      byProtectedFlags: {}, // outline/structure/highlight/accent/smallComponent/bridge/other
      byCategory: {},
      byBenefit: {},
      byDamage: {},
      // 只被 SOFT 保护拦截、且本身是安全清理（无结构/高光风险）的提案 = 潜在 over-protection
      softBlockedSafeNoise: 0,
      // HARD 眼/高光保护拦截了"清理类"提案、但被改格本身并非真实高光组件
      // （典型：亮背景线条图上 detectHighlight 把背景亮格误判为 eye-highlight）。
      hardHighlightBlocksCleanup: 0,
    };
    const inc = (obj, key) => { obj[key] = (obj[key] || 0) + 1; };
    for (const p of this.proposals) {
      a.proposalCount++;
      inc(a.byDecision, p.decision);
      inc(a.byStage, stageShort(p.stage));
      inc(a.byLayer, p.protectionLayer || PROTECTION_LAYER.UNPROTECTED);
      inc(a.byProtectedFlags, p.protectedFlags || "other");
      if (p.category) inc(a.byCategory, p.category);
      if (p.cleanupBenefit) inc(a.byBenefit, p.cleanupBenefit);
      if (p.damageRisk) inc(a.byDamage, p.damageRisk);

      if (p.decision === DECISION.ACCEPT || p.decision === DECISION.TRACE_HYPOTHETICAL) a.acceptedCount++;
      else {
        a.rejectedCount++;
        if (p.decision === DECISION.REJECT_STRUCTURE) { a.rejectedByStructure++; a.rejectedByProtection++; }
        else if (p.decision === DECISION.REJECT_PROTECTION) a.rejectedByProtection++;
        else if (p.decision === DECISION.REJECT_TOPOLOGY) a.rejectedByTopology++;
        else if (p.decision === DECISION.REJECT_CONFIDENCE) a.rejectedByConfidence++;
        else a.rejectedByOther++;
      }

      // over-protection 候选：被 SOFT 保护拦截 + 有清理收益 + 无 HARD 风险
      if (
        (p.decision === DECISION.REJECT_PROTECTION)
        && p.protectionLayer === PROTECTION_LAYER.SOFT_PROTECT
        && p.cleanupBenefit
        && !p.damageRisk
      ) a.softBlockedSafeNoise++;
      // over-protection 候选：HARD 眼/高光拦截了清理提案，但被改格并非真实高光组件
      if (
        (p.decision === DECISION.REJECT_STRUCTURE || p.decision === DECISION.REJECT_PROTECTION)
        && p.protectionLayer === PROTECTION_LAYER.HARD_PROTECT
        && p.protectedFlags === "eye-highlight"
        && p.category !== "HIGHLIGHT"
        && p.cleanupBenefit
      ) a.hardHighlightBlocksCleanup++;
    }
    return a;
  }
}

/** 合并多个审计聚合（跨夹具汇总）。 */
export function mergeAudit(list) {
  const out = {
    proposalCount: 0, acceptedCount: 0, rejectedCount: 0,
    rejectedByProtection: 0, rejectedByStructure: 0, rejectedByTopology: 0,
    rejectedByConfidence: 0,     rejectedByOther: 0,
    byDecision: {}, byStage: {}, byLayer: { HARD_PROTECT: 0, SOFT_PROTECT: 0, UNPROTECTED: 0 },
    byProtectedFlags: {}, byCategory: {}, byBenefit: {}, byDamage: {}, softBlockedSafeNoise: 0,
    hardHighlightBlocksCleanup: 0,
  };
  const inc = (obj, k, n) => { obj[k] = (obj[k] || 0) + n; };
  for (const a of list) {
    out.proposalCount += a.proposalCount;
    out.acceptedCount += a.acceptedCount;
    out.rejectedCount += a.rejectedCount;
    out.rejectedByProtection += a.rejectedByProtection;
    out.rejectedByStructure += a.rejectedByStructure;
    out.rejectedByTopology += a.rejectedByTopology;
    out.rejectedByConfidence += a.rejectedByConfidence;
    out.rejectedByOther += a.rejectedByOther;
    out.softBlockedSafeNoise += a.softBlockedSafeNoise;
    out.hardHighlightBlocksCleanup += a.hardHighlightBlocksCleanup;
    for (const [k, n] of Object.entries(a.byDecision)) inc(out.byDecision, k, n);
    for (const [k, n] of Object.entries(a.byStage)) inc(out.byStage, k, n);
    for (const [k, n] of Object.entries(a.byLayer)) inc(out.byLayer, k, n);
    for (const [k, n] of Object.entries(a.byProtectedFlags)) inc(out.byProtectedFlags, k, n);
    for (const [k, n] of Object.entries(a.byCategory)) inc(out.byCategory, k, n);
    for (const [k, n] of Object.entries(a.byBenefit)) inc(out.byBenefit, k, n);
    for (const [k, n] of Object.entries(a.byDamage)) inc(out.byDamage, k, n);
  }
  return out;
}

/** 合并多个 hypothetical 统计（跨夹具）。 */
export function mergeHypothetical(list) {
  const out = {
    gridDiff: 0, potentialNoiseRemoved: 0, potentialEdgeCleaned: 0, potentialFragmentRegularized: 0,
    potentialStructureDamage: 0, potentialHighlightDamage: 0, potentialBridgeDamage: 0,
    potentialSeparatedDamage: 0, potentialOutlineDamage: 0, potentialAccentDamage: 0,
    byLayer: { HARD_PROTECT: 0, SOFT_PROTECT: 0, UNPROTECTED: 0 },
  };
  for (const h of list) {
    for (const k of Object.keys(out)) {
      if (k === "byLayer") continue;
      out[k] += h[k] || 0;
    }
    for (const [k, n] of Object.entries(h.byLayer || {})) out.byLayer[k] = (out.byLayer[k] || 0) + n;
  }
  return out;
}
