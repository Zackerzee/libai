/**
 * BGS algorithm module — per-cell sampling.
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0).
 * Upstream: the single 190-line `switch (processMode)` double loop inside
 * `convertPixels`, src/app.js:2113–2304, plus the detail-mode contrast pass at
 * src/app.js:2376–2400.
 *
 * Modified for libms-studio: split into one function per strategy, all state passed
 * explicitly, thresholds from config.js. The strategies themselves are faithful,
 * including the parts that matter:
 *
 *  - **Area-weighted fractional coverage** when the cell is small enough to walk
 *    exhaustively. Upstream notes this is what makes the result stable when the same
 *    image is supplied at 0.5× or 2× pixel resolution.
 *  - **Per-source-pixel voting with a non-linear weight** (`factor`) that favours
 *    outline pixels, saturated pixels and gradient-bearing pixels. This is the main
 *    reason cartoon output keeps thin dark lines instead of dissolving them.
 *  - **High-confidence white override** so JPEG rim noise lands on white rather than
 *    on a random pastel.
 *  - **No dithering, ever.** Upstream states the reason explicitly: dithering makes
 *    colour noise visible at close range on a bead board.
 */

import { BGS_CONFIG } from './config.mjs';
import { clamp, srgbToLinear, linearToSrgb, luminance255, compositeOverWhite, rgbToOklab, isDarkChromatic } from './color-space.mjs';

/**
 * Canonical sampling modes.
 *
 * `dominant` / `edge-aware` both map onto upstream's cartoon voter; `edge-aware`
 * simply lowers the effective outline threshold so more cells resolve towards the
 * outline anchor. `linear` maps onto upstream's photo/detail path.
 */
export const SAMPLING_MODE = Object.freeze({
  AUTO: 'auto',
  CENTER: 'center',
  LINEAR: 'linear',
  DOMINANT: 'dominant',
  EDGE_AWARE: 'edge-aware',
  DOCUMENT: 'document',
});

const MODE_ALIASES = Object.freeze({
  auto: SAMPLING_MODE.AUTO,
  pixel: SAMPLING_MODE.CENTER,
  center: SAMPLING_MODE.CENTER,
  photo: SAMPLING_MODE.LINEAR,
  detail: SAMPLING_MODE.LINEAR,
  'linear-mean': SAMPLING_MODE.LINEAR,
  linear: SAMPLING_MODE.LINEAR,
  average: SAMPLING_MODE.LINEAR,
  cartoon: SAMPLING_MODE.DOMINANT,
  dominant: SAMPLING_MODE.DOMINANT,
  'edge-aware': SAMPLING_MODE.EDGE_AWARE,
  edgeaware: SAMPLING_MODE.EDGE_AWARE,
  document: SAMPLING_MODE.DOCUMENT,
});

export function resolveSamplingMode(requested, classification = null) {
  const key = String(requested ?? 'auto').toLowerCase();
  const mapped = MODE_ALIASES[key];
  if (mapped && mapped !== SAMPLING_MODE.AUTO) return mapped;
  if (classification?.likelyDocument) return SAMPLING_MODE.DOCUMENT;
  if (classification?.likelyPhoto) return SAMPLING_MODE.LINEAR;
  return SAMPLING_MODE.DOMINANT;
}

/**
 * Source-pixel bounds of one target cell. Upstream src/app.js:2113–2118.
 *
 * libms correction — the upstream cell used `floor` for its start edge but `ceil` for
 * its end edge. Those two roundings disagree, so two neighbouring cells both claim the
 * shared boundary pixel: the "outer" bounds overlap, which makes the multi-sample modes
 * count that source pixel twice whenever it happens to be on a sample stride.
 *
 * Here both edges come from the *same* rounding of the same boundary, so the integer
 * ranges tile the source exactly — every source pixel belongs to exactly one cell.
 *
 * `x0f`/`y0f`/`x1f`/`y1f` deliberately stay the exact fractional window: the multi-sample
 * modes weight a pixel by the area of `window ∩ pixel`, and they normalise by the weights
 * they actually accumulated, so a straddling pixel still contributes its true sub-pixel
 * area to whichever cell owns it rather than being dropped or double counted.
 *
 * When the requested grid is denser than the source (`step < 1`) an exact tiling is
 * impossible without leaving cells empty, which would starve the samplers (zero samples,
 * division by zero). That case falls back to the upstream outer bounds so every cell
 * still claims at least one pixel.
 */
