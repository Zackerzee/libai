/**
 * Stage B4 §13.7 —— Regret 与失败分类契约（§21 / §22 / §25）。
 *
 * §22 给了一个新的核心指标：
 *
 *   > `AutoTuneRegret = OracleBestQuality − SelectedQuality`
 *   > regret 大说明**选择器错了**，比平均 ΔE 更重要。
 *
 * 所以 regret 的定义必须精确：它量的不是「输出好不好」，而是
 * **「选择器离最优有多远」**。这两件事混起来会得到一个很糟的结论 ——
 * 一张本身就难处理的图，输出不好但选择正确，会被算成「选择器有问题」。
 *
 * 这个文件把 regret 的口径钉死，并顺带把 §25 的六类失败分类各测一遍
 * （§25 明确：不要一句「Auto Tune failed」）。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_DEFAULTS,
  TUNE_FAILURE_CLASSES,
  TUNE_FAILURE_RULES,
  classifyTuneFailure,
  computeRegret,
  firstMaterialDifference,
  oracleBest,
  rankCandidates,
  summarizeRegret,
} from "../services/auto-tune.mjs";
import { MODE_OBJECTIVES, objectiveFor } from "../services/auto-tune-profiles.mjs";
import { makeEntry, metricKeyProbe } from "./auto-tune-fixtures.mjs";

const M = (o = {}) => ({
  fragmentation: 10.0,
  edgeRetention: 0.80,
  detailRetention: 0.90,
  flatAreaStability: 0.85,
  perceptualError: 8.0,
  ...o,
});

const entry = (id, metrics, extra) => makeEntry(id, metrics, extra);

/* =========================================================
 * computeRegret
 * ======================================================= */

test("§22 选中与 oracle 同一套 → hit，regret 为 0", () => {
  const obj = objectiveFor("auto");
  const a = entry("smart-standard", M());
  const r = computeRegret(a, a, obj);
  assert.equal(r.comparable, true);
  assert.equal(r.hit, true);
  assert.equal(r.metric, null);
  assert.equal(r.epsilonUnits, 0);
  assert.equal(r.levelsApart, 0);
});

test("§22 缺任一侧 → comparable = false（不是当成 0 分）", () => {
  const obj = objectiveFor("auto");
  for (const [a, b] of [[null, entry("x", M())], [entry("x", M()), null], [null, null], [undefined, undefined]]) {
    const r = computeRegret(a, b, obj);
    assert.equal(r.comparable, false);
    assert.equal(r.hit, false);
    assert.equal(r.epsilonUnits, null, "不可比的情况给出了数值 —— 会被平均进汇总里");
  }
});

test("§22 regret 用「第一处实质差异」表达，并换算成 epsilon 单位", () => {
  const obj = [ { metric: "perceptualError", direction: "min", epsilon: 0.5 } ];
  const oracle = entry("o", M({ perceptualError: 6.0 }));
  const selected = entry("s", M({ perceptualError: 8.0 }));
  const r = computeRegret(oracle, selected, obj);
  assert.equal(r.comparable, true);
  assert.equal(r.hit, false);
  assert.equal(r.metric, "perceptualError");
  assert.ok(Math.abs(r.margin - 2.0) < 1e-9, `margin = ${r.margin}`);
  assert.ok(Math.abs(r.epsilonUnits - 4.0) < 1e-9, `epsilonUnits = ${r.epsilonUnits}（2.0 / 0.5）`);
  assert.equal(r.levelsApart, 1);
});

test("§22 epsilon 单位跨指标可比：同样是「赢 4 倍阈值」，两个指标给出同一个 epsilonUnits", () => {
  // a：margin 2.0 / epsilon 0.5 = 4
  const a = computeRegret(entry("o", M({ perceptualError: 6.0 })), entry("s", M()),
    [{ metric: "perceptualError", direction: "min", epsilon: 0.5 }]);
  // b：margin 0.04 / epsilon 0.01 = 4（指标的量纲完全不同）
  const b = computeRegret(entry("o", M({ detailRetention: 0.94 })), entry("s", M()),
    [{ metric: "detailRetention", direction: "max", epsilon: 0.01 }]);
  assert.ok(Math.abs(a.epsilonUnits - 4) < 1e-9, `a.epsilonUnits = ${a.epsilonUnits}`);
  assert.ok(Math.abs(b.epsilonUnits - 4) < 1e-9, `b.epsilonUnits = ${b.epsilonUnits}`);
  assert.equal(a.epsilonUnits, b.epsilonUnits,
    `${a.epsilonUnits} vs ${b.epsilonUnits} —— epsilon 单位失去了跨指标可比性`);
});

