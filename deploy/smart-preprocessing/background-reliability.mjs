/**
 * Background reliability gate — Stage B2
 *
 * 目的：把「自动去背景」从一个**无条件应用**的算子，变成一个有**置信度与风险判定**的算子。
 *
 * 为什么必须这么做：`auto-background.mjs` 的边框连通 flood fill 本身没有错，
 * 但它对输入毫无抵抗力 —— 浅灰渐变背景、主体与背景同色、白底白衣这类图，
 * 它会「安静地」删掉一大片本该保留的豆。用户看到的是「我的图被啃了一块」，
 * 而不是「算法不确定」。**宁可不抠，不要误删主体。**
 *
 * ── 设计纪律 ──────────────────────────────────────────────────────
 * 1. **不用单一阈值判可靠。** 「ΔE < X 就算可靠」在本仓库被明确禁止：
 *    任何单一数值都能被某一类图绕过去。这里用 5 个**互相独立**的指标
 *    （边框一致性 / 种子一致性 / 前景分离度 / 连通性 / 内部风险），
 *    每一个都必须过线，才判 reliable。
 * 2. **不确定就 NO-OP。** uncertain / none 一律返回 `mask: null`、`removedCount: 0`，
 *    调用方拿不到任何「部分掩码」—— 从结构上排除了「半抠」这种最糟的结果。
 * 3. **不针对样例写 if。** 五个指标都是可解释的通用量（颜色离散度、分位数、连通比例），
 *    没有任何「这张图叫什么名字就怎么判」形状的特判。
 * 4. **Worker 安全。** 纯计算，无 DOM / window / 应用 state；
 *    入参出参都是结构化克隆安全的普通对象与 TypedArray；同一输入必得同一输出。
 *    预览 UI 的逻辑**不在这里**（见 services/background-preview-service.mjs）。
 *
 * 复用 palette-engine 的 rgbToLab / deltaE2000，以及 auto-background 的掩码解析。
 */

import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";
import { resolveBackgroundMask, DEFAULT_BACKGROUND_CONFIG } from "./auto-background.mjs";

/** 三态结论。none = 这张图压根没有可分离的纯色背景。 */
export const BACKGROUND_STATUS = Object.freeze({
  RELIABLE: "reliable",
  UNCERTAIN: "uncertain",
  NONE: "none",
});

export const DEFAULT_RELIABILITY_CONFIG = Object.freeze({
  // A 边框一致性：**边框里有多少比例的格属于「最主流的那个颜色」**（0..1，越高越一致）。
  //   下限 0.8。
  //
  //   为什么不是「与中位色的平均偏差」：左白右灰这种双峰分布，中位数恰好落在中间，
  //   两边到中位数的偏差都不大 —— 一个真正的渐变会被读成「一致」。
  //   为什么不是「极差」：主体横穿边框（四角同色但主体接触边缘）会把极差拉满，
  //   那是**主体**，不是背景不一致。
  //   「主流色覆盖率」同时躲开这两个坑：主体是少数派，渐变是多数派。
  borderConsistencyMin: 0.8,
  // 判定「同一个颜色」的 ΔE 门槛（只用于边框聚类）。
  borderClusterDelta: 10,
  // B 种子一致性：各背景区种子色两两 ΔE 的最大值上限。
  //   候选门槛（够亮 + 够中性）本身已经把颜色锁在一个不大的范围里，
  //   所以这里的门槛必须比它更紧才有意义：边框上出现一小块**另一种**浅色
  //   （白底角落一块淡蓝）时，flood 会把它当成第二个背景区 —— 那说明
  //   「背景是一个颜色」这个前提不成立。
  seedAgreementMax: 12,
  // C 前景分离度：**边界前景格**与背景参考色 ΔE 的 25 分位下限。
  //   只统计「与背景相邻」的前景格 —— 被轮廓包住、压根不挨着背景的内部同色区
  //   （白底图里的白衬衫）不该拖低这个数。
  //   用 25 分位而不是中位数：只要「最近的那四分之一边界」离背景够远才算安全。
  foregroundSeparationMin: 12,
  // D 连通性：flooded / totalCandidates × 区域数惩罚，下限。
  connectivityMin: 0.4,
  maxRegionsForConnectivity: 8,
  // E 内部风险：背景↔前景相邻对里 ΔE 低于 weakEdgeDelta 的占比上限。
  //   边界太弱说明 flood 可能已经穿过主体边缘。
  interiorRiskMax: 0.05,
  weakEdgeDelta: 8,
  // 边框里至少这么多比例得是「够亮够中性」的候选，否则这张图没有纯色背景。
  minBorderCandidateRatio: 0.25,
  // 移除比例过小就不值得动（也不该给用户一个「已去背景」的假象）。
  minRemovedRatio: 0.005,
  // 统计上限：大图只抽样算分位数，保证确定性 + 有界耗时。
  sampleCap: 20000,
  // 边框两两 ΔE 的抽样上限（64 个点 = 2016 对，O(1) 且足够稳定）。
  borderSampleCap: 64,
});

