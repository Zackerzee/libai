/**
 * background-gradient.test.mjs — Stage B2 §12
 *
 * 渐变背景必须**降级**，不许靠放大容差硬抠。
 *
 * 这是「宁可不去背景」原则最容易被违反的地方：把 `maxColorDelta` 从 18 提到 100，
 * flood fill 立刻就能把整块渐变吞下去 —— 看起来「成功了」，实际上阈值已经被调成
 * 一个对任何图都成立的值。所以这里验两件事：
 *   1. 渐变图的结论是 uncertain，一格都不动；
 *   2. **就算调用方显式放大容差**，可靠性门照样拦住它（门槛与容差是两回事）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKGROUND_FIXTURES, materializeFixture, paletteOf, rasterizeSource } from "./background-fixtures.mjs";
import { resolveBackgroundDecision, BACKGROUND_STATUS, DEFAULT_RELIABILITY_CONFIG } from "../smart-preprocessing/background-reliability.mjs";
import { DEFAULT_BACKGROUND_CONFIG } from "../smart-preprocessing/auto-background.mjs";
import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";

const dataOf = (id) => materializeFixture(BACKGROUND_FIXTURES.find((f) => f.id === id)).data;

const decide = (id, options) => {
  const data = dataOf(id);
  return resolveBackgroundDecision({
    rgbGrid: data.rgbGrid, alphaGrid: data.alphaGrid, grid: data.grid,
    width: data.width, height: data.height, options,
  });
};

test("§12：浅灰渐变背景 → uncertain，且一格都不移除", () => {
  const decision = decide("gray-gradient");
  assert.equal(decision.status, BACKGROUND_STATUS.UNCERTAIN);
  assert.equal(decision.mask, null);
  assert.equal(decision.removedCount, 0);
  assert.ok(decision.reason, "必须给出可读原因");
  assert.match(decision.reason, /一致|渐变|接近/);
});

test("§12：渐变图在真实生成里也不动一格", () => {
  const data = dataOf("gray-gradient");
  const result = generateV2({
    source: rasterizeSource(data, 4),
    width: data.width,
    height: data.height,
    palette: paletteOf(data),
    options: { preset: "logo", sampling: "center", maxColors: 0, autoBackground: true },
  });
  const diag = result.diagnostics.autoBackground;
  assert.equal(diag.status, BACKGROUND_STATUS.UNCERTAIN);
  assert.equal(diag.applied, false);
  assert.equal(diag.blankedCells, 0);
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      assert.ok(result.grid[y][x], `(${x},${y}) 被清空了 —— 渐变图必须 NO-OP`);
    }
  }
});

test("§12：**放大容差不能绕过可靠性门** —— 这是本阶段最重要的一条纪律", () => {
  const strict = decide("gray-gradient");
  const widened = decide("gray-gradient", { maxColorDelta: 100, lightnessThreshold: 40 });
  assert.equal(strict.status, BACKGROUND_STATUS.UNCERTAIN);
  assert.equal(
    widened.status,
    BACKGROUND_STATUS.UNCERTAIN,
    "把容差调到 100 就能通过 —— 说明门可以被「调参数」绕过，等于没有门",
  );
  assert.equal(widened.mask, null, "放大容差后仍然不得给出掩码");
  assert.equal(widened.removedCount, 0);
});

test("§12：默认容差没有被本次改动放宽（参数是既有口径）", () => {
  assert.deepEqual(DEFAULT_BACKGROUND_CONFIG, {
    lightnessThreshold: 88,
    chromaThreshold: 14,
    maxColorDelta: 18,
  });
});

test("§12：真正纯色的浅底仍然能过 —— 门没有把「渐变」和「纯色」一起误杀", () => {
  const flat = decide("white-logo");
  assert.equal(flat.status, BACKGROUND_STATUS.RELIABLE);
  assert.ok(flat.metrics.borderConsistency >= DEFAULT_RELIABILITY_CONFIG.borderConsistencyMin);
});

test("§12：算法模块不写回 options（调用方传进来的配置对象不得被就地修改）", () => {
  const options = { maxColorDelta: 22 };
  const snapshot = JSON.stringify(options);
  const data = dataOf("gray-gradient");
  resolveBackgroundDecision({
    rgbGrid: data.rgbGrid, alphaGrid: data.alphaGrid, grid: data.grid,
    width: data.width, height: data.height, options,
  });
  assert.equal(JSON.stringify(options), snapshot, "options 被就地改了 —— 会污染调用方的配置");
});

test("§12：门本身不做「自动放宽容差」的重试（源码里没有重试梯度）", () => {
  const source = readFileSync(new URL("../smart-preprocessing/background-reliability.mjs", import.meta.url), "utf8");
  const codeOnly = source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
  for (const banned of ["retry", "escalate", "maxColorDelta *=", "loosen", "relax"]) {
    assert.ok(!codeOnly.includes(banned), `门里出现了「自动放宽」的痕迹：${banned}`);
  }
});
