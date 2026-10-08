/**
 * Generation Engine V2 — Detail Protection
 *
 * 建立 protectionMap（Float32Array 0..1）以及 debug maps。
 * 不做人脸识别 / 眼睛 detector / 外部模型。
 * eyeLike 只是 paired high-contrast micro-detail heuristic。
 *
 * 复用 palette-engine 的 rgbToLab / deltaE2000。
 */

import { rgbToLab, deltaE2000 } from "./palette-engine.mjs";

const clamp01 = (value) => Math.min(1, Math.max(0, value));

function cellRgb(cell) {
  if (!cell) return null;
  if (Array.isArray(cell.rgb)) return [cell.rgb[0], cell.rgb[1], cell.rgb[2]];
  if (typeof cell.r === "number") return [cell.r, cell.g, cell.b];
  return null;
}

const EIGHT_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
const FOUR_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

function neighborsOf(grid, x, y, diagonal = true) {
  const list = [];
  const offsets = diagonal ? EIGHT_OFFSETS : FOUR_OFFSETS;
  for (const [dx, dy] of offsets) {
    const nx = x + dx, ny = y + dy;
    if (ny >= 0 && ny < grid.length && nx >= 0 && nx < (grid[ny]?.length || 0)) list.push({ x: nx, y: ny, cell: grid[ny][nx] });
  }
  return list;
}

/* =========================================================
 * Local Detail（contrast + luminance extremum）
 * ======================================================= */

export function analyzeLocalDetail(grid, x, y) {
  const cell = grid[y][x];
  const rgb = cellRgb(cell);
  if (!rgb) return null;
  const ownL = rgbToLab(rgb)[0];
  const neighbors = neighborsOf(grid, x, y, true);
  if (!neighbors.length) return { localContrast: 0, luminanceExtremum: 0, brightExtremum: 0, darkExtremum: 0, neighborhoodAgreement: 0 };

  let contrastSum = 0;
  let brighter = 0;
  let darker = 0;
  let sameColor = 0;
  let count = 0;
  for (const n of neighbors) {
    const nrgb = cellRgb(n.cell);
    if (!nrgb) continue;
    count++;
    const nL = rgbToLab(nrgb)[0];
    contrastSum += deltaE2000(rgbToLab(rgb), rgbToLab(nrgb));
    if (ownL > nL + 1) brighter++;
    if (ownL < nL - 1) darker++;
    if (deltaE2000(rgbToLab(rgb), rgbToLab(nrgb)) <= 3) sameColor++;
  }
  if (!count) return { localContrast: 0, luminanceExtremum: 0, brightExtremum: 0, darkExtremum: 0, neighborhoodAgreement: 0 };

  const localContrast = clamp01(contrastSum / count / 25);
  const brightExtremum = brighter / count;
  const darkExtremum = darker / count;
  const luminanceExtremum = Math.max(brightExtremum, darkExtremum);
  const neighborhoodAgreement = sameColor / count;

  return { localContrast, luminanceExtremum, brightExtremum, darkExtremum, neighborhoodAgreement };
}

/* =========================================================
 * Structural Continuity
 * ======================================================= */

export function calculateStructuralContinuity(grid, x, y, sameCell) {
  const cell = grid[y][x];
  const test = (dx, dy) => {
    const nx = x + dx, ny = y + dy;
    if (ny < 0 || ny >= grid.length || nx < 0 || nx >= (grid[ny]?.length || 0)) return false;
    return sameCell(cell, grid[ny][nx]);
  };
  const horizontal = test(-1, 0) || test(1, 0) ? 1 : 0;
  const vertical = test(0, -1) || test(0, 1) ? 1 : 0;
  const diagonal = test(-1, -1) || test(1, 1) || test(-1, 1) || test(1, -1) ? 1 : 0;
  return clamp01(horizontal * 0.4 + vertical * 0.4 + diagonal * 0.2);
}

/* =========================================================
 * Source Evidence（回查 source region）
 * ======================================================= */

/**
 * cell 的 matched color 在 source region 里是否有相似像素。
 * 返回 0..1。用于区分「真实高光」与「sampling/palette 杂色」。
 */
