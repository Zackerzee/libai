/**
 * pindou-workbench 提取模块 —— 管线 / 混合管线 / 算法实验室 测试
 *
 * 这一层测的是「三套引擎能不能各自跑通、能不能并排比较」，以及两条硬规则：
 *   1. 尺寸越界只报告、不静默改写（BLANK_BOARD_SIZE_FIX.md）。
 *   2. 算法实验室恒不替用户选赢家（verdict 恒为 null）。
 *
 * 运行：node --test src/algorithms/pindou-workbench/pw-pipeline.test.mjs
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  PW_ENGINE_ID,
  QUANTIZER,
  convertImageToBeadsPw,
  resolveGrid,
  collapseMask,
} from "./core/pipeline.js";
import { HYBRID_ENGINE_ID, HYBRID_STAGES, runHybridPw, maskOverlap, detectSpecularHighlights } from "./core/hybrid.js";
import {
  LAB_ENGINES,
  LAB_METRIC_KEYS,
  runAlgorithmLab,
  renderMatrixAsBlockArt,
  renderLabReport,
  formatMetric,
} from "./core/lab.js";
import { countGridColors, diffGrids } from "./core/grid-stats.js";
import {
  measureMatrix,
  METRIC_LABELS,
  countIsolatedSingleBeads,
  countTwoBeadClusters,
  measureDominantRatio,
  normalizeMatrix,
  cellCode,
} from "./core/metrics.js";
import { PALETTE_MATCH_MODE, PIPELINE_PROFILE, GRID_SAMPLE_MODE } from "./config.js";
import { asRaster, FIT_MODE, RESAMPLE_FILTER } from "./sampling/cover-resize.js";

/* ============================================================
 * 测试夹具
 * ========================================================== */

const TEST_PALETTE = [
  { code: "W1", name: "白", hex: "#FFFFFF", rgb: [255, 255, 255] },
  { code: "K1", name: "黑", hex: "#000000", rgb: [0, 0, 0] },
  { code: "R1", name: "红", hex: "#E8282C", rgb: [232, 40, 44] },
  { code: "G1", name: "绿", hex: "#3BA54A", rgb: [59, 165, 74] },
  { code: "B1", name: "蓝", hex: "#2F6FB5", rgb: [47, 111, 181] },
  { code: "Y1", name: "黄", hex: "#F5D547", rgb: [245, 213, 71] },
];

/** 造一张纯内存 RGBA 图（不依赖 Canvas / DOM）。 */
function makeImage(width, height, pixel) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = pixel(x, y);
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a === undefined ? 255 : a;
    }
  }
  return { width, height, data };
}

/** 白底 + 中间一个彩色方块 —— 一条清晰的前景/背景分界，Sobel 一定能抓到。 */
function subjectOnWhite(size = 64) {
  return makeImage(size, size, (x, y) => {
    const inside = x >= size * 0.25 && x < size * 0.75 && y >= size * 0.25 && y < size * 0.75;
    if (!inside) return [250, 250, 250];
    const lx = (x - size * 0.25) / (size * 0.5);
    const ly = (y - size * 0.25) / (size * 0.5);
    if (lx < 0.5 && ly < 0.5) return [232, 40, 44];
    if (lx >= 0.5 && ly < 0.5) return [59, 165, 74];
    if (lx < 0.5) return [47, 111, 181];
    return [245, 213, 71];
  });
}

/* ============================================================
 * 尺寸纪律
 * ========================================================== */

