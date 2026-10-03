/**
 * Stage B4 §13.7 —— 字典序排序与选择契约（§8 / §9 / §10 / §11 / §12）。
 *
 * 这个文件守的是**「谁赢」这件事本身**：
 *
 *   · §10 排序必须是字典序：高优先级判据上的一点点优势，不能被低优先级
 *     判据上的巨大优势翻盘。这一条如果破了，报告里就只能说「它分更高」，
 *     说不出「它高在哪」—— 那正是 §10 拒绝加权分数的理由。
 *   · §11 最小收益门槛：挑战者必须**证明自己值得**，不然 standard 赢。
 *   · §12 复杂度成本只抬门槛，**不参与排序**。
 *   · §7 缺指标视为打平，不许把「测不出来」当成 0 去比。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_DEFAULTS,
  compareCandidates,
  complexityCost,
  firstMaterialDifference,
  rankCandidates,
  requiredGain,
  selectProfile,
} from "../services/auto-tune.mjs";
import { AUTO_TUNE_ELIGIBILITY, objectiveFor } from "../services/auto-tune-profiles.mjs";
import { makeCtx, makeEntry } from "./auto-tune-fixtures.mjs";

const CRIT = (metric, direction, epsilon) => ({ metric, direction, epsilon });

/** 手工目标表：三层，顺序与阈值都自己说了算，不受模式表变动影响。 */
const OBJ = [
  CRIT("detailRetention", "max", 0.010),
  CRIT("perceptualError", "min", 0.050),
  CRIT("fragmentation", "min", 0.500),
];

/**
 * 完整的一份 metrics。
 *
 * ⚠️ **必须覆盖 `auto` 目标表用到的全部五个指标。** 少一个的话
 * `signedGain` 会把它当「打平」跳过，于是排序直接落到下一个判据上 ——
 * 一条本来想测「第 1 层」的用例会悄悄变成测「第 4 层」。
 * 这类错会表现成「断言莫名其妙地失败」，而根因在夹具缺字段。
 */
const m = (o = {}) => ({
  fragmentation: 10.0,
  edgeRetention: 0.80,
  detailRetention: 0.90,
  flatAreaStability: 0.85,
  perceptualError: 8.0,
  ...o,
});

/* =========================================================
 * firstMaterialDifference
 * ======================================================= */

test("§10 全部判据都在阈值内 → 视为打平（null）", () => {
  assert.equal(firstMaterialDifference(m(), m(), OBJ), null);
  // 差 0.009 < epsilon 0.010 → 还是打平
  assert.equal(firstMaterialDifference(m({ detailRetention: 0.909 }), m(), OBJ), null);
});

test("§10 返回的是**第一处**实质差异，带上层级/指标/方向/差距/阈值", () => {
  const a = m({ detailRetention: 0.95, perceptualError: 1.0 });
  const b = m();
  const diff = firstMaterialDifference(a, b, OBJ);
  assert.equal(diff.index, 0, "第一处差异应该在第 0 层");
  assert.equal(diff.metric, "detailRetention");
  assert.equal(diff.direction, "max");
  assert.ok(Math.abs(diff.margin - 0.05) < 1e-9);
  assert.equal(diff.epsilon, 0.010);
});

test("§10 方向：min 判据上「更小」是更好，margin 符号要跟着翻", () => {
  const better = firstMaterialDifference(m({ perceptualError: 6.0 }), m(), OBJ);
  assert.equal(better.metric, "perceptualError");
  assert.ok(better.margin > 0, "更小的 perceptualError 应该是正 margin");

  const worse = firstMaterialDifference(m({ perceptualError: 10.0 }), m(), OBJ);
  assert.equal(worse.metric, "perceptualError");
  assert.ok(worse.margin < 0, "更大的 perceptualError 应该是负 margin");
});

test("§7 缺指标 → 视为打平，不拿 0 当证据", () => {
  const a = m({ detailRetention: null });
  const b = m({ detailRetention: 0.99 });
  assert.equal(firstMaterialDifference(a, b, OBJ), null,
    "把缺失的指标当 0 去比了 —— 「测不出来」会变成「它更差」");

  // 第 0 层缺，第 1 层有差异 → 应该在第 1 层报出来，而不是被第 0 层挡住。
  const diff = firstMaterialDifference(m({ detailRetention: null, perceptualError: 6.0 }), m(), OBJ);
  assert.equal(diff.metric, "perceptualError");
});

test("§10 epsilon = null → 回落到绝对门槛 minimumAbsoluteGain", () => {
  const obj = [CRIT("fragmentation", "min", null)];
  const limits = { ...AUTO_TUNE_DEFAULTS, minimumAbsoluteGain: 0.01 };
  assert.equal(firstMaterialDifference(m({ fragmentation: 10.005 }), m(), obj, limits), null,
    "差 0.005 小于绝对门槛 0.01，应该打平");
  const diff = firstMaterialDifference(m({ fragmentation: 9.0 }), m(), obj, limits);
  assert.equal(diff.epsilon, 0.01);
});

