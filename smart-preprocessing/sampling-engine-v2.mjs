/**
 * Generation Engine V2 — Sampling Engine
 *
 * 职责：只回答「原图中这个 Grid Cell 最应该由什么颜色代表」。
 * 输出 RGB 代表色，交给现有 PaletteEngine.match 做色号匹配。
 * 本模块不感知任何 bead code（H7/A1/G03 等）。
 *
 * 复用 palette-engine 的 srgbToLinear / rgbToLab / deltaE2000，
 * 不建立第二份色彩空间转换或色差计算。
 */

import { srgbToLinear, rgbToLab, deltaE2000 } from "./palette-engine.mjs";

export const SamplingMode = Object.freeze({
  LINEAR_MEAN: "linear-mean",
  CENTER: "center",
  DOMINANT: "dominant",
  EDGE_AWARE: "edge-aware",
  AUTO: "auto",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const clamp01 = (value) => clamp(value, 0, 1);

// Linear → sRGB（palette-engine 只提供 sRGB→Linear，反向在此补齐，不改 palette-engine 行为）。
function linearToSrgb(v) {
  const s = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055;
  return Math.round(clamp01(s) * 255);
}

function alphaWeight(p) {
  const alpha = p.a == null ? 1 : p.a / 255;
  if (alpha <= 0) return 0;
  return (p.weight ?? 1) * alpha;
}

/* =========================================================
 * Cell → Source 连续边界映射
 * ======================================================= */

export function cellBounds(x, y, sourceWidth, sourceHeight, gridWidth, gridHeight) {
  return {
    x0: (x * sourceWidth) / gridWidth,
    y0: (y * sourceHeight) / gridHeight,
    x1: ((x + 1) * sourceWidth) / gridWidth,
    y1: ((y + 1) * sourceHeight) / gridHeight,
  };
}

/* =========================================================
 * 像素提取（overlap 面积权重 + alpha）
 * ======================================================= */

export function extractCellPixels(imageData, bounds, options = {}) {
  const { ignoreTransparent = true, alphaThreshold = 8 } = options;
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;

  const px0 = Math.max(0, Math.floor(bounds.x0));
  const py0 = Math.max(0, Math.floor(bounds.y0));
  const px1 = Math.min(W, Math.ceil(bounds.x1));
  const py1 = Math.min(H, Math.ceil(bounds.y1));

  const pixels = [];
  for (let py = py0; py < py1; py++) {
    for (let px = px0; px < px1; px++) {
      const ox0 = Math.max(bounds.x0, px);
      const ox1 = Math.min(bounds.x1, px + 1);
      const oy0 = Math.max(bounds.y0, py);
      const oy1 = Math.min(bounds.y1, py + 1);
      const area = Math.max(0, ox1 - ox0) * Math.max(0, oy1 - oy0);
      if (area <= 0) continue;

      const i = (py * W + px) * 4;
      const a = data[i + 3];
      if (ignoreTransparent && a <= alphaThreshold) continue;

      pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2], a, weight: area });
    }
  }
  return pixels;
}

/* =========================================================
 * Mode A：Linear Mean（Linear RGB + overlap×alpha 权重）
 * ======================================================= */

export function sampleLinearMean(pixels) {
  if (!pixels.length) return null;
  let lr = 0, lg = 0, lb = 0, weight = 0;
  for (const p of pixels) {
    const w = alphaWeight(p);
    if (w <= 0) continue;
    lr += srgbToLinear(p.r) * w;
    lg += srgbToLinear(p.g) * w;
    lb += srgbToLinear(p.b) * w;
    weight += w;
  }
  if (weight <= 0) return null;
  return { r: linearToSrgb(lr / weight), g: linearToSrgb(lg / weight), b: linearToSrgb(lb / weight) };
}

/* =========================================================
 * Mode B：Center（nearest semantics）
 * ======================================================= */

export function sampleCenter(imageData, bounds) {
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  const x = clamp(Math.floor(cx), 0, imageData.width - 1);
  const y = clamp(Math.floor(cy), 0, imageData.height - 1);
  const i = (y * imageData.width + x) * 4;
  return { r: imageData.data[i], g: imageData.data[i + 1], b: imageData.data[i + 2], a: imageData.data[i + 3] };
}

/* =========================================================
 * Mode C：Dominant Cluster（Lab + deltaE2000，overlap 权重 coverage）
 * ======================================================= */

/**
 * deterministic sequential clustering。
 * coverage = Σ overlapArea × alphaWeight（不是 pixel count）。
 * representative = weighted Linear RGB mean。
 */
export function clusterColorsLab(pixels, { threshold = 12 } = {}) {
  const clusters = [];
  for (const p of pixels) {
    const w = alphaWeight(p);
    if (w <= 0) continue;
    const lab = rgbToLab([p.r, p.g, p.b]);
    const lr = srgbToLinear(p.r) * w;
    const lg = srgbToLinear(p.g) * w;
    const lb = srgbToLinear(p.b) * w;

    let best = null;
    let bestDist = Infinity;
    for (const c of clusters) {
      const d = deltaE2000(lab, c.labCenter);
      if (d < bestDist && d <= threshold) { bestDist = d; best = c; }
    }

    if (!best) {
      clusters.push({
        pixels: [p],
        coverage: w,
        labSum: [lab[0] * w, lab[1] * w, lab[2] * w],
        labCenter: lab,
        linearSum: [lr, lg, lb],
      });
    } else {
      best.pixels.push(p);
      best.coverage += w;
      best.labSum[0] += lab[0] * w;
      best.labSum[1] += lab[1] * w;
      best.labSum[2] += lab[2] * w;
      best.linearSum[0] += lr;
      best.linearSum[1] += lg;
      best.linearSum[2] += lb;
      best.labCenter = [best.labSum[0] / best.coverage, best.labSum[1] / best.coverage, best.labSum[2] / best.coverage];
    }
  }

  for (const c of clusters) {
    c.representative = {
      r: linearToSrgb(c.linearSum[0] / c.coverage),
      g: linearToSrgb(c.linearSum[1] / c.coverage),
      b: linearToSrgb(c.linearSum[2] / c.coverage),
    };
  }

  clusters.sort((a, b) =>
    b.coverage - a.coverage ||
    a.labCenter[0] - b.labCenter[0] ||
    a.labCenter[1] - b.labCenter[1] ||
    a.labCenter[2] - b.labCenter[2],
  );
  return clusters;
}

export function sampleDominantCluster(pixels, options = {}) {
  if (!pixels.length) return null;
  const clusters = clusterColorsLab(pixels, options);
  if (!clusters.length) return null;
  return clusters[0].representative;
}

/* =========================================================
 * 统一 Cell Feature 提取（一次扫描，供各 mode 复用）
 * ======================================================= */