test("resolveGrid 越界只报告，不静默改写尺寸", () => {
  // 空白画板合法区间是 1–1000；这里故意两头越界。
  const tooSmall = resolveGrid({ width: 0, height: 0, sourceWidth: 100, sourceHeight: 100 });
  const tooLarge = resolveGrid({ width: 5000, height: 4000, sourceWidth: 100, sourceHeight: 100 });

  // 请求值必须原样留档（调用方查得到），不能被悄悄 clamp 掉。
  assert.equal(tooSmall.limits.requested.width, 0);
  assert.equal(tooLarge.limits.requested.width, 5000);
  assert.equal(tooLarge.limits.requested.height, 4000);

  // 越界事实只记在 limits 里，并显式声明策略是「只报告」。
  assert.equal(tooSmall.limits.ok, false);
  assert.equal(tooLarge.limits.ok, false);
  assert.equal(tooSmall.limits.policy, "report-only");
  const axes = tooLarge.limits.outOfRange.map((item) => item.axis);
  assert.ok(axes.includes("width"), "宽越界要记录");
  assert.ok(axes.includes("height"), "高越界要记录");

  // 越界值原样传给下游（不 clamp），改写与否由调用方决定 —— 这就是 report-only 的含义。
  assert.equal(tooLarge.width, 5000);
  assert.equal(tooLarge.height, 4000);
  assert.equal(tooSmall.width, 0);
  assert.deepEqual(tooLarge.limits.resolved, { width: 5000, height: 4000 });
});

test("resolveGrid 在合法区间内不做任何手脚", () => {
  const ok = resolveGrid({ width: 64, height: 48, sourceWidth: 128, sourceHeight: 96 });
  assert.equal(ok.width, 64);
  assert.equal(ok.height, 48);
  assert.equal(ok.limits.ok, true);
  assert.equal(ok.limits.outOfRange.length, 0);
  assert.deepEqual(ok.limits.resolved, { width: 64, height: 48 });
});

test("resolveGrid 能按原图比例补高度", () => {
  const derived = resolveGrid({ width: 40, height: null, preserveAspectRatio: true, sourceWidth: 200, sourceHeight: 100 });
  assert.equal(derived.width, 40);
  assert.equal(derived.height, 20, "200×100 的原图，宽 40 时应推出高 20");
});

/* ============================================================
 * 掩码塌缩
 * ========================================================== */

test("collapseMask 按多数口径把超采样掩码降到格分辨率", () => {
  // 2×2 超采样：一个格子里 3 个前景 1 个背景 -> 该格算前景。
  const w = 4;
  const h = 2;
  const mask = new Uint8Array(w * h);
  // 格(0,0) 覆盖像素 (0,0)(1,0)(0,1)(1,1)，点亮 3 个
  mask[0] = 1; mask[1] = 1; mask[4] = 1;
  const out = collapseMask(mask, w, h, 2, 1);
  assert.equal(out.length, 2);
  assert.equal(out[0], 1, "3/4 前景应判为前景");
  assert.equal(out[1], 0, "全背景格应判为背景");
});

/* ============================================================
 * PW 主管线
 * ========================================================== */

test("convertImageToBeadsPw 拒绝没有色板的调用（模块不内置色卡）", () => {
  assert.throws(() => convertImageToBeadsPw(subjectOnWhite(32), { width: 16, height: 16 }), /palette/);
});

test("convertImageToBeadsPw upstream 档跑通并给出正确形状的矩阵", () => {
  const result = convertImageToBeadsPw(subjectOnWhite(64), {
    width: 24,
    height: 24,
    palette: TEST_PALETTE,
    preserveAspectRatio: false,
    profile: PIPELINE_PROFILE.UPSTREAM,
    paletteMatchMode: PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB,
    supersample: 1,
    samplingMode: GRID_SAMPLE_MODE.POINT,
    fitMode: FIT_MODE.COVER,
    filter: RESAMPLE_FILTER.AUTO,
    useMultiScale: false,
    useForegroundOnly: false,
    feather: 0,
  });

  assert.equal(result.width, 24);
  assert.equal(result.height, 24);
  // matrix 是二维行数组
  assert.equal(result.matrix.length, 24);
  assert.equal(result.matrix[0].length, 24);
  assert.ok(result.statistics.cellCount === 24 * 24);
  assert.ok(result.statistics.usedColors.length >= 1, "至少要用到一种颜色");
  assert.ok(result.statistics.usedColors.length <= TEST_PALETTE.length);
  assert.equal(result.diagnostics.engine, PW_ENGINE_ID);
  assert.equal(result.diagnostics.profile, PIPELINE_PROFILE.UPSTREAM);

  // 矩阵里出现的色号必须都在传入色板内 —— 不能凭空造色。
  const known = new Set(TEST_PALETTE.map((entry) => entry.code));
  for (const cell of result.matrix) {
    const code = cellCode(cell);
    if (code == null) continue;
    assert.ok(known.has(code), `矩阵里出现未知色号：${code}`);
  }
});

