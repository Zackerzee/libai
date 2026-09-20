/**
 * A/B Benchmark —— **CURRENT vs HYBRID_V2**（用户第 11 条）。
 *
 * 硬性条件：同一输入图、同一尺寸、**同一 Palette**、**同一 MaxColors**。
 * 禁止为了让 Hybrid V2 好看而改输入参数。
 *
 * 重点：104×104 —— 必须回答「在完全相同的信息容量下，Hybrid V2 是否真的优于 CURRENT？」
 *
 * ⚠️ 本文件**不给 winner、不给总分**。每个指标只标
 *    IMPROVED / REGRESSED / UNCHANGED / INCONCLUSIVE，并给出 BEFORE/AFTER 证据。
 */

import { generateV2 } from "../../../../smart-preprocessing/generation-engine-v2.mjs";
import { runHybridV2 } from "./index.mjs";
import { snapshot, METRIC_KEYS, sourceProtectedCells } from "./metrics.mjs";
import { flattenConfig } from "./config.mjs";
import { downsample } from "./resolution.mjs";

export const BENCHMARK_VERDICT = Object.freeze({
  IMPROVED: "IMPROVED",
  REGRESSED: "REGRESSED",
  UNCHANGED: "UNCHANGED",
  INCONCLUSIVE: "INCONCLUSIVE",
});

/**
 * 指标方向。**方向不明确的指标一律 INCONCLUSIVE**，不猜。
 *   lower-better：孤立豆、边缘杂色、保护损失、平坦区碎片
 *   higher-better：结构相似度
 *   ambiguous：色数、组件数、小组件数、主色占比 —— 少不一定是好事
 */
export const METRIC_DIRECTION = Object.freeze({
  paletteSize: "ambiguous",
  isolatedCellCount: "lower-better",
  componentCount: "ambiguous",
  smallComponentCount: "ambiguous",
  edgeContaminationCount: "lower-better",
  protectedDetailLoss: "lower-better",
  protectedEdgeLoss: "lower-better",
  protectedHighlightLoss: "lower-better",
  flatRegionFragmentation: "lower-better",
  dominantColorRatio: "ambiguous",
  structureSimilarity: "higher-better",
});

/** 最小可分辨阈值：低于它就判 UNCHANGED。 */
const MIN_ABS = Object.freeze({
  paletteSize: 1,
  isolatedCellCount: 1,
  componentCount: 1,
  smallComponentCount: 1,
  edgeContaminationCount: 1,
  protectedDetailLoss: 1,
  protectedEdgeLoss: 1,
  protectedHighlightLoss: 1,
  flatRegionFragmentation: 0.05,
  dominantColorRatio: 0.01,
  structureSimilarity: 0.01,
});

/** 9 项必测之外补的保护细分项（保护损失按来源拆分，便于定位是轮廓还是高光被抹）。 */
export const EXTRA_METRIC_KEYS = Object.freeze([
  "protectedEdgeLoss",
  "protectedHighlightLoss",
]);

const CODE = (cell) => (cell == null ? null : typeof cell === "string" ? cell : cell.code);

/**
 * 两个臂**共用**的度量上下文。
 *
 * 关键：受保护格集合必须来自**源图**，不能来自任一引擎自己的掩码 ——
 * 否则「谁保护得好」会退化成「谁的定义更宽松」。
 */
function sharedContext(imageData, cols, rows, palette, options = {}) {
  const rgb = downsample(imageData, cols, rows);
  const luma = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  const codeToRgb = new Map(palette.map((e) => [String(e.code), e.rgb]));
  const protectedInfo = sourceProtectedCells(rgb, cols, rows, options.protected);
  return {
    getColorKey: CODE,
    getRGB: (key) => codeToRgb.get(String(key)) || [0, 0, 0],
    sourceLuma: luma,
    sourceRGB: rgb,
    protectedCells: protectedInfo.marks,
    tolerance: options.tolerance ?? flattenConfig().protectedReference.colorErrorTolerance,
    varianceMax: 0.008,
    protectedInfo,
  };
}

function toCodeMatrix(grid) {
  return grid.map((row) => row.map((cell) => (cell == null ? null : String(cell.code))));
}

function classify(metricKey, before, after) {
  const direction = METRIC_DIRECTION[metricKey] || "ambiguous";
  const minAbs = MIN_ABS[metricKey] ?? 0.5;

  const pick = (v) => (v && typeof v === "object" && "f1" in v ? v.f1 : v);
  const a = pick(before);
  const b = pick(after);
  if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) {
    return { status: BENCHMARK_VERDICT.INCONCLUSIVE, reason: "指标在当前输入上不可计算" };
  }
  const delta = b - a;
  if (Math.abs(delta) < minAbs) {
    return { status: BENCHMARK_VERDICT.UNCHANGED, delta, before: a, after: b, reason: `|Δ|=${Math.abs(delta).toFixed(4)} < ${minAbs}` };
  }
  if (direction === "ambiguous") {
    return {
      status: BENCHMARK_VERDICT.INCONCLUSIVE, delta, before: a, after: b,
      reason: "该指标方向不明确（多寡都不必然更好），需人工结合图像判断",
    };
  }
  const improved = direction === "lower-better" ? delta < 0 : delta > 0;
  return {
    status: improved ? BENCHMARK_VERDICT.IMPROVED : BENCHMARK_VERDICT.REGRESSED,
    delta, before: a, after: b,
    reason: `${direction}：${a.toFixed(4)} → ${b.toFixed(4)}`,
  };
}

/**
 * @param {object} input { imageData, palette, cols, rows, maxColors, currentOptions }
 * @returns {object} 报告（无 winner）
 */
