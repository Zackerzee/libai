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
