/**
 * Stage B4 §13.7 —— 硬约束过滤器契约（§7）。
 *
 * §7 的原话是「不要让『平均分高』掩盖硬失败」。所以这里的每一条测试都在问
 * 同一个问题：**违规的候选有没有被真的淘汰？** 而不是「分数掉了多少」。
 *
 * 六条约束各测两侧：
 *   · 越界 → 必须报 violation（id 精确到条）
 *   · 恰好压线 → 必须通过（阈值是「不超过」，不是「小于」）
 *
 * 另外守三条结构性的事：
 *   · standard 永远通过（§23 要求它一定可用作兜底）
 *   · 约束求值抛错 → 记 violation，不炸整轮（一个坏条目不该毁掉全部候选）
 *   · 每条约束声明自己依赖哪些字段（与 §12 的 ROUTING_HARD_RULES 同一种写法）
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_DEFAULTS,
  HARD_CONSTRAINTS,
  checkHardConstraints,
} from "../services/auto-tune.mjs";
import { makeCtx, makeEntry, metricKeyProbe } from "./auto-tune-fixtures.mjs";

const IDS = ["A-maxColors", "B-nullIntegrity", "C-determinism", "D-structure-loss",
  "E-runtime-budget", "F-edge-regression", "G-resemblance"];

const violated = (entry, ctx) => checkHardConstraints(entry, ctx).violations.map((v) => v.id);

/** 一份「标准赢不了」的基线：standard 的每个指标都给定值。 */
const STANDARD_METRICS = Object.freeze({
  usedColors: 12,
  nullCells: 40,
  perceptualError: 8.0,
  edgeRetention: 0.80,
  detailRetention: 0.90,
  flatAreaStability: 0.85,
  fragmentation: 12.0,
  isolatedPixels: 30,
});

function std(metrics = {}) {
  return makeEntry("smart-standard", { ...STANDARD_METRICS, ...metrics }, { nullMaskHash: "aaaa0000" });
}

function challenger(metrics = {}, extra = {}) {
  return makeEntry("smart-detail-safe", { ...STANDARD_METRICS, ...metrics },
    { nullMaskHash: "aaaa0000", ...extra });
}

/* =========================================================
 * 结构
 * ======================================================= */

test("§7 六条约束齐全，id 精确且顺序固定", () => {
  assert.deepEqual(HARD_CONSTRAINTS.map((c) => c.id), IDS,
    "硬约束集合被改了 —— §7 要求至少有 A–F 这六条（G 是实测补上的第七条）");
  for (const rule of HARD_CONSTRAINTS) {
    assert.equal(typeof rule.label, "string", `${rule.id} 没有中文说明`);
    assert.equal(typeof rule.test, "function", `${rule.id} 没有 test`);
    assert.ok(Array.isArray(rule.evidence), `${rule.id} 没有声明 evidence（反查用）`);
  }
});

test("§7 每条约束声明的 evidence 都是真实存在的字段", () => {
  const { keys } = metricKeyProbe();
  const known = new Set([...keys, "runtimeMs", "nullMaskHash"]);
  for (const rule of HARD_CONSTRAINTS) {
    for (const field of rule.evidence) {
      assert.ok(known.has(field),
        `${rule.id} 声明依赖 ${field}，但它不在指标/条目字段里（真实字段：${[...known].join(", ")}）`);
    }
  }
});

test("§23 standard 永远通过全部约束（它的每条都是相对自己）", () => {
  const entry = std();
  const ctx = makeCtx({ standard: entry, effectiveMaxColors: 12 });
  const result = checkHardConstraints(entry, ctx);
  assert.equal(result.ok, true, `standard 被自己的约束淘汰了：${JSON.stringify(result.violations)}`);
  assert.deepEqual(result.violations, []);
});

/* =========================================================
 * A —— 用色数
 * ======================================================= */

test("§7A 用色数超上限 → 淘汰；恰好等于上限 → 通过；上限 0 → 不限额", () => {
  const standard = std();
  const over = challenger({ usedColors: 13 });
  assert.deepEqual(violated(over, makeCtx({ standard, effectiveMaxColors: 12 })), ["A-maxColors"]);

  const exact = challenger({ usedColors: 12 });
  assert.equal(checkHardConstraints(exact, makeCtx({ standard, effectiveMaxColors: 12 })).ok, true,
    "恰好等于上限被淘汰了 —— 阈值是「不超过」，不是「小于」");

  const unlimited = challenger({ usedColors: 9999 });
  assert.equal(checkHardConstraints(unlimited, makeCtx({ standard, effectiveMaxColors: 0 })).ok, true,
    "maxColors = 0 应该表示不限额");
});