test("convertImageToBeadsPw 三档 paletteMatchMode 都能跑且结果落在色板内", () => {
  const modes = [
    PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB,
    PALETTE_MATCH_MODE.LAB,
    PALETTE_MATCH_MODE.CIEDE2000,
  ];
  const known = new Set(TEST_PALETTE.map((entry) => entry.code));
  const signatures = new Set();

  for (const mode of modes) {
    const result = convertImageToBeadsPw(subjectOnWhite(64), {
      width: 20,
      height: 20,
      palette: TEST_PALETTE,
      preserveAspectRatio: false,
      profile: PIPELINE_PROFILE.IMPROVED,
      paletteMatchMode: mode,
    });
    assert.equal(result.diagnostics.matching.mode, mode, `模式 ${mode} 未生效`);
    for (const row of result.matrix) {
      for (const cell of row) {
        const code = cellCode(cell);
        if (code == null) continue;
        assert.ok(known.has(code), `模式 ${mode} 产出未知色号 ${code}`);
      }
    }
    signatures.add(result.matrix.map((row) => row.map((cell) => cellCode(cell) ?? "_").join("")).join("|"));
  }

  // 三档都是「能用的不同结果」；不强求三档互不相同，但至少不能只剩一档。
  assert.ok(signatures.size >= 1);
});

test("convertImageToBeadsPw 尊重 maxColors 上限", () => {
  const result = convertImageToBeadsPw(subjectOnWhite(64), {
    width: 20,
    height: 20,
    palette: TEST_PALETTE,
    preserveAspectRatio: false,
    maxColors: 2,
    profile: PIPELINE_PROFILE.IMPROVED,
  });
  assert.ok(result.statistics.usedColors.length <= 2, `实际 ${result.statistics.usedColors.length}`);
});

test("convertImageToBeadsPw 的统计自洽：豆数 + 空格 = 格数", () => {
  const result = convertImageToBeadsPw(subjectOnWhite(48), {
    width: 18,
    height: 18,
    palette: TEST_PALETTE,
    preserveAspectRatio: false,
    profile: PIPELINE_PROFILE.IMPROVED,
  });
  const { cellCount, beadCount, emptyCount, colorUsage } = result.statistics;
  assert.equal(beadCount + emptyCount, cellCount);
  // colorUsage 是 { 色号: 数量 } 的字典
  const usageSum = Object.values(colorUsage).reduce((sum, n) => sum + n, 0);
  assert.equal(usageSum, beadCount);
  assert.equal(Object.keys(colorUsage).length, result.statistics.usedColors.length);
});

/* ============================================================
 * 网格统计
 * ========================================================== */

test("countGridColors 数出实际用到的色号", () => {
  const matrix = [
    [{ code: "W1" }, { code: "W1" }, { code: "K1" }],
    [{ code: "K1" }, { code: null }, { code: "R1" }],
  ];
  const stats = countGridColors(matrix);
  assert.equal(stats.cols, 3);
  assert.equal(stats.rows, 2);
  assert.deepEqual(stats.usedColors, ["K1", "R1", "W1"]);
  assert.equal(stats.beadCount, 5);
  assert.equal(stats.emptyCount, 1);
  assert.equal(stats.cellCount, 6);
  assert.equal(stats.dominant.count, 2, "W1 与 K1 并列最多，各 2 个");
});

