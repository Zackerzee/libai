/**
 * core/lab.js
 * ─────────────────────────────────────────────────────────────
 * 第六阶段：算法实验室。**同一张图片**分别跑三套算法并把结果并排。
 *
 *   CURRENT      —— libms 现有 V2.5 引擎（`generateV2`），界面默认档位
 *   PW-ORIGINAL  —— pw 忠实复刻上游语义（`profile: 'upstream'`）
 *   HYBRID-PW    —— 第五阶段混合管线（pw 结构掩码 + 我们的下游）
 *
 * 十个指标（`metrics.js` 统一测量，三条链路用同一个函数，横向数字才可比）：
 *   实际使用颜色数量 / 平均 ΔE / P95 ΔE / 孤立单豆数量 / 2 豆小区域数量 /
 *   边缘杂色数量 / 轮廓保持率 / 高光保持率 / Dominant Color Ratio / 透明边缘污染数量
 *
 * ⚠️ **`verdict` 恒为 `null`。** 对象里没有 winner、没有分数、没有推荐。
 * 用户明确要求「不要自动判断哪个最好……把三个结果并排给我人工判断」，
 * 因此本模块只负责把测量结果摆整齐，排序与取舍一律不做。
 */

import { PALETTE_MATCH_MODE, PIPELINE_PROFILE } from "../config.js";
import { convertImageToBeadsPw } from "./pipeline.js";
import { runHybridPw } from "./hybrid.js";
import { measureMatrix, METRIC_LABELS, cellCode, buildLookup } from "./metrics.js";
import { countGridColors, diffGrids } from "./grid-stats.js";
import { asRaster, resizeToGrid, FIT_MODE, RESAMPLE_FILTER } from "../sampling/cover-resize.js";
import { sampleCells, GRID_SAMPLE_MODE } from "../sampling/grid-sampling.js";
import { estimateBackground, backgroundMargin } from "../segmentation/background-kmeans.js";

export const LAB_ENGINES = Object.freeze({
  CURRENT: "current",
  PW_ORIGINAL: "pw-original",
  HYBRID_PW: "hybrid-pw",
});

export const LAB_ENGINE_LABELS = Object.freeze({
  [LAB_ENGINES.CURRENT]: "CURRENT（libms V2.5）",
  [LAB_ENGINES.PW_ORIGINAL]: "PW ORIGINAL（上游复刻）",
  [LAB_ENGINES.HYBRID_PW]: "HYBRID-PW（混合）",
});

/** 十个指标键 + 从 metrics 结果里取值的路径。 */
export const LAB_METRIC_KEYS = Object.freeze([
  { key: "usedColorCount", label: METRIC_LABELS.usedColorCount, path: ["usedColorCount"], format: "int" },
  { key: "meanDeltaE", label: METRIC_LABELS.meanDeltaE, path: ["colorError", "meanCiede2000"], format: "float2" },
  { key: "p95DeltaE", label: METRIC_LABELS.p95DeltaE, path: ["colorError", "p95Ciede2000"], format: "float2" },
  { key: "isolatedSingleBeadCount", label: METRIC_LABELS.isolatedSingleBeadCount, path: ["isolatedSingleBeadCount"], format: "int" },
  { key: "twoBeadClusterCount", label: METRIC_LABELS.twoBeadClusterCount, path: ["twoBeadClusterCount"], format: "int" },
  { key: "edgeNoiseCount", label: METRIC_LABELS.edgeNoiseCount, path: ["edgeNoiseCount"], format: "int" },
  { key: "structureRetention", label: METRIC_LABELS.structureRetention, path: ["structureRetention"], format: "ratio" },
  { key: "highlightRetention", label: METRIC_LABELS.highlightRetention, path: ["highlightRetention"], format: "ratio" },
  { key: "dominantColorRatio", label: METRIC_LABELS.dominantColorRatio, path: ["dominantColorRatio"], format: "float3" },
  { key: "transparencyEdgeContamination", label: METRIC_LABELS.transparencyEdgeContamination, path: ["transparencyEdgeContamination"], format: "int" },
]);

/** 从嵌套对象按路径取值。 */
function pick(object, path) {
  let current = object;
  for (const key of path) {
    if (current == null) return null;
    current = current[key];
  }
  return current == null ? null : current;
}