export function extractCellFeatures(imageData, bounds, options = {}) {
  const pixels = extractCellPixels(imageData, bounds, options.extraction);
  if (!pixels.length) {
    return { bounds, pixels, totalWeight: 0, centerColor: null, linearMeanColor: null, clusters: [], dominantColor: null, colorVariance: 0, luminanceVariance: 0, gradient: 0, clusterSeparation: 0, edgeScore: 0 };
  }

  const centerColor = sampleCenter(imageData, bounds);
  const linearMeanColor = sampleLinearMean(pixels);
  const clusters = clusterColorsLab(pixels, options.dominant);
  const dominantColor = clusters.length ? clusters[0].representative : null;

  // color variance（Lab 加权）
  const labs = pixels.map((p) => rgbToLab([p.r, p.g, p.b]));
  let totalWeight = 0;
  let lSum = 0, lSumSq = 0;
  for (let idx = 0; idx < pixels.length; idx++) {
    const w = alphaWeight(pixels[idx]);
    if (w <= 0) continue;
    const l = labs[idx][0];
    totalWeight += w;
    lSum += l * w;
    lSumSq += l * l * w;
  }
  const lMean = totalWeight ? lSum / totalWeight : 0;
  const luminanceVariance = totalWeight ? Math.sqrt(Math.max(0, lSumSq / totalWeight - lMean * lMean)) / 50 : 0;

  // gradient（中心四方向 deltaE）
  const cx = (bounds.x0 + bounds.x1) / 2;
  const cy = (bounds.y0 + bounds.y1) / 2;
  const qx = Math.max(1, (bounds.x1 - bounds.x0) * 0.25);
  const qy = Math.max(1, (bounds.y1 - bounds.y0) * 0.25);
  const read = (x, y) => {
    const px = clamp(Math.floor(x), 0, imageData.width - 1);
    const py = clamp(Math.floor(y), 0, imageData.height - 1);
    const i = (py * imageData.width + px) * 4;
    return [imageData.data[i], imageData.data[i + 1], imageData.data[i + 2]];
  };
  const left = read(cx - qx, cy), right = read(cx + qx, cy), top = read(cx, cy - qy), bottom = read(cx, cy + qy);
  const gradient = clamp01(Math.max(deltaE2000(rgbToLab(left), rgbToLab(right)), deltaE2000(rgbToLab(top), rgbToLab(bottom))) / 40);

  // cluster separation（最大两个 cluster 中心距离）
  const clusterSeparation = clusters.length >= 2 ? clamp01(deltaE2000(clusters[0].labCenter, clusters[1].labCenter) / 30) : 0;

  // edgeScore = 0.4*gradient + 0.35*luminanceVariance + 0.25*clusterSeparation
  const edgeScore = clamp01(0.4 * gradient + 0.35 * luminanceVariance + 0.25 * clusterSeparation);

  // micro detail candidate（source-derived，非 grid protection）：
  // 小 cluster（5%~40% coverage）+ 颜色明显偏离 dominant（deltaE > 25）→ 潜在高光/瞳孔/微结构
  let microDetailCandidate = 0;
  if (clusters.length >= 2) {
    const smallCoverage = clusters[1].coverage / (totalWeight || 1);
    const smallDeltaE = deltaE2000(clusters[0].labCenter, clusters[1].labCenter);
    if (smallCoverage > 0.05 && smallCoverage < 0.4 && smallDeltaE > 25) {
      microDetailCandidate = clamp01(smallDeltaE / 60);
    }
  }

  return { bounds, pixels, totalWeight, centerColor, linearMeanColor, clusters, dominantColor, colorVariance: luminanceVariance, luminanceVariance, gradient, clusterSeparation, edgeScore, microDetailCandidate };
}

/* =========================================================
 * 统一 resolve（消费 CellFeatures）
 * ======================================================= */

export function resolveSampling(features, mode, neighborFeatures = null, options = {}) {
  if (!features || !features.pixels || !features.pixels.length) return null;
  switch (mode) {
    case SamplingMode.CENTER:
      return features.centerColor;
    case SamplingMode.DOMINANT:
      return features.dominantColor;
    case SamplingMode.LINEAR_MEAN:
      return features.linearMeanColor;
    case SamplingMode.EDGE_AWARE:
    default:
      return resolveEdgeAware(features, neighborFeatures, options.edgeAware);
  }
}

/**
 * 两阶段 Edge-Aware 的第二阶段：基于已有 CellFeatures 决策。
 * 禁止跨区域平均；从真实 source cluster 中选一个 representative。
 */
export function resolveEdgeAware(features, neighborFeatures = null, options = {}) {
  const {
    edgeThreshold = 0.42,
    strongEdgeThreshold = 0.62,
    centerBias = 0.2,
    continuityWeight = 0.25,
  } = options;

  if (features.edgeScore < edgeThreshold) return features.linearMeanColor;

  const clusters = features.clusters;
  if (!clusters.length) return features.linearMeanColor;
  if (clusters.length === 1) return clusters[0].representative;

  const centerLab = features.centerColor ? rgbToLab([features.centerColor.r, features.centerColor.g, features.centerColor.b]) : null;
  const total = features.totalWeight || 1;

  let winner = null;
  let winnerScore = -Infinity;
  for (const cluster of clusters) {
    const coverage = cluster.coverage / total;
    const centerPresence = centerLab ? 1 - clamp01(deltaE2000(centerLab, cluster.labCenter) / 40) : 0.5;

    let continuity = 0;
    if (neighborFeatures && neighborFeatures.length) {
      const repLab = rgbToLab([cluster.representative.r, cluster.representative.g, cluster.representative.b]);
      let nearest = Infinity;
      for (const nf of neighborFeatures) {
        if (!nf || !nf.dominantColor) continue;
        const d = deltaE2000(repLab, rgbToLab([nf.dominantColor.r, nf.dominantColor.g, nf.dominantColor.b]));
        if (d < nearest) nearest = d;
      }
      if (nearest < Infinity) continuity = 1 - clamp01(nearest / 30);
    }

    let score = coverage;
    if (features.edgeScore >= strongEdgeThreshold) score += centerPresence * centerBias;
    score += continuity * continuityWeight;

    if (score > winnerScore) { winnerScore = score; winner = cluster; }
  }

  return winner ? winner.representative : features.linearMeanColor;
}

/* =========================================================
 * Mode E：AUTO（deterministic，image-level policy）
 * ======================================================= */

export function analyzeImageFeatures(imageData, { maxSamplePixels = 40000 } = {}) {
  const W = imageData.width;
  const H = imageData.height;
  const data = imageData.data;
  const total = W * H;
  const step = Math.max(1, Math.floor(total / maxSamplePixels));

  const colorSet = new Set();
  let sampleCount = 0;
  let lSum = 0, lSumSq = 0;
  const labSamples = [];

  for (let y = 0; y < H; y += step) {
    for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3] <= 8) continue;
      const rgb = [data[i], data[i + 1], data[i + 2]];
      colorSet.add(`${rgb[0] >> 3},${rgb[1] >> 3},${rgb[2] >> 3}`);
      const lab = rgbToLab(rgb);
      lSum += lab[0];
      lSumSq += lab[0] * lab[0];
      labSamples.push(lab);
      sampleCount++;
    }
  }

  if (sampleCount < 2) {
    return { uniqueColorEstimate: 1, localVariance: 0, edgeDensity: 0, flatRegionRatio: 1, pixelScaleEvidence: 0 };
  }

  const lMean = lSum / sampleCount;
  const localVariance = Math.sqrt(Math.max(0, lSumSq / sampleCount - lMean * lMean)) / 50;

  let edgePairs = 0;
  let flatPairs = 0;
  for (let idx = 0; idx < labSamples.length - 1; idx++) {
    const d = deltaE2000(labSamples[idx], labSamples[idx + 1]);
    if (d > 20) edgePairs++;
    else if (d < 3) flatPairs++;
  }
  const pairCount = Math.max(1, labSamples.length - 1);
  const edgeDensity = clamp01(edgePairs / pairCount);
  const flatRegionRatio = flatPairs / pairCount;

  return { uniqueColorEstimate: colorSet.size, localVariance, edgeDensity, flatRegionRatio, pixelScaleEvidence: clamp01(colorSet.size / 2000) };
}

