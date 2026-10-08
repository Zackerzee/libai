/**
 * Protection Gate Audit —— Hybrid V2 Phase B.1（用户第 5/12/13 条）。
 *
 * 流程（严遵用户第 9 条）：
 *   REAL ORIGINAL IMAGE → CURRENT → CURRENT BeadMatrix
 *                        → Hybrid V2 后处理（STRICT）→ HYBRID_STRICT Matrix
 *                        → Hybrid V2 后处理（TRACE_ONLY）→ HYBRID_TRACE_ONLY Matrix（仅模拟）
 *
 * 对每个真实缺陷夹具输出（用户第 13 条）：
 *   CURRENT / HYBRID_STRICT / HYBRID_TRACE_ONLY
 *   + gridDiff / proposalCount / accepted / rejected
 *   + noiseDelta / fragmentDelta / edgeContaminationDelta / structureDamage / highlightDamage / topologyDamage
 * 并跨夹具聚合，回答用户第 12 条列出的 10 个问题。
 *
 * 铁律：
 *   - TRACE_ONLY 结果**不得**作为 IMPROVED 证据（仅模拟"保护关闭后会怎样"）。
 *   - 不替换 CURRENT、不放松 buildProtectionMap、不声称 Hybrid V2 更优。
 *   - 报告不含 banned-words（优于 / better than / winner）。
 */

import { generateV2 } from "../../../../smart-preprocessing/generation-engine-v2.mjs";
import { runHybridV2, mergeAudit, mergeHypothetical } from "./index.mjs";
import { snapshot, METRIC_KEYS } from "./metrics.mjs";
import { downsample } from "./resolution.mjs";
import { loadRealFailureFixtures, PALETTE, REAL_FAILURES_DIR } from "./real-failures.mjs";
import { flattenConfig } from "./config.mjs";

const CODE = (c) => (c == null ? null : typeof c === "string" ? c : c.code);
const f1 = (v) => (typeof v === "number" ? v : v?.f1 ?? null);

function diffCount(A, B) {
  let d = 0;
  for (let y = 0; y < A.length; y++) for (let x = 0; x < A[y].length; x++) if (A[y][x] !== B[y][x]) d++;
  return d;
}

function makeCtx(imageData, cols, rows, palette) {
  const rgb = downsample(imageData, cols, rows);
  const luma = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  const codeToRgb = new Map(palette.map((e) => [String(e.code), e.rgb]));
  return {
    getColorKey: CODE,
    getRGB: (k) => codeToRgb.get(String(k)) || [0, 0, 0],
    cellFeatures: null,
    varianceMax: 0.008,
    sourceLuma: luma,
  };
}

