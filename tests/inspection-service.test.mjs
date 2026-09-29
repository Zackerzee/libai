import test from "node:test";
import assert from "node:assert/strict";
import {
  createInspectionState, currentInspectionIssue, setInspectionIssues, startInspection,
  stopInspection, nextInspectionIssue, previousInspectionIssue, nextInspectionCell, previousInspectionCell,
} from "../services/inspection-service.js";

const issues = [
  { id: "rare:a", type: "rare-color", paletteId: "brand:A", label: "A · 2颗", cells: [{ x: 1, y: 2 }, { x: 8, y: 9 }] },
  { id: "rare:b", type: "rare-color", paletteId: "brand:B", label: "B · 1颗", cells: [{ x: 4, y: 5 }] },
];

test("generic issue inspection supports next/previous boundaries without touching grid", () => {
  const grid = [[{ paletteId: "brand:A" }]];
  let state = startInspection(setInspectionIssues(createInspectionState(), issues));
  assert.equal(currentInspectionIssue(state).id, "rare:a");
  state = nextInspectionIssue(state);
  assert.equal(currentInspectionIssue(state).id, "rare:b");
  state = nextInspectionIssue(state);
  assert.equal(currentInspectionIssue(state).id, "rare:b");
  state = previousInspectionIssue(state);
  assert.equal(currentInspectionIssue(state).id, "rare:a");
  state = previousInspectionIssue(state);
  assert.equal(currentInspectionIssue(state).id, "rare:a");
  assert.equal(grid[0][0].paletteId, "brand:A");
  assert.equal(stopInspection(state).active, false);
});

test("one issue can cycle through all cells", () => {
  let state = startInspection(setInspectionIssues(createInspectionState(), issues));
  state = nextInspectionCell(state);
  assert.equal(state.cellIndex, 1);
  state = nextInspectionCell(state);
  assert.equal(state.cellIndex, 0);
  state = previousInspectionCell(state);
  assert.equal(state.cellIndex, 1);
});

test("diagnostic refresh preserves palette identity and chooses nearest issue when resolved", () => {
  let state = startInspection(setInspectionIssues(createInspectionState(), issues), 1);
  state = setInspectionIssues(state, [issues[0], { ...issues[1], cells: [{ x: 7, y: 7 }] }]);
  assert.equal(currentInspectionIssue(state).id, "rare:b");
  state = setInspectionIssues(state, [issues[0]]);
  assert.equal(currentInspectionIssue(state).id, "rare:a");
  assert.equal(state.active, true);
  assert.equal(currentInspectionIssue(state).paletteId, "brand:A");
});