export function resolveSamplingMode(features, preferredMode = SamplingMode.AUTO) {
  if (preferredMode && preferredMode !== SamplingMode.AUTO) return preferredMode;
  const { uniqueColorEstimate, localVariance, edgeDensity, flatRegionRatio } = features;
  if (uniqueColorEstimate < 600 && flatRegionRatio > 0.6 && edgeDensity > 0.15) return SamplingMode.CENTER;
  if (uniqueColorEstimate < 1500 && edgeDensity > 0.25) return SamplingMode.DOMINANT;
  if (uniqueColorEstimate > 2500 && localVariance > 0.2 && flatRegionRatio < 0.5) return SamplingMode.EDGE_AWARE;
  return SamplingMode.EDGE_AWARE;
}

/* =========================================================
 * Grid 级采样（Pass 1 features + Pass 2 edge-aware 两阶段）
 * ======================================================= */

function neighborFeatureList(featuresGrid, x, y) {
  const list = [];
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (ny >= 0 && ny < featuresGrid.length && nx >= 0 && nx < (featuresGrid[ny]?.length || 0)) {
      list.push(featuresGrid[ny][nx]);
    }
  }
  return list;
}

export function sampleGrid(imageData, gridWidth, gridHeight, options = {}) {
  let mode = options.mode || SamplingMode.EDGE_AWARE;
  let imageFeatures = null;
  if (mode === SamplingMode.AUTO) {
    imageFeatures = analyzeImageFeatures(imageData);
    mode = resolveSamplingMode(imageFeatures);
  }

  const featuresGrid = [];
  const colorsGrid = [];

  // Pass 1：extract features
  for (let y = 0; y < gridHeight; y++) {
    featuresGrid[y] = [];
    colorsGrid[y] = [];
    for (let x = 0; x < gridWidth; x++) {
      const bounds = cellBounds(x, y, imageData.width, imageData.height, gridWidth, gridHeight);
      featuresGrid[y][x] = extractCellFeatures(imageData, bounds, options);
    }
  }

  // Pass 2：resolve（Edge-Aware 参考邻域 features）
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const features = featuresGrid[y][x];
      const neighbors = mode === SamplingMode.EDGE_AWARE ? neighborFeatureList(featuresGrid, x, y) : null;
      colorsGrid[y][x] = resolveSampling(features, mode, neighbors, options);
    }
  }

  return { colors: colorsGrid, features: featuresGrid, resolvedMode: mode, imageFeatures };
}

/* =========================================================
 * Phase 2：Region-Adaptive Sampling（AUTO V2）
 * ======================================================= */

export const SamplingModeIndex = Object.freeze({ LINEAR_MEAN: 0, CENTER: 1, DOMINANT: 2, EDGE_AWARE: 3 });

export const PRESET_SAMPLING_WEIGHTS = Object.freeze({
  photo: Object.freeze({ linearMean: 1.2, center: 0.7, dominant: 0.9, edgeAware: 1.1 }),
  portrait: Object.freeze({ linearMean: 1.2, center: 1.0, dominant: 1.0, edgeAware: 1.2 }),
  anime: Object.freeze({ linearMean: 0.5, center: 1.0, dominant: 1.3, edgeAware: 1.2 }),
  illustration: Object.freeze({ linearMean: 0.7, center: 0.8, dominant: 1.3, edgeAware: 1.2 }),
  pixel: Object.freeze({ linearMean: 0.3, center: 2.0, dominant: 0.5, edgeAware: 0.6 }),
  logo: Object.freeze({ linearMean: 0.4, center: 0.5, dominant: 1.4, edgeAware: 1.1 }),
});

/**
 * Region Context（3×3 邻域，复用已提取的 CellFeatures，不重扫 source）。
 * 区分「cell flatness」和「region flatness」：smooth photographic region 的
 * cell 也低 variance 高 coverage，但邻域颜色存在连续渐变（smooth gradient）。
 */
export function computeRegionContext(featuresGrid, x, y, width, height) {
  const center = featuresGrid[y][x];
  if (!center || !center.linearMeanColor) return { regionalColorDrift: 0, regionalSmoothGradient: 0, regionalPaletteDiversity: 0 };

  const centerLab = rgbToLab([center.linearMeanColor.r, center.linearMeanColor.g, center.linearMeanColor.b]);
  let maxDrift = 0;
  const distinctColors = new Set();
  const neighborLabs = [];

  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx, ny = y + dy;
      if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
      const f = featuresGrid[ny][nx];
      if (!f || !f.linearMeanColor) continue;
      const lab = rgbToLab([f.linearMeanColor.r, f.linearMeanColor.g, f.linearMeanColor.b]);
      neighborLabs.push(lab);
      if (f.dominantColor) distinctColors.add(`${f.dominantColor.r},${f.dominantColor.g},${f.dominantColor.b}`);
      maxDrift = Math.max(maxDrift, deltaE2000(centerLab, lab));
    }
  }
  if (neighborLabs.length < 3) return { regionalColorDrift: 0, regionalSmoothGradient: 0, regionalPaletteDiversity: 0 };

  const regionalColorDrift = clamp01(maxDrift / 30);
  const regionalPaletteDiversity = clamp01(distinctColors.size / 9);

  // regionalSmoothGradient：邻域连续渐变（avg deltaE 中等），但任一邻居是 hard edge（max > 22）则归零
  let gradientSum = 0, gradientCount = 0, maxNeighborDelta = 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
    const nf = featuresGrid[ny][nx];
    if (!nf || !nf.linearMeanColor) continue;
    const delta = deltaE2000(centerLab, rgbToLab([nf.linearMeanColor.r, nf.linearMeanColor.g, nf.linearMeanColor.b]));
    gradientSum += delta;
    maxNeighborDelta = Math.max(maxNeighborDelta, delta);
    gradientCount++;
  }
  const avgNeighborDelta = gradientCount ? gradientSum / gradientCount : 0;
  // deltaE 1~11 = 连续渐变；任一邻居 deltaE >= 22 = hard edge → 0
  const regionalSmoothGradient = maxNeighborDelta < 22 ? clamp01((avgNeighborDelta - 1.0) / 10) : 0;

  return { regionalColorDrift, regionalSmoothGradient, regionalPaletteDiversity };
}

/* =========================================================
 * Image Profile（source-statistics 驱动，不用外部 AI / 人脸识别）
 * ======================================================= */

export const IMAGE_PROFILE = Object.freeze({
  PHOTO: "PHOTO",
  PORTRAIT_LIKE: "PORTRAIT_LIKE",
  ILLUSTRATION: "ILLUSTRATION",
  PIXEL_GRAPHIC: "PIXEL_GRAPHIC",
  NEUTRAL: "NEUTRAL",
});