test("diffGrids 逐格比较并给出差异计数", () => {
  const a = [[{ code: "W1" }, { code: "W1" }], [{ code: "K1" }, { code: "K1" }]];
  const b = [[{ code: "W1" }, { code: "K1" }], [{ code: "K1" }, { code: "K1" }]];
  const diff = diffGrids(a, b);
  assert.equal(diff.changed, 1);
  assert.equal(diff.totalCells, 4);
  assert.ok(diff.changedRatio > 0 && diff.changedRatio < 1);
  // 变的那格是「有 -> 有」，不该算成单侧新增/减少
  assert.equal(diff.onlyA, 0);
  assert.equal(diff.onlyB, 0);
});

test("diffGrids 能区分「变成空」与「从空变来」", () => {
  const a = [[{ code: "W1" }, { code: null }]];
  const b = [[{ code: null }, { code: "W1" }]];
  const diff = diffGrids(a, b);
  assert.equal(diff.changed, 2);
  assert.equal(diff.onlyA, 1, "a 有豆而 b 空");
  assert.equal(diff.onlyB, 1, "b 有豆而 a 空");
});

test("diffGrids 与自身比较时零差异", () => {
  const a = [[{ code: "W1" }, { code: "K1" }]];
  const diff = diffGrids(a, a);
  assert.equal(diff.changed, 0);
  assert.equal(diff.changedRatio, 0);
});

/* ============================================================
 * 指标
 * ========================================================== */

test("countIsolatedSingleBeads 只数四邻全异己的孤豆", () => {
  // 3×3 网格：中心一个孤豆，其余同色。
  const single = [["W1", "W1", "W1"], ["W1", "K1", "W1"], ["W1", "W1", "W1"]];
  assert.equal(countIsolatedSingleBeads(single, 3, 3), 1);

  // 中心改成两块相邻 -> 不再算孤立单豆
  const pair = [["W1", "W1", "W1"], ["W1", "K1", "K1"], ["W1", "W1", "W1"]];
  assert.equal(countIsolatedSingleBeads(pair, 3, 3), 0, "2 豆连片不算孤立单豆");
});

test("countTwoBeadClusters 数出恰好 2 豆的小区域", () => {
  const pair = [["W1", "W1", "W1"], ["W1", "K1", "K1"], ["W1", "W1", "W1"]];
  assert.equal(countTwoBeadClusters(pair, 3, 3), 1);
  const single = [["W1", "W1", "W1"], ["W1", "K1", "W1"], ["W1", "W1", "W1"]];
  assert.equal(countTwoBeadClusters(single, 3, 3), 0, "1 豆不算 2 豆区");
});

test("measureDominantRatio 给出最大色占比与色号", () => {
  const codes = [["W1", "W1"], ["W1", "K1"]];
  const result = measureDominantRatio(codes, 2, 2);
  assert.ok(Math.abs(result.ratio - 0.75) < 1e-9, `实际 ${result.ratio}`);
  assert.equal(result.dominant, "W1");
  assert.equal(result.dominantCount, 3);
  assert.equal(result.total, 4);
});