test("§10 空目标表 → 永远打平（不是抛错）", () => {
  assert.equal(firstMaterialDifference(m({ detailRetention: 1 }), m(), []), null);
});

/* =========================================================
 * compareCandidates / rankCandidates
 * ======================================================= */

test("§10 compareCandidates 符号约定：-1 = a 更好，1 = b 更好，0 = 打平", () => {
  assert.equal(compareCandidates(m({ detailRetention: 0.95 }), m(), OBJ), -1);
  assert.equal(compareCandidates(m(), m({ detailRetention: 0.95 }), OBJ), 1);
  assert.equal(compareCandidates(m(), m(), OBJ), 0);
});

test("§10 字典序的核心性质：高优先级的小优势压过低优先级的巨大优势", () => {
  // a 在第 0 层赢 0.011（刚过阈值），在第 1/2 层惨败。
  const a = makeEntry("a", m({ detailRetention: 0.911, perceptualError: 999, fragmentation: 9999 }));
  // b 在第 0 层打平，在第 1/2 层大胜。
  const b = makeEntry("b", m({ perceptualError: 0.01, fragmentation: 0.01 }));
  assert.equal(compareCandidates(a, b, OBJ), -1,
    "低优先级上的巨大优势把高优先级的优势翻盘了 —— 这就不是字典序了");
  assert.deepEqual(rankCandidates([b, a], OBJ).map((e) => e.profileId), ["a", "b"]);
});

test("§10 rankCandidates 是稳定排序：打平时保持输入顺序（standard 在前就 standard 胜）", () => {
  const std = makeEntry("smart-standard", m());
  const tie1 = makeEntry("smart-detail-safe", m());
  const tie2 = makeEntry("smart-bean-fit", m());
  const ranked = rankCandidates([std, tie1, tie2], OBJ);
  assert.deepEqual(ranked.map((e) => e.profileId),
    ["smart-standard", "smart-detail-safe", "smart-bean-fit"],
    "打平时顺序被重排了 —— standard 会被一个「等价」候选顶掉");
});

test("§10 rankCandidates 不修改输入数组", () => {
  const input = [makeEntry("a", m()), makeEntry("b", m({ detailRetention: 0.99 }))];
  const snapshot = input.map((e) => e.profileId);
  rankCandidates(input, OBJ);
  assert.deepEqual(input.map((e) => e.profileId), snapshot);
});

/* =========================================================
 * §11 / §12 最小收益与复杂度成本
 * ======================================================= */

test("§12 complexityCost：standard 更快 → 0；挑战者更慢 → 正比例；封顶 runtimeTolerance", () => {
  const limits = { ...AUTO_TUNE_DEFAULTS, runtimeTolerance: 1 };
  const std = makeEntry("s", m(), { runtimeMs: 100 });
  assert.equal(complexityCost(makeEntry("a", m(), { runtimeMs: 50 }), std, limits), 0, "更快不该有负成本");
  assert.equal(complexityCost(makeEntry("a", m(), { runtimeMs: 100 }), std, limits), 0);
  assert.ok(Math.abs(complexityCost(makeEntry("a", m(), { runtimeMs: 150 }), std, limits) - 0.5) < 1e-9);
  assert.equal(complexityCost(makeEntry("a", m(), { runtimeMs: 10000 }), std, limits), 1, "没有封顶");
  assert.equal(complexityCost(makeEntry("a", m(), { runtimeMs: 10 }), makeEntry("s", m(), { runtimeMs: 0 }), limits), 0,
    "standard 耗时未知时不该算成本");
});

test("§12 复杂度成本只抬门槛：慢一倍的候选需要两倍收益", () => {
  const criterion = CRIT("perceptualError", "min", 0.05);
  const std = makeEntry("s", m(), { runtimeMs: 100 });
  const fast = requiredGain(criterion, makeEntry("a", m(), { runtimeMs: 100 }), std);
  const slow = requiredGain(criterion, makeEntry("a", m(), { runtimeMs: 200 }), std);
  assert.ok(Math.abs(fast - 0.05) < 1e-9);
  assert.ok(Math.abs(slow - 0.10) < 1e-9, `慢一倍的候选门槛应该是 0.10，实际 ${slow}`);
});

test("§12 复杂度成本有上限：runtimeTolerance 封顶后门槛不再涨", () => {
  const limits = { ...AUTO_TUNE_DEFAULTS, runtimeTolerance: 1 };
  const criterion = CRIT("perceptualError", "min", 0.05);
  const std = makeEntry("s", m(), { runtimeMs: 100 });
  const verySlow = requiredGain(criterion, makeEntry("a", m(), { runtimeMs: 100000 }), std, limits);
  assert.ok(Math.abs(verySlow - 0.10) < 1e-9, `封顶失效：${verySlow}`);
});

