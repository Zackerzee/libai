/**
 * Generation Engine V2.5 — Orchestrator / Pipeline Coordinator
 *
 * V2 生成链路：
 *   Source → [Subject Crop] → Sampling Engine V2 → Palette Matching (palette-engine)
 *          → [Auto Background（可靠性门 + 掩码）] → [Stroke Mask] → Detail Protection
 *          → Smart Cleanup → Protected Palette Budget ([Accent Protection]) → Final Grid
 *
 * 方括号里的四步是 V2.5 新增的「智能辅助」，全部**默认关闭**：
 * 只有显式打开对应开关（或选「小白一键」预设）才会进入，保证既有默认链路逐位不变。
 *   - Subject Crop   ：先自动裁到主体，让图案铺满画布（subject-crop.mjs）
 *   - Auto Background：把与边框连通的浅色区域判为真空豆（auto-background.mjs）
 *                      **Stage B2 起先过 background-reliability.mjs 的可靠性门**：
 *                      只有 5 个指标全过（reliable）才真的清格子；uncertain / none 一律 NO-OP。
 *                      这从结构上排除了「安静地把主体啃掉一块」这种最糟的结果。
 *   - Stroke Mask    ：把线稿描边位置抬进保护图，避免描边被清理糊掉（stroke-mask.mjs）
 *   - Accent        ：降色时把关键强调色（眼睛/描边/高光）标为不主动合并（accent-protection.mjs）
 *
 * 本文件只负责编排与 diagnostics，不承载具体算法实现。
 * 算法分属：sampling-engine-v2 / detail-protection-v2 / smart-cleanup-v2 / protected-palette-budget-v2
 *          / subject-crop / auto-background / stroke-mask / accent-protection。
 *
 * Legacy Engine（app.js 的 processImage / nearestColor）保持不动，作为可回退生成路径。
 */

import { sampleGrid, sampleGridAdaptive, analyzeImageFeatures, resolveSamplingMode, cellBounds, SamplingMode } from "./sampling-engine-v2.mjs";
import { buildProtectionMap, calculateSourceEvidence } from "./detail-protection-v2.mjs";
import { smartCleanup } from "./smart-cleanup-v2.mjs";
import { buildPaletteBudgetPlan, applyBudgetPlan, countGridColors } from "./protected-palette-budget-v2.mjs";
import { createPaletteEngine } from "./palette-engine.mjs";
import { cropToSubject } from "./subject-crop.mjs";
import { applyBackgroundBlanks, DEFAULT_BACKGROUND_CONFIG } from "./auto-background.mjs";
import { resolveBackgroundDecision, BACKGROUND_STATUS } from "./background-reliability.mjs";
import { extractStrokeMask } from "./stroke-mask.mjs";
import { detectAnchorColors } from "./accent-protection.mjs";
import { sampleGridPerceptualV3 } from "./perceptual-sampler-v3.mjs";

export { SamplingMode };

/* =========================================================
 * 引擎默认值 —— **不是模式表**
 *
 * Stage B4 §2：这里原来有一张 `GenerationProfiles`（8 行 × 7 字段）。
 * B4 §1 审计证明它在生产链路**不可达**：唯一的模式来源
 * （`services/generation-pipeline.mjs` 的 `GENERATION_MODE_PRESETS`）没有 `preset`
 * 字段，`runGenerationPipeline` 也从不传 `preset`，于是 `resolveOptions`
 * 恒定回落到 photo 那一行；只有 A/B 对比器直调 `generateV2` 时才命中它。
 * 8 行 × 7 字段 = 56 个值里，被真正读到的只有 photo 那一行。
 *
 * 模式表已收敛到 `services/mode-profile.mjs`（唯一 ModeProfile Registry），
 * 该表已删除。这里只留引擎自己的兜底默认值 —— 给直接调用 `generateV2` 的
 * 测试与实验代码用。**不要在恢复一张模式表**：模式只有一份来源。
 * ======================================================= */

export const DEFAULT_GENERATION_V2_CONFIG = Object.freeze({
  sampling: "auto",
  detailProtection: 0.7,
  edgeProtection: 0.7,
  highlightProtection: 1.0,
  eyeProtection: 1.0,
  microDetailProtection: 1.0,
  // 清理保护阈值（0–1）。**越高 → 保护门槛越高 → 跳过越少 → 清理越积极**
  // （smart-cleanup-v2 里 `avgProtection >= threshold` 即跳过该连通块）。
  cleanupProtectionThreshold: 0.5,
  maxColors: 0,
});

/**
 * 采样配置。**导出**给 `services/background-preview-service.mjs` 复用 ——
 * 背景预览必须和真实生成用同一套采样参数，否则「预览说能抠、生成却抠不动」
 * 会变成一类无法解释的偏差。两份各写一份就是等着漂移。
 */
