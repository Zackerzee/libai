/**
 * Stage C0 §7 —— 尺寸命名分离：生成尺寸 ≠ 图纸尺寸。
 *
 * 这两件事一直存在，但界面上一度都叫「画布」/「尺寸」，用户分不清：
 *   · **生成尺寸**：生成时用的长边格数（唯一自由度，宽高按原图比例派生）。
 *     它决定「这一次生成出来多大」。
 *   · **图纸尺寸**：已经生成出来的图纸，事后改宽高（允许宽高各自变化，
 *     例如 222×295 → 220×300）。它不重新匹配颜色。
 *
 * 还有第三个坑：`.ws-canvas-*` 系列里「画布」指的是 `<canvas>` 元素。
 * 同一个界面里「画布」有三个意思，是这个改名最实际的理由。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");

const generationPanel = workspace.slice(
  workspace.indexOf('data-ws-inspector="generation"'),
  workspace.indexOf('data-ws-inspector="color"'),
);

test("§7 生成尺寸 = 「生成」面板里那一节，标题就是「生成尺寸」", () => {
  assert.match(generationPanel, /<div class="ws-section-title">生成尺寸<\/div>/);
  assert.match(generationPanel, /id="ws-size-apply"/);
  // 长边是唯一自由度：不许出现独立的宽 / 高输入
  assert.doesNotMatch(generationPanel, /ws-size-width|ws-size-height/);
});

test("§7 图纸尺寸 = 「作品」面板里那一节，且不再叫「画布尺寸」", () => {
  // 这一节是 `projectPanel.insertAdjacentHTML("beforeend", …)` 追加进去的，
  // 不在 right.innerHTML 的模板里 —— 所以要按「追加进 projectPanel」来找，
  // 不能只扫 project 面板的静态 HTML。
  assert.match(workspace, /projectPanel\?\.insertAdjacentHTML\("beforeend", `<div class="ws-editor-group ws-resize-panel"><div class="ws-section-title">图纸尺寸<\/div>/);
  assert.match(workspace, /id="ws-resize-open"/);
  assert.doesNotMatch(workspace, /<div class="ws-section-title">画布尺寸<\/div>/, "旧标题必须消失");
  assert.doesNotMatch(workspace, /调整画布尺寸/, "对话框旧标题必须消失");
});

test("§7 对话框、模式标签、确认文案、提示语全部统一到「图纸」", () => {
  assert.match(workspace, /<strong>调整图纸尺寸<\/strong>/, "对话框标题");
  assert.match(workspace, /value="canvas" checked> 调整图纸</, "模式标签");
  assert.match(workspace, /id="ws-resize-summary">调整图纸不会重新匹配颜色。</, "提示语");
  assert.match(workspace, /mode==="canvas"\?"调整图纸":"缩放图案"/, "确认弹窗里的方式文案");
  // 旧的「调整画布」在用户可见文案里一处不剩
  assert.doesNotMatch(workspace, /调整画布(尺寸)?/, "用户可见文案里不该再有「调整画布」");
});

test("§7 两条链路各有各的控件，不共用 state（这条从 B0 起就是硬约束）", () => {
  // 生成尺寸：长边 + 派生，走 deriveGenerationSize
  assert.match(workspace, /deriveGenerationSize\(longEdgeDraft, effectiveSourceRatio\(\)\)/);
  // 图纸尺寸：宽高独立，走 grid-resize-service
  assert.match(workspace, /id="ws-resize-width"/);
  assert.match(workspace, /id="ws-resize-height"/);
  assert.match(workspace, /createGridResizeCommand/);
});

test("§7 生成尺寸控件不再出现在顶栏（顶栏只剩视图缩放）", () => {
  const topControls = workspace.slice(workspace.indexOf("topControls.innerHTML"), workspace.indexOf("grid.before(topControls)"));
  assert.doesNotMatch(topControls, /ws-size-range|ws-size-apply|ws-size-chips/, "顶栏不该再持有尺寸控件");
  assert.match(topControls, /id="zoomControls"/, "顶栏保留视图缩放");
});

test("§7 「画布」这个说法只留给 <canvas> 相关的东西", () => {
  // 允许出现的地方：canvas 元素 / 画布区 / 画布上的绘制提示（例如
  // 「画布宽高只从 state 取」——那句说的是渲染器读画布尺寸，和图纸尺寸无关）。
  // 不允许的：把「图纸的尺寸」说成「画布尺寸」。只点名这两个具体说法，
  // 不做全文件模糊扫描 —— 模糊扫描会因为一句无关键提示语而误报，
  // 那种测试迟早被人加白名单加废。
  assert.doesNotMatch(workspace, /画布尺寸/, "「画布尺寸」这个说法必须彻底换成「图纸尺寸」");
  assert.doesNotMatch(workspace, /调整画布/, "「调整画布」必须换成「调整图纸」");
});
