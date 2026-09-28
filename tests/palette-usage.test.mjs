import test from "node:test";
import assert from "node:assert/strict";
import { getPaletteUsageCounts, inspectPaletteCell } from "../services/palette-usage.js";

test("palette usage and inspection use paletteId, not equal RGB", () => {
  const first = { code: "H5", paletteId: "mard:H5", hex: "#111", rgb: [17,17,17] };
  const twin = { code: "H5", paletteId: "coco:H5", hex: "#111", rgb: [17,17,17] };
  const grid = [[first, first, twin, null]];
  const counts = getPaletteUsageCounts(grid);
  assert.deepEqual([...counts], [["mard:H5", 2], ["coco:H5", 1]]);
  assert.deepEqual(inspectPaletteCell(grid, 2, 0, counts), { color: twin, paletteId: "coco:H5", count: 1 });
  assert.equal(inspectPaletteCell(grid, 3, 0, counts), null);
  assert.equal(grid[0][0], first, "识别与统计不应修改网格");
});
