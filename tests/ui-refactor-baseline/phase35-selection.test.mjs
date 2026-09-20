import test from "node:test";
import assert from "node:assert/strict";
import { rectangularSelection, sameColorSelection, connectedSelection, selectionCells, selectionContains, outerOutline } from "../../services/selection-service.js";

const A = { code: "A03" }, H = { code: "H07" };
const grid = [[H,H,A,A],[H,A,A,H],[A,H,H,H],[A,A,H,H]];

test("rectangular selection remains in grid coordinates", () => {
  const selection = rectangularSelection(2,2,1,0,4,4);
  assert.equal(selectionCells(selection,4,4).length,6);
  assert.equal(selectionContains(selection,2,1),true);
  assert.equal(selectionContains(selection,0,1),false);
});

test("same color selects dispersed cells, connected selects only four-neighbor island", () => {
  const same = sameColorSelection(grid,0,0), connected = connectedSelection(grid,0,0);
  assert.equal(selectionCells(same,4,4).length,9);
  assert.equal(selectionCells(connected,4,4).length,3);
  assert.equal(selectionContains(connected,3,1),false);
  const within = rectangularSelection(0,0,1,1,4,4);
  assert.equal(selectionCells(sameColorSelection(grid,0,0,within),4,4).length,3);
});

test("outline uses four neighbors unless diagonal enabled", () => {
  const square = rectangularSelection(1,1,2,2,4,4);
  assert.equal(outerOutline(square,4,4,false).length,8);
  assert.equal(outerOutline(square,4,4,true).length,12);
});