/* =========================================================
 * B —— 空豆完整性
 * ======================================================= */

test("§7B 空豆数量变了 → 淘汰", () => {
  const standard = std();
  const entry = challenger({ nullCells: 41 });
  assert.deepEqual(violated(entry, makeCtx({ standard })), ["B-nullIntegrity"]);
});

test("§7B 空豆数量对了但位置错了 → 一样淘汰（数量对不等于掩码对）", () => {
  const standard = std();
  // 数量一致（40），指纹不同 —— 这正是「数量对、位置错」的形状。
  const entry = challenger({ nullCells: 40 }, { nullMaskHash: "bbbb1111" });
  assert.deepEqual(violated(entry, makeCtx({ standard })), ["B-nullIntegrity"],
    "只比了数量、没比位置 —— 空豆被挪走一格是看不出来的");
});

/* =========================================================
 * C —— 确定性
 * ======================================================= */

test("§7C 确定性：显式 false → 淘汰；未取证（null/undefined）→ 通过", () => {
  const standard = std();
  const entry = challenger();
  assert.deepEqual(violated(entry, makeCtx({ standard, determinismVerified: false })), ["C-determinism"]);

  for (const value of [null, undefined, true]) {
    assert.equal(checkHardConstraints(entry, makeCtx({ standard, determinismVerified: value })).ok, true,
      `determinismVerified = ${String(value)} 被当成失败了 —— 未取证不等于失败`);
  }
});

/* =========================================================
 * D —— 结构损失
 * ======================================================= */

test("§7D 细节保持跌破 standard − 容差 → 淘汰；恰好压线 → 通过", () => {
  const standard = std();
  const t = AUTO_TUNE_DEFAULTS.structureLossTolerance;   // 0.05
  const below = challenger({ detailRetention: 0.90 - t - 0.001 });
  assert.deepEqual(violated(below, makeCtx({ standard })), ["D-structure-loss"]);

  const exact = challenger({ detailRetention: 0.90 - t });
  assert.equal(checkHardConstraints(exact, makeCtx({ standard })).ok, true,
    "恰好等于容差边界被淘汰了 —— 阈值是「不超过」");
});

test("§7D 平区稳定跌破阈值同样淘汰（不只是细节）", () => {
  const standard = std();
  const below = challenger({ flatAreaStability: 0.85 - 0.051 });
  assert.deepEqual(violated(below, makeCtx({ standard })), ["D-structure-loss"]);
});

test("§7D 指标缺失时不当成「崩了」——缺证据就不判违规", () => {
  const standard = makeEntry("smart-standard", { usedColors: 12, nullCells: 0 });
  const entry = makeEntry("smart-detail-safe", { usedColors: 12, nullCells: 0 });
  assert.equal(checkHardConstraints(entry, makeCtx({ standard })).ok, true,
    "指标缺失被读成了失败 —— 那会让「测不出来」变成「不许用」");
});

/* =========================================================
 * E —— 运行预算
 * ======================================================= */

test("§7E 单候选超预算 → 淘汰；恰好等于预算 → 通过", () => {
  const standard = std();
  const budget = AUTO_TUNE_DEFAULTS.candidateRuntimeBudgetMs;
  assert.deepEqual(violated(challenger({}, { runtimeMs: budget + 1 }), makeCtx({ standard })),
    ["E-runtime-budget"]);
  assert.equal(checkHardConstraints(challenger({}, { runtimeMs: budget }), makeCtx({ standard })).ok, true);
});

/* =========================================================
 * F —— 边缘崩坏
 * ======================================================= */

test("§7F 边缘保持跌破 standard − 容差 → 淘汰；恰好压线 → 通过", () => {
  const standard = std();
  const t = AUTO_TUNE_DEFAULTS.edgeLossTolerance;        // 0.10
  assert.deepEqual(violated(challenger({ edgeRetention: 0.80 - t - 0.001 }), makeCtx({ standard })),
    ["F-edge-regression"]);
  assert.equal(checkHardConstraints(challenger({ edgeRetention: 0.80 - t }), makeCtx({ standard })).ok, true);
});

