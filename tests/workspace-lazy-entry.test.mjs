import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app=readFileSync(new URL("../app.js",import.meta.url),"utf8");
const html=readFileSync(new URL("../index.html",import.meta.url),"utf8");
const zoom=readFileSync(new URL("../ui/zoom-controls.js",import.meta.url),"utf8");

test("landing init does not import or mount workspace",()=>{
  const init=app.slice(app.indexOf("function init()"),app.indexOf("function prepareCompatibilityShell"));
  assert.doesNotMatch(init,/workspace-bootstrap|bootstrapWorkspace|initializeWorkspaceRuntime/);
  assert.match(init,/workspaceState = "landing"/);
  assert.match(init,/parkWorkspaceDomForLanding\(\)/);
  assert.match(app,/restoreWorkspaceDom\(\)/);
});

test("all creation paths share one promise and one entry",()=>{
  assert.match(app,/let workspaceLoadPromise = null/);
  assert.match(app,/let workspaceMounted = false/);
  assert.match(app,/function enterWorkspace\(reason, payload = \{\}\)/);
  for(const reason of ["image-upload","blank-canvas","open-project"])assert.match(app,new RegExp(`enterWorkspace\\("${reason}"`));
  assert.match(html,/id="open-project-button"/);
});

test("palette brands and pixel font are deferred to workspace runtime",()=>{
  const runtime=app.slice(app.indexOf("function initializeWorkspaceRuntime"),app.indexOf("async function loadWorkspaceOnce"));
  assert.match(runtime,/loadExternalBrandPalettes\(\)/);
  assert.match(runtime,/preloadPixelFont\(\)/);
});

test("fit button uses final Chinese copy and explanation",()=>{
  assert.match(zoom,/>\s*适应窗口\s*</);
  assert.match(zoom,/title="自动缩放并居中，完整显示整张图纸"/);
});

test("brand homepage keeps its three real creation paths and current capabilities",()=>{
  for(const text of ["LIBMS Studio","专业拼豆设计与制作工作台","从一张图片","到真正能拼出来的图纸"])assert.match(html,new RegExp(text));
  for(const id of ["upload-zone","blank-board-button","open-project-button"])assert.match(html,new RegExp(`id="${id}"`));
  for(const step of ["01 生成","02 优化","03 精修","04 材料","05 施工","06 输出"])assert.match(html,new RegExp(step.replace(" ","[\\s\\S]*")));
  assert.match(html,/assets\/brand\/shiliber-mark-256\.png/);
  assert.doesNotMatch(html,/巨大虚线上传框/);
  assert.match(app,/querySelector\("\[data-focus-blank\]"\)[\s\S]*openBlankBoardDialog\(\)/);
});