export function cellBounds(x, y, sourceWidth, sourceHeight, cols, rows) {
  const stepX = sourceWidth / cols;
  const stepY = sourceHeight / rows;
  const x0f = x * stepX;
  const y0f = y * stepY;
  const x1f = (x + 1) * stepX;
  const y1f = (y + 1) * stepY;

  const tiledX = stepX >= 1;
  const tiledY = stepY >= 1;

  const x0 = tiledX ? Math.round(x0f) : Math.max(0, Math.floor(x0f));
  const y0 = tiledY ? Math.round(y0f) : Math.max(0, Math.floor(y0f));
  let x1 = tiledX ? Math.round(x1f) : Math.min(sourceWidth, Math.max(x0 + 1, Math.ceil(x1f)));
  let y1 = tiledY ? Math.round(y1f) : Math.min(sourceHeight, Math.max(y0 + 1, Math.ceil(y1f)));
  if (x1 <= x0) x1 = Math.min(sourceWidth, x0 + 1);
  if (y1 <= y0) y1 = Math.min(sourceHeight, y0 + 1);

  return { x0, y0, x1, y1, x0f, y0f, x1f, y1f, stepX, stepY };
}

/* ─────────────────────────────────────────────────────────────
 * 单点 / 线性格中心
 * ───────────────────────────────────────────────────────────── */

/** Upstream `processMode === 'pixel'`, src/app.js:2120–2131. */
function sampleCenterCell(ctx, x, y, out) {
  const { raster, luminance, background, matcher, width, height, cols, rows } = ctx;
  const stepX = width / cols;
  const stepY = height / rows;
  const sx = Math.min(width - 1, Math.max(0, Math.floor((x + 0.5) * stepX)));
  const sy = Math.min(height - 1, Math.max(0, Math.floor((y + 0.5) * stepY)));
  const i = sy * width + sx;
  const p = i * 4;
  const alpha = raster.data[p + 3] / 255;
  if (alpha < BGS_CONFIG.sampling.alphaMin || background[i]) return false;

  const [r, g, b] = compositeOverWhite(raster.data[p], raster.data[p + 1], raster.data[p + 2], alpha);
  const lum = luminance[i];
  const chroma = Math.max(r, g, b) - Math.min(r, g, b);
  const isWhite = Math.min(r, g, b) >= BGS_CONFIG.sampling.nearWhiteChannelMin && chroma <= BGS_CONFIG.sampling.nearWhiteChromaMax;
  const hit = matcher.match(r, g, b);
  out.position = isWhite ? matcher.whitePosition : hit.position;
  out.importance = 1;
  out.support = 1;
  out.valid = true;
  out.luminance = lum;
  return true;
}

