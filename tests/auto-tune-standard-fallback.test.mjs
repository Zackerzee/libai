/**
 * Stage B4 §13.7 —— STANDARD 回落契约（§11 / §23）。
 *
 * §23 的原话是整个 §13 里最硬的一条不变量：
 *
 *   > 如果没有明确更优候选：选择 STANDARD。**禁止「必须选一个不同方案」。**
 *
 * 所以这个文件里几乎每条用例都在问同一个问题：
 * **在「调优器想不出更好的」的时候，它有没有老老实实给出生产行为？**
 *
 * 三个必须证到的形状：
 *   ① 所有候选产出逐位相同 → 选 standard，且 decision 明说 standard-is-best
 *   ② 候选执行失败（抛错）→ 不炸整轮，退回 standard
 *   ③ standard 自己失败 → 报告显式说 standard-failed，让上层退回单次生成
 *
 * 另外还钉住 §23 的**反面**：不允许出现「为了选个不一样的而选」——
 * 即报告里 selectedProfileId 与 standardProfileId 不同时，
 * 必须有 `better-on:<指标>` 这个可复核的理由。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_DEFAULTS,
  createAutoTuner,
  isAutoTuneEnabledFor,
} from "../services/auto-tune.mjs";
import { GENERATION_MODES } from "../services/mode-profile.mjs";
import { gridHash, makeRealRunCandidate, tinyPalette } from "./auto-tune-fixtures.mjs";
import { syntheticSource } from "./auto-tune-fixtures.mjs";

const PALETTE = tinyPalette();

/** 48×48 → 目标 48×48，预览长边上限 104 不裁剪 → previewSize === targetSize。 */
const SIZE = { width: 48, height: 48 };

/** 强制路由到 auto：`analyze` 是注入点，让路由结果与合成图内容解耦。 */
const forceRoute = (mode) => () => ({ routing: { mode } });

function makeTuner({ source, runCandidate, route = "auto", limits = {} } = {}) {
  return createAutoTuner({
    runCandidate: runCandidate || makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: forceRoute(route),
    limits: { previewLongEdge: AUTO_TUNE_DEFAULTS.previewLongEdge, ...limits },
  });
}

/* =========================================================
 * ① 所有候选等价 → standard
 * ======================================================= */

test("§23 所有候选产出逐位相同 → 选 standard，decision = standard-is-best", async () => {
  const source = syntheticSource(48, 48, "gradient");
  // 真管线先跑一次，拿到一张真网格；然后让每个候选都返回它。
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const once = await real({ size: SIZE, overrides: {}, labCandidate: null, requestId: 1, phase: "preview" });
  let calls = 0;

  const tuner = makeTuner({
    source,
    runCandidate: async () => { calls += 1; return { ...once, timingMs: 1 }; },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });

  assert.ok(calls >= 2, `只跑了 ${calls} 个候选 —— 那这条用例什么都没证明`);
  assert.equal(report.selectedProfileId, report.standardProfileId,
    "候选逐位相同时没有回到 standard —— §23 被破坏了");
  assert.equal(report.decision, "standard-is-best");
  assert.ok(report.grid, "回落 standard 之后没有网格 —— 等于没有输出");
  assert.equal(gridHash(report.grid), gridHash(once.grid), "回落时用的不是 standard 的产出");
  // 全部候选的指标必须真的相同（否则上面的断言是碰巧过的）。
  const uniq = new Set(report.candidates.map((c) => JSON.stringify(c.metrics)));
  assert.equal(uniq.size, 1, "候选指标并不相同，用例前提不成立");
});

