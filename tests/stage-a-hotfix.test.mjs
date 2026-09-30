import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace=readFileSync(new URL("../ui/workspace.js",import.meta.url),"utf8");
const toolbar=readFileSync(new URL("../ui/grid-editor-toolbar.js",import.meta.url),"utf8");
const css=readFileSync(new URL("../styles/workspace.css",import.meta.url),"utf8");

test("desktop rail is one vertical slot per primary tool without horizontal overflow",()=>{
  assert.match(toolbar,/direct\.slice\(0,4\)[\s\S]+menu\("形状"[\s\S]+menu\("选择"[\s\S]+direct\.slice\(4\)[\s\S]+sl-mirror-menu/);
  assert.match(css,/body\.phase2-workspace \.ws-rail \.sl-grid-toolbar-rail[\s\S]+flex-direction: column !important/);
  assert.match(css,/overflow-x: hidden !important/);
  assert.match(css,/\.ws-rail\.is-collapsed[\s\S]+48px !important/);
  assert.match(css,/\.sl-rail-menu \.sl-tool-menu[\s\S]+left: calc\(100% \+ 8px\) !important/);
});

test("mobile horizontal toolbar begins only at the mobile breakpoint",()=>{
  const mobile=css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile,/flex-direction:row !important/);
  assert.doesNotMatch(css.slice(0,css.indexOf("@media (max-width: 760px)")),/\.sl-grid-toolbar-rail[^}]+flex-direction:\s*row/);
});

test("project settings expose visible imported-project resize dialog",()=>{
  for(const copy of ["画布尺寸","调整尺寸","当前：","目标尺寸","调整画布","缩放图案","锚点","确认调整"]) assert.match(workspace,new RegExp(copy));
  assert.match(workspace,/id="ws-resize-open"/);
  assert.match(workspace,/id="ws-resize-dialog"/);
  assert.equal((workspace.match(/name="ws-resize-anchor"/g)||[]).length,1,"anchor radios are generated from one nine-item source");
  assert.match(workspace,/resizeAnchors=\["top-left","top","top-right","left","center","right","bottom-left","bottom","bottom-right"\]/);
  assert.match(workspace,/将裁掉：上 \$\{crop\.top\} \/ 下 \$\{crop\.bottom\} \/ 左 \$\{crop\.left\} \/ 右 \$\{crop\.right\}/);
});

test("resize remains one existing structure history command and refreshes imported dimensions",()=>{
  assert.match(workspace,/editorService\.executeCommand\(command\)/);
  assert.match(workspace,/syncResizeInputs\(\);\s*viewport\.fitToViewport\(\)/);
  assert.doesNotMatch(workspace,/source === ["']pixler["'][\s\S]+disabled/);
});
