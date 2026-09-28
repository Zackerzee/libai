import test from "node:test";
import assert from "node:assert/strict";
import { navigatorLayout, visibleGridRect } from "../ui/navigator.js";

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
