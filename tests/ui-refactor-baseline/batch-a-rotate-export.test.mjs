import test from "node:test";
import assert from "node:assert/strict";
import { createEditorService, rotateGrid } from "../../services/editor-service.js";
import { createExportService } from "../../services/export-service.js";
import { createProjectStore } from "../../state/project-store.js";

const A = { code: "A", hex: "#111111", rgb: [17, 17, 17] };
const B = { code: "B", hex: "#eeeeee", rgb: [238, 238, 238] };

// 2 行 × 3 列，便于同时验证「矩阵内容」与「宽高互换」两件事。
function structuralFixture() {
  let grid = [[A, B, B], [A, B, B]];
  let width = 3, height = 2;
  const bridge = {
    getResult: () => ({ grid, width, height, colors: [] }),
    getCell: (x, y) => grid[y]?.[x] || null,
    getPaletteColors: () => [A, B],
    applyCellChanges(changes) {
      let count = 0;
      for (const { x, y, after } of changes) {
        if (!grid[y] || x < 0 || x >= grid[y].length) continue;
        if (grid[y][x]?.code === after?.code) continue;
        grid[y][x] = after; count += 1;
      }
      return count;
    },
    replaceGridStructure({ grid: next, width: w, height: h }) {
      if (!Array.isArray(next) || next.length !== h || next.some((row) => row.length !== w)) return false;
      grid = next.map((row) => [...row]); width = w; height = h;
      return true;
    },
  };
  return { bridge, editor: createEditorService(bridge), read: () => ({ grid, width, height }) };
}

const codes = ({ grid }) => grid.map((row) => row.map((cell) => cell?.code ?? null));

test("rotateGrid turns clockwise and swaps width/height only on odd turns", () => {
  const source = [[A, B, B], [A, B, B]];
  // 顺时针：左列 (A,A) 转成顶行。
  assert.deepEqual(rotateGrid(source, 1).map((row) => row.map((c) => c.code)), [["A", "A"], ["B", "B"], ["B", "B"]]);
  // 逆时针：左列转成底行。
  assert.deepEqual(rotateGrid(source, 3).map((row) => row.map((c) => c.code)), [["B", "B"], ["B", "B"], ["A", "A"]]);
  // 180°：宽高不变。
  assert.deepEqual(rotateGrid(source, 2).map((row) => row.map((c) => c.code)), [["B", "B", "A"], ["B", "B", "A"]]);
  // 输入矩阵不得被就地修改。
  assert.deepEqual(source.map((row) => row.map((c) => c.code)), [["A", "B", "B"], ["A", "B", "B"]]);
});

test("four quarter turns return to the original matrix and size", () => {
  let grid = [[A, B, B], [A, B, B]];
  for (let turn = 0; turn < 4; turn += 1) grid = rotateGrid(grid, 1);
  assert.deepEqual(grid.map((row) => row.map((c) => c.code)), [["A", "B", "B"], ["A", "B", "B"]]);
});

test("clockwise rotate swaps canvas size and one undo restores both grid and size", () => {
  const { editor, read } = structuralFixture();
  assert.equal(editor.canRotate(), true);
  assert.equal(editor.rotate(1), true);
  assert.deepEqual(read(), { grid: [["A", "A"], ["B", "B"], ["B", "B"]].map((row) => row.map((code) => (code === "A" ? A : B))), width: 2, height: 3 });
  assert.equal(editor.canUndo(), true);
  assert.equal(editor.undo(), true);
  const restored = read();
  assert.equal(restored.width, 3); assert.equal(restored.height, 2);
  assert.deepEqual(codes(restored), [["A", "B", "B"], ["A", "B", "B"]]);
  assert.equal(editor.redo(), true);
  assert.deepEqual({ width: read().width, height: read().height }, { width: 2, height: 3 });
});

test("a size-changing rotate drops cell history recorded under the old size but keeps the rotate itself", () => {
  const { editor, read } = structuralFixture();
  assert.equal(editor.setCellColor(2, 0, "A"), true);
  assert.equal(read().grid[0][2].code, "A");
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  assert.equal(editor.rotate(1), true);
  // 旧宽高下的豆格动作坐标已不可信：只剩结构级动作可撤销。
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
});

test("180 degree rotate keeps cell history because the canvas size is unchanged", () => {
  const { editor } = structuralFixture();
  assert.equal(editor.setCellColor(2, 0, "A"), true);
  assert.equal(editor.rotate(2), true);
  assert.deepEqual(editor.historyDepth(), { undo: 2, redo: 0 });
});

test("rotate refuses to run when the bridge cannot replace the whole grid", () => {
  const grid = [[A, B]];
  const bridge = {
    getResult: () => ({ grid, width: 2, height: 1, colors: [] }),
    getCell: (x, y) => grid[y]?.[x] || null,
    getPaletteColors: () => [A, B],
    applyCellChanges() { return 0; },
  };
  const editor = createEditorService(bridge);
  assert.equal(editor.canRotate(), false);
  assert.equal(editor.rotate(1), false);
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 0 });
});

test("export service exposes JPG, CSV and project JSON only when the bridge supports them", async () => {
  const cells = [[A, B]];
  const bridge = {
    downloadPreview: () => "preview",
    downloadPattern: (options) => ({ options }),
    downloadPatternJpg: (settings) => ({ jpg: settings }),
    downloadUsageCsv: () => "csv",
    downloadProjectJson: () => "json",
  };
  const store = createProjectStore({ status: { hasPattern: true } });
  const exporter = createExportService(bridge, store);
  assert.deepEqual(await exporter.export("pattern-jpg"), { jpg: store.getState().exportSettings.pattern });
  assert.equal(await exporter.export("usage-csv"), "csv");
  assert.equal(await exporter.export("project-json"), "json");
  assert.deepEqual(await exporter.export("pattern-png"), { options: { split: false, settings: store.getState().exportSettings.pattern } });
  assert.equal(exporter.isAvailable("pattern-jpg"), true);

  const bare = createExportService({ downloadPreview() {}, downloadPattern() {} }, store);
  assert.equal(bare.isAvailable("pattern-jpg"), false);
  assert.equal(bare.isAvailable("usage-csv"), false);
  assert.equal(bare.isAvailable("project-json"), false);
  await assert.rejects(bare.export("pattern-jpg"), /当前不支持/);
});

test("export service refuses every format before a pattern exists", async () => {
  const store = createProjectStore({ canvas: { width: 2, height: 1 } });
  const exporter = createExportService({ downloadPreview: () => "preview", downloadPatternJpg: () => "jpg" }, store);
  assert.equal(exporter.isAvailable("pattern-jpg"), false);
  await assert.rejects(exporter.export("pattern-jpg"), /请先生成图纸/);
});

test("reference overlay defaults keep the tracing base image off until the user adds one", () => {
  const reference = createProjectStore().getState().reference;
  assert.deepEqual(reference, { url:"",opacity:40,fit:"contain",visible:false,useSource:false,offsetX:0,offsetY:0,scale:1,smoothing:"smooth",displayMode:"normal",adjusting:false });
});