/** 把指标值格式化成字符串。 */
export function formatMetric(value, format) {
  if (value == null || Number.isNaN(value)) return "—";
  switch (format) {
    case "int": return String(Math.round(value));
    case "float2": return Number(value).toFixed(2);
    case "float3": return Number(value).toFixed(3);
    case "ratio": return (Number(value) * 100).toFixed(1) + "%";
    default: return String(value);
  }
}

/**
 * 跑三路对比。
 *
 * @param {object} input
 * @param {{data:ArrayLike<number>, width:number, height:number}} input.imageData 源图
 * @param {Array} input.palette 色板（**原始形状**，逐条链路各自解析，不交叉传方言）
 * @param {number} input.width 格宽
 * @param {number} input.height 格高
 * @param {number} [input.maxColors]
 * @param {Function} [input.currentRunner] 可选：覆盖 CURRENT 列（浏览器里可接真实生产链路）
 * @param {object} [input.currentOptions] 传给 generateV2 的 options
 * @param {object} [input.pwOptions] 传给 pw-original 的额外选项
 * @param {object} [input.hybridOptions] 传给 hybrid-pw 的额外选项
 * @param {boolean} [input.includeBlockArt]
 * @returns {Promise<object>}
 */
export async function runAlgorithmLab(input) {
  const startedAt = Date.now();
  const source = asRaster(input.imageData);
  const palette = input.palette;
  if (!Array.isArray(palette) || !palette.length) throw new Error("algorithm-lab: palette 必填");

  const cols = Math.round(input.width);
  const rows = Math.round(input.height);
  const maxColors = Math.max(0, Number(input.maxColors) || 0);

  // ── 共享参考：逐格源色（三路共用同一份参考，否则算出来的 ΔE 不可比） ──
  const reference = buildReferenceSamples(source, cols, rows, input.referenceSupersample ?? 3);
  const bgReference = estimateBackground(reference.raster, { mode: "border-kmeans-nearest" });

  const columns = [];
  const errors = [];

  // ── ① CURRENT ────────────────────────────────────────────
  try {
    const matrix = input.currentRunner
      ? normalizeToMatrix(await input.currentRunner({ imageData: source, palette, width: cols, height: rows, maxColors }))
      : await runLibmsCurrent(source, palette, cols, rows, maxColors, input.currentOptions);
    columns.push(buildColumn(LAB_ENGINES.CURRENT, matrix, palette, reference, bgReference, maxColors, input.includeBlockArt));
  } catch (error) {
    errors.push({ engine: LAB_ENGINES.CURRENT, message: error?.message || String(error) });
    columns.push(emptyColumn(LAB_ENGINES.CURRENT, cols, rows));
  }

  // ── ② PW ORIGINAL ────────────────────────────────────────
  try {
    const result = convertImageToBeadsPw(source, {
      width: cols,
      height: rows,
      maxColors,
      palette,
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
      ...input.pwOptions,
    });
    columns.push(buildColumn(LAB_ENGINES.PW_ORIGINAL, result.matrix, palette, reference, bgReference, maxColors, input.includeBlockArt, result.diagnostics));
  } catch (error) {
    errors.push({ engine: LAB_ENGINES.PW_ORIGINAL, message: error?.message || String(error) });
    columns.push(emptyColumn(LAB_ENGINES.PW_ORIGINAL, cols, rows));
  }

  // ── ③ HYBRID-PW ──────────────────────────────────────────
  try {
    const result = await runHybridPw(source, {
      width: cols,
      height: rows,
      maxColors,
      palette,
      preserveAspectRatio: false,
      paletteMatchMode: PALETTE_MATCH_MODE.CIEDE2000,
      ...input.hybridOptions,
    });
    columns.push(buildColumn(LAB_ENGINES.HYBRID_PW, result.matrix, palette, reference, bgReference, maxColors, input.includeBlockArt, result.diagnostics));
  } catch (error) {
    errors.push({ engine: LAB_ENGINES.HYBRID_PW, message: error?.message || String(error) });
    columns.push(emptyColumn(LAB_ENGINES.HYBRID_PW, cols, rows));
  }

  // ── 横向差异（只报数，不判定） ────────────────────────────
  const pairs = [];
  for (let i = 0; i < columns.length; i++) {
    for (let j = i + 1; j < columns.length; j++) {
      const a = columns[i];
      const b = columns[j];
      if (!a.matrix.length || !b.matrix.length) continue;
      pairs.push({ a: a.id, b: b.id, ...diffGrids(a.matrix, b.matrix) });
    }
  }

  return {
    engine: "algorithm-lab",
    width: cols,
    height: rows,
    maxColors,
    paletteSize: palette.length,
    sourceSize: { width: source.width, height: source.height },
    reference: {
      supersample: input.referenceSupersample ?? 3,
      rasterSize: { width: reference.raster.width, height: reference.raster.height },
      backgroundEstimate: bgReference.color.map((v) => Math.round(v * 100) / 100),
      backgroundMargin: backgroundMargin(reference.raster.width, reference.raster.height),
    },
    metricKeys: LAB_METRIC_KEYS,
    columns,
    pairwise: pairs,
    errors,
    /** 恒为 null —— 见文件头。 */
    verdict: null,
    noRanking: {
      note: "本报告只做测量与并排，不产生 winner / 评分 / 推荐。三套算法的取舍由使用者人工判断。",
      sortedBy: null,
      recommended: null,
    },
    timingMs: Date.now() - startedAt,
  };
}