// Profile 是"Sampling Mode 权重集合"，不是 Sampling Mode 本身。
// PHOTO：Mean 强（渐变）+ 大稳定区仍 Dominant；ILLUSTRATION：Dominant+Edge 强、Mean 抑制；
// PIXEL：Center/Dominant 强、Mean 极抑制；NEUTRAL：温和默认。
export const IMAGE_PROFILE_WEIGHTS = Object.freeze({
  PHOTO: Object.freeze({ linearMean: 1.4, center: 0.7, dominant: 0.9, edgeAware: 1.0 }),
  PORTRAIT_LIKE: Object.freeze({ linearMean: 1.2, center: 1.0, dominant: 0.9, edgeAware: 1.1 }),
  ILLUSTRATION: Object.freeze({ linearMean: 0.5, center: 0.7, dominant: 1.4, edgeAware: 1.3 }),
  PIXEL_GRAPHIC: Object.freeze({ linearMean: 0.25, center: 1.5, dominant: 1.2, edgeAware: 0.9 }),
  NEUTRAL: Object.freeze({ linearMean: 1.0, center: 0.8, dominant: 1.0, edgeAware: 1.0 }),
});

/* =========================================================
 * Soft Profile Prior（Profile 是 prior，不是命令）
 * ======================================================= */

/**
 * profile confidence → soft strength。
 * V1：线性 clamp。confidence=0 → 完全相信 local evidence；confidence=1 → 全量 profile。
 */
export function profileConfidenceToStrength(confidence) {
  return clamp01(confidence);
}

/**
 * effectiveWeight = 1 + strength * (profileWeight - 1)
 * confidence=0 → 全 1（无 profile 干预）；confidence=1 → 原始 profile weights。
 * 返回对象附带 `_strength`（供 diagnostics 显示实际 strength，禁止隐藏 magic）。
 */
export function computeEffectiveProfileWeights(profileWeights, profileConfidence, options = {}) {
  if (!profileWeights) return null;
  const strength = profileConfidenceToStrength(profileConfidence);
  const effective = { linearMean: 1, center: 1, dominant: 1, edgeAware: 1 };
  for (const key of ["linearMean", "center", "dominant", "edgeAware"]) {
    effective[key] = 1 + strength * (profileWeights[key] - 1);
  }
  effective._strength = strength;
  return effective;
}

/* =========================================================
 * Perceptual Stable Region（视觉稳定区域，非数学纯色）
 * ======================================================= */

export const PERCEPTUAL_STABLE_CONFIG = Object.freeze({
  strict: Object.freeze({ dominantCoverageMin: 0.85, varianceMax: 0.15, colorDriftMax: 0.12, diversityMax: 0.3 }),
  perceptual: Object.freeze({
    colorCoherenceWeight: 0.3,
    textureStabilityWeight: 0.25,
    gradientStabilityWeight: 0.25,
    regionConsistencyWeight: 0.2,
    edgePenaltyWeight: 0.3,
    scoreThreshold: 0.6,
  }),
  mergeDeltaEMax: 12,
  boostKd: 0.5,
  boostKm: 0.3,
});

/* =========================================================
 * Dominant Suitability（Stable ≠ Dominant-Suitable）
 * ======================================================= */

export const DOMINANT_SUITABILITY_CONFIG = Object.freeze({
  shading: Object.freeze({
    smoothGradientWeight: 0.3,
    gradientCoherenceWeight: 0.3,
    luminanceRangeWeight: 0.25,
    colorContinuityWeight: 0.15,
  }),
  suitability: Object.freeze({
    dominantCoverageWeight: 0.3,
    paletteCompactnessWeight: 0.25,
    flatnessWeight: 0.2,
    stableConfidenceWeight: 0.15,
    shadingPenaltyWeight: 0.4,
    luminanceSpreadPenaltyWeight: 0.2,
    edgePenaltyWeight: 0.3,
    microDetailPenaltyWeight: 0.3,
    strictSuitabilityFloor: 0.75,
  }),
});

/** 批量计算 region context（供 profile 复用，避免每 cell 重复）。 */
function computeRegionContexts(featuresGrid, width, height) {
  const contexts = [];
  for (let y = 0; y < height; y++) {
    contexts[y] = [];
    for (let x = 0; x < width; x++) {
      contexts[y][x] = computeRegionContext(featuresGrid, x, y, width, height);
    }
  }
  return contexts;
}

/**
 * 从已提取的 CellFeatures 聚合 Image Profile。
 * 复用 regionContexts（可选传入，避免重复计算）。
 * 输出 { profile, confidence, scores, metrics, profileWeights }。
 */
export function analyzeImageProfile(featuresGrid, width, height, regionContexts = null) {
  const contexts = regionContexts || computeRegionContexts(featuresGrid, width, height);
  let flatCells = 0, edgeCells = 0, microDetailCells = 0, smoothGradientCells = 0, totalCells = 0;
  const distinctColors = new Set();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = featuresGrid[y][x];
      if (!f || !f.pixels || !f.pixels.length) continue;
      totalCells++;
      const dominantCoverage = f.clusters.length ? f.clusters[0].coverage / (f.totalWeight || 1) : 0;
      // region 级 flat：cell flat 且邻域一致（真正大色块，不是渐变）
      if (dominantCoverage > 0.85 && f.luminanceVariance < 0.15 && contexts[y][x].regionalColorDrift < 0.12 && contexts[y][x].regionalPaletteDiversity < 0.3) flatCells++;
      if (f.edgeScore > 0.5) edgeCells++;
      if (f.microDetailCandidate > 0.4) microDetailCells++;
      if (f.dominantColor) distinctColors.add(`${f.dominantColor.r},${f.dominantColor.g},${f.dominantColor.b}`);
      if (contexts[y][x].regionalSmoothGradient > 0.3) smoothGradientCells++;
    }
  }

  const n = totalCells || 1;
  const metrics = {
    flatRegionRatio: flatCells / n,
    edgeDensity: edgeCells / n,
    smoothGradientRatio: smoothGradientCells / n,
    microDetailDensity: microDetailCells / n,
    colorEntropy: Math.min(1, distinctColors.size / 40),
    distinctColorCount: distinctColors.size,
    totalCells,
  };

  // profile scores：四类统计结构（PIXEL 用 distinctColorCount 硬门槛）
  const scores = {
    PHOTO: metrics.smoothGradientRatio * 0.5 + metrics.colorEntropy * 0.3 + (1 - metrics.flatRegionRatio) * 0.2,
    PORTRAIT_LIKE: metrics.smoothGradientRatio * 0.3 + metrics.flatRegionRatio * 0.25 + metrics.microDetailDensity * 0.25 + (1 - metrics.edgeDensity) * 0.2,
    ILLUSTRATION: metrics.flatRegionRatio * 0.4 + (1 - metrics.smoothGradientRatio) * 0.3 + Math.min(1, metrics.colorEntropy * 2) * 0.3,
    PIXEL_GRAPHIC: (metrics.distinctColorCount <= 3 ? 1 : 0) * 0.5 + (1 - metrics.smoothGradientRatio) * 0.3 + metrics.flatRegionRatio * 0.2,
  };

  const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
  const [topProfile, topScore] = sorted[0];
  const secondScore = sorted[1] ? sorted[1][1] : 0;
  const confidence = clamp01((topScore - secondScore) / Math.max(topScore, 0.001));

  // confidence 过低 → NEUTRAL（不强行分类）
  const profile = confidence < 0.12 ? IMAGE_PROFILE.NEUTRAL : topProfile;

  return { profile, confidence, scores, metrics, profileWeights: IMAGE_PROFILE_WEIGHTS[profile] };
}

