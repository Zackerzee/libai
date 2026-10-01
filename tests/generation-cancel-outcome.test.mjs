/**
 * 取消与「预期结局」接线测试（Stage B3 §29 / §31 / §33）。
 *
 * 这是 B3 里最容易出错、也最难在真机上复现的一块：
 *
 *   · **取消被报成失败**：上一版 processProductionV2 把 AbortError 咽成 `false`，
 *     适配层看见 false 就抛「现有生成链路未返回结果」。用户主动点了取消，
 *     界面却报了一条他没犯过的错。这是本文件第一组断言要钉死的事。
 *   · **残留标记**：模块级标记如果只读不清，下一次真实失败会被误判成取消，
 *     于是「算法炸了」变成静默什么都不发生 —— 比报错更糟。
 *   · **取消按钮是装饰品**：按钮画出来了，但点下去没有真的停。
 *
 * 真机行为（真的 terminate、界面真的能滚动）由 tools/b3-worker-probe.mjs 覆盖。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const [APP, SERVICE, WORKSPACE, CLIENT, CSS] = await Promise.all([
  read("../app.js"),
  read("../services/generation-service.js"),
  read("../ui/workspace.js"),
  read("../services/generation-worker-client.mjs"),
  read("../styles/workspace.css"),
]);

/* ── 预期结局：定义与传播 ─────────────────────────────────────────────── */