/** 参考样本：把源图按格切分做面积均值（3 路共用）。 */
function buildReferenceSamples(source, cols, rows, supersample) {
  const rasterWidth = cols * Math.max(1, supersample);
  const rasterHeight = rows * Math.max(1, supersample);
  const raster = resizeToGrid(source, { cols: rasterWidth, rows: rasterHeight, fitMode: FIT_MODE.COVER, filter: RESAMPLE_FILTER.AUTO });
  const collected = sampleCells(raster, { cols, rows, mode: "area-average", space: "srgb" });
  return { samples: collected.samples, alpha: collected.alpha, raster, rasterWidth, rasterHeight };
}

/** libms 现有引擎。**传原始色板**，绝不传 pw 处理过的色板（方言纪律）。 */
async function runLibmsCurrent(source, palette, cols, rows, maxColors, options = {}) {
  const { generateV2 } = await import("../../../../smart-preprocessing/generation-engine-v2.mjs");
  const result = generateV2({
    source,
    width: cols,
    height: rows,
    palette,
    options: {
      // 界面默认档位（与 GenerationPanel 的默认状态一致）
      preset: "auto",
      sampling: "auto",
      detailProtection: 0.7,
      edgeProtection: 0.7,
      highlightProtection: 0.8,
      eyeProtection: 1.0,
      microDetailProtection: 0.8,
      maxColors,
      ...options,
    },
  });
  return result.grid;
}

/** 把各种形状的「矩阵」归一成 `(string|null)[][]`。 */
function normalizeToMatrix(raw) {
  const grid = raw && raw.grid ? raw.grid : raw;
  if (!Array.isArray(grid)) return [];
  return grid.map((row) => (Array.isArray(row) ? row.map((cell) => cellCode(cell)) : []));
}

/** 组装一列。 */
function buildColumn(id, matrix, palette, reference, bgReference, maxColors, includeBlockArt, diagnostics) {
  const stats = countGridColors(matrix);
  const metrics = measureMatrix({
    matrix,
    palette,
    sourceSamples: reference.samples,
    bgColor: bgReference.color,
  });
  return {
    id,
    label: LAB_ENGINE_LABELS[id],
    matrix,
    statistics: stats,
    metrics,
    /** 十个指标的扁平读数（方便表格渲染）。 */
    readings: Object.fromEntries(LAB_METRIC_KEYS.map((metric) => [metric.key, pick(metrics, metric.path)])),
    blockArt: includeBlockArt ? renderMatrixAsBlockArt(matrix) : null,
    diagnostics: diagnostics || null,
    error: null,
  };
}

/** 该路跑不动时占位，保证表格列数稳定（不静默少一列，不假装成功）。 */
function emptyColumn(id, cols, rows) {
  return {
    id,
    label: LAB_ENGINE_LABELS[id],
    matrix: [],
    statistics: { beadCount: 0, emptyCount: 0, usedColors: [] },
    metrics: null,
    readings: Object.fromEntries(LAB_METRIC_KEYS.map((metric) => [metric.key, null])),
    blockArt: null,
    diagnostics: null,
    error: "该链路执行失败，见 report.errors",
    size: { cols, rows },
  };
}

/**
 * 矩阵 → 方块字符预览。每个不同色号分配一个字符，右侧附色号对照。
 */
