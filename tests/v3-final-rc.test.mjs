import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEditorService } from "../services/editor-service.js";

const root=new URL("../",import.meta.url);
const html=readFileSync(new URL("index.html",root),"utf8");
const app=readFileSync(new URL("app.js",root),"utf8");
const workspace=readFileSync(new URL("ui/workspace.js",root),"utf8");
const generationPanel=readFileSync(new URL("ui/generation-panel.js",root),"utf8");

test("landing page exposes the two explicit V3 creation paths and required blank presets",()=>{
  assert.match(html,/>图片转拼豆</);assert.match(html,/>＋ 新建空白图纸</);
  for(const size of [52,78,104])assert.match(html,new RegExp(`data-size="${size},${size}"`));
  assert.match(html,/id="blank-board-width"[^>]+min="1"[^>]+max="1000"/);
  assert.match(html,/id="blank-board-height"[^>]+min="1"[^>]+max="1000"/);
  assert.match(workspace,/id="ws-blank-start"/);assert.match(workspace,/id="ws-blank-size"/);
});

test("blank canvas is canonical null, source-independent, and enters the V3 workspace",()=>{
  assert.match(app,/Array\.from\(\{ length: height \}, \(\) => Array\(width\)\.fill\(null\)\)/);
  assert.match(app,/state\.sourceDataUrl = ""/);assert.match(app,/openEditorAfterCreate = false/);
  assert.match(app,/createBlankCanvas: \(\{ width, height \} = \{\}\) => createBlankBoard/);
  assert.match(app,/libms:project-result/);assert.match(app,/libms:blank-canvas-created/);
  assert.match(workspace,/addEventListener\("libms:blank-canvas-created"/);
  assert.match(workspace,/blank-board-modal[^\n]+addEventListener\("close"/);
  assert.match(workspace,/activePanel:"color"/);assert.match(workspace,/tool:"brush"/);
});

test("full real palette remains separate from current usage and synchronizes selectedPaletteId",()=>{
  // Stage B1 §11：「当前使用色」竖列面板已删除，由横向「用色统计」条取代。
  // 删除理由：它的数据源 state.stats.colors 是生成期统计，手动编辑后即陈旧。
  assert.match(workspace,/>完整真实色盘</);assert.match(workspace,/>用色统计</);
  assert.doesNotMatch(workspace,/id="ws-color-list"/);
  assert.match(workspace,/id="ws-usage-strip"/);assert.match(workspace,/id="ws-usage-summary"/);
  assert.match(workspace,/id="ws-color-search"/);assert.match(workspace,/id="ws-bead-picker"/);
  // §6：当前颜色只能通过 buildCurrentPalettePatch 写，不再裸写 selectedPaletteId。
  // 正则允许逗号两侧空白 —— 断言的是「走了 patch 构造器」，不是某种排版。
  assert.match(workspace,/buildCurrentPalettePatch\(color\s*\?\s*paletteIdOf\(color\)\s*:\s*null\s*,\s*paletteColors\(\)\)/);
  assert.doesNotMatch(workspace,/selectedPaletteId:color\?paletteIdOf\(color\):null/);
  assert.match(workspace,/paletteCurrentColor=editorService\.resolveColor/);
});

test("release UI exposes eight scene modes while sampling remains an internal strategy",()=>{
  for(const mode of ["小白一键","智能","人像","动漫","插画","像素","Logo","写实"])assert.match(generationPanel,new RegExp(`"${mode}"`));
  assert.doesNotMatch(generationPanel,/data-sampling=/);
  assert.doesNotMatch(generationPanel,/samplingButton\(/);
  assert.match(generationPanel,/photo: \{\s*sampling: "mean"/);
  assert.match(generationPanel,/portrait: \{\s*sampling: "edge"/);
  assert.match(generationPanel,/pixel: \{\s*sampling: "center"/);
  assert.match(generationPanel,/illustration: \{\s*sampling: "dominant"/);
});

test("200x200 editing stress keeps one command per stroke and survives undo redo",()=>{
  const A={paletteId:"brand:A",code:"A",rgb:[40,40,40]},B={paletteId:"brand:B",code:"B",rgb:[180,180,180]};
  const grid=Array.from({length:200},()=>Array(200).fill(A));
  const bridge={getResult:()=>({grid,width:200,height:200}),getCell:(x,y)=>grid[y]?.[x]??null,getPaletteColors:()=>[A,B],applyCellChanges(changes){for(const {x,y,after} of changes)grid[y][x]=after;return true;}};
  const editor=createEditorService(bridge,{limit:120});
  for(let y=0;y<100;y++){editor.beginStroke("brand:B",{size:1});editor.strokeCell(0,y);editor.strokeCell(199,y);editor.endStroke();}
  assert.deepEqual(editor.historyDepth(),{undo:100,redo:0});
  for(let i=0;i<100;i++)assert.equal(editor.undo(),true);
  assert.deepEqual(editor.historyDepth(),{undo:0,redo:100});
  for(let i=0;i<100;i++)assert.equal(editor.redo(),true);
  assert.deepEqual(editor.historyDepth(),{undo:100,redo:0});
});
