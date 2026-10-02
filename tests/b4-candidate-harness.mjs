/**
 * b4-candidate-harness.mjs — §6–§10 候选算法测试的共享夹具。
 *
 * 为什么单独一个文件：9 个候选测试文件如果各自造色板、各自造源图，
 * 就会出现「bean-fit 的测试用的是 12 色板、dual-mode 的测试用的是 8 色板」
 * 这种谁都不算错、但两份结论不可比的情况。§11 的组合矩阵要能横向比，
 * 前提是所有候选在**同一把尺子**上被量过。
 *
 * 这里只放夹具与断言辅助，不放断言本身。
 */

import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";

/** 12 色，色相均匀铺开。相邻色 ΔE 约 25 —— 足够让「换色」这件事可观测。 */
export const CELL_PALETTE = Object.freeze([
  { code: "T01", rgb: [255, 255, 255] },
  { code: "T02", rgb: [0, 0, 0] },
  { code: "T03", rgb: [255, 0, 0] },
  { code: "T04", rgb: [0, 255, 0] },
  { code: "T05", rgb: [0, 0, 255] },
  { code: "T06", rgb: [255, 255, 0] },
  { code: "T07", rgb: [0, 255, 255] },
  { code: "T08", rgb: [255, 0, 255] },
  { code: "T09", rgb: [128, 128, 128] },
  { code: "T10", rgb: [128, 64, 32] },
  { code: "T11", rgb: [200, 160, 140] },
  { code: "T12", rgb: [32, 64, 96] },
]);

export const PALETTE_BY_CODE = new Map(CELL_PALETTE.map((c) => [c.code, c]));
export const rgbOf = (code) => PALETTE_BY_CODE.get(code).rgb;

/** 单色源图。 */
export function solidSource(width, height, rgb) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i += 1) {
    data[i * 4] = rgb[0]; data[i * 4 + 1] = rgb[1];
    data[i * 4 + 2] = rgb[2]; data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

/**
 * 用回调画源图。`paint(x, y)` 返回 `[r,g,b]` 或 `[r,g,b,a]`。
 * 坐标是**源图像素**坐标。
 */
export function paintSource(width, height, paint) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const c = paint(x, y);
      data[i] = c[0]; data[i + 1] = c[1]; data[i + 2] = c[2];
      data[i + 3] = c.length > 3 ? c[3] : 255;
    }
  }
  return { data, width, height };
}

/**
 * 直接打引擎（`generateV2`）。
 *
 * 用 `generateV2` 而不是 `runGenerationPipeline` 是刻意的：
 * 后者会先过 `auto` 路由，而 §12 明确说 auto 误路由是基线缺陷、本轮不许修。
 * 候选算法的单测不该被一个已知有缺陷的路由影响 —— 那会让
 * 「候选没效果」和「候选被路由到了别的模式」长得一样。
 */
export function runEngine({ source, width, height, palette = CELL_PALETTE, options = {}, lab = null }) {
  return generateV2({ source, width, height, palette, options, lab });
}

/** 走完整生产 runner（含模式路由）。集成级断言用它。 */
export function runPipeline({ source, width, height, palette = CELL_PALETTE, mode = "auto", maxColors = 0, overrides = {}, lab = null }) {
  return runGenerationPipeline({
    image: { data: source.data, width: source.width, height: source.height },
    mode,
    size: { width, height },
    palette,
    maxColors,
    overrides,
    lab,
  });
}

/* ── 网格辅助 ─────────────────────────────────────────────────────── */

export const codesOf = (grid) => grid.map((row) => row.map((c) => (c ? c.code : "-")).join(",")).join(";");

export const gridHash = (grid) => {
  let hash = 0x811c9dc5;
  const text = codesOf(grid);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};

export function usedOf(grid) {
  const set = new Set();
  for (const row of grid) for (const cell of row) if (cell) set.add(cell.code);
  return set;
}

export function filledCount(grid) {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell) n += 1;
  return n;
}

/** 空格的位置签名。null 完整性断言靠它，靠计数是不够的 —— 一填一空也能计数不变。 */
export const nullSignature = (grid) => grid.map((row) => row.map((c) => (c ? "." : "X")).join("")).join("/");

