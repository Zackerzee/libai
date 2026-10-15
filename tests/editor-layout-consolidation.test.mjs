import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const toolbar = readFileSync(new URL("../ui/grid-editor-toolbar.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");

test("contextual tool options reuse actual controls rather than duplicate IDs", () => {
  // 不再硬编码具体版本号：它每阶段都会变，写死就等于让这条断言周期性空转
  // （qr-1 → outline-1 时刚发生过一次）。这里保护的是真正重要的性质 ——
  // 引用链上每个模块都必须带缓存戳，否则浏览器会继续用旧模块。
  for (const [file, module] of [["index.html", "app.js"], ["app.js", "ui/workspace-bootstrap.js"], ["ui/workspace-bootstrap.js", "workspace.js"], ["ui/workspace.js", "grid-editor-toolbar.js"], ["ui/workspace.js", "text-panel.js"], ["ui/workspace.js", "services/editor-service.js"]]) {
    const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const hit = source.match(new RegExp(`${module.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\?v=(\\d{8}-[\\w.-]+)`));
    assert.ok(hit, `${file} must request ${module} with a ?v= cache stamp`);
    assert.match(hit[1], /^2026\d{4}-/, `${module} 的缓存戳要形如 20261015-xxx`);
  }
  for (const id of ["ws-tool-options", "ws-context-selection-type", "ws-context-text"]) {
    assert.equal((workspace.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
  }
  assert.match(workspace, /function moveToolControls[\s\S]*group\.append\(node\)/);
  assert.match(workspace, /contextHost: "#ws-context-text-controls"/);
  assert.match(workspace, /id="ws-context-text-controls"/);
});

test("tool labels expand inline for only the active tool and context row stays in document flow", () => {
  assert.match(toolbar, /const selected=button\.dataset\.tool===this\.activeTool/);
  assert.doesNotMatch(toolbar, /button\.dataset\.tool==='select'&&\[/);
  assert.match(workspace, /ws-tool-option-label/);
  assert.match(css, /#gridEditorToolbar \.sl-tool-button\.is-active \.sl-tool-label,[\s\S]*display:inline!important/);
  assert.match(css, /grid-template-rows:minmax\(40px,auto\) auto/);
  assert.match(css, /#ws-tool-options:not\(\[hidden\]\).*height:auto!important;max-height:none!important;overflow:visible/);
  assert.match(css, /\.ws-top-controls :is\(\.sl-tool-button,\.ws-icon-tool-options-button,\.ws-icon-tool-options>button\):focus-visible/);
});

test("under-canvas usage band moves the existing identity-aware usage controls", () => {
  assert.match(workspace, /ws-usage-band/);
  for (const id of ["ws-usage-strip", "ws-usage-actions", "ws-usage-search"]) {
    assert.equal((workspace.match(new RegExp(`id="${id}"`, "g")) || []).length, 1, id);
  }
  assert.match(workspace, /editorService\.getPaletteUsageCounts\(\)/);
});

test("output preview preserves the existing editor and viewport without automatic fit on return", () => {
  assert.match(workspace, /previewReturnState=structuredClone\(\{view:state\.view,editor:state\.editor,ui:\{activePanel:state\.ui\.activePanel\}\}\)/);
  assert.match(workspace, /store\.setState\(previewReturnState\);previewReturnState=null/);
  assert.match(workspace, /#ws-build-return[\s\S]*setWorkspaceMode\("edit"\)/);
  assert.match(workspace, /ws-output-preview/);
  assert.match(workspace, /previewReturnMobilePanelOpen=right\.classList\.contains\("is-mobile-panel-open"\)/);
  assert.match(workspace, /right\.classList\.toggle\("is-mobile-panel-open",previewReturnMobilePanelOpen\)/);
});

test("rail popovers remain independent reachable action rows", () => {
  assert.match(toolbar, /document\.body\.append\(menu\)/);
  assert.match(css, /\.sl-rail-popover[\s\S]*grid-template-columns:minmax\(0,1fr\)/);
  assert.match(css, /\.sl-rail-popover \.sl-tool-button[\s\S]*min-height:44px/);
});
