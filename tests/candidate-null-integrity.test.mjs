/**
 * §16 硬失败项：**null 被填色**。
 *
 * 这一条对候选算法的杀伤力比对生产大得多：
 *   · §9 Spatial Refine 遍历网格，很容易顺手把空格当成一个「可以优化的格子」
 *   · §10 Cleanup 挑替换色时，「空格」在某些写法下会被当成一个颜色键
 *   · §6/§7/§8 的分桶如果不看 alpha，透明像素会被算进 Lab 均值
 *
 * 三种失效形状都**不报错**：网格看起来只是「多了一块颜色」。
 * 所以这里对 **LAB_MATRIX 里每一个候选**跑同一批透明源图，逐位比对空格位置。
 *
 * 用 `nullSignature`（位置签名）而不是 `nullCells`（计数）是刻意的：
 * 一填一空也能让计数不变，那是个永远通过的断言。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LAB_MATRIX } from "../smart-preprocessing/lab/index.mjs";
import { CELL_PALETTE, runEngine, paintSource, nullSignature, filledCount } from "./b4-candidate-harness.mjs";

const SIZE = 48;

/** 三种「透明」形状：整块透明 / 半张透明 / 稀疏透明的洞。 */
const SOURCES = {
  "全透明": paintSource(SIZE, SIZE, () => [0, 0, 0, 0]),
  "下半透明": paintSource(SIZE, SIZE, (x, y) => (y < SIZE / 2 ? [200, 160, 140] : [200, 160, 140, 0])),
  "棋盘洞": paintSource(SIZE, SIZE, (x, y) => (((Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0) ? [90, 140, 190] : [90, 140, 190, 0])),
  "中间挖空": paintSource(SIZE, SIZE, (x, y) => {
    const dx = x - SIZE / 2;
    const dy = y - SIZE / 2;
    return dx * dx + dy * dy < 100 ? [0, 0, 0, 0] : [220, 200, 120];
  }),
};

const CANDIDATES = LAB_MATRIX.filter((e) => !e.pending);

test("候选矩阵非空（否则下面所有用例都是空跑）", () => {
  assert.ok(CANDIDATES.length >= 10, `可跑候选应至少 10 个，实测 ${CANDIDATES.length}`);
  for (const entry of CANDIDATES) assert.equal(typeof entry.build, "function");
});

for (const [name, source] of Object.entries(SOURCES)) {
  test(`null 完整性：${name} —— 全部候选的空格位置必须与生产逐位一致`, () => {
    const common = { source, width: 8, height: 8, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
    const production = runEngine(common);
    const expected = nullSignature(production.grid);
    const expectedFilled = filledCount(production.grid);
    assert.ok(expected.includes("X"), `夹具必须真的有空格，实测签名 ${expected}`);

    for (const entry of CANDIDATES) {
      const result = runEngine({ ...common, lab: entry.build() });
      assert.equal(
        nullSignature(result.grid),
        expected,
        `候选 ${entry.id} 改变了空格位置（§16 硬失败项）`,
      );
      assert.equal(filledCount(result.grid), expectedFilled, `候选 ${entry.id} 改变了填充格数`);
    }
  });
}

test("空格不参与色号统计：生产与候选的用色集合都应排除空格", () => {
  const source = SOURCES["下半透明"];
  const common = { source, width: 8, height: 8, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  for (const entry of CANDIDATES) {
    const result = runEngine({ ...common, lab: entry.build() });
    for (const row of result.grid) for (const cell of row) if (cell) {
      assert.ok(CELL_PALETTE.find((c) => c.code === cell.code), `候选 ${entry.id} 产出了越界色号 ${cell.code}`);
      assert.ok(cell.code !== null && cell.code !== undefined, `候选 ${entry.id} 产出无码格子`);
    }
  }
});
