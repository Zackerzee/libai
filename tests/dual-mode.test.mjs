/**
 * §7 Dual Mode 契约测试。
 *
 * 重点不是「它改了多少格」，而是**四条门各自真的挡得住**：
 *   ① pixel share 足够   ② ΔL / ΔE 足够   ③ 有结构价值   ④ 不是单个异常像素
 * 外加一条实测补上去的上下文支配度门（见 dual-mode.mjs 的注释）。
 *
 * 每条门都用**能通过该门其它条件**的夹具去撞它 —— 否则测的是
 * 「夹具同时不满足五条」，哪条起作用无从分辨。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { createDualMode, DEFAULT_DUAL_MODE_OPTIONS } from "../smart-preprocessing/lab/dual-mode.mjs";
import { buildLabBuckets, bucketCoherence } from "../smart-preprocessing/lab/buckets.mjs";
import { CELL_PALETTE, runEngine, codesOf, gridHash, paintSource } from "./b4-candidate-harness.mjs";

const SKIN = [232, 190, 170];
const DARK = [20, 20, 20];
const GRID = 3;
const CELL_PX = 24;

/**
 * 3×3 格网、每格 24px。`paintCell(cx, cy, px, py)` 返回该像素颜色。
 * 用 3×3 而不是 1×1 是必须的：上下文支配度门要向外扩采样框看「四周」，
 * 1×1 的格子扩完框还是自己那一格，那条门就成了恒真的摆设。
 */
function cellSource(paintCell) {
  const size = GRID * CELL_PX;
  return paintSource(size, size, (x, y) => paintCell(Math.floor(x / CELL_PX), Math.floor(y / CELL_PX), x % CELL_PX, y % CELL_PX));
}

/** 中心格 (1,1) 的匹配结果。 */
const centerOf = (grid) => (grid[1][1] ? grid[1][1].code : null);

function runDual(source, options = {}) {
  return runEngine({
    source, width: GRID, height: GRID, palette: CELL_PALETTE,
    options: { sampling: "linear-mean" },
    lab: createDualMode(options),
  });
}

/* =========================================================
 * bucketCoherence：③ 有结构价值 的量具本身
 * ======================================================= */

test("连贯性：单个孤立像素 = 0", () => {
  const source = paintSource(8, 8, (x, y) => (x === 4 && y === 4 ? DARK : SKIN));
  const { buckets, rect, pixelKeys } = buildLabBuckets(source, { x0: 0, y0: 0, x1: 8, y1: 8 }, { withPixelMap: true });
  const dark = buckets.find((b) => b.rgb[0] < 100);
  assert.ok(dark, "应切出暗色桶");
  assert.equal(dark.count, 1);
  assert.equal(bucketCoherence(pixelKeys, rect, dark.key), 0);
});

test("连贯性：3×3 实心块 ≈ 8/9（内部像素互相挨着）", () => {
  const source = paintSource(8, 8, (x, y) => (x >= 3 && x <= 5 && y >= 3 && y <= 5 ? DARK : SKIN));
  const { buckets, rect, pixelKeys } = buildLabBuckets(source, { x0: 0, y0: 0, x1: 8, y1: 8 }, { withPixelMap: true });
  const dark = buckets.find((b) => b.rgb[0] < 100);
  assert.equal(dark.count, 9);
  // 3×3 里 9 个像素全部都有同色 4 邻（四个角各有 2 个）→ 1.0
  assert.equal(bucketCoherence(pixelKeys, rect, dark.key), 1);
});

test("连贯性：1 像素宽的直线 = 1.0（**不惩罚细线**）", () => {
  // 回形纹 / 窗格 / 建筑细线全是这种形状。用「外接框填充率」当判据会
  // 把它们全部误判成噪声 —— 这条用例就是那个坑的守卫。
  const source = paintSource(8, 8, (x, y) => (y === 4 ? DARK : SKIN));
  const { buckets, rect, pixelKeys } = buildLabBuckets(source, { x0: 0, y0: 0, x1: 8, y1: 8 }, { withPixelMap: true });
  const dark = buckets.find((b) => b.rgb[0] < 100);
  assert.equal(dark.count, 8);
  assert.equal(bucketCoherence(pixelKeys, rect, dark.key), 1);
});

test("连贯性：散点（互不相邻）远低于实心块", () => {
  const source = paintSource(8, 8, (x, y) => (((x + y) % 2 === 0) && x < 4 ? DARK : SKIN));
  const { buckets, rect, pixelKeys } = buildLabBuckets(source, { x0: 0, y0: 0, x1: 8, y1: 8 }, { withPixelMap: true });
  const dark = buckets.find((b) => b.rgb[0] < 100);
  // 棋盘格：每个暗像素的 4 邻全是亮的 → 0
  assert.equal(bucketCoherence(pixelKeys, rect, dark.key), 0);
});

/* =========================================================
 * 四条门 + 上下文门
 * ======================================================= */

