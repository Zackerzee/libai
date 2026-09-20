import test from "node:test";
import assert from "node:assert/strict";
import { rgbToOKLab, oklabToRgb, enforceMaxPaletteColors } from "./region-aware-quantizer.mjs";
import { buildSourceFeatureMap } from "./structural-transition-analyzer.mjs";
import { generateRegionalBlockV2 } from "./regional-block-v2.mjs";

const width = 24, height = 24;
const palette = [
  { code: "A", rgb: [151, 105, 62] }, { code: "B", rgb: [155, 109, 65] },
  { code: "C", rgb: [159, 113, 68] }, { code: "D", rgb: [43, 54, 59] },
  { code: "E", rgb: [230, 192, 110] },
];

function makeFixture() {
  const source = Array.from({ length: width * height }, (_, i) => {
    const x = i % width, y = Math.floor(i / width);
    if (x === 11 || x === 12) return [45, 55, 60];
    if (y >= 18 && y <= 20) return [227, 190, 108];
    return [154 + (i % 3), 108 + (i % 3), 65 + (i % 3)];
  });
  const grid = Array.from({ length: height }, (_, y) => Array.from({ length: width }, (_, x) => x === 11 || x === 12 ? palette[3] : y >= 18 && y <= 20 ? palette[4] : palette[(x + y) % 3]));
  const features = buildSourceFeatureMap(source, width, height, rgbToOKLab);
  return { source, grid, features };
}

test("V2 is deterministic, respects global budget and lowers regional transition density", () => {
  const run = () => { const fixture = makeFixture(); return generateRegionalBlockV2(fixture.source, width, height, palette, fixture.features, fixture.grid, { rgbToOKLab, oklabToRgb, enforceMaxPaletteColors, maxColors: 4 }); };
  const first = run(), second = run();
  assert.deepEqual(first.grid.map((row) => row.map((color) => color?.code)), second.grid.map((row) => row.map((color) => color?.code)));
  assert.ok(first.report.after.colorCount <= 4);
  assert.ok(first.report.after.colorTransitionDensity < first.report.currentOnSameMacro.colorTransitionDensity);
  assert.ok(first.report.after.regionalFragmentationScore < first.report.currentOnSameMacro.regionalFragmentationScore);
});

test("source posterization precedes bead mapping and retains a dark structural stripe", () => {
  const fixture = makeFixture();
  const result = generateRegionalBlockV2(fixture.source, width, height, palette, fixture.features, fixture.grid, { rgbToOKLab, oklabToRgb, enforceMaxPaletteColors, maxColors: 5 });
  assert.ok(result.posterizedRgbGrid[10 * width + 11][0] < 90);
  assert.equal(result.grid[10][11].code, "D");
  assert.ok(result.localPalettes.size > 1);
});

test("contour lock remains unchanged under V2", () => {
  const fixture = makeFixture(); const lockedMask = new Uint8Array(width * height); lockedMask[0] = 1;
  const result = generateRegionalBlockV2(fixture.source, width, height, palette, fixture.features, fixture.grid, { rgbToOKLab, oklabToRgb, enforceMaxPaletteColors, maxColors: 5, lockedMask });
  assert.equal(result.grid[0][0].code, fixture.grid[0][0].code);
});
