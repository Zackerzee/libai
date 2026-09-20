import test from "node:test";
import assert from "node:assert/strict";
import { generateV2 } from "../../smart-preprocessing/generation-engine-v2.mjs";
import { getMardPalette } from "../../smart-preprocessing/palette-data.mjs";

// 这是 Algorithm Lab renderer 的 cellColor 逻辑的等价实现，用于回归测试。
// 防止「V2 输出结构 ≠ renderer 输入结构」导致黑图。
function cellColor(cell) {
  if (!cell) return null;
  if (Array.isArray(cell.rgb)) return cell.rgb;
  if (cell.rgb && typeof cell.rgb === "object") return [cell.rgb[0], cell.rgb[1], cell.rgb[2]];
  return null;
}

function makeSource(w, h) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    if (x < w / 2) { data[i] = 255; data[i + 1] = 0; data[i + 2] = 0; }
    else { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; }
    data[i + 3] = 255;
  }
  return { data, width: w, height: h };
}

test("V2 grid cells carry array rgb so Lab renderer produces non-black fills", () => {
  const PALETTE = getMardPalette(221);
  const source = makeSource(16, 16);
  const r = generateV2({ source, width: 8, height: 8, palette: PALETTE, options: { preset: "photo", maxColors: 0 } });

  // grid 结构断言
  const cell = r.grid[0][0];
  assert.ok(cell, "grid cell must be non-null");
  assert.equal(typeof cell.code, "string");
  assert.ok(Array.isArray(cell.rgb), `cell.rgb must be array, got ${typeof cell.rgb}`);

  // renderer cellColor 必须返回非 null 的 rgb
  let nonBlackFills = 0;
  let totalFills = 0;
  const fillColors = new Set();
  for (let y = 0; y < r.height; y++) {
    for (let x = 0; x < r.width; x++) {
      const rgb = cellColor(r.grid[y][x]);
      if (rgb) {
        totalFills++;
        if (rgb[0] + rgb[1] + rgb[2] > 30) nonBlackFills++;
        fillColors.add(`${rgb[0]},${rgb[1]},${rgb[2]}`);
      }
    }
  }

  assert.equal(totalFills, r.width * r.height, "every cell should yield a fill");
  assert.equal(nonBlackFills, totalFills, "no fill should be black");
  assert.ok(fillColors.size >= 2, `expected >=2 distinct colors, got ${fillColors.size}`);
});

test("PaletteEngine.match returns code+rgb+hex structure consistent with renderer", async () => {
  const { createPaletteEngine } = await import("../../smart-preprocessing/palette-engine.mjs");
  const PALETTE = getMardPalette(221);
  const engine = createPaletteEngine(PALETTE);
  const m = engine.match([255, 0, 0]);
  assert.ok(m, "match must return a color");
  assert.equal(typeof m.code, "string");
  assert.ok(Array.isArray(m.rgb), "matched color rgb must be array");
  assert.equal(m.rgb.length, 3);
});
