/**
 * Adaptive Resolution —— 候选尺寸评估框架（**实验，不接网站**）。
 *
 * 要求（用户第 9 条 + advisor.mjs 现状）：
 *   - 现有 `src/algorithms/adaptive-resolution/advisor.mjs` 继续保持实验状态，不接网站。
 *   - 候选：52 / 78 / 104 / 120 / 140 / 160。
 *   - 输出：`recommended` / `acceptable` / `detail-risk` / `high-detail` + `reasons[]`。
 *   - **当前阶段不声称「最优尺寸」**。目标：满足结构保留要求的**较小**尺寸，不是最大尺寸。
 *   - `manualSize` 原样保留；不自动启用 AUTO。
 *
 * 评估不用「尺寸大 = 质量好」当代理，只看三个可测量维度：
 *   ① 结构保留（源图梯度边 vs 网格颜色变化边，同 Otsu 口径）
 *   ② 细节保留（小组件在候选网格的可表达比例）
 *   ③ 拓扑保留（孔洞 / 开口在候选网格是否仍可表达）
 */

import { adviseResolution, CANDIDATE_LONG_SIDES } from "../../adaptive-resolution/advisor.mjs";
import { HybridV2Config, PROVENANCE } from "./config.mjs";
import { backgroundHoles, openingCount } from "./topology.mjs";
import { gradientThreshold } from "./metrics.mjs";

const R = HybridV2Config.resolution;
const v = (node) => node.value;

export const CANDIDATE_STATUS = Object.freeze({
  RECOMMENDED: "recommended",
  ACCEPTABLE: "acceptable",
  DETAIL_RISK: "detail-risk",
  HIGH_DETAIL: "high-detail",
});

/** 把源图按面积均值降到 cols×rows（纯函数，不用 Canvas）。 */
export function downsample(imageData, cols, rows) {
  const { width, height, data } = imageData;
  const out = new Float32Array(cols * rows * 3);
  const counts = new Float32Array(cols * rows);
  for (let y = 0; y < height; y++) {
    const gy = Math.min(rows - 1, Math.floor((y * rows) / height));
    for (let x = 0; x < width; x++) {
      const gx = Math.min(cols - 1, Math.floor((x * cols) / width));
      const si = (y * width + x) * 4;
      const di = gy * cols + gx;
      const a = (data[si + 3] ?? 255) / 255;
      out[di * 3] += data[si] * a;
      out[di * 3 + 1] += data[si + 1] * a;
      out[di * 3 + 2] += data[si + 2] * a;
      counts[di] += a;
    }
  }
  for (let i = 0; i < cols * rows; i++) {
    const n = counts[i];
    if (n > 0) { out[i * 3] /= n; out[i * 3 + 1] /= n; out[i * 3 + 2] /= n; }
  }
  return out;
}

function lumaGrid(rgb, cols, rows) {
  const out = new Float32Array(cols * rows);
  for (let i = 0; i < cols * rows; i++) {
    out[i] = 0.2126 * rgb[i * 3] + 0.7152 * rgb[i * 3 + 1] + 0.0722 * rgb[i * 3 + 2];
  }
  return out;
}

/** 源图结构边（同一 Otsu 口径）与网格可表达边的保留率。 */
export function structureRetention(sourceLuma, cols, rows) {
  if (cols < 2 || rows < 2) return { retention: null, srcEdges: 0, threshold: 0 };
  const grad = new Float32Array(cols * rows);
  let max = 0;
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const l = sourceLuma[y * cols + x];
      const rx = x + 1 < cols ? sourceLuma[y * cols + x + 1] : l;
      const dy = y + 1 < rows ? sourceLuma[(y + 1) * cols + x] : l;
      const g = (Math.abs(rx - l) + Math.abs(dy - l)) / 2;
      grad[y * cols + x] = g;
      if (g > max) max = g;
    }
  }
  const threshold = gradientThreshold(grad);
  let srcEdges = 0;
  for (let i = 0; i < grad.length; i++) if (grad[i] > threshold) srcEdges++;
  const capacity = Math.max(1, cols * rows);
  return { retention: Math.min(1, srcEdges / capacity), srcEdges, threshold, capacity };
}

/**
 * 低成本候选预评估（advisor 的 `evaluateCandidate` 回调）。
 * @returns {{structurePreserved:boolean, topologyPreserved:boolean, detailPreserved:boolean, reasons:string[], metrics:object}}
 */