/**
 * Large Stable Region（O(N) 4 邻接 connected-component）。
 * stable = dominantCoverage 高 + variance 低 + region drift 低 + diversity 低。
 * 输出 regionSizeMap（每个 cell 所属 stable region 的 cell 数）。
 */
/**
 * Perceptual Stability Score：cell 是否属于视觉上连续、变化缓慢的区域。
 * 不要求 dominantCoverage 高；综合 colorCoherence / textureStability / gradientStability / regionConsistency / edgePenalty。
 */
function perceptualStabilityScore(f, rc, dominantCoverage) {
  const cfg = PERCEPTUAL_STABLE_CONFIG.perceptual;
  const colorCoherence = 1 - clamp01(rc.regionalColorDrift);
  const textureStability = 1 - clamp01(f.luminanceVariance / 0.4);
  const gradientStability = 1 - clamp01(f.gradient / 0.6);
  const regionConsistency = dominantCoverage;
  const edgePenalty = f.edgeScore > 0.5 ? 1 : 0;
  const score =
    colorCoherence * cfg.colorCoherenceWeight +
    textureStability * cfg.textureStabilityWeight +
    gradientStability * cfg.gradientStabilityWeight +
    regionConsistency * cfg.regionConsistencyWeight -
    edgePenalty * cfg.edgePenaltyWeight;
  return clamp01(score);
}

/**
 * 两层 Stable Region：
 * - Strict Flat Stable（纯色插画 / logo / pixel）
 * - Perceptual Stable（真实照片的视觉连续区域，非数学纯色）
 * connected-component 基于 deltaE(runningMeanLab, candidateLab) < mergeDeltaEMax，
 * 避免不同颜色对象被 flood 误合并。区分 interior / boundary。
 */
export function analyzeStableRegions(featuresGrid, width, height, regionContexts = null) {
  const contexts = regionContexts || computeRegionContexts(featuresGrid, width, height);
  const size = width * height;
  const strictStable = new Uint8Array(size);
  const perceptualStable = new Uint8Array(size);
  const stabilityScores = new Float32Array(size);
  const labCache = new Float32Array(size); // 每个 cell 的 L*（linearMeanColor）

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const f = featuresGrid[y][x];
      if (!f || !f.pixels || !f.pixels.length) continue;
      const idx = y * width + x;
      const rc = contexts[y][x];
      const dominantCoverage = f.clusters.length ? f.clusters[0].coverage / (f.totalWeight || 1) : 0;
      const sc = PERCEPTUAL_STABLE_CONFIG.strict;
      const strict = dominantCoverage > sc.dominantCoverageMin && f.luminanceVariance < sc.varianceMax && rc.regionalColorDrift < sc.colorDriftMax && rc.regionalPaletteDiversity < sc.diversityMax;
      strictStable[idx] = strict ? 1 : 0;
      const score = perceptualStabilityScore(f, rc, dominantCoverage);
      stabilityScores[idx] = score;
      perceptualStable[idx] = score > PERCEPTUAL_STABLE_CONFIG.perceptual.scoreThreshold ? 1 : 0;
      labCache[idx] = rgbToLab([f.linearMeanColor.r, f.linearMeanColor.g, f.linearMeanColor.b])[0];
    }
  }

  // perceptual connected-component（deltaE-based region grow）+ region 特征聚合
  const visited = new Uint8Array(size);
  const regionIdMap = new Int32Array(size).fill(-1);
  const regions = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const startIdx = y * width + x;
      if (!perceptualStable[startIdx] || visited[startIdx]) continue;
      const queue = [startIdx];
      visited[startIdx] = 1;
      const members = [];
      let regionSize = 0;
      let meanLab = null;
      let Lmin = Infinity, Lmax = -Infinity;
      let dominantCoverageSum = 0, smoothGradientSum = 0, edgeScoreSum = 0, microDetailSum = 0, strictCount = 0;
      while (queue.length) {
        const cidx = queue.pop();
        members.push(cidx);
        regionSize++;
        const cx = cidx % width, cy = (cidx / width) | 0;
        const f = featuresGrid[cy][cx];
        const lab = rgbToLab([f.linearMeanColor.r, f.linearMeanColor.g, f.linearMeanColor.b]);
        if (meanLab === null) meanLab = [lab[0], lab[1], lab[2]];
        else {
          meanLab[0] = (meanLab[0] * (regionSize - 1) + lab[0]) / regionSize;
          meanLab[1] = (meanLab[1] * (regionSize - 1) + lab[1]) / regionSize;
          meanLab[2] = (meanLab[2] * (regionSize - 1) + lab[2]) / regionSize;
        }
        Lmin = Math.min(Lmin, lab[0]);
        Lmax = Math.max(Lmax, lab[0]);
        dominantCoverageSum += f.clusters.length ? f.clusters[0].coverage / (f.totalWeight || 1) : 0;
        smoothGradientSum += contexts[cy][cx].regionalSmoothGradient;
        edgeScoreSum += f.edgeScore;
        microDetailSum += f.microDetailCandidate;
        if (strictStable[cidx]) strictCount++;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx, ny = cy + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const nidx = ny * width + nx;
          if (!perceptualStable[nidx] || visited[nidx]) continue;
          const nf = featuresGrid[ny][nx];
          const nlab = rgbToLab([nf.linearMeanColor.r, nf.linearMeanColor.g, nf.linearMeanColor.b]);
          if (deltaE2000(meanLab, nlab) > PERCEPTUAL_STABLE_CONFIG.mergeDeltaEMax) continue;
          visited[nidx] = 1;
          queue.push(nidx);
        }
      }
      const regionId = regions.length;
      regions.push({ id: regionId, size: regionSize, meanLab, members, dominantCoverageSum, smoothGradientSum, edgeScoreSum, microDetailSum, strictCount, Lmin, Lmax });
      for (const m of members) regionIdMap[m] = regionId;
    }
  }

  // region 级特征：paletteCompactness / luminanceRange / gradientCoherence / shadingScore / dominantSuitabilityScore
  for (const region of regions) {
    const n = region.size;
    const avgDominantCoverage = region.dominantCoverageSum / n;
    const avgSmoothGradient = region.smoothGradientSum / n;
    const avgEdgeScore = region.edgeScoreSum / n;
    const avgMicroDetail = region.microDetailSum / n;

    // paletteCompactness：region 内 representative Lab 到 meanLab 的 spread
    let spreadSum = 0;
    for (const m of region.members) {
      const cx = m % width, cy = (m / width) | 0;
      const f = featuresGrid[cy][cx];
      const lab = rgbToLab([f.linearMeanColor.r, f.linearMeanColor.g, f.linearMeanColor.b]);
      spreadSum += deltaE2000(region.meanLab, lab);
    }
    const avgSpread = spreadSum / n;
    region.paletteCompactness = 1 - clamp01(avgSpread / 20);

    // luminanceRange
    region.luminanceRange = clamp01((region.Lmax - region.Lmin) / 60);

    // gradientCoherence：region 内相邻 cell 的 L* 梯度方向一致性
    let gradX = 0, gradY = 0, gradAbsSum = 0, gradPairs = 0;
    for (const m of region.members) {
      const cx = m % width, cy = (m / width) | 0;
      const L = labCache[m];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + dx, ny = cy + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
        const nidx = ny * width + nx;
        if (regionIdMap[nidx] !== region.id) continue;
        const diff = labCache[nidx] - L;
        gradX += dx * diff;
        gradY += dy * diff;
        gradAbsSum += Math.abs(diff);
        gradPairs++;
      }
    }
    const gradMagnitude = Math.sqrt(gradX * gradX + gradY * gradY);
    region.gradientCoherence = gradPairs > 0 ? clamp01(gradMagnitude / Math.max(gradAbsSum, 0.001)) : 0;

    // shadingScore：视觉稳定但存在连续塑形渐变
    const colorContinuity = 1 - clamp01(avgSpread / 30);
    const sh = DOMINANT_SUITABILITY_CONFIG.shading;
    region.shadingScore = clamp01(
      avgSmoothGradient * sh.smoothGradientWeight +
      region.gradientCoherence * sh.gradientCoherenceWeight +
      region.luminanceRange * sh.luminanceRangeWeight +
      colorContinuity * sh.colorContinuityWeight,
    );

    // dominantSuitabilityScore：stable 但不一定适合 Dominant
    const flatnessEvidence = region.strictCount / n;
    const sizeRatio = region.size / size;
    const stableConfidence = clamp01(sizeRatio / 0.03);
    const edgePenalty = avgEdgeScore > 0.5 ? 1 : 0;
    const microDetailPenalty = avgMicroDetail > 0.4 ? 1 : 0;
    const su = DOMINANT_SUITABILITY_CONFIG.suitability;
    let suitability =
      avgDominantCoverage * su.dominantCoverageWeight +
      region.paletteCompactness * su.paletteCompactnessWeight +
      flatnessEvidence * su.flatnessWeight +
      stableConfidence * su.stableConfidenceWeight -
      region.shadingScore * su.shadingPenaltyWeight -
      region.luminanceRange * su.luminanceSpreadPenaltyWeight -
      edgePenalty * su.edgePenaltyWeight -
      microDetailPenalty * su.microDetailPenaltyWeight;
    // strict stable 是高 suitability 的强证据（但仍非 hard lock）
    if (region.strictCount / n > 0.5) suitability = Math.max(suitability, su.strictSuitabilityFloor);
    region.dominantSuitabilityScore = clamp01(suitability);
    region.dominantSuitable = region.dominantSuitabilityScore > 0.5;
  }

  // interior / boundary（4 邻居都属于同一 region → interior）
  const interiorMap = new Uint8Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const rid = regionIdMap[idx];
      if (rid < 0) continue;
      let allSame = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || nx >= width || ny < 0 || ny >= height) { allSame = false; break; }
        if (regionIdMap[ny * width + nx] !== rid) { allSame = false; break; }
      }
      interiorMap[idx] = allSame ? 1 : 0;
    }
  }

  // per-cell maps
  const regionSizeMap = new Int32Array(size);
  const regionConfidenceMap = new Float32Array(size);
  const regionTypeMap = new Uint8Array(size); // 0 NONE, 1 STRICT, 2 PERCEPTUAL
  const dominantSuitabilityMap = new Float32Array(size);
  const shadingScoreMap = new Float32Array(size);
  const paletteCompactnessMap = new Float32Array(size);
  const luminanceRangeMap = new Float32Array(size);
  const gradientCoherenceMap = new Float32Array(size);
  for (let i = 0; i < size; i++) {
    const rid = regionIdMap[i];
    if (rid < 0) continue;
    const region = regions[rid];
    regionSizeMap[i] = region.size;
    regionConfidenceMap[i] = clamp01((region.size / size) / 0.03);
    regionTypeMap[i] = strictStable[i] ? 1 : 2;
    dominantSuitabilityMap[i] = region.dominantSuitabilityScore;
    shadingScoreMap[i] = region.shadingScore;
    paletteCompactnessMap[i] = region.paletteCompactness;
    luminanceRangeMap[i] = region.luminanceRange;
    gradientCoherenceMap[i] = region.gradientCoherence;
  }

  return {
    strictStable,
    perceptualStable,
    stabilityScores,
    regionIdMap,
    regionSizeMap,
    regionConfidenceMap,
    regionTypeMap,
    interiorMap,
    dominantSuitabilityMap,
    shadingScoreMap,
    paletteCompactnessMap,
    luminanceRangeMap,
    gradientCoherenceMap,
    regionCount: regions.length,
    isStable: perceptualStable, // 兼容旧字段名
  };
}

