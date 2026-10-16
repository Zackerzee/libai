/**
 * Stage C0 §2 / §11 —— 右栏 Tab 的结构与「唯一真源」纪律。
 *
 * 背景：改之前右栏是 6 个 tab（作品/图片/色彩/编辑/检查/库存），
 * 但 DOM 里实际有 **7 个** `data-ws-inspector` 段 —— 多出来的 `build`（施工）
 * 不在 tab 数组里；现在由「保存与导出」的施工图预览入口激活。
 * 这种「tab 清单」和「面板清单」各写一份的结构，是「改了 tab 忘了改面板」的温床。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const store = readFileSync(new URL("../state/store.js", import.meta.url), "utf8");

const tabListSource = workspace.slice(
  workspace.indexOf("const INSPECTOR_TABS"),
  workspace.indexOf("right.innerHTML ="),
);
const tabIds = [...tabListSource.matchAll(/\["([a-z-]+)",\s*"/g)].map((m) => m[1]);
const panelIds = [...workspace.matchAll(/data-ws-inspector="([a-z-]+)"/g)].map((m) => m[1]);

test("四工作区真实面板清单包含施工分区，作品信息仍保留", () => {
  assert.deepEqual(tabIds, ["project", "source", "generation", "color", "edit", "check", "material", "build"]);
  assert.match(workspace,/WORKAREA_PANELS=Object\.freeze\(\{generate:\['source','generation'\],edit:\['color','edit','check','project'\],construction:\['material','build'\]\}\)/);
});

test("§3 「生成」是真正可见的 Tab，不再是躲在「色彩」里的一个段", () => {
  assert.ok(tabIds.includes("generation"), "tab 清单里必须有 generation");
  assert.ok(panelIds.includes("generation"), "必须真的有一个 data-ws-inspector=\"generation\" 面板");
  // 8 个生成模式必须住在这个面板里
  const generationPanel = workspace.slice(
    workspace.indexOf('data-ws-inspector="generation"'),
    workspace.indexOf('data-ws-inspector="color"'),
  );
  assert.match(generationPanel, /id="generationPanel"/, "生成模式容器必须在「生成」面板内");
  // 而且不能还留在「色彩」里
  const colorPanel = workspace.slice(
    workspace.indexOf('data-ws-inspector="color"'),
    workspace.indexOf('data-ws-inspector="edit"'),
  );
  assert.doesNotMatch(colorPanel, /id="generationPanel"/, "生成模式容器不能同时挂在「色彩」里");
});

test("§14 「库存」→「材料」，但库存面板本身没被删掉", () => {
  assert.ok(!tabIds.includes("inventory"), "tab 清单里不该再有 inventory");
  assert.ok(tabIds.includes("material"), "tab 清单里必须有 material");
  assert.ok(panelIds.includes("material"), "必须真的有一个 data-ws-inspector=\"material\" 面板");
  // 库存面板的挂载点 id 不能改 —— 改了就说明有人顺手把它摘了
  const materialPanel = workspace.slice(
    workspace.indexOf('data-ws-inspector="material"'),
    workspace.indexOf("</div>`;", workspace.indexOf('data-ws-inspector="material"')),
  );
  assert.match(materialPanel, /<div id="inventoryPanel"><\/div>/, "库存面板必须仍然是材料面板的一节");
  assert.match(workspace, /root: right\.querySelector\("#inventoryPanel"\)/, "InventoryPanel 的挂载点必须还在");
});

test("面板清单等于分组tab清单，施工与输出预览复用同一入口", () => {
  const uniquePanels = [...new Set(panelIds)];
  const extras = uniquePanels.filter((id) => !tabIds.includes(id));
  assert.deepEqual(extras, [], `不该有无入口的面板，实际多出：${extras.join(",")}`);
  assert.match(workspace, /id="ws-output-preview"/);
  assert.match(workspace, /#ws-output-preview"\)\.addEventListener\("click",[\s\S]*?setWorkspaceMode\("build"\)/, "保存与导出必须显式进入施工预览");
  assert.match(workspace, /store\.setState\(\{ ui: \{ activePanel: "build" \},editor:\{tool:"pan"\},view:\{mode:"pattern"\} \}\)/, "预览使用唯一 activePanel 并切施工图显示高亮");
  assert.match(workspace,/store\.setState\(previewReturnState\);previewReturnState=null/,'退出完整恢复原view/editor/ui');
});

test("§11 Tab 切换只有唯一真源 ui.activePanel，没有多套 bool 并存", () => {
  // ① store 的 ui 槽里只有这三个键 —— 没有 colorTabActive / generationTabOpen 之类
  const uiSlot = store.slice(store.indexOf("activePanel: \"project\""), store.indexOf("activePanel: \"project\"") + 160);
  assert.match(uiSlot, /activePanel:\s*"project"/);
  for (const forbidden of [/colorTabActive/, /generationTabOpen/, /inventoryVisible/, /rightPanelTab/, /activeTabId/]) {
    assert.doesNotMatch(store, forbidden, `store 里不该出现 ${forbidden}`);
    assert.doesNotMatch(workspace, forbidden, `workspace 里不该出现 ${forbidden}`);
  }
  // ② 显隐只由 activePanel 一个表达式决定
  const hideLine = workspace.match(/right\.querySelectorAll\("\[data-ws-inspector\]"\)\.forEach\(\(panel\) => \{[^}]*\}\)/);
  assert.ok(hideLine, "找不到面板显隐逻辑");
  assert.match(hideLine[0], /panel\.dataset\.wsInspector !== state\.ui\.activePanel/);
  // ③ tab 按钮的写入路径只有一处
  const writes = [...workspace.matchAll(/ui:\s*\{\s*activePanel/g)].length;
  assert.ok(writes >= 1, "至少要有一处写 activePanel");
  const tabClick = workspace.match(/querySelectorAll\("\[data-ws-panel\]"\)\.forEach\(\(button\) => button\.addEventListener\("click", \(\) => \{ if\(button\.dataset\.wsPanel==='build'\)\{setWorkspaceMode\('build'\);return;\}if\(buildActive\(\)\)setWorkspaceMode\("edit"\);store\.setState\(\{ ui: \{ activePanel: button\.dataset\.wsPanel \} \}\); \}\)\)/);
  assert.ok(tabClick, "tab 点击必须只写 ui.activePanel 这一个字段");
});

test("面板标题表覆盖每一个 tab，且没有遗留的 inventory 标题", () => {
  const titlesLine = workspace.match(/const titles = \{[^}]*\}/);
  assert.ok(titlesLine, "找不到 titles 映射");
  for (const id of tabIds) assert.match(titlesLine[0], new RegExp(`${id}:\\s*"`), `titles 缺少 ${id}`);
  assert.match(titlesLine[0], /build:\s*"施工图预览"/, "build 面板必须明确为施工图预览");
  assert.doesNotMatch(titlesLine[0], /inventory:/, "titles 里不该再有 inventory");
});
