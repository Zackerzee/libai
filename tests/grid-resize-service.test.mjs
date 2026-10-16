import test from "node:test";
import assert from "node:assert/strict";
import { createEditorService } from "../services/editor-service.js";
import {
  RESIZE_ANCHORS,
  blankBorderInsets,
  clampSelectionToBounds,
  createGridResizeCommand,
  createGridTrimCommand,
  resizeCanvasGrid,
  resizeCropInsets,
  scalePatternNearest,
  trimBlankBorders,
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

test("crop warning reports every side for all anchors", () => {
  assert.deepEqual(resizeCropInsets(222, 295, 220, 300, { anchor: "center" }), { top: 0, bottom: 0, left: 1, right: 1 });
  assert.deepEqual(resizeCropInsets(220, 300, 104, 104, { anchor: "top-left" }), { top: 0, bottom: 196, left: 0, right: 116 });
  assert.deepEqual(resizeCropInsets(220, 300, 104, 104, { anchor: "bottom-right" }), { top: 196, bottom: 0, left: 116, right: 0 });
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

/* ── 空白边距收缩（用户 2026-10-16：「减少图纸空白格」） ─────────────────── */

test("blankBorderInsets counts only outer rings; interior holes stay untouched", () => {
  // 5×5，内容只在 (2,2)；四周各 2 圈空白。
  const grid = Array.from({ length: 5 }, () => Array(5).fill(null));
  grid[2][2] = color("brand:A");
  assert.deepEqual(blankBorderInsets(grid), { top: 2, right: 2, bottom: 2, left: 2 });
  // 内容顶到左上角：只有右/下两侧有空白。
  const corner = Array.from({ length: 4 }, () => Array(4).fill(null));
  corner[0][0] = color("brand:A");
  assert.deepEqual(blankBorderInsets(corner), { top: 0, right: 3, bottom: 3, left: 0 });
  // 内部空白洞（镂空）不算：整行只有中间一个洞时该行不是空白行。
  const holed = Array.from({ length: 3 }, () => Array(3).fill(null));
  holed[1] = [color("brand:A"), null, color("brand:B")];
  assert.deepEqual(blankBorderInsets(holed), { top: 1, right: 0, bottom: 1, left: 0 });
  // 全空图纸：top 数到 height 即止，其余三边不重复计数。
  assert.deepEqual(blankBorderInsets([[null, null], [null, null]]), { top: 2, right: 0, bottom: 0, left: 0 });
  // 没有空白 / 空矩阵。
  assert.deepEqual(blankBorderInsets([[color("brand:A")]]), { top: 0, right: 0, bottom: 0, left: 0 });
  assert.deepEqual(blankBorderInsets([]), { top: 0, right: 0, bottom: 0, left: 0 });
});

test("trimBlankBorders cuts to content box plus margin, clamped by available blank", () => {
  const grid = Array.from({ length: 5 }, () => Array(5).fill(null));
  grid[2][2] = color("brand:A");
  // 紧凑：内容贴边，5×5 → 1×1。
  const tight = trimBlankBorders(grid, 0);
  assert.deepEqual([tight.width, tight.height], [1, 1]);
  assert.equal(tight.grid[0][0].paletteId, "brand:A");
  assert.deepEqual(tight.insets, { top: 2, right: 2, bottom: 2, left: 2 });
  // 留 1 格：内容框外各扩 1 格（两侧都有 ≥1 空白可扩）→ 3×3，内容居中。
  const m1 = trimBlankBorders(grid, 1);
  assert.deepEqual([m1.width, m1.height], [3, 3]);
  assert.equal(m1.grid[1][1].paletteId, "brand:A");
  // 留 2 格 = 恰好回到原尺寸 → 视为「没有变化」，返回 null（按钮点了也没用）。
  assert.equal(trimBlankBorders(grid, 2), null);
  // margin 超过某侧空白量时该侧收到贴边：顶行有内容（top=0），留 2 格时上侧扩不出。
  const edge = Array.from({ length: 5 }, () => Array(5).fill(null));
  edge[0][2] = color("brand:A");
  const m2 = trimBlankBorders(edge, 2);
  assert.deepEqual([m2.width, m2.height], [5, 3]); // 左右各留 2，下侧留 2，上侧贴边
  // 没有空白可收 → null。
  assert.equal(trimBlankBorders([[color("brand:A")]], 0), null);
  assert.equal(trimBlankBorders([], 0), null);
});

test("trim is one existing history command and undo redo use frozen snapshots", () => {
  let result = { width: 5, height: 5, grid: Array.from({ length: 5 }, () => Array(5).fill(null)) };
  result.grid[2][2] = color("brand:A");
  const bridge = {
    getResult: () => result,
    getCell: (x, y) => result.grid[y]?.[x] || null,
    getPaletteColors: () => [],
    applyCellChanges: () => false,
    replaceGridStructure(snapshot) { result = snapshot; return true; },
  };
  const editor = createEditorService(bridge);
  const command = createGridTrimCommand(bridge, { ...result, margin: 1 });
  assert.ok(command, "有空白可收时必须给出命令");
  assert.equal(editor.executeCommand(command), true);
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  assert.deepEqual([result.width, result.height], [3, 3]);
  assert.equal(result.grid[1][1].paletteId, "brand:A");
  result.grid[1][1] = color("brand:MUTATION");
  assert.equal(editor.undo(), true);
  assert.deepEqual([result.width, result.height], [5, 5]);
  assert.equal(result.grid[2][2].paletteId, "brand:A");
  assert.equal(editor.redo(), true);
  assert.deepEqual([result.width, result.height], [3, 3]);
  assert.equal(result.grid[1][1].paletteId, "brand:A");
  // 没有空白可收时命令为 null（调用方据此不做任何事）。
  assert.equal(createGridTrimCommand(bridge, { grid: [[color("brand:A")]], width: 1, height: 1, margin: 0 }), null);
});