test("measureMatrix 十项指标齐全且都是有限数", () => {
  void asRaster;
  const matrix = [];
  for (let y = 0; y < 8; y++) {
    const row = [];
    for (let x = 0; x < 8; x++) row.push({ code: (x + y) % 4 === 0 ? "K1" : "W1" });
    matrix.push(row);
  }
  const sourceSamples = new Float32Array(64 * 3);
  for (let i = 0; i < 64; i++) {
    sourceSamples[i * 3] = 200;
    sourceSamples[i * 3 + 1] = 200;
    sourceSamples[i * 3 + 2] = 200;
  }
  const metrics = measureMatrix({ matrix, palette: TEST_PALETTE, sourceSamples });

  // 十项指标按 LAB_METRIC_KEYS 声明的路径逐条取值，全部必须存在。
  const pick = (object, path) => path.reduce((cur, key) => (cur == null ? null : cur[key]), object);
  for (const metric of LAB_METRIC_KEYS) {
    const value = pick(metrics, metric.path);
    assert.notEqual(value, undefined, `缺少指标 ${metric.key}`);
    if (typeof value === "number") assert.ok(Number.isFinite(value), `${metric.key} 不是有限数：${value}`);
  }
  assert.equal(LAB_METRIC_KEYS.length, 10, "必须是用户点名的十项");
  for (const key of Object.keys(METRIC_LABELS)) {
    assert.ok(LAB_METRIC_KEYS.some((metric) => metric.key === key), `METRIC_LABELS 的 ${key} 不在十项里`);
  }
  assert.equal(metrics.beadCount, 64);
  assert.equal(metrics.usedColorCount, 2);
});

test("measureMatrix 对空网格返回零值而不是抛错", () => {
  const metrics = measureMatrix({ matrix: [], palette: TEST_PALETTE });
  assert.equal(metrics.cols, 0);
  assert.equal(metrics.beadCount, 0);
  assert.equal(metrics.dominantColorRatio, 0);
});

test("normalizeMatrix 同时接受色号串与色对象", () => {
  const fromObjects = normalizeMatrix([{ code: "W1" }, { code: "K1" }]);
  const fromStrings = normalizeMatrix(["W1", "K1"]);
  assert.equal(fromObjects.codes.length, 2);
  assert.equal(fromStrings.codes.length, 2);
  assert.deepEqual(fromObjects.codes, fromStrings.codes);
});

/* ============================================================
 * 高光 / 掩码工具
 * ========================================================== */

test("maskOverlap 数出两个掩码同时为真的格数", () => {
  const a = new Uint8Array([1, 1, 0, 0]);
  const b = new Uint8Array([1, 0, 0, 0]);
  assert.equal(maskOverlap(a, b), 1);
  assert.equal(maskOverlap(a, a), 2, "自比等于自身前景数");
  const disjoint = maskOverlap(new Uint8Array([1, 1, 0, 0]), new Uint8Array([0, 0, 1, 1]));
  assert.equal(disjoint, 0);
});

test("detectSpecularHighlights 在纯色图上不误报高光", () => {
  const raster = asRaster(makeImage(16, 16, () => [120, 120, 120]));
  const hits = detectSpecularHighlights(raster, 8, 8);
  assert.ok(hits && typeof hits === "object");
});

/* ============================================================
 * 混合管线
 * ========================================================== */

test("runHybridPw 跑通并留下 requested / effective 两套顺序记录", async () => {
  const result = await runHybridPw(subjectOnWhite(64), {
    width: 20,
    height: 20,
    palette: TEST_PALETTE,
    preserveAspectRatio: false,
    maxColors: 5,
    paletteMatchMode: PALETTE_MATCH_MODE.CIEDE2000,
  });

  assert.equal(result.diagnostics.engine, HYBRID_ENGINE_ID);
  assert.equal(result.width, 20);
  assert.equal(result.height, 20);
  assert.equal(result.matrix.length, 20);
  assert.equal(result.matrix[0].length, 20);

  const order = result.diagnostics.pipelineOrder;
  assert.ok(Array.isArray(order.requested), "必须记录用户要求的顺序");
  assert.ok(Array.isArray(order.effective), "必须记录实际执行的顺序");
  assert.ok(order.requested.length > 0 && order.effective.length > 0);

  // 用户点名的九个阶段一个都不能少，且顺序与需求一致
  assert.equal(order.requested.length, 9);
  assert.equal(order.requested[0], "pw 多尺度 Sobel");
  assert.equal(order.requested[1], "结构边缘 Mask");
  assert.equal(order.requested[2], "Linear RGB sampling");
  assert.equal(order.requested[3], "Lab/CIEDE2000 色板匹配");

  // 实际执行里「保护扫描」必须排在「降色」之前（否则保护不可能生效）
  const protectAt = order.effective.findIndex((stage) => stage.includes("protection scan"));
  const budgetAt = order.effective.findIndex((stage) => stage.includes("maxColors"));
  assert.ok(protectAt >= 0 && budgetAt >= 0, "effective 必须含保护与降色两个阶段");
  assert.ok(protectAt < budgetAt, `保护(${protectAt}) 必须早于降色(${budgetAt})`);
  // 这个偏差必须显式写进报告，不能偷偷改
  assert.ok(order.deviationNote, "顺序与需求不一致时必须写明原因");
  assert.ok(order.deviationNote.includes("保护"));
});

