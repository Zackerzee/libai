import test from 'node:test';
import assert from 'node:assert/strict';
import {selectionBoundaryEdges} from '../ui/canvas-renderer.js';
test('connected region excludes shared internal edges and follows its actual contour',()=>{
  const selection={mask:new Set(['0,0','1,0','0,1'])};
  const edges=[[0,0],[1,0],[0,1]].flatMap(([x,y])=>selectionBoundaryEdges(selection,x,y));
  assert.equal(edges.length,8);
  assert.deepEqual(selectionBoundaryEdges(selection,1,1),[]);
  assert.ok(!edges.some(e=>JSON.stringify(e)==='[1,0,1,1]'));
});
