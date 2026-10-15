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

test("载入无原图的工程后回到施工图视图并清空旧源图状态", () => {
  assert.match(workspace, /source: \{ image: "", width: 0, height: 0 \}/);
  // 这里曾是 "blocks"（成像）。底栏「成像」按钮移除后 blocks 成了回不去的死状态，
  // 且 canvas-renderer 的 blocks 分支在画参考图之前就 return —— 停在 blocks 时
  // 「上传参考图 → 透明度条 → 按住对照」整条流程都看不到参考图。故改为 pattern。
  assert.match(workspace, /view: \{ mode: "pattern" \}/);
  assert.doesNotMatch(workspace, /view: \{ mode: "blocks" \}/);
  assert.match(app, /state\.sourceDataUrl = ""/);
  assert.match(app, /state\.processedSourceDataUrl = ""/);
});

test("文字工具切换不隐式新增，明确添加入口创建对象", () => {
  assert.doesNotMatch(workspace, /if \(tool === "text" && !get\(\)\.editor\.activeTextLayerId\) \{ addTextLayer\(\); return; \}/);
  assert.match(workspace, /onAdd: \(\) => addTextLayer\(\)/);
  assert.match(toolbar, /if \(tool === this\.activeTool\) \{ this\.onToolChange\(tool\); return; \}/);
});

test("需要颜色的绘图工具会自动获得可用颜色，描边会校验选区", () => {
  // 形状工具扩容后（heart / diamond / star）这个列表也一并纳入，故不再钉死完整枚举，
  // 只要求「基础七件套」在内且整体仍走 currentPaletteId() 兜底取色。
  assert.match(workspace, /\["bead", "brush", "fill", "line", "rect", "ellipse", "heart", "diamond", "star", "text"\]\.includes\(tool\) && !currentPaletteId\(\)/);
  // Stage B1 §6：可用性判定走真源（readCurrentPaletteId），不再裸读 state.editor.selectedColor。
  assert.match(workspace, /const selectedPaletteId = readCurrentPaletteId\(state\.editor\);/);
  assert.match(workspace, /\$\("#ws-outline-apply"\)\.disabled=!outlinePreview\?\.cells\?\.length/);
  assert.match(workspace, /\$\("#ws-source-pick-mode"\)\.disabled = !hasSource/);
  assert.match(toolbar, /setToolDisabled\(tool, disabled\)/);
});

test("顶部不重复暴露编辑动作，镜像仅从导出参数选择两个方向", () => {
  const extendedStart = toolbar.indexOf("  renderExtended() {");
  const extended = toolbar.slice(extendedStart, toolbar.indexOf("  bindEvents() {", extendedStart));
  for (const duplicate of ["换色", "描边", "逆时针 90°", "顺时针 90°", "上下镜像", "辅助线", "原图对比"]) {
    assert.doesNotMatch(extended, new RegExp(duplicate));
  }
  assert.doesNotMatch(toolbar, /data-panel="mirror-(?:horizontal|vertical)"/);
  assert.match(workspace, /id="ws-export-mirror"[\s\S]+value="horizontal"[\s\S]+value="vertical"/);
  assert.match(workspace, /mirror:\$\("#ws-export-mirror"\)\.value/);
  assert.equal((workspace.match(/id="ws-compare"/g) || []).length, 1);
});

test("没有图纸或原图时，依赖内容的视图与参数控件会禁用", () => {
  assert.match(workspace, /button\.dataset\.wsView === "original" \? !hasSource : !hasPattern/);
  // 「对照」的禁用条件从「有无原图」改成「有无图纸」：没有对照图时它兼任上传入口，
  // 灰掉就没法选照片了。有对照图时按住临时看原图，由 hasCompareArtwork() 判定。
  assert.match(workspace, /\$\("#ws-compare"\)\.disabled = !hasPattern/);
  assert.doesNotMatch(workspace, /\$\("#ws-compare"\)\.disabled = !hasSource/);
  // 三个判定必须分开：参考图（决定透明度条）/ 原图（决定按住看什么）/ 两者任一（决定按钮身份）。
  assert.match(workspace, /const hasReference = \(state = get\(\)\) => Boolean\(state\.reference\.url\)/);
  assert.match(workspace, /const hasSourceImage = \(state = get\(\)\) => Boolean\(state\.source\.image\)/);
  assert.match(workspace, /const hasReferenceImage = \(state = get\(\)\) => hasReference\(state\) \|\| hasSourceImage\(state\)/);
  assert.match(workspace, /const hasCompareArtwork = \(\) => hasReferenceImage\(\)/);
  // 曾经多写一个 status.hasSource，导致导入 .pixler/JSON 工程时按钮误以为「有原图」，
  // 「点击即上传照片」这条路永远走不到。守住它不回流。
  assert.doesNotMatch(workspace, /hasCompareArtwork = \(\) => Boolean\(get\(\)\.reference\.url \|\| get\(\)\.source\.image \|\| get\(\)\.status\.hasSource\)/);
  // 无对照图 → 点击打开本地照片选择器（referenceInput）；有对照图 → 直接 return，交给 pointerdown 的临时预览。
  assert.match(workspace, /\$\("#ws-compare"\)\.addEventListener\("click", \(\) => \{ if \(hasCompareArtwork\(\)\) return; referenceInput\.click\(\); \}\)/);
  assert.match(workspace, /\$\("#ws-outline-preview"\)\.disabled = !hasPattern/);
  // 尺寸控件的可用性已收归 syncSizeUi() 一处（B0.1）：拆在 paint() 里会漏掉
  // libms:source-dimensions 那条路径，出现「已锁定但滑杆还能拖」的半锁定态。
  assert.match(workspace, /const sizeControlsDisabled = Boolean\(locked\) \|\| !get\(\)\.status\.hasSource;/);
  assert.match(workspace, /chip\.disabled = sizeControlsDisabled;/);
});

test("专业画笔复用统一工具分发并接入补线、Pixel Perfect 与临时吸管",()=>{
  assert.match(workspace,/tool = event\.altKey && selectedTool !== "wand" \? "eyedropper" : selectedTool/);
  assert.match(workspace,/combineSelections\(current,hits,result\.width,result\.height,combineMode\(event\)\)/);
  assert.match(workspace,/pixelPerfect:editor\.pixelPerfect/);
  assert.match(workspace,/inkMode:tool==="brush"/);
  assert.match(workspace,/rampPaletteIds/);
  assert.match(workspace,/shape:brushShape/);
  assert.match(workspace,/readEditorPreference\("brushShape", "square"\)/);
  // Stage B1 §6：画笔落色不再裸写 selectedPaletteId，改走 buildActivateColorPatch
  // （真源 currentPaletteId + 镜像 + 高亮，一次写全）。这里同时守住「旧写法不得回流」。
  assert.match(workspace,/buildActivateColorPatch\(color\s*\?\s*paletteIdOf\(color\)\s*:\s*null\s*,\s*paletteColors\(\)\s*,\s*\{\s*highlight:\s*false\s*\}\)/);
  assert.doesNotMatch(workspace,/selectedPaletteId:\s*paletteIdOf\(color\)/);
  assert.match(toolbar,/\{ id: "brush", label: "画笔", shortcut: "B" \}/);
  assert.match(toolbar,/\{ id: "eraser", label: "擦除", shortcut: "E" \}/);
  assert.match(toolbar,/\{ id: "eyedropper", label: "取色", shortcut: "I" \}/);
  assert.match(toolbar,/\{ id: "fill", label: "填色", shortcut: "G" \}/);
});
