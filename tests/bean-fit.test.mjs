/**
 * §6 Bean Fit 契约测试。
 *
 * 测的是**契约与结构性质**（确定性 / null 安全 / 只出色卡色 / 分桶确实改变了决策），
 * 不是调参效果。效果由 `tools/b4-lab.mjs` 在固定 A–J 上量，那是另一件事 ——
 * 把「算法该有的性质」和「算法好不好」混在一个文件里，
 * 改权重的时候就会看到一堆与权重无关的红灯。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createBeanFit, DEFAULT_BEAN_FIT_OPTIONS } from "../smart-preprocessing/lab/bean-fit.mjs";
import { buildLabBuckets, topBuckets, weightedBucketCost, rgbToLab } from "../smart-preprocessing/lab/buckets.mjs";
import {
  CELL_PALETTE, runEngine, codesOf, gridHash, usedOf, paintSource,
} from "./b4-candidate-harness.mjs";

/** 红/蓝/紫三色板：紫 ≈ 红蓝均值，专门用来暴露「均值匹配」的缺陷。 */
const SPLIT_PALETTE = [
  { code: "R", rgb: [255, 0, 0] },
  { code: "B", rgb: [0, 0, 255] },
  { code: "P", rgb: [128, 0, 128] },
];

/**
 * 每格左右各半：一半纯红、一半纯蓝。
 * 格内均值 = (128,0,128) —— 一个格子里根本不存在的颜色，正是 §6 要打的靶子。
 *
 * ⚠️ 必须显式指定 `sampling: "linear-mean"`。默认的 `auto` 会走自适应采样，
 * 对半分的格子它多半判成 `dominant`，于是生产侧拿到的**不是均值**，
 * 这条用例就证明不了「Bean Fit 推翻了均值匹配」。
 * 这个坑是实测踩出来的：首版用例没指定采样模式，生产侧输出红/蓝，
 * 看上去像「Bean Fit 没生效」，其实是两边根本不在比同一个东西。
 */
function splitSource(cellPx = 10, gridSize = 4) {
  const size = cellPx * gridSize;
  return paintSource(size, size, (x, y) => {
    void y;
    return x % cellPx < cellPx / 2 ? [255, 0, 0] : [0, 0, 255];
  });
}

const LINEAR = { sampling: "linear-mean" };

test("分桶：50/50 的格子产出两个等权桶，且都不是均值色", () => {
  const source = splitSource();
  const { opaque, buckets } = buildLabBuckets(source, { x0: 0, y0: 0, x1: 10, y1: 10 });
  assert.equal(opaque, 100);
  assert.equal(buckets.length, 2);
  assert.deepEqual(buckets.map((b) => b.count), [50, 50]);
  assert.deepEqual(buckets.map((b) => b.share), [0.5, 0.5]);
  // 两个桶必须是纯红和纯蓝。**不假设谁在前** —— 计数相同时的顺序由 Lab 桶键
  // 决定（`buildLabBuckets` 的第二排序键），那是 determinism 的实现细节，
  // 不是算法语义。断言顺序等于把测试焊在一个与结论无关的实现细节上。
  const rgbs = buckets.map((b) => b.rgb.join(",")).sort();
  assert.deepEqual(rgbs, ["0,0,255", "255,0,0"]);
  // 关键：没有任何桶接近均值色 (128,0,128)
  for (const b of buckets) {
    assert.ok(Math.abs(b.rgb[0] - 128) + Math.abs(b.rgb[2] - 128) > 200, `桶 ${b.rgb} 不该是均值色`);
  }
});

test("加权成本：紫（= 格内均值）的成本高于红或蓝", () => {
  const source = splitSource();
  const { buckets } = buildLabBuckets(source, { x0: 0, y0: 0, x1: 10, y1: 10 });
  const kept = topBuckets(buckets, 4, 0.08);
  const costRed = weightedBucketCost(kept, rgbToLab([255, 0, 0]));
  const costBlue = weightedBucketCost(kept, rgbToLab([0, 0, 255]));
  const costPurple = weightedBucketCost(kept, rgbToLab([128, 0, 128]));
  assert.ok(costRed < costPurple, `红(${costRed.toFixed(1)}) 应优于紫(${costPurple.toFixed(1)})`);
  assert.ok(costBlue < costPurple, `蓝(${costBlue.toFixed(1)}) 应优于紫(${costPurple.toFixed(1)})`);
});

test("Bean Fit 推翻均值匹配：生产选紫（格内不存在的色），Bean Fit 选红", () => {
  const source = splitSource();
  const common = { source, width: 4, height: 4, palette: SPLIT_PALETTE, options: LINEAR };
  const production = runEngine({ ...common, lab: null });
  const beanFit = runEngine({ ...common, lab: createBeanFit() });

  // 生产侧：线性均值 = (128,0,128)，它最近的色卡邻居就是紫 ——
  // 一个在这 100 个像素里一次都没出现过的颜色。
  assert.deepEqual([...usedOf(production.grid)], ["P"], "生产侧应命中紫色（均值色）");

  // Bean Fit 侧：只看像素分布，紫的成本最高，红蓝并列最优（按 index 破平 → 红）
  assert.deepEqual([...usedOf(beanFit.grid)], ["R"], "Bean Fit 应输出红");
  assert.equal(beanFit.diagnostics.lab.id, "bean-fit");
  assert.equal(beanFit.diagnostics.lab.detail.beanFit.switched, 16, "16 格全部被推翻");
});