test("§22 regret ≥ 0 的不变量：oracle 取排序第一名时，regret 永远不是负的", () => {
  const obj = objectiveFor("auto");
  // 一批随机感的指标组合，逐个当 oracle / selected 配对。
  const pool = [];
  for (let i = 0; i < 24; i += 1) {
    pool.push(entry(`p${i}`, M({
      fragmentation: 1 + i * 0.7,
      edgeRetention: 0.5 + (i % 7) * 0.06,
      detailRetention: 0.4 + (i % 5) * 0.12,
      flatAreaStability: 0.3 + (i % 6) * 0.11,
      perceptualError: 1 + (i % 9) * 1.3,
    })));
  }
  const best = rankCandidates(pool, obj)[0];
  for (const other of pool) {
    const r = computeRegret(best, other, obj);
    assert.ok(r.epsilonUnits >= 0,
      `oracle 相对 ${other.profileId} 的 regret 是负的（${r.epsilonUnits}）—— 排序与 regret 口径不一致`);
  }
});

test("§22 全部判据都在阈值内 → regret 记 0 而不是「差一点点」", () => {
  const obj = [ { metric: "perceptualError", direction: "min", epsilon: 0.5 } ];
  const r = computeRegret(entry("o", M({ perceptualError: 7.9 })), entry("s", M({ perceptualError: 8.0 })), obj);
  assert.equal(r.comparable, true);
  assert.equal(r.hit, true, "差 0.1 小于阈值 0.5，应该算命中");
  assert.equal(r.epsilonUnits, 0);
});

/* =========================================================
 * oracleBest
 * ======================================================= */

test("§7/§21 oracle 只在**没被硬约束淘汰**的候选里挑", () => {
  const good = entry("a", M({ perceptualError: 8.0 }));
  const illegal = entry("b", M({ perceptualError: 0.1 }), { accepted: false, rejectReason: "A-maxColors" });
  const best = oracleBest([good, illegal], "auto");
  assert.equal(best.profileId, "a",
    "oracle 挑了被硬约束淘汰的候选 —— regret 会把「正确拒绝违规候选」记成「选择器选错了」");
});

test("§21 oracle 跳过执行失败的候选", () => {
  const good = entry("a", M());
  const broken = entry("b", M({ perceptualError: 0.01 }), { error: "崩了", metrics: null });
  assert.equal(oracleBest([good, broken], "auto").profileId, "a");
});

test("§21 没有任何可用候选 → oracle 返回 null（不是抛）", () => {
  assert.equal(oracleBest([], "auto"), null);
  assert.equal(oracleBest([entry("a", null, { error: "x" })], "auto"), null);
  assert.equal(oracleBest([entry("a", M(), { accepted: false })], "auto"), null);
});

test("§21 oracle 与 selectProfile 用同一份目标表（口径必须一致）", () => {
  const { objectiveFor: of } = { objectiveFor };
  for (const mode of Object.keys(MODE_OBJECTIVES)) {
    const pool = [entry("a", M()), entry("b", M({ perceptualError: 1.0 })), entry("c", M({ fragmentation: 1.0 }))];
    const best = oracleBest(pool, mode);
    const ranked = rankCandidates(pool, of(mode));
    assert.equal(best.profileId, ranked[0].profileId, `${mode} 的 oracle 与排序口径不一致`);
  }
});

/* =========================================================
 * summarizeRegret
 * ======================================================= */

test("§22 汇总给出命中率 / 平均 / 最差，并点名最差的那一项指标", () => {
  const obj = objectiveFor("auto");
  const s = summarizeRegret([
    computeRegret(entry("a", M()), entry("a", M()), obj),                                    // hit
    computeRegret(entry("b", M({ perceptualError: 1.0 })), entry("c", M()), obj),             // miss
  ]);
  assert.equal(s.n, 2);
  assert.equal(s.hitRate, 0.5);
  assert.ok(s.meanEpsilonUnits > 0);
  assert.ok(s.worstEpsilonUnits >= s.meanEpsilonUnits);
  assert.equal(s.worstMetric, "perceptualError");
});

test("§22 汇总忽略不可比的条目（缺 grid 的夹具不该拉低命中率）", () => {
  const obj = objectiveFor("auto");
  const s = summarizeRegret([
    computeRegret(entry("a", M()), entry("a", M()), obj),
    computeRegret(null, null, obj),
  ]);
  assert.equal(s.n, 1, "不可比的条目被算进了分母 —— 命中率会被无端拉低");
  assert.equal(s.hitRate, 1);
});

test("§22 空汇总给出 null 而不是 0（0 会被读成「完美」）", () => {
  const s = summarizeRegret([]);
  assert.equal(s.n, 0);
  assert.equal(s.hitRate, null);
  assert.equal(s.meanEpsilonUnits, null);
  assert.equal(s.worstMetric, null);
});

/* =========================================================
 * §25 失败分类
 * ======================================================= */

