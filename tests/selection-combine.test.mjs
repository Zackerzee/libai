import test from 'node:test';
import assert from 'node:assert/strict';
import { combineSelections } from '../services/selection-combine.mjs';
import { rectangularSelection, selectionCells } from '../services/selection-service.js';
test('magic wand modifiers add and subtract both rectangles and masks', () => {
  const a=rectangularSelection(0,0,1,0,5,1),b=rectangularSelection(3,0,4,0,5,1);
  const union=combineSelections(a,b,5,1,'add');
  assert.deepEqual(selectionCells(union,5,1),[{x:0,y:0},{x:1,y:0},{x:3,y:0},{x:4,y:0}]);
  assert.deepEqual(selectionCells(combineSelections(union,a,5,1,'subtract'),5,1),selectionCells(b,5,1));
  assert.equal(combineSelections(a,a,5,1,'subtract'),null);
  assert.equal(combineSelections(a,b,5,1),b);
  assert.deepEqual(selectionCells(combineSelections(null,b,5,1,'add'),5,1),selectionCells(b,5,1));
});