/** Upstream `processMode === 'photo' | 'detail'`, src/app.js:2168–2173 + 2262–2282. */
function sampleLinearCell(ctx, x, y, out) {
  const { raster, luminance, background, matcher, width, height, cols, rows, smallLineArtRefinement } = ctx;
  const cfg = BGS_CONFIG.sampling;
  const b = cellBounds(x, y, width, height, cols, rows);
  const cellWidth = b.x1 - b.x0;
  const cellHeight = b.y1 - b.y0;
  const area = cellWidth * cellHeight;
  const exhaustive = area <= cfg.exhaustiveMaxArea;
  const samplesX = exhaustive ? cellWidth : Math.min(cfg.photoMaxSamplesPerAxis, cellWidth);
  const samplesY = exhaustive ? cellHeight : Math.min(cfg.photoMaxSamplesPerAxis, cellHeight);

  let lr = 0; let lg = 0; let lb = 0; let totalWeight = 0;
  let darkLr = 0; let darkLg = 0; let darkLb = 0; let darkWeight = 0;
  let valid = 0;
  let nearWhiteSamples = 0;
  let neutralDarkSamples = 0;
  let lineCoreSamples = 0;
  let lineSoftSamples = 0;
  let lineBackgroundSamples = 0;

  for (let syi = 0; syi < samplesY; syi++) {
    const sy = exhaustive ? b.y0 + syi : Math.min(b.y1 - 1, Math.floor(b.y0 + ((syi + 0.5) * cellHeight) / samplesY));
    for (let sxi = 0; sxi < samplesX; sxi++) {
      const sx = exhaustive ? b.x0 + sxi : Math.min(b.x1 - 1, Math.floor(b.x0 + ((sxi + 0.5) * cellWidth) / samplesX));
      const p = (sy * width + sx) * 4;
      const alpha = raster.data[p + 3] / 255;
      const sampleArea = exhaustive
        ? Math.max(0, Math.min(sx + 1, b.x1f) - Math.max(sx, b.x0f)) * Math.max(0, Math.min(sy + 1, b.y1f) - Math.max(sy, b.y0f))
        : 1;
      if (sampleArea <= 0) continue;
      if (alpha < cfg.alphaMin) continue;

      const i = sy * width + sx;
      if (background[i]) { if (smallLineArtRefinement) lineBackgroundSamples += sampleArea; continue; }

      const [r, g, bch] = compositeOverWhite(raster.data[p], raster.data[p + 1], raster.data[p + 2], alpha);
      const lum = luminance[i];
      const maximum = Math.max(r, g, bch);
      const chroma = maximum - Math.min(r, g, bch);
      valid += sampleArea;
      if (Math.min(r, g, bch) >= cfg.nearWhiteChannelMin && chroma <= cfg.nearWhiteChromaForSample) nearWhiteSamples += sampleArea;
      if (lum <= ctx.outlineCutoff && chroma <= cfg.neutralDarkChromaMax) neutralDarkSamples += sampleArea;
      if (smallLineArtRefinement && chroma <= 22) {
        if (lum <= ctx.lineRasterCutoff) lineCoreSamples += sampleArea;
        if (lum <= BGS_CONFIG.topology.softLuminanceMax) lineSoftSamples += sampleArea;
      }

      const rL = srgbToLinear(r);
      const gL = srgbToLinear(g);
      const bL = srgbToLinear(bch);
      const weight = alpha * sampleArea;
      lr += rL * weight;
      lg += gL * weight;
      lb += bL * weight;
      totalWeight += weight;
      if (lum <= cfg.detailDarkLuminance) {
        darkLr += rL * weight;
        darkLg += gL * weight;
        darkLb += bL * weight;
        darkWeight += weight;
      }
    }
  }

  out.coverage = { nearWhiteSamples, neutralDarkSamples, valid, lineCoreSamples, lineSoftSamples, lineBackgroundSamples, sampleCapacity: exhaustive ? b.stepX * b.stepY : samplesX * samplesY };
  if (totalWeight < 0.02 || !valid) { out.valid = false; return false; }

  let meanR = lr / totalWeight;
  let meanG = lg / totalWeight;
  let meanB = lb / totalWeight;

  // Dark weighting: a cell that is mostly dark should not be washed out by its own
  // average. Only fires when dark pixels are a meaningful share of the cell.
  if (darkWeight / totalWeight >= cfg.detailDarkWeightRatio) {
    const darkR = darkLr / darkWeight;
    const darkG = darkLg / darkWeight;
    const darkB = darkLb / darkWeight;
    const meanLum = 0.2126 * linearToSrgb(meanR) + 0.7152 * linearToSrgb(meanG) + 0.0722 * linearToSrgb(meanB);
    const darkLum = 0.2126 * linearToSrgb(darkR) + 0.7152 * linearToSrgb(darkG) + 0.0722 * linearToSrgb(darkB);
    if (meanLum - darkLum >= cfg.detailDarkLuminanceGap) {
      const strength = Math.min(
        cfg.detailDarkWeightStrengthMax,
        cfg.detailDarkWeightStrengthBase + (darkWeight / totalWeight - cfg.detailDarkWeightRatio) * cfg.detailDarkWeightStrengthSlope,
      );
      meanR = meanR * (1 - strength) + darkR * strength;
      meanG = meanG * (1 - strength) + darkG * strength;
      meanB = meanB * (1 - strength) + darkB * strength;
    }
  }

  const rOut = Math.round(linearToSrgb(meanR));
  const gOut = Math.round(linearToSrgb(meanG));
  const bOut = Math.round(linearToSrgb(meanB));
  const coverage = out.coverage;
  const highConfidenceWhite = coverage.nearWhiteSamples / valid >= cfg.whiteCoverageHigh
    && coverage.neutralDarkSamples / valid < cfg.darkCoverageForWhiteVeto;

  out.rawRgb = [rOut, gOut, bOut];
  out.highConfidenceWhite = highConfidenceWhite;
  out.valid = true;
  out.importance = 1;
  out.support = 1;
  out.luminance = luminance255(rOut, gOut, bOut);
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * 逐源像素投票（cartoon / dominant / edge-aware）
 * ───────────────────────────────────────────────────────────── */

/**
 * Upstream `processMode === 'cartoon'`, src/app.js:2133–2214 + 2283–2302.
 */
function sampleVoteCell(ctx, x, y, out) {
  const { raster, luminance, background, matcher, width, height, cols, rows } = ctx;
  const cfg = BGS_CONFIG.sampling;
  const scores = ctx.scratch.scores;
  const rawScores = ctx.scratch.rawScores;
  const featureScores = ctx.scratch.featureScores;
  scores.fill(0);
  rawScores.fill(0);
  featureScores.fill(0);

  const b = cellBounds(x, y, width, height, cols, rows);
  const cellWidth = b.x1 - b.x0;
  const cellHeight = b.y1 - b.y0;
  const area = cellWidth * cellHeight;
  const exhaustive = area <= cfg.exhaustiveMaxArea;
  const samplesX = exhaustive ? cellWidth : Math.min(cfg.photoMaxSamplesPerAxis, cellWidth);
  const samplesY = exhaustive ? cellHeight : Math.min(cfg.photoMaxSamplesPerAxis, cellHeight);

  const edgeAwareBoost = ctx.samplingMode === SAMPLING_MODE.EDGE_AWARE ? 1.25 : 1;
  const outlineCutoff = ctx.outlineCutoff * (ctx.samplingMode === SAMPLING_MODE.EDGE_AWARE ? 1.2 : 1);

  let valid = 0;
  let outlineSamples = 0;
  let nearWhiteSamples = 0;
  let neutralDarkSamples = 0;
  let lineCoreSamples = 0;
  let lineSoftSamples = 0;
  let lineBackgroundSamples = 0;
  let maxOutlineGradient = 0;
  const outlineRowHits = ctx.scratch.outlineRowHits;
  const outlineColHits = ctx.scratch.outlineColHits;
  outlineRowHits.fill(0, 0, samplesY);
  outlineColHits.fill(0, 0, samplesX);

  for (let syi = 0; syi < samplesY; syi++) {
    const sy = exhaustive ? b.y0 + syi : Math.min(b.y1 - 1, Math.floor(b.y0 + ((syi + 0.5) * cellHeight) / samplesY));
    for (let sxi = 0; sxi < samplesX; sxi++) {
      const sx = exhaustive ? b.x0 + sxi : Math.min(b.x1 - 1, Math.floor(b.x0 + ((sxi + 0.5) * cellWidth) / samplesX));
      const sampleArea = exhaustive
        ? Math.max(0, Math.min(sx + 1, b.x1f) - Math.max(sx, b.x0f)) * Math.max(0, Math.min(sy + 1, b.y1f) - Math.max(sy, b.y0f))
        : 1;
      if (sampleArea <= 0) continue;

      const p = (sy * width + sx) * 4;
      const alpha = raster.data[p + 3] / 255;
      if (alpha < cfg.alphaMin) continue;

      const i = sy * width + sx;
      if (background[i]) { if (ctx.smallLineArtRefinement) lineBackgroundSamples += sampleArea; continue; }

      const [r, g, bch] = compositeOverWhite(raster.data[p], raster.data[p + 1], raster.data[p + 2], alpha);
      valid += sampleArea;

      const lum = luminance[i];
      const maximum = Math.max(r, g, bch);
      const minimum = Math.min(r, g, bch);
      const chroma = maximum - minimum;
      const saturation = maximum ? chroma / maximum : 0;

      if (minimum >= cfg.nearWhiteChannelMin && chroma <= cfg.nearWhiteChromaForSample) nearWhiteSamples += sampleArea;
      if (lum <= outlineCutoff && chroma <= cfg.outlineSampleChromaMax) neutralDarkSamples += sampleArea;
      if (ctx.smallLineArtRefinement && chroma <= 22) {
        if (lum <= ctx.lineRasterCutoff) lineCoreSamples += sampleArea;
        if (lum <= BGS_CONFIG.topology.softLuminanceMax) lineSoftSamples += sampleArea;
      }

      const left = luminance[sy * width + Math.max(0, sx - 1)];
      const right = luminance[sy * width + Math.min(width - 1, sx + 1)];
      const up = luminance[Math.max(0, sy - 1) * width + sx];
      const down = luminance[Math.min(height - 1, sy + 1) * width + sx];
      const gradient = (Math.abs(right - left) + Math.abs(down - up)) * 0.5;

      const rr = Math.round(r);
      const gg = Math.round(g);
      const bb = Math.round(bch);
      const pixelIsChromatic = ctx.isVisiblyChromatic([rr, gg, bb]);
      const packed = (clamp(rr, 0, 255) << 16) | (clamp(gg, 0, 255) << 8) | clamp(bb, 0, 255);
      const exactChoice = ctx.exactIndex.get(packed);
      const isOutline = exactChoice === ctx.matcher.outlinePosition
        || (exactChoice === undefined && !pixelIsChromatic && lum <= outlineCutoff);

      let choice;
      if (isOutline) choice = ctx.matcher.outlinePosition;
      else if (exactChoice !== undefined) choice = exactChoice;
      else if (ctx.monochromeLineArt && !pixelIsChromatic) choice = ctx.matcher.whitePosition;
      else choice = ctx.matcher.matchPosition(r, g, bch);

      let factor = 1;
      if (isOutline) {
        factor = (cfg.outlineFactorBase + Math.min(cfg.outlineFactorGradientMax, gradient / cfg.outlineFactorGradientGain)) * edgeAwareBoost;
        outlineSamples += sampleArea;
        outlineRowHits[syi] = 1;
        outlineColHits[sxi] = 1;
        if (gradient > maxOutlineGradient) maxOutlineGradient = gradient;
      } else if (saturation > cfg.saturatedThreshold) {
        factor = cfg.saturatedFactorBase + cfg.saturatedFactorGain * saturation
          + Math.min(cfg.saturatedFactorGradientMax, gradient / cfg.saturatedFactorGradientGain);
      } else if (lum > 220) {
        factor = cfg.brightNeutralFactor;
      }

      const weight = alpha * factor * sampleArea;
      scores[choice] += weight;
      rawScores[choice] += alpha * sampleArea;
      featureScores[choice] += alpha * sampleArea * Math.max(0, factor - 1);
    }
  }

  const sampleCapacity = exhaustive ? b.stepX * b.stepY : samplesX * samplesY;
  out.coverage = { nearWhiteSamples, neutralDarkSamples, valid, lineCoreSamples, lineSoftSamples, lineBackgroundSamples, sampleCapacity };
  out.outlineStats = { outlineSamples, maxOutlineGradient, rowHits: Array.from(outlineRowHits).slice(0, samplesY), colHits: Array.from(outlineColHits).slice(0, samplesX) };
  if (!valid) { out.valid = false; return false; }
  if (valid / Math.max(0.001, sampleCapacity) < cfg.minValidRatioCartoon) { out.valid = false; return false; }

  const highConfidenceWhite = nearWhiteSamples / valid >= cfg.whiteCoverageHigh
    && neutralDarkSamples / valid < cfg.darkCoverageForWhiteVeto;

  let choice = 0;
  let best = -1;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > best + 1e-7 || (Math.abs(scores[i] - best) < 1e-7 && ctx.matcher.palette[i].index < ctx.matcher.palette[choice].index)) {
      best = scores[i];
      choice = i;
    }
  }

  if (highConfidenceWhite) {
    choice = ctx.matcher.whitePosition;
  } else if (choice === ctx.matcher.outlinePosition) {
    const outlineCoverage = outlineSamples / valid;
    const rowContinuity = out.outlineStats.rowHits.reduce((sum, v) => sum + v, 0) / Math.max(1, samplesY);
    const colContinuity = out.outlineStats.colHits.reduce((sum, v) => sum + v, 0) / Math.max(1, samplesX);
    const coherentThinLine = outlineCoverage >= cfg.thinLineCoverageMin
      && outlineCoverage < cfg.thinLineCoverageMax
      && maxOutlineGradient >= cfg.thinLineGradientMin
      && Math.max(rowContinuity, colContinuity) >= cfg.thinLineContinuityMin;
    if (outlineCoverage + 1e-7 < cfg.thinLineCoverageMax && !coherentThinLine) {
      let alternative = -1;
      let alternativeScore = 0;
      for (let i = 0; i < scores.length; i++) {
        if (i === ctx.matcher.outlinePosition) continue;
        if (scores[i] > alternativeScore + 1e-7
          || (Math.abs(scores[i] - alternativeScore) < 1e-7 && alternative >= 0 && ctx.matcher.palette[i].index < ctx.matcher.palette[alternative].index)) {
          alternative = i;
          alternativeScore = scores[i];
        }
      }
      if (alternative >= 0 && alternativeScore > 0) choice = alternative;
    }
  }

  out.position = choice;
  out.highConfidenceWhite = highConfidenceWhite;
  out.support = rawScores[choice] / valid;
  out.importance = 1 + Math.min(4, featureScores[choice] / Math.max(0.001, scores[choice]));
  out.valid = true;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * document
 * ───────────────────────────────────────────────────────────── */

