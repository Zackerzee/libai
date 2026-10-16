import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {WORKAREA_PANELS,workareaForPanel,EDIT_OVERLAY_TOOLS} from '../ui/workspace.js';
const workspace=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
const toolbar=readFileSync(new URL('../ui/grid-editor-toolbar.js',import.meta.url),'utf8');
const generation=readFileSync(new URL('../ui/generation-panel.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/workspace.css',import.meta.url),'utf8');
test('workarea mapping retains activePanel as sole panel state',()=>{
  assert.deepEqual(WORKAREA_PANELS.generate,['source','generation']);
  assert.deepEqual(WORKAREA_PANELS.construction,['material','build']);
  assert.equal(workareaForPanel('check'),'edit');assert.equal(workareaForPanel('source'),'generate');
  const open=workspace.slice(workspace.indexOf('function openWorkspacePanel'),workspace.indexOf('const projectInfoButton'));
  assert.doesNotMatch(open,/replaceGrid|clearHistory|fitToViewport|generation\.generate|selection:\s*null/);
});
test('horizontal rail combines shape tools and keeps selection actions in the contextual icon row',()=>{
  const rail=toolbar.slice(toolbar.indexOf('  renderRail()'),toolbar.indexOf('  renderExtended()'));
  for(const id of ['brush','eraser','fill','eyedropper','text','select','pan']) assert.match(rail,new RegExp(`"${id}"`));
  assert.match(rail,/data-tool-menu="shape"/);
  assert.doesNotMatch(rail,/this\.toolButton\(byId\("(?:line|rect|ellipse|heart|diamond|star)"\)\)/);
  for(const id of ['line','rect','ellipse','heart','diamond','star'])assert.ok(workspace.includes(`['${id}'`),`missing ${id} shape subtool`);
  // 选择已并入绘制组、紧挨画笔（用户 2026-10-16 决策）—— 工具条上只剩**一个**工具组，
  // 不能再出现独立的「选区工具」组。更强的断言：select 必须与 brush 同组且紧邻。
  assert.match(rail,/aria-label="绘制与选择工具"/);
  assert.doesNotMatch(rail,/aria-label="选区工具"/);
  assert.match(rail,/const drawing = \["select", "brush"/);
  assert.match(workspace,/ws-context-selection-type/);
  assert.match(workspace,/dataset\.menu='selection'/);
  assert.match(workspace,/shapeButtons\.addEventListener\('click',event=>\{const button=event\.target\.closest\('\[data-tool\]'\);if\(button\)gridToolbar\.setTool\(button\.dataset\.tool\);\}\)/);
  assert.match(workspace,/ws-step-card/);
  assert.match(css,/\.ws-step-content>\.ws-panel:not\(\[hidden\]\)\{display:block!important/);
  assert.doesNotMatch(workspace,/shapeKinds|data-shape-tool/);
});
test('the four workarea tabs are gone and original panels are arranged in six numbered steps',()=>{
  // stepSpecs 里的编号是「面板身份」，标题里的序号是运行时按可见顺序重排的（++visibleStep）。
  // 面板 '2'（扩容画布）默认 hidden —— 7 条 stepSpecs 里只有 6 步可见，这正是标题里的
  // 「six numbered steps」。原断言停留在更早一版的标签（图片/参考图、尺寸…），已按现版更正。
  assert.match(workspace,/stepSpecs=\[\['3','一键预设'\],\['1','画面调整'\],\['2','扩容画布'\],\['4','马赛克采样'\],\['8','高级设置'\],\['5','颜色量化'\],\['6','编辑检查'\]\]/);
  assert.match(workspace,/steps\.get\('2'\)\.closest\('\.ws-step-card'\)\.hidden = true/);
  assert.doesNotMatch(workspace,/data-ws-workarea/);
  assert.match(workspace,/right\.querySelectorAll\('\[data-ws-inspector\]'\)\.forEach\(panel=>\{panel\.hidden=panel\.dataset\.wsInspector==='build'&&!buildMode;\}\)/);
  assert.match(workspace,/id='ws-export-now'.*textContent='导出作品'/);
  assert.match(workspace,/exportNow\.addEventListener\('click',openExportDrawer\)/);
});
test('diagnostic controls and selection actions move existing DOM and bindings',()=>{
  assert.match(workspace,/diagnosisGroup\.append\(diagnosticNode\)/);
  assert.match(workspace,/checkPanel\.prepend\(diagnosisGroup\)/);
  assert.match(workspace,/selectionActionBar\.append\(\$\('#'\+id\)\)/);
  assert.match(workspace,/已选 \$\{selectionTotal\} 颗/);
});
test('output tasks partition live controls and preserve one renderer route',()=>{
  for(const id of ['pattern','project','print','poster'])assert.ok(workspace.includes(`outputPanels.get('${id}').append(`));
  assert.match(workspace,/showCoordinates:\$\("#ws-export-coords"\)\.checked,majorGridInterval,mirror:\$\("#ws-export-mirror"\)\.value/);
  assert.match(workspace,/exportV2\.pdf\(options\)/);
  assert.match(workspace,/exportV2\.estimate\(\$\("#ws-export-quality"\)\.value,\{showCoordinates:/);
  assert.match(workspace,/\$\("#ws-export-coords"\)\.checked=true/);
  assert.doesNotMatch(workspace,/data-ws-edit-flip=/);
});
test('advanced generation controls have a working collapsed default and no inactive tone sliders',()=>{
  assert.match(generation,/advancedOpen: false/);
  const advanced=generation.slice(generation.indexOf('  renderAdvancedSection()'),generation.indexOf('  rangeControl('));
  assert.doesNotMatch(advanced,/rangeControl\(\s*"(?:brightness|contrast|saturation)"/);
  assert.match(generation,/advancedOpen:!this\.state\.advancedOpen/);
  assert.match(generation,/advanced\.hidden=!this\.state\.advancedOpen/);
  assert.match(css,/sl-advanced-content\[hidden\]/);
});
test('brush preview and wand modifiers use actual brush shape and union/subtraction service',()=>{
  assert.match(workspace,/\{\.\.\.get\(\)\.editor,brushShape/);
  assert.match(workspace,/selectedTool !== "wand"/);
  assert.match(workspace,/combineSelections\(current,hits,result\.width,result\.height,combineMode\(event\)\)/);
});
test('editing and adding text leave pure imaging preview so objects and selection stay visible',()=>{
  for(const tool of ['select','wand','brush','text'])assert.ok(EDIT_OVERLAY_TOOLS.includes(tool));
  for(const tool of ['pan','eyedropper'])assert.ok(!EDIT_OVERLAY_TOOLS.includes(tool));
  const addText=workspace.slice(workspace.indexOf('function addTextLayer('),workspace.indexOf('const shapeOptions'));
  assert.match(addText,/view: \{ mode: "pattern" \}/);
  assert.doesNotMatch(addText,/view: \{ mode: "blocks" \}/);
  assert.match(workspace,/get\(\)\.view\.mode==='blocks'&&EDIT_OVERLAY_TOOLS\.includes\(tool\)\?\{view:\{mode:'pattern'\}\}/);
  // 底栏「成像」按钮已按用户口径移除（只留「施工图 + 对照」），这里不能再断言它存在；
  // 改为钉住「它不再出现」+「视图按钮表里只剩施工图」。
  assert.doesNotMatch(workspace,/\["blocks","成像"\]/);
  assert.match(workspace,/\[\["pattern","施工图"\]\]/);
  assert.match(workspace,/文字对象需合并后才进入成像/);
  assert.match(workspace,/activePanel: "build" \},editor:\{tool:"pan"\},view:\{mode:"pattern"\}/);
  assert.match(workspace,/previewReturnState=structuredClone\(\{view:state\.view,editor:state\.editor/);
  assert.match(workspace,/store\.setState\(previewReturnState\);previewReturnState=null/);
  assert.doesNotMatch(toolbar,/data-panel="mirror-(?:horizontal|vertical)"/);
});
test('mount selector helper exists before the first export customization uses it',()=>{
  assert.ok(workspace.indexOf('const $ = (selector)')<workspace.indexOf('$("#ws-export-coords").checked=true'));
});
test('wrapping header owns an auto-height grid row on desktop and mobile',()=>{
  const scoped=css.slice(css.indexOf('/* Override the earlier fixed-height'));
  assert.match(scoped,/body\.phase2-workspace \.workspace-wrap\{grid-template-rows:auto auto minmax\(0,1fr\) var\(--ws-viewbar-height\)!important\}/);
  assert.match(scoped,/body\.phase2-workspace \.ws-topbar\{display:flex;flex-wrap:wrap;height:auto!important/);
  assert.match(scoped,/@media\(max-width:760px\)[\s\S]+grid-template-rows:auto auto minmax\(0,1fr\) 0!important/);
  assert.match(scoped,/grid-template-columns:76px minmax\(0,1fr\);[\s\S]*white-space:nowrap/);
  assert.match(scoped,/label:has\(input\[type="checkbox"\]\)\{display:flex/);
});