test("§7F 边缘指标缺失 → 通过（缺证据不判违规）", () => {
  const standard = makeEntry("smart-standard", { usedColors: 12, nullCells: 0, edgeRetention: null });
  const entry = makeEntry("smart-detail-safe", { usedColors: 12, nullCells: 0, edgeRetention: null });
  assert.equal(checkHardConstraints(entry, makeCtx({ standard })).ok, true);
});

/* =========================================================
 * G —— 整体不许崩掉
 * ======================================================= */

test("§7G 色差成倍恶化 → 淘汰；恰好压线 → 通过；轻微恶化 → 通过", () => {
  const standard = std();                                  // perceptualError 8.0
  const limits = AUTO_TUNE_DEFAULTS;
  const cap = 8.0 * limits.perceptualRegressionFactor + limits.perceptualRegressionFloor;  // 17.0

  assert.deepEqual(violated(challenger({ perceptualError: cap + 0.01 }), makeCtx({ standard })),
    ["G-resemblance"]);
  assert.equal(checkHardConstraints(challenger({ perceptualError: cap }), makeCtx({ standard })).ok, true,
    "恰好等于上限被淘汰了 —— 阈值是「不超过」");
  assert.equal(checkHardConstraints(challenger({ perceptualError: 9.0 }), makeCtx({ standard })).ok, true,
    "轻微恶化就被淘汰了 —— 门槛过紧会把正常候选一起挡掉");
});

test("§7G standard 色差为 0（近无损）时留出绝对余量，不用倍数去卡", () => {
  const standard = std({ perceptualError: 0 });
  const limits = AUTO_TUNE_DEFAULTS;
  assert.equal(checkHardConstraints(challenger({ perceptualError: limits.perceptualRegressionFloor }),
    makeCtx({ standard })).ok, true, "standard 色差为 0 时倍数门变成 0，正常候选全被挡掉");
});

test("§7G 指标缺失 → 通过（缺证据不判违规）", () => {
  const standard = std({ perceptualError: null });
  assert.equal(checkHardConstraints(challenger({ perceptualError: 999 }), makeCtx({ standard })).ok, true);
  const standard2 = std();
  assert.equal(checkHardConstraints(challenger({ perceptualError: null }), makeCtx({ standard: standard2 })).ok, true);
});

/* =========================================================
 * 多条同时违规 + 抛错路径
 * ======================================================= */

test("§7 多条同时违规 → 全部报出来，不是只报第一条", () => {
  const standard = std();
  const entry = challenger(
    { usedColors: 99, nullCells: 41, detailRetention: 0.10, edgeRetention: 0.10, perceptualError: 999 },
    { nullMaskHash: "cccc2222", runtimeMs: 999999 },
  );
  const ids = violated(entry, makeCtx({ standard, effectiveMaxColors: 12 }));
  for (const id of IDS) {
    if (id === "C-determinism") continue;
    assert.ok(ids.includes(id), `${id} 没被报出来（报出来的是 ${ids.join(", ")}）`);
  }
});

test("§7 约束求值抛错 → 记 violation，不炸整轮", () => {
  const standard = std();
  // metrics 为 null：A 条 `entry.metrics.usedColors` 会抛。
  const broken = makeEntry("smart-detail-safe", null, { nullMaskHash: "aaaa0000" });
  const result = checkHardConstraints(broken, makeCtx({ standard, effectiveMaxColors: 12 }));
  assert.equal(result.ok, false);
  assert.ok(result.violations.length >= 1, "抛错的条目被静默放过了");
  const detail = result.violations.find((v) => typeof v.detail === "string");
  assert.ok(detail, "抛错时没有留下可读原因 —— 报告里只会看到一个没头没尾的淘汰");
  assert.match(detail.detail, /约束求值抛错/);
});

test("§7 报告口径：ok === (violations.length === 0)", () => {
  const standard = std();
  for (const entry of [standard, challenger({ usedColors: 99 })]) {
    const r = checkHardConstraints(entry, makeCtx({ standard, effectiveMaxColors: 12 }));
    assert.equal(r.ok, r.violations.length === 0);
  }
});
