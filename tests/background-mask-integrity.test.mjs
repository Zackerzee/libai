/**
 * background-mask-integrity.test.mjs — Stage B2 §8
 *
 * 「掩码必须活到最后一步」：
 *   采样 → 调色板匹配 → Auto Background → 细节保护 → 智能清理 → 降色预算
 *   → Worker 紧凑结果（-1 哨兵）→ 主线程 canonical grid
 *
 * 每一段都可能把 `null` 悄悄填回颜色。这一组测试逐个盯死：
 *   · 被判定为背景的格必须是 null，而且**一路都是 null**；
 *   · 后续的清理 / 降色**不得**把 null 变成颜色（否则「空豆」会自己长回来）；
 *   · 紧凑结果编解码后 null 的位置逐格不变；
 *   · 主线程 commit 段保留 null。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { materializeFixture, paletteOf, rasterizeSource, BACKGROUND_FIXTURES } from "./background-fixtures.mjs";
import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";
import { resolveBackgroundDecision } from "../smart-preprocessing/background-reliability.mjs";
import { countGridColors } from "../smart-preprocessing/protected-palette-budget-v2.mjs";
import { encodeGenerationResult, decodeGenerationResult, GENERATION_NULL_INDEX } from "../services/generation-result-codec.mjs";
import { createGenerationResult } from "../services/generation-request.mjs";

const fixtureData = (id) => {
  const fixture = BACKGROUND_FIXTURES.find((f) => f.id === id);
  assert.ok(fixture, `夹具不存在：${id}`);
  return materializeFixture(fixture).data;
};

function run(id, extra = {}) {
  const data = fixtureData(id);
  const source = rasterizeSource(data, 4);
  const result = generateV2({
    source,
    width: data.width,
    height: data.height,
    palette: paletteOf(data),
    options: { preset: "logo", sampling: "center", maxColors: 0, autoBackground: true, ...extra },
  });
  return { data, result };
}

const nullAt = (grid, x, y) => grid[y][x] === null;
const nullCount = (grid) => grid.flat().filter((cell) => cell === null).length;

test("§8：判定为背景的格，在最终 grid 里逐格都是 null", () => {
  const { data, result } = run("white-logo");
  const decision = resolveBackgroundDecision({
    rgbGrid: data.rgbGrid,
    alphaGrid: data.alphaGrid,
    grid: data.grid,
    width: data.width,
    height: data.height,
  });
  assert.equal(result.diagnostics.autoBackground.status, "reliable");
  assert.ok(decision.mask, "先确认掩码本身非空，否则下面的断言是空转");

  let checked = 0;
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      if (!decision.mask[y * data.width + x]) continue;
      checked += 1;
      assert.ok(nullAt(result.grid, x, y), `(${x},${y}) 被判为背景却没有变成 null —— 掩码在链路里丢了`);
    }
  }
  assert.ok(checked > 1000, `应该检查到足够多的背景格，实得 ${checked}`);
  assert.equal(result.diagnostics.autoBackground.applied, true);
});

test("§8：主体格不得被清空（掩码不许越界）", () => {
  const { data, result } = run("white-logo");
  // 黑色 Logo 在 (16,16)-(31,31)
  for (let y = 16; y <= 31; y += 1) {
    for (let x = 16; x <= 31; x += 1) {
      assert.ok(!nullAt(result.grid, x, y), `(${x},${y}) 是主体却被清空了`);
    }
  }
  assert.equal(nullCount(result.grid), data.width * data.height - 256);
});

test("§8：智能清理不得把 null 填回颜色", () => {
  const { result } = run("white-logo");
  const bg = result.diagnostics.autoBackground;
  assert.ok(bg.blankedCells > 0, "先确认这一版真的清过格子");
  // 口径：每一个 null 格都必须落在掩码里。
  // 只要清理 / 细节保护 / 降色把 null 填回颜色，或者反过来多清了别的格，
  // 这条断言都会红。
  const decision = resolveBackgroundDecision({
    rgbGrid: fixtureData("white-logo").rgbGrid,
    grid: fixtureData("white-logo").grid,
    width: 48, height: 48,
  });
  let nulls = 0;
  for (let y = 0; y < 48; y += 1) {
    for (let x = 0; x < 48; x += 1) {
      if (!nullAt(result.grid, x, y)) continue;
      nulls += 1;
      assert.equal(decision.mask[y * 48 + x], 1, `(${x},${y}) 是 null 但不在掩码里 —— 有别的环节在清格子`);
    }
  }
  assert.equal(nulls, bg.blankedCells, "最终空豆数必须等于 autoBackground 报的清空数");
});

function countNonNull(grid) {
  return grid.flat().filter((cell) => cell !== null).length;
}

test("§8：强制降色（maxColors）之后，空豆仍然是空豆", () => {
  const baseline = run("white-logo");
  const merged = run("white-logo", { maxColors: 2 });
  assert.equal(
    nullCount(merged.result.grid),
    nullCount(baseline.result.grid),
    "降色预算改变了空豆数量 —— 说明预算把 null 当成了一种颜色",
  );
  // 预算确实生效过（否则这条断言没意义）
  const before = baseline.result.diagnostics.colorsAfterCleanup;
  const after = merged.result.diagnostics.colorsAfterBudget;
  assert.ok(after <= before, "maxColors 没有生效");
});

test("§8：颜色计数把 null 排除在外（不会出现「无色」这个色号）", () => {
  const { result } = run("white-logo");
  const usage = countGridColors(result.grid, (cell) => (cell ? cell.code : null));
  for (const [code, count] of usage) {
    assert.ok(code, `统计里出现了空色号：${code}`);
    assert.ok(count > 0);
  }
  assert.equal(
    [...usage.values()].reduce((sum, n) => sum + n, 0),
    countNonNull(result.grid),
    "用色统计的颗数必须等于非空格数",
  );
});

test("§8：紧凑结果契约把 null 编码成 -1，解码后逐格还原", () => {
  const { result } = run("white-logo");
  const envelope = createGenerationResult({
    requestId: 1, grid: result.grid, width: result.width, height: result.height,
  });
  const compact = encodeGenerationResult(envelope);
  assert.equal(compact.nullCount, nullCount(result.grid));
  let sentinel = 0;
  for (let i = 0; i < compact.indices.length; i += 1) {
    if (compact.indices[i] === GENERATION_NULL_INDEX) sentinel += 1;
  }
  assert.equal(sentinel, compact.nullCount, "-1 哨兵数量必须与空豆数一致");

  const decoded = decodeGenerationResult(compact);
  for (let y = 0; y < result.height; y += 1) {
    for (let x = 0; x < result.width; x += 1) {
      assert.equal(
        decoded.grid[y][x] === null,
        result.grid[y][x] === null,
        `(${x},${y}) 编解码后空/非空状态变了`,
      );
    }
  }
});

test("§8：主线程 commit 段显式保留 null（app.js 有 `if (!cell) return null;`）", () => {
  const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
  const marker = "state.grid = result.grid.map((row) => row.map((cell) => {";
  const at = app.indexOf(marker);
  assert.ok(at >= 0, "找不到 V2.5 结果回写段 —— 这段被挪走了，守卫需要跟着更新");
  const segment = app.slice(at, at + 400);
  assert.match(segment, /if \(!cell\) return null;/, "commit 段丢了空豆保护");
});

test("§8：关闭 autoBackground 时结果里没有 null 之外的副作用（对照）", () => {
  const data = fixtureData("white-logo");
  const source = rasterizeSource(data, 4);
  const result = generateV2({
    source, width: data.width, height: data.height, palette: paletteOf(data),
    options: { preset: "logo", sampling: "center", maxColors: 0 },
  });
  assert.equal(result.diagnostics.autoBackground, null, "关闭时不该产出诊断");
  assert.equal(nullCount(result.grid), 0, "关闭时不该清任何格");
});