/**
 * 每个 Cell 计算四种 sampling 的 score，选最高分（feature score competition，非 hard lock）。
 * regionContext 用于区分 flat graphic block vs smooth photographic region。
 * profileWeights 覆盖 preset weights（AUTO 时由 computeEffectiveProfileWeights 提供）。
 * stableRegionConfidence（0~1）+ stableInterior + dominantSuitability（0~1）：
 * 只有 stable interior 且 dominant-suitable 才给 Dominant boost（连续，非 hard lock）。
 */
export function computeSamplingScores(features, preset = "photo", regionContext = null, profileWeights = null, stableRegionConfidence = 0, stableInterior = false, dominantSuitability = 0) {
  if (!features || !features.pixels || !features.pixels.length) {
    return { linearMean: 0, center: 0, dominant: 0, edgeAware: 0, mode: SamplingModeIndex.LINEAR_MEAN, confidence: 0 };
  }
  const w = profileWeights || PRESET_SAMPLING_WEIGHTS[preset] || PRESET_SAMPLING_WEIGHTS.photo;
  const { edgeScore, luminanceVariance, clusterSeparation, gradient, clusters, totalWeight, microDetailCandidate } = features;
  const dominantCoverage = clusters.length ? clusters[0].coverage / (totalWeight || 1) : 0;
  const rc = regionContext || { regionalColorDrift: 0, regionalSmoothGradient: 0, regionalPaletteDiversity: 0 };

  const cellFlat = dominantCoverage > 0.85 && luminanceVariance < 0.15;
  const isEdge = edgeScore > 0.5 && clusterSeparation > 0.4;
  // micro detail：source-derived 证据优先（瞳孔/高光/微结构），不依赖 dominantCoverage
  const isMicro = microDetailCandidate > 0.4 || (gradient > 0.55 && dominantCoverage < 0.85);
  const isSmooth = luminanceVariance < 0.4 && !isEdge;

  // region-level：真正的 flat graphic block 需要邻域几乎一致（drift < 0.12 = deltaE < 3.6）
  const isFlatGraphic = cellFlat && rc.regionalColorDrift < 0.12 && rc.regionalPaletteDiversity < 0.3;
  // smooth photographic region：cell flat 但邻域有连续渐变（smoothGradient > 0.15）
  const isSmoothPhoto = cellFlat && rc.regionalSmoothGradient > 0.15 && rc.regionalColorDrift < 0.6;

  // stable region boost：仅 interior 且 dominant-suitable（stableConfidence × suitability，连续）
  const suitabilityStrength = clamp01(dominantSuitability);
  const stableBoost = stableInterior ? clamp01(stableRegionConfidence) * suitabilityStrength : 0;
  const Kd = PERCEPTUAL_STABLE_CONFIG.boostKd;
  const Km = PERCEPTUAL_STABLE_CONFIG.boostKm;

  const linearMean = w.linearMean * (isSmoothPhoto ? 1.35 : isSmooth ? 0.7 : 0.2) * (isFlatGraphic ? 0.45 : 1) * (1 - stableBoost * Km);
  const center = w.center * (isMicro ? 1.0 : 0.08) * (microDetailCandidate > 0.4 ? 1.6 : 1);
  const dominant = w.dominant * (isFlatGraphic ? 1.25 : dominantCoverage * 0.55) * (isSmoothPhoto ? 0.6 : 1) * (isMicro ? 0.35 : 1) * (1 + stableBoost * Kd);
  const edgeAware = w.edgeAware * (isEdge ? 1.3 : edgeScore * clusterSeparation * 0.8);

  const sorted = [["linearMean", linearMean], ["center", center], ["dominant", dominant], ["edgeAware", edgeAware]].sort((a, b) => b[1] - a[1]);
  const [topKey, topScore] = sorted[0];
  const secondScore = sorted[1] ? sorted[1][1] : 0;
  const mode = topKey === "linearMean" ? SamplingModeIndex.LINEAR_MEAN
    : topKey === "center" ? SamplingModeIndex.CENTER
    : topKey === "dominant" ? SamplingModeIndex.DOMINANT : SamplingModeIndex.EDGE_AWARE;
  const confidence = topScore > 0 ? clamp01((topScore - secondScore) / Math.max(topScore, 0.001)) : 0;
  return { linearMean, center, dominant, edgeAware, mode, confidence, microDetailCandidate };
}