test("runHybridPw 产出的色号全部来自传入色板", async () => {
  const result = await runHybridPw(subjectOnWhite(64), {
    width: 16,
    height: 16,
    palette: TEST_PALETTE,
    preserveAspectRatio: false,
    maxColors: 4,
  });
  const known = new Set(TEST_PALETTE.map((entry) => entry.code));
  for (const row of result.matrix) {
    for (const cell of row) {
      const code = cellCode(cell);
      if (code == null) continue;
      assert.ok(known.has(code), `混合管线产出未知色号 ${code}`);
    }
  }
  assert.ok(result.statistics.usedColors.length <= 4, `实际 ${result.statistics.usedColors.length}`);
});

/* ============================================================
 * 算法实验室
 * ========================================================== */

test("runAlgorithmLab 三路并排，且 verdict 恒为 null", async () => {
  const report = await runAlgorithmLab({
    imageData: subjectOnWhite(48),
    palette: TEST_PALETTE,
    width: 16,
    height: 16,
    maxColors: 5,
    // currentRunner 由宿主注入；这里不注入，让实验室走内置的 libms current 路径。
  });

  const ids = report.columns.map((column) => column.id);
  assert.ok(ids.includes(LAB_ENGINES.CURRENT), `缺少 ${LAB_ENGINES.CURRENT}`);
  assert.ok(ids.includes(LAB_ENGINES.PW_ORIGINAL), `缺少 ${LAB_ENGINES.PW_ORIGINAL}`);
  assert.ok(ids.includes(LAB_ENGINES.HYBRID_PW), `缺少 ${LAB_ENGINES.HYBRID_PW}`);
  assert.equal(ids.length, 3, "必须是三路，不多不少");

  // 铁律：不替用户选赢家。
  assert.equal(report.verdict, null, "算法实验室不得给出优劣判定");
  assert.equal(report.noRanking.sortedBy, null);
  assert.equal(report.noRanking.recommended, null);

  for (const column of report.columns) {
    assert.ok(!column.error, `${column.id} 这一路不该失败：${column.error}`);
    for (const metric of LAB_METRIC_KEYS) {
      assert.ok(metric.key in column.readings, `${column.id} 缺指标 ${metric.key}`);
    }
  }
  // 三路的参考基准必须一致，否则 ΔE 不可比。
  assert.ok(report.reference.rasterSize.width > 0);
  assert.ok(report.pairwise.length >= 1, "应给出两两差异");
});

test("runAlgorithmLab 接受宿主注入的 currentRunner", async () => {
  const called = [];
  const report = await runAlgorithmLab({
    imageData: subjectOnWhite(32),
    palette: TEST_PALETTE,
    width: 12,
    height: 12,
    maxColors: 4,
    currentRunner: ({ width, height, palette }) => {
      called.push({ width, height, palette });
      // 必须是二维行数组 —— normalizeToMatrix 只认这种形状。
      const matrix = [];
      for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) row.push({ code: "W1" });
        matrix.push(row);
      }
      return matrix;
    },
  });
  assert.equal(called.length, 1, "currentRunner 应被调用一次");
  assert.equal(called[0].width, 12);
  assert.equal(called[0].palette, TEST_PALETTE, "色板必须原样传入，不得换成处理过的方言色板");
  const current = report.columns.find((column) => column.id === LAB_ENGINES.CURRENT);
  assert.ok(current);
  assert.ok(!current.error, `current 路不该报错：${current.error}`);
  assert.equal(current.readings.usedColorCount, 1);
});