/**
 * Upstream `processMode === 'document'`, src/app.js:2178–2200 + 2221–2261.
 *
 * The decision tree is deliberately kept but every coefficient is named. See
 * ALGORITHM_AUDIT.md §K-6 — this branch is the least auditable part of upstream and
 * is a prime candidate for a libms-side rewrite.
 */
function sampleDocumentCell(ctx, x, y, out) {
  const { raster, luminance, background, matcher, width, height, cols, rows } = ctx;
  const cfg = BGS_CONFIG.sampling;
  const scores = ctx.scratch.scores;
  const rawScores = ctx.scratch.rawScores;
  scores.fill(0);
  rawScores.fill(0);

  const b = cellBounds(x, y, width, height, cols, rows);
  const cellWidth = b.x1 - b.x0;
  const cellHeight = b.y1 - b.y0;
  const area = cellWidth * cellHeight;
  const exhaustive = area <= cfg.exhaustiveMaxArea;
  const samplesX = exhaustive ? cellWidth : Math.min(cfg.photoMaxSamplesPerAxis, cellWidth);
  const samplesY = exhaustive ? cellHeight : Math.min(cfg.photoMaxSamplesPerAxis, cellHeight);

  const inkThreshold = clamp(ctx.darkThreshold + cfg.docInkThresholdBase, cfg.docInkThresholdRange[0], cfg.docInkThresholdRange[1]);
  const documentColRuns = new Uint16Array(samplesX);
  const documentPreviousRow = new Uint8Array(samplesX);

  let lr = 0; let lg = 0; let lb = 0; let totalWeight = 0;
  let colorLr = 0; let colorLg = 0; let colorLb = 0; let colorWeight = 0;
  let valid = 0;
  let documentDark = 0;
  let documentNonWhite = 0;
  let documentSaturated = 0;
  let documentEdges = 0;
  let documentTransitions = 0;
  let tensorA = 0;
  let tensorB = 0;
  let tensorTotal = 0;
  let maxRowRun = 0;
  let maxColRun = 0;
  let nearWhiteSamples = 0;
  let neutralDarkSamples = 0;

  for (let syi = 0; syi < samplesY; syi++) {
    const sy = exhaustive ? b.y0 + syi : Math.min(b.y1 - 1, Math.floor(b.y0 + ((syi + 0.5) * cellHeight) / samplesY));
    let rowRun = 0;
    let previousDark = 0;
    for (let sxi = 0; sxi < samplesX; sxi++) {
      const sx = exhaustive ? b.x0 + sxi : Math.min(b.x1 - 1, Math.floor(b.x0 + ((sxi + 0.5) * cellWidth) / samplesX));
      const sampleArea = exhaustive
        ? Math.max(0, Math.min(sx + 1, b.x1f) - Math.max(sx, b.x0f)) * Math.max(0, Math.min(sy + 1, b.y1f) - Math.max(sy, b.y0f))
        : 1;
      if (sampleArea <= 0) continue;

      const p = (sy * width + sx) * 4;
      const alpha = raster.data[p + 3] / 255;
      if (alpha < cfg.alphaMin) { rowRun = 0; documentColRuns[sxi] = 0; documentPreviousRow[sxi] = 0; previousDark = 0; continue; }

      const [r, g, bch] = compositeOverWhite(raster.data[p], raster.data[p + 1], raster.data[p + 2], alpha);
      const i = sy * width + sx;
      const lum = luminance[i];
      const maximum = Math.max(r, g, bch);
      const chroma = maximum - Math.min(r, g, bch);
      valid += sampleArea;
      if (Math.min(r, g, bch) >= cfg.nearWhiteChannelMin && chroma <= cfg.nearWhiteChromaForSample) nearWhiteSamples += sampleArea;
      if (lum <= ctx.outlineCutoff && chroma <= cfg.neutralDarkChromaMax) neutralDarkSamples += sampleArea;

      const weight = alpha * sampleArea;
      lr += srgbToLinear(r) * weight;
      lg += srgbToLinear(g) * weight;
      lb += srgbToLinear(bch) * weight;
      totalWeight += weight;

      const dark = lum <= inkThreshold ? 1 : 0;
      const nonWhite = lum < cfg.docNonWhiteLuminance || chroma > cfg.docNonWhiteChroma;
      if (dark) documentDark += sampleArea;
      if (nonWhite) {
        documentNonWhite += sampleArea;
        colorLr += srgbToLinear(r) * weight;
        colorLg += srgbToLinear(g) * weight;
        colorLb += srgbToLinear(bch) * weight;
        colorWeight += weight;
        const mapped = matcher.matchPosition(r, g, bch);
        scores[mapped] += weight;
        if (ctx.isVisiblyChromatic([Math.round(r), Math.round(g), Math.round(bch)])) {
          documentSaturated += sampleArea;
          rawScores[mapped] += weight;
        }
      }

      rowRun = dark ? rowRun + 1 : 0;
      documentColRuns[sxi] = dark ? documentColRuns[sxi] + 1 : 0;
      if (rowRun > maxRowRun) maxRowRun = rowRun;
      if (documentColRuns[sxi] > maxColRun) maxColRun = documentColRuns[sxi];
      if (sxi > 0 && dark !== previousDark) documentTransitions += sampleArea;
      if (syi > 0 && dark !== documentPreviousRow[sxi]) documentTransitions += sampleArea;
      previousDark = dark;
      documentPreviousRow[sxi] = dark;

      const gx = luminance[sy * width + Math.min(width - 1, sx + 1)] - luminance[sy * width + Math.max(0, sx - 1)];
      const gy = luminance[Math.min(height - 1, sy + 1) * width + sx] - luminance[Math.max(0, sy - 1) * width + sx];
      const energy = gx * gx + gy * gy;
      if (Math.abs(gx) + Math.abs(gy) > cfg.docEdgeMagnitude) documentEdges += sampleArea;
      tensorA += (gx * gx - gy * gy) * sampleArea;
      tensorB += 2 * gx * gy * sampleArea;
      tensorTotal += energy * sampleArea;
    }
  }

  out.coverage = { nearWhiteSamples, neutralDarkSamples, valid, sampleCapacity: exhaustive ? b.stepX * b.stepY : samplesX * samplesY };
  if (!valid) { out.valid = false; return false; }

  const darkCoverage = documentDark / valid;
  const nonWhiteCoverage = documentNonWhite / valid;
  const saturatedCoverage = documentSaturated / valid;
  const edgeDensity = documentEdges / valid;
  const coherence = tensorTotal > 0 ? Math.hypot(tensorA, tensorB) / tensorTotal : 0;
  const transitionDensity = documentTransitions / Math.max(1, valid * 2);
  const longRun = Math.max(maxRowRun / Math.max(1, samplesX), maxColRun / Math.max(1, samplesY));

  const continuousRule = darkCoverage >= cfg.docContinuousDarkMin && longRun >= cfg.docContinuousRunMin;
  const coherentEdge = darkCoverage >= cfg.docCoherentDarkMin && edgeDensity >= cfg.docCoherentEdgeMin && coherence >= cfg.docCoherenceMin;
  const solidInk = darkCoverage >= cfg.docSolidInkMin;
  const textTexture = transitionDensity >= cfg.docTextTransitionMin
    && longRun < cfg.docTextRunMax
    && coherence < cfg.docTextCoherenceMax;

  let dominantColor = -1;
  let dominantScore = 0;
  let dominantSaturated = -1;
  let dominantSaturatedScore = 0;
  for (let i = 0; i < scores.length; i++) {
    if (scores[i] > dominantScore) { dominantScore = scores[i]; dominantColor = i; }
    if (rawScores[i] > dominantSaturatedScore) { dominantSaturatedScore = rawScores[i]; dominantSaturated = i; }
  }
  const dominantSupport = dominantScore / Math.max(1, documentNonWhite);
  const solidColor = saturatedCoverage >= cfg.docSolidColorSaturatedMin && dominantSupport >= cfg.docSolidColorSupportMin;
  const solidFill = nonWhiteCoverage >= cfg.docSolidFillMin;

  let choice = -1;
  let confidence = 0;
  if (!(textTexture && !continuousRule && !solidColor && !solidFill)) {
    if (continuousRule || coherentEdge || solidInk) {
      const coloredStructure = documentSaturated / Math.max(1, documentNonWhite) > cfg.docColoredStructureRatio && dominantSaturated >= 0;
      choice = coloredStructure ? dominantSaturated : matcher.outlinePosition;
      confidence = Math.max(darkCoverage, longRun, coherence);
    } else if (solidColor && dominantSaturated >= 0) {
      choice = dominantSaturated;
      confidence = Math.max(saturatedCoverage, dominantSupport);
    } else if (solidFill && colorWeight > 0.02) {
      const r = Math.round(linearToSrgb(colorLr / colorWeight));
      const g = Math.round(linearToSrgb(colorLg / colorWeight));
      const bOut = Math.round(linearToSrgb(colorLb / colorWeight));
      choice = matcher.matchPosition(r, g, bOut);
      confidence = nonWhiteCoverage;
    } else if (ctx.whiteMode === 'keep' && totalWeight > 0.02) {
      const r = Math.round(linearToSrgb(lr / totalWeight));
      const g = Math.round(linearToSrgb(lg / totalWeight));
      const bOut = Math.round(linearToSrgb(lb / totalWeight));
      choice = matcher.matchPosition(r, g, bOut);
      confidence = 0.25;
    }
  }

  out.documentMetrics = { darkCoverage, nonWhiteCoverage, saturatedCoverage, edgeDensity, coherence, transitionDensity, longRun, continuousRule, coherentEdge, solidInk, textTexture, solidColor, solidFill, dominantColor };
  if (choice < 0) { out.valid = false; out.suppressed = true; return false; }

  out.position = choice;
  out.support = confidence;
  out.importance = 1 + Math.min(4, confidence * 3 + ((continuousRule || coherentEdge) ? 1 : 0));
  out.valid = true;
  return true;
}

