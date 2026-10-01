/**
 * 尺寸权威链的**接线契约**（Stage B0.1）。
 *
 * tests/source-dimensions.test.mjs 钉的是纯函数语义；本文件钉的是「谁在哪里调它」。
 * 两者缺一不可：语义对了但没人调（或者调的是旧出口），线上照样是坏的 ——
 * B0.1 修的两个 bug 都属于这一类：
 *
 *   ① applyRestoreSizing() 只写 #granularity-input，而尺寸真源是 generationLongEdge
 *      → 识别结果写进了一个没人读的 DOM 控件
 *   ② applyRestoreSizing() 挂在 processImage() 里，而默认引擎是 v2.5
 *      → 这条路径根本不可达
 *
 * 所以本文件的核心断言是「**旧出口不存在**」而不只是「新出口存在」。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");

/** 按签名截出函数体（大括号配平）。找不到 / 不闭合直接炸，不留假绿灯。 */
function fnBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, `找不到函数：${signature}`);
  const open = source.indexOf("{", start + signature.length - 1);
  assert.ok(open !== -1, `找不到函数体起点：${signature}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`函数体不闭合（可能含未配平的字面量）：${signature}`);
}

/* ────────────────────────────── app.js ────────────────────────────── */

test("source-dimensions.mjs 只被动态 import 一次，且与运行时模块同一实例", () => {
  const imports = app.match(/import\(["'][^"']*source-dimensions\.mjs[^"']*["']\)/g) || [];
  assert.equal(imports.length, 1, `必须只有一个 import 点，实际 ${imports.length} 个 —— 两个实例 = 两份模块状态`);
  assert.match(imports[0], /source-dimensions\.mjs\?v=20261001-stage-b01/);
  assert.match(app, /window\.LibmsSourceDimensions = mod/);
});

test("resolveGenerationDimensions 委托权威链，不再自己判优先级", () => {
  const body = fnBody(app, "function resolveGenerationDimensions(longEdge)");
  assert.match(body, /authorityApi\.resolveSizeFromEvidence\(state\.sourceDimensions/);
  // 派生出的长边才回写 state；绝对权威不回写（那不是「用户选的长边」）
  assert.match(body, /if \(!size\.absolute\) state\.generationLongEdge = size\.longEdge;/);
  assert.match(body, /if \(!size\) return null;/, "拿不到尺寸必须返回 null，让调用方延后生成");
});

test("§8 旧出口已拆：applyRestoreSizing 不再直接写 granularity DOM", () => {
  const body = fnBody(app, "function applyRestoreSizing(image)");
  assert.doesNotMatch(body, /syncRangeControls\(\s*["']granularity["']/, "尺寸真源不得是 DOM 控件");
  assert.doesNotMatch(body, /granularityInput/, "同上：不得直接读写 #granularity-input");
  assert.doesNotMatch(body, /state\.generationLongEdge\s*=/, "不得绕过权威链直接改长边");
  // 唯一出口
  assert.match(body, /applySourceDimensions\(\{/);
  assert.match(body, /authority: "grid-detection"/, "显式格距检测 = 绝对权威");
  assert.match(body, /authority: "logical-heuristic"/, "只有原图宽度可用 = 最弱证据");
});

test("§8 旧出口已拆：applyRestoreSizing 脱离 legacy 生成路径", () => {
  // 以前写成 applyRestoreSizing(image) 这句**调用**，只有 legacy 引擎会走到；默认 v2.5 不可达。
  // 注意要匹配「调用」而不是函数定义 —— `function applyRestoreSizing(image) {` 也含同样的子串。
  assert.doesNotMatch(app, /applyRestoreSizing\(image\)\s*;/, "不得留在 processImage 的 legacy 分支里");
  assert.match(app, /function applyRestoreSizing\(image\)/, "函数本身当然还在");
  assert.match(app, /applyRestoreSizing\(loadedSource\)/, "必须在 loadFile 的源图落地处调用");
});

test("§1 换图先重置再写新证据，顺序不能反", () => {
  const resetAt = app.indexOf('resetSourceDimensions("source-replaced")');
  const applyAt = app.indexOf("applyRestoreSizing(loadedSource)");
  assert.ok(resetAt !== -1, "loadFile 必须重置尺寸");
  assert.ok(applyAt !== -1, "loadFile 必须提交新证据");
  assert.ok(resetAt < applyAt, "必须先 resetSourceDimensions 再 applyRestoreSizing —— 否则上一张图的绝对权威会挡掉新证据");
});

test("§1 各级证据都从正确的来源标注写入", () => {
  assert.match(app, /authority: "structured-project",\s*\n\s*source: payload\.format/, "工程文件 → structured-project");
  assert.match(app, /authority: "manual-calibration", source: "direct-pattern-form"/, "手填格数 → manual-calibration");
  assert.match(app, /authority: "grid-detection", source: `cell-spacing:/, "格距检测 → grid-detection");
  assert.match(app, /authority: "logical-heuristic", source: "natural-size"/, "原图尺寸 → logical-heuristic");
});

