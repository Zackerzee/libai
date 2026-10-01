/**
 * 生成尺寸 UI 接线契约测试（Stage B0 §5 / §6 / §7）。
 *
 * 为什么需要它：这一批修的核心是「拖尺寸不该出图」。而这类纪律**极容易被后续改动
 * 悄悄破坏** —— 只要有人把 `scheduleAutoGenerate()` 加回滑杆的 input 处理器，
 * 界面看起来一模一样，只是每拖一格就重算一次，500 格时主线程会被锁死几分钟。
 * 所以这里做静态取证：只改草稿的入口必须真的只改草稿，生成入口必须唯一。
 *
 * 同时钉住「生成尺寸」与「编辑器画布调整」是两条链路：
 * 前者只暴露长边，后者才允许宽高独立。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WORKSPACE = readFileSync(join(ROOT, "ui/workspace.js"), "utf8");
const APP = readFileSync(join(ROOT, "app.js"), "utf8");
const PANEL = readFileSync(join(ROOT, "ui/generation-panel.js"), "utf8");
const STORE = readFileSync(join(ROOT, "state/store.js"), "utf8");

/** 截取从 startMarker 到 endMarker 之间的源码。 */
function slice(source, startMarker, endMarker) {
  const from = source.indexOf(startMarker);
  assert.ok(from >= 0, `找不到起点：${startMarker}`);
  const to = source.indexOf(endMarker, from);
  assert.ok(to > from, `找不到终点：${endMarker}`);
  return source.slice(from, to);
}

/** 截取一个函数体（从 `function name(` 到下一个同级 `\n  }`）。 */
function fnBody(source, signature) {
  const from = source.indexOf(signature);
  assert.ok(from >= 0, `找不到函数：${signature}`);
  const to = source.indexOf("\n  }", from);
  assert.ok(to > from, `函数 ${signature} 没有正常闭合`);
  return source.slice(from, to);
}

const SIZE_SECTION = slice(WORKSPACE, "// ── 生成尺寸（Generation Size）", "// 选区相关的动作统一走这里");

