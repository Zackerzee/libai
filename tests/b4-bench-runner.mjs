/**
 * b4-bench-runner.mjs — Stage B4 §4/§5 的**共享测量层**。
 *
 * 为什么单独一个文件：`tools/b4-bench.mjs`（写基线）和
 * `tests/b4-bench-baseline.test.mjs`（守基线）**必须是同一套测量**。
 * 两边各写一份，就会出现「工具说 hash 是 X、测试说 hash 是 Y」这种
 * 谁都不算错、但基线已经失去意义的局面。
 *
 * 这里只做**纯测量**：无文件写入、无 console、无 PNG 编码。
 * 渲染和落盘留在工具里。
 */
import { getBrandPalette } from "../smart-preprocessing/palette-brands.mjs";
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { deriveGenerationSize } from "../services/generation-size.mjs";
import { LOGICAL_SIZE, RASTER_SCALE, buildBenchGrid, rasterize } from "./b4-bench-fixtures.mjs";

/**
 * 固定输入。**改任何一项都必须显式更新基线**，因为基线会记录这份对象，
 * `--check` 发现不一致会直接报「固定输入变了」。
 *
 * `paletteId` 为什么是 `artkal197` 而不是 app 的默认色卡：app 的默认
 * （MARD 221）内嵌在 `app.js` 的字符串常量里，Node 侧取不到。benchmark 要的是
 * 「固定」，不是「和某个品牌一致」——`artkal197` 同样是从注册表读出来的
 * `{code, rgb, group}`，同样 197 色量级，而且**能被 Node 逐字导入**。
 * 这是刻意的选择，不是退而求其次。
 */
export const B4_BENCH_PINNED = Object.freeze({
  paletteId: "artkal197",
  paletteLabel: "优肯 C197",
  longEdge: 104,
  maxColors: 0,
  modes: Object.freeze(["auto", "beginner"]),
  logicalSize: LOGICAL_SIZE,
  rasterScale: RASTER_SCALE,
});

export function fnv1a(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

export function benchPalette() {
  const brand = getBrandPalette(B4_BENCH_PINNED.paletteId);
  if (!brand) throw new Error(`色卡不存在：${B4_BENCH_PINNED.paletteId}`);
  return brand.colors.map((c) => ({ code: c.code, rgb: c.rgb, group: c.group }));
}

export function paletteHash(palette) {
  return fnv1a(palette.map((c) => `${c.code}:${c.rgb.join(",")}`).join("|"));
}

export function benchSize() {
  const size = deriveGenerationSize(B4_BENCH_PINNED.longEdge, 1);
  if (!size) throw new Error("尺寸派生失败");
  return size;
}

/** 源图 → 目标格数的**盒式降采样**，直接用原图颜色，不做色卡匹配。
 *  这是 contact sheet 的「原图」列：没有它，「算法把颜色改坏了」就没有参照物。 */
export function downsampleSource(source, width, height) {
  const out = [];
  const sx = source.width / width;
  const sy = source.height / height;
  for (let y = 0; y < height; y += 1) {
    const row = [];
    for (let x = 0; x < width; x += 1) {
      let r = 0, g = 0, b = 0, n = 0;
      const x0 = Math.floor(x * sx), x1 = Math.min(source.width, Math.ceil((x + 1) * sx));
      const y0 = Math.floor(y * sy), y1 = Math.min(source.height, Math.ceil((y + 1) * sy));
      for (let py = y0; py < y1; py += 1) {
        for (let px = x0; px < x1; px += 1) {
          const i = (py * source.width + px) * 4;
          r += source.data[i]; g += source.data[i + 1]; b += source.data[i + 2]; n += 1;
        }
      }
      row.push(n ? { rgb: [Math.round(r / n), Math.round(g / n), Math.round(b / n)], code: null } : null);
    }
    out.push(row);
  }
  return out;
}

/** 把归一化框映射到格网，量这一框里的东西。 */
export function measureProbe(grid, probe) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const [nx0, ny0, nx1, ny1] = probe.box;
  const x0 = Math.max(0, Math.floor(nx0 * w));
  const x1 = Math.min(w - 1, Math.ceil(nx1 * w) - 1);
  const y0 = Math.max(0, Math.floor(ny0 * h));
  const y1 = Math.min(h - 1, Math.ceil(ny1 * h) - 1);
  const codes = new Map();
  let filled = 0;
  let total = 0;
  let dark = 0;
  let lumSum = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      total += 1;
      const cell = grid[y]?.[x];
      if (!cell) continue;
      filled += 1;
      const entry = codes.get(cell.code);
      if (entry) entry.count += 1;
      else codes.set(cell.code, { count: 1, rgb: cell.rgb });
      const [r, g, b] = cell.rgb;
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      lumSum += lum;
      if (lum < 96) dark += 1;
    }
  }
  let topCode = null;
  let topCount = 0;
  let topRgb = null;
  for (const [code, entry] of codes) {
    if (entry.count > topCount) { topCode = code; topCount = entry.count; topRgb = entry.rgb; }
  }
  return {
    cells: total,
    filled,
    fillRatio: Number((filled / Math.max(1, total)).toFixed(4)),
    distinctColors: codes.size,
    darkCells: dark,
    meanLuminance: filled ? Math.round(lumSum / filled) : null,
    topCode,
    topCount,
    topRgb,
  };
}