export const SAMPLING_CONFIG_V2 = Object.freeze({
  extraction: { ignoreTransparent: true, alphaThreshold: 8 },
  dominant: { threshold: 12 },
  edgeAware: { edgeThreshold: 0.42, strongEdgeThreshold: 0.62, clusterThreshold: 10, centerBias: 0.2, continuityWeight: 0.25 },
});

function resolveOptions(options = {}) {
  const defaults = DEFAULT_GENERATION_V2_CONFIG;
  return {
    sampling: options.sampling ?? defaults.sampling,
    detailProtection: options.detailProtection ?? defaults.detailProtection,
    edgeProtection: options.edgeProtection ?? defaults.edgeProtection,
    highlightProtection: options.highlightProtection ?? defaults.highlightProtection,
    eyeProtection: options.eyeProtection ?? defaults.eyeProtection,
    microDetailProtection: options.microDetailProtection ?? defaults.microDetailProtection,
    cleanupProtectionThreshold: options.cleanupProtectionThreshold ?? defaults.cleanupProtectionThreshold,
    maxColors: options.maxColors ?? defaults.maxColors,
    // V2.5 智能辅助：默认全关（=== true 严格判定，避免 undefined/真值混淆）
    subjectCrop: options.subjectCrop === true,
    autoBackground: options.autoBackground === true,
    strokeProtection: options.strokeProtection === true,
    accentProtection: options.accentProtection === true,
    // 线稿掩码抬升保护图的增益（1 表示直接取掩码强度）
    strokeProtectionGain: options.strokeProtectionGain ?? 1,
    // 各辅助模块的细项配置（透传，null 时用模块默认）
    subjectCropConfig: options.subjectCropConfig || null,
    backgroundConfig: options.backgroundConfig || null,
    strokeConfig: options.strokeConfig || null,
    accentConfig: options.accentConfig || null,
  };
}

/* =========================================================
 * generateV2 主入口
 * ======================================================= */

/**
 * 把源图的 alpha 下采样成「每格是否以透明像素为主」的 0/1 网格（Stage B2 §11）。
 *
 * 为什么需要它：采样引擎对透明像素是**直接跳过**的（`ignoreTransparent + alphaThreshold`），
 * 于是透明区在 `sampled.colors` 里表现为 `null` —— 而 `null` 在 auto-background 里
 * 原本被当作「数据缺失 = 背景候选」。结果就是：**全透明 PNG 会被判成「检测到浅色背景」**，
 * 把透明和纯色背景混成同一种证据。
 *
 * 这里用与采样一致的 `cellBounds` 划分格子，格内过半像素 alpha ≤ 阈值 → 记 0（透明）。
 * 纯计算，无 DOM；与采样引擎的 alpha 口径一致（同一个 8 阈值）。
 *
 * @param {{data:Uint8ClampedArray,width:number,height:number}} source
 * @param {number} width 目标格数
 * @param {number} height 目标格数
 * @param {number} [alphaThreshold]
 * @returns {Uint8Array} 1 = 不透明（默认），0 = 该格以透明像素为主
 */
export function buildAlphaGrid(source, width, height, alphaThreshold = 8) {
  const grid = new Uint8Array(width * height).fill(1);
  const sw = source.width;
  const sh = source.height;
  const data = source.data;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const b = cellBounds(x, y, sw, sh, width, height);
      const x0 = Math.max(0, Math.floor(b.x0));
      const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil(b.x1)));
      const y0 = Math.max(0, Math.floor(b.y0));
      const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil(b.y1)));
      let total = 0;
      let clear = 0;
      for (let sy = y0; sy < y1; sy++) {
        const row = sy * sw;
        for (let sx = x0; sx < x1; sx++) {
          total += 1;
          if (data[(row + sx) * 4 + 3] <= alphaThreshold) clear += 1;
        }
      }
      if (total > 0 && clear * 2 >= total) grid[y * width + x] = 0;
    }
  }
  return grid;
}

/**
 * source: { data: Uint8ClampedArray, width, height }（ImageData 格式）
 * palette: [{ code, rgb: [r,g,b], hex?, name? }]
 * options: { preset, sampling, detailProtection, edgeProtection, highlightProtection, eyeProtection, microDetailProtection, maxColors }
 * lab:     Stage B4 §6–§10 Algorithm Lab 接缝（见下方说明），默认 null。
 */
