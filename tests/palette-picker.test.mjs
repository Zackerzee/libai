/**
 * Stage B1 §2–§5 / §9 / §10 / §22：Palette Picker（品牌 → 规格 → 系列 → 色格）。
 *
 * 改动前的实测缺陷：
 *   ui/workspace.js 用 `code.match(/^[A-Z]+/)` 现猜系列。
 *   盼盼 / 咪小窝的色号是纯数字 → 返回 null → 这两个品牌的系列筛选片**完全消失**，
 *   它们 7 个官方中文系列（黄 / 橙棕 / 红粉 / 灰白黑 / 紫 / 绿 / 青蓝）在界面上不存在。
 * 另外每个色格按钮的 title 都调用一次 getColorUsage()，而它内部是
 * `colorFor()` → `getPaletteColors()` 整份克隆 + 线性查找 —— 418 色就是 418 次全色板克隆。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND_PALETTES } from "../smart-preprocessing/palette-brands.mjs";
import { filterPaletteColors, listPaletteSeries } from "../services/palette-series.mjs";

const root = new URL("../", import.meta.url);
const workspaceSource = readFileSync(new URL("ui/workspace.js", root), "utf8");

test("§4 系列片来自 registry 元数据：盼盼在 UI 上真的会有 7 个中文系列片", () => {
  const panpan = BRAND_PALETTES.find((brand) => brand.id === "panpanOfficial").colors;
  // 模拟运行时的色板条目（buildPaletteVariant 之后带 code/hex/group）
  const runtime = panpan.map((color) => ({ code: color.code, hex: "#000000", rgb: color.rgb, group: color.group }));
  const chips = listPaletteSeries(runtime);
  assert.deepEqual(chips.map((chip) => chip.key), ["黄", "橙棕", "红粉", "灰白黑", "紫", "绿", "青蓝"]);
  assert.deepEqual(chips.map((chip) => chip.label), ["黄", "橙棕", "红粉", "灰白黑", "紫", "绿", "青蓝"]);
  // 每个系列片都带色数（§12 要求「共 X 色」可读）
  assert.deepEqual(chips.map((chip) => chip.count), [25, 49, 52, 47, 35, 30, 51]);
  // 点系列片后筛选结果与该系列色数一致
  assert.equal(filterPaletteColors(runtime, { series: "黄" }).length, 25);
});

test("§3/§4 picker 不再用 code 前缀猜系列（源码级守卫）", () => {
  const codeOnly = workspaceSource.split("\n")
    .filter((line) => { const t = line.trim(); return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*")); })
    .join("\n");
  assert.doesNotMatch(codeOnly, /code\.match\(\/\^\[A-Z\]\+\/\)/);
  assert.doesNotMatch(codeOnly, /code\.startsWith\(.*paletteCategory/);
  // 走模块
  assert.match(workspaceSource, /const seriesList = listPaletteSeries\(palette\)/);
  assert.match(workspaceSource, /filterPaletteColors\(palette, \{ series: series === "all" \? PALETTE_SERIES_ALL : series, query \}\)/);
});

test("§4 系列片渲染出 key / 色数 / 全部项，中文 key 原样进 dataset", () => {
  assert.match(workspaceSource, /data-ws-category="\$\{esc\(entry\.key\)\}"/);
  assert.match(workspaceSource, /\$\{esc\(entry\.label\)\} \$\{entry\.count\}/);
  assert.match(workspaceSource, /data-ws-category="all"/);
  assert.match(workspaceSource, /全部 \$\{palette\.length\}/);
  // 系列为空时不渲染（无系列品牌不该出现空行）
  assert.match(workspaceSource, /: "";\s*$/m);
});

test("§10 惰性渲染：一屏上限 + 「显示其余 N 色」，且不是一次性铺满", () => {
  assert.match(workspaceSource, /const PICKER_PAGE = 120/);
  assert.match(workspaceSource, /const shown = pickerExpanded \? matched : matched\.slice\(0, PICKER_PAGE\)/);
  assert.match(workspaceSource, /id="ws-picker-more"/);
  assert.match(workspaceSource, /显示其余 \$\{matched\.length - shown\.length\} 色/);
  // 展开按钮走事件委托（因为它每次重建）
  assert.match(workspaceSource, /event\.target\.closest\("#ws-picker-more"\)/);
  // 换系列 / 改搜索要把展开状态收回
  assert.match(workspaceSource, /pickerExpanded = false; store\.setState\(\{ editor: \{ paletteCategory: button\.dataset\.wsCategory \} \}\)/);
  assert.match(workspaceSource, /\$\("#ws-color-search"\)\.addEventListener\("input", \(\) => \{ pickerExpanded = false; renderPicker\(\); \}\)/);
});

test("§10 签名守卫：签名不变就不重建色格墙（paint 会被高频调用）", () => {
  assert.match(workspaceSource, /const signature = `\$\{palette\.length\}\|\$\{series\}\|\$\{query\}\|\$\{selectedId\}\|\$\{pickerExpanded\}`/);
  assert.match(workspaceSource, /if \(signature === pickerSignature\) return;/);
});

test("性能：色格墙不再逐色调用 getColorUsage（那是 418 次全色板克隆）", () => {
  // 取色格墙那一段源码
  const start = workspaceSource.indexOf("const cards = shown.map(");
  assert.ok(start > 0, "必须能找到色格墙的 map");
  const segment = workspaceSource.slice(start, start + 700);
  assert.doesNotMatch(segment, /getColorUsage\(/, "色格墙里不得出现 getColorUsage");
  // 改为一次性建表
  assert.match(workspaceSource, /const usage = editorService\.getPaletteUsageCounts\(\);/);
  assert.match(segment, /const used = usage\.get\(id\) \|\| 0;/);
});

test("§13 选中态判定走 readCurrentPaletteId（真源），不是裸读 selectedColor", () => {
  assert.match(workspaceSource, /const selectedId = readCurrentPaletteId\(state\.editor\);/);
  assert.match(workspaceSource, /class="\$\{selectedId === id \? "active" : ""\}"/);
});

test("§9 搜索框保留 H7 / H07 的兼容写法（placeholder 承诺的行为）", () => {
  assert.match(workspaceSource, /placeholder="搜索色号 · H7 \/ H07"/);
  // 归一化只允许在 palette-series 模块里做一次：picker 段里不得出现自己的补零/截断实现。
  // 注意不能对整文件断言 `padStart(` —— ui/workspace.js 里还有一处
  // RGB→hex 的 `channel.toString(16).padStart(2,"0")`，与色号无关。
  const pickerSegment = workspaceSource.slice(workspaceSource.indexOf("function renderPicker()"), workspaceSource.indexOf("const paint = (state, patch = {}) =>"));
  assert.ok(pickerSegment.length > 500, "必须切出 renderPicker 段");
  assert.doesNotMatch(pickerSegment, /padStart\(/, "picker 不得自己补零");
  assert.doesNotMatch(workspaceSource, /\^\(\[A-Za-z\]\*\)0\+/, "workspace 不得重复实现色号归一化正则");
});

test("§22 色号清单数量对用户可见（否则惰性渲染会让人以为色板只有一屏）", () => {
  assert.match(workspaceSource, /id="ws-picker-count"/);
  assert.match(workspaceSource, /\$\{matched\.length\} \/ \$\{palette\.length\} 色/);
  assert.match(workspaceSource, /\$\{palette\.length\} 色`/);
});

test("§2 品牌与规格入口仍在：品牌 select + 色数 select + 色盘容器", () => {
  assert.match(workspaceSource, /<select id="ws-brand"><\/select>/);
  assert.match(workspaceSource, /<select id="ws-palette-size"><\/select>/);
  assert.match(workspaceSource, /id="ws-palette-categories"/);
  assert.match(workspaceSource, /id="ws-bead-picker"/);
  // 旧的 categories 变量（字母去重）必须已经消失
  assert.doesNotMatch(workspaceSource, /const palette = editorService\.getPaletteColors\(\), categories = /);
});
