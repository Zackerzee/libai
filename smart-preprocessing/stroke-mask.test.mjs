import { test } from "node:test";
import assert from "node:assert/strict";

import {
  extractStrokeMask,
  dilateMask,
  maskDensity,
  DEFAULT_STROKE_CONFIG,
} from "./stroke-mask.mjs";

/* ---------- 构造工具 ---------- */

function makeImage(W, H, bg = 255) {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) {
    data[i * 4] = bg; data[i * 4 + 1] = bg; data[i * 4 + 2] = bg; data[i * 4 + 3] = 255;
  }
  return { data, width: W, height: H };
}

function setGray(img, x, y, v) {
  const i = (y * img.width + x) * 4;
  img.data[i] = v; img.data[i + 1] = v; img.data[i + 2] = v; img.data[i + 3] = 255;
}

function fillRect(img, x0, y0, w, h, v) {
  for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) setGray(img, x, y, v);
}

function countNonzero(mask) { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i] !== 0) n++; return n; }

// 统计有多少「行」含至少一个非零掩码像素
function nonzeroRows(mask, W, H) {
  let rows = 0;
  for (let y = 0; y < H; y++) {
    let any = false;
    for (let x = 0; x < W; x++) if (mask[y * W + x] !== 0) { any = true; break; }
    if (any) rows++;
  }
  return rows;
}
function nonzeroCols(mask, W, H) {
  let cols = 0;
  for (let x = 0; x < W; x++) {
    let any = false;
    for (let y = 0; y < H; y++) if (mask[y * W + x] !== 0) { any = true; break; }
    if (any) cols++;
  }
  return cols;
}

/* ---------- 1. 水平线：位置正确 + 线宽收敛到 1-2px ---------- */
test("水平 1px 线：掩码在正确行且线宽收敛到 ≤3px", () => {
  const W = 60, H = 60;
  const img = makeImage(W, H, 255);
  fillRect(img, 0, 25, W, 1, 0); // 第 25 行黑线
  const { mask } = extractStrokeMask(img);
  assert.ok(countNonzero(mask) > 0, "掩码应非空");
  assert.ok(nonzeroRows(mask, W, H) <= 3, `线宽应收敛，实际行数 ${nonzeroRows(mask, W, H)}`);
  // 该线应横跨整宽（至少某列在 line 附近有响应）
  let lineHit = false;
  for (let x = 0; x < W; x++) {
    for (let y = 23; y <= 27; y++) if (mask[y * W + x] !== 0) { lineHit = true; break; }
    if (lineHit) break;
  }
  assert.ok(lineHit, "应能在线条附近检测到响应");
});

/* ---------- 2. 垂直线 ---------- */
test("垂直 1px 线：掩码在正确列且线宽收敛到 ≤3px", () => {
  const W = 60, H = 60;
  const img = makeImage(W, H, 255);
  fillRect(img, 30, 0, 1, H, 0);
  const { mask } = extractStrokeMask(img);
  assert.ok(countNonzero(mask) > 0);
  assert.ok(nonzeroCols(mask, W, H) <= 3, `线宽应收敛，实际列数 ${nonzeroCols(mask, W, H)}`);
});

/* ---------- 3. 对角线 ---------- */
test("对角 1px 线：掩码在对角位置非零且线细（每行 ≤3 像素）", () => {
  const W = 60, H = 60;
  const img = makeImage(W, H, 255);
  for (let i = 0; i < 50; i++) setGray(img, 5 + i, 5 + i, 0); // 主对角线一段
  const { mask } = extractStrokeMask(img);
  // 对角线上（主对角线附近）应存在响应
  let onDiagonal = false;
  for (let i = 0; i < 50; i++) {
    const x = 5 + i, y = 5 + i;
    if (mask[y * W + x] !== 0 || mask[y * W + (x + 1)] !== 0 || mask[(y + 1) * W + x] !== 0) { onDiagonal = true; break; }
  }
  assert.ok(onDiagonal, "对角线上应有响应");
  assert.ok(countNonzero(mask) > 0);
  // 对角线跨多行，故用「每行非零数」衡量线宽（应细）
  let maxPerRow = 0;
  for (let y = 0; y < H; y++) {
    let c = 0;
    for (let x = 0; x < W; x++) if (mask[y * W + x] !== 0) c++;
    if (c > maxPerRow) maxPerRow = c;
  }
  assert.ok(maxPerRow <= 3, `对角线描边应细，每行最多 ${maxPerRow} 像素`);
});