/**
 * Edge continuity（3×3 邻域）：当前 cell 是否属于连续轮廓。
 * O(N)，不做大范围搜索。返回 0~1（edge 邻居比例 × 平均 edgeScore）。
 */
export function computeEdgeContinuity(modeMap, featuresGrid, x, y, width, height) {
  const f = featuresGrid[y][x];
  if (!f) return 0;
  let edgeNeighbors = 0, totalNeighbors = 0, scoreSum = 0;
  // 4 邻接（上下左右）：识别连续轮廓线，斜对角噪声不计入
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
    const nf = featuresGrid[ny][nx];
    if (!nf) continue;
    totalNeighbors++;
    if (modeMap[ny * width + nx] === SamplingModeIndex.EDGE_AWARE) {
      edgeNeighbors++;
      scoreSum += nf.edgeScore;
    }
  }
  const ratio = totalNeighbors ? edgeNeighbors / totalNeighbors : 0;
  const avgScore = edgeNeighbors ? scoreSum / edgeNeighbors : 0;
  return ratio * (0.5 + 0.5 * avgScore);
}

/**
 * Structure-Aware Spatial Coherence。
 * 优先级：micro detail > structural continuous edge > high confidence > neighborhood。
 * 返回对象（含 structural edge map + redirect 统计），不再只返回 modeMap。
 */
export function spatialCoherencePass(modeMap, confidenceMap, featuresGrid, width, height, options = {}) {
  const result = new Uint8Array(modeMap);
  const offsets = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const size = width * height;

  // Pass 1：structural edge candidate + continuity（O(N)）
  const structuralEdgeMap = new Uint8Array(size);
  const edgeContinuityMap = new Float32Array(size);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const f = featuresGrid[y][x];
      if (!f) continue;
      const isEdgeMode = modeMap[idx] === SamplingModeIndex.EDGE_AWARE;
      // structural edge：edgeScore 高 + clusterSeparation 高 + source gradient 高
      const structural = isEdgeMode && f.edgeScore > 0.55 && f.clusterSeparation > 0.5 && f.gradient > 0.45;
      structuralEdgeMap[idx] = structural ? 1 : 0;
      edgeContinuityMap[idx] = computeEdgeContinuity(modeMap, featuresGrid, x, y, width, height);
    }
  }

  // Pass 2：structure-aware coherence
  const redirects = { edgeToMean: 0, edgeToCenter: 0, edgeToDominant: 0, totalChanged: 0, edgePreserved: 0 };
  const preEdgeCount = countMode(modeMap, SamplingModeIndex.EDGE_AWARE, size);
  let postEdgeCount = 0;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const mode = result[idx];
      const features = featuresGrid[y][x];

      // 优先级 3：high confidence winner 不动
      if (confidenceMap[idx] >= 0.25) { if (mode === SamplingModeIndex.EDGE_AWARE) postEdgeCount++; continue; }

      // 优先级 1：micro detail（center + source 证据）保留
      if (mode === SamplingModeIndex.CENTER && features && (features.gradient > 0.7 || features.microDetailCandidate > 0.5)) {
        continue;
      }

      // 优先级 2：structural continuous edge 保留
      if (mode === SamplingModeIndex.EDGE_AWARE && structuralEdgeMap[idx] && edgeContinuityMap[idx] > 0.3) {
        postEdgeCount++;
        continue;
      }

      // 优先级 4：neighborhood coherence
      const counts = [0, 0, 0, 0];
      for (const [dx, dy] of offsets) {
        const nx = x + dx, ny = y + dy;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
        const nidx = ny * width + nx;
        counts[modeMap[nidx]] += 0.5 + confidenceMap[nidx];
      }
      let best = -1, bestCount = 0;
      for (let m = 0; m < 4; m++) if (counts[m] > bestCount) { bestCount = counts[m]; best = m; }
      if (best >= 0 && best !== mode) {
        if (mode === SamplingModeIndex.EDGE_AWARE) {
          if (best === SamplingModeIndex.LINEAR_MEAN) redirects.edgeToMean++;
          else if (best === SamplingModeIndex.CENTER) redirects.edgeToCenter++;
          else if (best === SamplingModeIndex.DOMINANT) redirects.edgeToDominant++;
        }
        result[idx] = best;
        redirects.totalChanged++;
      }
      if (result[idx] === SamplingModeIndex.EDGE_AWARE) postEdgeCount++;
    }
  }

  // 精确统计 edgePreserved（pre edge 且 post edge）/ edgeRedirected（pre edge 但 post 非 edge）
  let edgePreserved = 0;
  for (let i = 0; i < size; i++) {
    if (modeMap[i] === SamplingModeIndex.EDGE_AWARE && result[i] === SamplingModeIndex.EDGE_AWARE) edgePreserved++;
  }
  redirects.edgePreserved = edgePreserved;
  redirects.edgeRedirected = preEdgeCount - edgePreserved;

  return {
    modeMap: result,
    structuralEdgeMap,
    edgeContinuityMap,
    redirects,
    preCoherenceEdgeCount: preEdgeCount,
    postCoherenceEdgeCount: postEdgeCount,
  };
}

function countMode(modeMap, target, size) {
  let c = 0;
  for (let i = 0; i < size; i++) if (modeMap[i] === target) c++;
  return c;
}

function modeIndexToName(m) {
  return m === SamplingModeIndex.LINEAR_MEAN ? SamplingMode.LINEAR_MEAN
    : m === SamplingModeIndex.CENTER ? SamplingMode.CENTER
    : m === SamplingModeIndex.DOMINANT ? SamplingMode.DOMINANT : SamplingMode.EDGE_AWARE;
}

