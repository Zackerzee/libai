import test from "node:test";
import assert from "node:assert/strict";
import { createEditorService } from "../../services/editor-service.js";
import { createProjectStore } from "../../state/project-store.js";
import { createViewportService, sliderToZoom, zoomToSlider } from "../../services/viewport-service.js";
import { codeForegroundColor } from "../../ui/canvas-renderer.js";

const H07 = { code: "H07", hex: "#111111", rgb: [17,17,17] };
const A03 = { code: "A03", hex: "#eeeeee", rgb: [238,238,238] };
function fixture() {
  const grid = [[H07,H07],[H07,A03]];
  const bridge = {
    getResult() { return { grid, width: 2, height: 2, colors: [H07,A03].map((color) => ({ ...color, count: grid.flat().filter((cell) => cell?.code === color.code).length })) }; },
    getCell(x,y) { return grid[y]?.[x] || null; },
    getPaletteColors() { return [H07,A03]; },
    applyCellChanges(changes) { let n = 0; for (const {x,y,after} of changes) { if (grid[y][x]?.code !== after?.code) { grid[y][x] = after; n++; } } return n; },
  };
  return { grid, bridge, editor: createEditorService(bridge) };
}

test("single bead change, undo and redo mutate the one canonical grid", () => {
  const { grid, editor } = fixture();
  assert.equal(editor.setCellColor(0,0,"A03"), true);
  assert.equal(grid[0][0].code,"A03"); assert.equal(editor.getColorUsage("A03"),2);
  assert.equal(editor.undo(),true); assert.equal(grid[0][0].code,"H07");
  assert.equal(editor.redo(),true); assert.equal(grid[0][0].code,"A03");
});

test("global replace stores cell diffs and a new edit clears redo", () => {
  const { grid, editor } = fixture();
  assert.equal(editor.replaceColor("H07","A03"),true);
  assert.equal(editor.getColorUsage("H07"),0); assert.equal(editor.getColorUsage("A03"),4);
  editor.undo(); assert.equal(grid[1][0].code,"H07");
  editor.setCellColor(1,0,"A03"); assert.equal(editor.canRedo(),false);
});

test("global replace uses paletteId rather than RGB or display code", () => {
  const source = { code: "OLD", paletteId: "mard:H05", hex: "#111111", rgb: [17,17,17] };
  const sameRgbDifferentId = { code: "TWIN", paletteId: "mard:H06", hex: "#111111", rgb: [17,17,17] };
  const target = { code: "NEW", paletteId: "mard:H07", hex: "#eeeeee", rgb: [238,238,238] };
  const grid = [[source, sameRgbDifferentId]];
  const bridge = {
    getResult: () => ({ grid, width: 2, height: 1, colors: [] }),
    getCell: (x, y) => grid[y]?.[x] || null,
    getPaletteColors: () => [source, sameRgbDifferentId, target],
    applyCellChanges(changes) { for (const { x, y, after } of changes) grid[y][x] = after; return changes.length; },
  };
  const editor = createEditorService(bridge);
  assert.equal(editor.getColorUsage("mard:H05"), 1);
  assert.equal(editor.replaceColor("mard:H05", "mard:H07"), true);
  assert.equal(grid[0][0].paletteId, "mard:H07");
  assert.equal(grid[0][1].paletteId, "mard:H06", "相同 RGB 但不同 paletteId 不应被替换");
  editor.undo();
  assert.equal(grid[0][0].paletteId, "mard:H05");
});

test("usage counts and inspected cell identity follow chained replace undo redo", () => {
  const A = { code: "A", paletteId: "mard:A", hex: "#111111", rgb: [17,17,17] };
  const B = { code: "B", paletteId: "mard:B", hex: "#222222", rgb: [34,34,34] };
  const C = { code: "C", paletteId: "mard:C", hex: "#333333", rgb: [51,51,51] };
  const grid = [[A, A, B]];
  let scans = 0;
  const bridge = {
    getResult() { scans++; return { grid, width: 3, height: 1, colors: [] }; },
    getCell: (x, y) => grid[y]?.[x] || null,
    getPaletteColors: () => [A, B, C],
    applyCellChanges(changes) { for (const { x, y, after } of changes) grid[y][x] = after; return changes.length; },
  };
  const editor = createEditorService(bridge);
  assert.deepEqual(editor.inspectCell(0, 0), { color: A, paletteId: "mard:A", count: 2 });
  const afterFirstCount = scans;
  assert.equal(editor.getColorUsage("mard:A"), 2);
  assert.equal(editor.getColorUsage("mard:B"), 1);
  assert.equal(scans, afterFirstCount, "重复读取颗数不应重新扫描网格");

  assert.equal(editor.replaceColor("mard:A", "mard:B"), true);
  assert.deepEqual([...editor.getPaletteUsageCounts()], [["mard:B", 3]]);
  assert.equal(editor.replaceColor("mard:B", "mard:C"), true);
  assert.deepEqual([...editor.getPaletteUsageCounts()], [["mard:C", 3]]);
  assert.equal(editor.undo(), true);
  assert.deepEqual([...editor.getPaletteUsageCounts()], [["mard:B", 3]]);
  assert.equal(editor.undo(), true);
  assert.deepEqual([...editor.getPaletteUsageCounts()], [["mard:A", 2], ["mard:B", 1]]);
  assert.equal(editor.redo(), true);
  assert.deepEqual([...editor.getPaletteUsageCounts()], [["mard:B", 3]]);
  assert.equal(editor.redo(), true);
  assert.deepEqual([...editor.getPaletteUsageCounts()], [["mard:C", 3]]);
});