test("§23 生产档（只有 standard 一个候选可用）→ 走 single-candidate 短路，不跑预览", async () => {
  const source = syntheticSource(48, 48, "gradient");
  let calls = 0;
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = makeTuner({
    source,
    runCandidate: async (req) => { calls += 1; return real(req); },
    // pixel 的资格表只有一个候选 —— 用路由注入造出这个形状。
    route: "pixel",
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.equal(report.skipped, "single-candidate");
  assert.equal(calls, 0, "单候选还跑了预览 —— 纯浪费（§5 只要求跑允许的候选）");
  assert.equal(report.grid, undefined, "单候选短路不该产出网格，调用方要自己走普通生成");
  assert.equal(report.selectedProfileId, "pixel-standard");
  assert.match(report.reason, /只有一个候选/);
});

/* =========================================================
 * ② 候选失败 → 退回 standard
 * ======================================================= */

test("§23 挑战者执行抛错 → 不炸整轮，退回 standard 并记账为 candidate-error", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = makeTuner({
    source,
    runCandidate: async (req) => {
      // smart-detail-safe 的特征增量就是 detailProtection 85。
      if (req.overrides?.detailProtection === 85) throw new Error("模拟候选崩溃");
      return real(req);
    },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });

  const failed = report.candidates.filter((c) => c.rejectReason === "candidate-error");
  assert.equal(failed.length, 1, `没有把候选失败记成 candidate-error：${JSON.stringify(report.candidates.map((c) => c.rejectReason))}`);
  assert.match(failed[0].error, /模拟候选崩溃/);
  assert.equal(report.selectedProfileId, report.standardProfileId,
    "一个候选崩了就把整轮调优判死，或者选了别的候选");
  assert.ok(report.grid, "候选失败后没有网格");
});

test("§23 挑战者全部抛错 → 仍然给出 standard 的网格", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = makeTuner({
    source,
    runCandidate: async (req) => {
      const isStandard = Object.keys(req.overrides || {}).length === 0 && !req.labCandidate;
      if (!isStandard) throw new Error("候选全崩");
      return real(req);
    },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.equal(report.selectedProfileId, report.standardProfileId);
  assert.ok(report.grid);
  assert.ok(report.candidates.filter((c) => c.rejectReason === "candidate-error").length >= 1);
});

test("§23 standard 自己执行失败 → decision = standard-failed，不产出网格，让上层退回单次生成", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = makeTuner({
    source,
    runCandidate: async (req) => {
      const isStandard = Object.keys(req.overrides || {}).length === 0 && !req.labCandidate;
      if (isStandard) throw new Error("standard 崩了");
      return real(req);
    },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.equal(report.decision, "standard-failed");
  assert.equal(report.selectedProfileId, report.standardProfileId,
    "standard 失败后不该选别的候选 —— 没有基线就没有比较");
  assert.equal(report.grid, undefined,
    "standard 失败时产出了网格 —— 那会让上层以为调优成功，其实那是别的候选的输出");
  assert.match(report.reason, /无法比较/);
  // 关键：仍然给出一个可用的 selectedProfile，上层照着它单跑一次就能出图。
  assert.equal(report.selectedProfile.profileId, report.standardProfileId);
});

/* =========================================================
 * ③ §23 的反面：不许「为了不同而不同」
 * ======================================================= */

/**
 * 把一张网格改造成「处处更差」。
 *
 * ⚠️ **不能靠「糊成一块纯色」来做差。** 第一版就是这么写的，结果
 * `beginner` 上挑战者赢了 —— 因为 §9 给 beginner 的第一判据是
 * `usedColors(min)`，纯色网格的用色数是 1，在它眼里**更好**。
 * 「更差」是相对目标表说的，不是相对直觉说的。
 *
 * 所以这里用「每格一个不同的杂色」：用色数爆表、细节与平区全崩、色差拉大。
 * 它会把所有模式的目标表都打穿，包括 beginner 的低色数判据。
 */
function degrade(grid) {
  return grid.map((row, y) => row.map((_, x) => ({
    code: `N${y * row.length + x}`,
    rgb: [(x * 37 + y * 11) % 256, (y * 53 + x * 7) % 256, (x * 17 + y * 29) % 256],
    hex: "#000000",
  })));
}

test("§23 每个模式：挑战者处处更差时都回到 standard（无论是被约束淘汰还是排序落败）", async () => {
  for (const mode of GENERATION_MODES) {
    if (mode === "pixel" || mode === "logo") continue;    // 单候选，走短路分支
    const source = syntheticSource(48, 48, "gradient");
    const real = makeRealRunCandidate({ source, palette: PALETTE });
    const tuner = makeTuner({
      source,
      route: mode,
      runCandidate: async (req) => {
        const out = await real(req);
        const isStandard = Object.keys(req.overrides || {}).length === 0 && !req.labCandidate;
        if (isStandard) return out;
        return { ...out, grid: degrade(out.grid) };
      },
    });
    const report = await tuner.tune({
      source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
    });
    assert.equal(report.routedMode, mode, `${mode} 的路由注入没生效`);
    assert.equal(report.selectedProfileId, report.standardProfileId,
      `${mode}：挑战者被做成杂色，还是没回到 standard（选了 ${report.selectedProfileId}）`);
    // 记账必须说清楚它是怎么被挡住的，不能只有一句「没选它」。
    const challengers = report.candidates.filter((c) => c.profileId !== report.standardProfileId);
    assert.ok(challengers.length >= 1, `${mode} 没有挑战者，用例前提不成立`);
    assert.ok(challengers.every((c) => !c.accepted || c.rejectReason === null),
      `${mode} 的挑战者既被接受又没有淘汰理由 —— 报告说不清发生了什么`);
  }
});

test("§7G 一个「把整幅图糊成纯色」的候选必须被拦下 —— 而且拦住它的是色差门槛，不是目标表", async () => {
  // 这条记录的是一段真实的排查过程，值得留在这里：
  //
  //  ① 第一版把「更差」实现成「糊成纯色」，结果 beginner 上它**赢了**。
  //     原因是 §9 给 beginner 的第一判据是 `usedColors(min)`，纯色用色数是 1，在它眼里更好。
  //  ② 于是把 beginner 的目标表按 §9 的原话改成「稳定优先」，纯色又赢了 ——
  //     这次赢在 `flatAreaStability`。
  //  ③ 逐指标取证才看清根因：**平滑渐变源图在 48×48 上 detailCells 与 edgeCells 都是 0**
  //     （局部差全都没到阈值），于是 detailRetention / edgeRetention 全是 null，
  //     唯一有效的结构指标只剩 flatAreaStability —— 而「什么都没画」在这个指标上拿满分。
  //     实测 auto / anime / beginner 三个模式都会选它，perceptualError 从 7.01 涨到 24.43。
  //  ④ 修法是补第七条硬约束 G：perceptualError 不许成倍恶化。
  //
  // 所以这条用例钉住的是：**结构指标失效时，色差门槛必须是最后一道防线。**
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = makeTuner({
    source,
    route: "beginner",
    runCandidate: async (req) => {
      const out = await real(req);
      const isStandard = Object.keys(req.overrides || {}).length === 0 && !req.labCandidate;
      if (isStandard) return out;
      const grid = out.grid.map((row) => row.map(() => ({ code: "A1", rgb: [128, 128, 128], hex: "#808080" })));
      return { ...out, grid };
    },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  const std = report.candidates.find((c) => c.profileId === report.standardProfileId);
  const flat = report.candidates.find((c) => c.profileId !== report.standardProfileId);

  assert.ok(flat.metrics.usedColors < std.metrics.usedColors,
    "纯色候选的用色数没有更低 —— 用例前提不成立");
  assert.ok(flat.metrics.fragmentation < std.metrics.fragmentation,
    "纯色候选的碎化没有更低 —— 用例前提不成立");
  assert.ok(flat.metrics.perceptualError > std.metrics.perceptualError * 2,
    `纯色候选的色差没有成倍恶化（${flat.metrics.perceptualError} vs ${std.metrics.perceptualError}）`
    + " —— 用例前提不成立，G 条测的就不是这件事了");
  assert.equal(report.selectedProfileId, report.standardProfileId,
    "纯色候选胜出了 —— 目标表在这个形状上会奖励它，必须有门槛拦住");
  assert.equal(flat.rejectReason, "G-resemblance",
    `拦住纯色候选的是「${flat.rejectReason}」而不是色差门槛 —— 需要复核结构指标为什么失效`);
});

test("§23 换过候选时必须有可复核的理由：decision 形如 better-on:<指标>", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = makeTuner({ source, route: "auto" });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  if (report.selectedProfileId === report.standardProfileId) {
    assert.ok(["standard-is-best", "no-material-gain", "below-minimum-gain", "standard-failed"]
      .includes(report.decision),
      `回到 standard 但 decision 是「${report.decision}」—— 这个理由说不通`);
  } else {
    assert.match(report.decision, /^better-on:/,
      `换了候选但 decision 是「${report.decision}」—— 报告里将无法解释为什么换`);
    assert.ok(report.reason.includes(report.decision.slice("better-on:".length)),
      "reason 里没有点名赢在哪一项");
  }
  void real;
});

/* =========================================================
 * §26 生产闸门
 * ======================================================= */

test("§26 第一阶段只有「智能」（auto）启用 Auto Tune", () => {
  assert.equal(isAutoTuneEnabledFor("auto"), true, "智能模式没启用 —— 那 §13 就没接上生产");
  for (const mode of GENERATION_MODES) {
    if (mode === "auto") continue;
    assert.equal(isAutoTuneEnabledFor(mode), false,
      `${mode} 也启用了 Auto Tune —— §26 明确说第一阶段只给智能模式`);
  }
});

test("§26 非字符串 / 未知模式一律不启用（不抛）", () => {
  for (const bogus of [null, undefined, "", "smart", "AUTO", 0, {}]) {
    assert.equal(isAutoTuneEnabledFor(bogus), false, `${String(bogus)} 被判成启用了`);
  }
});
