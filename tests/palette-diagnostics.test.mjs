import test from "node:test";
import assert from "node:assert/strict";
import { getPaletteIndex } from "../services/palette-usage.js";
import { findSimilarPaletteColors, detectRarePaletteColors } from "../services/palette-diagnostics.js";

const palette = [
  { code: "A", paletteId: "brand:A", rgb: [20, 20, 20] },
  { code: "B", paletteId: "brand:B", rgb: [24, 24, 24] },
  { code: "C", paletteId: "brand:C", rgb: [240, 240, 240] },
  { code: "D", paletteId: "brand:D", rgb: [24, 24, 24] },
];

test("similar palette colors exclude self, use real entries and sort stably", () => {
  const first = findSimilarPaletteColors(palette, "brand:A", { limit: 3 });
  const second = findSimilarPaletteColors(palette, "brand:A", { limit: 3 });
  assert.deepEqual(first.map((color) => color.paletteId), ["brand:B", "brand:D", "brand:C"]);
  assert.deepEqual(second.map((color) => color.paletteId), first.map((color) => color.paletteId));
  assert.ok(first.every((color) => palette.some((real) => real.paletteId === color.paletteId)));
  assert.ok(first.every((color) => color.paletteId !== "brand:A"));
});

test("rare palette diagnostics respect threshold and retain cell coordinates", () => {
  const grid = [[palette[0], palette[0], palette[1]], [palette[0], palette[2], palette[3]]];
  const before = grid.map((row) => [...row]);
  const rare = detectRarePaletteColors(getPaletteIndex(grid), { maxCount: 1 });
  assert.deepEqual(rare.map(({ paletteId, count }) => ({ paletteId, count })), [
    { paletteId: "brand:B", count: 1 }, { paletteId: "brand:C", count: 1 }, { paletteId: "brand:D", count: 1 },
  ]);
  assert.deepEqual(rare[0].cells, [{ x: 2, y: 0 }]);
  assert.equal(detectRarePaletteColors(getPaletteIndex(grid), { maxCount: 3 }).length, 4);
  assert.deepEqual(grid, before, "诊断和点击所依赖的数据查询不能修改 grid");
});
