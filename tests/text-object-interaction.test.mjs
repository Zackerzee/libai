import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createEditorService} from '../services/editor-service.js';
import {createEditorCommand} from '../services/editor-command.js';

const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
function fixture(){
  const grid=[[{paletteId:'H1',code:'H1',hex:'#111111'}]];
  let state={editor:{textLayers:[],activeTextLayerId:null},status:{dirty:false}};
  const editor=createEditorService({getResult:()=>({grid,width:1,height:1}),getCell:()=>grid[0][0],getPaletteColors:()=>[]});
  const start=source.indexOf('  function commitTextObjects('),end=source.indexOf('  function textDropPoint()',start);
  const helpers=new Function('editorService','createEditorCommand','currentTextLayers','setTextLayers','get','store','renderer',`${source.slice(start,end)};return {commitTextObjects,patchTextObject};`)(editor,createEditorCommand,()=>state.editor.textLayers,(layers,id)=>{state.editor.textLayers=layers;state.editor.activeTextLayerId=id;},()=>state,{setState:patch=>{state.status={...state.status,...patch.status};}},{requestDraw(){}});
  return {editor,helpers,state,grid};
}
test('text tool activation and blank canvas clicks do not create objects',()=>{
  const start=source.indexOf('    if (tool === "text") {'),end=source.indexOf('    const inspected =',start),body=source.slice(start,end);
  assert.ok(!body.includes('createTextLayer('));
  assert.ok(!source.includes('if (tool === "text" && !get().editor.activeTextLayerId) { addTextLayer();'));
  assert.match(source,/commitTextObjects\("TEXT_ADD"/);
});
test('object add is one unified history entry; undo and redo restore identity',()=>{
  const {editor,helpers,state,grid}=fixture(),original=structuredClone(grid),layer={id:'text-1',text:'你好',paletteId:'H1',x:0,y:0};
  helpers.commitTextObjects('TEXT_ADD','添加文字',[],[layer],null,layer.id);
  assert.equal(editor.getHistory().length,1);assert.equal(state.editor.textLayers.length,1);
  editor.undo();assert.deepEqual(state.editor.textLayers,[]);assert.equal(state.editor.activeTextLayerId,null);
  editor.redo();assert.equal(state.editor.textLayers[0].id,layer.id);assert.deepEqual(grid,original);
});
test('text property and movement snapshots remain undoable without mutating grid',()=>{
  const {editor,helpers,state,grid}=fixture(),original=structuredClone(grid);
  state.editor.textLayers=[{id:'text-1',text:'你好',x:0,y:0}];state.editor.activeTextLayerId='text-1';
  helpers.patchTextObject('text-1',{text:'再见'});
  helpers.commitTextObjects('TEXT_MOVE','移动文字',state.editor.textLayers,[{...state.editor.textLayers[0],x:4,y:3}],'text-1','text-1');
  assert.equal(editor.getHistory().length,2);editor.undo();assert.equal(state.editor.textLayers[0].x,0);
  editor.undo();assert.equal(state.editor.textLayers[0].text,'你好');editor.redo();editor.redo();assert.equal(state.editor.textLayers[0].x,4);assert.deepEqual(grid,original);
});
test('text deletion restores original object; unchanged patch does not create history',()=>{
  const {editor,helpers,state}=fixture(),layer={id:'text-1',text:'你好'};state.editor.textLayers=[layer];state.editor.activeTextLayerId=layer.id;
  helpers.patchTextObject(layer.id,{text:'你好'});assert.equal(editor.getHistory().length,0);
  helpers.commitTextObjects('TEXT_DELETE','删除文字',[layer],[],layer.id,null);assert.equal(state.editor.textLayers.length,0);
  editor.undo();assert.deepEqual(state.editor.textLayers,[layer]);editor.redo();assert.equal(state.editor.textLayers.length,0);
});
test('all editor undo/redo entry points cancel an unfinished gesture before changing history',()=>{
  const wrappers=source.match(/const undoEditor = [^\n]+\n  const redoEditor = [^\n]+/)[0];
  const events=[];
  const {undoEditor,redoEditor}=new Function('endDrag','editorService',`${wrappers};return {undoEditor,redoEditor};`)(cancel=>events.push(['cancel',cancel]),{undo:()=>events.push(['undo']),redo:()=>events.push(['redo'])});
  undoEditor();redoEditor();assert.deepEqual(events,[['cancel',true],['undo'],['cancel',true],['redo']]);
  assert.equal((source.match(/editorService\.undo\(/g)||[]).length,1);
  assert.equal((source.match(/editorService\.redo\(/g)||[]).length,1);
  assert.match(source, /addEventListener\("click", undoEditor\)/);
  assert.match(source, /event\.shiftKey \? redoEditor\(\) : undoEditor\(\)/);
});
