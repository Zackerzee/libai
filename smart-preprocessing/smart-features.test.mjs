/**
 * V2.5 智能辅助（C2/C3）集成测试。
 *
 * 覆盖四件事，且都以「默认关闭 = 逐位不变」为前提：
 *  1. 全部关闭时 diagnostics 干净（smartFeatures 全 false，四个分项诊断均为 null）。
 *  2. subjectCrop   ：主体裁剪生效，裁剪后源图变小、主体铺满。
 *  3. autoBackground：边框连通的浅色被清成真空豆；被图案包围的浅色**必须保留**。
 *  4. strokeProtection：线稿像素下采样后进入保护图，抬开清理门槛。
 *  5. accentProtection：降色时锚点色不进入「第一阶段主动合并」。
 *
 * 用 node:test 直接跑，无需浏览器。
 */
import test from "node:test";
import assert from "node:assert/strict";

import { generateV2 } from "./generation-engine-v2.mjs";
import { buildPaletteBudgetPlan } from "./protected-palette-budget-v2.mjs";

/* ---------------- 合成源图 ---------------- */

const BG = [245, 245, 245];
const RED = [200, 40, 40];
const DARK = [18, 18, 18];
const WHITE = [245, 245, 245];
const YELLOW = [250, 240, 40];
const GREEN = [30, 180, 60];
const BLUE = [40, 70, 200];

function makeSource(W = 120, H = 120) {
  const data = new Uint8ClampedArray(W * H * 4);
  const put = (x, y, [r, g, b]) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = (y * W + x) * 4;
    data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
  };
  const rect = (x0, y0, x1, y1, color) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) put(x, y, color);
  };
  // 全幅浅灰背景（会被判为「与边框连通」→ 真背景）
  rect(0, 0, W - 1, H - 1, BG);
  // 主体方块：红底
  rect(30, 30, 89, 89, RED);
  // 主体外缘 6px 近黑描边（线稿），保证细网格下外环能稳定采到深色
  rect(30, 30, 89, 35, DARK);
  rect(84, 30, 89, 89, DARK);
  rect(30, 30, 35, 89, DARK);
  rect(30, 84, 89, 89, DARK);
  // 全封闭的白色小区块（必须被保留成白豆，不能被当背景删掉）
  rect(50, 50, 54, 54, WHITE);
  // 鲜艳「眼睛」高光（小面积关键色）—— 足够大以在 24×24 网格下存活成独立色
  rect(56, 44, 65, 53, YELLOW);
  // 一块绿色
  rect(70, 60, 84, 74, GREEN);
  // 一小块蓝色
  rect(40, 70, 46, 76, BLUE);
  return { data, width: W, height: H };
}

const PALETTE = [
  { code: "K00", rgb: [18, 18, 18], hex: "#121212" },     // 深中性（暗锚点）
  { code: "W00", rgb: [245, 245, 245], hex: "#f5f5f5" },  // 亮中性（亮锚点）
  { code: "Y00", rgb: [250, 240, 40], hex: "#faf028" },   // 鲜黄
  { code: "R00", rgb: [200, 40, 40], hex: "#c82828" },    // 鲜红
  { code: "G00", rgb: [30, 180, 60], hex: "#1eb43c" },    // 鲜绿
  { code: "B00", rgb: [40, 70, 200], hex: "#2846c8" },    // 鲜蓝
  { code: "Y10", rgb: [196, 186, 120], hex: "#c4ba78" },  // 暗黄（应被优先合并）
  { code: "R10", rgb: [176, 96, 96], hex: "#b06060" },    // 暗红（应被优先合并）
];

const GRID = 24;
const codesOf = (grid) => [...new Set(grid.flat().filter(Boolean).map((c) => c.code))].sort();

function run(options) {
  return generateV2({ source: makeSource(), width: GRID, height: GRID, palette: PALETTE, options });
}

/* ---------------- 1. 默认关闭：逐位不变 ---------------- */

