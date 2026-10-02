/**
 * background-transparent-source.test.mjs — Stage B2 §11
 *
 * 「透明 ≠ 纯色背景」。
 *
 * 采样引擎对透明像素是直接跳过的，于是透明区在采样色网格里表现为 `null`，
 * 而 auto-background 的旧逻辑把「缺失」当成「背景候选」。两者一叠加，
 * 一张全透明 PNG 会被判成「检测到浅色背景」—— 这是把两种完全不同的证据
 * 混成了一种。这一组测试把这条边界钉死：
 *   · 传 alphaGrid 时，透明格既不是候选，也不计入候选总数；
 *   · 透明区在最终 grid 里仍然是 null（它本来就该是空的）；
 *   · 不传 alphaGrid 时行为与 B2 之前一致（向后兼容）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_FIXTURES, buildFixtureData, materializeFixture, paletteOf, rasterizeSource, CLEAR, OPAQUE } from "./background-fixtures.mjs";
import { resolveBackgroundMask } from "../smart-preprocessing/auto-background.mjs";
import { resolveBackgroundDecision, BACKGROUND_STATUS } from "../smart-preprocessing/background-reliability.mjs";
import { buildAlphaGrid, generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";

const dataOf = (id) => materializeFixture(BACKGROUND_FIXTURES.find((f) => f.id === id)).data;

test("§11：透明 PNG 的结论是 none，不是「检测到背景」", () => {
  const data = dataOf("transparent-png");
  const decision = resolveBackgroundDecision({
    rgbGrid: data.rgbGrid, alphaGrid: data.alphaGrid, grid: data.grid,
    width: data.width, height: data.height,
  });
  assert.equal(decision.status, BACKGROUND_STATUS.NONE);
  assert.equal(decision.mask, null);
  assert.equal(decision.removedCount, 0);
  assert.match(decision.reason, /透明|没有纯色背景|没有可用的颜色像素/);
});

test("§11：透明格不计入候选总数（这正是「不混淆两种证据」的机械口径）", () => {
  const data = dataOf("transparent-png");
  const withAlpha = resolveBackgroundMask({
    rgbGrid: data.rgbGrid, width: data.width, height: data.height, alphaGrid: data.alphaGrid,
  });
  const withoutAlpha = resolveBackgroundMask({
    rgbGrid: data.rgbGrid, width: data.width, height: data.height,
  });
  const transparent = 48 * 48 - 20 * 20; // 中间 20×20 是不透明主体，其余全透明
  assert.equal(withAlpha.diagnostics.transparentCells, transparent, "透明格数不对");
  assert.equal(withAlpha.diagnostics.totalCandidates, 0, "透明格不该成为候选");
  assert.equal(withoutAlpha.diagnostics.totalCandidates, transparent,
    "不传 alphaGrid 时透明格会被当成候选（旧行为）—— 这正是要修的那件事");
  assert.ok(withoutAlpha.diagnostics.totalCandidates > withAlpha.diagnostics.totalCandidates);
});

test("§11：全透明图不能产出任何背景结论", () => {
  const size = 16;
  const data = buildFixtureData(size, size, () => ({ rgb: null, alpha: CLEAR }));
  const decision = resolveBackgroundDecision({
    rgbGrid: data.rgbGrid, alphaGrid: data.alphaGrid, grid: data.grid, width: size, height: size,
  });
  assert.equal(decision.status, BACKGROUND_STATUS.NONE);
  assert.equal(decision.mask, null);
  assert.equal(decision.detail.transparentCells, size * size);
  assert.equal(decision.detail.borderCandidates, 0);
});

test("§11：透明区在最终 grid 里仍然是 null（它本来就该是空的）", () => {
  const data = dataOf("transparent-png");
  const source = rasterizeSource(data, 4);
  const result = generateV2({
    source, width: data.width, height: data.height, palette: paletteOf(data),
    options: { preset: "logo", sampling: "center", maxColors: 0, autoBackground: true },
  });
  let transparent = 0;
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      if (data.alphaGrid[y * data.width + x] !== CLEAR) continue;
      transparent += 1;
      assert.equal(result.grid[y][x], null, `透明格 (${x},${y}) 被填了颜色`);
    }
  }
  assert.ok(transparent > 1000, "夹具应当有大量透明格");
  // 不透明的主体必须留着
  assert.ok(result.grid[20][20], "不透明主体被清空了");
  assert.equal(result.diagnostics.autoBackground.applied, false, "透明图不该触发任何移除");
});

test("§11：不透明 + 纯色底的图，透明格与背景格各走各的路", () => {
  // 左半是真正的纯白背景，右半是透明区。背景该被清，透明区不该提供任何背景证据。
  const size = 24;
  const data = buildFixtureData(size, size, (x, y) => {
    if (x >= 16 && x <= 19 && y >= 8 && y <= 15) return { rgb: { r: 30, g: 30, b: 34 }, alpha: OPAQUE };
    if (x >= 12) return { rgb: null, alpha: CLEAR };
    return { rgb: { r: 250, g: 250, b: 250 }, alpha: OPAQUE };
  });
  const maskResult = resolveBackgroundMask({
    rgbGrid: data.rgbGrid, width: size, height: size, alphaGrid: data.alphaGrid,
  });
  // 透明区（x >= 12）一格都不该进掩码
  for (let y = 0; y < size; y += 1) {
    for (let x = 12; x < size; x += 1) {
      assert.equal(maskResult.backgroundMask[y * size + x], 0, `透明格 (${x},${y}) 进了掩码`);
    }
  }
  assert.equal(maskResult.diagnostics.transparentCells, 12 * size - 32,
    "透明区是 x≥12 的 12 列，扣掉落在里面的 4×8 主体");
});

test("§11：buildAlphaGrid 与采样引擎的 alpha 口径一致（阈值 8）", () => {
  const W = 4;
  const data = new Uint8ClampedArray(W * W * 4);
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const i = (y * W + x) * 4;
      data[i] = 200; data[i + 1] = 200; data[i + 2] = 200;
      data[i + 3] = x < 2 ? 0 : 255;   // 左半透明
    }
  }
  const grid = buildAlphaGrid({ data, width: W, height: W }, W, W);
  assert.equal(grid.length, W * W);
  for (let y = 0; y < W; y += 1) {
    for (let x = 0; x < W; x += 1) {
      assert.equal(grid[y * W + x], x < 2 ? CLEAR : OPAQUE, `(${x},${y}) alpha 判定不符`);
    }
  }
});

test("§11：半透明（alpha ≤ 8）算透明，alpha > 8 算不透明 —— 与采样引擎同一条线", () => {
  const W = 2;
  const data = new Uint8ClampedArray(W * W * 4);
  const alphas = [0, 8, 9, 255];
  for (let i = 0; i < 4; i += 1) {
    data[i * 4] = 120; data[i * 4 + 1] = 120; data[i * 4 + 2] = 120;
    data[i * 4 + 3] = alphas[i];
  }
  const grid = buildAlphaGrid({ data, width: W, height: W }, W, W);
  assert.deepEqual([...grid], [CLEAR, CLEAR, OPAQUE, OPAQUE]);
});
