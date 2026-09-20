/**
 * BGS algorithm module — externalized configuration constants.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0).
 * Modified for libms-studio: thresholds that were inline magic numbers in
 * `src/app.js` are lifted here as named constants.
 *
 * Two exports:
 *
 *  • `BGS_CONFIG` — the tree the algorithm actually reads. Every leaf is a **plain
 *    number / array / boolean**, so it can be compared and multiplied directly.
 *
 *  • `BGS_CONFIG_META` — a flattened `'path.to.key' → { value, upstreamValue, note,
 *    calibrated }` map recording where each constant came from. Kept separate on
 *    purpose: wrapping values in `{value}` objects makes `luma > cfg.threshold`
 *    silently false, which is a genuinely nasty class of bug to track down.
 *
 * Constants marked `calibrated: true` differ from upstream and **must be re-validated
 * against the libms image corpus** (ALGORITHM_AUDIT.md §K-8).
 */

/* ─────────────────────────────────────────────────────────────
 * 作者层（带元数据）→ 展平为纯值
 * ───────────────────────────────────────────────────────────── */

function tunable(value, upstreamValue, note) {
  return { __tunable: true, value, upstreamValue, note };
}

const RAW = {
  /* ── 亮度 / 暗阈值 ───────────────────────────────────────── */
  luminance: {
    r: 0.2126,
    g: 0.7152,
    b: 0.0722,
    note: 'Rec.709 luma; upstream uses the same coefficients inline.',
  },
  darkThresholdFallback: tunable(72, 72, 'Otsu 不可用时的兜底暗阈值'),
  darkThresholdRange: [54, 148],
  darkThresholdBias: tunable(14, 14, 'Otsu 结果上偏，避免把灰边当墨线'),
  outlineCutoffCeiling: tunable(70, 70, '轮廓阈值上限：防止抗锯齿灰边被整格放大成粗黑边'),
  neutralChromaForHistogram: tunable(50, 50, '参与 Otsu 直方图的像素彩度上限'),

  /* ── 背景 / 透明 ────────────────────────────────────────── */
  background: {
    minAlpha: 24,
    transparentAlpha: 32,
    sampleMinAlpha: 0.12,
    lightLuminance: tunable(175, 175, '边框像素视为「浅色」的亮度下限（0–255）'),
    lightChromaMax: tunable(55, 55, '边框像素视为「浅色」的彩度上限'),
    minLightBorderRatio: tunable(0.45, 0.45, '边框浅色像素占比达到此值才尝试背景清除'),
    minSimilarRatio: tunable(0.55, 0.55, '与边框基准色相近的像素占比门槛'),
    baseLuminanceMin: tunable(185, 185, '边框基准色亮度下限'),
    baseChromaMax: tunable(48, 48, '边框基准色彩度上限'),
    colorDistanceSq: tunable(58 * 58, 58 * 58, '背景候选与基准色的平方欧氏距离上限'),
    floodLuminanceFloor: tunable(170, 170, '洪水填充的绝对亮度下限'),
    floodLuminanceDelta: tunable(64, 64, '相对基准色的亮度容许下探'),
    floodChromaMax: tunable(58, 58, '洪水填充的彩度上限'),
  },

  /* ── 扫描边伪影剔除 ─────────────────────────────────────── */
  edgeArtifact: {
    uniformRatio: tunable(0.98, 0.98, '整条边与中位亮度偏差 ≤7 的像素占比'),
    neutralRatio: tunable(0.98, 0.98, '整条边彩度 ≤12 的像素占比'),
    medianRange: [80, 220],
    innerNearWhiteRatio: tunable(0.98, 0.98, '内侧两条边必须近乎全白'),
    innerMedianDelta: tunable(64, 64, '内侧中位亮度必须比该边高出此值'),
    inkPercentileGap: tunable(24, 24, '该边中位亮度必须比墨线 P90 高出此值'),
    inkSampleMinCount: 64,
    inkLuminanceMax: tunable(80, 80, '统计墨线 P90 时的亮度上限'),
    inkChromaMax: tunable(12, 12, '统计墨线 P90 时的彩度上限'),
    maxStripFraction: tunable(0.025, 0.025, '伪影条带的最大厚度（占边长比例）'),
    minCoverage: tunable(0.9, 0.9, '伪影条带必须覆盖的最小边长比例'),
    tolerance: 7,
  },

  /* ── 可见色相 / 深色判定 ────────────────────────────────── */
  chromatic: {
    spreadMin: tunable(16, 16, 'visiblyChromatic: 通道极差下限'),
    spreadRatioMin: tunable(0.24, 0.24, 'visiblyChromatic: 极差/最大值 下限'),
    darkLightnessMax: tunable(0.3, 0.3, 'darkPixelIsChromatic: OKLab L 上限'),
    darkSpreadMin: tunable(24, 24, 'darkPixelIsChromatic: 放宽后的极差下限'),
    darkSpreadRatioMin: tunable(0.36, 0.36, 'darkPixelIsChromatic: 放宽后的比例下限'),
  },

  /* ── 线稿判定 ───────────────────────────────────────────── */
  lineArt: {
    neutralChromaMax: tunable(20, 20, '判定「中性」的彩度上限'),
    brightLuminanceMin: tunable(235, 235, '判定「高亮」的亮度下限'),
    brightChromaMax: tunable(24, 24, '判定「高亮」的彩度上限'),
    inkLuminanceMax: tunable(175, 175, '判定「强墨线」的亮度上限'),
    inkChromaMax: tunable(24, 24, '判定「强墨线」的彩度上限'),
    chromaticSpread: tunable(22, 22, '判定「彩色像素」的通道极差'),
    chromaticRelative: tunable(0.15, 0.15, '判定「彩色像素」的相对极差'),
    maskLuminanceMax: tunable(205, 205, '墨线掩码的亮度上限'),
    neutralRatioMin: tunable(0.985, 0.985, '线性稿整体中性度要求'),
    brightRatioMin: tunable(0.62, 0.62, '线性稿整体亮度要求'),
    strongInkRatioMin: tunable(0.006, 0.006, '墨线占比下限'),
    strongInkRatioMax: tunable(0.38, 0.38, '墨线占比上限（过高说明不是线稿）'),
    chromaticRatioMax: tunable(0.012, 0.012, '彩色占比上限'),
    minInkPixels: 4,
    strictInkLuminanceMax: tunable(80, 80, '严格墨线统计的亮度上限'),
    minInkBoundsAreaRatio: tunable(0.0015, 0.0015, '主体连通域最小面积占比'),
    paddingRatio: tunable(0.05, 0.05, '自动裁边的留白比例'),
    minPaddingPx: 2,
    autoCropTrimMin: tunable(0.06, 0.06, '裁边比例低于此值不裁'),
    autoCropRetentionMin: tunable(0.995, 0.995, '墨线保留率低于此值不裁（上游此条件恒真，见 §J 说明）'),
  },

  /* ── 小线稿拓扑保护（核心资产） ──────────────────────────── */
  topology: {
    microLongSide: tunable(192, 192, '中间栅格长边下限；过小会在 16/24 格上提前合并独立部件'),
    microSupersampleMin: 4,
    componentChromaMax: tunable(22, 22, '源连通域标注的彩度上限'),
    rasterCutoffMin: tunable(100, 100, '源墨线栅格化阈值下限'),
    rasterCutoffMax: tunable(156, 156, '源墨线栅格化阈值上限'),
    inkCoverageThreshold: tunable(0.08, 0.08, 'micro 单元判为墨迹的覆盖率门槛'),
    thinMaxRounds: 64,
    candidatesPerOwner: 12,
    strongFillCore: tunable(0.42, 0.42, 'strongFill 的 core 覆盖率门槛'),
    strongFillCoreRelaxed: tunable(0.3, 0.3, 'strongFill 放宽后的 core 门槛（配合 soft）'),
    strongFillSoft: tunable(0.5, 0.5, 'strongFill 放宽路径的 soft 覆盖率门槛'),
    minCandidateScore: tunable(0.008, 0.008, '一个 owner 补位所需的最小支撑度'),
    conflictOwnerWeight: 10,
    conflictCoverageWeight: 3,
    conflictAreaWeight: 1e-4,
    softLuminanceMax: tunable(180, 180, 'soft 墨线掩码的亮度上限'),
    backgroundCoverageKeepBlank: tunable(0.2, 0.2, '背景覆盖率 ≥ 此值且非墨线 → 判为空豆'),
    refinementMaxLongSide: tunable(60, 60, '启用拓扑保护的最大长边'),
  },

  /* ── 内容分类（阈值需在 libms 图库上重新标定，见 §K-4） ───── */
  classify: {
    nearWhiteLuminance: tunable(228, 228, '「近白」亮度下限'),
    nearWhiteChroma: tunable(30, 30, '「近白」彩度上限'),
    darkLuminance: tunable(182, 182, '「暗像素」亮度上限'),
    saturatedChroma: tunable(52, 52, '「高饱和」彩度下限'),
    saturatedLuminance: tunable(245, 245, '「高饱和」亮度上限'),
    edgeDelta: tunable(42, 42, '相邻亮度差超过此值记为一条边'),
    flatPairDelta: tunable(28, 28, '相邻 RGB 绝对差之和低于此值记为「平坦对」'),
    longRunFraction: tunable(0.42, 0.42, '暗 run 长度达到该边长的此比例记为「长线」'),
    glyphMaxAreaRatio: tunable(0.025, 0.025, '字符级连通域的最大面积占比'),
    glyphMaxBoxRatio: tunable(0.16, 0.16, '字符级连通域的最大包围盒占比'),
    docNearWhiteMin: tunable(0.48, 0.48, 'document: 近白像素占比下限'),
    docEdgeDensityMin: tunable(0.03, 0.03, 'document: 边密度下限'),
    docDarkMax: tunable(0.3, 0.3, 'document: 暗像素占比上限'),
    docTransitionDensityMin: tunable(0.025, 0.025, 'document: 转移密度下限（有字符组件时）'),
    docTransitionDensitySolo: tunable(0.05, 0.05, 'document: 无字符组件时的转移密度下限'),
    docScoreMin: tunable(0.6, 0.6, 'document: 综合分下限'),
    photoQuantizedColorsMin: tunable(42, 42, 'photo: 量化后色数下限'),
    photoFlatPairMax: tunable(0.76, 0.76, 'photo: 平坦对比例上限'),
    colorBinShift: 5,
  },

  /* ── 采样 ───────────────────────────────────────────────── */
  sampling: {
    exhaustiveMaxArea: tunable(196, 196, '格面积 ≤ 此值时全像素遍历'),
    photoMaxSamplesPerAxis: tunable(14, 14, 'photo 模式的每轴最大采样数'),
    minValidRatioCartoon: tunable(0.1, 0.1, 'cartoon 模式有效覆盖低于此值则该格留空'),
    whiteCoverageHigh: tunable(0.82, 0.82, '高置信白：近白覆盖率'),
    darkCoverageForWhiteVeto: tunable(0.05, 0.05, '高置信白：中性暗覆盖率上限'),
    nearWhiteChannelMin: 245,
    nearWhiteChromaMax: 12,
    nearWhiteChromaForSample: 12,
    neutralDarkChromaMax: tunable(18, 18, '中性暗采样的彩度上限'),
    outlineSampleChromaMax: tunable(18, 18, '轮廓采样的彩度上限'),
    alphaMin: 0.12,
    detailDarkLuminance: tunable(105, 105, 'detail 模式暗部统计的亮度上限'),
    detailDarkWeightRatio: tunable(0.24, 0.24, '暗部加权触发比例'),
    detailDarkWeightStrengthBase: tunable(0.18, 0.18, '暗部加权基础强度'),
    detailDarkWeightStrengthSlope: tunable(0.9, 0.9, '暗部加权强度斜率'),
    detailDarkWeightStrengthMax: tunable(0.55, 0.55, '暗部加权强度上限'),
    detailDarkLuminanceGap: tunable(18, 18, '暗部与均值亮度差达到此值才加权'),
    detailSharpenStrongLumGap: tunable(8, 8, '局部反差：强反差触发亮度差'),
    detailSharpenStrongAmount: tunable(0.38, 0.38, '局部反差：强度'),
    detailSharpenWeakAmount: tunable(0.18, 0.18, '局部反差：弱强度'),
    detailSharpenImportanceDivisor: tunable(42, 42, '局部反差对重要度的影响分母'),
    detailSharpenImportanceMax: 2,
    outlineFactorBase: tunable(1.66, 1.66, '轮廓像素投票权重基数'),
    outlineFactorGradientGain: tunable(105, 105, '轮廓权重随梯度的增益分母'),
    outlineFactorGradientMax: tunable(1.15, 1.15, '轮廓权重的梯度加成上限'),
    saturatedFactorBase: tunable(1.45, 1.45, '高饱和像素投票权重基数'),
    saturatedFactorGain: tunable(1.25, 1.25, '高饱和权重随饱和度增益'),
    saturatedFactorGradientGain: tunable(180, 180, '高饱和权重的梯度加成分母'),
    saturatedFactorGradientMax: tunable(0.7, 0.7, '高饱和权重的梯度加成上限'),
    brightNeutralFactor: tunable(0.92, 0.92, '亮中性像素的投票权重（略降）'),
    saturatedThreshold: tunable(0.25, 0.25, '饱和度阈值（chroma/max）'),
    thinLineCoverageMin: tunable(0.22, 0.22, '细线：轮廓覆盖率下限'),
    thinLineCoverageMax: tunable(0.5, 0.5, '细线：轮廓覆盖率上限'),
    thinLineGradientMin: tunable(90, 90, '细线：最大轮廓梯度下限'),
    thinLineContinuityMin: tunable(0.84, 0.84, '细线：行/列连续性下限'),
    docInkThresholdBase: tunable(35, 35, 'document 墨线阈值 = darkThreshold + 此值'),
    docInkThresholdRange: [100, 170],
    docNonWhiteLuminance: tunable(232, 232, 'document「非白」亮度上限'),
    docNonWhiteChroma: tunable(28, 28, 'document「非白」彩度下限'),
    docEdgeMagnitude: tunable(58, 58, 'document 边缘梯度幅值下限'),
    docContinuousRunMin: tunable(0.68, 0.68, 'document 连续长线 run 比例下限'),
    docContinuousDarkMin: tunable(0.015, 0.015, 'document 连续长线的暗覆盖率下限'),
    docCoherentDarkMin: tunable(0.04, 0.04, 'document 相干边缘的暗覆盖率下限'),
    docCoherentEdgeMin: tunable(0.08, 0.08, 'document 相干边缘的边密度下限'),
    docCoherenceMin: tunable(0.55, 0.55, 'document 结构张量相干性下限'),
    docSolidInkMin: tunable(0.32, 0.32, 'document 实心墨块覆盖率下限'),
    docTextTransitionMin: tunable(0.18, 0.18, 'document 文字纹理的转移密度下限'),
    docTextRunMax: tunable(0.58, 0.58, 'document 文字纹理的 run 比例上限'),
    docTextCoherenceMax: tunable(0.5, 0.5, 'document 文字纹理的相干性上限'),
    docSolidColorSaturatedMin: tunable(0.18, 0.18, 'document 实心彩块：饱和覆盖率下限'),
    docSolidColorSupportMin: tunable(0.42, 0.42, 'document 实心彩块：主色支撑度下限'),
    docSolidFillMin: tunable(0.38, 0.38, 'document 实心填充：非白覆盖率下限'),
    docColoredStructureRatio: tunable(0.52, 0.52, 'document 彩色结构占比门槛'),
  },

  /* ── 匹配 ───────────────────────────────────────────────── */
  matcher: {
    candidateCount: tunable(32, 32, 'OKLab 预筛候选数，再交给 CIEDE2000 精配'),
    protectDarkLightnessMax: tunable(0.55, 0.55, 'protectDark：OKLab L 上限'),
    protectDarkChromaMax: tunable(0.03, 0.03, 'protectDark：OKLab 彩度上限'),
  },

  /* ── 锚点保护 ───────────────────────────────────────────── */
  anchors: {
    chromaticChromaMin: tunable(0.075, 0.075, '近似「彩色」的 OKLab 彩度下限'),
    saturatedCountMax: 3,
    saturatedHueMinGap: tunable(0.55, 0.55, '鲜艳锚点之间的环形色相最小间距（rad）'),
    neutralCountMax: 2,
  },

  /* ── 合并 / 降色 ────────────────────────────────────────── */
  merge: {
    strengthDivisor: tunable(100, 100, 'mergeStrength(0–30) 除以该值得到 OKLab 距离阈值'),
    strengthMax: 30,
    limitAnchorLossMultiplier: tunable(40, 40, '降色时锚点的损失惩罚倍数'),
    limitChromaPenalty: tunable(2.2, 2.2, '降色损失的彩度惩罚系数'),
    limitImportanceBase: tunable(0.7, 0.7, '降色损失的基线重要度'),
    priorityChromaGain: tunable(2.4, 2.4, 'colorPriority 的彩度增益'),
    priorityDarkBonus: tunable(1.2, 1.2, 'colorPriority 的深色加成'),
    priorityBrightBonus: tunable(0.35, 0.35, 'colorPriority 的亮色加成'),
    priorityImportanceGain: tunable(0.2, 0.2, 'colorPriority 的重要度增益'),
    darkLightnessThreshold: tunable(0.3, 0.3, 'colorPriority「深色」的 OKLab L 上限'),
    brightLightnessThreshold: tunable(0.9, 0.9, 'colorPriority「亮色」的 OKLab L 下限'),
  },

  /* ── 清理 ───────────────────────────────────────────────── */
  cleanup: {
    maxComponentSize: tunable(2, 2, 'cartoon 清理的最大连通域格数'),
    supportVeto: tunable(0.42, 0.42, '支撑度达到此值的格不被清理'),
    chromaticChromaMin: tunable(0.075, 0.075, '只清理彩度高于此值的色（保留灰阶细节）'),
    neighborMargin: tunable(2, 2, '邻居票数必须比连通域格数多出此值才同化；上游要求 ≥ 即 0 余量'),
  },

  /* ── A/B 指标 ───────────────────────────────────────────── */
  metrics: {
    isolateMaxNeighborAgreement: tunable(0.34, 0.34, '孤立像素：8 邻域同色占比低于此值'),
    edgeNeighborDistanceMin: tunable(0.08, 0.08, '边缘杂色：与邻域色差门槛（OKLab）'),
  },

  /* ── 栅格预算 ───────────────────────────────────────────── */
  budget: {
    defaultMaxRasterPixels: 4_000_000,
    documentMaxRasterPixels: 1_600_000,
    maxCellUnit: 64,
  },

  /* ── 网格尺寸上限（libms 不静默夹取，仅用于越界报告） ────── */
  limits: {
    maxGridSide: 512,
    minGridSide: 1,
  },
};