test("默认（不传智能开关）时，smartFeatures 全 false 且四个分项诊断为 null", () => {
  const r = run({ preset: "photo", maxColors: 0 });
  assert.deepEqual(r.diagnostics.smartFeatures, {
    subjectCrop: false, autoBackground: false, strokeProtection: false, accentProtection: false,
  });
  assert.equal(r.diagnostics.subjectCrop, null);
  assert.equal(r.diagnostics.autoBackground, null);
  assert.equal(r.diagnostics.strokeProtection, null);
  assert.equal(r.diagnostics.accentProtection, null);
  assert.equal(r.diagnostics.accentProtectedColors, 0);
  assert.equal(r.diagnostics.timing.subjectCrop, 0);
  assert.equal(r.diagnostics.timing.autoBackground, undefined);
  assert.equal(r.diagnostics.timing.strokeProtection, undefined);
});

test("显式传 false 与不传等价（grid 逐位相同）", () => {
  const a = run({ preset: "photo", maxColors: 0 });
  const b = run({ preset: "photo", maxColors: 0, subjectCrop: false, autoBackground: false, strokeProtection: false, accentProtection: false });
  assert.deepEqual(codesOf(a.grid), codesOf(b.grid));
  assert.deepEqual(a.grid.map((row) => row.map((c) => (c ? c.code : null))), b.grid.map((row) => row.map((c) => (c ? c.code : null))));
});

test("非布尔真值不会误开开关（严格 === true）", () => {
  const r = run({ preset: "photo", maxColors: 0, subjectCrop: 1, autoBackground: "yes", strokeProtection: {}, accentProtection: [] });
  assert.deepEqual(r.diagnostics.smartFeatures, {
    subjectCrop: false, autoBackground: false, strokeProtection: false, accentProtection: false,
  });
});

/* ---------------- 2. 主体裁剪 ---------------- */

test("subjectCrop：裁掉外围空白，主体铺满画布", () => {
  const r = run({ preset: "photo", maxColors: 0, subjectCrop: true });
  const d = r.diagnostics.subjectCrop;
  assert.equal(r.diagnostics.smartFeatures.subjectCrop, true);
  assert.ok(d, "应产出 subjectCrop 诊断");
  assert.equal(d.applied, true);
  assert.deepEqual(d.sourceSize, { width: 120, height: 120 });
  assert.ok(d.croppedSize.width < 120 && d.croppedSize.height < 120, `裁剪后应变小，实际 ${JSON.stringify(d.croppedSize)}`);
  // 主体外接框应落在原图 30..89 附近（含少量外扩边距）
  assert.ok(d.sourceBox.x <= 31 && d.sourceBox.x >= 28, `sourceBox.x=${d.sourceBox.x}`);
  assert.ok(d.sourceBox.width >= 58 && d.sourceBox.width <= 62, `sourceBox.width=${d.sourceBox.width}`);
});

test("subjectCrop 关闭时，源图外围空白仍被采样（背景豆明显更多）", () => {
  const countBg = (r) => r.grid.flat().filter((c) => c && c.code === "W00").length;
  const cropped = run({ preset: "photo", maxColors: 0, subjectCrop: true });
  const plain = run({ preset: "photo", maxColors: 0 });
  // 未裁剪：四周大片浅色背景都被采成豆；裁剪后只剩很窄的外扩边距
  assert.ok(countBg(plain) > countBg(cropped), `未裁剪背景豆(${countBg(plain)}) 应多于裁剪版(${countBg(cropped)})`);
});

/* ---------------- 3. 自动背景（保留空白点） ---------------- */

test("autoBackground：边框连通浅色清成真空豆，且不误删封闭浅色区", () => {
  const r = run({ preset: "photo", maxColors: 0, autoBackground: true });
  const d = r.diagnostics.autoBackground;
  assert.equal(r.diagnostics.smartFeatures.autoBackground, true);
  assert.ok(d, "应产出 autoBackground 诊断");
  assert.ok(d.blankedCells > 0, `应清掉一些背景格，实际 ${d.blankedCells}`);
  assert.ok(d.regionCount >= 1);
  // 外围背景被清
  assert.equal(r.grid[1][1], null, "左上环境背景应成为真空豆");
  assert.equal(r.grid[0][11], null, "上边框背景应成为真空豆");
  // 封闭白区（源 50..54 → 网格 (10,10)）必须保留成豆
  assert.ok(r.grid[10][10], "被图案包围的白色区必须保留");
  assert.equal(r.grid[10][10].code, "W00");
  // 主体红色保留
  assert.ok(r.grid[12][12], "主体应保留");
});

