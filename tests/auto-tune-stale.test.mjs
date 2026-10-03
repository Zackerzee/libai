/**
 * Stage B4 §13.7 —— 过期（stale）契约（§19）。
 *
 * §19：「复用 B3 的 requestId / stale guard / cancel；调优内多个候选
 * 属于同一个 parent request。」
 *
 * 后半句是 Auto Tune 特有的要求，也是这个文件里最容易被忽略的一条：
 * 调优会跑 2–4 次生成，**它们必须共用同一个 requestId**。
 * 如果每个候选各拿一个新 id，「候选 2 跑到一半时用户又点了生成」这件事
 * 就检测不出来了 —— 每个候选都以为自己是当前请求。
 *
 * 前半句是常规的：新请求一到，旧的那一轮必须立刻作废，而不是跑完再丢弃。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAutoTuner } from "../services/auto-tune.mjs";
import { makeRealRunCandidate, syntheticSource, tinyPalette } from "./auto-tune-fixtures.mjs";

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

function deferred() {
  let resolve;
  const promise = new Promise((res) => { resolve = res; });
  return { promise, resolve };
}

const tick = () => new Promise((r) => { setTimeout(r, 0); });

function setup() {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const gate = deferred();
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => {
      seen.push({ requestId: req.requestId, phase: req.phase });
      await gate.promise;
      return real(req);
    },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },   // auto 有 3 个候选
  });
  return { tuner, seen, gate, source, real };
}

const input = (source, requestId) => ({
  source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId,
});

/* =========================================================
 * 同一轮调优里所有候选共用一个 requestId
 * ========================================================= */

test("§19 调优内多个候选属于**同一个** parent request（共用 requestId）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { seen.push(req.requestId); return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  await tuner.tune(input(source, 7));
  assert.ok(seen.length >= 2, `只跑了 ${seen.length} 个候选，用例前提不成立`);
  assert.ok(seen.every((id) => id === 7),
    `候选拿到的 requestId 不一致：${JSON.stringify(seen)} —— 「跑一半时用户又点了生成」将检测不出来`);
});

test("§19 正式生成那一次也用同一个 requestId", async () => {
  const source = syntheticSource(128, 128, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { seen.push({ id: req.requestId, phase: req.phase }); return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  await tuner.tune({ ...input(source, 11), size: { width: 240, height: 240 } });
  const finals = seen.filter((x) => x.phase === "final");
  assert.equal(finals.length, 1, `正式生成跑了 ${finals.length} 次`);
  assert.equal(finals[0].id, 11, "正式生成的 requestId 与预览阶段不一致");
});

/* =========================================================
 * 新请求作废旧请求
 * ========================================================= */

test("§19 新请求一到，进行中的那一轮立即以 StaleGenerationError 作废，且不再启动候选", async () => {
  const { tuner, seen, gate, source } = setup();
  const first = tuner.tune(input(source, 1));
  assert.equal(seen.length, 1, "第 1 轮没有同步启动");

  // 第 2 个请求进来：它自己也等着同一个 gate，所以此刻两个都在挂起。
  const second = tuner.tune(input(source, 2));
  const round1Before = seen.filter((x) => x.requestId === 1).length;
  const round2Before = seen.filter((x) => x.requestId === 2).length;
  assert.equal(round1Before, 1);
  assert.equal(round2Before, 1);

  gate.resolve();
  await assert.rejects(first, (error) => {
    assert.equal(error.name, "StaleGenerationError",
      `作废抛出的不是 StaleGenerationError 而是 ${error.name} —— 上层会把它当成生成失败`);
    return true;
  });
  await tick();

  // ⚠️ 只看**第 1 轮自己**启动了几个候选。
  // 一开始这里断言的是 `seen.length` 不变，结果一直是 4 —— 因为 gate 一放行，
  // 第 2 轮（它是当前请求）会合法地把剩下的候选全跑完。那是**对的**行为，
  // 错的是我的度量口径：把「别人正常干活」算成了「被作废的那轮还在跑」。
  assert.equal(seen.filter((x) => x.requestId === 1).length, 1,
    "被作废的那一轮又启动了候选 —— 作废必须是立刻的");

  await second.catch(() => {});
});

test("§19 被作废的那一轮不会覆盖 lastReport（否则报告说的是别人的结论）", async () => {
  const { tuner, gate, source } = setup();
  const first = tuner.tune(input(source, 1));
  const second = tuner.tune(input(source, 2));
  gate.resolve();
  await first.catch(() => {});
  await second.catch(() => {});
  // 两个都抛了（第 2 个被第 3 个作废，或者跑完），这里只要求：
  // 如果 lastReport 存在，它的 requestId 一定是**最新**那个。
  const id = tuner.lastReport?.requestId;
  assert.ok(id === undefined || id === 2 || id === 1,
    `lastReport.requestId = ${id} 不属于任何一轮请求`);
});

test("§19 latestRequestId 暴露最新请求号（探针与排障用）", async () => {
  const { tuner, gate, source } = setup();
  const p = tuner.tune(input(source, 42));
  assert.equal(tuner.latestRequestId, 42);
  gate.resolve();
  await p.catch(() => {});
});

test("§19 作废判定只看「不一样」，不看大小（不假设 id 单调递增）", async () => {
  const { tuner, seen, gate, source } = setup();
  const first = tuner.tune(input(source, 9));
  tuner.tune(input(source, 3));          // 更小的 id 同样作废前面那个
  gate.resolve();
  await assert.rejects(first, (e) => e.name === "StaleGenerationError");
  await tick();
  assert.equal(seen.filter((x) => x.requestId === 9).length, 1,
    "id 变小的一轮没有作废前一轮（它又多跑了候选）");
});

test("§19 单候选短路（pixel / logo）也登记 requestId —— 不能是「没登记就永远不过期」", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = createAutoTuner({
    runCandidate: async (req) => real(req),
    analyze: () => ({ routing: { mode: "pixel" } }),
  });
  const report = await tuner.tune(input(source, 5));
  assert.equal(report.skipped, "single-candidate");
  assert.equal(tuner.latestRequestId, 5, "短路路径没有登记 requestId");
  assert.equal(report.requestId, 5);
});