/* ─────────────────────────────────────────────────────────────
 * 局部反差锐化（detail 后处理，无抖动）
 * ───────────────────────────────────────────────────────────── */

/** Upstream src/app.js:2376–2400. */
export function applyLocalContrast(ctx, positions, rawRgb, validMask, whiteMask, neutralDarkMask) {
  const cfg = BGS_CONFIG.sampling;
  const { cols, rows, matcher } = ctx;
  const outImportance = new Float32Array(cols * rows).fill(1);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      if (!validMask[cell]) continue;
      if (whiteMask[cell]) { positions[cell] = matcher.whitePosition; continue; }

      let nr = 0;
      let ng = 0;
      let nb = 0;
      let neighbours = 0;
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
        const next = ny * cols + nx;
        if (!validMask[next]) continue;
        nr += rawRgb[next][0];
        ng += rawRgb[next][1];
        nb += rawRgb[next][2];
        neighbours++;
      }

      let r = rawRgb[cell][0];
      let g = rawRgb[cell][1];
      let b = rawRgb[cell][2];
      if (neighbours) {
        nr /= neighbours;
        ng /= neighbours;
        nb /= neighbours;
        const baseLum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        const nearLum = 0.2126 * nr + 0.7152 * ng + 0.0722 * nb;
        const amount = Math.abs(baseLum - nearLum) >= cfg.detailSharpenStrongLumGap
          ? cfg.detailSharpenStrongAmount
          : cfg.detailSharpenWeakAmount;
        r = clamp(r + (r - nr) * amount, 0, 255);
        g = clamp(g + (g - ng) * amount, 0, 255);
        b = clamp(b + (b - nb) * amount, 0, 255);
        outImportance[cell] = 1 + Math.min(cfg.detailSharpenImportanceMax, Math.abs(baseLum - nearLum) / cfg.detailSharpenImportanceDivisor);
      }
      // A cell already judged neutral-dark stays confined to neutral palette entries
      // after sharpening, so neighbourhood colour cast cannot push black into blue.
      positions[cell] = matcher.matchPosition(Math.round(r), Math.round(g), Math.round(b), { forceNeutral: Boolean(neutralDarkMask[cell]) });
    }
  }
  return outImportance;
}