test("autoBackground 关闭时，边框背景仍被采样成豆（对照）", () => {
  const plain = run({ preset: "photo", maxColors: 0 });
  assert.ok(plain.grid[1][1], "未开自动背景时，背景应仍是豆");
});

/* ---------------- 4. 线稿描边保护 ---------------- */

test("strokeProtection：线稿像素抬进保护图", () => {
  const plain = run({ preset: "photo", maxColors: 0 });
  const stroked = run({ preset: "photo", maxColors: 0, strokeProtection: true });
  const d = stroked.diagnostics.strokeProtection;
  assert.equal(stroked.diagnostics.smartFeatures.strokeProtection, true);
  assert.ok(d, "应产出 strokeProtection 诊断");
  assert.ok(d.strokeCells > 0, `应有格子落在描边上，实际 ${d.strokeCells}`);
  assert.ok(d.raisedAboveThreshold > 0, `应抬开清理门槛，实际 ${d.raisedAboveThreshold}`);
  assert.ok(d.density > 0 && d.density < 1, `描边密度应是有意义的中间值，实际 ${d.density}`);
  // 保护图整体不应变弱
  const sum = (m) => { let s = 0; for (let i = 0; i < m.length; i++) s += m[i]; return s; };
  assert.ok(sum(stroked.diagnostics.protectionMap) > sum(plain.diagnostics.protectionMap), "描边保护应提升总保护量");
});

/* ---------------- 5. 强调色锚点保护 ---------------- */

test("buildPaletteBudgetPlan：protectedKeys 不进第一阶段主动合并", () => {
  const byCode = new Map(PALETTE.map((p) => [p.code, p]));
  const mk = (code, n) => Array.from({ length: n }, () => ({ code, rgb: [...byCode.get(code).rgb] }));
  // 4 色各 3 颗
  const grid = [mk("K00", 3), mk("W00", 3), mk("Y00", 3), mk("R00", 3)];
  const getColorKey = (c) => (c ? c.code : null);
  const getRGBByKey = (k) => byCode.get(k)?.rgb || null;

  const plain = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey, maxColors: 2 });
  const guarded = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey, maxColors: 2, protectedKeys: new Set(["K00"]) });

  assert.equal(plain.length, 2, "不做保护时应合并 2 色");
  assert.equal(guarded.length, 2, "保护后仍应合并 2 色（只是换了对象）");
  assert.ok(!guarded.some((p) => p.from === "K00"), "被保护的 K00 不应出现在计划里");
  assert.ok(plain.some((p) => p.from === "K00"), "无保护时 K00 会参与合并");
});

test("buildPaletteBudgetPlan：确实降不到目标时，保护色才在阶段二被 force 合并", () => {
  const mk = (code, n) => Array.from({ length: n }, () => ({ code, rgb: [10, 10, 10] }));
  const grid = [mk("A", 3), mk("B", 3), mk("C", 3)];
  const getColorKey = (c) => (c ? c.code : null);
  const getRGBByKey = () => [10, 10, 10];
  // 3 色降到 1 色，A、B 都是锚点：阶段一只能并 C，剩 {A,B} 仍超标 →
  // 阶段二必须动锚点，按 importance→key 兜底顺序并掉 A（A 于 B 之前）。
  const plan = buildPaletteBudgetPlan({ grid, getColorKey, getRGBByKey, maxColors: 1, protectedKeys: new Set(["A", "B"]) });
  const aEntries = plan.filter((p) => p.from === "A");
  assert.equal(aEntries.length, 1, "A 最终仍被合并（否则降不到 1 色）");
  assert.equal(aEntries[0].forcedProtected, true, "A 的合并必须被标记为 forcedProtected");
  assert.equal(aEntries[0].protectedByAnchor, true, "A 应带 protectedByAnchor 标记");
});

