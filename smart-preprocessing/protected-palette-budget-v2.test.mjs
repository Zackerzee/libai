import test from "node:test";
import assert from "node:assert/strict";
import { buildPaletteBudgetPlan, countGridColors, applyBudgetPlan } from "./protected-palette-budget-v2.mjs";

const A = { code: "A", rgb: [255, 255, 255] }; // 大背景 20 cells
const B = { code: "B", rgb: [200, 200, 200] }; // 高光 1 cell (高保护)
const C = { code: "C", rgb: [20, 20, 20] }; // 瞳孔 1 cell (高保护)
const D = { code: "D", rgb: [200, 60, 60] }; // 低频低保护
const E = { code: "E", rgb: [60, 200, 60] }; // 低频低保护
const F = { code: "F", rgb: [60, 60, 200] }; // 低频低保护

const colorMap = { A, B, C, D, E, F };
const getColorKey = (cell) => cell.code;

function buildGrid() {
  // 5x5: A 填满，四角 B/C/D/E + 一个 F
  const grid = Array.from({ length: 5 }, () => Array.from({ length: 5 }, () => ({ ...A })));
  grid[0][0] = { ...B };
  grid[0][4] = { ...C };
  grid[4][0] = { ...D };
  grid[4][4] = { ...E };
  grid[2][2] = { ...F };
  return grid;
}

test("maxColors=0 skips budget entirely (AUTO does not force color cap)", () => {
  const grid = buildGrid();
  const plan = buildPaletteBudgetPlan({ grid, getColorKey, maxColors: 0 });
  assert.deepEqual(plan, []);
});

test("budget prefers merging low-protection colors over rare protected colors", () => {
  const grid = buildGrid();
  // B/C 高保护（critical tier），D/E/F 低保护（none）
  const tierMap = new Uint8Array(25);
  tierMap[0] = 4; // B at (0,0) critical
  tierMap[4] = 4; // C at (0,4) critical
  // D(4,0)=idx20, E(4,4)=idx24, F(2,2)=idx12 -> 0

  const plan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey: (k) => colorMap[k].rgb, maxColors: 4, tierMap });
  // 6 色 -> 4 色，需合并 2 色
  assert.equal(plan.length, 2);
  const merged = plan.map((p) => p.from);
  assert.ok(!merged.includes("B"), "protected B (highlight) must not be merged first");
  assert.ok(!merged.includes("C"), "protected C (pupil) must not be merged first");
  // 合并的都是低保护色
  for (const from of merged) assert.ok(["D", "E", "F"].includes(from), `merged ${from} but expected D/E/F`);
});

test("forcedProtected merge only happens when low-protection colors are exhausted", () => {
  // 全部 6 色都 critical -> 必须触碰 critical（forcedProtected=true）
  const grid = buildGrid();
  const tierMap = new Uint8Array(25).fill(4);
  const plan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey: (k) => colorMap[k].rgb, maxColors: 4, tierMap });
  assert.equal(plan.length, 2);
  for (const p of plan) assert.equal(p.forcedProtected, true);
});

test("countGridColors counts by color key", () => {
  const grid = buildGrid();
  const usage = countGridColors(grid, getColorKey);
  assert.equal(usage.get("A"), 20);
  assert.equal(usage.get("B"), 1);
  assert.equal(usage.size, 6);
});

test("applyBudgetPlan rewrites cells in place", () => {
  const grid = buildGrid();
  const plan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey: (k) => colorMap[k].rgb, maxColors: 5 });
  applyBudgetPlan(grid, getColorKey, plan, (k) => colorMap[k]);
  const after = countGridColors(grid, getColorKey);
  assert.equal(after.size, 5);
});
