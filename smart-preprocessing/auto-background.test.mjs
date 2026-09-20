/**
 * auto-background.test.mjs — 自动背景识别（保留空白点）单元测试
 * 运行：node --test smart-preprocessing/auto-background.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";
import {
  resolveBackgroundMask,
  applyBackgroundBlanks,
  DEFAULT_BACKGROUND_CONFIG,
} from "./auto-background.mjs";

const G = (r, g, b) => ({ r, g, b });
// 由 fillFn(x,y) 生成 rgbGrid
function makeRgbGrid(w, h, fillFn) {
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(fillFn(x, y));
    grid.push(row);
  }
  return grid;
}
// 由 fillFn(x,y) 生成色卡 grid（用于 applyBackgroundBlanks）
function makeColorGrid(w, h, fillFn) {
  const grid = [];
  for (let y = 0; y < h; y++) {
    const row = [];
    for (let x = 0; x < w; x++) row.push(fillFn(x, y));
    grid.push(row);
  }
  return grid;
}
const cellOf = (rgb) => ({ code: `c${rgb.r},${rgb.g},${rgb.b}`, name: "c", hex: "#000", rgb: [rgb.r, rgb.g, rgb.b] });

test("纯白背景整幅清空", () => {
  const w = 10, h = 10;
  const rgbGrid = makeRgbGrid(w, h, () => G(250, 250, 250));
  const { backgroundMask, regionCount } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  for (let i = 0; i < w * h; i++) assert.equal(backgroundMask[i], 1);
  assert.equal(regionCount, 1);
  const grid = makeColorGrid(w, h, () => cellOf(G(250, 250, 250)));
  const { blankCells } = applyBackgroundBlanks({ grid, mask: backgroundMask, width: w, height: h });
  assert.equal(blankCells.length, w * h);
});

test("构造性不变量：被非背景色包围的 6×6 纯白区全部保留（36 格）", () => {
  const w = 20, h = 20;
  const WHITE = G(250, 250, 250);
  const DARK = G(30, 30, 30);
  const rgbGrid = makeRgbGrid(w, h, (x, y) => {
    if (x >= 7 && x <= 12 && y >= 7 && y <= 12) return WHITE; // 中心白
    if (x >= 6 && x <= 13 && y >= 6 && y <= 13 && (x === 6 || x === 13 || y === 6 || y === 13)) return DARK; // 暗环
    return WHITE; // 外部浅色（连边框）
  });
  const { backgroundMask, diagnostics } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  // 中心 36 格必须保留（mask=0）
  let kept = 0;
  for (let y = 7; y <= 12; y++) {
    for (let x = 7; x <= 12; x++) {
      assert.equal(backgroundMask[y * w + x], 0, `中心白(${x},${y}) 不应被当背景`);
      kept++;
    }
  }
  assert.equal(kept, 36);
  assert.equal(diagnostics.enclosedKept, 36, "封闭白区计入 enclosedKept");
  // 暗环 28 格不是候选，也不应被清空
  assert.equal(backgroundMask[6 * w + 6], 0);

  const grid = makeColorGrid(w, h, (x, y) => {
    if (x >= 7 && x <= 12 && y >= 7 && y <= 12) return cellOf(WHITE);
    if (x >= 6 && x <= 13 && y >= 6 && y <= 13 && (x === 6 || x === 13 || y === 6 || y === 13)) return cellOf(DARK);
    return cellOf(WHITE);
  });
  const { blankCells } = applyBackgroundBlanks({ grid, mask: backgroundMask, width: w, height: h });
  // 外圈浅色 = 400 - 28(暗环) - 36(中心) = 336
  assert.equal(blankCells.length, 336);
  for (const { x, y } of blankCells) {
    assert.ok(!(x >= 7 && x <= 12 && y >= 7 && y <= 12), "blankCells 不得含中心白");
  }
});

test("更大的封闭浅色区（10×10）无论多大都保留", () => {
  const w = 30, h = 30;
  const rgbGrid = makeRgbGrid(w, h, (x, y) =>
    (x >= 10 && x <= 19 && y >= 10 && y <= 19) ? G(250, 250, 250) // 封闭白区
      : (x <= 3 || x >= 26 || y <= 3 || y >= 26) ? G(250, 250, 250) // 边框浅色
        : G(30, 30, 30)); // 暗环，把白区与边框隔开
  // 这里白区被暗环包围（不接触边框），应保留；外圈浅色接触边框被清
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  let kept = 0;
  for (let y = 10; y <= 19; y++) for (let x = 10; x <= 19; x++) if (backgroundMask[y * w + x] === 0) kept++;
  assert.equal(kept, 100, "10×10 封闭白区全部保留");
});

test("亮度门槛：暗色边框格不被当背景", () => {
  const w = 4, h = 4;
  const rgbGrid = makeRgbGrid(w, h, (x, y) =>
    (x === 0 && y === 0) ? G(60, 60, 60) : G(250, 250, 250));
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(backgroundMask[0], 0, "暗角不应是背景");
  assert.equal(backgroundMask[1], 1, "其余浅色是背景");
});

test("彩度门槛：高饱和浅黄边框格不被当背景", () => {
  const w = 4, h = 4;
  const yellow = G(255, 255, 120); // 亮但高彩度
  const lab = rgbToLab([yellow.r, yellow.g, yellow.b]);
  assert.ok(Math.hypot(lab[1], lab[2]) > DEFAULT_BACKGROUND_CONFIG.chromaThreshold, "自证：黄为高彩度");
  const rgbGrid = makeRgbGrid(w, h, (x, y) => (x === 0 && y === 0) ? yellow : G(250, 250, 250));
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(backgroundMask[0], 0, "高饱和浅色不是背景");
});

test("边框连通性：仅左边缘浅色被删，中间孤岛保留", () => {
  const w = 10, h = 10;
  const rgbGrid = makeRgbGrid(w, h, (x, y) => {
    if (x === 0) return G(250, 250, 250); // 左边缘（连边框）
    if (x >= 4 && x <= 6 && y >= 4 && y <= 6) return G(250, 250, 250); // 中间孤岛
    return G(30, 30, 30); // 其余深
  });
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(backgroundMask[5 * w + 0], 1, "左边缘浅色清空");
  assert.equal(backgroundMask[5 * w + 5], 0, "中间孤岛保留");
});

test("maxColorDelta 阻止背景穿进异色图案（pink 边框 vs cyan 封闭）", () => {
  const w = 12, h = 12;
  const pink = G(255, 224, 233); // 边框背景
  const cyan = G(215, 245, 250); // 封闭异色浅区
  const dE = deltaE2000(rgbToLab([pink.r, pink.g, pink.b]), rgbToLab([cyan.r, cyan.g, cyan.b]));
  assert.ok(dE > 18 && dE < 100, `自证 ΔE=${dE.toFixed(1)} 落在 (18,100)`);
  const rgbGrid = makeRgbGrid(w, h, (x, y) =>
    (x === 0 || x === w - 1 || y === 0 || y === h - 1) ? pink : cyan);
  const at18 = resolveBackgroundMask({ rgbGrid, width: w, height: h, options: { maxColorDelta: 18 } });
  const at100 = resolveBackgroundMask({ rgbGrid, width: w, height: h, options: { maxColorDelta: 100 } });
  // 边框粉环一律清空
  assert.equal(at18.backgroundMask[0], 1);
  // 封闭 cyan 在 18 下保留，在 100 下被漏入
  assert.equal(at18.backgroundMask[5 * w + 5], 0, "ΔE 门槛阻止背景漏进封闭异色区");
  assert.equal(at100.backgroundMask[5 * w + 5], 1, "放宽门槛后背景渗入异色区");
  assert.ok(at18.diagnostics.floodedCells < at100.diagnostics.floodedCells);
});

test("全图都是背景的退化情况", () => {
  const w = 8, h = 8;
  const rgbGrid = makeRgbGrid(w, h, () => G(250, 250, 250));
  const { backgroundMask, regionCount, diagnostics } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(regionCount, 1);
  assert.equal(diagnostics.floodedCells, w * h);
  for (let i = 0; i < w * h; i++) assert.equal(backgroundMask[i], 1);
});

test("空输入：mask 长度为 0", () => {
  const { backgroundMask, regionCount } = resolveBackgroundMask({ rgbGrid: [], width: 0, height: 0 });
  assert.equal(backgroundMask.length, 0);
  assert.equal(regionCount, 0);
});

test("1×1 白格", () => {
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid: [[G(250, 250, 250)]], width: 1, height: 1 });
  assert.equal(backgroundMask.length, 1);
  assert.equal(backgroundMask[0], 1);
});

test("diagnostics.borderCandidates 计数正确", () => {
  const w = 3, h = 3;
  const rgbGrid = makeRgbGrid(w, h, (x, y) =>
    (x === 1 && y === 1) ? G(30, 30, 30) : G(250, 250, 250));
  const { diagnostics } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  // 边框 8 格都应是候选（中心深色不是边框）
  assert.equal(diagnostics.borderCandidates, 8);
});

test("封闭白区存在时 enclosedKept > 0", () => {
  const w = 20, h = 20;
  const WHITE = G(250, 250, 250);
  const DARK = G(30, 30, 30);
  const rgbGrid = makeRgbGrid(w, h, (x, y) => {
    if (x >= 7 && x <= 12 && y >= 7 && y <= 12) return WHITE;
    if (x >= 6 && x <= 13 && y >= 6 && y <= 13 && (x === 6 || x === 13 || y === 6 || y === 13)) return DARK;
    return WHITE;
  });
  const { diagnostics } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(diagnostics.enclosedKept, 36);
});

test("非边框浅色岛不清除", () => {
  const w = 10, h = 10;
  const rgbGrid = makeRgbGrid(w, h, (x, y) =>
    (x >= 4 && x <= 6 && y >= 4 && y <= 6) ? G(250, 250, 250) : G(30, 30, 30));
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(backgroundMask[5 * w + 5], 0, "孤岛不接触边框 → 保留");
});

test("lightnessThreshold 配置：调低门槛后中灰被当背景", () => {
  const w = 4, h = 4;
  const gray = G(150, 150, 150); // L≈62，<88
  const rgbGrid = makeRgbGrid(w, h, (x, y) => (x === 0 && y === 0) ? gray : G(250, 250, 250));
  assert.equal(resolveBackgroundMask({ rgbGrid, width: w, height: h }).backgroundMask[0], 0, "默认门槛下中灰不是背景");
  assert.equal(resolveBackgroundMask({ rgbGrid, width: w, height: h, options: { lightnessThreshold: 40 } }).backgroundMask[0], 1, "降门槛后中灰是背景");
});

test("chromaThreshold 配置：调低门槛后近中性浅粉被排除", () => {
  const w = 4, h = 4;
  const pink = G(255, 224, 233); // 彩度 12.1，默认(14)是候选
  const rgbGrid = makeRgbGrid(w, h, (x, y) => (x === 0 && y === 0) ? pink : G(30, 30, 30));
  assert.equal(resolveBackgroundMask({ rgbGrid, width: w, height: h }).backgroundMask[0], 1, "默认门槛下浅粉是背景");
  assert.equal(resolveBackgroundMask({ rgbGrid, width: w, height: h, options: { chromaThreshold: 10 } }).backgroundMask[0], 0, "提门槛后浅粉不是背景");
});

test("null 像素（缺失）视为背景候选并与边框连通清空", () => {
  const w = 5, h = 5;
  const rgbGrid = makeRgbGrid(w, h, (x, y) => (y === 0) ? null : G(30, 30, 30));
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  // 顶行（y=0）全为 null，且接触边框 → 应被清空
  for (let x = 0; x < w; x++) assert.equal(backgroundMask[x], 1, `顶行 null 格(${x},0) 应清空`);
});

test("多区域：左右浅色带（被深带隔开）regionCount=2", () => {
  const w = 10, h = 10;
  const rgbGrid = makeRgbGrid(w, h, (x) => (x === 0 || x === w - 1) ? G(250, 250, 250) : G(30, 30, 30));
  const { regionCount, diagnostics } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  assert.equal(regionCount, 2);
  assert.equal(diagnostics.floodedCells, 20);
});

test("blankCells 不含原本为 null 的格（真空豆不重复清）", () => {
  const w = 5, h = 5;
  const WHITE = G(250, 250, 250);
  const rgbGrid = makeRgbGrid(w, h, () => WHITE);
  const { backgroundMask } = resolveBackgroundMask({ rgbGrid, width: w, height: h });
  // 构造 grid：其中 (0,0) 本来就是 null
  const grid = makeColorGrid(w, h, () => cellOf(WHITE));
  grid[0][0] = null;
  const { blankCells } = applyBackgroundBlanks({ grid, mask: backgroundMask, width: w, height: h });
  assert.equal(blankCells.length, w * h - 1, "原 null 格不计入 blankCells");
  assert.ok(!blankCells.some(({ x, y }) => x === 0 && y === 0));
});

test("DEFAULT_BACKGROUND_CONFIG 冻结且默认值正确", () => {
  assert.ok(Object.isFrozen(DEFAULT_BACKGROUND_CONFIG));
  assert.equal(DEFAULT_BACKGROUND_CONFIG.lightnessThreshold, 88);
  assert.equal(DEFAULT_BACKGROUND_CONFIG.chromaThreshold, 14);
  assert.equal(DEFAULT_BACKGROUND_CONFIG.maxColorDelta, 18);
});
