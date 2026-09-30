import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../ui/grid-editor-toolbar.js", import.meta.url), "utf8");
const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");

test("换图在同步用户手势内打开文件选择器", () => {
  const block = workspace.slice(workspace.indexOf('$("#ws-import-again")'), workspace.indexOf('$("#ws-source-open")'));
  assert.match(block, /window\.confirm/);
  assert.doesNotMatch(block, /await askConfirmation/);
  assert.match(block, /bridge\.importImage/);
});

test("载入无原图的工程后回到色块视图并清空旧源图状态", () => {
  assert.match(workspace, /source: \{ image: "", width: 0, height: 0 \}/);
  assert.match(workspace, /view: \{ mode: "blocks" \}/);
  assert.match(app, /state\.sourceDataUrl = ""/);
  assert.match(app, /state\.processedSourceDataUrl = ""/);
});

test("文字工具首次和重复点击都会创建图层", () => {
  assert.match(workspace, /if \(tool === "text" && !get\(\)\.editor\.activeTextLayerId\) \{ addTextLayer\(\); return; \}/);
  assert.match(workspace, /onAdd: \(\) => addTextLayer\(\)/);
  assert.match(toolbar, /if \(tool === this\.activeTool\) \{ if \(tool === "text"\) this\.onToolChange\(tool\); return; \}/);
});

test("需要颜色的绘图工具会自动获得可用颜色，描边会校验选区", () => {
  assert.match(workspace, /\["bead", "brush", "fill", "line", "rect", "ellipse", "text"\]/);
  assert.match(workspace, /\$\("#ws-apply-outline"\)\.disabled = !hasPattern \|\| !hasSelection \|\| !state\.editor\.selectedColor/);
  assert.match(workspace, /extendedToolbar\.setToolDisabled\("source-eyedropper", !hasSource\)/);
  assert.match(toolbar, /setToolDisabled\(tool, disabled\)/);
});

test("顶部不重复暴露编辑动作，镜像从唯一入口选择两个方向", () => {
  const extendedStart = toolbar.indexOf("  renderExtended() {");
  const extended = toolbar.slice(extendedStart, toolbar.indexOf("  bindEvents() {", extendedStart));
  for (const duplicate of ["换色", "描边", "逆时针 90°", "顺时针 90°", "上下镜像", "辅助线", "原图对比"]) {
    assert.doesNotMatch(extended, new RegExp(duplicate));
  }
  assert.match(toolbar, /data-panel="mirror-horizontal"[\s\S]+左右镜像/);
  assert.match(toolbar, /data-panel="mirror-vertical"[\s\S]+上下镜像/);
  assert.match(workspace, /action === "mirror-horizontal"[\s\S]+flip\("horizontal"\)/);
  assert.match(workspace, /action === "mirror-vertical"[\s\S]+flip\("vertical"\)/);
  assert.equal((workspace.match(/id="ws-compare"/g) || []).length, 1);
});

test("没有图纸或原图时，依赖内容的视图与参数控件会禁用", () => {
  assert.match(workspace, /button\.dataset\.wsView === "original" \? !hasSource : !hasPattern/);
  assert.match(workspace, /\$\("#ws-compare"\)\.disabled = !hasSource/);
  assert.match(workspace, /\$\("#ws-apply-outline"\)\.disabled = !hasPattern \|\| !hasSelection/);
  assert.match(workspace, /control\.disabled = !hasSource/);
});

test("专业画笔复用统一工具分发并接入补线、Pixel Perfect 与临时吸管",()=>{
  assert.match(workspace,/tool = event\.altKey \? "eyedropper" : selectedTool/);
  assert.match(workspace,/pixelPerfect:editor\.pixelPerfect/);
  assert.match(workspace,/inkMode:tool==="brush"/);
  assert.match(workspace,/rampPaletteIds/);
  assert.match(workspace,/shape:"square"/);
  assert.match(workspace,/selectedPaletteId:\s*paletteIdOf\(color\)/);
  assert.match(toolbar,/\{ id: "brush", label: "画笔", shortcut: "B" \}/);
  assert.match(toolbar,/\{ id: "eraser", label: "擦除", shortcut: "E" \}/);
  assert.match(toolbar,/\{ id: "eyedropper", label: "取色", shortcut: "I" \}/);
  assert.match(toolbar,/\{ id: "fill", label: "填色", shortcut: "G" \}/);
});