/* ---------- 4. 纯黑图 → 全 0 ---------- */
test("纯黑图：掩码全 0（密度 0）", () => {
  const img = makeImage(40, 40, 0);
  const { mask, density } = extractStrokeMask(img);
  assert.strictEqual(countNonzero(mask), 0);
  assert.strictEqual(density, 0);
});

/* ---------- 5. 纯白图 → 全 0 ---------- */
test("纯白图：掩码全 0（密度 0）", () => {
  const img = makeImage(40, 40, 255);
  const { mask, density } = extractStrokeMask(img);
  assert.strictEqual(countNonzero(mask), 0);
  assert.strictEqual(density, 0);
});

/* ---------- 6. 纯黑白棋盘图：掩码非空且 Otsu 回退被触发（回归） ---------- */
test("纯黑白棋盘图：掩码非空且触发 Otsu 回退", () => {
  const N = 160, sq = 20;
  const img = makeImage(N, N, 255);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const bx = (x / sq) | 0, by = (y / sq) | 0;
      if ((bx + by) & 1) setGray(img, x, y, 0);
    }
  }
  const { mask, diagnostics } = extractStrokeMask(img);
  assert.ok(countNonzero(mask) > 0, "纯黑白图掩码不应为空（Otsu 退化回退后）");
  assert.strictEqual(diagnostics.usedFallback, true, "应触发 Otsu 回退");
});

/* ---------- 7. 平滑渐变（无线条）→ 密度明显偏低 ---------- */
test("平滑线性渐变（无线条）：掩码密度明显偏低", () => {
  const W = 80, H = 80;
  const img = makeImage(W, H, 0);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) setGray(img, x, y, Math.round((x / (W - 1)) * 255));
  const { mask, density } = extractStrokeMask(img);
  // 8-bit 量化会在渐变上产生极细的「台阶」边，本应远少于真实线稿；密度须明显低于典型线稿图。
  assert.ok(density < 0.15, `平滑渐变不应被当成大量描边，密度=${density}`);
});

/* ---------- 8. dilateMask：半径 1 → 3x3 ---------- */
test("dilateMask 半径 1：单像素膨胀为 3x3", () => {
  const W = 11, H = 11;
  const mask = new Float32Array(W * H);
  mask[5 * W + 5] = 1;
  const out = dilateMask(mask, W, H, 1);
  let n = 0;
  for (let y = 4; y <= 6; y++) for (let x = 4; x <= 6; x++) if (out[y * W + x] === 1) n++;
  assert.strictEqual(n, 9, "半径1 应膨胀为 3x3=9 个 1");
  assert.ok(out !== mask, "应返回新数组");
});

/* ---------- 9. dilateMask：半径 2 → 5x5 ---------- */
test("dilateMask 半径 2：单像素膨胀为 5x5", () => {
  const W = 13, H = 13;
  const mask = new Float32Array(W * H);
  mask[6 * W + 6] = 1;
  const out = dilateMask(mask, W, H, 2);
  let n = 0;
  for (let y = 4; y <= 8; y++) for (let x = 4; x <= 8; x++) if (out[y * W + x] === 1) n++;
  assert.strictEqual(n, 25);
});

/* ---------- 10. 边界不越界（不抛异常、数组长度不变） ---------- */
test("dilateMask / extractStrokeMask 在边界不越界、长度不变", () => {
  const W = 7, H = 7;
  const img = makeImage(W, H, 255);
  fillRect(img, 0, 0, 7, 1, 0); // 贴边线
  const { mask } = extractStrokeMask(img);
  assert.strictEqual(mask.length, W * H);
  const d = dilateMask(mask, W, H, 3);
  assert.strictEqual(d.length, W * H);
  // 直接调用 dilateMask 也安全
  const m2 = new Float32Array(W * H); m2[0] = 1;
  assert.strictEqual(dilateMask(m2, W, H, 5).length, W * H);
});

/* ---------- 11. mask 是 Float32Array ---------- */
test("extractStrokeMask 的 mask 是 Float32Array", () => {
  const img = makeImage(30, 30, 255);
  fillRect(img, 10, 10, 10, 10, 0);
  const { mask } = extractStrokeMask(img);
  assert.ok(mask instanceof Float32Array, "mask 应为 Float32Array");
});

