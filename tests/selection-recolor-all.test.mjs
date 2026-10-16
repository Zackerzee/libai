import test from 'node:test';
import assert from 'node:assert/strict';
import {createEditorService} from '../services/editor-service.js';
test('whole selection recolors mixed palette IDs in one history entry, preserving null and outside',()=>{
  const a={paletteId:'A15',code:'A15',hex:'#111111',rgb:[17,17,17]}, b={...a,paletteId:'G19',code:'G19'}, target={code:'H2',paletteId:'H2',hex:'#ffffff',rgb:[255,255,255]};
  const grid=[[a,a,a,b],[b,b,b,b],[b,null,null,a]];
  const before=structuredClone(grid);
  const bridge={getResult:()=>({grid,width:4,height:3,colors:[]}),getCell:(x,y)=>grid[y]?.[x]||null,getPaletteColors:()=>[a,b,target],applyCellChanges(changes){for(const {x,y,after} of changes)grid[y][x]=after;return changes.length;}};
  const editor=createEditorService(bridge), selection={x0:0,y0:0,x1:3,y1:2};
  // Exclude the outside last cell through the existing mask model.
  selection.mask=new Set(['0,0','1,0','2,0','3,0','0,1','1,1','2,1','3,1','0,2','1,2','2,2']);
  assert.equal(editor.recolorSelection(selection,'H2'),true);
  assert.equal(grid.flat().filter(c=>c?.paletteId==='H2').length,9);
  assert.equal(grid[2][3].paletteId,'A15');assert.equal(grid[2][1],null);
  selection.mask.clear();
  assert.equal(editor.undo(),true);assert.deepEqual(grid,before);assert.equal(editor.canUndo(),false);
  assert.equal(editor.redo(),true);assert.equal(grid.flat().filter(c=>c?.paletteId==='H2').length,9);
  assert.equal(editor.recolorSelection({x0:0,y0:0,x1:0,y1:0},'H2'),false);
});
