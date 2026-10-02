/**
 * background-internal-color.test.mjs — Stage B2 §9 §10
 *
 * 内部同色保护：主体**内部**与背景同色的区域（白底图里的白衬衫、眼睛高光、
 * 深色主体里的浅色孔洞）必须原样保留。
 *
 * 这是整个背景功能里最容易出事的地方：这些区域颜色和背景一模一样，
 * 唯一救它们的是「不与图像边框连通」这个不变量。所以这里既验**算法层**的掩码，
 * 也验**生成结果**里那些格确实是豆而不是空。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { BACKGROUND_FIXTURES, materializeFixture, paletteOf, rasterizeSource } from "./background-fixtures.mjs";
import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";
import { resolveBackgroundDecision, BACKGROUND_STATUS } from "../smart-preprocessing/background-reliability.mjs";
import { resolveBackgroundMask } from "../smart-preprocessing/auto-background.mjs";

const dataOf = (id) => materializeFixture(BACKGROUND_FIXTURES.find((f) => f.id === id)).data;

function generate(id, extra = {}) {
  const data = dataOf(id);
  const source = rasterizeSource(data, 4);
  return {
    data,
    result: generateV2({
      source,
      width: data.width,
      height: data.height,
      palette: paletteOf(data),
      options: { preset: "logo", sampling: "center", maxColors: 0, autoBackground: true, ...extra },
    }),
  };
}

test("§9：白底白衣人物（有轮廓）—— 轮廓内每一格都必须保留为豆", () => {
  const fixture = BACKGROUND_FIXTURES.find((f) => f.id === "white-shirt-outline");
  const data = dataOf("white-shirt-outline");
  const { result } = generate("white-shirt-outline");

  assert.equal(result.diagnostics.autoBackground.status, BACKGROUND_STATUS.RELIABLE,
    "白衬衫被清晰轮廓包住，这是可以安全处理的场景");

  let probes = 0;
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      if (!fixture.probe(x, y)) continue;
      probes += 1;
      const cell = result.grid[y][x];
      assert.ok(cell, `衬衫内部 (${x},${y}) 被清空了 —— 内部同色保护失效`);
      assert.deepEqual(cell.rgb, [250, 250, 250], `(${x},${y}) 颜色变了`);
    }
  }
  assert.ok(probes > 200, `探针格太少（${probes}），这条断言等于没测`);
});

test("§9：轮廓本身必须留下来（不能被当成背景擦掉）", () => {
  const data = dataOf("white-shirt-outline");
  const { result } = generate("white-shirt-outline");
  // 轮廓在 (15,13)-(32,40) 的外圈
  for (let x = 15; x <= 32; x += 1) {
    for (const y of [13, 40]) {
      assert.ok(result.grid[y][x], `轮廓 (${x},${y}) 被清空了`);
    }
  }
  for (let y = 13; y <= 40; y += 1) {
    for (const x of [15, 32]) {
      assert.ok(result.grid[y][x], `轮廓 (${x},${y}) 被清空了`);
    }
  }
  // 外部背景确实被清了 —— 否则上面那些断言可能只是因为「什么都没清」
  assert.equal(result.grid[0][0], null, "外部背景应当被清空");
  assert.equal(result.diagnostics.autoBackground.applied, true);
});

test("§10：主体内部的孔洞（与背景同色）保留，不参与连通", () => {
  const fixture = BACKGROUND_FIXTURES.find((f) => f.id === "inner-same-color");
  const data = dataOf("inner-same-color");
  const { result } = generate("inner-same-color");
  assert.equal(result.diagnostics.autoBackground.status, BACKGROUND_STATUS.RELIABLE);

  let holes = 0;
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      if (!fixture.probe(x, y)) continue;
      holes += 1;
      assert.ok(result.grid[y][x], `主体内部孔洞 (${x},${y}) 被清空了`);
    }
  }
  assert.equal(holes, 36, "内部同色块是 6×6");
});

test("§10：孔洞格必须落在掩码之外（结构上就不可能被清）", () => {
  const data = dataOf("inner-same-color");
  const maskResult = resolveBackgroundMask({
    rgbGrid: data.rgbGrid, width: data.width, height: data.height, alphaGrid: data.alphaGrid,
  });
  for (let y = 21; y <= 26; y += 1) {
    for (let x = 21; x <= 26; x += 1) {
      assert.equal(maskResult.backgroundMask[y * data.width + x], 0,
        `(${x},${y}) 是封闭区域却进了掩码 —— flood 穿了主体`);
    }
  }
  assert.ok(maskResult.diagnostics.enclosedKept >= 36, "enclosedKept 至少应覆盖那 36 格");
});

test("§9 §10：白底白衣（无轮廓、颜色接近）—— 结论必须是保持原图，一格都不许动", () => {
  const { data, result } = generate("white-shirt-faint");
  assert.equal(result.diagnostics.autoBackground.status, BACKGROUND_STATUS.UNCERTAIN);
  assert.equal(result.diagnostics.autoBackground.applied, false);
  assert.equal(result.diagnostics.autoBackground.blankedCells, 0);
  for (let y = 0; y < data.height; y += 1) {
    for (let x = 0; x < data.width; x += 1) {
      assert.ok(result.grid[y][x], `uncertain 却动了 (${x},${y}) —— NO-OP 失效`);
    }
  }
});

test("§9：内部同色格被清空时，门必须先一步拦住（反向验证）", () => {
  // 把衬衫的轮廓整条抹掉，让它直接与背景连通 —— 这时「内部同色保护」已经不成立，
  // 系统必须**整体退回 uncertain**，而不是「清掉一部分、留下一部分」。
  const size = 48;
  const rgbGrid = [];
  const grid = [];
  for (let y = 0; y < size; y += 1) {
    const rgbRow = [];
    const gridRow = [];
    for (let x = 0; x < size; x += 1) {
      const rgb = { r: 250, g: 250, b: 250 };
      rgbRow.push(rgb);
      gridRow.push({ code: "W", rgb: [250, 250, 250] });
    }
    rgbGrid.push(rgbRow);
    grid.push(gridRow);
  }
  const decision = resolveBackgroundDecision({ rgbGrid, grid, width: size, height: size });
  assert.notEqual(decision.status, BACKGROUND_STATUS.RELIABLE, "整幅同色时不该给出「可安全移除」");
  assert.equal(decision.mask, null);
  assert.equal(decision.removedCount, 0);
});
