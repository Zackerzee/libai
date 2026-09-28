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
  assert.match(workspace, /setActionDisabled\("outline", !hasPattern \|\| !hasSelection \|\| !state\.editor\.selectedColor\)/);
  assert.match(workspace, /extendedToolbar\.setToolDisabled\("source-eyedropper", !hasSource\)/);
  assert.match(toolbar, /setToolDisabled\(tool, disabled\)/);
});