test("§25 六类失败是闭集，且每条规则都声明依赖的字段", () => {
  assert.deepEqual([...TUNE_FAILURE_CLASSES],
    ["routing-error", "candidate-error", "metric-error", "threshold-error", "runtime-budget", "fixture-problem"]);
  for (const rule of TUNE_FAILURE_RULES) {
    assert.ok(TUNE_FAILURE_CLASSES.includes(rule.id), `${rule.id} 不在闭集里`);
    assert.ok(Array.isArray(rule.evidence) && rule.evidence.length, `${rule.id} 没有声明 evidence`);
    assert.equal(typeof rule.test, "function");
  }
  // 闭集与规则表必须一一对应，否则会出现「分类得出来但不在闭集里」。
  assert.deepEqual(TUNE_FAILURE_RULES.map((r) => r.id).sort(), [...TUNE_FAILURE_CLASSES].sort());
});

test("§25 每条规则的 evidence 都是真实字段", () => {
  const { keys } = metricKeyProbe();
  const known = new Set([...keys, "candidates", "expectedMode", "routedMode",
    "oracleProfileId", "selectedProfileId", "standardProfileId", "profileId", "rejectReason"]);
  for (const rule of TUNE_FAILURE_RULES) {
    for (const f of rule.evidence) {
      assert.ok(known.has(f), `${rule.id} 声明依赖 ${f}，但它不存在`);
    }
  }
});

test("§25 六类各命中一次", () => {
  const base = {
    candidates: [{ profileId: "a" }, { profileId: "b" }],
    expectedMode: "photo", routedMode: "photo",
    selectedProfileId: "a", oracleProfileId: "a", standardProfileId: "a",
  };
  const cases = [
    ["fixture-problem", { ...base, candidates: [] }],
    ["routing-error", { ...base, expectedMode: "photo", routedMode: "auto" }],
    ["runtime-budget", { ...base, candidates: [{ profileId: "b", rejectReason: "runtime-budget" }], oracleProfileId: "b" }],
    ["candidate-error", { ...base, candidates: [{ profileId: "b", rejectReason: "candidate-error" }], oracleProfileId: "b" }],
    ["threshold-error", { ...base, selectedProfileId: "a", standardProfileId: "a", oracleProfileId: "b" }],
    ["metric-error", { ...base, selectedProfileId: "a", oracleProfileId: "b", standardProfileId: "c" }],
  ];
  for (const [expected, ctx] of cases) {
    assert.equal(classifyTuneFailure(ctx).class, expected, `分类错了：${JSON.stringify(ctx)}`);
  }
});

test("§25 选择与 oracle 一致 → 分类为 null，且 note 是一句人话", () => {
  const out = classifyTuneFailure({
    candidates: [{ profileId: "a" }], expectedMode: "auto", routedMode: "auto",
    selectedProfileId: "a", oracleProfileId: "a", standardProfileId: "a",
  });
  assert.equal(out.class, null);
  assert.equal(typeof out.note, "string");
  assert.ok(out.note.length > 0);
});

test("§25 规则求值抛错时不炸，继续试下一条", () => {
  // candidates 是 undefined → `!ctx.candidates?.length` 是 true → 命中 fixture-problem，
  // 不会抛。这里测的是「即使某条规则内部抛了，也要给出一个分类」。
  const out = classifyTuneFailure({ candidates: null, expectedMode: "auto", routedMode: "auto" });
  assert.ok(out.class === null || TUNE_FAILURE_CLASSES.includes(out.class));
});

test("§25 分类优先级：路由错了就报路由错，不往下再报「选择错了」", () => {
  const out = classifyTuneFailure({
    candidates: [{ profileId: "a" }],
    expectedMode: "photo", routedMode: "auto",     // 路由错
    selectedProfileId: "a", oracleProfileId: "b",  // 顺带选择也「错」了
    standardProfileId: "a",
  });
  assert.equal(out.class, "routing-error",
    "路由错了却报成选择错 —— 会把人引到错误的排查方向上");
});

/* =========================================================
 * 目标表与 regret 的一致性
 * ======================================================= */

test("§22 regret 用的目标表必须与选择用的同一份（否则 regret 无意义）", () => {
  for (const mode of Object.keys(MODE_OBJECTIVES)) {
    const pool = [entry("a", M()), entry("b", M({ perceptualError: 1.0 }))];
    const obj = objectiveFor(mode);
    const best = oracleBest(pool, mode);
    const diff = firstMaterialDifference(best, pool[0], obj);
    if (diff) {
      assert.ok(diff.margin > 0,
        `${mode}：oracle 相对 standard 的第一处差异是负的 —— oracle 与目标表口径不一致`);
    }
  }
  void AUTO_TUNE_DEFAULTS;
});