/* ---------- 12. mask 取值在 [0,1] ---------- */
test("mask 取值全部落在 [0,1]", () => {
  const img = makeImage(50, 50, 255);
  fillRect(img, 15, 15, 20, 20, 0);
  const { mask } = extractStrokeMask(img);
  for (let i = 0; i < mask.length; i++) {
    assert.ok(mask[i] >= 0 && mask[i] <= 1, `mask[${i}]=${mask[i]} 越界`);
  }
});

/* ---------- 13. maskDensity 边界：全 0 → 0 ---------- */
test("maskDensity 全 0 → 0", () => {
  const mask = new Float32Array(100);
  assert.strictEqual(maskDensity(mask), 0);
});

/* ---------- 14. maskDensity 边界：全 1 → 1 ---------- */
test("maskDensity 全 1 → 1", () => {
  const mask = new Float32Array(100).fill(1);
  assert.strictEqual(maskDensity(mask), 1);
});

/* ---------- 15. 1x1 图像：不抛异常、mask 长度 1 ---------- */
test("1x1 图像：不抛异常且 mask 长度 1", () => {
  const img = makeImage(1, 1, 128);
  const { mask, density } = extractStrokeMask(img);
  assert.strictEqual(mask.length, 1);
  assert.strictEqual(density, 0);
});

/* ---------- 16. diagnostics 字段齐全 ---------- */
test("diagnostics 含 gradientMean/gradientMax/otsuThreshold/usedFallback/nmsSuppressed", () => {
  const img = makeImage(40, 40, 255);
  fillRect(img, 10, 10, 20, 20, 0);
  const { diagnostics } = extractStrokeMask(img);
  for (const k of ["gradientMean", "gradientMax", "otsuThreshold", "usedFallback", "nmsSuppressed"]) {
    assert.ok(k in diagnostics, `diagnostics 缺 ${k}`);
  }
  assert.ok(diagnostics.nmsSuppressed >= 0);
});

/* ---------- 17. absoluteThreshold 覆盖 ---------- */
test("absoluteThreshold=0：覆盖 Otsu 且 usedFallback=false", () => {
  const img = makeImage(40, 40, 255);
  fillRect(img, 10, 10, 20, 20, 0);
  const { mask, threshold, density, diagnostics } = extractStrokeMask(img, { absoluteThreshold: 0 });
  assert.strictEqual(threshold, 0);
  assert.strictEqual(diagnostics.usedFallback, false, "提供绝对阈值时不触发回退");
  assert.ok(density > 0, "绝对阈值 0 应把边缘判为前景");
});

/* ---------- 18. NMS 细线化：开启后密度低于关闭 ---------- */
test("NMS 开启后描边更细（密度低于关闭）", () => {
  const W = 60, H = 60, cy = 30, sigma = 3;
  const img = makeImage(W, H, 255);
  for (let y = 0; y < H; y++) {
    const v = Math.round(255 * Math.exp(-((y - cy) ** 2) / (2 * sigma * sigma)));
    for (let x = 0; x < W; x++) setGray(img, x, y, v);
  }
  const withNms = extractStrokeMask(img, { enableNms: true });
  const withoutNms = extractStrokeMask(img, { enableNms: false });
  assert.ok(withNms.density < withoutNms.density, `NMS 应更细：with=${withNms.density} > without=${withoutNms.density}`);
});

/* ---------- 19. threshold 报告 = absoluteThreshold ---------- */
test("提供 absoluteThreshold 时 threshold 字段等于它且 usedFallback=false", () => {
  const img = makeImage(40, 40, 255);
  fillRect(img, 10, 10, 20, 20, 0);
  const { threshold, diagnostics } = extractStrokeMask(img, { absoluteThreshold: 12 });
  assert.strictEqual(threshold, 12);
  assert.strictEqual(diagnostics.usedFallback, false);
});

/* ---------- 20. maskDensity 与返回的 density 一致 ---------- */
test("返回的 density 与 maskDensity(result.mask) 一致", () => {
  const img = makeImage(50, 50, 255);
  fillRect(img, 15, 15, 20, 20, 0);
  const { mask, density } = extractStrokeMask(img);
  assert.ok(Math.abs(density - maskDensity(mask)) < 1e-9);
});

/* ---------- 21. 默认配置存在 ---------- */
test("DEFAULT_STROKE_CONFIG 含 absoluteThreshold / otsuBins", () => {
  assert.strictEqual(DEFAULT_STROKE_CONFIG.absoluteThreshold, null);
  assert.strictEqual(DEFAULT_STROKE_CONFIG.otsuBins, 256);
});