/** 用户可读文案（§7）。绝不出「失败 / 算法错误」这类词。 */
export const BACKGROUND_KEEP_MESSAGE = "这张图没有检测到可以安全分离的纯色背景，已保持原图。";

export function formatBackgroundRemovalMessage(removedCount, removedRatio) {
  const ratio = Number(removedRatio) || 0;
  const percent = (ratio * 100).toFixed(ratio >= 0.1 ? 0 : 1);
  return `检测到可安全移除背景 · 预计移除 ${Number(removedCount) || 0} 格 · ${percent}%`;
}

/* =========================================================
 * 小工具
 * ======================================================= */

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/** 就地排序后的分位数（p ∈ [0,1]）。空数组返回 0。 */
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  if (sorted.length === 1) return sorted[0];
  const pos = clamp01(p) * (sorted.length - 1);
  const low = Math.floor(pos);
  const high = Math.ceil(pos);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (pos - low);
}

function median(sorted) {
  return percentile(sorted, 0.5);
}

/** 大样本等距抽样，保证同一输入必得同一子集（确定性）。 */
function sampleEvenly(values, cap) {
  if (values.length <= cap) return values;
  const step = values.length / cap;
  const out = [];
  for (let i = 0; i < cap; i += 1) out.push(values[Math.floor(i * step)]);
  return out;
}

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

/* =========================================================
 * 指标计算
 * ======================================================= */

/**
 * 对一份「已解析的掩码」做可靠性评估。**不碰 grid，只看色与掩码。**
 *
 * @param {object} input
 * @param {Array} input.rgbGrid           采样色网格（null 或 {r,g,b}）
 * @param {Uint8Array} [input.alphaGrid]  0 = 透明格
 * @param {number} input.width
 * @param {number} input.height
 * @param {Uint8Array} input.backgroundMask
 * @param {Array} input.regionSeeds       resolveBackgroundMask 的 regionSeeds
 * @param {number} input.regionCount
 * @param {object} input.diagnostics
 * @param {object} [input.options]
 * @returns {{status:string, metrics:object, reason:string, detail:object}}
 */
