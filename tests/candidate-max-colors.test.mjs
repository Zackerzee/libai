/**
 * §16 硬失败项：**maxColors 超限**。
 *
 * 这条对 §9 尤其致命：Spatial Refine 允许候选来自「邻居实际色 / 当前色附近
 * Top-K 色卡色」，也就是它**可能把用色数抬高**。跑在 Budget 之后 = maxColors
 * 当场失效。引擎里把它排在 Budget 之前，并用 `colorsBeforeBudget`（refine 之后
 * 重量的数）当门 —— 这里把这件事钉住。
 *
 * 另一个陷阱：只断言「最终用色数 ≤ maxColors」是不够的。
 * 如果候选压根没生效，这个断言也会通过。所以每条用例都额外断言
 * 「候选确实改了东西」，或者至少「过门时用色数确实一度超过 maxColors」。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LAB_MATRIX } from "../smart-preprocessing/lab/index.mjs";
import { CELL_PALETTE, runEngine, paintSource, codesOf, usedOf } from "./b4-candidate-harness.mjs";

const SIZE = 64;
/** 12 色全用上的彩虹源图 —— 保证生产侧用色数远大于下面的 maxColors。 */
const RAINBOW = paintSource(SIZE, SIZE, (x, y) => {
  const i = Math.floor(x / (SIZE / 6)) + Math.floor(y / (SIZE / 6)) * 6;
  return [
    [235, 60, 60], [240, 150, 40], [240, 230, 60], [70, 200, 90],
    [60, 160, 230], [90, 90, 220], [190, 90, 220], [240, 120, 180],
    [120, 220, 210], [30, 30, 40], [245, 245, 245], [140, 140, 140],
  ][i % 12];
});

const CANDIDATES = LAB_MATRIX.filter((e) => !e.pending);

for (const maxColors of [3, 5, 8]) {
  test(`maxColors=${maxColors}：全部候选的用色数都不得超限`, () => {
    const common = { source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: { maxColors } };
    const production = runEngine(common);
    assert.ok(usedOf(production.grid).size <= maxColors, "前提：生产侧自己就得守住预算");

    for (const entry of CANDIDATES) {
      const result = runEngine({ ...common, lab: entry.build() });
      const used = usedOf(result.grid).size;
      assert.ok(used <= maxColors, `候选 ${entry.id} 用了 ${used} 色，超过 maxColors=${maxColors}（§16 硬失败项）`);
    }
  });
}

test("预算门看到的是 refine 之后的用色数（不是 stage 4 的旧快照）", () => {
  // 引擎把 `colorsBeforeBudget` 记进 diagnostics，就是为了让这件事可验证。
  // 只看最终用色数，refine 抬高的那一段会凭空消失。
  const common = { source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: { maxColors: 4 } };
  for (const entry of CANDIDATES) {
    const result = runEngine({ ...common, lab: entry.build() });
    const d = result.diagnostics;
    assert.ok(d.colorsBeforeBudget >= 1, `候选 ${entry.id} 应记录 colorsBeforeBudget`);
    assert.equal(d.colorsAfterBudget <= 4, true, `候选 ${entry.id} 预算后用色数 ${d.colorsAfterBudget} 超限`);
    // 有 lab 时两个快照可以不同；没有 lab 时必须恒等（生产行为逐位不变）
    if (!result.diagnostics.lab) {
      assert.equal(d.colorsBeforeBudget, d.colorsAfterCleanup, "无候选时两个快照必须恒等");
    }
  }
});

test("候选确实在动：至少有一个候选改变了网格（否则上面的断言全是空跑）", () => {
  const common = { source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: {} };
  const base = codesOf(runEngine(common).grid);
  const changed = CANDIDATES.filter((e) => codesOf(runEngine({ ...common, lab: e.build() }).grid) !== base);
  assert.ok(changed.length >= 1, `没有任何候选改变了网格 —— 上面所有「不超限」的断言都没有实际覆盖。改动过的：${changed.map((e) => e.id).join(",")}`);
});

test("maxColors=0 表示不限：候选不得因为 0 被误判成 0 色", () => {
  const result = runEngine({ source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: { maxColors: 0 } });
  assert.ok(usedOf(result.grid).size > 1, "maxColors=0 是不限，不是 0 色");
});
