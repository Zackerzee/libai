/**
 * Stage C0 §4 —— 「生成」面板必须承载的东西。
 *
 * §4 点名了六项：生成模式 / 生成尺寸 / 颜色数量 / 背景 / 生成状态 / 主要动作「重新生成」。
 * 其中「重新生成」**之前根本不存在**：`GenerationPanel.bindEvents()` 里一直有
 * `case "generate"` 分支、workspace.js 也一直传着 `onGenerate`（含「覆盖手动修改」确认），
 * 但 `render()` 从来没有渲染出任何 `[data-action="generate"]` 元素 ——
 * 那条分支和那个回调都是够不到的死代码。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const panel = readFileSync(new URL("../ui/generation-panel.js", import.meta.url), "utf8");

const generationPanel = workspace.slice(
  workspace.indexOf('data-ws-inspector="generation"'),
  workspace.indexOf('data-ws-inspector="color"'),
);

test("§4.1 生成尺寸住在「生成」面板，且长边是唯一自由度", () => {
  assert.match(generationPanel, /<div class="ws-section-title">生成尺寸<\/div>/);
  assert.match(generationPanel, /id="ws-size-chips"/);
  assert.match(generationPanel, /id="ws-size-range"/);
  assert.match(generationPanel, /id="ws-size-number"/);
  assert.match(generationPanel, /id="ws-size-value"/);
  assert.match(generationPanel, /id="ws-size-apply"/);
  // 只有长边一个输入 —— 宽高必须派生，不能有独立的宽/高输入框
  assert.doesNotMatch(generationPanel, /ws-size-width|ws-size-height/);
});

test("§4.2 生成模式 + 颜色数量 + 背景都在「生成」面板内", () => {
  assert.match(generationPanel, /id="generationPanel"/, "生成参数容器");
  assert.match(panel, /data-preset="\$\{value\}"/, "模式卡由 GenerationPanel 渲染");
  // 颜色数量（§6 的显示层）
  assert.match(panel, /data-field="maxColors"/);
  assert.match(panel, /data-color-cap=/);
  // 背景：界面上只有一个「去除纯色背景」开关（B2 §17），且它在这个面板里
  assert.match(panel, /switchRow\(\s*"backgroundRemoval",\s*"去除纯色背景"/);
  assert.doesNotMatch(panel, /"autoBackground",\s*\n?\s*"/, "不该有第二个背景开关");
});

test("§4.3 生成状态：文案只从 state.status.generationPhase 取，不在这里重写一份", () => {
  assert.match(generationPanel, /id="ws-generation-status"/, "生成面板必须有状态读数");
  assert.match(workspace, /const generationStatusNode = \$\("#ws-generation-status"\)/);
  assert.match(workspace, /state\.status\.generationPhase \|\| "正在生成"/);
  // 阶段文案的唯一来源是 app.js 的 PHASE_LABELS（tests/generation-status-notice.test.mjs §16 也管这条）
  assert.doesNotMatch(workspace, /正在匹配真实色号/, "UI 不该重复定义阶段文案");
  assert.doesNotMatch(generationPanel, /正在分析图片|正在匹配真实色号|正在完成图纸/, "面板里更不该硬编码阶段文案");
});

test("§4.4 主要动作「重新生成」必须真的渲染出来（它此前是死代码）", () => {
  assert.match(panel, /renderActionSection\(\)/, "render() 必须调用动作段");
  assert.match(panel, /data-action="generate"/, "必须有带 data-action=generate 的元素");
  assert.match(panel, /id="ws-generation-regenerate"/, "动作按钮要有 id 供 workspace 开关 disabled");
  assert.match(panel, /case "generate":\s*\n\s*this\.onGenerate\(/, "点击分支必须调 onGenerate");
  // workspace 必须按同一套可用性条件开关它
  assert.match(workspace, /const regenerate = \$\("#ws-generation-regenerate"\)/);
  assert.match(workspace, /regenerate\.disabled = !hasSource \|\| state\.status\.generating/);
  // 动作段必须排在面板最前面 —— 8 张模式卡 + 4 段参数之后没人滚得到
  const render = panel.slice(panel.indexOf("render() {"), panel.indexOf("renderActionSection() {"));
  assert.ok(render.indexOf("renderActionSection()") < render.indexOf("renderGenMethodSection()"),
    "「重新生成」必须排在生成模式之前");
});

test("§4.5 生成面板不许暴露内部算法术语（B5 §19 的边界继续成立）", () => {
  for (const forbidden of [/bean[\s-]?fit/i, /dual[\s-]?mode/i, /spatial[\s-]?refine/i,
    /neutral[\s-]?protection/i, /conservative[\s-]?cleanup/i,
    /auto[\s-]?tune[\s-]?profile/i, /recommended[\s-]?hybrid/i]) {
    assert.doesNotMatch(panel, forbidden);
    assert.doesNotMatch(generationPanel, forbidden);
  }
  assert.doesNotMatch(panel, /data-sampling=/);
  assert.doesNotMatch(panel, /samplingButton\(/);
  assert.doesNotMatch(generationPanel, /data-sampling=/);
});