export function calculateSourceEvidence(sourceImageData, bounds, cellRGB, { threshold = 6, maxSamples = 200 } = {}) {
  if (!sourceImageData || !bounds || !cellRGB) return 0;
  const W = sourceImageData.width, H = sourceImageData.height, data = sourceImageData.data;
  const lab = rgbToLab(cellRGB);
  const px0 = Math.max(0, Math.floor(bounds.x0)), py0 = Math.max(0, Math.floor(bounds.y0));
  const px1 = Math.min(W, Math.ceil(bounds.x1)), py1 = Math.min(H, Math.ceil(bounds.y1));
  const total = Math.max(1, (px1 - px0) * (py1 - py0));
  const step = Math.max(1, Math.floor(Math.sqrt(total / maxSamples)));
  let similar = 0, count = 0;
  for (let y = py0; y < py1; y += step) {
    for (let x = px0; x < px1; x += step) {
      const i = (y * W + x) * 4;
      if (data[i + 3] <= 8) continue;
      count++;
      if (deltaE2000(lab, rgbToLab([data[i], data[i + 1], data[i + 2]])) <= threshold) similar++;
    }
  }
  return count ? clamp01(similar / count) : 0;
}

/* =========================================================
 * Highlight / Dark / Eye-like Detection
 * ======================================================= */

/**
 * 高光：cell 亮度明显高于周围 + source evidence 高 + 周围形成稳定深色区域。
 */
export function detectHighlight(grid, x, y, sourceEvidence = 0) {
  const cell = grid[y][x];
  const rgb = cellRgb(cell);
  if (!rgb) return 0;
  const ownL = rgbToLab(rgb)[0];
  const neighbors = neighborsOf(grid, x, y, true);
  if (neighbors.length < 3) return 0;

  let darker = 0, contrast = 0, count = 0;
  for (const n of neighbors) {
    const nrgb = cellRgb(n.cell);
    if (!nrgb) continue;
    count++;
    const nL = rgbToLab(nrgb)[0];
    if (ownL - nL > 8) darker++;
    contrast += Math.abs(ownL - nL);
  }
  if (!count) return 0;
  const darkerRatio = darker / count;
  const avgContrast = contrast / count;

  // Source Evidence 是最重要的一项：source region 没有对应亮点 → 视为 sampling/palette 杂色。
  if (darkerRatio < 0.6 || avgContrast < 8) return 0;
  if (sourceEvidence < 0.12) return 0;
  return clamp01(0.5 * darkerRatio + 0.3 * clamp01(avgContrast / 40) + 0.2 * sourceEvidence);
}

/**
 * 暗细节：cell 亮度明显低于周围（瞳孔/鼻孔/嘴角/轮廓细节）+ source evidence。
 */
export function detectDarkDetail(grid, x, y, sourceEvidence = 0) {
  const cell = grid[y][x];
  const rgb = cellRgb(cell);
  if (!rgb) return 0;
  const ownL = rgbToLab(rgb)[0];
  const neighbors = neighborsOf(grid, x, y, true);
  if (neighbors.length < 3) return 0;

  let brighter = 0, contrast = 0, count = 0;
  for (const n of neighbors) {
    const nrgb = cellRgb(n.cell);
    if (!nrgb) continue;
    count++;
    const nL = rgbToLab(nrgb)[0];
    if (nL - ownL > 8) brighter++;
    contrast += Math.abs(ownL - nL);
  }
  if (!count) return 0;
  const brighterRatio = brighter / count;
  const avgContrast = contrast / count;

  if (brighterRatio < 0.6 || avgContrast < 8) return 0;
  if (sourceEvidence < 0.12) return 0;
  return clamp01(0.5 * brighterRatio + 0.3 * clamp01(avgContrast / 40) + 0.2 * sourceEvidence);
}

/**
 * eye-like：paired high-contrast micro-detail heuristic。
 * 不做语义识别，不声称「Detected Eye」。
 * 极亮或极暗微细节 + 高局部对比 + source evidence 高。
 */
export function detectEyeLike(grid, x, y, sourceEvidence = 0) {
  const detail = analyzeLocalDetail(grid, x, y);
  if (!detail) return 0;
  const highlight = detectHighlight(grid, x, y, sourceEvidence);
  const dark = detectDarkDetail(grid, x, y, sourceEvidence);
  const extreme = Math.max(highlight, dark);
  if (extreme <= 0) return 0;
  // paired micro-contrast：需要同时高对比 + 极端亮度 + source evidence
  return clamp01(extreme * 0.6 + detail.localContrast * 0.25 + sourceEvidence * 0.15);
}