export function generateV2({ source, width, height, palette, options = {}, lab = null }) {
  if (!source || !source.data || !source.width || !source.height) throw new Error("generateV2: source (ImageData) required");
  if (!width || !height) throw new Error("generateV2: width/height required");
  if (!Array.isArray(palette) || !palette.length) throw new Error("generateV2: palette required");

  const cfg = resolveOptions(options);
  // 阶段上报（Stage B3）：给 Worker 用的进度钩子。
  // **刻意从 options.onPhase 单独读**，不进 cfg —— 它是函数，不能混进要结构化克隆的配置里。
  // 主线程直跑时传 undefined，零开销、行为逐位不变。
  const reportPhase = typeof options.onPhase === "function" ? options.onPhase : null;
  const phase = (name) => { if (reportPhase) reportPhase(name); };
  const timing = {};
  const t0 = performance.now();

  /* ── Stage B4 §6–§10：Algorithm Lab 接缝 ──────────────────────────────
   *
   * `lab` **刻意与 `options` 分开**，理由比 onPhase 更硬：
   *   1. `options` 会经 `resolveOptions` 变成 `cfg`，而 `cfg` 的定位是
   *      「可结构化克隆的配置」。函数混进去，主线程直跑没事，一旦进 Worker
   *      就在 structuredClone 处抛 DataCloneError，被 `executeGenerationJob`
   *      的 try/catch 吞成 GenerationError —— 表现成「生成失败」，
   *      而不是「你把函数塞进了配置」。查错方向会被彻底带偏。
   *   2. 三个接缝**各自可选**。全为 null 时逐位走原路径，行为零变化 ——
   *      这是「候选算法不进生产」的第一层保证。
   *   3. 候选算法**只能从这里进来**。不得为了跑实验去改 `MODE_PROFILES` ——
   *      那是 §0 第 8 条「未完成视觉 QA 前不得写入 Production ModeProfile」的
   *      结构性保证：生产模式表里没有 lab 字段，就没人能顺手把候选塞进去。
   *
   * 三个接缝的返回值口径：
   *   matchCell  返回 cell（对象）/ null（这格留空，是真实意见）/
   *              undefined（「我没意见」→ 退回 palette-engine，并计数）
   *   refineGrid 原地改 `grid`，或返回**数组**整体替换；其它返回值一律忽略
   *   cleanup    返回 `{ records }`；records 不是数组时按空数组处理
   *
   * 候选算法**抛异常不在这里吞**。Lab 是实验场，静默降级会让「候选崩了」
   * 和「候选跑通了但没效果」长得一模一样 —— 那正是这个项目已经踩过的坑。
   * 让它炸，由 Lab 跑分器记录成一条失败。
   * ─────────────────────────────────────────────────────────────────── */
  const labMatch = typeof lab?.matchCell === "function" ? lab.matchCell : null;
  const labRefine = typeof lab?.refineGrid === "function" ? lab.refineGrid : null;
  const labCleanup = typeof lab?.cleanup === "function" ? lab.cleanup : null;
  const labId = lab && typeof lab.id === "string" && lab.id ? lab.id : (lab ? "unnamed-lab" : null);
  // 候选算法写进这里的任何东西都会出现在 diagnostics.lab.detail。
  // 用它而不是让接缝返回一个形状不定的对象：返回值形状一含糊，
  // 第一个写错的候选就会静默丢掉全部诊断。
  const labReport = {};
  let labMatchFallbacks = 0;

  const paletteEngine = createPaletteEngine(palette);
  const getColorKey = (cell) => (cell ? cell.code : null);

  const samplingConfig = SAMPLING_CONFIG_V2;

  // 0. Subject Crop（可选）：先把画面裁到主体，让图案铺满画布。
  //    裁的是「源图」，网格宽高（width/height）不变，因此不会改变图纸尺寸口径。
  const tCrop = performance.now();
  let samplingSource = source;
  let subjectCropDiag = null;
  if (cfg.subjectCrop) {
    const crop = cropToSubject(source, cfg.subjectCropConfig || {});
    samplingSource = { data: crop.data, width: crop.width, height: crop.height };
    subjectCropDiag = {
      applied: crop.coverage > 0 && (crop.width !== source.width || crop.height !== source.height),
      box: crop.box,
      sourceBox: crop.sourceBox,
      coverage: Math.round(crop.coverage * 10000) / 10000,
      sourceSize: { width: source.width, height: source.height },
      croppedSize: { width: crop.width, height: crop.height },
    };
  }
  timing.subjectCrop = Math.round(performance.now() - tCrop);
  // Opt-in laboratory snapshots: never rematch colors or alter the production cache.
  const inspector = options.inspector === true ? {
    executionOrder: ["S1", "S2", "S3", "S5", "S4", "S6"],
    stages: { S1: { source: { width: samplingSource.width, height: samplingSource.height, data: new Uint8ClampedArray(samplingSource.data) }, resized: false, subjectCrop: subjectCropDiag } },
  } : null;
  const snapshotGrid = (stage, value) => {
    if (inspector) inspector.stages[stage] = { grid: value.map(row => row.map(cell => cell ? { ...cell, rgb: cell.rgb ? [...cell.rgb] : cell.rgb } : null)) };
  };

  // 1. Sampling（AUTO 用 Region-Adaptive，manual 全图单 mode）
  //
  // 注意这里的 `options.preset` **不是生成模式**（模式表已收敛到 mode-profile.mjs），
  // 它只是给自适应采样引擎的「内容预设」提示，决定 `autoProfile` 开不开。
  // 生产链路（runGenerationPipeline）从不传它，所以 `autoProfile` 在生产恒为 false；
  // 只有直调 generateV2 的实验代码会用到。别再往这里塞模式名。
  phase("sampling");
  const tSampling = performance.now();
  const samplingPreset = options.preset || "photo";
  const sampled = options.experimentalSampler === "perceptual-v3"
    ? sampleGridPerceptualV3(samplingSource, width, height)
    : cfg.sampling === SamplingMode.AUTO
    ? sampleGridAdaptive(samplingSource, width, height, { preset: samplingPreset, autoProfile: samplingPreset === "auto", ...samplingConfig })
    : sampleGrid(samplingSource, width, height, { mode: cfg.sampling, ...samplingConfig });
  timing.sampling = Math.round(performance.now() - tSampling);
  const resolvedMode = sampled.resolvedMode;
  if (inspector) inspector.stages.S2 = { colors: sampled.colors.map(row => row.map(color => color ? { ...color } : null)) };

  // 2. Palette Matching（复用 palette-engine）
  //
  // `let` 而不是 `const`：§9 Spatial Refine 的接缝允许候选返回一张新网格整体替换。
  phase("matching");
  const tMatch = performance.now();
  let grid = [];
  for (let y = 0; y < height; y++) {
    grid[y] = [];
    for (let x = 0; x < width; x++) {
      const rgb = sampled.colors[y][x];
      if (!rgb) { grid[y][x] = null; continue; }
      if (labMatch) {
        // 候选需要**格内原始像素**，不是均值 —— §6 Bean Fit 的全部意义就在于
        // 「均值会把一小块高饱和色抹成背景色」。所以这里给的是 source + bounds，
        // 让候选自己决定要不要付读像素的代价。
        const bounds = cellBounds(x, y, samplingSource.width, samplingSource.height, width, height);
        const produced = labMatch({
          x, y, rgb, bounds,
          source: samplingSource, width, height,
          palette, paletteEngine, cellBounds,
          report: labReport,
        });
        if (produced !== undefined) {
          grid[y][x] = produced ? { ...produced } : null;
          continue;
        }
        // 候选说「这一格我没意见」→ 退回生产匹配器，并计数。
        // 计数是必须的：一个只覆盖了 3% 格子的候选看起来也能出图，
        // 没有这个数字，报告会把「大部分格子其实走的是生产路径」当成候选的功劳。
        labMatchFallbacks += 1;
      }
      const matched = paletteEngine.match([rgb.r, rgb.g, rgb.b]);
      grid[y][x] = matched ? { ...matched } : null;
    }
  }
  timing.paletteMatching = Math.round(performance.now() - tMatch);
  snapshotGrid("S3", grid);

  // 2.5 Auto Background（可选）：只把「与边框连通的浅色区」判为真空豆，封闭浅色区保留。
  //     用采样色（而非量化后的色卡色）判定，保留原图层次。
  //
  //     Stage B2：这里**不再无条件应用**掩码。先过可靠性门（§3），
  //     只有 status === "reliable" 才真的清格子；uncertain / none 一律 NO-OP（§4 §5），
  //     并把结论与 5 个指标写进 diagnostics，供 UI 提示与验收取证。
  let backgroundDiag = null;
  if (cfg.autoBackground) {
    const tBg = performance.now();
    // §11：先把「哪些格是透明」算出来。透明格不是背景证据，也不能和纯色背景混为一谈。
    const alphaGrid = buildAlphaGrid(samplingSource, width, height);
    const decision = resolveBackgroundDecision({
      rgbGrid: sampled.colors,
      alphaGrid,
      grid,
      width,
      height,
      options: cfg.backgroundConfig || {},
    });
    let blankedCells = 0;
    if (decision.status === BACKGROUND_STATUS.RELIABLE && decision.mask) {
      blankedCells = applyBackgroundBlanks({ grid, mask: decision.mask, width, height }).blankCells.length;
    }
    backgroundDiag = {
      status: decision.status,
      applied: blankedCells > 0,
      reason: decision.reason,
      removedCount: decision.removedCount,
      removedRatio: Math.round(decision.removedRatio * 10000) / 10000,
      metrics: decision.metrics,
      regionCount: decision.regionCount,
      blankedCells,
      detail: decision.detail,
      // 旧字段（B2 之前就在 diagnostics 里），保留以免下游诊断/报告断掉。
      borderCandidates: decision.detail.borderCandidates,
      floodedCells: decision.detail.floodedCells,
      enclosedKept: decision.detail.enclosedKept,
      totalCandidates: decision.detail.totalCandidates,
      transparentCells: decision.detail.transparentCells,
      lightnessThreshold: (cfg.backgroundConfig || {}).lightnessThreshold ?? DEFAULT_BACKGROUND_CONFIG.lightnessThreshold,
      chromaThreshold: (cfg.backgroundConfig || {}).chromaThreshold ?? DEFAULT_BACKGROUND_CONFIG.chromaThreshold,
      maxColorDelta: (cfg.backgroundConfig || {}).maxColorDelta ?? DEFAULT_BACKGROUND_CONFIG.maxColorDelta,
      width,
      height,
    };
    timing.autoBackground = Math.round(performance.now() - tBg);
  }

  // 3. Detail Protection Map（metadata + reason + tier）
  const tProtection = performance.now();
  const protection = buildProtectionMap({
    grid, width, height,
    sameCell: (a, b) => (a && b ? a.code === b.code : a === b),
    sourceImageData: samplingSource,
    cellBoundsFn: (x, y) => cellBounds(x, y, samplingSource.width, samplingSource.height, width, height),
    options: cfg,
  });
  timing.protection = Math.round(performance.now() - tProtection);

  // 3.5 Stroke Mask（可选）：提取线稿描边强度，下采样到格子分辨率后抬升保护图。
  //     只在开关打开时计算 —— 关闭时不做任何事，默认链路零开销、逐位不变。
  let strokeDiag = null;
  if (cfg.strokeProtection) {
    const tStroke = performance.now();
    const strokeMask = extractStrokeMask(samplingSource, cfg.strokeConfig || {});
    const sw = samplingSource.width;
    const sh = samplingSource.height;
    const threshold = cfg.cleanupProtectionThreshold;
    let raised = 0;
    let strokeCells = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const b = cellBounds(x, y, sw, sh, width, height);
        const x0 = Math.max(0, Math.floor(b.x0));
        const x1 = Math.min(sw, Math.max(x0 + 1, Math.ceil(b.x1)));
        const y0 = Math.max(0, Math.floor(b.y0));
        const y1 = Math.min(sh, Math.max(y0 + 1, Math.ceil(b.y1)));
        let strength = 0;
        for (let sy = y0; sy < y1; sy++) {
          const row = sy * sw;
          for (let sx = x0; sx < x1; sx++) { const v = strokeMask.mask[row + sx]; if (v > strength) strength = v; }
        }
        if (strength <= 0) continue;
        strokeCells += 1;
        const boost = Math.min(1, strength * cfg.strokeProtectionGain);
        const idx = y * width + x;
        if (boost > protection.protectionMap[idx]) {
          if (protection.protectionMap[idx] < threshold && boost >= threshold) raised += 1;
          protection.protectionMap[idx] = boost;
        }
      }
    }
    strokeDiag = {
      density: strokeMask.density,
      threshold: strokeMask.threshold,
      maskSize: { width: sw, height: sh },
      strokeCells,
      raisedAboveThreshold: raised,
      gain: cfg.strokeProtectionGain,
    };
    timing.strokeProtection = Math.round(performance.now() - tStroke);
  }

  // 4. Smart Cleanup（sampling-aware + tier 分层）
  phase("cleanup");
  const tCleanup = performance.now();
  const colorsBeforeCleanup = countGridColors(grid, getColorKey).size;
  const cleanupArgs = {
    grid, getColorKey,
    getRGB: (cell) => (cell ? cell.rgb : null),
    protectionMap: protection.protectionMap,
    tierMap: protection.tierMap,
    samplingModeMap: sampled.modeMap || null,
    getSourceEvidence: (x, y, rgb) => calculateSourceEvidence(samplingSource, cellBounds(x, y, samplingSource.width, samplingSource.height, width, height), rgb),
    options: { protectionThreshold: cfg.cleanupProtectionThreshold, sourceEvidenceThreshold: 0.3, maxComponentSize: 5 },
  };
  // §10 Conservative Cleanup 接缝。候选拿到的是 smartCleanup 的**全部入参**
  // 外加 source / cellBounds / cfg —— 不给原始像素，「1–4 格的眼睛/高光」这类
  // 判断就只能靠保护图猜，而保护图本身是下游产物，拿它当证据是循环论证。
  // `cellBounds` 传出去的是**两参版本**，不是 `sampling-engine-v2` 导出的六参原件。
  // 六参原件在只给 (x, y) 时算出的是 NaN —— `Math.max(0, Math.floor(NaN))` 仍是 NaN，
  // 于是 `cellRect` 拿到 NaN 边界、像素循环一次都不跑、格子源色恒为 null。
  // 后果不是报错，是 §10 的每个连通块都走 `skippedStructure` 分支**静默全不清理**，
  // 而 Lab 指标看上去只是「碎片多一点」。这种失效形状必须靠契约测试钉住，
  // 见 tests/conservative-cleanup.test.mjs 的 cellBounds 有限性用例。
  const cleanupRaw = labCleanup
    ? labCleanup({
      ...cleanupArgs,
      source: samplingSource, width, height, cfg, palette, paletteEngine,
      cellBounds: (x, y) => cellBounds(x, y, samplingSource.width, samplingSource.height, width, height),
      report: labReport,
    })
    : smartCleanup(cleanupArgs);
  // 形状守卫：候选返回 undefined / 少了 records 都不能让后面的
  // `cleanupRecords.length` 炸成一次「生成失败」。
  const cleanupRecords = Array.isArray(cleanupRaw?.records) ? cleanupRaw.records : [];
  const colorsAfterCleanup = countGridColors(grid, getColorKey).size;
  timing.cleanup = Math.round(performance.now() - tCleanup);

  // 4.5 Spatial Refine（Lab §9，可选）
  //
  // **位置是刻意的：Smart Cleanup 之后、Palette Budget 之前。**
  // §9 允许候选从「当前色 / 邻居实际色 / 当前色附近的 Top-K 色卡色」里选，
  // 也就是说它**可能把用色数抬高**。放在 Budget 之后 = maxColors 当场失效，
  // 那是 §16 的硬失败项。放在 Budget 之前，降色仍然由 stage 5 兜底。
  if (labRefine) {
    const tRefine = performance.now();
    const returned = labRefine({
      grid, width, height, source: samplingSource,
      palette, paletteEngine, protection, sampled, getColorKey, cfg,
      report: labReport,
    });
    if (Array.isArray(returned)) grid = returned;
    timing.spatialRefine = Math.round(performance.now() - tRefine);
  }

  // 预算门的判据必须**在 refine 之后重新量**。
  // `colorsAfterCleanup` 是 stage 4 的出口快照，语义上就是「cleanup 之后」，
  // 不能拿它当「预算之前」用 —— §9 允许 refine 引入邻居色/色卡色，
  // 用旧快照做门就会出现「refine 把 3 色撒成 8 色，而门以为还是 3 色，直接跳过降色」，
  // 于是 maxColors 静默失效。lab 为空时两者恒等，生产行为逐位不变。
  const colorsBeforeBudget = countGridColors(grid, getColorKey).size;
  snapshotGrid("S5", grid);

  // 5. Protected Palette Budget（tier/reason 感知 + 可选强调色锚点保护）
  const tBudget = performance.now();
  let budgetPlan = [];
  let forcedProtectedMerges = 0;
  let accentDiag = null;
  let protectedByAccent = 0;

  // 5a. 强调色锚点（可选）：只要开关打开就识别并出诊断（这样即使未触发降色，
  //     用户/诊断也能看到「认到了哪些锚点」）。真正影响降色的是下一步把锚点作为
  //     protectedKeys 传给预算计划 —— 阶段一不主动合并它们，只有确实降不到目标
  //     （阶段二）才会被 forcedProtected 记录后合并。这样眼睛/描边/高光不会因颗数少被优先删。
  let anchorKeys = null;
  if (cfg.accentProtection) {
    const accent = detectAnchorColors({ grid, getColorKey, options: cfg.accentConfig || {} });
    anchorKeys = accent.anchors;
    protectedByAccent = accent.anchors.size;
    const inGrid = new Set();
    for (const row of grid) for (const cell of row) if (cell) inGrid.add(cell.code);
    accentDiag = {
      ...accent.diagnostics,
      anchors: [...accent.anchors],
      neutralAnchors: accent.neutralAnchors,
      chromaticAnchors: [...accent.chromaticAnchors],
      anchorsInGrid: [...accent.anchors].filter((key) => inGrid.has(key)),
      budgetApplied: false,
      anchorForcedMerges: 0,
    };
  }

  if (cfg.maxColors > 0 && colorsBeforeBudget > cfg.maxColors) {
    budgetPlan = buildPaletteBudgetPlan({
      grid, getColorKey,
      getRGBByKey: (key) => { const cell = grid.flat().find((c) => c && c.code === key); return cell ? cell.rgb : null; },
      maxColors: cfg.maxColors,
      protectionMap: protection.protectionMap,
      tierMap: protection.tierMap,
      protectionReasonMap: protection.protectionReasonMap,
      protectedKeys: anchorKeys,
    });
    const keyToCell = (key) => { const cell = grid.flat().find((c) => c && c.code === key); return cell || null; };
    applyBudgetPlan(grid, getColorKey, budgetPlan, keyToCell);
    forcedProtectedMerges = budgetPlan.filter((p) => p.forcedProtected).length;
    if (accentDiag) {
      accentDiag.budgetApplied = true;
      accentDiag.anchorForcedMerges = budgetPlan.filter((p) => p.protectedByAnchor && p.forcedProtected).length;
    }
  }
  timing.paletteBudget = Math.round(performance.now() - tBudget);
  snapshotGrid("S4", grid);
  if (inspector) inspector.stages.S6 = { grid };

  phase("finalize");

  // 6. cleanupMap（被修改的 cell）
  const cleanupMap = new Float32Array(width * height);
  for (const record of cleanupRecords) cleanupMap[record.y * width + record.x] = 1;

  const diagnostics = {
    experimentalSampler: options.experimentalSampler === "perceptual-v3" ? sampled.diagnostics : null,
    specularMask: sampled.specularMask || null,
    shadowAnchorMask: sampled.shadowAnchorMask || null,
    contrastMap: sampled.contrastMap || null,
    importanceMap: sampled.importanceMap || null,
    samplingMode: resolvedMode,
    requestedSampling: cfg.sampling,
    samplingDistribution: sampled.distribution || null,
    preCoherenceDistribution: sampled.preCoherenceDistribution || null,
    samplingConfidenceStats: sampled.confidenceStats || null,
    coherenceChanges: sampled.coherenceChanges || null,
    preCoherenceEdgeCount: sampled.preCoherenceEdgeCount ?? 0,
    postCoherenceEdgeCount: sampled.postCoherenceEdgeCount ?? 0,
    imageProfile: sampled.imageProfile || null,
    stableRegionSizeMap: sampled.stableRegions ? sampled.stableRegions.regionSizeMap : null,
    stableRegionConfidenceMap: sampled.stableRegions ? sampled.stableRegions.regionConfidenceMap : null,
    stableRegionTypeMap: sampled.stableRegions ? sampled.stableRegions.regionTypeMap : null,
    stableInteriorMap: sampled.stableRegions ? sampled.stableRegions.interiorMap : null,
    stableRegionIdMap: sampled.stableRegions ? sampled.stableRegions.regionIdMap : null,
    stabilityScores: sampled.stableRegions ? sampled.stableRegions.stabilityScores : null,
    strictStableMap: sampled.stableRegions ? sampled.stableRegions.strictStable : null,
    perceptualStableMap: sampled.stableRegions ? sampled.stableRegions.perceptualStable : null,
    stableRegionCount: sampled.stableRegions ? sampled.stableRegions.regionCount : 0,
    dominantSuitabilityMap: sampled.stableRegions ? sampled.stableRegions.dominantSuitabilityMap : null,
    shadingScoreMap: sampled.stableRegions ? sampled.stableRegions.shadingScoreMap : null,
    paletteCompactnessMap: sampled.stableRegions ? sampled.stableRegions.paletteCompactnessMap : null,
    luminanceRangeMap: sampled.stableRegions ? sampled.stableRegions.luminanceRangeMap : null,
    gradientCoherenceMap: sampled.stableRegions ? sampled.stableRegions.gradientCoherenceMap : null,
    generationMs: Math.round(performance.now() - t0),
    timing,
    protectedCells: protection.protectedCells,
    protectionDistribution: protection.protectionDistribution,
    protectionReasonCounts: protection.protectionReasonCounts,
    colorsBeforeCleanup,
    colorsAfterCleanup,
    // 预算门真正看到的那个数。和 `colorsAfterCleanup` 分开记，
    // 是为了让「refine 抬高了用色数、随后被预算压回去」这件事在报告里可见 ——
    // 否则只能看到起点和终点，中间的抬升凭空消失。
    colorsBeforeBudget,
    colorsAfterBudget: countGridColors(grid, getColorKey).size,
    cleanupMerges: cleanupRecords.length,
    budgetMerges: budgetPlan.length,
    forcedProtectedMerges,
    // V2.5 智能辅助 diagnostics（未启用时为 null，便于判断是否真的跑过）
    smartFeatures: {
      subjectCrop: cfg.subjectCrop,
      autoBackground: cfg.autoBackground,
      strokeProtection: cfg.strokeProtection,
      accentProtection: cfg.accentProtection,
    },
    subjectCrop: subjectCropDiag,
    autoBackground: backgroundDiag,
    strokeProtection: strokeDiag,
    accentProtection: accentDiag,
    accentProtectedColors: protectedByAccent,
    paletteMatcher: "palette-engine",
    // 这次生成**实际生效**的引擎配置（0–1 口径，已过 resolveOptions 的兜底）。
    // 存在的理由：B4 §4/§5 的 benchmark 要把「源图 / 尺寸 / 色卡 / maxColors / 背景开关」
    // 连同配置一起钉进基线，§17 的决策表也要能证明「这一列是用什么配置跑出来的」。
    // 没有它，报告只能靠调用方自述 —— 那正是会漂移的地方。
    resolvedConfig: {
      sampling: cfg.sampling,
      detailProtection: cfg.detailProtection,
      edgeProtection: cfg.edgeProtection,
      highlightProtection: cfg.highlightProtection,
      eyeProtection: cfg.eyeProtection,
      microDetailProtection: cfg.microDetailProtection,
      cleanupProtectionThreshold: cfg.cleanupProtectionThreshold,
      maxColors: cfg.maxColors,
      // 四个智能辅助开关必须在这里 —— 否则「这一列是在背景开关打开的情况下跑的」
      // 这句话在报告里就无法自证。`subjectCrop` 还额外决定**取景是否变了**，
      // 而取景一变，任何按归一化坐标做的区域对比都不再成立。
      subjectCrop: cfg.subjectCrop,
      autoBackground: cfg.autoBackground,
      strokeProtection: cfg.strokeProtection,
      accentProtection: cfg.accentProtection,
    },
    edgeMap: protection.edgeMap,
    protectionMap: protection.protectionMap,
    protectionReasonMap: protection.protectionReasonMap,
    tierMap: protection.tierMap,
    samplingModeMap: sampled.modeMap || null,
    samplingConfidenceMap: sampled.confidenceMap || null,
    preSamplingModeMap: sampled.preModeMap || null,
    structuralEdgeMap: sampled.structuralEdgeMap || null,
    edgeContinuityMap: sampled.edgeContinuityMap || null,
    regionContexts: sampled.regionContexts || null,
    samplingScoresGrid: sampled.scoresGrid || null,
    highlightMap: protection.highlightMap,
    darkDetailMap: protection.darkDetailMap,
    eyeLikeMap: protection.eyeLikeMap,
    cleanupMap,
    cleanupRecords,
    // Stage B4 §6–§10：候选算法**是否真的挂上来了**。null = 完全没跑 Lab。
    // 这一项存在的唯一理由是：报告里「Candidate 那一列用的是 bean-fit」这句话
    // 必须能自证。否则一张和 Current 一模一样的图，没人分得清
    // 「候选无效」还是「候选根本没接上」—— 后者在本项目已经发生过一次
    // （`requestBackgroundPreview` 的失败路径只收条、不生成）。
    lab: labId ? {
      id: labId,
      matchCell: Boolean(labMatch),
      refineGrid: Boolean(labRefine),
      cleanup: Boolean(labCleanup),
      // 有多少格候选说「我没意见」而退回了生产匹配器。
      // 这个数接近总格数 = 候选实际上没接上。
      matchFallbacks: labMatchFallbacks,
      cleanupRecords: cleanupRecords.length,
      detail: labReport,
    } : null,
  };

  if (inspector) diagnostics.inspector = inspector;
  return { grid, width, height, diagnostics };
}