export function assessBackgroundReliability({
  rgbGrid,
  alphaGrid = null,
  width,
  height,
  backgroundMask,
  regionSeeds = [],
  regionCount = 0,
  diagnostics = {},
  options = {},
} = {}) {
  const cfg = { ...DEFAULT_RELIABILITY_CONFIG, ...options };
  const w = width ?? diagnostics.width ?? 0;
  const h = height ?? diagnostics.height ?? 0;
  const size = w * h;

  const metrics = {
    borderConsistency: 0,
    seedAgreement: 0,
    foregroundSeparation: 0,
    connectivity: 0,
    interiorRisk: 0,
  };
  const detail = {
    width: w,
    height: h,
    regionCount,
    borderCandidates: diagnostics.borderCandidates || 0,
    opaqueBorderCells: diagnostics.opaqueBorderCells || 0,
    transparentCells: diagnostics.transparentCells || 0,
    floodedCells: diagnostics.floodedCells || 0,
    totalCandidates: diagnostics.totalCandidates || 0,
    enclosedKept: diagnostics.enclosedKept || 0,
    borderCandidateRatio: 0,
    foregroundCells: 0,
    boundaryForegroundCells: 0,
    weakBoundaryPairs: 0,
    boundaryPairs: 0,
    backgroundReferenceLab: null,
  };

  if (size === 0) {
    return { status: BACKGROUND_STATUS.NONE, metrics, reason: "空画布，没有可检测的背景。", detail };
  }

  const isTransparent = (idx) => Boolean(alphaGrid) && alphaGrid[idx] === 0;
  const labAt = (x, y) => {
    const idx = y * w + x;
    if (isTransparent(idx)) return null;
    const c = rgbGrid?.[y]?.[x];
    if (!c) return null;
    return rgbToLab([c.r, c.g, c.b]);
  };

  /* ── 边框一致性（A）────────────────────────────────────── */
  const borderLabs = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!(x === 0 || x === w - 1 || y === 0 || y === h - 1)) continue;
      const lab = labAt(x, y);
      if (lab) borderLabs.push(lab);
    }
  }
  detail.borderCandidateRatio = detail.opaqueBorderCells > 0
    ? round2(detail.borderCandidates / detail.opaqueBorderCells)
    : 0;

  if (!borderLabs.length) {
    return { status: BACKGROUND_STATUS.NONE, metrics, reason: "边框没有可用的颜色像素（整幅透明或缺失）。", detail };
  }

  const borderMed = [
    median(borderLabs.map((lab) => lab[0]).sort((a, b) => a - b)),
    median(borderLabs.map((lab) => lab[1]).sort((a, b) => a - b)),
    median(borderLabs.map((lab) => lab[2]).sort((a, b) => a - b)),
  ];
  // 两两 ΔE 均值（抽样，保证有界耗时与确定性）。
  const borderSample = sampleEvenly(borderLabs, cfg.borderSampleCap);
  // 主流色覆盖率：对每个样本点，数出「与它 ΔE ≤ borderClusterDelta」的样本数，取最大值。
  // n ≤ 64 → 至多 4096 次 ΔE，常数级；样本固定 → 结果确定。
  let bestCoverage = 0;
  for (let i = 0; i < borderSample.length; i += 1) {
    let covered = 0;
    for (let j = 0; j < borderSample.length; j += 1) {
      if (deltaE2000(borderSample[i], borderSample[j]) <= cfg.borderClusterDelta) covered += 1;
    }
    if (covered > bestCoverage) bestCoverage = covered;
  }
  metrics.borderConsistency = round2(borderSample.length > 0 ? bestCoverage / borderSample.length : 0);

  /* ── 种子一致性（B）────────────────────────────────────── */
  const seedLabs = regionSeeds
    .map((seed) => seed?.lab)
    .filter((lab) => Array.isArray(lab) && lab.length === 3)
    .slice(0, 16);
  let maxSeedDelta = 0;
  for (let i = 0; i < seedLabs.length; i += 1) {
    for (let j = i + 1; j < seedLabs.length; j += 1) {
      const d = deltaE2000(seedLabs[i], seedLabs[j]);
      if (d > maxSeedDelta) maxSeedDelta = d;
    }
  }
  metrics.seedAgreement = round2(maxSeedDelta);

  /* ── 背景参考色 + 连通性（D）──────────────────────────── */
  const bgLabs = [];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      if (!backgroundMask?.[y * w + x]) continue;
      const lab = labAt(x, y);
      if (lab) bgLabs.push(lab);
    }
  }
  const bgRef = bgLabs.length
    ? [
      median(bgLabs.map((lab) => lab[0]).sort((a, b) => a - b)),
      median(bgLabs.map((lab) => lab[1]).sort((a, b) => a - b)),
      median(bgLabs.map((lab) => lab[2]).sort((a, b) => a - b)),
    ]
    : borderMed;
  detail.backgroundReferenceLab = bgRef.map(round2);

  const floodRatio = detail.totalCandidates > 0 ? detail.floodedCells / detail.totalCandidates : 0;
  const regionScore = clamp01(1 - Math.max(0, regionCount - 1) / Math.max(1, cfg.maxRegionsForConnectivity));
  metrics.connectivity = round2(clamp01(floodRatio) * regionScore);

  /* ── 前景分离度（C）+ 内部风险（E）────────────────────── */
  // 只看「背景 ↔ 前景」的 4 邻接对。这两个指标都建立在同一次边界扫描上，
  // 但问的是**两个不同的问题**：
  //
  //   C 前景分离度 = 边界前景格与背景色的 ΔE（25 分位）→ 主体边缘整体够不够分明？
  //   E 内部风险   = 边界对里 ΔE 低于 weakEdgeDelta 的**占比** → 有没有一小段边界糊在一起？
  //
  // 只看边界前景（而不是全部前景）是关键：白底图里那件**被轮廓包住的**白衬衫
  // 与背景同色，但它压根不挨着背景 —— 把它算进分离度会让「白底白衣 + 清晰轮廓」
  // 这种完全能安全处理的图被误判成 uncertain。真正要问的是「交界处分不分得开」。
  const boundaryForeground = new Map(); // nIdx -> lab
  let boundaryPairs = 0;
  let weakPairs = 0;
  const neighborPairs = [[1, 0], [0, 1]];
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      const hereIsBg = backgroundMask?.[idx] ? 1 : 0;
      const hereLab = labAt(x, y);
      for (const [dx, dy] of neighborPairs) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx >= w || ny >= h) continue;
        const nIdx = ny * w + nx;
        const thereIsBg = backgroundMask?.[nIdx] ? 1 : 0;
        if (hereIsBg === thereIsBg) continue;
        const thereLab = labAt(nx, ny);
        if (!hereLab || !thereLab) continue;
        boundaryPairs += 1;
        const delta = deltaE2000(hereLab, thereLab);
        if (delta < cfg.weakEdgeDelta) weakPairs += 1;
        // 记下「前景那一侧」的格子（哪边是前景取决于 hereIsBg）
        if (hereIsBg) boundaryForeground.set(nIdx, thereLab);
        else boundaryForeground.set(idx, hereLab);
      }
    }
  }
  detail.boundaryPairs = boundaryPairs;
  detail.weakBoundaryPairs = weakPairs;
  detail.boundaryForegroundCells = boundaryForeground.size;
  metrics.interiorRisk = round2(boundaryPairs > 0 ? weakPairs / boundaryPairs : 0);

  const boundaryDeltas = [...boundaryForeground.values()]
    .map((lab) => deltaE2000(lab, bgRef))
    .sort((a, b) => a - b);
  metrics.foregroundSeparation = round2(percentile(sampleEvenly(boundaryDeltas, cfg.sampleCap), 0.25));

  /* ── 前景规模（用于 none 判定，不是指标本身）────────────── */
  let foregroundCells = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const idx = y * w + x;
      if (backgroundMask?.[idx]) continue;
      if (labAt(x, y)) foregroundCells += 1;
    }
  }
  detail.foregroundCells = foregroundCells;

  /* ── 门（§3 / §4 / §5）────────────────────────────────── */
  // none：这张图没有可分离的纯色背景 —— 不是「不确定」，是「本来就没有」。
  if (detail.borderCandidateRatio < cfg.minBorderCandidateRatio) {
    return {
      status: BACKGROUND_STATUS.NONE,
      metrics,
      reason: `边框只有 ${(detail.borderCandidateRatio * 100).toFixed(0)}% 是浅色中性区，这张图没有纯色背景。`,
      detail,
    };
  }
  if (detail.floodedCells === 0) {
    return { status: BACKGROUND_STATUS.NONE, metrics, reason: "没有检测到与边框连通的浅色区域。", detail };
  }
  if (detail.foregroundCells === 0) {
    // 候选格铺满整幅 = flood 把整张图都当成了背景。
    // 这**不是**「这张图没有背景」，而是「浅色门槛把主体也吃进去了」——
    // 典型场景：白底 + 浅灰主体。结论必须落在 uncertain（保持原图），
    // 而且要给出能让用户理解的解释，不能报成「没有可分离的主体」。
    if (detail.totalCandidates >= size) {
      return {
        status: BACKGROUND_STATUS.UNCERTAIN,
        metrics,
        reason: "检测到的浅色区域覆盖了整幅图，无法分离出主体。",
        detail,
      };
    }
    return { status: BACKGROUND_STATUS.NONE, metrics, reason: "整幅都是背景色，没有可分离的主体。", detail };
  }

  // uncertain：有背景的样子，但证据不足以安全分离 —— 多指标，任一不过就退回原图。
  if (metrics.borderConsistency < cfg.borderConsistencyMin) {
    return {
      status: BACKGROUND_STATUS.UNCERTAIN,
      metrics,
      reason: `边框只有 ${(metrics.borderConsistency * 100).toFixed(0)}% 的颜色一致，可能是渐变或照片背景。`,
      detail,
    };
  }
  if (metrics.seedAgreement > cfg.seedAgreementMax) {
    return {
      status: BACKGROUND_STATUS.UNCERTAIN,
      metrics,
      reason: `边框存在多种不同的浅色背景（种子色最大 ΔE=${metrics.seedAgreement}）。`,
      detail,
    };
  }
  if (metrics.foregroundSeparation < cfg.foregroundSeparationMin) {
    return {
      status: BACKGROUND_STATUS.UNCERTAIN,
      metrics,
      reason: `主体边缘与背景颜色过于接近（边界 ΔE 25 分位=${metrics.foregroundSeparation}）。`,
      detail,
    };
  }
  if (metrics.connectivity < cfg.connectivityMin) {
    return {
      status: BACKGROUND_STATUS.UNCERTAIN,
      metrics,
      reason: `浅色区域没有连成一片（连通性=${metrics.connectivity}，区域数=${regionCount}）。`,
      detail,
    };
  }
  if (metrics.interiorRisk > cfg.interiorRiskMax) {
    return {
      status: BACKGROUND_STATUS.UNCERTAIN,
      metrics,
      reason: `背景与主体的边界对比过低（弱边占比=${metrics.interiorRisk}），可能误删主体。`,
      detail,
    };
  }

  return { status: BACKGROUND_STATUS.RELIABLE, metrics, reason: "", detail };
}