test("contextBias = 1 时仍是同一结论（证明这条不是靠折扣拿到的）", () => {
  const source = splitSource();
  const pure = runEngine({ source, width: 4, height: 4, palette: SPLIT_PALETTE, options: LINEAR, lab: createBeanFit({ contextBias: 1 }) });
  assert.deepEqual([...usedOf(pure.grid)], ["R"]);
});

test("确定性：同一输入跑两次，逐格相同", () => {
  const source = splitSource(8, 6);
  const a = runEngine({ source, width: 6, height: 6, palette: CELL_PALETTE, lab: createBeanFit() });
  const b = runEngine({ source, width: 6, height: 6, palette: CELL_PALETTE, lab: createBeanFit() });
  assert.equal(gridHash(a.grid), gridHash(b.grid));
  assert.equal(codesOf(a.grid), codesOf(b.grid));
});

test("maxColors 安全：输出只可能是色卡里的色号", () => {
  const source = splitSource(8, 6);
  const result = runEngine({ source, width: 6, height: 6, palette: CELL_PALETTE, lab: createBeanFit() });
  const allowed = new Set(CELL_PALETTE.map((c) => c.code));
  for (const code of usedOf(result.grid)) assert.ok(allowed.has(code), `越界色号 ${code}`);
});

test("null 安全：不透明像素太少时不表态，退回生产匹配器", () => {
  // 全透明源图 → 采样出口全是 null，Bean Fit 根本不该被问到
  const size = 32;
  const data = new Uint8ClampedArray(size * size * 4);
  const source = { data, width: size, height: size };
  const result = runEngine({ source, width: 4, height: 4, palette: CELL_PALETTE, lab: createBeanFit() });
  let filled = 0;
  for (const row of result.grid) for (const cell of row) if (cell) filled += 1;
  assert.equal(filled, 0, "全透明源图不该产出任何实心格");
  assert.equal(result.diagnostics.lab.matchFallbacks, 0, "不该有机会表态，也就不该有退回计数");
});

test("contextBias = 0 时完全退回生产答案（证明折扣路径真的被读到）", () => {
  // `contextBias` 是**乘在生产的成本上**的：`productionCost × contextBias ≤ beanCost`
  // 时生产胜出。所以
  //   bias = 1     → 纯比较，谁成本低谁赢
  //   bias < 1     → 生产被折扣，更容易赢（默认 0.85 = 允许生产贵 17.6%）
  //   bias → 0     → 生产的有效成本 → 0，必定赢
  // 首版这条用例写成了「bias 极大 → 退回生产」，方向正好反了，
  // 于是它实际在测「bias 极大 → Bean Fit 必赢」。
  const source = splitSource();
  const common = { source, width: 6, height: 6, palette: CELL_PALETTE };
  const production = runEngine({ ...common, lab: null });
  const handicapped = runEngine({ ...common, lab: createBeanFit({ contextBias: 0 }) });
  assert.equal(codesOf(handicapped.grid), codesOf(production.grid));
  const stat = handicapped.diagnostics.lab.detail.beanFit;
  assert.equal(stat.switched, 0, "折扣为 0 时不该有任何换色");
  assert.ok(stat.cells > 0, "Bean Fit 确实被问过");
});

test("contextBias 越大 Bean Fit 越敢换色（单调性）", () => {
  // 上一条证明「bias 小 → 不换」，这一条证明「bias 大 → 会换」，
  // 两条一起才排除「switched 恒为 0 但用例照过」这种情况。
  //
  // 必须用 LINEAR + SPLIT_PALETTE：CELL_PALETTE 配 auto 采样时，
  // 生产侧拿到的就是加权最优，Bean Fit 没有任何理由换色 ——
  // 那样的用例测的是「夹具里没有可换的格子」，不是「折扣方向」。
  const source = splitSource();
  const common = { source, width: 4, height: 4, palette: SPLIT_PALETTE, options: LINEAR };
  const strict = runEngine({ ...common, lab: createBeanFit({ contextBias: 0 }) });
  const loose = runEngine({ ...common, lab: createBeanFit({ contextBias: 1e6 }) });
  assert.equal(strict.diagnostics.lab.detail.beanFit.switched, 0);
  assert.equal(loose.diagnostics.lab.detail.beanFit.switched, 16);
  assert.notEqual(codesOf(strict.grid), codesOf(loose.grid));
});

test("contextBias 默认值是 0.85，且会写进报告", () => {
  assert.equal(DEFAULT_BEAN_FIT_OPTIONS.contextBias, 0.85);
  const source = splitSource(8, 4);
  const result = runEngine({ source, width: 4, height: 4, palette: CELL_PALETTE, lab: createBeanFit() });
  assert.equal(result.diagnostics.lab.detail.beanFit.contextBias, 0.85);
});

test("§11 组合：neutral 打开时，中性惩罚进同一个成本函数", () => {
  const source = splitSource(8, 4);
  const plain = runEngine({ source, width: 4, height: 4, palette: CELL_PALETTE, lab: createBeanFit() });
  const withNeutral = runEngine({ source, width: 4, height: 4, palette: CELL_PALETTE, lab: createBeanFit({ neutral: {} }) });
  assert.equal(plain.diagnostics.lab.detail.beanFit.neutral, false);
  assert.equal(withNeutral.diagnostics.lab.detail.beanFit.neutral, true);
  // 红蓝格是饱和源色，中性门不该开 —— 两个结果应当一致
  assert.equal(withNeutral.diagnostics.lab.detail.beanFit.neutralApplied, 0);
  assert.equal(codesOf(withNeutral.grid), codesOf(plain.grid));
});