/* =========================================================
 * selectProfile —— 决策分支
 * ======================================================= */

const select = (entries, mode = "auto", limits = {}) =>
  selectProfile({ entries, routedMode: mode, limits: { ...AUTO_TUNE_DEFAULTS, ...limits } });

test("§23 全部打平 → standard 胜，decision = standard-is-best", () => {
  const std = makeEntry("smart-standard", m());
  const out = select([std, makeEntry("smart-detail-safe", m())]);
  assert.equal(out.selectedProfileId, "smart-standard");
  assert.equal(out.decision, "standard-is-best");
  assert.equal(out.standard.profileId, "smart-standard");
});

test("§23 挑战者全面更差 → standard 胜", () => {
  const std = makeEntry("smart-standard", m());
  const bad = makeEntry("smart-detail-safe", m({ detailRetention: 0.5, perceptualError: 99, fragmentation: 999 }));
  const out = select([std, bad]);
  assert.equal(out.selectedProfileId, "smart-standard");
  assert.equal(out.decision, "standard-is-best");
});

test("§11 挑战者赢但不足最小收益 → 回落 standard，并说明是门槛问题", () => {
  // 赢 0.015：超过 perceptualError 的绝对门槛 0.01（所以是「实质差异」），
  // 但慢一倍 → 门槛抬到 0.02 → 不够。
  //
  // ⚠️ 这条**必须让挑战者更慢**才能触发。复杂度成本为 0 时
  // `requiredGain === epsilon`，而「实质差异」的定义就是 `gain > epsilon`，
  // 两个条件互为否定 —— `below-minimum-gain` 在等速下**不可达**。
  // 一开始把这条用例写成等速，断言当然会失败；失败的是用例，不是实现。
  const std = makeEntry("smart-standard", m(), { runtimeMs: 100 });
  const challenger = makeEntry("smart-detail-safe", m({ perceptualError: 7.985 }), { runtimeMs: 200 });
  const out = select([std, challenger]);
  assert.equal(out.selectedProfileId, "smart-standard",
    "只赢一点点、还慢一倍就升级了 —— §11 要求 standard 是默认赢家");
  assert.equal(out.decision, "below-minimum-gain");
  assert.match(out.reason, /smart-detail-safe/);
});

test("§11 挑战者赢够 → 胜出，decision 说出它赢在哪一项", () => {
  const std = makeEntry("smart-standard", m(), { runtimeMs: 100 });
  const challenger = makeEntry("smart-detail-safe", m({ perceptualError: 6.0 }), { runtimeMs: 100 });
  const out = select([std, challenger]);
  assert.equal(out.selectedProfileId, "smart-detail-safe");
  assert.equal(out.decision, "better-on:perceptualError");
  assert.match(out.reason, /perceptualError/);
});

test("§12 同一份收益：等速胜出，慢一倍回落 —— 复杂度成本真的在起作用", () => {
  // 收益固定 0.015，只改 runtime。这是 §12 最干净的取证形状：
  // 变量只有一个，结论只能是「慢」造成的。
  const gain = { perceptualError: 7.985 };
  const std = makeEntry("smart-standard", m(), { runtimeMs: 100 });

  const fast = select([std, makeEntry("smart-detail-safe", m(gain), { runtimeMs: 100 })]);
  assert.equal(fast.selectedProfileId, "smart-detail-safe",
    "等速、赢 0.015 应该胜出（门槛 0.01）");

  const slow = select([std, makeEntry("smart-detail-safe", m(gain), { runtimeMs: 200 })]);
  assert.equal(slow.selectedProfileId, "smart-standard",
    "同样的收益、慢一倍却还是胜出 —— §12 的 runtime 惩罚没生效");
  assert.equal(slow.decision, "below-minimum-gain");
});

test("§7 被硬约束淘汰的候选不参与排序", () => {
  const std = makeEntry("smart-standard", m());
  const rejected = makeEntry("smart-detail-safe", m({ perceptualError: 0.001 }), {
    accepted: false, rejectReason: "A-maxColors",
  });
  const out = select([std, rejected]);
  assert.equal(out.selectedProfileId, "smart-standard");
  assert.equal(out.ranked.length, 1, "被淘汰的候选混进了排序池");
});

test("§23 池里只剩 standard → 仍然选它（不抛、不返回 null）", () => {
  const std = makeEntry("smart-standard", m());
  const out = select([std]);
  assert.equal(out.selectedProfileId, "smart-standard");
  assert.equal(out.decision, "standard-is-best");
});

