import assert from "node:assert/strict";
import test from "node:test";
import { applySkinToneRemap, buildSkinMask, cleanupNeutralColors, compressDarkRegions, enhanceWarmReds } from "./portrait-preprocessor.mjs";
import { buildDetailProtectionMask, buildEdgeImportanceMap } from "./structure-analyzer.mjs";

const pixel = (r, g, b) => new Uint8ClampedArray([r, g, b, 255]);

test("zero-strength portrait operations are exact no-ops", () => {
  const source = pixel(156, 105, 82); const mask = new Float32Array([1]);
  assert.deepEqual([...applySkinToneRemap(source, mask, 0)], [...source]);
  assert.deepEqual([...cleanupNeutralColors(source, 0)], [...source]);
  assert.deepEqual([...compressDarkRegions(source, 0)], [...source]);
  assert.deepEqual([...enhanceWarmReds(source, mask, 0)], [...source]);
});

test("skin mask is soft and favors plausible skin over blue", () => {
  const source = new Uint8ClampedArray([190, 132, 104, 255, 50, 95, 190, 255]);
  const mask = buildSkinMask(source, 2, 1);
  assert.ok(mask[0] > mask[1]);
  assert.ok(mask[0] > 0 && mask[0] < 1);
});

test("skin remap lifts midtone while retaining channel warmth", () => {
  const source = pixel(142, 94, 72);
  const result = applySkinToneRemap(source, new Float32Array([1]), 35);
  assert.ok(result[0] > source[0] && result[0] > result[1] && result[1] > result[2]);
});

test("edge and dark/highlight details are protected", () => {
  const source = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < 9; i += 1) source.set(i === 4 ? [5, 5, 5, 255] : [230, 230, 230, 255], i * 4);
  const edges = buildEdgeImportanceMap(source, 3, 3);
  const mask = buildDetailProtectionMask(edges, source, 3, 3);
  assert.equal(mask[4], 1);
});
