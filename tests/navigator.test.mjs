import test from "node:test";
import assert from "node:assert/strict";
import { createNavigatorThumbnailCache, navigatorLayout, visibleGridRect } from "../ui/navigator.js";

test("navigator keeps the full pattern centered and proportional", () => {
  assert.deepEqual(navigatorLayout(100, 50, 220, 120, 10), { x: 10, y: 10, width: 200, height: 100, scale: 2 });
  assert.deepEqual(navigatorLayout(50, 100, 120, 220, 10), { x: 10, y: 10, width: 100, height: 200, scale: 2 });
});

test("visible rect covers the full grid after fit-like zoom", () => {
  assert.deepEqual(visibleGridRect({ zoom: 0.5, panX: 0, panY: 0 }, 1000, 600, 80, 40), { x: 0, y: 0, width: 80, height: 40 });
});

test("visible rect follows pan and clips to pattern bounds", () => {
  assert.deepEqual(visibleGridRect({ zoom: 1, panX: -100, panY: 0 }, 200, 200, 20, 20), { x: 10, y: 5, width: 10, height: 10 });
});

test("navigator thumbnail cache rasterizes only when canonical grid revision changes", () => {
  const calls = [];
  const cache = createNavigatorThumbnailCache((grid) => { calls.push(grid); return { grid }; });
  const canonicalGrid = [[{ paletteId: "brand:A01" }]];
  assert.equal(cache.get("7:1x1:200x120", canonicalGrid).grid, canonicalGrid);
  cache.get("7:1x1:200x120", canonicalGrid, { panX: 999 });
  assert.equal(cache.renderCount, 1, "pan/zoom 不应重新栅格化缩略图");
  cache.get("8:1x1:200x120", canonicalGrid);
  assert.equal(cache.renderCount, 2, "canonical grid revision 改变后必须刷新");
  assert.equal(calls[0], canonicalGrid);
});