/* =========================================================
 * A/B API（不覆盖 Legacy）
 * ======================================================= */

/**
 * 同一输入比较 legacy grid 与 v2 grid。
 * 只统计 diagnostics，不作为质量标准。
 */
export function compareGrids(legacyGrid, v2Grid) {
  const getCode = (cell) => (cell ? cell.code : null);
  const height = Math.max(legacyGrid?.length || 0, v2Grid?.length || 0);
  const width = Math.max(legacyGrid?.[0]?.length || 0, v2Grid?.[0]?.length || 0);
  let changedCells = 0;
  let totalCells = 0;
  const legacyColors = new Set();
  const v2Colors = new Set();
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const a = legacyGrid?.[y]?.[x];
      const b = v2Grid?.[y]?.[x];
      totalCells++;
      if (getCode(a) !== getCode(b)) changedCells++;
      if (a) legacyColors.add(getCode(a));
      if (b) v2Colors.add(getCode(b));
    }
  }
  return {
    changedCells,
    changedPercent: totalCells ? changedCells / totalCells : 0,
    colorCountLegacy: legacyColors.size,
    colorCountV2: v2Colors.size,
  };
}

export default {
  SamplingMode,
  DEFAULT_GENERATION_V2_CONFIG,
  SAMPLING_CONFIG_V2,
  buildAlphaGrid,
  generateV2,
  compareGrids,
};