test("预期结局：三种结局各有独立的 error.name，且都用中文文案", () => {
  assert.match(APP, /const GENERATION_OUTCOME_ERROR_NAMES = Object\.freeze\(\{/);
  assert.match(APP, /cancelled:\s*"AbortError"/);
  assert.match(APP, /stale:\s*"StaleGenerationError"/);
  assert.match(APP, /deferred:\s*"GenerationDeferredError"/);
  assert.match(APP, /const GENERATION_OUTCOME_MESSAGES = Object\.freeze\(\{/);
  // 文案必须是中文 —— 它会出现在状态栏。
  assert.match(APP, /cancelled:\s*"生成已取消"/);
  assert.match(APP, /deferred:\s*"等待源图比例，暂不生成"/);
});

test("预期结局：标记必须「取走即清空」，不能只读不清（残留会吞掉下一次真失败）", () => {
  const block = APP.slice(APP.indexOf("let expectedGenerationOutcome"), APP.indexOf("function generationOutcomeError"));
  assert.match(block, /function takeExpectedGenerationOutcome\(\)/);
  assert.match(block, /expectedGenerationOutcome = null;/, "取走时必须清空");
  assert.match(block, /const outcome = expectedGenerationOutcome;[\s\S]*expectedGenerationOutcome = null;/);
});

test("预期结局：bridge.generate 先看标记、再看过期，最后才判失败（顺序不能颠倒）", () => {
  const start = APP.indexOf("async generate({ width, height, maxColors, overwriteApproved = false } = {}) {");
  assert.ok(start > 0, "找不到 bridge.generate");
  const body = APP.slice(start, start + 2200);
  const outcomeAt = body.indexOf("takeExpectedGenerationOutcome()");
  const staleAt = body.indexOf("isStaleGenerationRequest(requestId)");
  const failureAt = body.indexOf("!generated && state.lastGenerationError");
  assert.ok(outcomeAt > 0, "bridge.generate 必须消费预期结局标记");
  assert.ok(outcomeAt < staleAt, "预期结局必须优先于过期判定（否则取消会显示成「已丢弃过期结果」）");
  assert.ok(staleAt < failureAt, "过期判定必须优先于失败判定");
  assert.doesNotMatch(body, /if \(isStaleGenerationRequest\(requestId\)\) return null;/, "过期不得静默 return null —— 会被适配层读成链路故障");
});

test("预期结局：processProductionV2 对取消 / 过期留下标记，且不写 lastGenerationError", () => {
  const start = APP.indexOf("async function processProductionV2(");
  const body = APP.slice(start, start + 2600);
  assert.match(body, /if \(error\?\.name === "AbortError"\) \{ markExpectedGenerationOutcome\("cancelled"\); setStatus\("已取消生成"\); return false; \}/);
  assert.match(body, /if \(error\?\.name === "StaleGenerationError"\) \{ markExpectedGenerationOutcome\("stale"\); return false; \}/);
  // 取消分支必须在 lastGenerationError 赋值之前 return。
  const cancelAt = body.indexOf('markExpectedGenerationOutcome("cancelled")');
  const errorAt = body.indexOf("state.lastGenerationError = error.message");
  assert.ok(cancelAt > 0 && cancelAt < errorAt, "取消不得写入 lastGenerationError");
});

test("预期结局：尺寸未解析的「延后」也算预期结局，不报链路故障", () => {
  const start = APP.indexOf("function deferGenerationForUnresolvedSize()");
  const body = APP.slice(start, start + 600);
  assert.match(body, /markExpectedGenerationOutcome\("deferred"\)/);
});

test("预期结局：适配层按 name 识别并吞掉，不抛给调用方", () => {
  assert.match(SERVICE, /if \(bridge\.isExpectedGenerationOutcome\?\.\(error\)\) return null;/);
  // 吞掉之前必须先把 generating 放下，否则取消按钮会一直亮着。
  const catchBlock = SERVICE.slice(SERVICE.indexOf("} catch (error) {"));
  assert.ok(catchBlock.indexOf("generating: false") < catchBlock.indexOf("isExpectedGenerationOutcome"));
});

test("预期结局：bridge 暴露 isExpectedGenerationOutcome 给适配层", () => {
  assert.match(APP, /isExpectedGenerationOutcome\(error\) \{ return isExpectedGenerationOutcome\(error\); \}/);
});

/* ── 取消：必须真停 ──────────────────────────────────────────────────── */

test("取消：客户端用真 terminate，不是标记等待", () => {
  assert.match(CLIENT, /cancel\(reason = "生成已取消"\) \{/);
  const start = CLIENT.indexOf('cancel(reason = "生成已取消") {');
  const body = CLIENT.slice(start, start + 500);
  assert.match(body, /detach\(\)/, "必须真的把 Worker 拆掉");
  assert.match(body, /new GenerationCancelledError\(reason\)/);
  assert.match(CLIENT, /class GenerationCancelledError[\s\S]*this\.name = "AbortError";/, "name 必须是 AbortError，上层靠它识别");
});

test("取消：新请求顶掉旧请求时也要 terminate（否则新任务排在旧任务后面）", () => {
  const start = CLIENT.indexOf("run(request, { onProgress = null, transfer = undefined } = {}) {");
  const body = CLIENT.slice(start, start + 900);
  const supersedeAt = body.indexOf("new GenerationStaleError");
  const detachAt = body.indexOf("detach()");
  assert.ok(supersedeAt > 0 && detachAt > 0, "顶掉旧请求时必须 detach");
  assert.ok(detachAt < supersedeAt, "先拆 Worker 再 reject，避免旧任务继续占 CPU");
});

test("取消：主线程兜底路径靠推进 requestId 让本轮作废（没有 terminate 可用）", () => {
  const start = APP.indexOf("function cancelGeneration(reason = \"生成已取消\") {");
  const body = APP.slice(start, start + 900);
  assert.match(body, /generationWorkerClient\?\.cancel\(reason\)/, "优先走真 terminate");
  assert.match(body, /state\.generationRequestId = \(Number\(state\.generationRequestId\) \|\| 0\) \+ 1;/, "兜底路径必须让本轮作废");
  assert.match(body, /markExpectedGenerationOutcome\("cancelled"\)/);
  // 没有在跑时必须返回 false，且不能留下标记。
  assert.match(body, /if \(state\.isProcessingImage\) \{/);
  assert.match(body, /return false;/);
});

test("取消：取消不是失败 —— 不退回主线程重跑（点了取消不能又开始算）", () => {
  const start = APP.indexOf("async function runGenerationJob(");
  const body = APP.slice(start, start + 2600);
  assert.match(body, /if \(error\?\.name === "AbortError" \|\| error\?\.name === "StaleGenerationError"\) throw error;/);
  const rethrowAt = body.indexOf("AbortError");
  const fallbackAt = body.indexOf("job.executeGenerationJob(request)");
  assert.ok(rethrowAt > 0 && rethrowAt < fallbackAt, "取消必须在退回主线程之前抛出去");
});

/* ── UI：取消按钮 ────────────────────────────────────────────────────── */

test("取消按钮：存在、默认隐藏、只有生成中才显示", () => {
  assert.match(WORKSPACE, /id="ws-cancel-generate"[^>]*hidden/, "默认必须隐藏");
  assert.match(WORKSPACE, /cancelButton\.hidden = !state\.status\.generating;/, "可见性必须由 generating 驱动");
});

test("取消按钮：点击后真调 bridge，且状态栏给出可读结果", () => {
  const start = WORKSPACE.indexOf('$("#ws-cancel-generate").addEventListener("click"');
  assert.ok(start > 0, "取消按钮必须有 click 处理器");
  const body = WORKSPACE.slice(start, start + 700);
  assert.match(body, /bridge\.cancelGeneration\?\.\(\)/);
  assert.match(body, /已取消生成/);
  assert.match(body, /当前没有正在进行的生成/, "没有任务时要给出可读提示，而不是静默");
});

test("取消按钮：有独立危险色样式，不与主按钮混淆", () => {
  assert.match(CSS, /\.ws-button-danger\s*\{[^}]*background:\s*#d9483b/);
});

test("取消按钮：不引入第二套「生成中」判定 —— 仍以 status.generating 为准", () => {
  // 生成按钮的禁用与取消按钮的可见性必须读同一个源，否则会出现
  // 「生成按钮灰了但取消按钮不出现」这种用户完全无法自救的状态。
  assert.match(WORKSPACE, /\$\("#ws-generate"\)\.disabled = !hasSource \|\| state\.status\.generating;/);
});

/* ── 陈旧结果：两道守卫都要在 ───────────────────────────────────────── */

test("陈旧结果：app.js 与客户端各有一道守卫，不能只留一道（§33）", () => {
  // 第一道：app.js 的 requestId 比对。
  const guards = APP.match(/isStaleGenerationRequest\(/g) || [];
  assert.ok(guards.length >= 8, `app.js 的过期守卫点太少：${guards.length}`);
  // 第二道：客户端丢弃 requestId 不匹配的回包。
  assert.match(CLIENT, /if \(pending && requestId != null && pending\.requestId !== requestId\) return;/);
  assert.match(CLIENT, /if \(!pending && requestId != null && latestRequestId != null && requestId !== latestRequestId\) return;/);
});

test("陈旧结果：取消后不会被后续回包重新点亮（Worker 已死，回包不该存在）", () => {
  // terminate 之后 worker 为 null，onmessage 也随实例一起丢弃；
  // 断言 pending 被清空，避免「取消后 promise 悬着」。
  const start = CLIENT.indexOf('cancel(reason = "生成已取消") {');
  const body = CLIENT.slice(start, start + 500);
  assert.match(body, /settle\("reject"/);
  assert.match(body, /return had;/);
});
