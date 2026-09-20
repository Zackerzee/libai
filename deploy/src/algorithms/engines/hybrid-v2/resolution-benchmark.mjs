/**
 * Resolution Benchmark —— **104 vs AUTO**（用户第 12 条）。
 *
 * 这是**独立于算法 A/B 的另一组实验**：只改分辨率，算法臂固定（都用 HYBRID_V2）。
 * 目的：区分「A. 算法变好了」与「B. 只是因为尺寸变大了」。
 *
 * ⚠️ 两组实验**禁止混在一起**；本文件也不声称 AUTO 更好。
 */

import { runHybridV2 } from "./index.mjs";
import { evaluateCandidateSizes } from "./resolution.mjs";
import { snapshot, METRIC_KEYS, sourceProtectedCells } from "./metrics.mjs";
import { flattenConfig } from "./config.mjs";
import { downsample } from "./resolution.mjs";

export const RESOLUTION_ARMS = Object.freeze({
  FIXED_104: "fixed-104",
  AUTO: "auto",
});

function lumaOf(imageData, cols, rows) {
  const rgb = downsample(imageData, cols, rows);
  const luma = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  return luma;
}

/**
 * @param {object} input { imageData, palette, maxColors, fixedLongSide = 104 }
 */
export function compareResolutionArms(input) {
  const { imageData, palette, sourceWidth, sourceHeight } = input;
  const maxColors = Math.max(0, Number(input.maxColors) || 0);
  const w = sourceWidth || imageData.width;
  const h = sourceHeight || imageData.height;
  const fixed = input.fixedLongSide ?? 104;

  const fixedCols = w >= h ? fixed : Math.max(4, Math.round(fixed * w / h));
  const fixedRows = h > w ? fixed : Math.max(4, Math.round(fixed * h / w));

  const evaluation = evaluateCandidateSizes({ imageData, sourceWidth: w, sourceHeight: h });
  const auto = evaluation.recommended || { cols: fixedCols, rows: fixedRows, longSide: fixed };

  const codeToRgb = new Map(palette.map((e) => [String(e.code), e.rgb]));

  const run = (cols, rows) => {
    const result = runHybridV2({ imageData, palette, cols, rows, maxColors });
    const rgb = downsample(imageData, cols, rows);
    const luma = new Float32Array(cols * rows);
    for (let i = 0; i < cols * rows; i++) luma[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
    // 受保护格按各自分辨率从源图重算 —— 两臂格数不同，参照集本来就不同，
    // 所以跨分辨率只比**损失占比**，不比绝对数量。
    const protectedInfo = sourceProtectedCells(rgb, cols, rows);
    const metrics = snapshot(result.matrix, {
      getColorKey: (c) => (c == null ? null : String(c)),
      getRGB: (key) => codeToRgb.get(String(key)) || [0, 0, 0],
      sourceLuma: luma,
      sourceRGB: rgb,
      protectedCells: protectedInfo.marks,
      tolerance: flattenConfig().protectedReference.colorErrorTolerance,
      varianceMax: 0.008,
    });
    return {
      cols,
      rows,
      cellCount: cols * rows,
      usedColors: result.usedColors,
      metrics,
      protectedCells: protectedInfo.edgeCount + protectedInfo.highlightCount,
    };
  };

  const fixedArm = run(fixedCols, fixedRows);
  const autoArm = run(auto.cols, auto.rows);

  return {
    benchmark: "104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）",
    fixed: fixedArm,
    auto: { ...autoArm, selection: { ...auto, status: evaluation.status, reasons: evaluation.reasons } },
    evaluation,
    /** 恒为 null。 */
    winner: null,
    crossComparisonWarning: "两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。",
    comparison: compareAcrossResolutions(fixedArm, autoArm),
  };
}

/**
 * 跨分辨率比较：只标方向（更多/更少/相同），不判优劣。
 * 归一化到「每 100 格」以消除尺寸差，但**仍不构成质量结论**。
 */
function compareAcrossResolutions(fixedArm, autoArm) {
  const out = {};
  for (const key of METRIC_KEYS) {
    const a = norm(fixedArm.metrics[key], fixedArm.cellCount);
    const b = norm(autoArm.metrics[key], autoArm.cellCount);
    if (a == null || b == null) { out[key] = { direction: "incomparable", per100: { fixed: a, auto: b } }; continue; }
    const rel = (b - a) / (Math.abs(a) || 1);
    out[key] = {
      direction: Math.abs(rel) < 0.02 ? "same" : b > a ? "more-per-cell" : "fewer-per-cell",
      per100: { fixed: a, auto: b },
      relative: Math.round(rel * 1000) / 1000,
    };
  }
  return out;
}

function norm(value, cellCount) {
  if (value == null) return null;
  if (typeof value === "number") return Math.round((value / cellCount) * 100 * 100) / 100;
  if (typeof value === "object" && "f1" in value) return value.f1 == null ? null : Math.round(value.f1 * 1000) / 1000;
  return null;
}

export function renderResolutionReport(report) {
  const lines = [];
  lines.push(`# ${report.benchmark}`, "");
  lines.push(`- 固定臂：${report.fixed.cols}×${report.fixed.rows}（${report.fixed.cellCount} 格）`);
  lines.push(`- AUTO 臂：${report.auto.cols}×${report.auto.rows}（${report.auto.cellCount} 格，长边 ${report.auto.selection.longSide ?? "?"}）`);
  lines.push(`- 尺寸评估状态：\`${report.evaluation.status}\``);
  lines.push(`- 选择理由：${report.auto.selection.reasons.join(" / ")}`, "");
  lines.push("| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |");
  lines.push("| --- | ---: | ---: | --- |");
  for (const key of METRIC_KEYS) {
    const c = report.comparison[key];
    lines.push(`| ${key} | ${c.per100?.fixed ?? "—"} | ${c.per100?.auto ?? "—"} | ${c.direction} |`);
  }
  lines.push(
    "",
    `保护损失占比：固定104 ${((report.fixed.metrics.protectedDetailLossRatio ?? 0) * 100).toFixed(1)}%`
    + `（${report.fixed.protectedCells} 个受保护格）　AUTO ${((report.auto.metrics.protectedDetailLossRatio ?? 0) * 100).toFixed(1)}%`
    + `（${report.auto.protectedCells} 个受保护格）`,
    "",
    "注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。",
  );
  lines.push("", `winner：\`null\`（本工具不产出）`, "", report.crossComparisonWarning);
  return lines.join("\n");
}
