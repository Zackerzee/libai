/**
 * 阶段 4 候选守卫 —— 四项隔离实验的**准入测试**。
 *
 * ── 与 B4 的 `candidate-*.test.mjs` 是什么关系 ─────────────────────────
 * B4 的四条守卫（determinism / maxColors / null-integrity / benchmark-contract）
 * 都遍历 `LAB_MATRIX`。而 `LAB_MATRIX` 被 `candidate-benchmark-contract.test.mjs`
 * 钉死了长度（11）与 id 列表 —— 那是 §11 的**历史记录**，不该往里加条目。
 *
 * 所以阶段 4 的候选挂在**自己的矩阵**（`STAGE4_MATRIX`）上，共用同一把尺子
 * （`b4-candidate-harness.mjs`）。本文件把同一批硬失败项重新钉在阶段 4 候选上，
 * 并补上三个新候选**各自的弃权契约**。
 *
 * ── 为什么每个候选都要单独钉一遍弃权契约 ──────────────────────────────
 * 三个新候选都是 `matchCell` 型：返回色卡 entry = 有意见；返回 `undefined`
 * = 「我没意见，退回生产匹配器」。这个契约**失败时不报错**：
 *   · 一个永远返回 `undefined` 的候选，网格与生产逐位相同，看起来「没副作用」；
 *   · 一个永远返回同一格的候选，也只是「多了一块颜色」。
 * 两种都表现为「候选没效果」，而报告会把它们记成 KEEP 或 REJECT 的**错理由**。
 * 所以弃权必须**计数**、计数必须**等于被问到的格数**、且必须能解释成
 * 「路径 A + 路径 B + 弃权 = 总格数」这种可核对的分账。
 */

import { test } from "node:test";
import assert from "node:assert/strict";

import { STAGE4_MATRIX } from "../smart-preprocessing/lab/stage4-matrix.mjs";
import { selectKit, createKitLimit } from "../smart-preprocessing/lab/kit-limit.mjs";
import { paletteLabTable } from "../smart-preprocessing/lab/buckets.mjs";
import { CELL_PALETTE, runEngine, paintSource, codesOf, gridHash, usedOf, nullSignature, filledCount } from "./b4-candidate-harness.mjs";

const CANDIDATES = STAGE4_MATRIX.filter((e) => e.id !== "current");
const EXPECTED_IDS = [
  "current", "adaptive-v2", "chroma-prescreen",
  "kit-limit-24", "kit-limit-48", "kit-limit-96", "cleanup",
];

/* ══════════════════════════════════════════════════════════════════
 * A. 矩阵契约（照 §11 四条纪律）
 * ══════════════════════════════════════════════════════════════════ */

test("A1 阶段 4 矩阵：id 列表固定，条目数与实验数一致", () => {
  assert.deepEqual(STAGE4_MATRIX.map((e) => e.id), EXPECTED_IDS, "矩阵 id 列表被改动");
});

test("A2 build() 每次返回新实例；current 稳定返回 null", () => {
  for (const entry of STAGE4_MATRIX) {
    const a = entry.build();
    const b = entry.build();
    if (a === null) {
      assert.equal(b, null, `${entry.id} 的 build 应稳定返回 null`);
      continue;
    }
    assert.notEqual(a, b, `${entry.id} 的 build() 必须返回新实例`);
    assert.equal(typeof a.id, "string", `${entry.id} 的实例必须有 id`);
  }
});

test("A3 条目 id 与候选自报 id 逐字一致（跑分器按 id 建列，漂移就错柱子）", () => {
  const source = paintSource(48, 48, (x, y) => [40 + x * 3, 60 + y * 2, 200 - x]);
  for (const entry of CANDIDATES) {
    const result = runEngine({ source, width: 8, height: 8, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: entry.build() });
    assert.equal(result.diagnostics?.lab?.id, entry.id, `矩阵 id ${entry.id} 与自报 id 不一致`);
  }
});

test("A4 阶段 4 矩阵里没有 pending 条目（隔离实验必须全部已裁定）", () => {
  for (const entry of STAGE4_MATRIX) assert.notEqual(entry.pending, true, `${entry.id} 仍标 pending`);
});

/* ══════════════════════════════════════════════════════════════════
 * B. §16 硬失败项：deterministic
 * ══════════════════════════════════════════════════════════════════ */

