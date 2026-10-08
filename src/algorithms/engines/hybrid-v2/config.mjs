/**
 * Hybrid V2 配置表。
 *
 * 纪律（来自 docs/research/HYBRID_V2_IMPLEMENTATION_PLAN.md §1、§4）：
 *   1. 每个阈值必须带 `origin`，只能是 SOURCE_VERIFIED / CURRENT_VERIFIED / LOCAL_*。
 *   2. `LOCAL_UNVERIFIED` 的参数**默认不进入默认链路**，只能显式配置启用。
 *   3. `ga0my connectivity` 是 UNVERIFIED —— 本文件及整个引擎不得引用它。
 *   4. UNVERIFIED CLAIMED CONCEPT ONLY 不得作为算法依据（孔洞/开口守恒只检测不保证）。
 */

export const PROVENANCE = Object.freeze({
  SOURCE_VERIFIED: "source-verified",
  CURRENT_VERIFIED: "current-verified",
  /** 思想可用但无根 LICENSE（C/D/F）：只能抽象思想，不复制代码。 */
  SOURCE_IDEA_ONLY: "source-idea-only",
  /** 本项目本地策略，外仓无对应实现。 */
  LOCAL_POLICY: "local-policy",
  /** 本地自定义且未 benchmark —— 默认不得启用。 */
  LOCAL_UNVERIFIED: "local-unverified",
});

const A = "A Pindou-Studio@850a4bf (MIT)";
const B = "B mard-bead-generator@309d478 (MIT)";
const E = "E Perler_Beads_Generator@36ac52d (MIT)";
const F = "F kuizuo/pin-dou@e94193c (无根 LICENSE，仅思想)";
const G = "G bead-grid-studio@515e180 (Apache-2.0)";
const CUR = "CURRENT 本仓库 smart-preprocessing/";

function p(value, origin, source, note = "") {
  return Object.freeze({ value, origin, source, note });
}

