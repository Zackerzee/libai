import test from "node:test";
import assert from "node:assert/strict";
import { createEditorService } from "../services/editor-service.js";

const A = { code: "A01", paletteId: "mard:A01", rgb: [1, 2, 3] };
const B = { code: "A01", paletteId: "other:A01", rgb: [1, 2, 3] };
const C = { code: "H07", paletteId: "mard:H07", rgb: [9, 8, 7] };
const copy = (value) => structuredClone(value);
function fixture(options = {}) {
  const grid = [[A, null, C, C], [B, C, C, C], [C, C, C, C], [C, C, C, C]].map(copy);
  let selection = { kind: "rectangle", x0: 0, y0: 0, x1: 1, y1: 1 };
  const bridge = {
    getResult: () => ({ grid, width: 4, height: 4 }),
    getCell: (x, y) => grid[y]?.[x] ?? null,
    getPaletteColors: () => [A, B, C],
    applyCellChanges(changes) { let count = 0; for (const { x, y, after } of changes) { grid[y][x] = copy(after); count++; } return count; },
  };
  const editor = createEditorService(bridge, { ...options, setSelection: (value) => { selection = value; } });
  return { grid, editor, getSelection: () => selection };
}
for (const [kind, expected] of [["rotate", [[B, A], [C, null]]], ["flipX", [[null, A], [C, B]]], ["flipY", [[B, C], [A, null]]]]) {
  test(`${kind}: pure preview, identity, null and one-command undo/redo`, () => {
    const f = fixture(), original = copy(f.grid), selection = copy(f.getSelection());
    const plan = f.editor.planSelectionTransform(selection, kind);
    assert.deepEqual(f.grid, original);
    assert.deepEqual(f.editor.historyDepth(), { undo: 0, redo: 0 });
    assert.equal(f.editor.applySelectionTransform(plan), true);
    assert.deepEqual(f.grid.slice(0, 2).map((row) => row.slice(0, 2)), expected);
    assert.deepEqual(f.editor.historyDepth(), { undo: 1, redo: 0 });
    const transformed = copy(f.grid), transformedSelection = copy(f.getSelection());
    assert.equal(f.editor.undo(), true); assert.deepEqual(f.grid, original); assert.deepEqual(f.getSelection(), selection);
    assert.equal(f.editor.redo(), true); assert.deepEqual(f.grid, transformed); assert.deepEqual(f.getSelection(), transformedSelection);
  });
}
test("nonrectangular mask transforms only its members; unselected holes survive", () => {
  const f = fixture(), selection = { kind: "lasso", x0: 0, y0: 0, x1: 1, y1: 1, mask: new Set(["0,0", "1,0", "0,1"]) };
  assert.equal(f.editor.transformSelection(selection, "rotate"), true);
  assert.equal(f.grid[0][0].paletteId, B.paletteId);
  assert.equal(f.grid[0][1].paletteId, A.paletteId);
  assert.equal(f.grid[1][1], null);
  assert.equal(f.grid[1][0], null);
  assert.deepEqual(f.getSelection().mask, new Set(["1,0", "1,1", "0,0"]));
});
test("move clips at board edge, overwrites null, preserves dimensions and can undo selection", () => {
  const f = fixture(), original = copy(f.grid);
  assert.equal(f.editor.transformSelection(f.getSelection(), "move", { dx: 3, dy: 0 }), true);
  assert.equal(f.grid[0][3].paletteId, A.paletteId); assert.equal(f.grid[1][3].paletteId, B.paletteId);
  assert.equal(f.getSelection().x0, 3); assert.equal(f.getSelection().x1, 3);
  assert.equal(f.grid.length, 4); assert.equal(f.grid[0].length, 4);
  f.editor.undo(); assert.deepEqual(f.grid, original);
});
test("preview cancellation and stale touched cell do not write history", () => {
  const f = fixture();
  const plan = f.editor.planSelectionTransform(f.getSelection(), "rotate");
  f.grid[0][0] = copy(C);
  assert.equal(f.editor.applySelectionTransform(plan), false);
  assert.deepEqual(f.editor.historyDepth(), { undo: 0, redo: 0 });
});
test("non-square rotation swaps selected bounds but never board dimensions", () => {
  const f = fixture(), selection = { kind: "rectangle", x0: 0, y0: 0, x1: 2, y1: 1 };
  assert.equal(f.editor.transformSelection(selection, "rotate"), true);
  assert.deepEqual(f.grid.slice(0, 3).map((row) => row.slice(0, 2)), [[B, A], [C, null], [C, C]]);
  assert.equal(f.getSelection().x1, 1); assert.equal(f.getSelection().y1, 2);
  assert.equal(f.grid.length, 4); assert.equal(f.grid[0].length, 4);
});
test("default copy capacity is eight and returned selections cannot mutate command snapshots", () => {
  const f = fixture();
  for (let i = 0; i < 10; i++) f.editor.copySelection(f.getSelection());
  assert.equal(f.editor.getClipboardHistory().length, 8);
  f.editor.transformSelection(f.getSelection(), "rotate");
  f.getSelection().mask.clear();
  f.editor.undo(); f.editor.redo();
  assert.equal(f.getSelection().mask.size, 4);
});
test("clipboard history is bounded, isolated, reselectable, null-aware, session-only and clearable", () => {
  const f = fixture({ clipboardLimit: 2 }), selection = f.getSelection();
  f.editor.copySelection(selection);
  f.grid[0][0] = copy(C);
  f.editor.copySelection(selection);
  const history = f.editor.getClipboardHistory();
  history[1].entries[0].color.rgb[0] = 255;
  assert.equal(f.editor.getClipboardHistory()[1].entries[0].color.rgb[0], 1);
  assert.equal(f.editor.selectClipboardHistory(1), true);
  assert.equal(f.editor.pasteClipboard(2, 2), true);
  assert.equal(f.grid[2][2].paletteId, A.paletteId); assert.equal(f.grid[2][3], null);
  assert.equal(f.grid[3][2].paletteId, B.paletteId);
  f.editor.copySelection(selection);
  assert.equal(f.editor.getClipboardHistory().length, 2);
  assert.equal(f.editor.selectClipboardHistory(9), false);
  assert.equal(fixture().editor.getClipboardHistory().length, 0);
  f.editor.clearClipboardHistory(); assert.equal(f.editor.hasClipboard(), false);
});
test("copy accepts 160000 selected cells without argument spread overflow", () => {
  const grid = Array.from({ length: 400 }, () => Array(400).fill(A));
  const editor = createEditorService({ getResult: () => ({ grid, width: 400, height: 400 }), getCell: (x, y) => grid[y][x] });
  assert.equal(editor.copySelection({ kind: "rectangle", x0: 0, y0: 0, x1: 399, y1: 399 }), true);
  assert.deepEqual(editor.getClipboard(), { width: 400, height: 400, beads: 160000 });
  grid[0][0] = C;
  assert.equal(editor.getClipboardHistory()[0].entries[0].color.paletteId, A.paletteId);
});
test("clipboard selection rejects noninteger and negative indices; null mask copies empty beads", () => {
  const f = fixture();
  assert.equal(f.editor.copySelection({ kind: "same-color", x0: 1, y0: 0, x1: 1, y1: 0, mask: new Set(["1,0"]) }), true);
  assert.deepEqual(f.editor.getClipboard(), { width: 1, height: 1, beads: 0 });
  for (const index of [-1, 0.5, NaN, "0", 99]) assert.equal(f.editor.selectClipboardHistory(index), false);
  assert.equal(f.editor.selectClipboardHistory(0), true);
});
test("nonfinite move offsets reject without writing grid or history", () => {
  const f = fixture(), original = copy(f.grid);
  for (const options of [{ dx: NaN }, { dy: Infinity }, { dx: "1" }]) {
    assert.equal(f.editor.planSelectionTransform(f.getSelection(), "move", options), null);
    assert.equal(f.editor.transformSelection(f.getSelection(), "move", options), false);
  }
  assert.deepEqual(f.grid, original);
  assert.deepEqual(f.editor.historyDepth(), { undo: 0, redo: 0 });
});