test("尺寸：滑杆 / 数字框 / 滚轮 / 方向键都只改草稿，不触发生成（§7 生成次数必须为 0）", () => {
  const draftOnly = ["setLongEdgeDraft", "stepLongEdgeDraft", "pushDraftToBridge", "syncSizeUi"];
  for (const name of draftOnly) {
    const body = fnBody(SIZE_SECTION, `function ${name}(`);
    assert.doesNotMatch(body, /scheduleAutoGenerate/, `${name}() 不允许触发自动生成`);
    assert.doesNotMatch(body, /generation\.generate/, `${name}() 不允许直接调生成`);
    assert.doesNotMatch(body, /runAutoGenerate/, `${name}() 不允许直接跑生成`);
  }
  // 滑杆与数字框的 input 处理器只喂草稿
  assert.match(SIZE_SECTION, /#ws-size-range"\)\?\.addEventListener\("input",[^\n]*setLongEdgeDraft\(/);
  assert.match(SIZE_SECTION, /#ws-size-number"\)\?\.addEventListener\("input",[^\n]*setLongEdgeDraft\(/);
});

test("尺寸：唯一生成入口是「应用尺寸」（§7 点击 apply 才 = 1）", () => {
  const commit = fnBody(SIZE_SECTION, "function commitSize(");
  assert.match(commit, /pushDraftToBridge\(\)/, "提交必须先写进 bridge（生成尺寸的唯一事实源）");
  assert.match(commit, /scheduleAutoGenerate\(0\)/, "提交后必须生成一次");
  // 生成只在这里发起：整个尺寸区块里 scheduleAutoGenerate 只应出现在 commitSize 与
  // 导入首帧的 scheduleInitialGeneration 里。
  const calls = SIZE_SECTION.match(/scheduleAutoGenerate\(/g) || [];
  assert.equal(calls.length, 2, `尺寸区块内 scheduleAutoGenerate 调用次数应为 2，实际 ${calls.length}`);
  assert.match(SIZE_SECTION, /#ws-size-apply"\)\?\.addEventListener\("click", commitSize\)/);
});

test("尺寸：滚轮 ±1、Shift+滚轮 ±10，只改草稿（§6）", () => {
  assert.match(SIZE_SECTION, /#ws-size-controls"\)\?\.addEventListener\("wheel"/);
  assert.match(SIZE_SECTION, /event\.shiftKey \? 10 : 1/, "Shift 必须是 ±10");
  assert.match(SIZE_SECTION, /passive: false/, "必须能 preventDefault，否则滚轮会带着页面滚");
  assert.match(SIZE_SECTION, /event\.preventDefault\(\)/);
  // 上滚加、下滚减
  assert.match(SIZE_SECTION, /event\.deltaY < 0 \? step : -step/);
});

test("尺寸：方向键 ↑/↓ ±1、Shift ±10，只改草稿（§6）", () => {
  assert.match(SIZE_SECTION, /#ws-size-controls"\)\?\.addEventListener\("keydown"/);
  assert.match(SIZE_SECTION, /event\.key !== "ArrowUp" && event\.key !== "ArrowDown"/);
  assert.match(SIZE_SECTION, /ArrowUp" \? \(event\.shiftKey \? 10 : 1\)/);
});

test("尺寸：大尺寸分档提示必须存在，且要求显式点「应用尺寸」（§8）", () => {
  assert.match(SIZE_SECTION, /sizeWarningTier\(/);
  assert.match(WORKSPACE, /id="ws-size-tier"/, "顶栏必须有分档提示节点");
  assert.match(SIZE_SECTION, /#ws-size-tier/);
  assert.match(SIZE_SECTION, /超大尺寸[^`]*应用尺寸/, ">400 必须提示超大尺寸并要求显式确认");
  assert.match(SIZE_SECTION, /大尺寸/);
  // 预设 chip 也只改草稿 —— 点 500 不该悄悄跑起来
  const chipBlock = SIZE_SECTION.slice(SIZE_SECTION.indexOf("querySelectorAll(\"[data-size]\")"));
  assert.doesNotMatch(chipBlock.slice(0, 400), /scheduleAutoGenerate/, "预设 chip 不允许触发生成");
  assert.match(chipBlock.slice(0, 400), /setLongEdgeDraft\(chip\.dataset\.size\)/);
});

test("尺寸：顶栏读数不读画布尺寸（§5 生成尺寸与画布调整解耦）", () => {
  const sync = fnBody(SIZE_SECTION, "function syncSizeUi(");
  assert.doesNotMatch(sync, /get\(\)\.canvas/, "生成尺寸栏不能跟随编辑器画布尺寸");
  assert.doesNotMatch(sync, /bridge\.getResult\(\)\.width/, "生成尺寸栏不能跟随已生成网格宽度");
  // 派生尺寸必须走同一个比例函数，否则预览与生成会分叉
  assert.match(sync, /draftSize\(\)/);
  assert.match(SIZE_SECTION, /function draftSize\(\)[\s\S]*?deriveGenerationSize\(longEdgeDraft, effectiveSourceRatio\(\)\)/);
});

test("尺寸：比例未知时读数是 unresolved，不是方图（§1）", () => {
  assert.match(SIZE_SECTION, /bridge\.getEffectiveSourceRatio\?\.\(\) \?\? null/);
  assert.doesNotMatch(SIZE_SECTION, /sourceRatio\(\)/, "旧的「未知即 1」比例函数必须已删除");
  const ratioFn = fnBody(SIZE_SECTION, "function effectiveSourceRatio(");
  assert.doesNotMatch(ratioFn, /\|\| 1|: 1|: 1\.0/, "比例未知绝不能兜底成 1");
  // 未知时读数是「— × —」
  assert.match(SIZE_SECTION, /<strong>—<\/strong><span>×<\/span><strong>—<\/strong>/);
});

test("尺寸：bridge 只暴露长边，不再暴露 setWidth / setHeight / setLockAspectRatio（§5）", () => {
  const bridge = APP.slice(APP.indexOf("window.LibmsWorkspaceBridge = {"));
  for (const gone of ["setWidth(", "setHeight(", "setLockAspectRatio("]) {
    assert.ok(!bridge.includes(`${gone}`), `bridge 不应再有 ${gone}`);
  }
  for (const kept of ["setGenerationLongEdge(", "getGenerationSize(", "getEffectiveSourceRatio"]) {
    assert.ok(bridge.includes(kept), `bridge 缺少 ${kept}`);
  }
});

test("尺寸：旧的方图兜底函数与旧 state 字段已彻底消失（§1 / §3）", () => {
  assert.doesNotMatch(APP, /getGenerationTargetHeight/, "旧的 getGenerationTargetHeight 必须删除");
  assert.doesNotMatch(APP, /state\.targetHeight/, "state.targetHeight 必须删除");
  assert.doesNotMatch(APP, /state\.aspectRatioLocked/, "state.aspectRatioLocked 必须删除");
  assert.doesNotMatch(STORE, /targetHeight:/, "store 不应再有 targetHeight 默认值");
  assert.doesNotMatch(STORE, /aspectRatioLocked:/, "store 不应再有 aspectRatioLocked 默认值");
  assert.match(STORE, /generationLongEdge: 0/, "store 必须有 generationLongEdge（0 = 未解析）");
  assert.match(STORE, /generationRequestId: 0/, "store 必须有 generationRequestId");
});

test("尺寸：比例未就绪时统一走「延后」，不生成", () => {
  assert.match(APP, /function deferGenerationForUnresolvedSize\(/);
  const defer = fnBody(APP, "function deferGenerationForUnresolvedSize(");
  assert.match(defer, /return false/, "延后必须返回 false，调用方据此不再往下走");
  assert.doesNotMatch(defer, /generationLongEdge\s*=/, "延后不得顺手改尺寸");
  // 四个生成入口都必须处理 size === null
  const nullChecks = APP.match(/if \(!size\) (return deferGenerationForUnresolvedSize\(\)|throw new Error)/g) || [];
  assert.ok(nullChecks.length >= 4, `比例未就绪的分支应覆盖全部生成入口，实际 ${nullChecks.length} 处`);
});

test("Worker-ready：每个 await 边界之后都有陈旧结果保护（§10）", () => {
  assert.match(APP, /function isStaleGenerationRequest\(requestId\)/);
  const guards = APP.match(/isStaleGenerationRequest\(options\.requestId\)|isStaleGenerationRequest\(requestId\)/g) || [];
  // v2.5 主链路 3 处（动态 import / 读图 / 流水线回来）+ 旧链路 3 处 + BGS/PW 各 1 处 + generate() 1 处
  assert.ok(guards.length >= 9, `陈旧保护点过少（${guards.length}），有 await 边界没被覆盖`);
  // 生成执行必须经过 Worker-ready 边界
  assert.match(APP, /function runGenerationJob\(/);
  assert.match(APP, /window\.LibmsGenerationJob/);
  assert.match(APP, /window\.LibmsGenerationRequest/);
  assert.match(APP, /executeGenerationJob\(request\)/);
});

test("Worker-ready：契约模块的 import query 与预载保持一致（避免两份模块实例）", () => {
  const queries = APP.match(/services\/source-editor-service\.js\?v=[\w-]+/g) || [];
  assert.ok(queries.length > 0, "找不到 source-editor-service 的 import");
  const unique = [...new Set(queries)];
  assert.equal(unique.length, 1, `source-editor-service 出现了多个 query，会产生两份模块实例：${unique.join(" / ")}`);
});

test("尺寸：生成面板不再持有 width / height / lockAspectRatio（§5 不共用同一套 state）", () => {
  assert.doesNotMatch(PANEL, /lockAspectRatio/, "面板不应再管比例锁定");
  const stateBlock = PANEL.slice(PANEL.indexOf("this.state = {"), PANEL.indexOf("...initialState"));
  assert.doesNotMatch(stateBlock, /^\s*width:/m, "面板 state 不应再有 width");
  assert.doesNotMatch(stateBlock, /^\s*height:/m, "面板 state 不应再有 height");
});

test("尺寸：导入首帧生成等倍数识别落地，只跑一次（§4 触发风暴）", () => {
  assert.match(WORKSPACE, /function scheduleInitialGeneration\(/);
  const initial = fnBody(WORKSPACE, "function scheduleInitialGeneration(");
  assert.match(initial, /ensureMultipleDetection\(url\)/, "首帧必须等识别 settle");
  assert.match(initial, /\.catch\(\(\) => \{\}\)/, "识别失败也必须继续出图，不能卡住");
  assert.equal((initial.match(/scheduleAutoGenerate\(/g) || []).length, 1, "首帧只能触发一次生成");
  // source-loaded 不再直接排生成
  const loaded = WORKSPACE.slice(WORKSPACE.indexOf('window.addEventListener("libms:source-loaded"'));
  assert.match(loaded.slice(0, 900), /scheduleInitialGeneration\(\)/);
  assert.doesNotMatch(loaded.slice(0, 900), /scheduleAutoGenerate\(/, "导入监听器里不应再直接排生成");
});

test("尺寸：像素倍数识别被保留，且识别失败也走一次 applyLogicalSize（§2 / §3）", () => {
  assert.match(WORKSPACE, /detectPixelMultiple/, "detectPixelMultiple 是「自动」档的唯一依据，不能删");
  assert.match(WORKSPACE, /logicalSize/, "logicalSize 是「自动」档的唯一依据，不能删");
  const detection = fnBody(WORKSPACE, "function ensureMultipleDetection(");
  assert.match(detection, /\.catch\(\(\) => \{ detectedMultiple = 1; \}\)/, "识别失败退化为 1×");
  assert.match(detection, /\.then\(\(\) => \{ applyLogicalSize\(\); return detectedMultiple; \}\)/, "成功与失败都必须走 applyLogicalSize");
  // 旧倍数 UI 的死代码必须清干净
  for (const dead of ["manualMultiple", "syncMultipleReadout", "effectiveMultiple", "data-multiple-step", "ws-multiple-value"]) {
    assert.ok(!WORKSPACE.includes(dead), `旧倍数死代码残留：${dead}`);
  }
});