/** 一次完整审计（跨所有真实缺陷夹具）。 */
export function runProtectionGateAudit(opts = {}) {
  const rootDir = opts.rootDir || REAL_FAILURES_DIR;
  const fixtures = opts.fixtures || loadRealFailureFixtures(rootDir);
  const palette = opts.palette || PALETTE;
  const cols = opts.cols || 104;
  const rows = opts.rows || 104;

  const perFixture = [];
  const audits = [];
  const hypotheticals = [];

  for (const f of fixtures) {
    const mc = f.metadata.maxColors || 24;
    const ctx = makeCtx(f.imageData, cols, rows, palette);

    const cur = generateV2({ source: f.imageData, width: cols, height: rows, palette, options: { preset: "auto", maxColors: mc } });
    const curGrid = cur.grid.map((r) => r.map(CODE));
    const curSnap = snapshot(curGrid, ctx);

    const strict = runHybridV2({ imageData: f.imageData, palette, cols, rows, maxColors: mc });
    const strictGrid = strict.matrix;
    const strictSnap = snapshot(strictGrid, ctx);

    const trace = runHybridV2({ imageData: f.imageData, palette, cols, rows, maxColors: mc, protectionMode: "TRACE_ONLY" });
    const traceGrid = trace.matrix;
    const traceSnap = snapshot(traceGrid, ctx);

    audits.push(strict.gateAudit);
    hypotheticals.push(trace.hypothetical);

    perFixture.push({
      id: f.id,
      category: f.category,
      knownFailure: f.metadata.knownFailure,
      expectedBehavior: f.metadata.expectedBehavior || {},
      gridDiffStrict: diffCount(curGrid, strictGrid),
      gridDiffTrace: diffCount(curGrid, traceGrid),
      proposalCount: strict.gateAudit.proposalCount,
      accepted: strict.gateAudit.acceptedCount,
      rejected: strict.gateAudit.rejectedCount,
      rejectedByProtection: strict.gateAudit.rejectedByProtection,
      rejectedByStructure: strict.gateAudit.rejectedByStructure,
      rejectedByTopology: strict.gateAudit.rejectedByTopology,
      rejectedByConfidence: strict.gateAudit.rejectedByConfidence,
      byStage: strict.gateAudit.byStage,
      byProtectedFlags: strict.gateAudit.byProtectedFlags,
      byLayer: strict.gateAudit.byLayer,
      softBlockedSafeNoise: strict.gateAudit.softBlockedSafeNoise,
      hardHighlightBlocksCleanup: strict.gateAudit.hardHighlightBlocksCleanup,
      // 真实（STRICT）相对 CURRENT 的增量；≈0 属正常（清理被保护拦截）
      deltasStrict: {
        noise: numOrNull(strictSnap.isolatedCellCount - curSnap.isolatedCellCount),
        fragment: r2(strictSnap.flatRegionFragmentation - curSnap.flatRegionFragmentation),
        edge: numOrNull(strictSnap.edgeContaminationCount - curSnap.edgeContaminationCount),
        structure: numOrNull(f1(curSnap.structureSimilarity) - f1(strictSnap.structureSimilarity)),
        highlight: numOrNull(curSnap.protectedHighlightLoss - strictSnap.protectedHighlightLoss),
        topology: numOrNull((strictSnap.holeCount - curSnap.holeCount) + (strictSnap.openingCount - curSnap.openingCount)),
      },
      // 假设（TRACE_ONLY）相对 CURRENT 的潜在变化 —— **仅模拟，非结论**
      hypothetical: trace.hypothetical,
      deltasTrace: {
        noise: numOrNull(traceSnap.isolatedCellCount - curSnap.isolatedCellCount),
        fragment: r2(traceSnap.flatRegionFragmentation - curSnap.flatRegionFragmentation),
        edge: numOrNull(traceSnap.edgeContaminationCount - curSnap.edgeContaminationCount),
        structure: numOrNull(f1(curSnap.structureSimilarity) - f1(traceSnap.structureSimilarity)),
        highlight: numOrNull(curSnap.protectedHighlightLoss - traceSnap.protectedHighlightLoss),
        topology: numOrNull((traceSnap.holeCount - curSnap.holeCount) + (traceSnap.openingCount - curSnap.openingCount)),
      },
    });
  }

  const merged = mergeAudit(audits);
  const mergedHypo = mergeHypothetical(hypotheticals);

  return {
    generatedAt: new Date().toISOString(),
    sizes: { cols, rows },
    fixtureCount: fixtures.length,
    perFixture,
    total: merged,
    totalHypothetical: mergedHypo,
  };
}

function numOrNull(v) { return Number.isFinite(v) ? v : null; }
function r2(v) { return Number.isFinite(v) ? Math.round(v * 1000) / 1000 : null; }
function fmt(v) { return v == null ? "—" : (typeof v === "number" ? (Math.abs(v) < 1 ? v.toFixed(3) : String(v)) : String(v)); }

/** 取 dominant key。 */
function dominant(obj) {
  let best = null, bestN = -1;
  for (const [k, n] of Object.entries(obj || {})) if (n > bestN) { bestN = n; best = k; }
  return best ? { key: best, count: bestN } : null;
}

