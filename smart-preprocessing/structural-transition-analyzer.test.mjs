import test from "node:test";
import assert from "node:assert/strict";
import { rgbToOKLab } from "./region-aware-quantizer.mjs";
import { buildSourceFeatureMap, detectStructuralTransitions } from "./structural-transition-analyzer.mjs";

const width = 9, height = 9;
const base = { code: "A", rgb: [120, 82, 52] };
const stray = { code: "B", rgb: [178, 118, 71] };
const eye = { code: "EYE", rgb: [15, 15, 18] };

function fixture(sourceChanges = [], beadChanges = []) {
  const source = Array.from({ length: width * height }, () => base.rgb);
  const matrix = Array.from({ length: width * height }, () => base);
  sourceChanges.forEach(([index, rgb]) => { source[index] = rgb; });
  beadChanges.forEach(([index, color]) => { matrix[index] = color; });
  const features = buildSourceFeatureMap(source, width, height, rgbToOKLab);
  return { source, features, grid: Array.from({ length: height }, (_, y) => matrix.slice(y * width, (y + 1) * width)) };
}

test("one and two bead artifacts on flat source are detected without modifying the matrix", () => {
  const { grid, features } = fixture([], [[40, stray], [20, stray], [21, stray]]);
  const originalCodes = grid.flat().map((item) => item.code);
  const result = detectStructuralTransitions(grid, features, rgbToOKLab);
  assert.equal(result.mode, "detection-only");
  assert.ok(result.metrics.unsupportedTransitionCount > 0);
  assert.equal(result.metrics.unsupportedIslandCount, 2);
  assert.deepEqual(grid.flat().map((item) => item.code), originalCodes);
});

test("real high contrast single bead detail and two bead highlight are protected", () => {
  const { grid, features } = fixture([[40, eye.rgb], [20, stray.rgb], [21, stray.rgb]], [[40, eye], [20, stray], [21, stray]]);
  const result = detectStructuralTransitions(grid, features, rgbToOKLab);
  assert.equal(result.metrics.unsupportedIslandCount, 0);
  assert.equal(result.suspectedArtifacts.some((component) => component.code === "EYE"), false);
  assert.equal(result.suspectedArtifacts.some((component) => component.code === "B"), false);
});

test("orientation and texture maps come from source, not bead codes", () => {
  const source = Array.from({ length: width * height }, (_, i) => Math.floor(i / width) % 2 ? [150, 90, 58] : base.rgb);
  const features = buildSourceFeatureMap(source, width, height, rgbToOKLab);
  assert.ok(features.sourceTextureMap[40] > 0);
  assert.ok(Number.isFinite(features.sourceOrientationMap[40]));
});
