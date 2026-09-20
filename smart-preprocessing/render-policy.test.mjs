import assert from "node:assert/strict";
import test from "node:test";
import { RENDER_PRESETS, shouldShowBeadCode } from "./render-policy.mjs";

test("clean preview and preview export never show codes or fine grid", () => {
  for (const name of ["PREVIEW_CLEAN", "PREVIEW_EXPORT"]) {
    assert.equal(RENDER_PRESETS[name].showCodes, false);
    assert.equal(RENDER_PRESETS[name].showGrid, false);
    assert.equal(RENDER_PRESETS[name].showCoordinates, false);
  }
});

test("pattern export retains codes, grid, coordinates and legend", () => {
  assert.deepEqual(
    [RENDER_PRESETS.PATTERN_EXPORT.showCodes, RENDER_PRESETS.PATTERN_EXPORT.showGrid, RENDER_PRESETS.PATTERN_EXPORT.showCoordinates, RENDER_PRESETS.PATTERN_EXPORT.showLegend],
    [true, true, true, true],
  );
});

test("code visibility follows actual displayed cell size", () => {
  assert.equal(shouldShowBeadCode(1, 8), false);
  assert.equal(shouldShowBeadCode(1.7, 8), false);
  assert.equal(shouldShowBeadCode(1.75, 8), true);
  assert.equal(shouldShowBeadCode(1, 14), true);
});
