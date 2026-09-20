import test from "node:test";
import assert from "node:assert/strict";
import { createPaletteEngine, deltaE2000, rgbToLab, skinToneScore } from "./palette-engine.mjs";

const palette = [
  { code: "BLACK", rgb: [0, 0, 0] },
  { code: "WHITE", rgb: [255, 255, 255] },
  { code: "SKIN", rgb: [242, 185, 150] },
  { code: "PINK", rgb: [238, 120, 145] },
  { code: "GREEN", rgb: [40, 150, 80] },
];

test("Lab conversion and CIEDE2000 are deterministic", () => {
  assert.deepEqual(rgbToLab([255, 255, 255]).map((value) => {
    const rounded = Math.round(value * 1000) / 1000;
    return Object.is(rounded, -0) ? 0 : rounded;
  }), [100, 0, 0]);
  assert.equal(deltaE2000([50, 2.6772, -79.7751], [50, 0, -82.7485]).toFixed(4), "2.0425");
});

test("context correction protects warm skin candidates", () => {
  const engine = createPaletteEngine(palette);
  assert.equal(engine.match([236, 180, 144], { region: "skin", importance: 1 }).code, "SKIN");
  assert.ok(skinToneScore([236, 180, 144]) > 0.5);
});

test("cache returns stable results", () => {
  const engine = createPaletteEngine(palette);
  const first = engine.match([238, 180, 150]);
  const second = engine.match([238, 180, 150]);
  assert.equal(first.code, second.code);
  assert.equal(engine.getReport().cacheHitRate, 0.5);
});

test("palette graph reduction keeps protected colors", () => {
  const engine = createPaletteEngine(palette);
  const grid = [[palette[0], palette[1], palette[2], palette[3], palette[4]]];
  const result = engine.reduceGrid(grid, { maxColors: 3, protectedCodes: ["SKIN"] });
  assert.equal(new Set(result.grid[0].map((color) => color.code)).size, 3);
  assert.ok(result.grid[0].some((color) => color.code === "SKIN"));
});