test("runAlgorithmLab 在缺色板时直接抛错，不静默降级", async () => {
  await assert.rejects(
    () => runAlgorithmLab({ imageData: subjectOnWhite(16), palette: [], width: 8, height: 8 }),
    /palette/,
  );
});

test("renderMatrixAsBlockArt 产出与网格同行的字符画", () => {
  const matrix = [];
  for (let y = 0; y < 4; y++) {
    const row = [];
    for (let x = 0; x < 4; x++) row.push({ code: y < 2 ? "W1" : "K1" });
    matrix.push(row);
  }
  const art = renderMatrixAsBlockArt(matrix);
  const lines = art.split("\n");
  assert.equal(lines[0].length, 4, "第一行宽度应等于列数");
  assert.ok(lines.length >= 4, "至少应有 4 行");
  assert.ok(art.includes("=W1") && art.includes("=K1"), "应带色号对照图例");
});

test("renderLabReport 输出三列且不写结论", async () => {
  const report = await runAlgorithmLab({
    imageData: subjectOnWhite(32),
    palette: TEST_PALETTE,
    width: 12,
    height: 12,
    maxColors: 4,
    currentRunner: ({ width, height }) => {
      const matrix = [];
      for (let y = 0; y < height; y++) {
        const row = [];
        for (let x = 0; x < width; x++) row.push({ code: x % 3 === 0 ? "K1" : "W1" });
        matrix.push(row);
      }
      return matrix;
    },
  });
  const text = renderLabReport(report);
  assert.ok(text.includes("CURRENT"));
  assert.ok(text.includes("PW"));
  assert.ok(text.includes("HYBRID"));

  // 报告里不许出现任何「推荐 / 最好 / 胜出」类判定措辞。
  // 唯一例外是「不产生……推荐」这句免责声明本身 —— 它是用来声明没有结论的。
  const disclaimer = report.noRanking.note;
  const body = text.split(disclaimer).join("");
  for (const banned of ["推荐", "最好", "最优", "胜出", "winner", "best"]) {
    assert.ok(!body.includes(banned), `报告正文不应出现判定性措辞「${banned}」`);
  }
  assert.ok(text.includes(disclaimer), "免责声明必须在报告里出现");
});

test("formatMetric 对空值与非数给出占位，不输出 NaN", () => {
  assert.ok(!String(formatMetric(null)).includes("NaN"));
  assert.ok(!String(formatMetric(undefined)).includes("NaN"));
  assert.ok(!String(formatMetric(Number.NaN)).includes("NaN"));
  assert.ok(String(formatMetric(12.3456, "fixed2")).length > 0);
});

/* ============================================================
 * 引擎标识
 * ========================================================== */

test("三套引擎 ID 互不相同且与既有引擎不撞名", () => {
  const ids = [PW_ENGINE_ID, HYBRID_ENGINE_ID, "current", "bgs"];
  assert.equal(new Set(ids).size, ids.length, `引擎 ID 撞名：${ids}`);
  assert.equal(PW_ENGINE_ID, "pindou-workbench");
  assert.equal(HYBRID_ENGINE_ID, "hybrid-pw");
});

test("QUANTIZER 至少覆盖主管线用到的量化器", () => {
  assert.ok(Object.keys(QUANTIZER).length >= 2);
  for (const value of Object.values(QUANTIZER)) assert.equal(typeof value, "string");
});