export const HybridV2Config = Object.freeze({
  sampling: Object.freeze({
    /** A：格内线性 RGB 方差触发二簇。 */
    varianceThresholdTwoMeans: p(0.008, PROVENANCE.SOURCE_VERIFIED, A, "A EDGE_VARIANCE_THRESHOLD 原值"),
    /** A：二簇迭代次数（源码固定 3）。 */
    twoMeansIterations: p(3, PROVENANCE.SOURCE_VERIFIED, A, "A L478–515 固定值"),
    /** A：二簇最少像素。 */
    minPixelsForTwoMeans: p(4, PROVENANCE.SOURCE_VERIFIED, A, "A L405–460"),
    /** B：切到 dominant 的方差阈值。 */
    varianceThresholdDominant: p(0.012, PROVENANCE.SOURCE_VERIFIED, B, "B imageSampling L53–108"),
    /** B：亮度跨度阈值。 */
    luminanceSpanThreshold: p(0.24, PROVENANCE.SOURCE_VERIFIED, B, "B imageSampling L53–108"),
    /** B：dominant 最低桶占比。 */
    dominantShare: p(0.20, PROVENANCE.SOURCE_VERIFIED, B, "B dominantShare 原值"),
    /** B：RGB 桶位宽。 */
    dominantBucketBits: p(4, PROVENANCE.SOURCE_VERIFIED, B, "B RGB 4-bit 桶"),
    /** F：格间触发 —— 四邻最大平均色差。 */
    neighborDeltaTrigger: p(9, PROVENANCE.SOURCE_IDEA_ONLY, F, "F L548–568；仅思想，不复制代码"),
    /** F：格间触发 —— 本格均值与 dominant 的差。 */
    meanDominantDeltaTrigger: p(1.5, PROVENANCE.SOURCE_IDEA_ONLY, F, "F L548–568；仅思想"),
    /** A：alpha 权重大于前景权重时留空。 */
    alphaEmptyThreshold: p(0.5, PROVENANCE.SOURCE_VERIFIED, A, "A 透明权重 > 前景 → 留空"),
    /** 本地定义，审计无对应实现 —— 默认不启用。 */
    trimFraction: p(0.15, PROVENANCE.LOCAL_UNVERIFIED, "local", "robust-mean 专用；adaptive 默认不选中该模式"),
    /** B：格内定点采样（跨度 ≤8 时全取，否则每轴 7 点）。 */
    fixedSampleAxis: p(7, PROVENANCE.SOURCE_VERIFIED, B, "B samplingPositions 7×7"),
    fixedSampleFullSpanMax: p(8, PROVENANCE.SOURCE_VERIFIED, B, "B 跨度 ≤8 全取"),
  }),

  cleanup: Object.freeze({
    /** B：清理允许的源图 ΔE00 增量。 */
    maxSourceDeltaEIncrement: p(3.5, PROVENANCE.SOURCE_VERIFIED, B, "B regionCleanup 允许误差增量"),
    /** B：边缘拒绝阈值。 */
    edgeRejectThreshold: p(0.5, PROVENANCE.SOURCE_VERIFIED, B, "B regionCleanup 边阈"),
    /** B：按模式的清理面积档。 */
    maxComponentSize: p(2, PROVENANCE.SOURCE_VERIFIED, B, "B balanced 档面积 2；同时等于 G 彩色小域 ≤2 格"),
    /** G：每格支持度上限。 */
    cellSupportMax: p(0.42, PROVENANCE.SOURCE_VERIFIED, G, "G L2398–2429 cellSupport<.42"),
    /** G：邻色支持数 ≥ 组件大小 + 2。 */
    neighborColorBonus: p(2, PROVENANCE.SOURCE_VERIFIED, G, "G L2398–2429"),
    /** 本地安全策略：只有 NOISE 且置信度 ≥ 此值才允许自动改格。 */
    noiseConfidenceThreshold: p(0.75, PROVENANCE.LOCAL_POLICY, "local", "审计明确无校准值；保守取高 → 少删保细节"),
    /** 审计要求：UNKNOWN 默认保留。 */
    deleteUnknown: p(false, PROVENANCE.LOCAL_POLICY, "local", "UNKNOWN 绝不因区域小而删除"),
  }),

  topology: Object.freeze({
    /** 孔洞/开口变化默认一律 REJECT（审计：无外仓提供守恒实现）。 */
    allowHoleChange: p(false, PROVENANCE.LOCAL_POLICY, "local", "G/F/E/D 均无孔洞/开口守恒 → 只检测不保证"),
    allowOpeningClosure: p(false, PROVENANCE.LOCAL_POLICY, "local", "同上"),
    /** G：删除前检验同 owner 连通性（8 邻）。 */
    ownerConnectivity: p(8, PROVENANCE.SOURCE_VERIFIED, G, "G ownerConnectedWithout 8 邻"),
    componentConnectivity: p(4, PROVENANCE.CURRENT_VERIFIED, CUR, "CURRENT findConnectedComponents 同色 4 邻"),
  }),

  protection: Object.freeze({
    /** G：accent 色相角距。 */
    accentHueDistance: p(0.55, PROVENANCE.SOURCE_VERIFIED, G, "G L2459–2470 >0.55 rad"),
    accentMaxCount: p(3, PROVENANCE.SOURCE_VERIFIED, G, "G 最多 3 色"),
    /** G：限色时 anchor 删除损失惩罚（非绝对锁）。 */
    anchorDeletePenalty: p(40, PROVENANCE.SOURCE_VERIFIED, G, "G L2495–2515 损失×40；仍可能删除"),
    /** CURRENT：进入保护的最低 tier。 */
    minProtectionTier: p(2, PROVENANCE.CURRENT_VERIFIED, CUR, "ProtectionTier.MEDIUM"),
    /** Phase B.1 保护分层：tier ≥ 此值判 HARD_PROTECT（关键结构），否则 SOFT。 */
    minHardTier: p(3, PROVENANCE.CURRENT_VERIFIED, CUR, "ProtectionTier.HIGH（眼/高光/桥/分离另按层硬判）"),
    detailProtection: p(0.7, PROVENANCE.CURRENT_VERIFIED, CUR, "buildProtectionMap 默认"),
    edgeProtection: p(0.7, PROVENANCE.CURRENT_VERIFIED, CUR, "buildProtectionMap 默认"),
    highlightProtection: p(1.0, PROVENANCE.CURRENT_VERIFIED, CUR, "buildProtectionMap 默认"),
    eyeProtection: p(1.0, PROVENANCE.CURRENT_VERIFIED, CUR, "buildProtectionMap 默认"),
  }),

  flatRegion: Object.freeze({
    /** 平坦区判定：格内方差低于此值。 */
    varianceMax: p(0.008, PROVENANCE.SOURCE_VERIFIED, A, "与 A 的二簇触发同阈值，取反即平坦"),
    /** 平坦区最小面积（低于此不规整，避免动到小结构）。 */
    minArea: p(4, PROVENANCE.LOCAL_POLICY, "local", "过小区域交给七分类处理，不走规整"),
    /** 最大颜色数（超过则不规整）。 */
    maxFragmentColors: p(3, PROVENANCE.LOCAL_POLICY, "local", "碎片度容忍上限"),
    /** 只有占比低于此值的色才被视为「碎片」并被并掉 —— 避免规整动到区块主色。 */
    minorityShareMax: p(0.1, PROVENANCE.LOCAL_POLICY, "local", "保守：只动少数碎片，主色一律不动"),
    /** 平坦块面积占全网格的比例上限：铺满整幅的「块」不是平坦区，跳过。 */
    maxBlockShareOfGrid: p(0.5, PROVENANCE.LOCAL_POLICY, "local", "避免把整幅图当成一个平坦区来规整"),
  }),

  /**
   * 受保护细节参照集（A/B 度量用）。
   *
   * ⚠️ 这套参数只影响**怎么量**，不影响任何一路引擎的生成 ——
   *    CURRENT 和 HYBRID_V2 共用同一份参照集，否则「保护损失」不可比。
   *    全部标 LOCAL_POLICY：它们是度量口径，不是算法。
   */
  protectedReference: Object.freeze({
    /** 结构格：梯度高于自适应阈值（Otsu，含零梯度格）。无参数。 */
    /** 高光格：亮度分位门。 */
    highlightQuantile: p(0.98, PROVENANCE.LOCAL_POLICY, "local", "亮度分位；只做粗筛，后续靠局部对比+块上限收紧"),
    /** 高光格：亮度需高出 5×5 局部均值多少（0–255 量纲）。 */
    highlightDelta: p(12, PROVENANCE.LOCAL_POLICY, "local", "低于此值会把平坦亮区整片算成高光"),
    /** 高光连通块上限（占格数比例）。大块亮区是背景，不是高光。 */
    highlightMaxShare: p(0.02, PROVENANCE.LOCAL_POLICY, "local", "实测：白底+细线图会一次性命中上百格，必须限块"),
    /** 判定「保护丢失」的 CIEDE2000 容差。 */
    colorErrorTolerance: p(12, PROVENANCE.LOCAL_POLICY, "local", "CIEDE2000 ≈12 为可察觉阈值量级"),
  }),

  resolution: Object.freeze({
    candidates: p([52, 78, 104, 120, 140, 160], PROVENANCE.CURRENT_VERIFIED, CUR, "adaptive-resolution/advisor CANDIDATE_LONG_SIDES"),
    /** 结构保留率低于此值 → detail-risk。 */
    structureRetentionMin: p(0.7, PROVENANCE.LOCAL_UNVERIFIED, "local", "未 benchmark；仅用于分类，不用于宣称最优"),
    /** 小组件可表达比例低于此值 → detail-risk。 */
    smallComponentSurvivalMin: p(0.6, PROVENANCE.LOCAL_UNVERIFIED, "local", "同上"),
  }),

  featureFlags: Object.freeze({
    icmSpatialRefinement: p(false, PROVENANCE.SOURCE_VERIFIED, A, "A spatialRefinement；默认 OFF——无眼/高光/轮廓锁会吞 1 豆亮点"),
    dithering: p(false, PROVENANCE.SOURCE_IDEA_ONLY, "A/C 思想", "与平坦区规整直接冲突，默认 OFF"),
    aggressiveRegionMerge: p(false, PROVENANCE.CURRENT_VERIFIED, CUR, "RAG 扩展；按色差合并会跨硬边，默认 OFF"),
    experimentalDominantSampling: p(false, PROVENANCE.SOURCE_VERIFIED, E, "E 色号投票；与限色耦合，须独立臂，默认 OFF"),
    robustMeanSampling: p(false, PROVENANCE.LOCAL_UNVERIFIED, "local", "审计无对应实现，默认 OFF"),
  }),
});

