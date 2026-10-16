/*
 * 背景处理「点了没反应」。
 *
 * 用户原话：「背景处理 点击处理好像没有反应」。
 *
 * 根因：预检条按模式分流，但**只有 auto + 可靠**这一种才真的需要用户拍板
 * （[应用] / [保留背景]）。原来代码写的是 `if (mode !== "auto") scheduleAutoGenerate(0)`，
 * 于是 auto + 不可靠（= 引擎的可靠性门无论如何都会保持原图）也被拦住了：
 * 用户点完「自动移除纯色背景」，预检条出现一句「已保持原图」，
 * 但**出图那一步没跑** —— 画布纹丝不动，看起来就是「点了没反应」。
 *
 * 现在的规则：告知完就照常生成，只有 auto + 可靠才停下来问。
 *
 * 顺带：hideBackgroundPreview 以前只置 hidden、不复位 dataset.status，
 * 留下「条子已经收起来了、状态却还写着正在检查」的自相矛盾残留。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WORKSPACE = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");

/** 把 workspace.js 里某个顶层函数切出来（它不依赖任何闭包变量才能这样切）。 */
function sliceFunction(name) {
  const at = WORKSPACE.indexOf(`function ${name}(`);
  assert.ok(at > 0, `找不到 function ${name}`);
  const end = WORKSPACE.indexOf("\n  }", at);
  assert.ok(end > at, `function ${name} 的结尾没找到`);
  return WORKSPACE.slice(at, end + 4);
}

test("只有 auto + 可靠才需要用户拍板（纯函数，可直接跑）", () => {
  const needs = new Function(`${sliceFunction("backgroundPreviewNeedsUserDecision")}; return backgroundPreviewNeedsUserDecision;`)();
  assert.equal(needs("auto", { reliable: true }), true, "auto + 可靠 → 要问用户");
  assert.equal(needs("auto", { reliable: false }), false, "auto + 不可靠 → 别拦，直接生成");
  assert.equal(needs("auto", null), false, "没有结论 → 别拦");
  assert.equal(needs("keep", { reliable: true }), false, "keep 是用户显式选的，不拦");
  assert.equal(needs("transparent", { reliable: false }), false, "transparent 同理");
});

test("requestBackgroundPreview 用这条规则决定要不要继续生成", () => {
  assert.match(
    WORKSPACE,
    /if \(!backgroundPreviewNeedsUserDecision\(mode, result\)\) scheduleAutoGenerate\(0\);/,
  );
  // 旧的「非 auto 才继续」形态必须消失 —— 它正是「点了没反应」的来源
  assert.doesNotMatch(WORKSPACE, /if \(mode !== "auto"\) scheduleAutoGenerate\(0\);/);
});

test("预检条三种形态里只有 auto + reliable 会拦住生成（注释与代码一致）", () => {
  const at = WORKSPACE.indexOf("阶段 3：预检条按模式分流");
  assert.ok(at > 0, "找不到预检条分流的说明注释");
  const doc = WORKSPACE.slice(at, at + 900);
  assert.match(doc, /只有 auto \+ reliable 会拦住生成/, "这条规则必须写在代码旁边，否则下一个人会改回去");
});

test("hideBackgroundPreview 同时复位 dataset.status（不留过期结论）", () => {
  const hide = sliceFunction("hideBackgroundPreview");
  const strip = { hidden: false, dataset: { status: "probing" } };
  const run = new Function("$", `${hide}; return hideBackgroundPreview;`)(() => strip);
  run();
  assert.equal(strip.hidden, true, "条子要收起来");
  assert.equal(strip.dataset.status, undefined, "过期结论必须清掉");
});

test("没有源图时预检返回 null，走兜底照常生成（不会卡在正在检查）", () => {
  // app.js 的桥接层：没有 sourceDataUrl 直接返回 null → 调用方 fallbackToDirectGeneration
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  assert.match(app, /async previewBackgroundRemoval\(\{ width, height, mode = "auto" \} = \{\}\) \{\s*if \(!state\.sourceDataUrl\) return null;/);
  assert.match(WORKSPACE, /if \(!result\) \{ fallbackToDirectGeneration\(\); return; \}/);
  assert.match(sliceFunction("fallbackToDirectGeneration"), /scheduleAutoGenerate\(0\)/, "兜底必须真的把生成发出去");
});
