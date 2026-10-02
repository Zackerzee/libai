/**
 * §16 硬失败项：**deterministic 失败**。
 *
 * 候选算法比生产更容易在这里翻车，因为它引入了三样生产没有的东西：
 *   · **迭代**（§9 refine 双缓冲 —— 顺序更新就没法解释结果）
 *   · **Map/Set 遍历顺序**（§6/§7 的分桶）
 *   · **累加状态**（每个候选内部有 report 计数器）
 *
 * 第三样尤其阴险：`createXxx()` 返回的实例如果被复用，第二次跑的统计会从
 * 第一次的基数上继续涨。网格仍然确定，但报告会漂 —— 而 §13 的指标读的就是报告。
 * 所以这里除了逐格比对，还比对 `diagnostics.lab.detail`。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { LAB_MATRIX } from "../smart-preprocessing/lab/index.mjs";
import { CELL_PALETTE, runEngine, paintSource, codesOf, gridHash } from "./b4-candidate-harness.mjs";

const SIZE = 64;
const SOURCES = {
  // 平滑渐变：分桶边界最容易在这里抖
  "渐变": paintSource(SIZE, SIZE, (x, y) => [40 + x * 3, 60 + y * 2, 200 - x]),
  // 高频棋盘：分桶 + 迭代 refine 的压力测试
  "棋盘": paintSource(SIZE, SIZE, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? [30, 30, 30] : [230, 220, 200])),
  // 半透明：null 参与后顺序敏感性翻倍
  "半透明": paintSource(SIZE, SIZE, (x, y) => (y < SIZE / 2 ? [180, 150, 120] : [180, 150, 120, 0])),
};

const CANDIDATES = LAB_MATRIX.filter((e) => !e.pending);

for (const [name, source] of Object.entries(SOURCES)) {
  test(`确定性：${name} —— 全部候选跑两次逐格相同`, () => {
    for (const entry of CANDIDATES) {
      // 每次都 `build()` 一个新实例：这是生产跑分器的用法，也是唯一正确的用法
      const common = { source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
      const a = runEngine({ ...common, lab: entry.build() });
      const b = runEngine({ ...common, lab: entry.build() });
      assert.equal(gridHash(a.grid), gridHash(b.grid), `候选 ${entry.id} 两次跑出不同网格`);
      assert.equal(codesOf(a.grid), codesOf(b.grid), `候选 ${entry.id} 两次跑出不同色号`);
      assert.deepEqual(
        a.diagnostics?.lab?.detail ?? null,
        b.diagnostics?.lab?.detail ?? null,
        `候选 ${entry.id} 两次跑出不同诊断（report 状态被复用了？）`,
      );
    }
  });
}

test("报告计数器是活的：单次运行内必须逐格累加", () => {
  // 只断言「两次跑一样」是不够的 —— 一个从不累加的计数器也满足它。
  // 所以先证明计数确实等于被问到的格数，再证明没有跨运行泄漏。
  const source = SOURCES["渐变"];
  const common = { source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  const result = runEngine({ ...common, lab: CANDIDATES.find((e) => e.id === "bean-fit").build() });
  const stat = result.diagnostics?.lab?.detail?.beanFit;
  assert.ok(stat, "bean-fit 必须写报告");
  assert.equal(stat.cells, 144, `12×12 = 144 格，渐变源图每格都有足够不透明像素 —— cells 必须是 144，实测 ${stat.cells}`);
});

test("报告不跨运行泄漏：复用同一个实例也不影响第二次的统计", () => {
  // 候选的 stat 挂在 **ctx.report** 上（引擎每次 generateV2 新建），
  // 不在实例上 —— 所以跨运行天然不泄漏。这里把这件事钉成契约：
  // 哪天有人把 stat 挪到闭包里，这条会立刻变红。
  const source = SOURCES["渐变"];
  const common = { source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  const shared = CANDIDATES.find((e) => e.id === "bean-fit").build();
  const first = runEngine({ ...common, lab: shared });
  const second = runEngine({ ...common, lab: shared });
  assert.deepEqual(
    second.diagnostics.lab.detail,
    first.diagnostics.lab.detail,
    "复用实例时第二次的统计必须与第一次一致（stat 不该挂在实例上）",
  );
});

test("build() 每次返回新实例（组合候选也一样）", () => {
  for (const entry of CANDIDATES) {
    const a = entry.build();
    const b = entry.build();
    if (a === null) { assert.equal(b, null, `${entry.id} 的 build 应稳定返回 null`); continue; }
    assert.notEqual(a, b, `${entry.id} 的 build() 必须返回新实例`);
  }
});