/* =========================================================
 * Protection Map 主入口
 * ======================================================= */

/**
 * Protection Reason bitmask（一个 Cell 可同时拥有多个 reason）。
 */
export const ProtectionReason = Object.freeze({
  HIGHLIGHT: 1,
  DARK_DETAIL: 2,
  EYE_LIKE: 4,
  MICRO_DETAIL: 8,
  STRUCTURAL_EDGE: 16,
  SOURCE_SUPPORTED: 32,
  GENERIC_DETAIL: 64,
});

export const ProtectionTier = Object.freeze({ NONE: 0, LOW: 1, MEDIUM: 2, HIGH: 3, CRITICAL: 4 });

export function protectionTierOf(score) {
  if (score >= 0.85) return ProtectionTier.CRITICAL;
  if (score >= 0.65) return ProtectionTier.HIGH;
  if (score >= 0.4) return ProtectionTier.MEDIUM;
  if (score >= 0.2) return ProtectionTier.LOW;
  return ProtectionTier.NONE;
}

/**
 * 返回 protectionMap（Float32Array）+ protectionReasonMap（Uint8Array bitmask）+ tierMap + debug maps。
 * Phase 2：generic detail / structural edge 只给 low-medium，不单独推 strong；
 * strong 保护优先来自 highlight / dark / eye-like（已 source evidence gate）。
 */
export function buildProtectionMap({ grid, width, height, getRGB = cellRgb, sameCell, sourceImageData, cellBoundsFn, options = {} }) {
  const {
    detailProtection = 0.7,
    edgeProtection = 0.7,
    highlightProtection = 1.0,
    eyeProtection = 1.0,
    microDetailProtection = 1.0,
  } = options;

  const size = width * height;
  const protectionMap = new Float32Array(size);
  const protectionReasonMap = new Uint8Array(size);
  const tierMap = new Uint8Array(size);
  const highlightMap = new Float32Array(size);
  const darkDetailMap = new Float32Array(size);
  const eyeLikeMap = new Float32Array(size);
  const edgeMap = new Float32Array(size);

  const sourceW = sourceImageData?.width || width;
  const sourceH = sourceImageData?.height || height;
  const boundsFor = cellBoundsFn || ((x, y) => ({ x0: (x * sourceW) / width, y0: (y * sourceH) / height, x1: ((x + 1) * sourceW) / width, y1: ((y + 1) * sourceH) / height }));

  const edgeScores = computeEdgeMap(grid, width, height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      const cell = grid[y][x];
      if (!cell) continue;
      const rgb = getRGB(cell);
      if (!rgb) continue;

      const detail = analyzeLocalDetail(grid, x, y) || { localContrast: 0, luminanceExtremum: 0, neighborhoodAgreement: 0 };
      const continuity = sameCell ? calculateStructuralContinuity(grid, x, y, sameCell) : 0;
      const sourceEvidence = sourceImageData ? calculateSourceEvidence(sourceImageData, boundsFor(x, y), rgb) : 0;

      const highlightScore = detectHighlight(grid, x, y, sourceEvidence);
      const darkDetailScore = detectDarkDetail(grid, x, y, sourceEvidence);
      const eyeLikeScore = detectEyeLike(grid, x, y, sourceEvidence);
      const microDetailScore = Math.max(highlightScore, darkDetailScore);
      const structuralEdgeScore = edgeScores[idx];

      // generic detail（local contrast + continuity）—— 只给 low-medium（×0.5 上限），不单独推 strong
      const sourceSupport = sourceEvidence > 0.2;
      const genericDetail = (sourceSupport || continuity > 0.3)
        ? 0.5 * detail.localContrast + 0.3 * detail.luminanceExtremum + 0.2 * continuity
        : 0;
      const genericContribution = detailProtection * clamp01(genericDetail) * 0.5;

      // structural edge —— 默认 medium（×0.6 上限），不单独推 strong
      const edgeContribution = edgeProtection * structuralEdgeScore * 0.6;

      // strong 保护优先来自 highlight/dark/eye（已 source evidence gate）
      const strongContribution = clamp01(
        highlightProtection * highlightScore +
        eyeProtection * eyeLikeScore +
        microDetailProtection * microDetailScore * 0.7,
      );

      const protection = clamp01(genericContribution + edgeContribution + strongContribution);

      let reason = 0;
      if (highlightScore > 0.5) reason |= ProtectionReason.HIGHLIGHT;
      if (darkDetailScore > 0.5) reason |= ProtectionReason.DARK_DETAIL;
      if (eyeLikeScore > 0.5) reason |= ProtectionReason.EYE_LIKE;
      if (microDetailScore > 0.5) reason |= ProtectionReason.MICRO_DETAIL;
      if (structuralEdgeScore > 0.4) reason |= ProtectionReason.STRUCTURAL_EDGE;
      if (sourceEvidence > 0.3) reason |= ProtectionReason.SOURCE_SUPPORTED;
      if (genericDetail > 0.4) reason |= ProtectionReason.GENERIC_DETAIL;

      protectionMap[idx] = protection;
      protectionReasonMap[idx] = reason;
      tierMap[idx] = protectionTierOf(protection);
      highlightMap[idx] = highlightScore;
      darkDetailMap[idx] = darkDetailScore;
      eyeLikeMap[idx] = eyeLikeScore;
      edgeMap[idx] = structuralEdgeScore;
    }
  }

  return {
    protectionMap,
    protectionReasonMap,
    tierMap,
    highlightMap,
    darkDetailMap,
    eyeLikeMap,
    edgeMap,
    protectedCells: countProtected(protectionMap, size),
    protectionDistribution: countTiers(tierMap, size),
    protectionReasonCounts: countReasons(protectionReasonMap, size),
  };
}

