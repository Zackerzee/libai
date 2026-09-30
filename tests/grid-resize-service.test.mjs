import test from "node:test";
import assert from "node:assert/strict";
import { createEditorService } from "../services/editor-service.js";
import {
  RESIZE_ANCHORS,
  clampSelectionToBounds,
  createGridResizeCommand,
  resizeCanvasGrid,
  scalePatternNearest,
} from "../services/grid-resize-service.js";

const color = (paletteId) => ({ paletteId, code: paletteId.split(":").at(-1), rgb: [12, 34, 56] });
const ids = (grid) => grid.map((row) => row.map((cell) => cell?.paletteId || null));

test("canvas resize supports production 222x295 to 220x300 dimensions", () => {
  const grid = Array.from({ length: 295 }, () => Array(222).fill(null));
  grid[147][111] = color("brand:MID");
  const resized = resizeCanvasGrid(grid, 220, 300, { anchor: "center" });
  assert.equal(resized.length, 300);
  assert.equal(resized[0].length, 220);
  assert.equal(resized[149][110].paletteId, "brand:MID");
  assert.equal(resized[0][0], null, "expanded canvas uses canonical null");
});

test("all nine anchors keep their corresponding corner or edge stable", () => {
  const A = color("brand:A"), B = color("brand:B"), C = color("brand:C"), D = color("brand:D");
  const source = [[A, null, B], [null, null, null], [C, null, D]];
  const expected = {
    "top-left": [0, 0, "brand:A"], top: [1, 0, "brand:A"], "top-right": [2, 0, "brand:A"],
    left: [0, 1, "brand:A"], center: [1, 1, "brand:A"], right: [2, 1, "brand:A"],
    "bottom-left": [0, 2, "brand:A"], bottom: [1, 2, "brand:A"], "bottom-right": [2, 2, "brand:A"],
  };
  for (const anchor of RESIZE_ANCHORS) {
    const [x, y, id] = expected[anchor];
    assert.equal(resizeCanvasGrid(source, 5, 5, { anchor })[y][x]?.paletteId, id, anchor);
  }
  assert.deepEqual(ids(resizeCanvasGrid(source, 2, 2, { anchor: "top-left" })), [["brand:A", null], [null, null]]);
  assert.deepEqual(ids(resizeCanvasGrid(source, 2, 2, { anchor: "bottom-right" })), [[null, null], [null, "brand:D"]]);
});

test("pattern scaling is nearest-neighbor and preserves palette identity", () => {
  const A = color("brand:A"), twin = color("brand:TWIN");
  const scaled = scalePatternNearest([[A, twin]], 4, 2);
  assert.deepEqual(ids(scaled), [
    ["brand:A", "brand:A", "brand:TWIN", "brand:TWIN"],
    ["brand:A", "brand:A", "brand:TWIN", "brand:TWIN"],
  ]);
  assert.notEqual(scaled[0][0], A, "snapshot cells are cloned, not aliased");
  assert.equal(scaled[0][0].paletteId, "brand:A");
});

test("resize is one existing history command and undo redo use frozen snapshots", () => {
  let result = { width: 2, height: 1, grid: [[color("brand:A"), color("brand:B")]] };
  const bridge = {
    getResult: () => result,
    getCell: (x, y) => result.grid[y]?.[x] || null,
    getPaletteColors: () => [],
    applyCellChanges: () => false,
    replaceGridStructure(snapshot) {
      // 故意直接接管矩阵，模拟最容易污染历史快照的 bridge 实现。
      result = snapshot;
      return true;
    },
  };
  const editor = createEditorService(bridge);
  const command = createGridResizeCommand(bridge, { ...result, targetWidth: 4, targetHeight: 2, anchor: "top-left" });
  assert.equal(editor.executeCommand(command), true);
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  assert.deepEqual(ids(result.grid), [["brand:A", "brand:B", null, null], [null, null, null, null]]);
  result.grid[0][0] = color("brand:MUTATION");
  assert.equal(editor.undo(), true);
  assert.deepEqual(ids(result.grid), [["brand:A", "brand:B"]]);
  assert.equal(editor.redo(), true);
  assert.deepEqual(ids(result.grid), [["brand:A", "brand:B", null, null], [null, null, null, null]]);
});

test("selection bounds clamp rectangles and masks after a resize", () => {
  assert.deepEqual(clampSelectionToBounds({ kind: "rectangle", x0: 8, y0: -2, x1: 2, y1: 7 }, 6, 5),
    { kind: "rectangle", x0: 2, y0: 0, x1: 5, y1: 4 });
  assert.equal(clampSelectionToBounds({ kind: "rectangle", x0: 7, y0: 7, x1: 9, y1: 9 }, 5, 5), null);
  const masked = clampSelectionToBounds({ kind: "magic-wand", x0: 0, y0: 0, x1: 8, y1: 8, mask: new Set(["1,1", "8,8"]) }, 4, 4);
  assert.deepEqual([...masked.mask], ["1,1"]);
  assert.deepEqual([masked.x0, masked.y0, masked.x1, masked.y1], [1, 1, 1, 1]);
});
