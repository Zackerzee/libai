import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {selectionContains,selectionCells,rectangularSelection} from '../services/selection-service.js';
import {buildActivateColorPatch,buildHighlightOnlyPatch} from '../services/current-palette.mjs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
function harness(selection,grid,drag){
  const state={editor:{selection,selectedCell:null},ui:{}},opens=[];
  const context={drag,sourceDrag:null,cropController:{end(){}},requestSourceDraw(){},get:()=>state,bridge:{getResult:()=>({grid,width:grid[0].length,height:grid.length})},
    editorService:{getCell:(x,y)=>grid[y]?.[x],inspectCell:(x,y)=>grid[y]?.[x]},selectionContains,selectionCells,
    paletteColors:()=>grid.flat().filter(Boolean),paletteIdOf:color=>color.paletteId,buildActivateColorPatch,buildHighlightOnlyPatch,
    store:{setState:patch=>{for(const key of Object.keys(patch))Object.assign(state[key],patch[key]);}},cellColorPopover:{open:()=>opens.push(state.editor.selectedCell)},
    usageScrolledPaletteId:null,lastSelectionTap:null,performance:{now:()=>0},well:{classList:{remove(){}}},renderer:{requestDraw(){}}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('  const openSelectionColorPopover ='),source.indexOf('  // 历史操作先取消')),context);
  return{state,opens,end:cancel=>vm.runInContext(`endDrag(${Boolean(cancel)})`,context)};
}
const a={paletteId:'A01',code:'A01',rgb:[255,0,0]};
for(const type of ['region','lasso','select']){
  test(`${type} completion opens selected occupied bead even when start is empty`,()=>{
    const selection=rectangularSelection(0,0,1,0,3,1),h=harness(selection,[[null,a,a]],{type,start:{x:0,y:0},moved:true});
    h.end(false);assert.equal(h.opens.length,1);assert.equal(h.opens[0].x,1);assert.equal(h.state.editor.selection,selection);assert.equal(h.state.editor.currentPaletteId,'A01');
  });
  test(`${type} cancellation restores selection without opening popup`,()=>{
    const previousSelection=rectangularSelection(2,0,2,0,3,1),h=harness(null,[[null,a,a]],{type,previousSelection,previousFocus:{selectedCell:{x:2,y:0}}});
    h.end(true);assert.equal(h.opens.length,0);assert.equal(h.state.editor.selection,previousSelection);
  });
}
test('masked selection ignores occupied holes and empty selections do not open',()=>{
  for(const selection of [null,{x0:0,y0:0,x1:1,y1:0,mask:new Set(['0,0'])}]){
    const h=harness(selection,[[null,a]],{type:'lasso'});h.end(false);assert.equal(h.opens.length,0);
  }
});
test('rectangle prefers its occupied starting cell',()=>{
  const h=harness(rectangularSelection(0,0,1,0,2,1),[[a,a]],{type:'region',start:{x:1,y:0}});
  h.end(false);assert.equal(h.opens[0].x,1);
});
