import assert from "node:assert/strict";
import test from "node:test";
import { analyzeComponents, createPatternOptimizer, scorePattern } from "./pattern-optimizer.mjs";

const color = (code, rgb = [10, 10, 10]) => ({ code, hex: "#000000", rgb });

test("finds same-color connected components", () => {
  const grid = [[color("A"), color("A"), color("B")], [color("B"), color("A"), color("B")]];
  const sizes = analyzeComponents(grid).map((item) => item.size).sort((a, b) => a - b);
  assert.deepEqual(sizes, [1, 2, 3]);
});

test("fills a conservative single hole", () => {
  const a = color("A", [20, 20, 20]);
  const grid = [[a, a, a], [a, null, a], [a, a, a]];
  const result = createPatternOptimizer().optimize(grid);
  assert.equal(result.changed, true);
  assert.equal(result.grid[1][1].code, "A");
});

test("does not over-clean a stable matrix", () => {
  const a = color("A", [20, 20, 20]);
  const grid = [[a, a], [a, a]];
  const result = createPatternOptimizer().optimize(grid);
  assert.equal(result.changed, false);
  assert.equal(scorePattern(result.grid).isolated, 0);
});

test("returns a deterministic candidate report", () => {
  const a = color("A", [20, 20, 20]);
  const b = color("B", [25, 25, 25]);
  const grid = [[a, b], [b, a]];
  const first = createPatternOptimizer().optimize(grid);
  const second = createPatternOptimizer().optimize(grid);
  assert.deepEqual(first.candidates, second.candidates);
});

test("does not replace a protected isolated dark detail", () => {
  const light = color("L", [230, 230, 230]);
  const dark = color("D", [10, 10, 10]);
  const grid = [[light, light, light], [light, dark, light], [light, light, light]];
  const protectionMask = new Uint8Array(9); protectionMask[4] = 1;
  const result = createPatternOptimizer().optimize(grid, { protectionMask });
  assert.equal(result.grid[1][1].code, "D");
});

test("block cleanup zero preserves the input", () => {
  const a = color("A"); const b = color("B", [12, 12, 12]);
  const grid = [[a, a, a], [a, b, a], [a, a, a]];
  assert.equal(createPatternOptimizer().optimize(grid, { cleanupStrength: 0 }).changed, false);
});
