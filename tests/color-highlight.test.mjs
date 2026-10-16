import test from 'node:test';
import assert from 'node:assert/strict';
import {highlightedColorEdges} from '../ui/color-highlight.mjs';
const a={paletteId:'mard:A01',rgb:[255,255,255]},b={paletteId:'other:A01',rgb:[255,255,255]};
test('connected matching cells have a shared silhouette without internal borders',()=>{
  assert.equal(highlightedColorEdges([[a,a]],a.paletteId).length,6);
});
test('isolated colors anywhere on the artwork are outlined by identity, not RGB',()=>{
  const grid=[[a,null,b],[null,null,null],[null,a,null]],before=JSON.stringify(grid);
  assert.equal(highlightedColorEdges(grid,a.paletteId).length,8);
  assert.equal(JSON.stringify(grid),before);
  assert.equal(highlightedColorEdges(grid,null).length,0);
});
test('only visible cells create geometry, offscreen neighbors still suppress internal edges',()=>{
  assert.equal(highlightedColorEdges([[a,a]],a.paletteId,{x0:1,y0:0,x1:2,y1:1}).length,3);
});
