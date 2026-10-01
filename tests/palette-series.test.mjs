/**
 * Stage B1 §3–§5：系列的唯一真源。
 *
 * 这一组用例全部打在**真实 registry**（smart-preprocessing/palette-brands.mjs）上，
 * 不是自造 fixture —— 因为要防的正是「真实数据里盼盼/咪小窝是中文系列、色号是纯数字」
 * 这件事被 `code.match(/^[A-Z]+/)` 抹平。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_PALETTES } from "../smart-preprocessing/palette-brands.mjs";
import { MARD_FULL_COLORS } from "../smart-preprocessing/palette-data.mjs";
import {
  PALETTE_SERIES_ALL, PALETTE_SERIES_NONE,
  deriveSeriesFromCode, describePaletteSeries, filterPaletteColors, getPaletteSeries,
  getPaletteSeriesLabel, groupColorsBySeries, hasPaletteSeries, isNumericPaletteCode,
  listPaletteSeries, normalizePaletteCode,
} from "../services/palette-series.mjs";

const byId = (id) => BRAND_PALETTES.find((brand) => brand.id === id);
const seriesOf = (id) => listPaletteSeries(byId(id).colors).map((entry) => entry.key);

test("registry 事实：8 品牌 / 2158 色，且每一色都带 group 元数据", () => {
  assert.equal(BRAND_PALETTES.length, 8);
  assert.equal(BRAND_PALETTES.reduce((sum, brand) => sum + brand.colors.length, 0), 2158);
  for (const brand of BRAND_PALETTES) {
    for (const color of brand.colors) {
      assert.equal(typeof color.group, "string", `${brand.id}/${color.code} 缺 group`);
      assert.notEqual(color.group, "", `${brand.id}/${color.code} 的 group 为空`);
    }
  }
});

test("§4 中文系列：盼盼 / 咪小窝 的 7 个官方系列原样出现（不是字母前缀猜的）", () => {
  const expected = ["黄", "橙棕", "红粉", "灰白黑", "紫", "绿", "青蓝"];
  assert.deepEqual(seriesOf("panpanOfficial"), expected);
  assert.deepEqual(seriesOf("mixiaowoOfficial"), expected);
  // 官方色卡顺序必须保留（首次出现顺序），不能排序
  assert.deepEqual(listPaletteSeries(byId("panpanOfficial").colors).map((e) => e.count), [25, 49, 52, 47, 35, 30, 51]);
  assert.deepEqual(listPaletteSeries(byId("mixiaowoOfficial").colors).map((e) => e.count), [25, 49, 52, 47, 35, 30, 52]);
});

test("§3 字母系列：优肯 / COCO / 漫漫 按官方分组切分，且顺序为官方顺序", () => {
  assert.deepEqual(seriesOf("artkal197"), ["C", "CE", "CG", "CP", "CT"]);
  assert.deepEqual(seriesOf("artkal221"), ["MA", "MB", "MC", "MD", "ME", "MF", "MG", "MH", "MM"]);
  assert.deepEqual(seriesOf("artkal418"), ["C", "CE", "CG", "CP", "CT", "MA", "MB", "MC", "MD", "ME", "MF", "MG", "MH", "MM"]);
  assert.deepEqual(seriesOf("youken174"), ["C", "CE"]);
  const coco = seriesOf("cocoOfficial");
  assert.equal(coco.length, 18);
  assert.ok(coco.includes("GB"), "COCO 有 GB 这个双字母系列");
  const manman = seriesOf("manmanOfficial");
  assert.equal(manman.length, 18);
  for (const key of ["DH", "IC", "YX"]) assert.ok(manman.includes(key), `漫漫应有 ${key} 系列`);
});

test("§4 纯数字色号：deriveSeriesFromCode 返回空串，而不是 null / \"0\" / 字母", () => {
  assert.equal(deriveSeriesFromCode("65"), PALETTE_SERIES_NONE);
  assert.equal(deriveSeriesFromCode("138"), PALETTE_SERIES_NONE);
  assert.equal(isNumericPaletteCode("65"), true);
  assert.equal(isNumericPaletteCode("A1"), false);
  // 盼盼 289 色里 285 个是纯数字色号 —— 这就是旧正则失效的根因
  const panpan = byId("panpanOfficial").colors;
  assert.equal(panpan.filter((color) => isNumericPaletteCode(color.code)).length, 285);
  // 但它们的系列必须来自元数据，不能为空
  assert.ok(panpan.every((color) => getPaletteSeries(color) !== PALETTE_SERIES_NONE));
});

test("§5 元数据优先的**真实**理由：前缀会把 UNKNOWN-* 与 ZG* 归错系列", () => {
  // 上游数据集里这两类色号的前缀与官方系列划分不一致：
  //   UNKNOWN-01  前缀推导得 "UNKNOWN"，官方系列却是「紫」
  //   咪小窝 ZG1   前缀推导得 "ZG"，官方系列却是「红粉」
  // 如果 UI 只用 /^[A-Z]+/ 推导，会凭空多出 "UNKNOWN" 和 "ZG" 两个不存在的系列，
  // 而官方的中文系列被拆散。这正是「元数据优先」存在的理由。
  assert.equal(deriveSeriesFromCode("UNKNOWN-01"), "UNKNOWN");
  assert.equal(getPaletteSeries({ code: "UNKNOWN-01", group: "紫" }), "紫");
  assert.equal(deriveSeriesFromCode("ZG1"), "ZG");
  assert.equal(getPaletteSeries({ code: "ZG1", group: "红粉" }), "红粉");

  const panpanUnknown = byId("panpanOfficial").colors.filter((color) => color.code.startsWith("UNKNOWN-"));
  assert.equal(panpanUnknown.length, 4);
  assert.ok(panpanUnknown.every((color) => getPaletteSeries(color) === color.group));
  const mixiaowoZg = byId("mixiaowoOfficial").colors.filter((color) => color.code.startsWith("ZG"));
  assert.equal(mixiaowoZg.length, 8);
  assert.ok(mixiaowoZg.every((color) => getPaletteSeries(color) === color.group));
  // 于是界面上的系列列表里不会出现 "UNKNOWN" / "ZG"
  const keys = seriesOf("mixiaowoOfficial");
  assert.ok(!keys.includes("ZG"), `系列列表不应含 ZG，实际 ${JSON.stringify(keys)}`);
  assert.ok(!keys.includes("UNKNOWN"));
});

test("§5 优先级：元数据 > 色号前缀 > 无系列；元数据永不被子串推导覆盖", () => {
  // 前缀与元数据冲突时，元数据说了算
  assert.equal(getPaletteSeries({ code: "C01", group: "黄" }), "黄");
  assert.equal(getPaletteSeries({ code: "A1", group: "青蓝" }), "青蓝");
  // 没有元数据才用前缀
  assert.equal(getPaletteSeries({ code: "CE01" }), "CE");
  assert.equal(getPaletteSeries({ code: "ZG7" }), "ZG");
  // 都没有 → 空串
  assert.equal(getPaletteSeries({ code: "65" }), PALETTE_SERIES_NONE);
  assert.equal(getPaletteSeries({}), PALETTE_SERIES_NONE);
  assert.equal(getPaletteSeries(null), PALETTE_SERIES_NONE);
  // series 字段也认（未来 registry 改名时不至于静默失效）
  assert.equal(getPaletteSeries({ code: "65", series: "黄" }), "黄");
  // 空白元数据视为没有
  assert.equal(getPaletteSeries({ code: "CE01", group: "   " }), "CE");
});

test("§4 内建 MARD 291 色全部有字母前缀，行为与旧正则一致（无回归）", () => {
  assert.equal(MARD_FULL_COLORS.length, 291);
  const numeric = MARD_FULL_COLORS.filter((color) => isNumericPaletteCode(color.code));
  assert.equal(numeric.length, 0, "MARD 不应出现纯数字色号");
  const derived = new Set(MARD_FULL_COLORS.map((color) => deriveSeriesFromCode(color.code)));
  assert.deepEqual([...derived].sort(), ["A", "B", "C", "D", "E", "F", "G", "H", "M", "P", "Q", "R", "T", "Y", "ZG"].sort());
  // 内建色表没有 group，所以走前缀推导 —— 与改动前 UI 的系列划分完全一致
  assert.deepEqual(listPaletteSeries(MARD_FULL_COLORS).map((e) => e.key), [...derived]);
});

test("「无系列」不产生筛选片 —— 否则会出现两个都叫「全部」的按钮", () => {
  const mixed = [{ code: "65", group: "黄" }, { code: "99" }, { code: "C01", group: "C" }];
  const list = listPaletteSeries(mixed);
  assert.deepEqual(list.map((entry) => entry.key), ["黄", "C"]);
  assert.ok(!list.some((entry) => entry.label === "全部"));
  // 无系列的颜色仍能被 describe 统计到，不是被悄悄丢掉
  assert.equal(describePaletteSeries(mixed).unassigned, 1);
  assert.equal(getPaletteSeriesLabel(PALETTE_SERIES_NONE), "全部");
});

test("hasPaletteSeries：全无系列时返回 false（UI 不该渲染系列行）", () => {
  assert.equal(hasPaletteSeries([{ code: "65" }, { code: "99" }]), false);
  assert.equal(hasPaletteSeries([]), false);
  assert.equal(hasPaletteSeries([{ code: "65", group: "黄" }, { code: "99", group: "绿" }]), true);
  assert.equal(hasPaletteSeries([{ code: "65", group: "黄" }]), true);
});

test("normalizePaletteCode：H7 / H07 折叠成同一个 key，纯数字色号不被破坏", () => {
  assert.equal(normalizePaletteCode("C01"), "C1");
  assert.equal(normalizePaletteCode("H07"), "H7");
  assert.equal(normalizePaletteCode("h7"), "H7");
  assert.equal(normalizePaletteCode("MA1"), "MA1");
  assert.equal(normalizePaletteCode("GB1"), "GB1");
  assert.equal(normalizePaletteCode("65"), "65");
  assert.equal(normalizePaletteCode("001"), "1");
  assert.equal(normalizePaletteCode(""), "");
  assert.equal(normalizePaletteCode(null), "");
});

test("filterPaletteColors：系列筛选 + 搜索词（H7 与 H07 都能命中）", () => {
  const panpan = byId("panpanOfficial").colors;
  const yellow = filterPaletteColors(panpan, { series: "黄" });
  assert.equal(yellow.length, 25);
  assert.ok(yellow.every((color) => color.group === "黄"));
  // 顺序保持输入顺序
  assert.deepEqual(yellow.map((c) => c.code), panpan.filter((c) => c.group === "黄").map((c) => c.code));
  // 全部 = 不过滤
  assert.equal(filterPaletteColors(panpan, { series: PALETTE_SERIES_ALL }).length, 289);
  assert.equal(filterPaletteColors(panpan, {}).length, 289);
  // 数字色号搜索：子串匹配，所以 "65" 会同时命中 65 / 165 / 265（搜索框该有的行为）
  const hit65 = filterPaletteColors(panpan, { query: "65" }).map((c) => c.code);
  assert.ok(hit65.includes("65"), `"65" 应命中 65，实际 ${JSON.stringify(hit65)}`);
  assert.ok(hit65.every((code) => code.includes("65")), "命中项都应含 65 子串");
  // H7 / H07 折叠
  const mard = MARD_FULL_COLORS;
  const h7 = filterPaletteColors(mard, { query: "H7" }).map((c) => c.code);
  const h07 = filterPaletteColors(mard, { query: "H07" }).map((c) => c.code);
  assert.deepEqual(h7, h07);
  assert.ok(h7.includes("H7"), `H7 搜索应命中 H7，实际 ${JSON.stringify(h7)}`);
  // 系列与搜索是与关系
  assert.equal(filterPaletteColors(panpan, { series: "黄", query: "9999" }).length, 0);
  // 中文系列名不参与色号搜索（搜"黄"不该把 25 个色号都拉出来）
  assert.equal(filterPaletteColors(panpan, { query: "黄" }).length, 0);
});

test("groupColorsBySeries：不丢色、不重复，总数守恒", () => {
  for (const brand of BRAND_PALETTES) {
    const groups = groupColorsBySeries(brand.colors);
    const total = [...groups.values()].reduce((sum, list) => sum + list.length, 0);
    assert.equal(total, brand.colors.length, `${brand.id} 分组后总数应守恒`);
  }
  const mard = groupColorsBySeries(MARD_FULL_COLORS);
  assert.equal([...mard.values()].reduce((sum, list) => sum + list.length, 0), 291);
});

test("describePaletteSeries：可断言的诊断快照（系列数 / 未归类数）", () => {
  const snapshot = describePaletteSeries(byId("panpanOfficial").colors);
  assert.equal(snapshot.total, 289);
  assert.equal(snapshot.hasSeries, true);
  assert.equal(snapshot.seriesCount, 7);
  assert.equal(snapshot.unassigned, 0);
  const mard = describePaletteSeries(MARD_FULL_COLORS);
  assert.equal(mard.seriesCount, 15);
  assert.equal(mard.unassigned, 0);
});