test("region replace changes only selected cells and undoes as one action", () => {
  const { grid, editor } = fixture();
  assert.equal(editor.replaceColorInSelection("H07", "A03", { x0: 0, y0: 0, x1: 0, y1: 1 }), true);
  assert.equal(grid[0][0].code, "A03");
  assert.equal(grid[1][0].code, "A03");
  assert.equal(grid[0][1].code, "H07");
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  editor.undo();
  assert.equal(grid[0][0].code, "H07");
  assert.equal(grid[1][0].code, "H07");
});

test("history retains at most 100 actions", () => {
  const { editor } = fixture();
  for (let i = 0; i < 105; i++) editor.setCellColor(0, 0, i % 2 ? "H07" : "A03");
  assert.deepEqual(editor.historyDepth(), { undo: 100, redo: 0 });
});

test("brush stroke is one undo action and eraser stores actual empty cells", () => {
  const { grid, editor } = fixture();
  editor.beginStroke("A03"); editor.strokeCell(0,0); editor.strokeCell(1,0); editor.endStroke();
  assert.equal(grid[0][0].code,"A03"); assert.deepEqual(editor.historyDepth(),{undo:1,redo:0});
  editor.undo(); assert.equal(grid[0][0].code,"H07"); assert.equal(grid[0][1].code,"H07");
  editor.beginStroke(null); editor.strokeCell(0,0); editor.strokeCell(1,0); editor.endStroke();
  assert.equal(grid[0][0],null); assert.equal(editor.getColorUsage("H07"),1);
  editor.undo(); assert.equal(grid[0][0].code,"H07");
});

test("symmetry brush paints mirrored cells as one undoable action", () => {
  const { grid, editor } = fixture();
  editor.beginStroke("A03", { symmetry: { horizontal: true } });
  editor.strokeCell(0, 0);
  editor.endStroke();
  assert.equal(grid[0][0].code, "A03");
  assert.equal(grid[0][1].code, "A03");
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  editor.undo();
  assert.equal(grid[0][0].code, "H07");
  assert.equal(grid[0][1].code, "H07");
});

test("symmetry single-cell edit still repairs its mirror when the source already has the target color", () => {
  const { grid, editor } = fixture();
  assert.equal(editor.setCellColor(1, 1, "A03", { symmetry: { horizontal: true } }), true);
  assert.equal(grid[1][0].code, "A03");
  assert.equal(grid[1][1].code, "A03");
  editor.undo();
  assert.equal(grid[1][0].code, "H07");
  assert.equal(grid[1][1].code, "A03");
});

test("symmetry shape preview and committed shape use the same mirrored cells", () => {
  const { grid, editor } = fixture();
  const options = { symmetry: { horizontal: true } };
  assert.deepEqual(editor.previewShape("line", { x: 0, y: 0 }, { x: 0, y: 0 }, options), [{ x: 0, y: 0 }, { x: 1, y: 0 }]);
  editor.applyShape("line", { x: 0, y: 0 }, { x: 0, y: 0 }, "A03", options);
  assert.equal(grid[0][0].code, "A03");
  assert.equal(grid[0][1].code, "A03");
});

test("four-neighbor fill, outline and grid flip all undo from canonical diffs", () => {
  const { grid, editor } = fixture();
  editor.fillAt(0,0,"A03"); assert.equal(grid[0][1].code,"A03"); assert.equal(editor.historyDepth().undo,1);
  editor.undo(); assert.equal(grid[0][1].code,"H07");
  editor.outline({x0:0,y0:0,x1:0,y1:0},"A03"); assert.equal(grid[0][1].code,"A03");
  editor.undo(); assert.equal(grid[0][1].code,"H07");
  editor.flip("horizontal"); assert.equal(grid[1][0].code,"A03");
  editor.undo(); assert.equal(grid[1][0].code,"H07");
});

test("zoom around pointer preserves the same grid coordinate and slider round-trips", () => {
  const store = createProjectStore({ view: { zoom: 1, panX: 0, panY: 0 } });
  const viewport = createViewportService(store, () => ({ viewportWidth: 900, viewportHeight: 700, gridWidth: 104, gridHeight: 98 }));
  const point = viewport.gridToScreen(52,49), before = viewport.screenToGrid(point.x+2,point.y+2);
  viewport.zoomAroundPoint(4,point);
  assert.deepEqual(viewport.screenToGrid(point.x+2,point.y+2),before);
  viewport.zoomAroundPoint(1,point);
  assert.deepEqual(viewport.screenToGrid(point.x+2,point.y+2),before);
  assert.ok(Math.abs(sliderToZoom(zoomToSlider(2.5))-2.5)<0.08);
});

test("codes choose contrast on dark and light physical colors", () => {
  assert.equal(codeForegroundColor([17,17,17]), "#ffffff");
  assert.equal(codeForegroundColor([238,238,238]), "#17212b");
});