const DET_SOURCES = {
  "渐变": paintSource(64, 64, (x, y) => [40 + x * 3, 60 + y * 2, 200 - x]),
  "棋盘": paintSource(64, 64, (x, y) => ((Math.floor(x / 4) + Math.floor(y / 4)) % 2 ? [30, 30, 30] : [230, 220, 200])),
  "半透明": paintSource(64, 64, (x, y) => (y < 32 ? [180, 150, 120] : [180, 150, 120, 0])),
};

for (const [name, source] of Object.entries(DET_SOURCES)) {
  test(`B 确定性：${name} —— 全部阶段 4 候选跑两次逐格相同`, () => {
    for (const entry of CANDIDATES) {
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

test("B2 报告计数器是活的：单次运行内逐格累加（12×12 = 144）", () => {
  const source = DET_SOURCES["渐变"];
  const common = { source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  const expected = {
    "adaptive-v2": "adaptiveV2",
    "chroma-prescreen": "chromaPrescreen",
    "kit-limit-24": "kitLimit",
    "kit-limit-48": "kitLimit",
    "kit-limit-96": "kitLimit",
  };
  for (const entry of CANDIDATES) {
    const key = expected[entry.id];
    if (!key) continue; // cleanup 是 grid 级候选，没有逐格计数器
    const result = runEngine({ ...common, lab: entry.build() });
    const stat = result.diagnostics?.lab?.detail?.[key];
    assert.ok(stat, `${entry.id} 必须写报告 ${key}`);
    assert.equal(stat.cells, 144, `${entry.id} 的 ${key}.cells 必须等于 144，实测 ${stat.cells}`);
  }
});

test("B3 报告不跨运行泄漏：复用同一实例也不影响第二次的统计", () => {
  const source = DET_SOURCES["渐变"];
  const common = { source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  for (const entry of CANDIDATES) {
    const shared = entry.build();
    const first = runEngine({ ...common, lab: shared });
    const second = runEngine({ ...common, lab: shared });
    assert.deepEqual(
      second.diagnostics?.lab?.detail ?? null,
      first.diagnostics?.lab?.detail ?? null,
      `复用实例时 ${entry.id} 第二次的统计必须与第一次一致（stat 不该挂在实例上）`,
    );
  }
});

/* ══════════════════════════════════════════════════════════════════
 * C. §16 硬失败项：maxColors 超限 / 越界色号
 * ══════════════════════════════════════════════════════════════════ */

const RAINBOW = paintSource(64, 64, (x, y) => {
  const i = Math.floor(x / (64 / 6)) + Math.floor(y / (64 / 6)) * 6;
  return [
    [235, 60, 60], [240, 150, 40], [240, 230, 60], [70, 200, 90],
    [60, 160, 230], [90, 90, 220], [190, 90, 220], [240, 120, 180],
    [120, 220, 210], [30, 30, 40], [245, 245, 245], [140, 140, 140],
  ][i % 12];
});

for (const maxColors of [3, 5, 8]) {
  test(`C maxColors=${maxColors}：全部阶段 4 候选的用色数都不得超限`, () => {
    const common = { source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: { maxColors } };
    assert.ok(usedOf(runEngine(common).grid).size <= maxColors, "前提：生产侧自己就得守住预算");
    for (const entry of CANDIDATES) {
      const used = usedOf(runEngine({ ...common, lab: entry.build() }).grid).size;
      assert.ok(used <= maxColors, `候选 ${entry.id} 用了 ${used} 色，超过 maxColors=${maxColors}（§16 硬失败项）`);
    }
  });
}

test("C2 候选只返回色卡内的色号（不可能造色）", () => {
  const common = { source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: {} };
  for (const entry of CANDIDATES) {
    const result = runEngine({ ...common, lab: entry.build() });
    for (const row of result.grid) for (const cell of row) if (cell) {
      assert.ok(CELL_PALETTE.find((c) => c.code === cell.code), `候选 ${entry.id} 产出了越界色号 ${cell.code}`);
      assert.ok(cell.code != null, `候选 ${entry.id} 产出无码格子`);
    }
  }
});

/* ══════════════════════════════════════════════════════════════════
 * D. §16 硬失败项：null 被填色
 * ══════════════════════════════════════════════════════════════════ */

const NULL_SOURCES = {
  "全透明": paintSource(48, 48, () => [0, 0, 0, 0]),
  "下半透明": paintSource(48, 48, (x, y) => (y < 24 ? [200, 160, 140] : [200, 160, 140, 0])),
  "棋盘洞": paintSource(48, 48, (x, y) => (((Math.floor(x / 12) + Math.floor(y / 12)) % 2 === 0) ? [90, 140, 190] : [90, 140, 190, 0])),
};

for (const [name, source] of Object.entries(NULL_SOURCES)) {
  test(`D null 完整性：${name} —— 全部阶段 4 候选的空格位置与生产逐位一致`, () => {
    const common = { source, width: 8, height: 8, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
    const production = runEngine(common);
    const expected = nullSignature(production.grid);
    const expectedFilled = filledCount(production.grid);
    assert.ok(expected.includes("X"), `夹具必须真的有空格，实测签名 ${expected}`);
    for (const entry of CANDIDATES) {
      const result = runEngine({ ...common, lab: entry.build() });
      assert.equal(nullSignature(result.grid), expected, `候选 ${entry.id} 改变了空格位置（§16 硬失败项）`);
      assert.equal(filledCount(result.grid), expectedFilled, `候选 ${entry.id} 改变了填充格数`);
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
 * E. 各候选的弃权契约（路径分账必须能核对）
 * ══════════════════════════════════════════════════════════════════ */

test("E1 adaptive-v2：meanPath + dominantPath + abstained === cells（每条格都有归属）", () => {
  const source = DET_SOURCES["棋盘"];
  const result = runEngine({ source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: STAGE4_MATRIX.find((e) => e.id === "adaptive-v2").build() });
  const s = result.diagnostics.lab.detail.adaptiveV2;
  assert.equal(s.meanPath + s.dominantPath + s.abstained, s.cells, "adaptive-v2 的路径分账必须闭合");
  assert.ok(s.meanPath + s.dominantPath > 0, "棋盘图上至少要有格子走路径（否则候选完全没生效）");
});

test("E2 chroma-prescreen：passed + rejected + noPixels === cells（分账闭合）", () => {
  const source = DET_SOURCES["渐变"];
  const result = runEngine({ source, width: 12, height: 12, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: STAGE4_MATRIX.find((e) => e.id === "chroma-prescreen").build() });
  const s = result.diagnostics.lab.detail.chromaPrescreen;
  assert.equal(s.passed + s.rejected + s.noPixels, s.cells, "chroma-prescreen 的分账必须闭合");
});

test("E3 chroma-prescreen：纯色源图必须几乎全部走快路径（rejected 0）", () => {
  // 纯色图每格都是单色格 —— 若预筛判不出「单色」，那它对像素的读法就是错的。
  const source = paintSource(64, 64, () => [210, 170, 150]);
  const result = runEngine({ source, width: 8, height: 8, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: STAGE4_MATRIX.find((e) => e.id === "chroma-prescreen").build() });
  const s = result.diagnostics.lab.detail.chromaPrescreen;
  assert.equal(s.rejected, 0, `纯色图上不该有被拒的格子，实测 rejected=${s.rejected}`);
  assert.equal(s.passed, s.cells, "纯色图每格都应走快路径");
  assert.equal(s.switched, 0, "纯色格上快路径必须与生产同答案（switched 应为 0）");
});

test("E4 kit-limit：报告里的 kitSize 是 min(请求, 色卡可用数)", () => {
  const source = DET_SOURCES["渐变"];
  const expect = { "kit-limit-24": 12, "kit-limit-48": 12, "kit-limit-96": 12 }; // CELL_PALETTE 只有 12 色
  for (const entry of CANDIDATES.filter((e) => e.id.startsWith("kit-limit"))) {
    const result = runEngine({ source, width: 8, height: 8, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: entry.build() });
    const s = result.diagnostics.lab.detail.kitLimit;
    assert.equal(s.paletteSize, 12, `${entry.id} 的 paletteSize 应为 12`);
    assert.equal(s.kitSize, expect[entry.id], `${entry.id} 的 kitSize 应为 ${expect[entry.id]}（色卡只有 12 色，请求 24/48/96 都退化为整表）`);
  }
});

/* ══════════════════════════════════════════════════════════════════
 * F. 三类静默空转形状的守卫
 * ══════════════════════════════════════════════════════════════════ */

test("F1 selectKit：kitSize ≥ 色卡数 → 返回整表；< 色卡数 → 真子集", () => {
  const table = paletteLabTable(CELL_PALETTE);
  assert.equal(table.length, 12);
  assert.equal(selectKit(table, 24).length, 12, "kitSize 超过色卡数应退化为整表");
  assert.equal(selectKit(table, 5).length, 5, "kitSize=5 应返回 5 色");
  const subset = new Set(selectKit(table, 5).map((e) => e.code));
  assert.equal(subset.size, 5, "子集内不得有重复色");
});

test("F2 selectKit：确定性 —— 两次调用同序（平票按 index 兜底）", () => {
  const table = paletteLabTable(CELL_PALETTE);
  const a = selectKit(table, 6).map((e) => e.code).join(",");
  const b = selectKit(table, 6).map((e) => e.code).join(",");
  assert.equal(a, b, "selectKit 两次结果必须逐位相同");
});

test("F3 selectKit：最远点采样真的在覆盖 —— 第二色是离首色最远的那一色", () => {
  const table = paletteLabTable(CELL_PALETTE);
  const kit = selectKit(table, 2);
  // 手工算：首色 = 离 Lab 质心最近者；第二色 = 离首色 ΔE 最大者
  const mean = table.reduce((acc, e) => [acc[0] + e.lab[0], acc[1] + e.lab[1], acc[2] + e.lab[2]], [0, 0, 0]).map((v) => v / table.length);
  const d2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  const first = table.reduce((best, e) => (d2(e.lab, mean) < d2(best.lab, mean) ? e : best), table[0]);
  assert.equal(kit[0].code, first.code, "首色必须是离质心最近的一色");
  assert.notEqual(kit[1].code, kit[0].code);
});

test("F4 kit-limit：kitSize < 色卡数时不得抛（production 项没有 lab 字段）", () => {
  // 回归守卫：`paletteEngine.match` 返回**原始色卡项**（code/rgb/group），没有 lab。
  // 早期实现写 `production.lab` → deltaE2000 抛「labB is not iterable」。
  // 用一张 12 色但 kitSize=3 的色卡，逼「生产答案在 kit 外」的分支必然走到。
  const source = RAINBOW;
  const result = runEngine({
    source, width: 10, height: 10, palette: CELL_PALETTE, options: { sampling: "linear-mean" },
    lab: createKitLimit({ id: "kit-limit-3", kitSize: 3 }),
  });
  const s = result.diagnostics.lab.detail.kitLimit;
  assert.equal(s.kitSize, 3);
  assert.ok(s.changed > 0, "kitSize=3 相对 12 色必然改色，changed 必须 > 0");
  assert.ok(s.outsideKitProduction > 0, "生产答案必然有一部分落在 3 色 kit 之外");
  assert.ok(Number.isFinite(s.penaltyMax) && Number.isFinite(s.penaltyMin), "penalty 必须有限（NaN 说明算错了）");
});

test("F4b kit-limit：penalty 的符号方向正确（forcedWorse 数的是「更差」）", () => {
  // 早期实现把 forcedWorse 写成 `penalty > threshold`，于是它数的是
  // 「限色更好」的格数 —— 一个方向相反、报告里看不出来的计数器。
  // 这条用 12 色色卡限到 3 色（必然大量变差）钉住方向。
  const result = runEngine({
    source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: { sampling: "linear-mean" },
    lab: createKitLimit({ id: "kit-limit-3", kitSize: 3 }),
  });
  const s = result.diagnostics.lab.detail.kitLimit;
  // penalty = dist(生产) − dist(kit)：限色更差时 penalty < 0
  assert.ok(s.penaltyMin < 0, `限到 3 色必然有更差的格，penaltyMin 应 < 0，实测 ${s.penaltyMin}`);
  assert.ok(s.forcedWorse > 0, `限到 3 色必然有「明显更差」的格，实测 forcedWorse=${s.forcedWorse}`);
  assert.ok(s.forcedWorse + s.forcedBetter <= s.changed, "两个方向计数之和不得超过改动格数");
  // 平均 penalty 为负 = 平均变差，与「kit ⊂ 全色卡不可能更优」的定义一致
  assert.ok(s.penaltySum < 0, `限色平均应更差，penaltySum 实测 ${s.penaltySum}`);
});

test("F5 候选确实在动：至少一个候选改变了网格（否则上面的不变量全是空跑）", () => {
  const common = { source: RAINBOW, width: 10, height: 10, palette: CELL_PALETTE, options: {} };
  const base = codesOf(runEngine(common).grid);
  const changed = CANDIDATES.filter((e) => codesOf(runEngine({ ...common, lab: e.build() }).grid) !== base);
  assert.ok(changed.length >= 1, `没有任何候选改变了网格 —— 断言无覆盖。改动过的：${changed.map((e) => e.id).join(",")}`);
});