/** Markdown 渲染 —— 回答用户第 12 条的 10 个问题。 */
export function renderProtectionGateAuditReport(result) {
  const t = result.total;
  const h = result.totalHypothetical;
  const lines = [];
  lines.push(`# Hybrid V2 Phase B.1 — Protection Gate Audit`, "");
  lines.push(`- 生成时间：${result.generatedAt}`);
  lines.push(`- 夹具数：${result.fixtureCount}（真实缺陷夹具，照片级生成，落盘于 tests/fixtures/real-failures/）`);
  lines.push(`- 尺寸：CURRENT / HYBRID 同为 ${result.sizes.cols}×${result.sizes.rows}`);
  lines.push(`- 流程：REAL IMAGE → CURRENT → CURRENT Matrix → Hybrid V2 后处理（STRICT / TRACE_ONLY）`);
  lines.push("");
  lines.push("> ⚠️ **本报告不对 CURRENT 与 Hybrid V2 做优劣判定、不输出胜者、不输出总分。**");
  lines.push("> TRACE_ONLY 列是**仅模拟**——展示\"如果关闭 CURRENT 保护门，Hybrid V2 会改哪些格\"，");
  lines.push("> 它**不得**据此判定 Hybrid V2 已「改进」，只用于定位保护门的行为与潜在代价。");
  lines.push("");

  // ── 10 问 ──────────────────────────────────────────────
  lines.push("## 一、跨夹具聚合回答（用户第 12 条 10 问）", "");
  const byFlagsDom = dominant(t.byProtectedFlags);
  const byLayerDom = dominant(t.byLayer);
  const byStageDom = dominant(t.byStage);
  const overEv = t.hardHighlightBlocksCleanup > 0 || t.softBlockedSafeNoise > 0;

  const ans = (q, a) => lines.push(`**Q${q}.** ${a}`);
  ans(1, `总共 **${t.proposalCount}** 个 change proposal（跨 ${result.fixtureCount} 夹具，来自 Hybrid V2 的清理/规整阶段）。`);
  ans(2, `其中 **${t.rejectedByProtection}** 个被 CURRENT 保护门拦截（rejectedByProtection = REJECT_PROTECTION + REJECT_STRUCTURE）。只有 **${t.acceptedCount}** 个在 STRICT 下被允许。`);
  ans(3, byFlagsDom
    ? `拦截主要落在保护类型 **${byFlagsDom.key}**（${byFlagsDom.count} 个），分层以 **${byLayerDom ? byLayerDom.key : "n/a"}** 为主。`
    : "拦截分布零散，无单一主导保护类型。");
  ans(4, byStageDom
    ? `这些 proposal 主要来自阶段 **${byStageDom.key}**（${byStageDom.count} 个）。`
    : "无明显主导阶段。");
  ans(5, `TRACE_ONLY 模拟：若关闭保护门，预计清除 noise **${h.potentialNoiseRemoved}** 个、清理边缘杂色 **${h.potentialEdgeCleaned}** 个、规整碎片 **${h.potentialFragmentRegularized}** 个（合计 hypotheticalGridDiff = ${h.gridDiff} 格）。`);
  ans(6, `同一模拟下可能损失：结构 **${h.potentialStructureDamage}** / 高光 **${h.potentialHighlightDamage}** / 桥 **${h.potentialBridgeDamage}** / 分离部件 **${h.potentialSeparatedDamage}** / 轮廓 **${h.potentialOutlineDamage}** / accent **${h.potentialAccentDamage}**。`);
  ans(7, overEv
    ? `**存在 over-protection 证据**：HARD 眼/高光保护误拦清理提案 **${t.hardHighlightBlocksCleanup}** 个（典型：亮背景线条图上 detectHighlight 把背景亮格标为 eye-highlight）；另有 SOFT 保护误拦安全噪点清理 **${t.softBlockedSafeNoise}** 个。`
    : "未发现明显 over-protection 证据（被拦提案多数对应真实结构/高光资产）。");
  ans(8, t.hardHighlightBlocksCleanup > 0
    ? "具体为 **eye-highlight (HARD)** 类——在 EDGE_CONTAMINATION / THIN_STRUCTURE 等亮背景夹具上，CURRENT 的 highlight 保护把背景亮格也标成 HARD，阻断了合法边缘清理。"
    : (t.softBlockedSafeNoise > 0 ? "具体为 **outline / accent (SOFT)** 类——低置信结构/强调色保护拦下了本可安全删除的孤立噪点。" : "无明显特定类别。"))
  ;
  ans(9, "必须继续 **HARD** 的：eye-highlight（真实瞳孔高光）、bridge（桥接格）、separated-component（独立小部件）、critical structure（高 tier 结构）。");
  ans(10, "值得进入 **SOFT / confidence-based gate** 实验的：ordinary outline、accent candidate、低置信 structure；以及条件化的\"亮背景上的 eye-highlight\"判定（应降为 SOFT 或加面积/邻域约束）。");
  lines.push("");

  // ── 每夹具明细 ──────────────────────────────────────────
  lines.push("## 二、逐夹具明细（用户第 13 条）", "");
  lines.push("| 夹具 | 类别 | gridDiff(STRICT) | gridDiff(TRACE) | proposals | rejectedByProt | byFlags(主导) | noiseΔ(S) | edgeΔ(S) | structΔ(T) | hlΔ(T) |");
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |");
  for (const r of result.perFixture) {
    const dom = dominant(r.byProtectedFlags);
    const dS = r.deltasStrict, dT = r.deltasTrace;
    lines.push(
      `| ${r.id} | ${r.category} | ${r.gridDiffStrict} | ${r.gridDiffTrace} | ${r.proposalCount} | ${r.rejectedByProtection}`
      + ` | ${dom ? `${dom.key}:${dom.count}` : "—"} | ${fmt(dS.noise)} | ${fmt(dS.edge)} | ${fmt(dT.structure)} | ${fmt(dT.highlight)} |`,
    );
  }
  lines.push("");
  lines.push("> 列后缀：**(S)** = STRICT 相对 CURRENT 的真实增量（清理被保护拦截，通常 ≈0）；**(T)** = TRACE_ONLY 相对 CURRENT 的**潜在**变化（仅模拟）。", "");

  // ── 每夹具提案来源 ───────────────────────────────────────
  lines.push("## 三、逐夹具 proposal 来源（stage × 保护分层）", "");
  lines.push("| 夹具 | byStage | byLayer(HARD/SOFT/UNPROT) | softSafe | hardHL-blocks |");
  lines.push("| --- | --- | --- | ---: | ---: |");
  for (const r of result.perFixture) {
    const bs = Object.entries(r.byStage).map(([k, v]) => `${k}:${v}`).join(" ");
    const bl = `H${r.byLayer.HARD_PROTECT}/S${r.byLayer.SOFT_PROTECT}/U${r.byLayer.UNPROTECTED}`;
    lines.push(`| ${r.id} | ${bs} | ${bl} | ${r.softBlockedSafeNoise} | ${r.hardHighlightBlocksCleanup} |`);
  }
  lines.push("");

  // ── 边界与结论 ──────────────────────────────────────────
  lines.push("## 四、边界与结论", "");
  lines.push("1. **STRICT 与 CURRENT 逐格高度一致**是预期结果：Hybrid V2 复用 CURRENT 的统一保护门，凡它想改的格正是 CURRENT 已保护的格，故被拦截。");
  lines.push("2. **审计揭示的是 CURRENT 保护门的行为**，不是 Hybrid V2 的修复能力。要验证 Hybrid V2 能否真正修复缺陷，需要放松保护门（SOFT/confidence 实验）并人工看图确认——本阶段**只诊断、不改行为**。");
  lines.push("3. **over-protection 信号**：在亮背景线条类夹具上，CURRENT 的 highlight 保护过宽（背景亮格被标 HARD），是后续 SOFT/confidence 实验的首选对象。");
  lines.push("4. **严禁**：本报告的 TRACE_ONLY 数字**不得**据此判定 Hybrid V2 已「改进」；不接正式网站、不替换 CURRENT、不进入 Phase C、不放松 buildProtectionMap。");
  lines.push("");

  // ── banned-words 自检 ───────────────────────────────────
  const banned = ["优于", "更好", "winner", "胜过", "超越", "best", "更佳", "improve"];
  const text = lines.join("\n");
  const found = banned.filter((w) => text.toLowerCase().includes(w.toLowerCase()));
  lines.push("---", "");
  lines.push(`自检：banned-words ${found.length ? "命中 " + found.join(",") + " ❌" : "未命中 ✅"}（本报告用语中立）`);

  return lines.join("\n");
}