/* =========================================================
 * 决策入口（§2 契约）
 * ======================================================= */

/**
 * 解析背景并给出「能不能安全应用」的结论。
 *
 * 返回的 `mask` **只在 reliable 时非 null** —— 这就是 §4 的 SAFE DEFAULT：
 * 结构上不存在「partial mask」这种东西，调用方不可能误用一半的结果。
 *
 * @param {object} input
 * @param {Array} input.rgbGrid
 * @param {Uint8Array} [input.alphaGrid]
 * @param {Array} [input.grid]  canonical grid（`{code,...}|null`），用于算真实移除格数
 * @param {number} input.width
 * @param {number} input.height
 * @param {object} [input.options] 背景阈值 + 可靠性阈值
 * @returns {{
 *   status: string,
 *   mask: Uint8Array|null,
 *   removedCount: number,
 *   removedRatio: number,
 *   metrics: object,
 *   reason: string,
 *   detail: object,
 *   backgroundMask: Uint8Array,
 *   regionCount: number,
 * }}
 */
export function resolveBackgroundDecision({
  rgbGrid,
  alphaGrid = null,
  grid = null,
  width,
  height,
  options = {},
} = {}) {
  const cfg = { ...DEFAULT_RELIABILITY_CONFIG, ...options };
  const w = width ?? (rgbGrid?.[0]?.length || 0);
  const h = height ?? (rgbGrid?.length || 0);
  const size = w * h;

  const maskResult = resolveBackgroundMask({
    rgbGrid,
    width: w,
    height: h,
    alphaGrid,
    options: options.background || options,
  });
  const backgroundMask = maskResult.backgroundMask;

  const assessment = assessBackgroundReliability({
    rgbGrid,
    alphaGrid,
    width: w,
    height: h,
    backgroundMask,
    regionSeeds: maskResult.regionSeeds,
    regionCount: maskResult.regionCount,
    diagnostics: maskResult.diagnostics,
    options,
  });

  // 真实会被清空的格数：原本有颜色 且 落在掩码里。
  // 没有 grid 时退化为「候选格数」—— 预览与生成都用同一个口径会不一致，
  // 所以调用方**应该**传 grid；这里只是不让它崩。
  let removedCount = 0;
  if (grid) {
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const idx = y * w + x;
        if (!grid[y]?.[x]) continue;
        if (backgroundMask[idx]) removedCount += 1;
      }
    }
  } else {
    removedCount = maskResult.diagnostics.floodedCells || 0;
  }
  const removedRatio = size > 0 ? removedCount / size : 0;

  let status = assessment.status;
  let reason = assessment.reason;
  if (status === BACKGROUND_STATUS.RELIABLE && removedRatio < cfg.minRemovedRatio) {
    status = BACKGROUND_STATUS.NONE;
    reason = `可安全移除的背景只占 ${(removedRatio * 100).toFixed(1)}%，不值得改动原图。`;
  }

  const reliable = status === BACKGROUND_STATUS.RELIABLE;

  return {
    status,
    // §4 SAFE DEFAULT：只有 reliable 才给出可应用的掩码。
    mask: reliable ? backgroundMask : null,
    // 原始掩码始终带出来 —— 只给诊断与验收看，**不要**拿它去清格子。
    backgroundMask,
    regionCount: maskResult.regionCount,
    removedCount: reliable ? removedCount : 0,
    removedRatio: reliable ? removedRatio : 0,
    metrics: assessment.metrics,
    reason: reliable ? "" : reason,
    detail: assessment.detail,
  };
}

export { DEFAULT_BACKGROUND_CONFIG };

export default {
  BACKGROUND_STATUS,
  BACKGROUND_KEEP_MESSAGE,
  DEFAULT_RELIABILITY_CONFIG,
  assessBackgroundReliability,
  resolveBackgroundDecision,
  formatBackgroundRemovalMessage,
};
