/**
 * §11 组合矩阵 + §13 跑分器的**契约**测试。
 *
 * 不测算法好坏（那是 §13/§14 的事），只测「这份矩阵和这份跑分器
 * 能不能支撑出可比的结论」：
 *
 *   · §11 列的 11 个条目一个都不能少，id 一个都不能改 —— 改了 id，
 *     metrics.json 里的列就跟上一轮对不上了
 *   · 每个非 pending 条目的 `build()` 必须能造出一个挂了接缝的对象
 *   · pending 条目必须**明确**造不出东西（返回 null + 有 reason），
 *     绝不能悄悄退化成一个「和 current 一样的列」—— 那样 §15 的裁定
 *     会建立在一根假的柱子上
 *   · `combineLabs` 的叠加规则（两个 refine / 两个 cleanup 必须抛）
 *   · `runBenchCase` 必须把 labId / labMatchFallbacks / labDetail 透出来
 *
 * 最后一条是实测补的：第一版跑分器没透 labDetail，metrics.json 里
 * 每个候选的诊断是空的，于是「候选在 J 类上清理了多少块」只能靠猜。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  LAB_MATRIX, LAB_MATRIX_BY_ID, combineLabs,
  createBeanFit, createDualMode, createNeutralProtection, createSpatialRefine, createConservativeCleanup,
} from "../smart-preprocessing/lab/index.mjs";
import { runBenchCase, B4_BENCH_PINNED } from "./b4-bench-runner.mjs";
import { B4_BENCH_CLASSES } from "./b4-bench-fixtures.mjs";

/** §11 原文列出的 11 个条目，顺序照原文。 */
const SECTION_11_IDS = [
  "current", "bean-fit", "dual-mode", "neutral", "spatial", "cleanup",
  "bean-fit+neutral", "bean-fit+dual-mode", "bean-fit+neutral+cleanup",
  "dual-mode+cleanup", "recommended-hybrid",
];

test("§11 矩阵：11 个条目，id 与顺序都与 §11 一致", () => {
  assert.equal(LAB_MATRIX.length, 11);
  assert.deepEqual(LAB_MATRIX.map((e) => e.id), SECTION_11_IDS);
  assert.equal(new Set(LAB_MATRIX.map((e) => e.id)).size, 11, "id 必须唯一");
  for (const id of SECTION_11_IDS) assert.ok(LAB_MATRIX_BY_ID[id], `LAB_MATRIX_BY_ID 缺 ${id}`);
});

test("§11 矩阵：非 pending 条目都能造出挂了接缝的对象", () => {
  const builders = { createBeanFit, createDualMode, createNeutralProtection, createSpatialRefine, createConservativeCleanup };
  for (const name of Object.keys(builders)) assert.equal(typeof builders[name], "function", `index 必须导出 ${name}`);

  for (const entry of LAB_MATRIX) {
    if (entry.pending) continue;
    const lab = entry.build();
    if (lab === null) {
      assert.equal(entry.id, "current", "只有 current 允许 build() 返回 null");
      continue;
    }
    assert.equal(typeof lab.id, "string", `${entry.id} 必须有 id`);
    const seams = ["matchCell", "refineGrid", "cleanup"].filter((k) => typeof lab[k] === "function");
    assert.ok(seams.length >= 1, `${entry.id} 必须至少挂一个接缝，实测 ${seams.length}`);
  }
});

test("§11 矩阵：pending 条目必须明确造不出东西（不许悄悄退化成 current 列）", () => {
  const pending = LAB_MATRIX.filter((e) => e.pending);
  assert.equal(pending.length, 1, "只有 recommended-hybrid 是待裁定");
  for (const entry of pending) {
    assert.equal(entry.build(), null, `${entry.id} 未裁定前不得产出候选`);
    assert.equal(typeof entry.reason, "string", "pending 必须写明为什么没填");
    assert.ok(entry.reason.length > 10, "reason 不能是一句空话");
  }
});

test("combineLabs：两个 refineGrid / 两个 cleanup 必须抛", () => {
  assert.throws(
    () => combineLabs([createSpatialRefine(), createSpatialRefine()], "x"),
    /refineGrid/,
    "两个 refine 叠加没有定义 —— 宁可炸，也不要一个没人能复现的数字",
  );
  assert.throws(
    () => combineLabs([createConservativeCleanup(), createConservativeCleanup()], "y"),
    /cleanup/,
  );
  assert.doesNotThrow(() => combineLabs([createDualMode(), createSpatialRefine(), createConservativeCleanup()], "ok"));
});

test("combineLabs：matchCell 按顺序取第一个非 undefined 的意见", () => {
  const always = (value) => ({ id: `always-${value}`, matchCell: () => value });
  const never = { id: "never", matchCell: () => undefined };
  const a = combineLabs([never, always("A"), always("B")], "t1");
  assert.equal(a.matchCell({ report: {} }), "A", "第一个有意见的胜出");
  const b = combineLabs([never, never], "t2");
  assert.equal(b.matchCell({ report: {} }), undefined, "全没意见 ⇨ undefined（退回生产）");
  assert.equal(combineLabs([null, null], "t3"), null, "全是 null ⇨ null（走生产路径）");
});

test("§13 跑分器：labId / labMatchFallbacks / labDetail 必须透出来", () => {
  const cls = B4_BENCH_CLASSES[0];
  const production = runBenchCase(cls, "auto", {});
  assert.equal(production.labId, null, "生产路径的 labId 必须是 null");
  assert.equal(production.labMatchFallbacks, null);
  assert.equal(production.labDetail, null);

  const bean = runBenchCase(cls, "auto", { lab: createBeanFit() });
  assert.equal(bean.labId, "bean-fit", "挂上来的候选 id 必须自证");
  assert.equal(typeof bean.labMatchFallbacks, "number", "matchFallbacks 必须是数字");
  assert.ok(bean.labDetail && bean.labDetail.beanFit, `labDetail 必须带候选自己的诊断，实测 ${JSON.stringify(bean.labDetail)}`);
});

test("§13 跑分器：每个非 pending 候选都能跑完并自报 id", () => {
  const cls = B4_BENCH_CLASSES[0];
  for (const entry of LAB_MATRIX) {
    if (entry.pending) continue;
    const row = runBenchCase(cls, "auto", { lab: entry.build() });
    assert.equal(row.labId, entry.id === "current" ? null : entry.id, `${entry.id} 自报的 id 不对`);
    assert.equal(row.totalCells, row.size.width * row.size.height);
    assert.equal(row.gridHash.length, 8, "gridHash 必须是 8 位十六进制");
  }
});

test("§13 固定输入不能被候选改动：基线三字段口径不变", () => {
  // 加 lab 参数之后，被冻结的三个字段（usedColors / nullCells / gridHash）
  // 口径必须仍然成立 —— 否则基线就失去意义了。
  const cls = B4_BENCH_CLASSES[0];
  for (const entry of LAB_MATRIX) {
    if (entry.pending) continue;
    const row = runBenchCase(cls, "auto", { lab: entry.build() });
    assert.equal(typeof row.usedColors, "number");
    assert.equal(typeof row.nullCells, "number");
    assert.ok(row.usedColors + row.nullCells <= row.totalCells + 1);
  }
  assert.equal(B4_BENCH_PINNED.maxColors, 0, "固定输入的 maxColors 是 0（不限）—— 改它必须显式更新基线");
});