function countTiers(tierMap, size) {
  const dist = { none: 0, low: 0, medium: 0, high: 0, critical: 0 };
  for (let i = 0; i < size; i++) {
    const t = tierMap[i];
    if (t === ProtectionTier.CRITICAL) dist.critical++;
    else if (t === ProtectionTier.HIGH) dist.high++;
    else if (t === ProtectionTier.MEDIUM) dist.medium++;
    else if (t === ProtectionTier.LOW) dist.low++;
    else dist.none++;
  }
  return dist;
}

function countReasons(reasonMap, size) {
  const counts = { highlight: 0, darkDetail: 0, eyeLike: 0, microDetail: 0, structuralEdge: 0, sourceSupported: 0, genericDetail: 0 };
  for (let i = 0; i < size; i++) {
    const r = reasonMap[i];
    if (r & ProtectionReason.HIGHLIGHT) counts.highlight++;
    if (r & ProtectionReason.DARK_DETAIL) counts.darkDetail++;
    if (r & ProtectionReason.EYE_LIKE) counts.eyeLike++;
    if (r & ProtectionReason.MICRO_DETAIL) counts.microDetail++;
    if (r & ProtectionReason.STRUCTURAL_EDGE) counts.structuralEdge++;
    if (r & ProtectionReason.SOURCE_SUPPORTED) counts.sourceSupported++;
    if (r & ProtectionReason.GENERIC_DETAIL) counts.genericDetail++;
  }
  return counts;
}

function computeEdgeMap(grid, width, height) {
  const map = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const cell = grid[y][x];
      if (!cell) continue;
      let strongest = 0;
      for (const [dx, dy] of FOUR_OFFSETS) {
        const n = grid[y + dy]?.[x + dx];
        if (!n) continue;
        const a = cellRgb(cell), b = cellRgb(n);
        if (!a || !b) continue;
        const d = deltaE2000(rgbToLab(a), rgbToLab(b));
        if (d > strongest) strongest = d;
      }
      map[y * width + x] = clamp01(strongest / 20);
    }
  }
  return map;
}

function countProtected(protectionMap, size) {
  let count = 0;
  for (let i = 0; i < size; i++) if (protectionMap[i] >= 0.5) count++;
  return count;
}

export const DEFAULT_PROTECTION_CONFIG = Object.freeze({
  detailProtection: 0.7,
  edgeProtection: 0.7,
  highlightProtection: 1.0,
  eyeProtection: 1.0,
  microDetailProtection: 1.0,
});

export default {
  DEFAULT_PROTECTION_CONFIG,
  ProtectionReason,
  ProtectionTier,
  protectionTierOf,
  analyzeLocalDetail,
  calculateStructuralContinuity,
  calculateSourceEvidence,
  detectHighlight,
  detectDarkDetail,
  detectEyeLike,
  buildProtectionMap,
};