/** 取值：剥掉 provenance 包装，得到纯原始值的树。 */
export function flattenConfig(tree = HybridV2Config) {
  const out = {};
  for (const [key, node] of Object.entries(tree)) {
    if (node && typeof node === "object" && "value" in node) out[key] = node.value;
    else if (node && typeof node === "object") out[key] = flattenConfig(node);
    else out[key] = node;
  }
  return out;
}

/** 逐叶子的溯源表：path → { value, origin, source, note }。 */
export function buildConfigMeta(tree = HybridV2Config, prefix = "") {
  const out = {};
  for (const [key, node] of Object.entries(tree)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (node && typeof node === "object" && "value" in node) {
      out[path] = { value: node.value, origin: node.origin, source: node.source, note: node.note };
    } else if (node && typeof node === "object") {
      Object.assign(out, buildConfigMeta(node, path));
    }
  }
  return out;
}

/** 只允许这些来源进入默认链路；LOCAL_UNVERIFIED 必须显式开启。 */
export const DEFAULT_ENABLED_ORIGINS = Object.freeze([
  PROVENANCE.SOURCE_VERIFIED,
  PROVENANCE.CURRENT_VERIFIED,
  PROVENANCE.LOCAL_POLICY,
]);

export const HYBRID_V2_ENGINE_ID = "hybrid-v2";
export const HYBRID_V2_VERSION = "0.1.0-phase-b";
