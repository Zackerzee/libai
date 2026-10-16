import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lassoSelection} from '../services/lasso-selection.mjs';
import {selectionCells,selectionContains,rectangularSelection} from '../services/selection-service.js';
import {translateSelection} from '../services/shapes-service.js';
import {createEditorService} from '../services/editor-service.js';
const points=values=>values.map(([x,y])=>({x,y}));
test('opposite diagonals exclude corner-only neighboring cells',()=>{
  const positive=lassoSelection(points([[.5,.5],[2.5,2.5]]),3,3);
  const negative=lassoSelection(points([[.5,2.5],[2.5,.5]]),3,3);
  assert.equal(positive.mask.size,3);assert.equal(negative.mask.size,3);
  assert.deepEqual([...negative.mask].sort(),['0,2','1,1','2,0']);
});
test('fast straight sweep visits every crossed cell',()=>{
  const selection=lassoSelection(points([[.2,.5],[9.8,.5]]),10,3);
  assert.equal(selection.mask.size,10);
  for(let x=0;x<10;x++)assert.equal(selectionContains(selection,x,0),true);
});
test('concave and closed traces select stroke only, never inside or implied closing segment',()=>{
  const selected=lassoSelection(points([[.5,.5],[3.5,.5],[3.5,3.5],[.5,3.5],[.5,.5]]),5,5);
  assert.equal(selected.mask.size,12);
  assert.equal(selectionContains(selected,1,1),false);
  assert.equal(selectionContains(selected,2,2),false);
  const open=lassoSelection(points([[.5,.5],[3.5,.5],[3.5,3.5]]),5,5);
  assert.equal(selectionContains(open,1,1),false);
  assert.equal(selectionContains(open,0,3),false);
});
test('outside segments clip to grid, offgrid click does not accidentally hit edge',()=>{
  const selection=lassoSelection(points([[-100000,.5],[100000,.5]]),4,3);
  assert.equal(selection.mask.size,4);
  assert.equal(lassoSelection(points([[-1,-1]]),4,3),null);
  assert.equal(lassoSelection(points([[-2,-2],[-1,-1]]),4,3),null);
});
test('single click selects immediately and multiple strokes union previous without mutating it',()=>{
  const previous=rectangularSelection(0,0,1,0,5,5);
  const selected=lassoSelection(points([[4.5,4.5]]),5,5,previous);
  assert.equal(selected.mask.size,3); assert.equal(previous.mask,undefined);
  const next=lassoSelection(points([[2.5,2.5]]),5,5,selected);
  assert.equal(next.mask.size,4);assert.equal(selected.mask.size,3);
});
test('diagonal traversal and mask translation retain only traversed cells',()=>{
  const selected=lassoSelection(points([[.5,.5],[2.5,2.5]]),5,5);
  assert.deepEqual(selectionCells(selected,5,5),[{x:0,y:0},{x:1,y:1},{x:2,y:2}]);
  assert.deepEqual(selectionCells(translateSelection(selected,1,0,5,5),5,5),[{x:1,y:0},{x:2,y:1},{x:3,y:2}]);
});
test('swept mask supports recolor and erase/undo without touching interior',()=>{
  const a={code:'A1',paletteId:'A1',hex:'#111111',rgb:[17,17,17]},b={code:'B1',paletteId:'B1',hex:'#ffffff',rgb:[255,255,255]};
  const grid=Array.from({length:4},()=>Array(4).fill(a)),before=structuredClone(grid);
  const bridge={getResult:()=>({grid,width:4,height:4,colors:[]}),getCell:(x,y)=>grid[y]?.[x]||null,getPaletteColors:()=>[a,b],applyCellChanges(changes){for(const {x,y,after}of changes)grid[y][x]=after;return changes.length;}};
  const editor=createEditorService(bridge),selected=lassoSelection(points([[.5,.5],[3.5,.5],[3.5,3.5]]),4,4);
  assert.equal(editor.canUndo(),false);assert.deepEqual(grid,before);
  assert.equal(editor.recolorSelection(selected,'B1'),true);assert.equal(grid[0][0].code,'B1');assert.equal(grid[1][1].code,'A1');
  assert.equal(editor.undo(),true);assert.deepEqual(grid,before);
  editor.eraseSelection(selected);assert.equal(grid[0][0],null);assert.equal(grid[1][1].code,'A1');
  assert.equal(editor.undo(),true);assert.deepEqual(grid,before);
});
test('UI uses live cell selection, no polygon overlay, and Escape/cancel restores snapshot',()=>{
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  assert.match(source,/new Option\('涂选','lasso'\)/);
  assert.match(source,/selection:lassoSelection\(\[drag.last,at\],result.width,result.height,get\(\).editor.selection\)/);
  assert.match(source,/if\(cancel\)store.setState\(\{editor:\{selection:drag.previousSelection,\.\.\.drag.previousFocus\}\}\)/);
  assert.match(source,/if\(drag\?\.type==='lasso'\)\{event.preventDefault\(\);endDrag\(true\);return;\}/);
  assert.match(source,/pointercancel.*endCanvasPointer\(event,true\)/);
  assert.doesNotMatch(source,/lassoPreview|updateLassoPreview/);
});