/* ─────────────────────────────────────────────────────────────
 * 展平
 * ───────────────────────────────────────────────────────────── */

function flatten(node, values = {}) {
  for (const [key, value] of Object.entries(node)) {
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.__tunable === true) values[key] = value.value;
      else values[key] = flatten(value, {});
    } else {
      values[key] = value;
    }
  }
  return values;
}

function buildMeta(node, path = [], meta = {}) {
  for (const [key, value] of Object.entries(node)) {
    const next = [...path, key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      if (value.__tunable === true) {
        meta[next.join('.')] = {
          value: value.value,
          upstreamValue: value.upstreamValue,
          note: value.note,
          calibrated: value.value !== value.upstreamValue,
        };
      } else {
        buildMeta(value, next, meta);
      }
    }
  }
  return meta;
}

function deepFreeze(object) {
  if (object && typeof object === 'object') {
    for (const value of Object.values(object)) deepFreeze(value);
    Object.freeze(object);
  }
  return object;
}

/** The tree the algorithm reads. Every leaf is a plain value. */
export const BGS_CONFIG = deepFreeze(flatten(RAW));

/** Flattened `'path.to.key' → { value, upstreamValue, note, calibrated }`. */
export const BGS_CONFIG_META = Object.freeze(buildMeta(RAW));

/** Upstream values keyed by the same paths — used by the regression snapshot test. */
export function upstreamSnapshot() {
  const out = {};
  for (const [path, entry] of Object.entries(BGS_CONFIG_META)) out[path] = entry.upstreamValue;
  return out;
}

/** Constants that diverge from upstream and therefore need re-calibration. */
export function calibratedConstants() {
  return Object.entries(BGS_CONFIG_META)
    .filter(([, entry]) => entry.calibrated)
    .map(([path, entry]) => ({ path, value: entry.value, upstreamValue: entry.upstreamValue }));
}

export default BGS_CONFIG;