/** 探针框在**逻辑网格**上有几种颜色。
 *  这不是给算法看的，是给「夹具没被改坏」看的：有人改了 `paint` 却忘了改 `probes`，
 *  这个数字就会变，基线 diff 立刻指出来。 */
export function logicalProbeStats(cls, probe) {
  const grid = buildBenchGrid(cls);
  const [nx0, ny0, nx1, ny1] = probe.box;
  const x0 = Math.max(0, Math.floor(nx0 * LOGICAL_SIZE));
  const x1 = Math.min(LOGICAL_SIZE - 1, Math.ceil(nx1 * LOGICAL_SIZE) - 1);
  const y0 = Math.max(0, Math.floor(ny0 * LOGICAL_SIZE));
  const y1 = Math.min(LOGICAL_SIZE - 1, Math.ceil(ny1 * LOGICAL_SIZE) - 1);
  const colors = new Set();
  let cells = 0;
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) {
      cells += 1;
      colors.add(grid.rgbGrid[y][x].rgb.join(","));
    }
  }
  return { cells, colors: colors.size };
}

/** 逻辑网格 + 源图，一次算好复用（栅格化 512×512 不便宜）。 */
export function benchInputs(cls) {
  const logical = buildBenchGrid(cls);
  const source = rasterize(logical);
  return { logical, source };
}

/** 跑一次生成，返回可冻结的摘要。 */
export function runBenchCase(cls, mode, { inputs = null, palette = null, size = null } = {}) {
  const { source } = inputs || benchInputs(cls);
  const usePalette = palette || benchPalette();
  const useSize = size || benchSize();
  const t0 = process.hrtime.bigint();
  const result = runGenerationPipeline({
    image: { data: source.data, width: source.width, height: source.height },
    mode,
    size: { width: useSize.width, height: useSize.height },
    palette: usePalette,
    maxColors: B4_BENCH_PINNED.maxColors,
    overrides: {},
  });
  const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;

  const grid = result.grid;
  const used = new Set();
  let nulls = 0;
  let total = 0;
  for (const row of grid) {
    for (const cell of row) {
      total += 1;
      if (cell) used.add(cell.code); else nulls += 1;
    }
  }
  // subjectCrop 会改变取景：同一个归一化框在输出格网上指向的内容已经不是原图那块。
  // 判据用 `applied` 而**不是**开关值 —— 开关打开 ≠ 真的裁了。
  const subjectCropApplied = result.diagnostics?.subjectCrop?.applied === true;
  return {
    grid,
    source,
    size: { width: result.width, height: result.height },
    usedColors: used.size,
    nullCells: nulls,
    totalCells: total,
    gridHash: fnv1a(grid.map((row) => row.map((c) => (c ? c.code : "-")).join(",")).join(";")),
    pipeline: result.pipeline,
    resolvedConfig: result.diagnostics?.resolvedConfig ?? null,
    timingMs: Math.round(elapsedMs),
    framingStable: !subjectCropApplied,
    subjectCropApplied,
  };
}
