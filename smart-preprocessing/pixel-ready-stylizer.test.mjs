import assert from "node:assert/strict";
import test from "node:test";
import { calculatePixelSurvivalMap, stylizePixelReady } from "./pixel-ready-stylizer.mjs";

test("none mode is an exact deterministic pass-through", () => {
  const pixels = new Uint8ClampedArray([20, 30, 40, 255, 200, 180, 160, 255]);
  assert.deepEqual([...stylizePixelReady(pixels, 2, 1, { mode: "none" }).pixels], [...pixels]);
});

test("pixel survival favors a high contrast landmark", () => {
  const pixels = new Uint8ClampedArray(3 * 3 * 4);
  for (let i = 0; i < 9; i += 1) pixels.set(i === 4 ? [0, 0, 0, 255] : [220, 220, 220, 255], i * 4);
  assert.ok(calculatePixelSurvivalMap(pixels, 3, 3, 2, 2)[4] > 0.8);
});

test("stylization preserves alpha and dimensions", () => {
  const pixels = new Uint8ClampedArray([120, 80, 60, 255, 122, 81, 61, 0]);
  const result = stylizePixelReady(pixels, 2, 1, { strength: 35 });
  assert.equal(result.pixels.length, pixels.length);
  assert.equal(result.pixels[7], 0);
});
