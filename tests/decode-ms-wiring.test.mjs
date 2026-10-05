/**
 * Stage C0 §15 —— decodeMs 接线：把 Worker 结果反序列化的耗时接出到性能报告。
 *
 * ── 修之前是什么样 ────────────────────────────────────────────────────────
 * B5 §14 的性能表里，智能模式（Auto Tune）那一列的 `decodeMs(workerClient)`
 * **恒为 null**。不是 worker 没计时 —— `generation-worker-client.mjs` 每次都会把
 * `decodeGenerationResult(envelope)` 的耗时挂在返回值上。是这条链路把它丢了：
 *
 *   worker 客户端            →  runGenerationJob  →  runAutoTuneV2  →  processImageV2
 *   { …, decodeMs }             { …, decodeMs }       ✗ 没带          result.decodeMs = undefined
 *
 * `runAutoTuneV2` 的返回体只挑了 grid / width / height / diagnostics / pipeline，
 * 于是 `processImageV2` 读 `result.decodeMs` 永远是 undefined，
 * commit profile 就写了一个 null。单次生成路径一直有值，只有智能模式缺 ——
 * 表现是「性能表在智能模式下永远少一格」，谁也没法判断结构化克隆占了多少。
 *
 * 这个文件守四段接线 + 一个语义细节（缓存命中时 null 是**正确答案**）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const autoTune = readFileSync(new URL("../services/auto-tune.mjs", import.meta.url), "utf8");
const client = readFileSync(new URL("../services/generation-worker-client.mjs", import.meta.url), "utf8");

test("§15 起点：worker 客户端仍然在量反序列化耗时", () => {
  assert.match(client, /const tDecode = .*performance\.now\(\)/);
  assert.match(client, /const decoded = decodeGenerationResult\(envelope\)/);
  assert.match(client, /decodeMs/, "返回值里必须带上 decodeMs");
});

test("§15 中段①：auto-tune 报告带上赢家的 decodeMs 与它的来源", () => {
  assert.match(autoTune, /decodeMs: null,\s*\n\s*decodeMsSource: null,/, "base 里必须有这两个字段的默认值");
  assert.match(autoTune, /decodeMs: Number\.isFinite\(Number\(result\?\.decodeMs\)\) \? Number\(result\.decodeMs\) : null/,
    "预览候选的 decodeMs 必须记进 entry");
  assert.match(autoTune, /finalDecodeMs = Number\.isFinite\(Number\(winner\.decodeMs\)\) \? Number\(winner\.decodeMs\) : null/, "复用预览网格时取赢家那一次的");
  assert.match(autoTune, /finalDecodeMs = Number\.isFinite\(Number\(finalResult\.decodeMs\)\) \? Number\(finalResult\.decodeMs\) : null/, "重跑正式时取正式那一次的");
  assert.match(autoTune, /decodeMs: finalDecodeMs,\s*\n\s*decodeMsSource: finalDecodeMsSource,/, "报告必须把它们带出去");
});

test("§15 中段②：缓存命中时 decodeMs 必须是 null，不能沿用旧数字", () => {
  // 归因漂移：缓存命中那一轮根本没跑 worker，也就没发生反序列化。
  // 沿用缓存里的旧数字 = 把「上一次生成的开销」记到这一次头上，
  // 正是 §15 要消灭的那类空格。source 用来区分「没量到」和「本来就没有」。
  assert.match(autoTune, /decodeMs: null, decodeMsSource: "cache-hit"/);
  assert.match(autoTune, /这次调用里\*\*没有发生\*\*任何反序列化|没有发生任何反序列化/);
});

test("§15 中段③：stripEntry 是显式白名单，decodeMs 不会漏进 candidates", () => {
  const strip = autoTune.slice(autoTune.indexOf("const stripEntry = (entry) => ({"), autoTune.indexOf("});", autoTune.indexOf("const stripEntry = (entry) => ({")));
  assert.doesNotMatch(strip, /decodeMs/, "candidates 是给评测器看的候选表，不该被赢家的计时污染");
  assert.doesNotMatch(strip, /diagnostics/, "diagnostics 同样只在赢家那条上带出去");
});

test("§15 终点：runAutoTuneV2 的返回体必须带上 decodeMs（缺的就是这一步）", () => {
  // 从「报告去掉 grid 再落 state」之后的那个 return 开始切，切到函数收尾。
  const anchor = app.indexOf("const { grid, ...rest } = report;");
  assert.ok(anchor > 0, "找不到 runAutoTuneV2 的落 state 段");
  const tail = app.slice(anchor, anchor + 1600);
  const returnBody = tail.slice(tail.indexOf("return {"), tail.indexOf("\n  };", tail.indexOf("return {")));
  assert.ok(returnBody.length > 100, `返回体切片太短，切错了：${returnBody.slice(0, 80)}`);
  assert.match(returnBody, /grid,/);
  assert.match(returnBody, /diagnostics: report\.diagnostics \?\? null,/);
  assert.match(returnBody, /decodeMs: Number\.isFinite\(Number\(report\.decodeMs\)\) \? Number\(report\.decodeMs\) : null/,
    "缺的正是这一步：没有它，processImageV2 读 result.decodeMs 永远是 undefined");
  assert.match(returnBody, /decodeMsSource: report\.decodeMsSource \?\? null/);
  // 必须落在 runAutoTuneV2 函数体内
  const fnStart = app.indexOf("async function runAutoTuneV2(");
  const fnEnd = app.indexOf("* §12 提交路径 profile");
  assert.ok(fnStart > 0 && fnEnd > fnStart, "找不到 runAutoTuneV2 的边界");
  assert.ok(anchor > fnStart && anchor < fnEnd, "返回体必须在 runAutoTuneV2 里");
});

test("§15 commit profile 记账：带上 source，让 null 的两种含义可分辨", () => {
  assert.match(app, /label: "decodeMs\(workerClient\)", ms: result\.decodeMs \?\? null, source: result\.decodeMsSource \?\? null/);
  // 汇总口径不变：decodeMs 与 commitTotal 本身都不计入 commitTotal
  assert.match(app, /row\.label !== "decodeMs\(workerClient\)" && row\.label !== "commitTotal"/);
});

test("§15 主线程回退路径不谎报 decodeMs（没发生反序列化就不该有值）", () => {
  const fallback = app.slice(app.indexOf("const envelope = job.executeGenerationJob(request);"), app.indexOf("function rasterizePortraitPremium"));
  assert.match(fallback, /return \{\s*\n\s*grid: envelope\.grid, width: envelope\.width, height: envelope\.height,/);
  assert.doesNotMatch(fallback, /decodeMs/, "主线程路径没有 worker 反序列化，不许编一个数出来");
});

test("§15 单次生成路径的接线没有被这次改动弄坏", () => {
  // runGenerationJob 走 worker 时原样透传客户端返回值
  assert.match(app, /return await client\.run\(request, \{/);
  // runCandidate 把返回值原样展开，decodeMs 跟着过去
  assert.match(app, /return \{ \.\.\.out, timingMs: performance\.now\(\) - t0 \}/);
});
