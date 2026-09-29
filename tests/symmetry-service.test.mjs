import test from "node:test";
import assert from "node:assert/strict";
import { symmetryBrushCells, symmetryCells } from "../services/symmetry-service.js";

const ids = (cells) => cells.map(({ x, y }) => `${x},${y}`).sort();

test("未开启对称时保留原始格", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 1, y: 2 }], 5, 5)), ["1,2"]);
});

test("左右对称以画布中心线镜像并裁掉越界格", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 0, y: 1 }], 4, 3, { horizontal: true })), ["0,1", "3,1"]);
  assert.deepEqual(ids(symmetryCells([{ x: -1, y: 1 }], 4, 3, { horizontal: true })), []);
});

test("奇数画布中心格不会重复", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 2, y: 1 }], 5, 3, { horizontal: true })), ["2,1"]);
});

test("同时开启左右与上下对称时生成四象限格", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 0, y: 0 }], 4, 4, { horizontal: true, vertical: true })), ["0,0", "0,3", "3,0", "3,3"]);
});

test("支持显式半格对称轴", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 1, y: 1 }], 6, 4, { horizontal: true, axisX: 3 })), ["1,1", "5,1"]);
});

test("104×104 默认竖轴是 51.5，左右映射精确", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 12, y: 20 }], 104, 104, { mode: "vertical" })), ["12,20", "91,20"]);
});

test("horizontal、vertical 与 both 模式语义稳定", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 1, y: 2 }], 8, 6, { mode: "vertical" })), ["1,2", "6,2"]);
  assert.deepEqual(ids(symmetryCells([{ x: 1, y: 2 }], 8, 6, { mode: "horizontal" })), ["1,2", "1,3"]);
  assert.deepEqual(ids(symmetryCells([{ x: 1, y: 2 }], 8, 6, { mode: "both" })), ["1,2", "1,3", "6,2", "6,3"]);
});

test("自定义轴去重并裁剪越界点", () => {
  assert.deepEqual(ids(symmetryCells([{ x: 2, y: 1 }, { x: 4, y: 1 }], 7, 4, { mode: "vertical", axisX: 3 })), ["2,1", "4,1"]);
  assert.deepEqual(ids(symmetryCells([{ x: 6, y: 1 }], 7, 4, { mode: "vertical", axisX: 1 })), ["6,1"]);
});

test("对称笔刷先镜像中心再展开 3×3 footprint，并保证预览可共用", () => {
  const cells = symmetryBrushCells([{ x: 1, y: 3 }], 10, 8, { size: 3, symmetry: { mode: "vertical", axisX: 4.5 } });
  assert.equal(cells.length, 18);
  assert.ok(ids(cells).includes("0,2"));
  assert.ok(ids(cells).includes("9,4"));
});
