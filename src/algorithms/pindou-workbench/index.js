/**
 * src/algorithms/pindou-workbench · 公开入口
 * ═════════════════════════════════════════════════════════════
 * 从 `beads9/pindou-workbench` 提取的「图片 → 拼豆颜色矩阵」纯算法模块。
 *
 * 上游：https://github.com/beads9/pindou-workbench  commit 26e806f
 * 审计：docs/algorithm-audit-pindou-workbench.md
 * 许可：见同目录 NOTICE（上游 README 声明 MIT，但仓库内无 LICENSE 文件；
 *       本模块因此**不逐字复制上游任何代码**，只借鉴算法思想并自行重写）
 *
 * 三条纪律：
 *   1. **零宿主依赖** —— 不读 `window` / `document` / `canvas` / `localStorage`，
 *      同一份输入在浏览器、Worker、`node --test` 里给出逐位相同的结果。
 *   2. **零数据复制** —— 不内置任何色卡。`palette` 必须由调用方传入。
 *   3. **单一事实源** —— 输出只有一个 `matrix`（`(string|null)[][]`），
 *      不像上游那样同时维护 hex 矩阵与豆号矩阵两个会互相不一致的副本。
 *
 * 计算入口：
 *   `convertImageToBeadsPw(imageData, options)`
 *     → `{ width, height, matrix, colorIds, palette, statistics, diagnostics }`
 *
 * 常用快捷方式：
 *   `upstreamOptions()`  —— 对齐上游语义的一组选项（第六阶段的 PW-ORIGINAL 列）
 *   `improvedOptions()`  —— 上游骨架 + 本模块修复的一组选项
 */

import { PALETTE_MATCH_MODE, PIPELINE_PROFILE, GRID_SAMPLE_MODE, BACKGROUND_MODE, ERODE_MODE, THRESHOLD_MODE } from "./config.js";
import { FIT_MODE, RESAMPLE_FILTER } from "./sampling/cover-resize.js";
import { QUANTIZER } from "./core/pipeline.js";

export { FIT_MODE, RESAMPLE_FILTER };

export {
  PW_CONFIG,
  PW_CONFIG_META,
  ORIGIN,
  UPSTREAM,
  UPSTREAM_ALGORITHM_REGION,
  PRECISION,
  GRID_SAMPLE_MODE,
  THRESHOLD_MODE,
  BACKGROUND_MODE,
  ERODE_MODE,
  PALETTE_MATCH_MODE,
  EDGE_FUSE,
  PIPELINE_PROFILE,
  resolvePrecision,
  upstreamConstants,
  libmsFilledConstants,
} from "./config.js";

export {
  PW_ENGINE_ID,
  PW_MODULE_VERSION,
  QUANTIZER,
  resolveGrid,
  collapseMask,
  convertImageToBeadsPw,
} from "./core/pipeline.js";

export { measureMatrix, METRIC_LABELS, normalizeMatrix, cellCode, buildLookup } from "./core/metrics.js";
export { countGridColors, diffGrids } from "./core/grid-stats.js";
export { runHybridPw, HYBRID_ENGINE_ID, HYBRID_STAGES } from "./core/hybrid.js";
export { runAlgorithmLab, LAB_ENGINES, LAB_METRIC_KEYS, renderLabReport, renderMatrixAsBlockArt } from "./core/lab.js";

/** 各层以命名空间导出，避免同名符号互相覆盖。 */
export * as sampling from "./sampling/index.js";
export * as segmentation from "./segmentation/index.js";
export * as quantization from "./quantization/index.js";
export * as color from "./color/index.js";
export * as core from "./core/pipeline.js";
export * as metrics from "./core/metrics.js";

/** 上游语义的选项档（第六阶段 PW-ORIGINAL 用这一档）。 */
export function upstreamOptions(overrides = {}) {
  return {
    profile: PIPELINE_PROFILE.UPSTREAM,
    paletteMatchMode: PALETTE_MATCH_MODE.ORIGINAL_WEIGHTED_RGB,
    quantizer: QUANTIZER.KMEANS,
    // 上游：Canvas 直接缩放到格数 → 1 格 1 像素；覆盖式裁切；浏览器默认滤波
    supersample: 1,
    samplingMode: GRID_SAMPLE_MODE.POINT,
    fitMode: FIT_MODE.COVER,
    filter: RESAMPLE_FILTER.AUTO,
    // 上游：单尺度 3×3；背景 = 边框均值；多数腐蚀；不读 alpha；不做连通性过滤
    useMultiScale: false,
    backgroundMode: BACKGROUND_MODE.BORDER_MEAN,
    erodeMode: ERODE_MODE.MAJORITY,
    // 上游：不量化背景、不做前景过滤
    useForegroundOnly: false,
    // 上游：feather 声明未用
    feather: 0,
    ...overrides,
  };
}

/** 改善档：同一骨架 + 本模块的修复与可配项。 */
export function improvedOptions(overrides = {}) {
  return {
    profile: PIPELINE_PROFILE.IMPROVED,
    paletteMatchMode: PALETTE_MATCH_MODE.CIEDE2000,
    quantizer: QUANTIZER.KMEANS,
    supersample: 2,
    samplingMode: GRID_SAMPLE_MODE.AREA,
    fitMode: FIT_MODE.COVER,
    filter: RESAMPLE_FILTER.AUTO,
    useMultiScale: false,
    backgroundMode: BACKGROUND_MODE.BORDER_KMEANS_NEAREST,
    erodeMode: ERODE_MODE.MIN_FILTER,
    useForegroundOnly: true,
    ...overrides,
  };
}

/** 上游的算法区间（供工具核对提取范围）。 */
export const UPSTREAM_ALGORITHM_LINES = Object.freeze({ from: 47, to: 253 });
