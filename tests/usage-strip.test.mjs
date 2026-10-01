/**
 * Stage B1 §12 / §13 / §16：横向用色统计条的数据整形。
 *
 * 排序与汇总是最容易算错又最难肉眼发现的部分，所以单独成模块、单独断言。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  USAGE_SORT_DEFAULT, USAGE_SORT_MODES, buildUsageEntries, formatUsageSummary,
  isUsageEntryPresent, isUsageSortMode, sortUsageEntries, summarizeUsage,
} from "../services/palette-usage-strip.mjs";

const PALETTE = [
  { code: "H5", hex: "#111111", rgb: [17, 17, 17], group: "H" },
  { code: "H10", hex: "#222222", rgb: [34, 34, 34], group: "H" },
  { code: "A2", hex: "#333333", rgb: [51, 51, 51], group: "A" },
  { code: "65", hex: "#444444", rgb: [68, 68, 68], group: "黄" },
  { code: "H7", hex: "#555555", rgb: [85, 85, 85], group: "H" },
];
const COUNTS = new Map([["H5", 120], ["H10", 3], ["A2", 45], ["65", 1]]);

test("默认排序是「数量↓」", () => {
  assert.equal(USAGE_SORT_DEFAULT, "count-desc");
  assert.deepEqual(USAGE_SORT_MODES, ["count-desc", "count-asc", "code"]);
  assert.equal(isUsageSortMode("count-asc"), true);
  assert.equal(isUsageSortMode("bogus"), false);
});

test("数量↓ / 数量↑ / 色号 三种排序都对，且不改原数组", () => {
  const entries = buildUsageEntries(COUNTS, PALETTE);
  assert.deepEqual(entries.map((e) => e.code), ["H5", "A2", "H10", "65"]);
  assert.deepEqual(buildUsageEntries(COUNTS, PALETTE, { sort: "count-asc" }).map((e) => e.code), ["65", "H10", "A2", "H5"]);
  // 色号排序：数字段按数值比，所以 A2 < H5 < H7 < H10 < 65
  assert.deepEqual(buildUsageEntries(COUNTS, PALETTE, { sort: "code" }).map((e) => e.code), ["65", "A2", "H5", "H10"]);
  // 原数组不被修改
  const source = [{ code: "B", count: 1 }, { code: "A", count: 9 }];
  const snapshot = JSON.stringify(source);
  sortUsageEntries(source, "count-desc");
  assert.equal(JSON.stringify(source), snapshot);
});

test("色号排序用数值比较：H2 必须排在 H10 前面（localeCompare 默认会反过来）", () => {
  const counts = new Map([["H10", 1], ["H2", 1]]);
  const palette = [{ code: "H10", hex: "#a" }, { code: "H2", hex: "#b" }];
  assert.deepEqual(buildUsageEntries(counts, palette, { sort: "code" }).map((e) => e.code), ["H2", "H10"]);
});

test("无法识别的排序模式回落默认，不返回乱序", () => {
  const entries = buildUsageEntries(COUNTS, PALETTE, { sort: "definitely-not-a-mode" });
  assert.deepEqual(entries.map((e) => e.code), ["H5", "A2", "H10", "65"]);
});

test("颗数为 0 或负数的颜色不出现（统计条回答的是「用了什么」）", () => {
  const counts = new Map([["H5", 10], ["H10", 0], ["A2", -3], ["65", null], ["H7", undefined]]);
  const entries = buildUsageEntries(counts, PALETTE);
  assert.deepEqual(entries.map((e) => e.code), ["H5"]);
});

test("汇总：色数 + 总颗数，空图纸给「尚未生成」而不是「共 0 色 · 0 颗」", () => {
  const entries = buildUsageEntries(COUNTS, PALETTE);
  assert.deepEqual(summarizeUsage(entries), { colorCount: 4, beadCount: 169 });
  assert.equal(formatUsageSummary(entries), "共 4 色 · 169 颗");
  assert.equal(formatUsageSummary([]), "尚未生成");
  assert.equal(summarizeUsage([]).beadCount, 0);
  // 千位不分组（与站点其它统计文案一致）
  assert.equal(formatUsageSummary([{ code: "A", count: 12345 }]), "共 1 色 · 12345 颗");
});

test("色板里查不到 paletteId 时用 resolve 兜底；再查不到就显示 paletteId 本身", () => {
  const counts = new Map([["ZZ9", 5]]);
  const withResolve = buildUsageEntries(counts, PALETTE, { resolve: (id) => (id === "ZZ9" ? { code: "ZZ9", hex: "#999999" } : null) });
  assert.equal(withResolve[0].hex, "#999999");
  const withoutResolve = buildUsageEntries(counts, PALETTE);
  assert.equal(withoutResolve[0].code, "ZZ9");
  assert.equal(withoutResolve[0].hex, "#cccccc", "查不到就用中性灰占位，绝不按 RGB 猜色");
});

test("§13/§14 选中项是否仍在图上：被全局替换掉后必须能判出来", () => {
  const entries = buildUsageEntries(COUNTS, PALETTE);
  assert.equal(isUsageEntryPresent(entries, "H5"), true);
  assert.equal(isUsageEntryPresent(entries, "H7"), false, "0 颗的颜色不在图上");
  assert.equal(isUsageEntryPresent(entries, null), false);
  assert.equal(isUsageEntryPresent(entries, ""), false);
  assert.equal(isUsageEntryPresent([], "H5"), false);
});

test("counts 传普通对象也能吃（兼容 state.stats.colors 的投影）", () => {
  const entries = buildUsageEntries({ H5: 7, A2: 2 }, PALETTE);
  assert.deepEqual(entries.map((e) => e.code), ["H5", "A2"]);
  assert.equal(entries[0].count, 7);
});

test("形状容错：palette / entries 为 null 不抛异常", () => {
  assert.deepEqual(buildUsageEntries(null, null), []);
  assert.deepEqual(buildUsageEntries(new Map(), null), []);
  assert.deepEqual(summarizeUsage(null), { colorCount: 0, beadCount: 0 });
  assert.deepEqual(sortUsageEntries(null), []);
  assert.equal(formatUsageSummary(null), "尚未生成");
  assert.equal(isUsageEntryPresent(null, "H5"), false);
});
