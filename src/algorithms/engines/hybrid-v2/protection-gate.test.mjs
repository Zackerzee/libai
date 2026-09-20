/**
 * Protection Gate 可解释性诊断测试（Phase B.1）。
 *
 * 覆盖：Change Proposal Trace、gateAudit 聚合、STRICT vs TRACE_ONLY、保护分层、
 * Proposal Value 字段、真实缺陷夹具加载。
 *
 * 铁律：只验证**诊断与记录**行为，不假设 Hybrid V2 比 CURRENT 更优；
 * 不验证具体改格数量（CURRENT 行为可能随版本微调），只验证结构性质。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  runHybridV2, DECISION, PROTECTION_LAYER, STAGE,
} from "./index.mjs";
import {
  ProposalTracer, classifyCleanupBenefit, classifyDamageRisk,
} from "./trace.mjs";
import { classifyProtectionLayer, MASK_LAYER } from "./protected-mask.mjs";
import { COMPONENT_CATEGORY } from "./classify.mjs";
import {
  loadRealFailureFixtures, generateRealFailureFixtures, PALETTE,
} from "./real-failures.mjs";

const PROPOSAL_FIELDS = [
  "x", "y", "fromColor", "toColor", "stage", "reason", "confidence",
  "localVariance", "componentSize", "boundaryRatio", "deltaE", "edgeStrength",
  "protectedFlags", "topologyFlags", "category", "protectionLayer",
  "decision", "cleanupBenefit", "damageRisk",
];

function firstFixture(id) {
  generateRealFailureFixtures();
  const list = loadRealFailureFixtures();
  return list.find((f) => f.id === id) || list[0];
}

test("真实缺陷夹具可生成且可复现", () => {
  const created = generateRealFailureFixtures();
  assert.equal(created.length, 8);
  const list = loadRealFailureFixtures();
  assert.equal(list.length, 8);
  for (const f of list) {
    assert.ok(f.imageData.width === 256 && f.imageData.height === 256, `${f.id} 应为 256×256`);
    assert.ok(f.metadata && f.metadata.category, `${f.id} 应有 category`);
  }
  // 复现性：再 generate 不改变已存在文件（首像素一致）
  const before = loadRealFailureFixtures()[0].imageData.data[0];
  generateRealFailureFixtures();
  const after = loadRealFailureFixtures()[0].imageData.data[0];
  assert.equal(before, after, "夹具应可复现");
});

test("STRICT 模式：提案被记录且保护门拦截", () => {
  const f = firstFixture("rf-edge-contam");
  const mc = f.metadata.maxColors;
  const res = runHybridV2({ imageData: f.imageData, palette: PALETTE, cols: 104, rows: 104, maxColors: mc });
  assert.equal(res.protectionMode, "STRICT");
  assert.ok(Array.isArray(res.proposalTrace), "应返回 proposalTrace");
  assert.equal(res.proposalTrace.length, res.gateAudit.proposalCount, "trace 长度应等于 proposalCount");

  // 每个提案字段齐全、decision 合法
  for (const p of res.proposalTrace) {
    for (const key of PROPOSAL_FIELDS) assert.ok(key in p, `提案缺字段 ${key}`);
    assert.ok(Object.values(DECISION).includes(p.decision), `非法 decision: ${p.decision}`);
  }

  // 保护门拦截数 = REJECT_PROTECTION + REJECT_STRUCTURE
  const blockedByProtection = res.proposalTrace.filter(
    (p) => p.decision === DECISION.REJECT_PROTECTION || p.decision === DECISION.REJECT_STRUCTURE,
  ).length;
  assert.equal(res.gateAudit.rejectedByProtection, blockedByProtection, "rejectedByProtection 应等于 REJECT_PROTECTION+REJECT_STRUCTURE");

  // rf-edge-contam 存在被拦截的清理提案
  assert.ok(res.gateAudit.rejectedByProtection > 0, "应存在被保护门拦截的提案（该夹具含边缘杂色）");
});

test("保护分层 classifyProtectionLayer", () => {
  assert.equal(classifyProtectionLayer({ layer: MASK_LAYER.EYE_HIGHLIGHT }), PROTECTION_LAYER.HARD_PROTECT);
  assert.equal(classifyProtectionLayer({ layer: MASK_LAYER.OUTLINE }), PROTECTION_LAYER.SOFT_PROTECT);
  assert.equal(classifyProtectionLayer({ layer: MASK_LAYER.ACCENT }), PROTECTION_LAYER.SOFT_PROTECT);
  assert.equal(classifyProtectionLayer({ layer: MASK_LAYER.STRUCTURE, tier: 3 }), PROTECTION_LAYER.HARD_PROTECT);
  assert.equal(classifyProtectionLayer({ layer: MASK_LAYER.STRUCTURE, tier: 2 }), PROTECTION_LAYER.SOFT_PROTECT);
  assert.equal(
    classifyProtectionLayer({ layer: MASK_LAYER.SMALL_SEPARATED, category: COMPONENT_CATEGORY.BRIDGE }),
    PROTECTION_LAYER.HARD_PROTECT,
  );
  assert.equal(
    classifyProtectionLayer({ layer: MASK_LAYER.SMALL_SEPARATED, category: COMPONENT_CATEGORY.SEPARATED_COMPONENT }),
    PROTECTION_LAYER.HARD_PROTECT,
  );
  assert.equal(
    classifyProtectionLayer({ layer: MASK_LAYER.SMALL_SEPARATED, category: COMPONENT_CATEGORY.DETAIL, tier: 2 }),
    PROTECTION_LAYER.SOFT_PROTECT,
  );
  assert.equal(classifyProtectionLayer({ layer: MASK_LAYER.NONE }), PROTECTION_LAYER.UNPROTECTED);
});

test("Proposal Value：cleanupBenefit / damageRisk 推导", () => {
  assert.equal(classifyCleanupBenefit(STAGE.EDGE), "edge-contamination");
  assert.equal(classifyCleanupBenefit(STAGE.FRAGMENT), "isolated-noise");
  assert.equal(classifyCleanupBenefit(STAGE.FLAT), "fragmentation");
  assert.equal(classifyCleanupBenefit("其他"), null);

  assert.equal(
    classifyDamageRisk({ protectionLayer: PROTECTION_LAYER.HARD_PROTECT, protectedFlags: "eye-highlight" }),
    "highlight",
  );
  assert.equal(
    classifyDamageRisk({ protectionLayer: PROTECTION_LAYER.SOFT_PROTECT, protectedFlags: "outline" }),
    "outline",
  );
  assert.equal(
    classifyDamageRisk({ protectionLayer: PROTECTION_LAYER.UNPROTECTED }),
    null,
  );
});

test("TRACE_ONLY 模式：绕过保护门、仅模拟、记录 TRACE_HYPOTHETICAL", () => {
  const f = firstFixture("rf-aa-leak");
  const mc = f.metadata.maxColors;
  const strict = runHybridV2({ imageData: f.imageData, palette: PALETTE, cols: 104, rows: 104, maxColors: mc, protectionMode: "STRICT" });
  const trace = runHybridV2({ imageData: f.imageData, palette: PALETTE, cols: 104, rows: 104, maxColors: mc, protectionMode: "TRACE_ONLY" });

  assert.equal(trace.protectionMode, "TRACE_ONLY");
  const hypo = trace.proposalTrace.filter((p) => p.decision === DECISION.TRACE_HYPOTHETICAL);
  assert.ok(hypo.length > 0, "TRACE_ONLY 应产生 TRACE_HYPOTHETICAL 提案");
  assert.equal(trace.hypothetical.gridDiff, hypo.length, "hypothetical.gridDiff 应等于 TRACE_HYPOTHETICAL 数");

  // trace 的假设网格应相对 STRICT 有变化（保护门被绕过）
  let diff = 0;
  for (let y = 0; y < 104; y++) for (let x = 0; x < 104; x++) if (strict.matrix[y][x] !== trace.matrix[y][x]) diff++;
  assert.ok(diff > 0, "TRACE_ONLY 假设网格应不同于 STRICT");

  // 同一夹具 STRICT 下这些提案被保护拦截（对照）
  const blocked = strict.proposalTrace.filter(
    (p) => p.decision === DECISION.REJECT_PROTECTION || p.decision === DECISION.REJECT_STRUCTURE,
  ).length;
  assert.ok(blocked > 0, "对照：STRICT 下这些提案应被保护拦截");
});

test("ProposalTracer.audit 聚合正确", () => {
  const tr = new ProposalTracer({ mode: "STRICT" });
  tr.record({ decision: DECISION.ACCEPT, protectionLayer: PROTECTION_LAYER.UNPROTECTED, protectedFlags: "none", cleanupBenefit: null, damageRisk: null });
  tr.record({ decision: DECISION.REJECT_STRUCTURE, protectionLayer: PROTECTION_LAYER.HARD_PROTECT, protectedFlags: "eye-highlight", cleanupBenefit: "edge-contamination", damageRisk: "highlight", category: "NOISE" });
  tr.record({ decision: DECISION.REJECT_PROTECTION, protectionLayer: PROTECTION_LAYER.SOFT_PROTECT, protectedFlags: "outline", cleanupBenefit: "isolated-noise", damageRisk: null });
  const a = tr.audit();
  assert.equal(a.proposalCount, 3);
  assert.equal(a.acceptedCount, 1);
  assert.equal(a.rejectedByProtection, 2);
  assert.equal(a.rejectedByStructure, 1);
  assert.equal(a.hardHighlightBlocksCleanup, 1, "HARD 眼/高光误拦清理应被计入");
  assert.equal(a.softBlockedSafeNoise, 1, "SOFT 误拦安全噪点应被计入");
});
