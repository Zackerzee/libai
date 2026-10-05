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
});

test("左轨子菜单必须是「就地展开」，不能向右浮出（浮出会被 overflow-x: hidden 裁掉）",()=>{
  // Stage C0 §18 实测：原来的浮出版本和上面那条 `overflow-x: hidden !important`
  // **物理上互斥**。`.sl-tool-menu` 的包含块是 `.sl-rail-menu`（在左轨内部），
  // 所以向右浮出的那一整块被裁掉：按钮有 37×38 的盒子、display=flex、
  // visibility=visible，但中心点 elementFromPoint 命中的是 `div#ws-canvas-well`
  // —— 真鼠标点不到。形状/选择/镜像三组 11 个入口全不可达，
  // 而 `element.click()` 驱动的探针照样全绿。
  //
  // 所以这条测试守的是「**两条 pin 不能互相矛盾**」：既然左轨禁止横向溢出，
  // 桌面端子菜单就不能长在左轨的裁剪框外面。
  //
  // 断言只扫**声明块**，不扫整份 CSS —— 上面那段注释里就写着被禁的那个写法，
  // 全文模糊匹配会被自己的注释绊倒。
  const railMenuRules = [...css.matchAll(/\.sl-rail-menu \.sl-tool-menu \{[^}]*\}/g)].map((m) => m[0]);
  assert.ok(railMenuRules.length >= 2, "至少要有基础规则 + 左轨作用域规则");
  for (const rule of railMenuRules) {
    assert.doesNotMatch(rule, /position: absolute/, `左轨子菜单不能是绝对定位（会被裁掉）：${rule}`);
    assert.doesNotMatch(rule, /left:\s*calc\(100%/, `左轨子菜单不能向右浮出：${rule}`);
  }
  assert.match(
    css,
    /body\.phase2-workspace \.ws-rail \.sl-rail-menu \.sl-tool-menu \{ position: static !important;/,
    "桌面端左轨子菜单必须就地展开",
  );
  assert.match(css, /\.phase2-workspace \.sl-rail-menu \.sl-tool-menu \{ position: static;/, "基础规则也要就地展开");
  // 移动端是贴底的横向条（overflow-y: hidden），就地展开会被条高裁掉，
  // 所以那里必须改用 fixed 浮上去 —— 和坞的镜像菜单同一套处理。
  const mobile = css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile, /\.sl-rail-menu \.sl-tool-menu \{ position: fixed !important;/, "移动端子菜单必须 fixed 脱离横向条的裁剪");
});

test("mobile horizontal toolbar begins only at the mobile breakpoint",()=>{
  const mobile=css.slice(css.indexOf("@media (max-width: 760px)"));
  assert.match(mobile,/flex-direction:row !important/);
  assert.doesNotMatch(css.slice(0,css.indexOf("@media (max-width: 760px)")),/\.sl-grid-toolbar-rail[^}]+flex-direction:\s*row/);
});

test("project settings expose visible imported-project resize dialog",()=>{
  // Stage C0 §7：用户可见的这套文案里，「画布」全部改成「图纸」——
  // 「画布」在同一个界面里还指 <canvas> 元素，两个含义混用会让人分不清
  // 「改生成尺寸」和「改已经生成出来的图纸尺寸」。
  for(const copy of ["图纸尺寸","调整尺寸","当前：","目标尺寸","调整图纸","缩放图案","锚点","确认调整"]) assert.match(workspace,new RegExp(copy));
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
