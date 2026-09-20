import assert from "node:assert/strict";
import test from "node:test";
import { calculatePatternQualityMetrics } from "./pattern-quality.mjs";

const a = { code: "A", rgb: [20, 20, 20] };
const b = { code: "B", rgb: [220, 170, 140] };
test("quality metrics report colors, components and protected preservation", () => {
  const grid = [[a, a], [null, b]];
  const result = calculatePatternQualityMetrics(grid, { baseline: grid, protectedMask: new Uint8Array([1, 0, 0, 1]) });
  assert.equal(result.usedColorCount, 2);
  assert.equal(result.singletonComponentCount, 1);
  assert.equal(result.edgePreservationRatio, 1);
});