export function compareCurrentVsHybridV2(input) {
  const { imageData, palette, cols, rows } = input;
  const maxColors = Math.max(0, Number(input.maxColors) || 0);
  const ctx = sharedContext(imageData, cols, rows, palette, {
    protected: input.protectedOptions,
    tolerance: input.tolerance,
  });

  const currentResult = generateV2({
    source: imageData,
    width: cols,
    height: rows,
    palette,
    options: { preset: "auto", maxColors, ...(input.currentOptions || {}) },
  });
  const currentGrid = toCodeMatrix(currentResult.grid);

  const hybridResult = runHybridV2({ imageData, palette, cols, rows, maxColors });
  const hybridGrid = hybridResult.matrix;

  const currentMetrics = snapshot(currentGrid, ctx);
  const hybridMetrics = snapshot(hybridGrid, ctx);

  const verdicts = {};
  for (const key of [...METRIC_KEYS, ...EXTRA_METRIC_KEYS]) {
    verdicts[key] = classify(key, currentMetrics[key], hybridMetrics[key]);
  }

  return {
    benchmark: "CURRENT vs HYBRID_V2",
    ...buildAttention(verdicts),
    size: { cols, rows },
    maxColors,
    paletteSize: palette.length,
    conditions: "同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors",
    /** 受保护格来自源图，两个臂共用同一集合 —— 否则保护损失不可比。 */
    protectedReference: {
      cells: ctx.protectedInfo.edgeCount + ctx.protectedInfo.highlightCount,
      edge: ctx.protectedInfo.edgeCount,
      highlight: ctx.protectedInfo.highlightCount,
      tolerance: ctx.tolerance,
    },
    current: { metrics: currentMetrics, usedColors: countUsed(currentGrid) },
    hybridV2: { metrics: hybridMetrics, usedColors: countUsed(hybridGrid) },
    verdicts,
    /** 恒为 null —— 不替用户选赢家。 */
    winner: null,
    note: "IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。",
  };
}

/**
 * 交叉提示 —— **不是判定**，只是把「看起来变好但可能伴随细节损失」的组合挑出来提醒人工看图。
 * 用户明确要求区分 IMPROVED / REGRESSED / UNCHANGED / INCONCLUSIVE，
 * 所以这里只写 attention，不改任何 verdict。
 */
function buildAttention(verdicts) {
  const notes = [];
  const iso = verdicts.isolatedCellCount;
  const comp = verdicts.componentCount;
  const struct = verdicts.structureSimilarity;
  const protect = verdicts.protectedDetailLoss;

  if (iso?.status === BENCHMARK_VERDICT.IMPROVED && comp?.delta && comp.delta < 0) {
    notes.push(
      `孤立豆下降 ${Math.abs(iso.delta)} 的同时连通域也下降 ${Math.abs(comp.delta)}：`
      + "可能是真清理，也可能是小结构被并掉 —— 必须人工看图确认（componentCount 已标 INCONCLUSIVE）。",
    );
  }
  if (struct?.status === BENCHMARK_VERDICT.REGRESSED) {
    notes.push("结构相似度下降：轮廓/细线可能受损，优先人工复核 THIN_OUTLINE / BRIDGE 夹具。");
  }
  if (protect?.status === BENCHMARK_VERDICT.REGRESSED) {
    notes.push("protectedDetailLoss 上升：保护掩码命中的色被挤掉了，这是硬性风险信号。");
  }
  return { attention: notes };
}

function countUsed(grid) {
  const set = new Set();
  for (const row of grid) for (const cell of row) if (cell != null) set.add(cell);
  return [...set].sort();
}

/** Markdown 渲染（不含结论性措辞）。 */
export function renderBenchmarkReport(report) {
  const lines = [];
  lines.push(`# ${report.benchmark} @ ${report.size.cols}×${report.size.rows}`, "");
  lines.push(`- 条件：${report.conditions}`);
  lines.push(`- 色板 ${report.paletteSize} 色　maxColors：${report.maxColors || "AUTO"}`);
  if (report.protectedReference) {
    const p = report.protectedReference;
    lines.push(
      `- 受保护格基准（**来自源图，两臂共用**）：结构 ${p.edge} + 高光 ${p.highlight} = ${p.cells} 格，`
      + `判定容差 CIEDE2000 ≤ ${p.tolerance}`,
    );
  }
  lines.push("");
  lines.push("| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |");
  lines.push("| --- | ---: | ---: | ---: | --- | --- |");
  for (const key of [...METRIC_KEYS, ...EXTRA_METRIC_KEYS]) {
    const v = report.verdicts[key];
    if (!v) continue;
    const fmt = (x) => (x == null ? "—" : typeof x === "number" ? (Math.abs(x) < 1 ? x.toFixed(3) : x.toFixed(1)) : String(x));
    lines.push(`| ${key} | ${fmt(v.before)} | ${fmt(v.after)} | ${fmt(v.delta)} | ${v.status} | ${v.reason} |`);
  }
  lines.push(
    "",
    `保护损失占比：CURRENT ${((report.current.metrics.protectedDetailLossRatio ?? 0) * 100).toFixed(1)}%`
    + `　HYBRID_V2 ${((report.hybridV2.metrics.protectedDetailLossRatio ?? 0) * 100).toFixed(1)}%`
    + `（受保护格总数 ${report.current.metrics.protectedCellsTotal ?? 0}）`,
  );
  if (report.attention?.length) {
    lines.push("", "## 需要人工复核的点", "");
    for (const note of report.attention) lines.push(`- ${note}`);
  }
  lines.push("", `winner：\`${report.winner === null ? "null" : report.winner}\`（本工具不产出）`, "", report.note);
  return lines.join("\n");
}