export function renderMatrixAsBlockArt(matrix, options = {}) {
  const codes = new Set();
  const rows = matrix.length;
  const cols = rows ? Math.max(...matrix.map((row) => row.length)) : 0;
  for (const row of matrix) for (const cell of row) { const code = cellCode(cell); if (code != null) codes.add(code); }

  const sorted = [...codes].sort();
  // 半角块字符组：足够密，且不像 emoji 那样宽度不定
  const palette = ".:-=+*#%@&$XO0abcdefghijklmnopqrstuvwxyz".split("");
  const map = new Map();
  sorted.forEach((code, index) => map.set(code, palette[index % palette.length]));

  const lines = [];
  for (const row of matrix) {
    let line = "";
    for (let x = 0; x < cols; x++) {
      const code = cellCode(row[x]);
      line += code == null ? " " : map.get(code);
    }
    lines.push(line);
  }

  if (options.includeLegend !== false && sorted.length) {
    lines.push("");
    lines.push(sorted.map((code) => `${map.get(code)}=${code}`).join("  "));
  }
  return lines.join("\n");
}

/**
 * 把实验室报告渲染成 Markdown。**不含任何排名或结论性判断。**
 */
export function renderLabReport(report, options = {}) {
  const title = options.title || "算法实验室 · 三路并排对比";
  const lines = [];
  lines.push(`# ${title}`, "");
  lines.push(
    `- 源图：${report.sourceSize.width}×${report.sourceSize.height} → 图纸 ${report.width}×${report.height}`,
    `- 色板：${report.paletteSize} 色　maxColors：${report.maxColors || "AUTO"}`,
    `- 参考样本：${report.reference.rasterSize.width}×${report.reference.rasterSize.height} 超采样面积均值`,
    `- 背景估计：rgb(${report.reference.backgroundEstimate.join(", ")})`,
    "",
  );

  lines.push("## 十项指标并排", "");
  const header = ["指标", ...report.columns.map((column) => column.label)];
  lines.push(`| ${header.join(" | ")} |`);
  lines.push(`| --- | ${report.columns.map(() => "---:").join(" | ")} |`);
  for (const metric of report.metricKeys) {
    const cells = report.columns.map((column) => {
      const value = column.readings ? column.readings[metric.key] : null;
      return formatMetric(value, metric.format);
    });
    lines.push(`| ${metric.label} | ${cells.join(" | ")} |`);
  }
  lines.push("");

  lines.push("## 结构性读数（非指标，仅供理解差异来源）", "");
  lines.push(`| 项 | ${report.columns.map((column) => column.label).join(" | ")} |`);
  lines.push(`| --- | ${report.columns.map(() => "---:").join(" | ")} |`);
  const extraRows = [
    ["豆数", (column) => column.statistics?.beadCount],
    ["空豆数", (column) => column.statistics?.emptyCount],
    ["同色连通域数量", (column) => column.metrics?.componentCount],
  ];
  for (const [label, getter] of extraRows) {
    lines.push(`| ${label} | ${report.columns.map((column) => formatMetric(getter(column), "int")).join(" | ")} |`);
  }
  lines.push("");

  if (report.pairwise?.length) {
    lines.push("## 逐格差异（只报数）", "");
    lines.push("| 对比 | 总格数 | 不同格数 | 占比 | 仅前者有豆 | 仅后者有豆 |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const pair of report.pairwise) {
      lines.push(`| ${pair.a} vs ${pair.b} | ${pair.totalCells} | ${pair.changed} | ${(pair.changedRatio * 100).toFixed(1)}% | ${pair.onlyA} | ${pair.onlyB} |`);
    }
    lines.push("");
  }

  if (report.errors?.length) {
    lines.push("## 执行错误", "");
    for (const error of report.errors) lines.push(`- **${error.engine}**：${error.message}`);
    lines.push("");
  }

  const withArt = report.columns.filter((column) => column.blockArt);
  if (withArt.length) {
    lines.push("## 输出矩阵（方块字符预览）", "");
    for (const column of withArt) {
      lines.push(`### ${column.label}`, "", "```text", column.blockArt, "```", "");
    }
  }

  lines.push("## 人工判断", "");
  lines.push(
    report.noRanking.note,
    "",
    `- verdict：\`${report.verdict === null ? "null" : report.verdict}\``,
    `- 排序依据：\`${report.noRanking.sortedBy === null ? "null" : report.noRanking.sortedBy}\``,
    `- 产出结论：\`${report.noRanking.recommended === null ? "null（不产出）" : report.noRanking.recommended}\``,
    "",
  );
  return lines.join("\n");
}

export { buildLookup };