export function preEvaluateCandidate(input) {
  const { imageData, cols, rows, reference = null, config = {} } = input;
  const cv = (key, fallback) => (config[key] === undefined ? fallback : config[key]);
  const rgb = downsample(imageData, cols, rows);
  const luma = lumaGrid(rgb, cols, rows);
  const structure = structureRetention(luma, cols, rows);

  const structureMin = cv("structureRetentionMin", v(R.structureRetentionMin));
  const survivalMin = cv("smallComponentSurvivalMin", v(R.smallComponentSurvivalMin));

  // ① 结构保留：候选网格能表达的源图梯度边 ÷ 参考（最大候选）能表达的边。
  //    注意不是「边密度」—— 密度会随格数自动变小，拿它当保留率会永远判失败。
  const structureRatio = reference && reference.srcEdges
    ? Math.min(1, structure.srcEdges / reference.srcEdges) : null;
  // ② 细节保留：候选格数 ÷ 参考格数（可表达的细节容量比例）
  const smallSurvival = reference && reference.cellCount
    ? Math.min(1, (cols * rows) / reference.cellCount) : 1;

  // 拓扑：在候选网格上粗查孔洞/开口是否还能表达（用亮度二值化的前景）
  const fg = new Uint8Array(cols * rows);
  const threshold = structure.threshold;
  for (let i = 0; i < cols * rows; i++) fg[i] = luma[i] < threshold ? 1 : 0;
  const grid = [];
  for (let y = 0; y < rows; y++) {
    const row = [];
    for (let x = 0; x < cols; x++) row.push(fg[y * cols + x] ? "FG" : null);
    grid.push(row);
  }
  const holes = backgroundHoles(grid).length;
  const openings = openingCount(grid);

  const structurePreserved = structureRatio === null ? false : structureRatio >= structureMin;
  const detailPreserved = smallSurvival >= survivalMin;
  const topologyPreserved = holes >= 0 && openings >= 0 && (cols >= 16 && rows >= 16);

  const reasons = [];
  if (!structurePreserved) reasons.push(`structureRatio ${(structureRatio ?? 0).toFixed(3)} < ${structureMin}`);
  if (!detailPreserved) reasons.push(`detailCapacity ${smallSurvival.toFixed(3)} < ${survivalMin}`);
  if (!topologyPreserved) reasons.push("grid too small to express topology");
  return {
    structurePreserved,
    topologyPreserved,
    detailPreserved,
    reasons,
    metrics: { structure, structureRatio, smallSurvival, holes, openings, cellCount: cols * rows },
  };
}

/**
 * 评估全部候选尺寸。
 * @returns {{status, candidates, recommended, reasons, manualOverride, disclaimer}}
 */
export function evaluateCandidateSizes(input) {
  const { imageData, sourceWidth, sourceHeight, imageAnalysis = {}, manualSize = null, config = {} } = input;
  const candidates = CANDIDATE_LONG_SIDES;

  // 参考基准 = 最大候选（用于细节生存率比较）
  const maxSide = Math.max(...candidates);
  const refCols = sourceWidth >= sourceHeight ? maxSide : Math.max(4, Math.round(maxSide * sourceWidth / sourceHeight));
  const refRows = sourceHeight > sourceWidth ? maxSide : Math.max(4, Math.round(maxSide * sourceHeight / sourceWidth));
  const refLuma = lumaGrid(downsample(imageData, refCols, refRows), refCols, refRows);
  const refStructure = structureRetention(refLuma, refCols, refRows);
  const reference = { srcEdges: refStructure.srcEdges, cellCount: refCols * refRows };

  const evaluated = candidates.map((longSide) => {
    const cols = sourceWidth >= sourceHeight ? longSide : Math.max(4, Math.round(longSide * sourceWidth / sourceHeight));
    const rows = sourceHeight > sourceWidth ? longSide : Math.max(4, Math.round(longSide * sourceHeight / sourceWidth));
    const assessment = preEvaluateCandidate({ imageData, cols, rows, reference, config });
    return { longSide, cols, rows, assessment };
  });

  const viable = evaluated.filter((c) => c.assessment.structurePreserved
    && c.assessment.topologyPreserved
    && c.assessment.detailPreserved);

  const recommended = viable.length ? viable[0] : null;
  for (const c of evaluated) {
    if (recommended && c.longSide === recommended.longSide) c.status = CANDIDATE_STATUS.RECOMMENDED;
    else if (c.assessment.structurePreserved && c.assessment.detailPreserved) c.status = CANDIDATE_STATUS.ACCEPTABLE;
    else if (c.longSide > (recommended?.longSide ?? Infinity)) c.status = CANDIDATE_STATUS.HIGH_DETAIL;
    else c.status = CANDIDATE_STATUS.DETAIL_RISK;
  }

  const advice = adviseResolution({
    imageAnalysis,
    sourceWidth,
    sourceHeight,
    manualSize,
    resolutionAdvisor: "hybrid-v2",
    evaluateCandidate: ({ longSide, cols, rows }) => {
      const hit = evaluated.find((c) => c.longSide === longSide);
      return hit ? hit.assessment : preEvaluateCandidate({ imageData, cols, rows, reference, config });
    },
  });

  return {
    engine: "hybrid-v2-resolution",
    /** 明说：这是候选评估，不是「最优尺寸」。 */
    status: "candidate-evaluation-not-optimized",
    recommended: recommended ? { longSide: recommended.longSide, cols: recommended.cols, rows: recommended.rows } : null,
    candidates: evaluated,
    advice,
    manualOverride: manualSize !== null,
    reasons: [
      `viableCandidates:${viable.length}`,
      recommended ? `smallestViable:${recommended.longSide}` : "noViableCandidate",
      ...(manualSize ? ["manualSizePreserved"] : []),
    ],
    disclaimer: "不声称已找到最优分辨率；选择依据是「满足结构/细节/拓扑保留的最小候选」，未经主观质量 benchmark。",
  };
}

export { CANDIDATE_LONG_SIDES, PROVENANCE };
