import test from "node:test";
import assert from "node:assert/strict";
import { composeLockedTextGrid } from "../services/text-layer-service.js";

test("only locked text layers are composed into an export copy, preserving the editable base grid", () => {
  const baseColor = { code: "A01", paletteId: "mard:A01", rgb: [255, 255, 255] };
  const textColor = { code: "F05", paletteId: "mard:F05", rgb: [240, 20, 40] };
  const base = [[baseColor, null], [null, null]];
  const original = base.map((row) => row.slice());
  const layers = [
    { id: "locked", locked: true, paletteId: "mard:F05", paint: [{ role: "text", color: "#f01428", cells: [{ x: 1, y: 0 }] }] },
    { id: "editable", locked: false, paint: [{ role: "text", color: "#f01428", cells: [{ x: 0, y: 1 }] }] },
  ];
  const result = composeLockedTextGrid(base, layers, [baseColor, textColor], {
    rasterize: (layer) => ({ cells: layer.paint.flatMap((paint) => paint.cells), paintLayers: layer.paint }),
  });
  assert.equal(result[0][1], textColor);
  assert.equal(result[1][0], null);
  assert.equal(result[0][0], baseColor);
  assert.deepEqual(base, original, "export composition must never alter the source grid");
});

test("locked style paint layers resolve colors only to legal palette entries", () => {
  const palette = [{ code: "F05", paletteId: "mard:F05", rgb: [240, 20, 40] }];
  const layer = { locked: true, paletteId: "mard:F05", paint: [
    { role: "shadow", color: "#ef1429", cells: [{ x: 0, y: 0 }] },
    { role: "text", color: "#f01428", cells: [{ x: 1, y: 0 }] },
  ] };
  const grid = composeLockedTextGrid([[null, null]], [layer], palette, {
    rasterize: (item) => ({ cells: item.paint.flatMap((paint) => paint.cells), paintLayers: item.paint }),
  });
  assert.deepEqual(grid[0], [palette[0], palette[0]]);
});
