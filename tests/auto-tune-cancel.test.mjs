/**
 * Stage B4 §13.7 —— 取消契约（§19）。
 *
 * §19 的原话：「复用 B3 的 requestId / stale guard / cancel；调优内多个候选
 * 属于同一个 parent request；**新请求到来当前调优立即取消**。」
 *
 * 这条在 Auto Tune 上比在单次生成上更要紧，因为调优是**循环**：
 * 单次生成的取消只要终止那一次执行，调优的取消要终止「剩下的 2–3 个候选」。
 * 少终止一个，用户点了取消、界面却在继续生成 —— 正是 B3 §29 要消灭的行为。
 *
 * 所以这里测的不是「cancel() 返回 true」，而是**取消之后还有没有候选被启动**。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { createAutoTuner } from "../services/auto-tune.mjs";
import { makeRealRunCandidate, syntheticSource, tinyPalette } from "./auto-tune-fixtures.mjs";

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** 让微任务队列跑干净（async 函数体在第一个 await 前是同步执行的）。 */
const tick = () => new Promise((r) => { setTimeout(r, 0); });

function setup({ hold = true } = {}) {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const gate = deferred();
  const calls = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => {
      calls.push({ phase: req.phase, labCandidate: req.labCandidate ?? null });
      if (hold) await gate.promise;
      return real(req);
    },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: true },
  });
  const input = { source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 };
  return { tuner, calls, gate, input, source };
}

/* =========================================================
 * 取消
 * ========================================================= */

test("§19 取消进行中的调优 → 立即以 AbortError 结束，**不再启动下一个候选**", async () => {
  const { tuner, calls, gate, input } = setup();
  const p = tuner.tune(input);

  // async 函数体在第一个 await 之前是同步执行的，所以此刻第 1 个候选已经在跑。
  assert.equal(calls.length, 1, "第 1 个候选没有同步启动 —— 用例前提变了");

  const had = tuner.cancel("用户取消");
  assert.equal(had, true, "cancel() 说没有任务可取消，但明明有一个在跑");

  gate.resolve();
  await assert.rejects(p, (error) => {
    assert.equal(error.name, "AbortError",
      `取消抛出的不是 AbortError 而是 ${error.name} —— 上层认不出来，会当成生成失败`);
    return true;
  });
  await tick();
  assert.equal(calls.length, 1,
    `取消之后又启动了 ${calls.length - 1} 个候选（${JSON.stringify(calls)}）—— `
    + "用户点了取消，后台还在继续生成");
});

test("§19 取消后 lastReport 留下 cancelled 标记（排障要能看出来）", async () => {
  const { tuner, gate, input } = setup();
  const p = tuner.tune(input);
  tuner.cancel("用户取消");
  gate.resolve();
  await p.catch(() => {});
  assert.equal(tuner.lastReport?.cancelled, true, "报告里没有取消痕迹");
  assert.equal(tuner.lastReport?.cancelReason, "用户取消");
});

test("§19 没有任务在跑时 cancel() 返回 false（不能谎报「取消了」）", () => {
  const { tuner } = setup({ hold: false });
  assert.equal(tuner.cancel("空转"), false);
  assert.equal(tuner.cancel("再来一次"), false, "同一个空转状态被重复报告成「取消了」");
});

test("§19 取消不是粘性的：取消之后下一次 tune 能正常跑完", async () => {
  const { tuner, gate, input } = setup();
  const first = tuner.tune(input);
  tuner.cancel("用户取消");
  gate.resolve();
  await first.catch(() => {});

  // 第二次：hold 的 gate 已经 resolve 过，直接放行。
  const second = await tuner.tune({ ...input, requestId: 2 });
  assert.ok(second, "取消之后调优器再也起不来了");
  assert.equal(second.cancelled, undefined, "新一次调优带着上一次的取消标记");
  assert.ok(second.selectedProfileId, "新一次调优没有选出候选");
});

test("§19 取消会传播到候选执行器（执行器那边的真终止由调用方负责）", async () => {
  // 调优器只负责「不再启动下一个」；把当前这个真的掐掉是执行器（Worker client）的事。
  // 但调优器必须**明确知道**它被取消了，不能靠「执行器抛了错」来推断。
  const { tuner, calls, gate, input } = setup();
  const p = tuner.tune(input);
  assert.equal(tuner.cancel("用户取消"), true);
  gate.reject(Object.assign(new Error("worker terminated"), { name: "AbortError" }));
  await assert.rejects(p, (error) => error.name === "AbortError");
  await tick();
  assert.equal(calls.length, 1, "执行器抛了 AbortError 之后还继续跑了候选");
});

test("§19 候选执行器抛普通错误 ≠ 取消：那一轮要继续比其它候选", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  let calls = 0;
  const tuner = createAutoTuner({
    runCandidate: async (req) => {
      calls += 1;
      if (calls === 2) throw new Error("第 2 个候选偶发崩溃");
      return real(req);
    },
    analyze: () => ({ routing: { mode: "auto" } }),
    // 用非生产档，auto 有 3 个候选 —— 崩掉第 2 个之后必须还有第 3 个要跑。
    limits: { productionOnly: false },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.ok(calls >= 3, `第 2 个候选崩了之后没有继续跑（只跑了 ${calls} 次）—— 一个偶发失败不该毁掉整轮`);
  assert.ok(report.selectedProfileId);
});