/* ─────────────────────────────────────────────────────────────
 * 主循环
 * ───────────────────────────────────────────────────────────── */

/**
 * Sample every cell.
 *
 * @returns {{positions: Int32Array, importance: Float32Array, support: Float32Array,
 *            coverage: object[], outlineStats: object[], documentMetrics: object[],
 *            detailRgb: Array|null, detailValid: Uint8Array|null,
 *            detailWhite: Uint8Array|null, detailNeutralDark: Uint8Array|null}}
 */
export function sampleAll(ctx) {
  const { cols, rows, samplingMode } = ctx;
  const cellCount = cols * rows;
  const positions = new Int32Array(cellCount).fill(-1);
  const importance = new Float32Array(cellCount);
  const support = new Float32Array(cellCount);
  const coverage = new Array(cellCount).fill(null);
  const outlineStats = new Array(cellCount).fill(null);
  const documentMetrics = new Array(cellCount).fill(null);

  const isLinear = samplingMode === SAMPLING_MODE.LINEAR;
  const detailRgb = new Array(cellCount).fill(null);
  const detailValid = new Uint8Array(cellCount);
  const detailWhite = new Uint8Array(cellCount);
  const detailNeutralDark = new Uint8Array(cellCount);

  const out = { position: -1, importance: 1, support: 1, valid: false, coverage: null, outlineStats: null, documentMetrics: null, luminance: 0, rawRgb: null, highConfidenceWhite: false };

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const cell = y * cols + x;
      out.position = -1;
      out.valid = false;
      out.coverage = null;
      out.outlineStats = null;
      out.documentMetrics = null;
      out.rawRgb = null;
      out.highConfidenceWhite = false;

      let ok = false;
      if (samplingMode === SAMPLING_MODE.CENTER) ok = sampleCenterCell(ctx, x, y, out);
      else if (isLinear) ok = sampleLinearCell(ctx, x, y, out);
      else if (samplingMode === SAMPLING_MODE.DOCUMENT) ok = sampleDocumentCell(ctx, x, y, out);
      else ok = sampleVoteCell(ctx, x, y, out);

      if (!ok) continue;
      if (out.coverage) coverage[cell] = out.coverage;
      if (out.outlineStats) outlineStats[cell] = out.outlineStats;
      if (out.documentMetrics) documentMetrics[cell] = out.documentMetrics;

      if (isLinear) {
        detailRgb[cell] = out.rawRgb;
        detailValid[cell] = 1;
        if (out.highConfidenceWhite) detailWhite[cell] = 1;
        if (ctx.protectDark && out.rawRgb) {
          // Upstream src/app.js:2278–2279 evaluates this on the cell mean colour.
          const meanLab = rgbToOklab(out.rawRgb);
          if (meanLab[0] < BGS_CONFIG.matcher.protectDarkLightnessMax
            && Math.hypot(meanLab[1], meanLab[2]) < BGS_CONFIG.matcher.protectDarkChromaMax
            && !isDarkChromatic(out.rawRgb, meanLab[0])) detailNeutralDark[cell] = 1;
        }
        if (out.highConfidenceWhite) {
          positions[cell] = ctx.matcher.whitePosition;
        } else {
          positions[cell] = ctx.matcher.matchPosition(out.rawRgb[0], out.rawRgb[1], out.rawRgb[2]);
        }
        importance[cell] = 1;
        support[cell] = 1;
      } else {
        positions[cell] = out.position;
        importance[cell] = out.importance;
        support[cell] = out.support ?? 1;
      }
    }
  }

  return {
    positions,
    importance,
    support,
    coverage,
    outlineStats,
    documentMetrics,
    detailRgb: isLinear ? detailRgb : null,
    detailValid: isLinear ? detailValid : null,
    detailWhite: isLinear ? detailWhite : null,
    detailNeutralDark: isLinear ? detailNeutralDark : null,
  };
}

/** Build the reusable scratch buffers the vote/document strategies need. */
export function createScratch(paletteLength, maxSamplesPerAxis) {
  return {
    scores: new Float32Array(paletteLength),
    rawScores: new Float32Array(paletteLength),
    featureScores: new Float32Array(paletteLength),
    outlineRowHits: new Uint8Array(maxSamplesPerAxis),
    outlineColHits: new Uint8Array(maxSamplesPerAxis),
  };
}

export default {
  SAMPLING_MODE,
  resolveSamplingMode,
  cellBounds,
  sampleAll,
  applyLocalContrast,
  createScratch,
};
