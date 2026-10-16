import test from 'node:test';
import assert from 'node:assert/strict';
import {closedLassoSelection} from '../services/closed-lasso-selection.mjs';
const path = values => values.map(([x,y]) => ({x,y}));
test('closed lasso fills centers and does not mutate input', () => {
  const points = path([[0,0],[3,0],[3,3],[0,3]]), before = structuredClone(points);
  const result = closedLassoSelection(points,5,5);
  assert.equal(result.kind,'closed-lasso'); assert.equal(result.mask.size,9);
  assert.equal(result.mask.has('1,1'),true); assert.deepEqual(points,before);
});
test('short and duplicate-only paths are empty', () => {
  for (const points of [[],path([[0,0]]),path([[0,0],[1,1],[0,0]])]) assert.equal(closedLassoSelection(points,4,4),null);
});
test('explicit close and duplicate vertices do not change result', () => {
  const a = path([[0,0],[2,0],[2,2],[0,2]]);
  assert.deepEqual(closedLassoSelection([...a,a[3],a[0]],4,4),closedLassoSelection(a,4,4));
});
test('outside polygons clip to grid, entirely outside yields empty', () => {
  assert.equal(closedLassoSelection(path([[-1,-1],[100,-1],[100,100],[-1,100]]),3,2).mask.size,6);
  assert.equal(closedLassoSelection(path([[-5,-5],[-2,-5],[-2,-2]]),3,3),null);
});
test('concave polygon excludes cutout', () => {
  const result=closedLassoSelection(path([[0,0],[3,0],[3,1],[1,1],[1,3],[0,3]]),3,3);
  assert.equal(result.mask.size,5);assert.equal(result.mask.has('1,1'),false);
});
test('self intersection has deterministic even-odd fill including boundary centers', () => {
  const points=path([[0,0],[4,4],[0,4],[4,0]]);
  const result=closedLassoSelection(points,4,4);
  assert.equal(result.mask.size,12);assert.deepEqual(closedLassoSelection([...points].reverse(),4,4),result);
});
test('invalid points filtered and invalid dimensions rejected', () => {
  assert.equal(closedLassoSelection(path([[0,0],[2,0],[0,2]]),0,3),null);
  assert.equal(closedLassoSelection([null,{x:NaN,y:2}],3,3),null);
});
