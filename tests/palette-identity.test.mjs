import test from "node:test";
import assert from "node:assert/strict";
import { paletteIdOf, samePaletteColor } from "../services/palette-identity.js";

test("paletteId is the primary color identity", () => {
  assert.equal(paletteIdOf({ paletteId: "mard:H05", code: "H5", rgb: [1,2,3] }), "mard:H05");
  assert.equal(samePaletteColor(
    { paletteId: "mard:H05", rgb: [1,2,3] },
    { paletteId: "mard:H06", rgb: [1,2,3] },
  ), false);
});

test("legacy colors fall back to code, never RGB", () => {
  assert.equal(paletteIdOf({ code: "H05", rgb: [1,2,3] }), "H05");
  assert.equal(samePaletteColor({ code: "H05", rgb: [1,2,3] }, { code: "H05", rgb: [9,9,9] }), true);
});