test("§23 standard 被淘汰时仍在池子里，但不会因此被无条件选中", () => {
  // A / E 两条是**绝对**判据（用色数上限、单候选预算），standard 真的可能违规；
  // B / D / F 才是「相对 standard」，那三条不可能淘汰 standard。
  const std = makeEntry("smart-standard", m(), { accepted: false, rejectReason: "E-runtime-budget" });

  // ① 挑战者没有实质更优 → 仍然选 standard（§23：永远有输出，不能「没有方案」）
  const tie = makeEntry("smart-detail-safe", m());
  const fallback = select([std, tie]);
  assert.equal(fallback.selectedProfileId, "smart-standard",
    "standard 被淘汰后就「没有兜底」了 —— §23 要求任何时候都能回到生产行为");
  assert.equal(fallback.standard.profileId, "smart-standard");

  // ② 挑战者既合规又明显更好 → 选挑战者，但它必须真的赢，且 standard 参与过比较
  const better = makeEntry("smart-detail-safe", m({ perceptualError: 1.0 }));
  const upgraded = select([std, better]);
  assert.equal(upgraded.selectedProfileId, "smart-detail-safe",
    "standard 超预算、挑战者不超且更优，却仍然跑了超预算的那一套");
  assert.ok(upgraded.ranked.some((e) => e.profileId === "smart-standard"),
    "standard 被踢出了排序池 —— 那「挑战者是不是真的更好」就没被验证过");
});

test("§10 目标表不自相矛盾：每个模式里，第一名相对 standard 的第一处差异都不是负的", () => {
  // 这条是 `objective-conflict` 分支的**反向守卫**：真实的目标表不该能触发它。
  // 一旦有人往某个模式的目标表里塞进互相矛盾的判据，这条会先红。
  for (const [mode, ids] of Object.entries(AUTO_TUNE_ELIGIBILITY)) {
    const objective = objectiveFor(mode);
    const std = makeEntry(ids[0], m());
    // 造一批差异各异的候选，覆盖「某层略好」「某层大胜」「某层略差」。
    const entries = [
      std,
      makeEntry("x1", m({ detailRetention: 0.95 })),
      makeEntry("x2", m({ perceptualError: 1.0 })),
      makeEntry("x3", m({ fragmentation: 1.0 })),
      makeEntry("x4", m({ detailRetention: 0.5, perceptualError: 99 })),
    ];
    const ranked = rankCandidates(entries, objective);
    const leader = ranked[0];
    const diff = firstMaterialDifference(leader, std, objective);
    if (diff) {
      assert.ok(diff.margin > 0,
        `${mode} 的目标表自相矛盾：排序把 ${leader.profileId} 排第一，`
        + `但它在第一处差异（${diff.metric}）上比 standard 更差`);
    }
  }
});

test("§9 每个模式都能跑通一次选择，且结果一定在该模式的资格表里", async () => {
  const { AUTO_TUNE_ELIGIBILITY } = await import("../services/auto-tune-profiles.mjs");
  for (const [mode, ids] of Object.entries(AUTO_TUNE_ELIGIBILITY)) {
    const entries = ids.map((id, i) => makeEntry(id, m({ detailRetention: 0.90 + i * 0.001 })));
    const out = selectProfile({
      entries, routedMode: mode, limits: AUTO_TUNE_DEFAULTS,
    });
    assert.ok(ids.includes(out.selectedProfileId),
      `${mode} 选出了资格表外的 ${out.selectedProfileId}`);
    assert.ok(out.objective.length >= 1, `${mode} 没有拿到目标表`);
    assert.equal(out.objective, objectiveFor(mode));
  }
});

test("§10 报告里带着完整的排名，不只是赢家（否则无法复核）", () => {
  const entries = [
    makeEntry("smart-standard", m()),
    makeEntry("smart-detail-safe", m({ perceptualError: 6.0 })),
    makeEntry("smart-bean-fit", m({ perceptualError: 5.0 })),
  ];
  const out = select(entries);
  assert.equal(out.ranked.length, 3);
  assert.deepEqual(out.ranked.map((e) => e.profileId),
    ["smart-bean-fit", "smart-detail-safe", "smart-standard"]);
  assert.equal(out.selectedProfileId, "smart-bean-fit");
});

test("§10 selectProfile 接受已经算好的 ctx（limits 透传）", () => {
  const std = makeEntry("smart-standard", m(), { runtimeMs: 100 });
  const challenger = makeEntry("smart-detail-safe", m({ perceptualError: 6.0 }), { runtimeMs: 100 });
  // 把绝对门槛抬到 1.0 → 挑战者赢 2.0 仍然够（2.0 > 1.0×…）
  const loose = selectProfile({
    entries: [std, challenger], routedMode: "auto",
    limits: { ...AUTO_TUNE_DEFAULTS, minimumAbsoluteGain: 1.0 },
  });
  assert.equal(loose.selectedProfileId, "smart-detail-safe");
  void makeCtx;
});
