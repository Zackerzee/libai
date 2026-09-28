import test from "node:test";
import assert from "node:assert/strict";
import { symmetryCells } from "../services/symmetry-service.js";

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