test("§5 空白画板是编辑器画布，不得记为源图尺寸", () => {
  const at = app.indexOf('resetSourceDimensions("blank-board")');
  assert.ok(at !== -1, "新建空白画板必须把源图尺寸打回未解析");
  // 附近不得同时**写入** manual-calibration（那会让 getGenerationSize() 报假的 resolved）。
  // 只匹配赋值形状：那一段的注释里正当地提到了 "manual-calibration" 这个词。
  const nearby = app.slice(Math.max(0, at - 600), at + 600);
  assert.doesNotMatch(nearby, /authority:\s*["']manual-calibration["']/, "空白画板不是人工标定的源图尺寸");
});

test("尺寸唯一写入口仍是 applySourceDimensions，且它是唯一写 granularity 的尺寸路径", () => {
  const body = fnBody(app, "function applySourceDimensions(input)");
  assert.match(body, /api\.normalizeSourceDimensions\(input\)/);
  assert.match(body, /api\.adoptSourceDimensions\(state\.sourceDimensions, next\)/);
  assert.match(body, /if \(!outcome\.applied\) return outcome;/, "被拒时必须原样退回，不得静默写成功");
  assert.match(body, /state\.sourceDimensions = outcome\.dimensions;/);
  assert.match(body, /syncRangeControls\("granularity", Math\.max\(next\.width, next\.height\), 10, 500\)/, "DOM 只是投影");
  assert.match(body, /libms:source-dimensions/, "必须广播，UI 才能跟着刷");
});

test("resetSourceDimensions 也必须广播（否则 UI 停在锁定态）", () => {
  // 真机探针抓到过：reset 之后 authority 已是 unresolved，滑杆却仍是 disabled、
  // 顶栏还写着「222×295 · 已锁定」。根因就是这条写入没广播，UI 的投影没被叫醒。
  const body = fnBody(app, "function resetSourceDimensions(reason = \"\") {");
  assert.match(body, /createUnresolvedDimensions\(reason\)/);
  assert.match(body, /libms:source-dimensions/, "同一份状态的写入必须和 applySourceDimensions 一样广播");
});

test("bridge 暴露权威链 API，且 ensureGenerationLongEdge 是挂载专用入口", () => {
  for (const member of ["ensureGenerationLongEdge(value)", "applySourceDimensions(input)", "getSourceDimensions()", "resetSourceDimensions(reason"]) {
    assert.ok(app.includes(member), `bridge 缺少 ${member}`);
  }
  const body = fnBody(app, "ensureGenerationLongEdge(value) {");
  assert.match(body, /if \(isAbsoluteSourceSize\(state\.sourceDimensions\)\) return this\.getGenerationSize\(\);/);
  assert.match(body, /if \(Number\(state\.generationLongEdge\) > 0\) return this\.getGenerationSize\(\);/);
  assert.match(body, /if \(state\.restoreAutoSizePending\) return this\.getGenerationSize\(\);/);
  assert.match(body, /return this\.setGenerationLongEdge\(value\);/, "三种「已有依据」都不写，其余才落默认值");
  // setGenerationLongEdge 必须留着：非工作台入口（旧滑杆）还在用
  assert.match(app, /setGenerationLongEdge\(value\) \{/);
});

test("getGenerationSize 绝对权威优先，并回报 authority / source 便于诊断", () => {
  const body = fnBody(app, "getGenerationSize() {");
  assert.match(body, /if \(isAbsoluteSourceSize\(dims\)\)/);
  assert.match(body, /authority: dims\.authority/);
  assert.match(body, /source: dims\.source/);
});

/* ──────────────────────────── ui/workspace.js ──────────────────────────── */

test("§6 工作台挂载用 ensureGenerationLongEdge，不再无条件写 104", () => {
  assert.match(workspace, /bridge\.ensureGenerationLongEdge\(104\)/);
  assert.doesNotMatch(workspace, /bridge\.setGenerationLongEdge\(104\)/, "无条件写 104 正是 B0.1 要修的头号问题");
});

test("§5 锁定态：权威尺寸在位时滑杆 / 数字 / 滚轮 / 方向键 / 应用全部让位", () => {
  const locked = fnBody(workspace, "function lockedAuthority() {");
  assert.match(locked, /bridge\.getSourceDimensions/);
  assert.match(locked, /api\.isAbsoluteAuthority\(dims\.authority\)/);
  // 滚轮与方向键必须早退
  assert.match(workspace, /if \(!get\(\)\.status\.hasSource \|\| lockedAuthority\(\)\) return;/);
  assert.match(workspace, /if \(lockedAuthority\(\)\) return;/);
});

test("§5 控件可用性只在 syncSizeUi() 决定（半锁定态回归）", () => {
  // 真机探针抓到过：尺寸已锁定、读数已是 222×295，滑杆却还能拖。
  // 根因是可用性被拆成两处 —— paint() 写一份、syncSizeUi() 写一份，
  // 而权威变更走 libms:source-dimensions → syncSizeUi()，根本不经过 paint()。
  const sync = fnBody(workspace, "function syncSizeUi() {");
  assert.match(sync, /const sizeControlsDisabled = Boolean\(locked\) \|\| !get\(\)\.status\.hasSource;/);
  assert.match(sync, /chip\.disabled = sizeControlsDisabled;/);
  assert.match(sync, /if \(node\) node\.disabled = sizeControlsDisabled;/);
  assert.match(sync, /if \(apply\) apply\.disabled = sizeControlsDisabled \|\| !derived;/);
  // paint() 里不得再有一份
  assert.doesNotMatch(workspace, /const sizeLocked = Boolean\(lockedAuthority\(\)\);/, "可用性不得在 paint() 里再写一份");
  assert.doesNotMatch(workspace, /control\.disabled = !hasSource \|\| sizeLocked/);
});

test("§5 被更强证据否决时不得改草稿", () => {
  const body = fnBody(workspace, "function applyLogicalSize() {");
  assert.match(body, /bridge\.applySourceDimensions\(\{/);
  assert.match(body, /authority: multiple >= 2 \? "pixel-multiple" : "logical-heuristic"/);
  assert.match(body, /if \(!outcome\?\.applied\) \{/);
  // 否决分支里只允许 syncSizeUi()，不得出现 longEdgeDraft = / pushDraftToBridge()
  const denied = body.slice(body.indexOf("if (!outcome?.applied) {"));
  const deniedBlock = denied.slice(0, denied.indexOf("}") + 1);
  assert.doesNotMatch(deniedBlock, /longEdgeDraft\s*=/, "被否决还改草稿 = 用弱证据覆盖强证据");
  assert.doesNotMatch(deniedBlock, /pushDraftToBridge/, "被否决还提交 = 用弱证据覆盖强证据");
});

test("§5 锁定态读数直接取权威值，并显示来源", () => {
  const body = fnBody(workspace, "function syncSizeUi() {");
  assert.match(body, /const locked = lockedAuthority\(\);/);
  assert.match(body, /Math\.max\(locked\.width, locked\.height\)/, "长边是 W/H 的较大者，不是用户选的长边");
  assert.match(body, /api\.describeSourceDimensions\(locked\)/);
  assert.match(body, /authorityNode\.dataset\.authority = locked \? locked\.authority : ""/);
  assert.match(body, /const tier = locked \? "normal"/, "锁定态不该再提示尺寸分档");
});

test("§8 权威来源节点存在，且订阅尺寸变更事件", () => {
  assert.match(workspace, /id="ws-size-authority"/);
  assert.match(workspace, /window\.addEventListener\("libms:source-dimensions", \(\) => \{ syncSizeUi\(\); \}\)/);
});

test("权威来源节点有样式，且各级来源可区分", () => {
  assert.match(css, /\.phase2-workspace \.ws-size-authority/);
  for (const authority of ["structured-project", "manual-calibration", "grid-detection"]) {
    assert.match(css, new RegExp(`data-authority="${authority}"`), `${authority} 缺少配色`);
  }
});