/**
 * Region-Adaptive Sampling 主入口。
 * 复用 extractCellFeatures（Phase 1），每 Cell 决策 + coherence，
 * 从已计算好的 representative color 中选一个，不重新 scan source。
 */
export function sampleGridAdaptive(imageData, gridWidth, gridHeight, options = {}) {
  const preset = options.preset || "photo";
  const autoProfile = options.autoProfile === true;
  const featuresGrid = [];
  for (let y = 0; y < gridHeight; y++) {
    featuresGrid[y] = [];
    for (let x = 0; x < gridWidth; x++) {
      const bounds = cellBounds(x, y, imageData.width, imageData.height, gridWidth, gridHeight);
      featuresGrid[y][x] = extractCellFeatures(imageData, bounds, options);
    }
  }

  const size = gridWidth * gridHeight;

  // region context 缓存（profile + sampling 复用，避免重复计算）
  const regionContexts = computeRegionContexts(featuresGrid, gridWidth, gridHeight);

  // AUTO profile 分析（source-statistics 驱动，非外部 AI / 人脸识别）
  let imageProfile = null;
  let profileWeights = null;
  let stableRegions = null;
  if (autoProfile) {
    imageProfile = analyzeImageProfile(featuresGrid, gridWidth, gridHeight, regionContexts);
    // Soft Profile Prior：profile 是 prior 不是命令，effective weight 由 confidence 软化
    profileWeights = computeEffectiveProfileWeights(imageProfile.profileWeights, imageProfile.confidence);
    imageProfile.effectiveWeights = profileWeights;
    imageProfile.priorStrength = profileWeights ? profileWeights._strength : 0;
    stableRegions = analyzeStableRegions(featuresGrid, gridWidth, gridHeight, regionContexts);
  }

  const modeMap = new Uint8Array(size);
  const confidenceMap = new Float32Array(size);
  const colorsGrid = [];
  const scoresGrid = [];
  for (let y = 0; y < gridHeight; y++) {
    colorsGrid[y] = [];
    scoresGrid[y] = [];
    for (let x = 0; x < gridWidth; x++) {
      const features = featuresGrid[y][x];
      const regionContext = regionContexts[y][x];
      const idx = y * gridWidth + x;
      const stableRegionConfidence = stableRegions ? stableRegions.regionConfidenceMap[idx] : 0;
      const stableInterior = stableRegions ? stableRegions.interiorMap[idx] === 1 : false;
      const dominantSuitability = stableRegions ? stableRegions.dominantSuitabilityMap[idx] : 0;
      const scores = computeSamplingScores(features, preset, regionContext, profileWeights, stableRegionConfidence, stableInterior, dominantSuitability);
      modeMap[idx] = scores.mode;
      confidenceMap[idx] = scores.confidence;
      scoresGrid[y][x] = scores;
      colorsGrid[y][x] = resolveSampling(features, modeIndexToName(scores.mode), null, options);
    }
  }

  const preCoherenceDistribution = countDistribution(modeMap, size);

  const coherence = spatialCoherencePass(modeMap, confidenceMap, featuresGrid, gridWidth, gridHeight, options);
  const finalModeMap = coherence.modeMap;
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      const idx = y * gridWidth + x;
      if (finalModeMap[idx] !== modeMap[idx]) {
        colorsGrid[y][x] = resolveSampling(featuresGrid[y][x], modeIndexToName(finalModeMap[idx]), null, options);
      }
    }
  }

  const distribution = countDistribution(finalModeMap, size);
  const confidenceStats = computeConfidenceStats(confidenceMap, finalModeMap, size);

  return { colors: colorsGrid, features: featuresGrid, modeMap: finalModeMap, preModeMap: modeMap, confidenceMap, regionContexts, scoresGrid, distribution, preCoherenceDistribution, confidenceStats, imageProfile, stableRegions, structuralEdgeMap: coherence.structuralEdgeMap, edgeContinuityMap: coherence.edgeContinuityMap, coherenceChanges: coherence.redirects, preCoherenceEdgeCount: coherence.preCoherenceEdgeCount, postCoherenceEdgeCount: coherence.postCoherenceEdgeCount, resolvedMode: "adaptive" };
}

function countDistribution(modeMap, size) {
  const d = { linearMean: 0, center: 0, dominant: 0, edgeAware: 0 };
  for (let i = 0; i < size; i++) {
    const m = modeMap[i];
    if (m === SamplingModeIndex.LINEAR_MEAN) d.linearMean++;
    else if (m === SamplingModeIndex.CENTER) d.center++;
    else if (m === SamplingModeIndex.DOMINANT) d.dominant++;
    else d.edgeAware++;
  }
  return d;
}

function computeConfidenceStats(confidenceMap, modeMap, size) {
  const stats = { linearMean: { count: 0, mean: 0, low: 0, high: 0 }, center: { count: 0, mean: 0, low: 0, high: 0 }, dominant: { count: 0, mean: 0, low: 0, high: 0 }, edgeAware: { count: 0, mean: 0, low: 0, high: 0 } };
  const sums = { linearMean: 0, center: 0, dominant: 0, edgeAware: 0 };
  for (let i = 0; i < size; i++) {
    const m = modeMap[i];
    const key = m === SamplingModeIndex.LINEAR_MEAN ? "linearMean" : m === SamplingModeIndex.CENTER ? "center" : m === SamplingModeIndex.DOMINANT ? "dominant" : "edgeAware";
    const c = confidenceMap[i];
    stats[key].count++;
    sums[key] += c;
    if (c < 0.25) stats[key].low++;
    if (c > 0.6) stats[key].high++;
  }
  for (const key of Object.keys(stats)) {
    stats[key].mean = stats[key].count ? sums[key] / stats[key].count : 0;
  }
  return stats;
}

export const DEFAULT_SAMPLING_CONFIG = Object.freeze({
  extraction: { ignoreTransparent: true, alphaThreshold: 8 },
  dominant: { threshold: 12 },
  edgeAware: {
    edgeThreshold: 0.42,
    strongEdgeThreshold: 0.62,
    centerBias: 0.2,
    continuityWeight: 0.25,
  },
});

export default {
  SamplingMode,
  DEFAULT_SAMPLING_CONFIG,
  cellBounds,
  extractCellPixels,
  sampleLinearMean,
  sampleCenter,
  clusterColorsLab,
  sampleDominantCluster,
  extractCellFeatures,
  resolveSampling,
  resolveEdgeAware,
  analyzeImageFeatures,
  resolveSamplingMode,
  sampleGrid,
  SamplingModeIndex,
  PRESET_SAMPLING_WEIGHTS,
  IMAGE_PROFILE,
  IMAGE_PROFILE_WEIGHTS,
  profileConfidenceToStrength,
  computeEffectiveProfileWeights,
  PERCEPTUAL_STABLE_CONFIG,
  DOMINANT_SUITABILITY_CONFIG,
  analyzeImageProfile,
  analyzeStableRegions,
  computeSamplingScores,
  computeRegionContext,
  computeEdgeContinuity,
  spatialCoherencePass,
  sampleGridAdaptive,
};
