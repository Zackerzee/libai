/**
 * 顶栏生成尺寸栏的布局与去残留契约。
 *
 * 历史：这里曾断言 `data-multiple-step=`（**带等号**），而实际死代码是
 * `[data-multiple-step]` 选择器 + `data-multiple-step` 属性 —— 两个死监听器
 * 就这么在绿灯下活了下来。所以本文件改成断言「属性名整体不存在」，
 * 不再给「只删一半」留缝。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");

test("顶栏尺寸栏提供长边滑杆 + 数字输入 + 派生读数", () => {
  assert.match(workspace, /id="ws-size-range" type="range"[^>]+aria-label="图纸长边（格）"/);
  assert.match(workspace, /id="ws-size-number" type="number"[^>]+aria-label="图纸长边格数（可直接输入）"/);
  assert.match(workspace, /id="ws-size-value"/);
  assert.match(workspace, /id="ws-size-apply"/);
  // 读数由「长边 + 比例」派生，不再自己乘一遍比例
  assert.match(workspace, /deriveGenerationSize\(longEdgeDraft, effectiveSourceRatio\(\)\)/);
  assert.doesNotMatch(workspace, /width = clamp\(Math\.round\(width \* sourceRatio\(\)\), 10, 500\)/, "旧的比例兜底算法必须删除");
  assert.doesNotMatch(workspace, /data-size-step=/);
});

test("顶栏尺寸栏预设齐全，且不会横向溢出", () => {
  for (const size of ["auto", "52", "78", "104"]) assert.match(workspace, new RegExp(`data-size="${size}"`));
  const topRules = css.slice(css.indexOf(".phase2-workspace .ws-top-controls"), css.indexOf("/* ───────── 右栏"));
  assert.match(topRules, /flex-wrap: wrap/);
  assert.match(topRules, /overflow: visible/);
  assert.doesNotMatch(topRules, /overflow-x:\s*auto/);
  assert.match(topRules, /\.ws-top-size[\s\S]+margin-left: 0/);
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
  assert.match(workspace, /logicalSize/);
  assert.match(workspace, /function ensureMultipleDetection\(/);
});

test("尺寸栏与编辑器画布调整各用各的控件，不共用一套 state", () => {
  // 编辑器画布调整：宽高独立（222×295 → 220×300），走 grid-resize-service
  assert.match(workspace, /id="ws-resize-width"/);
  assert.match(workspace, /id="ws-resize-height"/);
  assert.match(workspace, /createGridResizeCommand/);
  // 生成尺寸栏不允许出现「只改宽」的入口
  assert.doesNotMatch(workspace, /ws-size-width/);
  assert.doesNotMatch(workspace, /ws-size-height/);
});
