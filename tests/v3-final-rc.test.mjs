import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createEditorService } from "../services/editor-service.js";

const root=new URL("../",import.meta.url);
const html=readFileSync(new URL("index.html",root),"utf8");
const app=readFileSync(new URL("app.js",root),"utf8");
const workspace=readFileSync(new URL("ui/workspace.js",root),"utf8");

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
  assert.match(workspace,/>完整真实色盘</);assert.match(workspace,/>当前使用色</);
  assert.match(workspace,/id="ws-color-search"/);assert.match(workspace,/id="ws-bead-picker"/);
  assert.match(workspace,/selectedPaletteId:color\?paletteIdOf\(color\):null/);
  assert.match(workspace,/paletteCurrentColor=editorService\.resolveColor/);
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