test("④ 单个异常黑像素 → 整格不变黑（§7 原文明令禁止）", () => {
  const source = cellSource((cx, cy, px, py) => (cx === 1 && cy === 1 && px === 0 && py === 0 ? DARK : SKIN));
  const result = runDual(source);
  const stat = result.diagnostics.lab.detail.dualMode;
  assert.ok(stat.rejectedShare >= 1 || stat.rejectedPixels >= 1, `应因占比或像素数被挡：${JSON.stringify(stat)}`);
  assert.equal(stat.accepted, 0);
  // 中心格必须是肤色，不能是黑
  assert.notEqual(centerOf(result.grid), "T02", "1 个黑像素不该让整格变黑");
});

test("③ 连贯但有结构价值的次模式 → 中心格取次模式（暗色）", () => {
  // 中心格：12×12 / 24×24 = 25% 暗块，实心连贯；四周 8 格全是肤色。
  // 这同时满足 ①(0.25 ≥ 0.18) ②(ΔE 极大) ③(连贯性 1.0) ④(144 ≥ 4)
  // 以及上下文门（扩框后肤色占 93.75%）。
  const source = cellSource((cx, cy, px, py) => {
    if (cx !== 1 || cy !== 1) return SKIN;
    return px < 12 && py < 12 ? DARK : SKIN;
  });
  const result = runDual(source);
  const stat = result.diagnostics.lab.detail.dualMode;
  assert.ok(stat.accepted >= 1, `应有格子被采纳：${JSON.stringify(stat)}`);
  assert.equal(centerOf(result.grid), "T02", "中心格应取暗色（次模式）");
});

test("上下文门：整条边界上的格子（四周黑白对半）不表态", () => {
  // 每一格都是上半暗、下半亮 → 格内 50/50，四周也是 50/50。
  // 格内条件全部满足（① 0.5 ② ΔE 极大 ③ 连贯 1.0 ④ 288 ≥ 4），
  // 只有上下文支配度 ≈ 0.5 < 0.6 挡得住 —— 这条用例专测这一条门。
  const source = cellSource((cx, cy, px) => void cy || px < CELL_PX / 2 ? DARK : SKIN);
  const result = runDual(source);
  const stat = result.diagnostics.lab.detail.dualMode;
  assert.ok(stat.rejectedContext >= 1, `应被上下文门挡住：${JSON.stringify(stat)}`);
  // 首轮 Lab 就是在这里翻的车：B 类的 2px 黑描边被「次模式获胜」吃掉，
  // detailRetention 1.0 → 0.761。
  assert.ok(stat.accepted < GRID * GRID, "不该所有格子都被采纳");
});

test("主桶占比过低（碎花格）不表态", () => {
  // 中心格四象限四种颜色 → 主桶 25% < minPrimaryShare 0.45
  const source = cellSource((cx, cy, px, py) => {
    if (cx !== 1 || cy !== 1) return SKIN;
    const lx = px < CELL_PX / 2 ? 0 : 1;
    const ly = py < CELL_PX / 2 ? 0 : 1;
    return [[SKIN, DARK], [[200, 200, 40], [40, 60, 200]]][ly][lx];
  });
  const result = runDual(source);
  const stat = result.diagnostics.lab.detail.dualMode;
  assert.ok(stat.rejectedPrimaryShare >= 1, `应因主桶占比被挡：${JSON.stringify(stat)}`);
});

/* =========================================================
 * 通用契约
 * ======================================================= */

test("确定性：同一输入跑两次，逐格相同", () => {
  const source = cellSource((cx, cy, px, py) => {
    if (cx !== 1 || cy !== 1) return SKIN;
    return px < 12 && py < 12 ? DARK : SKIN;
  });
  const a = runDual(source);
  const b = runDual(source);
  assert.equal(gridHash(a.grid), gridHash(b.grid));
  assert.equal(codesOf(a.grid), codesOf(b.grid));
});

test("输出只可能是色卡里的色号", () => {
  const source = cellSource((cx, cy, px, py) => {
    if (cx !== 1 || cy !== 1) return SKIN;
    return px < 12 && py < 12 ? DARK : SKIN;
  });
  const result = runDual(source);
  const allowed = new Set(CELL_PALETTE.map((c) => c.code));
  for (const row of result.grid) {
    for (const cell of row) if (cell) assert.ok(allowed.has(cell.code), `越界色号 ${cell.code}`);
  }
});

test("默认参数里 minSecondaryPixels ≥ 4、minCoherence ≥ 0.5（§7 的量化底线）", () => {
  assert.ok(DEFAULT_DUAL_MODE_OPTIONS.minSecondaryPixels >= 4);
  assert.ok(DEFAULT_DUAL_MODE_OPTIONS.minCoherence >= 0.5);
  assert.ok(DEFAULT_DUAL_MODE_OPTIONS.minSecondaryShare >= 0.18);
  assert.ok(DEFAULT_DUAL_MODE_OPTIONS.minSeparation >= 12);
  assert.ok(DEFAULT_DUAL_MODE_OPTIONS.minLightnessDelta >= 8);
});