test("accentProtection：锚点色在降色时被保留，只有数学上无法满足时才强并", () => {
  const full = run({ preset: "photo", maxColors: 0 });
  const fullCodes = codesOf(full.grid);
  assert.ok(fullCodes.length >= 6, `该场景应有足够多颜色，实际 ${JSON.stringify(fullCodes)}`);

  // A) 预算有余量（6 色 → 5）：锚点必须全部保留，且不需要强并
  const roomy = run({ preset: "photo", maxColors: 5, accentProtection: true });
  const dR = roomy.diagnostics.accentProtection;
  assert.equal(roomy.diagnostics.smartFeatures.accentProtection, true);
  assert.ok(dR, "应产出 accentProtection 诊断");
  assert.equal(dR.budgetApplied, true, "该场景色数应超过 maxColors，触发降色");
  assert.ok(dR.anchors.includes("K00"), `深描边 K00 应被认成锚点，实际 ${JSON.stringify(dR.anchors)}`);
  assert.ok(roomy.diagnostics.accentProtectedColors >= 3, `锚点数应 ≥3，实际 ${roomy.diagnostics.accentProtectedColors}`);

  const anchorSet = new Set(dR.anchors);
  const fullAnchors = fullCodes.filter((c) => anchorSet.has(c));
  const fullNonAnchors = fullCodes.filter((c) => !anchorSet.has(c));
  assert.equal(dR.anchorForcedMerges, 0, "非锚点足够消化降色时，不应强并锚点");

  const roomyCodes = codesOf(roomy.grid);
  assert.ok(fullAnchors.every((c) => roomyCodes.includes(c)), `锚点色应全部保留，实际 ${JSON.stringify(roomyCodes)}`);
  const droppedRoomy = fullCodes.filter((c) => !roomyCodes.includes(c));
  assert.equal(droppedRoomy.length, 1, `应恰好并掉 1 色，实际 ${JSON.stringify(droppedRoomy)}`);
  assert.ok(fullNonAnchors.includes(droppedRoomy[0]), `被并掉的 ${droppedRoomy[0]} 必须来自非锚点集`);
  assert.ok(roomyCodes.includes("K00"), "暗描边必须保留");

  // B) 预算不够（6 色 → 4，非锚点只够消化 1 个）：必须强并，且被明确记录
  const tight = run({ preset: "photo", maxColors: 4, accentProtection: true });
  const dT = tight.diagnostics.accentProtection;
  assert.equal(dT.budgetApplied, true);
  assert.equal(dT.anchorForcedMerges, 1, "锚点多于预算余量时，恰好强并 1 个");
  const droppedTight = fullCodes.filter((c) => !codesOf(tight.grid).includes(c));
  assert.equal(droppedTight.length, 2);
  assert.equal(droppedTight.filter((c) => anchorSet.has(c)).length, 1, "只有 1 个锚点被强并");
});

test("accentProtection 开启但无需降色时，仍产出锚点诊断", () => {
  const r = run({ preset: "photo", maxColors: 0, accentProtection: true });
  assert.ok(r.diagnostics.accentProtection, "未触发降色也应能报出认到的锚点");
  assert.equal(r.diagnostics.accentProtection.budgetApplied, false);
  assert.ok(r.diagnostics.accentProtectedColors >= 1);
});

test("accentProtection 关闭时不产出诊断", () => {
  const r = run({ preset: "photo", maxColors: 5 });
  assert.equal(r.diagnostics.accentProtection, null);
});

/* ---------------- 6. 四开关同时开启（小白一键的引擎侧） ---------------- */

test("四开关全开可同时生效且结果确定", () => {
  const opts = { preset: "beginner", maxColors: 6, subjectCrop: true, autoBackground: true, strokeProtection: true, accentProtection: true };
  const a = generateV2({ source: makeSource(), width: GRID, height: GRID, palette: PALETTE, options: opts });
  const b = generateV2({ source: makeSource(), width: GRID, height: GRID, palette: PALETTE, options: opts });
  assert.deepEqual(a.diagnostics.smartFeatures, { subjectCrop: true, autoBackground: true, strokeProtection: true, accentProtection: true });
  assert.deepEqual(a.grid.map((r) => r.map((c) => (c ? c.code : null))), b.grid.map((r) => r.map((c) => (c ? c.code : null))), "确定性");
  assert.ok(a.diagnostics.subjectCrop.applied);
  assert.ok(a.diagnostics.autoBackground.blankedCells > 0);
  assert.ok(a.diagnostics.strokeProtection.raisedAboveThreshold > 0);
  assert.ok(a.diagnostics.accentProtectedColors >= 2);
  // 图纸尺寸口径不变（仍是指定网格）
  assert.equal(a.width, GRID);
  assert.equal(a.height, GRID);
});
