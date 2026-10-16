/**
 * 「生成」面板里生成尺寸栏的布局与去残留契约。
 *
 * 历史：这里曾断言 `data-multiple-step=`（**带等号**），而实际死代码是
 * `[data-multiple-step]` 选择器 + `data-multiple-step` 属性 —— 两个死监听器
 * 就这么在绿灯下活了下来。所以本文件改成断言「属性名整体不存在」，
 * 不再给「只删一半」留缝。
 *
 * Stage C0 §4/§7：这组控件从顶栏搬进了右栏「生成」面板。
 * **元素 id 一个都没换**，所以下面所有选择器断言原样有效 ——
 * 变的只有它们住的容器，以及容器所在的 CSS 作用域。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");

test("「生成」面板尺寸栏提供长边滑杆 + 数字输入 + 派生读数", () => {
  assert.match(workspace, /id="ws-size-range" type="range"[^>]+aria-label="图纸长边（格）"/);
  assert.match(workspace, /id="ws-size-number" type="number"[^>]+aria-label="图纸长边格数（可直接输入）"/);
  assert.match(workspace, /id="ws-size-value"/);
  assert.match(workspace, /id="ws-size-apply"/);
  // 读数由「长边 + 比例」派生，不再自己乘一遍比例
  assert.match(workspace, /deriveGenerationSize\(longEdgeDraft, effectiveSourceRatio\(\)\)/);
  assert.doesNotMatch(workspace, /width = clamp\(Math\.round\(width \* sourceRatio\(\)\), 10, 500\)/, "旧的比例兜底算法必须删除");
  assert.doesNotMatch(workspace, /data-size-step=/);
});

test("尺寸控件必须住在「生成」面板里，而不是顶栏", () => {
  // 顶栏 = 视图缩放；生成尺寸 = 右栏「生成」面板。这两件事不能又混回一条横条上。
  const generationPanel = workspace.slice(workspace.indexOf('data-ws-inspector="generation"'), workspace.indexOf('data-ws-inspector="color"'));
  assert.match(generationPanel, /id="ws-size-range"/, "生成尺寸必须在「生成」面板内");
  assert.match(generationPanel, /id="ws-size-apply"/, "「应用尺寸」必须在「生成」面板内");
  assert.match(generationPanel, /id="generationPanel"/, "生成参数必须和生成尺寸在同一个面板内");
  const colorPanel = workspace.slice(workspace.indexOf('data-ws-inspector="color"'), workspace.indexOf('data-ws-inspector="edit"'));
  assert.doesNotMatch(colorPanel, /id="generationPanel"/, "生成模式入口不能还留在「色彩」里");
  const topControls = workspace.slice(workspace.indexOf("topControls.innerHTML"), workspace.indexOf("grid.before(topControls)"));
  assert.doesNotMatch(topControls, /ws-size-range|ws-size-apply/, "顶栏不该再持有尺寸控件");
});

test("「生成」面板尺寸栏预设齐全，且不会横向溢出", () => {
  for (const size of ["auto", "52", "78", "104"]) assert.match(workspace, new RegExp(`data-size="${size}"`));
  const topRules = css.slice(css.indexOf("/* ───────── 顶栏参数条：视图缩放"), css.indexOf("/* ───────── 右栏「生成」面板：生成尺寸"));
  assert.match(topRules, /flex-wrap: wrap/);
  assert.match(topRules, /overflow: visible/);
  assert.doesNotMatch(topRules, /overflow-x:\s*auto/);
  assert.match(topRules, /\.ws-top-zoom \{ display: flex; align-items: center; margin-left: auto; \}/);
  // 窄右栏里滑杆与数字框必须占满宽度，否则 244px 面板会横向溢出。
  const panelRules = css.slice(css.indexOf("/* ───────── 右栏「生成」面板：生成尺寸"), css.indexOf("/* ───────── 右栏「生成」面板：生成模式"));
  assert.match(panelRules, /\.ws-size-slider input\[type="range"\] \{ width: 100%/);
  assert.match(panelRules, /\.ws-size-slider input\[type="number"\] \{ width: 100%/);
  assert.match(panelRules, /\.ws-size-chips \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("旧像素倍数 UI 全部清除，但识别算法保留给「自动」档", () => {
  // 属性名、选择器、CSS 规则、状态变量、读数节点，一处不剩
  assert.doesNotMatch(workspace, /data-multiple-step/);
  assert.doesNotMatch(workspace, /\[data-multiple-step\]/);
  assert.doesNotMatch(workspace, /class="ws-multiple"/);
  assert.doesNotMatch(workspace, /ws-multiple-value/);
  assert.doesNotMatch(workspace, /manualMultiple/);
  assert.doesNotMatch(workspace, /syncMultipleReadout/);
  assert.doesNotMatch(css, /\.ws-multiple/);
  // 识别算法本身是「自动」档的唯一依据，必须留着
  assert.match(workspace, /detectPixelMultiple/);
  assert.match(workspace, /recommendAutomaticSize/);
  assert.match(workspace, /function ensureMultipleDetection\(/);
});

test("尺寸栏与编辑器图纸尺寸各用各的控件，不共用一套 state", () => {
  // 编辑器图纸尺寸：宽高独立（222×295 → 220×300），走 grid-resize-service
  assert.match(workspace, /id="ws-resize-width"/);
  assert.match(workspace, /id="ws-resize-height"/);
  assert.match(workspace, /createGridResizeCommand/);
  // 生成尺寸栏不允许出现「只改宽」的入口
  assert.doesNotMatch(workspace, /ws-size-width/);
  assert.doesNotMatch(workspace, /ws-size-height/);
});