/** 造一张 N×N 的网格，颜色由 `at(x,y)` 给（返回 code 或 null）。 */
export function makeGrid(size, at) {
  const grid = [];
  for (let y = 0; y < size; y += 1) {
    const row = [];
    for (let x = 0; x < size; x += 1) {
      const code = at(x, y);
      row.push(code ? { ...PALETTE_BY_CODE.get(code) } : null);
    }
    grid.push(row);
  }
  return grid;
}

/**
 * 造一个 §9 refine 接缝用的 ctx。
 *
 * `sampledRgb` 是 `[y][x] -> [r,g,b] | null` 的二维数组，就是引擎里
 * `sampled.colors` 的形状。不传就按 `source` 的格子均值算 —— 但**单测里
 * 建议显式传**，因为「源图这一格到底是什么色」正是 refine 的唯一输入，
 * 让它由一张大图的均值间接决定，出问题时要倒推两层。
 */
export function makeRefineCtx({
  grid,
  source = null,
  palette = CELL_PALETTE,
  sampledRgb = null,
  protectionMap = null,
  edgeMap = null,
  report = {},
}) {
  const height = grid.length;
  const width = grid[0].length;
  let colors;
  if (sampledRgb) {
    colors = sampledRgb.map((row) => row.map((rgb) => (rgb ? { r: rgb[0], g: rgb[1], b: rgb[2] } : null)));
  } else {
    colors = [];
    for (let y = 0; y < height; y += 1) {
      const row = [];
      for (let x = 0; x < width; x += 1) {
        let r = 0, g = 0, b = 0, n = 0;
        const x0 = Math.floor((x * source.width) / width);
        const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * source.width) / width));
        const y0 = Math.floor((y * source.height) / height);
        const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * source.height) / height));
        for (let sy = y0; sy < y1; sy += 1) {
          for (let sx = x0; sx < x1; sx += 1) {
            const i = (sy * source.width + sx) * 4;
            r += source.data[i]; g += source.data[i + 1]; b += source.data[i + 2]; n += 1;
          }
        }
        row.push(n ? { r: r / n, g: g / n, b: b / n } : null);
      }
      colors.push(row);
    }
  }
  const pm = protectionMap || new Float32Array(width * height);
  const em = edgeMap || new Float32Array(width * height);
  return {
    grid,
    width,
    height,
    source,
    palette,
    sampled: { colors },
    getColorKey: (cell) => (cell ? cell.code : null),
    getRGB: (cell) => (cell ? cell.rgb : null),
    protection: { protectionMap: pm, edgeMap: em, tierMap: new Uint8Array(width * height).fill(2) },
    report,
  };
}

/** 造一个 refine/cleanup 接缝用的 ctx（这些接缝拿不到完整引擎上下文时用它）。 */
export function makeCleanupCtx({ grid, size, source, report = {}, protection = null, tierMap = null, edgeMap = null, protectionMap = null, sourceEvidence = null }) {
  const width = size;
  const height = size;
  return {
    grid,
    width,
    height,
    source,
    palette: CELL_PALETTE,
    getColorKey: (cell) => (cell ? cell.code : null),
    getRGB: (cell) => (cell ? cell.rgb : null),
    protectionMap: protectionMap || new Float32Array(width * height),
    tierMap: tierMap || new Uint8Array(width * height).fill(2),
    edgeMap: edgeMap || new Float32Array(width * height),
    samplingModeMap: null,
    getSourceEvidence: typeof sourceEvidence === "number" ? () => sourceEvidence : sourceEvidence,
    protection: { protectionMap: protectionMap || new Float32Array(width * height), edgeMap: edgeMap || new Float32Array(width * height), tierMap: tierMap || new Uint8Array(width * height).fill(2) },
    options: { protectionThreshold: 0.5, sourceEvidenceThreshold: 0.3, maxComponentSize: 5 },
    // 两参（接缝契约），缺的四个参数从 source / 网格尺寸补。
    // 六参原件在只给 (x, y) 时算出 NaN，NaN 边界会让像素循环一次都不跑 ——
    // 那不是报错，是「源色恒为 null」，看指标只表现为碎片变多。
    cellBounds: (x, y, sw = source ? source.width : 0, sh = source ? source.height : 0, w = width, h = height) => ({
      x0: (x * sw) / w, x1: ((x + 1) * sw) / w,
      y0: (y * sh) / h, y1: ((y + 1) * sh) / h,
    }),
    report,
  };
}
