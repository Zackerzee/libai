/**
 * BGS algorithm module — content analysis: transparent/background handling,
 * scan-edge artefact rejection, adaptive dark threshold, content classification
 * and line-art framing (auto-crop).
 *
 * Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0):
 *   - background flood fill            src/app.js:1816–1860
 *   - scan-edge artefact rejection     src/app.js:1862–1894
 *   - Otsu dark threshold              src/app.js:1897–1920
 *   - `analyzeSourceComplexity`        src/app.js:291–357
 *   - `analyzeLineArtSubject`          src/app.js:203–289
 *
 * Modified for libms-studio: pure functions, thresholds from config.js, and one
 * latent upstream tautology repaired (see `autoCrop.retainedInkRatio` below).
 */

import { BGS_CONFIG } from './config.mjs';
import { luminance255, compositeOverWhite, otsuThreshold, clamp } from './color-space.mjs';
import { asRaster, cropRaster } from './raster.mjs';

/* ─────────────────────────────────────────────────────────────
 * 亮度图
 * ───────────────────────────────────────────────────────────── */

/** Precompute the 8-bit luma plane. Upstream src/app.js:1808–1814. */
export function computeLuminance(raster) {
  const src = asRaster(raster);
  const count = src.width * src.height;
  const luminance = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const alpha = src.data[p + 3] / 255;
    const [r, g, b] = compositeOverWhite(src.data[p], src.data[p + 1], src.data[p + 2], alpha);
    luminance[i] = luminance255(r, g, b);
  }
  return luminance;
}

/* ─────────────────────────────────────────────────────────────
 * 透明区域 + 连通背景
 * ───────────────────────────────────────────────────────────── */

/**
 * Decide which source pixels are "empty background".
 *
 * Key upstream property worth preserving: only light pixels **connected to the
 * border** are cleared. White enclosed by an outline stays a white bead. This is
 * the same invariant libms's `auto-background.mjs` implements, and the two must
 * agree on `whiteMode: 'auto'`.
 *
 * @returns {{mask: Uint8Array, backgroundPixels: number, applied: boolean, reason: string, baseColor?: number[]}}
 */
export function resolveBackgroundMask(raster, luminance, { whiteMode = 'auto' } = {}) {
  const src = asRaster(raster);
  const count = src.width * src.height;
  const mask = new Uint8Array(count);
  if (whiteMode !== 'auto') {
    return { mask, backgroundPixels: 0, applied: false, reason: 'whiteMode!=="auto"' };
  }

  const cfg = BGS_CONFIG.background;
  const { width, height, data } = src;

  const border = [];
  const pushBorder = (x, y) => {
    const p = (y * width + x) * 4;
    const alpha = data[p + 3];
    if (alpha < cfg.minAlpha) border.push([255, 255, 255, 0]);
    else border.push([data[p], data[p + 1], data[p + 2], alpha]);
  };
  for (let x = 0; x < width; x++) {
    pushBorder(x, 0);
    if (height > 1) pushBorder(x, height - 1);
  }
  for (let y = 1; y + 1 < height; y++) {
    pushBorder(0, y);
    if (width > 1) pushBorder(width - 1, y);
  }

  const lightBorder = border.filter((c) => c[3] < cfg.minAlpha
    || (luminance255(c[0], c[1], c[2]) > cfg.lightLuminance
      && Math.max(c[0], c[1], c[2]) - Math.min(c[0], c[1], c[2]) < cfg.lightChromaMax));

  if (lightBorder.length < Math.max(8, border.length * cfg.minLightBorderRatio)) {
    return { mask, backgroundPixels: 0, applied: false, reason: 'border not predominantly light' };
  }

  const median = (channel) => {
    const values = lightBorder.map((c) => c[channel]).sort((a, b) => a - b);
    return values[Math.floor(values.length / 2)];
  };
  const br = median(0);
  const bg = median(1);
  const bb = median(2);
  const baseLum = luminance255(br, bg, bb);

  let similar = 0;
  for (const c of border) {
    if (c[3] < cfg.minAlpha) { similar++; continue; }
    const dr = c[0] - br;
    const dg = c[1] - bg;
    const db = c[2] - bb;
    if (dr * dr + dg * dg + db * db <= cfg.colorDistanceSq) similar++;
  }

  const baseChroma = Math.max(br, bg, bb) - Math.min(br, bg, bb);
  if (!(baseLum > cfg.baseLuminanceMin
    && baseChroma < cfg.baseChromaMax
    && similar / border.length >= cfg.minSimilarRatio)) {
    return {
      mask, backgroundPixels: 0, applied: false, reason: 'border colour not neutral-light enough', baseColor: [br, bg, bb],
    };
  }

  const floor = Math.max(cfg.floodLuminanceFloor, baseLum - cfg.floodLuminanceDelta);
  const queue = new Int32Array(count);
  let head = 0;
  let tail = 0;

  const isCandidate = (i) => {
    const p = i * 4;
    const alpha = data[p + 3];
    if (alpha < cfg.minAlpha) return true;
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    const dr = r - br;
    const dg = g - bg;
    const db = b - bb;
    const chroma = Math.max(r, g, b) - Math.min(r, g, b);
    return dr * dr + dg * dg + db * db <= cfg.colorDistanceSq
      && luminance[i] >= floor
      && chroma < cfg.floodChromaMax;
  };

  const enqueue = (i) => {
    if (i >= 0 && i < count && !mask[i] && isCandidate(i)) {
      mask[i] = 1;
      queue[tail++] = i;
    }
  };

  for (let x = 0; x < width; x++) {
    enqueue(x);
    enqueue((height - 1) * width + x);
  }
  for (let y = 0; y < height; y++) {
    enqueue(y * width);
    enqueue(y * width + width - 1);
  }

  while (head < tail) {
    const i = queue[head++];
    const x = i % width;
    const y = (i - x) / width;
    if (x > 0) enqueue(i - 1);
    if (x + 1 < width) enqueue(i + 1);
    if (y > 0) enqueue(i - width);
    if (y + 1 < height) enqueue(i + width);
  }

  return { mask, backgroundPixels: tail, applied: true, reason: 'border-connected flood fill', baseColor: [br, bg, bb] };
}

/**
 * Reject a uniform 1px scan/JPEG edge strip.
 *
 * Upstream src/app.js:1862–1894. The conditions are deliberately strict: the strip
 * must be nearly uniform, nearly neutral, mid-grey, sandwiched between near-white
 * inner rows, and clearly lighter than real ink. That makes false deletion of a
 * genuine dark border very unlikely — which is why it is worth keeping.
 */
export function markEdgeArtifacts(raster, luminance, background) {
  const src = asRaster(raster);
  const cfg = BGS_CONFIG.edgeArtifact;
  const { width, height, data } = src;
  const count = width * height;
  let edgeArtifactPixels = 0;
  const decisions = [];

  const inkSamples = [];
  for (let i = 0; i < count; i++) {
    const p = i * 4;
    if (background[i]) continue;
    const chroma = Math.max(data[p], data[p + 1], data[p + 2]) - Math.min(data[p], data[p + 1], data[p + 2]);
    if (data[p + 3] >= cfg.transparentAlpha && luminance[i] <= cfg.inkLuminanceMax && chroma <= cfg.inkChromaMax) {
      inkSamples.push(luminance[i]);
    }
  }
  inkSamples.sort((a, b) => a - b);
  const inkP90 = inkSamples.length >= cfg.inkSampleMinCount
    ? inkSamples[Math.min(inkSamples.length - 1, Math.floor(inkSamples.length * 0.9))]
    : null;
  if (inkP90 === null) return { background, edgeArtifactPixels: 0, inkP90: null, decisions };

  const edgeProfile = (axis, position) => {
    const length = axis === 'row' ? width : height;
    const values = [];
    let nearWhite = 0;
    let neutral = 0;
    for (let n = 0; n < length; n++) {
      const x = axis === 'row' ? n : position;
      const y = axis === 'row' ? position : n;
      const i = y * width + x;
      const p = i * 4;
      const r = data[p];
      const g = data[p + 1];
      const b = data[p + 2];
      const alpha = data[p + 3];
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      if (alpha < cfg.transparentAlpha) { values.push(255); nearWhite++; neutral++; continue; }
      const lum = luminance[i];
      values.push(lum);
      if (lum >= 240 && chroma <= 12) nearWhite++;
      if (chroma <= 12) neutral++;
    }
    values.sort((a, b) => a - b);
    const median = values[Math.floor(values.length / 2)];
    let uniform = 0;
    for (const value of values) if (Math.abs(value - median) <= cfg.tolerance) uniform++;
    return {
      median,
      uniform: uniform / Math.max(1, length),
      nearWhite: nearWhite / Math.max(1, length),
      neutral: neutral / Math.max(1, length),
    };
  };

  const tryEdge = (axis, edgePosition, innerA, innerB) => {
    const edge = edgeProfile(axis, edgePosition);
    const a = edgeProfile(axis, innerA);
    const b = edgeProfile(axis, innerB);
    const passes = edge.uniform >= cfg.uniformRatio
      && edge.neutral >= cfg.neutralRatio
      && edge.median >= cfg.medianRange[0]
      && edge.median <= cfg.medianRange[1]
      && a.nearWhite >= cfg.innerNearWhiteRatio
      && b.nearWhite >= cfg.innerNearWhiteRatio
      && a.median - edge.median >= cfg.innerMedianDelta
      && edge.median - inkP90 >= cfg.inkPercentileGap;
    if (!passes) {
      decisions.push({ axis, edgePosition, applied: false, edge, innerNear: { a, b } });
      return;
    }
    const length = axis === 'row' ? width : height;
    let cleared = 0;
    for (let n = 0; n < length; n++) {
      const x = axis === 'row' ? n : edgePosition;
      const y = axis === 'row' ? edgePosition : n;
      const i = y * width + x;
      if (!background[i]) {
        background[i] = 1;
        edgeArtifactPixels++;
        cleared++;
      }
    }
    decisions.push({ axis, edgePosition, applied: true, edge, cleared });
  };

  if (height >= 4) {
    tryEdge('row', 0, 1, 2);
    tryEdge('row', height - 1, height - 2, height - 3);
  }
  if (width >= 4) {
    tryEdge('col', 0, 1, 2);
    tryEdge('col', width - 1, width - 2, width - 3);
  }

  return { background, edgeArtifactPixels, inkP90, decisions };
}

/* ─────────────────────────────────────────────────────────────
 * 自适应暗阈值
 * ───────────────────────────────────────────────────────────── */

/**
 * Estimate the "outline dark" level from neutral pixels only.
 * Upstream src/app.js:1897–1920, plus the libms Otsu plateau correction.
 */
export function resolveDarkThreshold(raster, luminance, background) {
  const src = asRaster(raster);
  const cfg = BGS_CONFIG;
  const count = src.width * src.height;
  const histogram = new Uint32Array(256);
  let histogramTotal = 0;

  for (let i = 0; i < count; i++) {
    const p = i * 4;
    if (src.data[p + 3] < cfg.background.transparentAlpha || background[i]) continue;
    const chroma = Math.max(src.data[p], src.data[p + 1], src.data[p + 2])
      - Math.min(src.data[p], src.data[p + 1], src.data[p + 2]);
    if (chroma < cfg.neutralChromaForHistogram) {
      histogram[luminance[i]]++;
      histogramTotal++;
    }
  }

  const fallback = cfg.darkThresholdFallback;
  if (!histogramTotal) {
    return {
      darkThreshold: fallback,
      outlineCutoff: Math.min(fallback, cfg.outlineCutoffCeiling),
      otsu: null,
      histogramTotal: 0,
      source: 'fallback',
    };
  }

  const otsu = otsuThreshold(histogram, histogramTotal);
  const [lo, hi] = cfg.darkThresholdRange;
  const darkThreshold = clamp(otsu.threshold + cfg.darkThresholdBias, lo, hi);
  return {
    darkThreshold,
    outlineCutoff: Math.min(darkThreshold, cfg.outlineCutoffCeiling),
    otsu,
    histogramTotal,
    source: otsu.flatPlateau ? 'otsu-plateau-midpoint' : 'otsu',
  };
}

/* ─────────────────────────────────────────────────────────────
 * 内容分类
 * ───────────────────────────────────────────────────────────── */

/**
 * Classify the source as document / photo / (implicitly) line art.
 *
 * Upstream src/app.js:291–357. The thresholds are lifted into config.js but they
 * remain **re-calibration candidates** (ALGORITHM_AUDIT.md §K-4): they were tuned
 * against the upstream fixtures and carry no published derivation.
 */
export function analyzeContent(raster, { sourceWidth, sourceHeight } = {}) {
  const src = asRaster(raster);
  const cfg = BGS_CONFIG.classify;
  const { width, height, data } = src;
  const count = width * height;
  const empty = {
    likelyDocument: false,
    likelyPhoto: false,
    documentScore: 0,
    nearWhiteRatio: 0,
    edgeDensity: 0,
    transitionDensity: 0,
    longLineRatio: 0,
    darkRatio: 0,
    saturatedRatio: 0,
    quantizedColorCount: 0,
    flatPairRatio: 1,
    smallComponentCount: 0,
    medianGlyphHeightPx: null,
  };
  if (!count) return empty;

  const sw = Number(sourceWidth) || width;
  const sh = Number(sourceHeight) || height;

  const luminance = new Uint8Array(count);
  const darkMask = new Uint8Array(count);
  const colorBins = new Uint8Array(512);
  let nearWhite = 0;
  let dark = 0;
  let saturated = 0;
  let edges = 0;
  let transitions = 0;
  let flatPairs = 0;
  let pairCount = 0;

  const composite = (i) => {
    const p = i * 4;
    const alpha = data[p + 3] / 255;
    return compositeOverWhite(data[p], data[p + 1], data[p + 2], alpha);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const p = i * 4;
      const [r, g, b] = composite(i);
      const lum = luminance255(r, g, b);
      const chroma = Math.max(r, g, b) - Math.min(r, g, b);
      colorBins[((Math.round(r) >> cfg.colorBinShift) << 6)
        | ((Math.round(g) >> cfg.colorBinShift) << 3)
        | (Math.round(b) >> cfg.colorBinShift)] = 1;
      luminance[i] = lum;
      if (lum > cfg.nearWhiteLuminance && chroma < cfg.nearWhiteChroma) nearWhite++;
      if (lum < cfg.darkLuminance) { dark++; darkMask[i] = 1; }
      if (chroma > cfg.saturatedChroma && lum < cfg.saturatedLuminance) saturated++;

      if (x > 0) {
        const diff = Math.abs(lum - luminance[i - 1]);
        if (diff > cfg.edgeDelta) edges++;
        if (darkMask[i] !== darkMask[i - 1]) transitions++;
        const [pr, pg, pb] = composite(i - 1);
        if (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb) < cfg.flatPairDelta) flatPairs++;
        pairCount++;
      }
      if (y > 0) {
        const diff = Math.abs(lum - luminance[i - width]);
        if (diff > cfg.edgeDelta) edges++;
        if (darkMask[i] !== darkMask[i - width]) transitions++;
        const [pr, pg, pb] = composite(i - width);
        if (Math.abs(r - pr) + Math.abs(g - pg) + Math.abs(b - pb) < cfg.flatPairDelta) flatPairs++;
        pairCount++;
      }
    }
  }

  let longRows = 0;
  let longCols = 0;
  for (let y = 0; y < height; y++) {
    let run = 0;
    let best = 0;
    for (let x = 0; x < width; x++) {
      if (darkMask[y * width + x]) { run++; if (run > best) best = run; } else run = 0;
    }
    if (best >= width * cfg.longRunFraction) longRows++;
  }
  for (let x = 0; x < width; x++) {
    let run = 0;
    let best = 0;
    for (let y = 0; y < height; y++) {
      if (darkMask[y * width + x]) { run++; if (run > best) best = run; } else run = 0;
    }
    if (best >= height * cfg.longRunFraction) longCols++;
  }

  const nearWhiteRatio = nearWhite / count;
  const darkRatio = dark / count;
  const saturatedRatio = saturated / count;
  const neighbourPairs = Math.max(1, (width - 1) * height + (height - 1) * width);
  const edgeDensity = edges / neighbourPairs;
  const transitionDensity = transitions / neighbourPairs;
  const longLineRatio = (longRows + longCols) / Math.max(1, width + height);
  let quantizedColorCount = 0;
  for (let i = 0; i < colorBins.length; i++) quantizedColorCount += colorBins[i];
  const flatPairRatio = flatPairs / Math.max(1, pairCount);

  // Glyph-height proxy: small dark components that are neither border lines nor blocks.
  const visited = new Uint8Array(count);
  const queue = new Int32Array(count);
  const componentHeights = [];
  const maxComponent = Math.max(24, Math.floor(count * cfg.glyphMaxAreaRatio));
  for (let start = 0; start < count; start++) {
    if (!darkMask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      const add = (next) => {
        if (next >= 0 && next < count && darkMask[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
      };
      if (x > 0) add(i - 1);
      if (x + 1 < width) add(i + 1);
      if (y > 0) add(i - width);
      if (y + 1 < height) add(i + width);
    }
    const boxW = maxX - minX + 1;
    const boxH = maxY - minY + 1;
    if (area >= 2 && area <= maxComponent && boxW <= width * cfg.glyphMaxBoxRatio && boxH <= height * cfg.glyphMaxBoxRatio && boxH >= 2) {
      componentHeights.push((boxH * sh) / height);
    }
  }
  componentHeights.sort((a, b) => a - b);
  const smallComponentCount = componentHeights.length;
  const medianGlyphHeightPx = componentHeights.length >= 4
    ? componentHeights[Math.floor(componentHeights.length / 2)]
    : null;

  const documentScore = clamp(
    (nearWhiteRatio - 0.42) * 1.25
    + edgeDensity * 2.1
    + transitionDensity * 2.4
    + longLineRatio * 1.5
    + (darkRatio > 0.008 && darkRatio < 0.42 ? 0.18 : 0)
    - saturatedRatio * 0.45,
    0, 1,
  );
  const documentTexture = (smallComponentCount >= 4 && transitionDensity >= cfg.docTransitionDensityMin)
    || transitionDensity >= cfg.docTransitionDensitySolo;
  const likelyDocument = nearWhiteRatio >= cfg.docNearWhiteMin
    && edgeDensity >= cfg.docEdgeDensityMin
    && darkRatio < cfg.docDarkMax
    && documentTexture
    && documentScore >= cfg.docScoreMin;
  const likelyPhoto = !likelyDocument
    && quantizedColorCount >= cfg.photoQuantizedColorsMin
    && flatPairRatio < cfg.photoFlatPairMax;

  return {
    likelyDocument,
    likelyPhoto,
    documentScore,
    nearWhiteRatio,
    edgeDensity,
    transitionDensity,
    longLineRatio,
    darkRatio,
    saturatedRatio,
    quantizedColorCount,
    flatPairRatio,
    smallComponentCount,
    medianGlyphHeightPx,
  };
}

/* ─────────────────────────────────────────────────────────────
 * 线稿分析与自动裁边
 * ───────────────────────────────────────────────────────────── */

/**
 * Detect monochrome line art and propose a normalized auto-crop rect.
 *
 * Upstream src/app.js:203–289.
 *
 * **Documented repair.** Upstream computed
 * `retainedInkRatio = retained / Σ(components.area)` where `retained` is *itself*
 * `Σ(components.area)` over the same array — the ratio is therefore identically
 * `1`, and the guard `retainedInkRatio >= .995` is a tautology that can never fail.
 * Here the denominator is the total mask population *including* the rejected scan
 * edges, so the guard actually means "auto-crop must not throw away ink". The
 * upstream-equivalent value is reported separately as `upstreamTautologyRatio`.
 */
export function analyzeLineArt(raster, { sourceForGlyph = null } = {}) {
  const src = asRaster(raster);
  const cfg = BGS_CONFIG.lineArt;
  const { width, height, data } = src;
  const count = width * height;
  const empty = {
    likelyLineArt: false,
    autoCrop: null,
    trimFraction: 0,
    retainedInkRatio: 0,
    confidence: 0,
    inkBounds: null,
    componentCount: 0,
    excludedComponentCount: 0,
    stripDecisions: [],
  };
  if (!count || width < 8 || height < 8) return empty;

  const mask = new Uint8Array(count);
  const visited = new Uint8Array(count);
  const luminance = new Uint8Array(count);
  let neutral = 0;
  let bright = 0;
  let strongInk = 0;
  let chromatic = 0;
  let inkTotal = 0;

  for (let i = 0; i < count; i++) {
    const p = i * 4;
    const alpha = data[p + 3] / 255;
    const [r, g, b] = compositeOverWhite(data[p], data[p + 1], data[p + 2], alpha);
    const lum = luminance255(r, g, b);
    const maximum = Math.max(r, g, b);
    const chroma = maximum - Math.min(r, g, b);
    const relative = chroma / Math.max(1, maximum);
    luminance[i] = lum;
    if (chroma <= cfg.neutralChromaMax) neutral++;
    if (lum >= cfg.brightLuminanceMin && chroma <= cfg.brightChromaMax) bright++;
    if (lum <= cfg.inkLuminanceMax && chroma <= cfg.inkChromaMax) strongInk++;
    if (chroma >= cfg.chromaticSpread && relative >= cfg.chromaticRelative) chromatic++;
    if (lum <= cfg.maskLuminanceMax && chroma <= cfg.inkChromaMax) { mask[i] = 1; inkTotal++; }
  }

  const neutralRatio = neutral / count;
  const brightRatio = bright / count;
  const strongInkRatio = strongInk / count;
  const chromaticRatio = chromatic / count;
  const likelyLineArt = neutralRatio >= cfg.neutralRatioMin
    && brightRatio >= cfg.brightRatioMin
    && strongInkRatio >= cfg.strongInkRatioMin
    && strongInkRatio <= cfg.strongInkRatioMax
    && chromaticRatio <= cfg.chromaticRatioMax;
  if (!likelyLineArt || inkTotal < cfg.minInkPixels) return { ...empty, likelyLineArt };

  const strictInkLums = [];
  for (let i = 0; i < count; i++) if (mask[i] && luminance[i] <= cfg.strictInkLuminanceMax) strictInkLums.push(luminance[i]);
  strictInkLums.sort((a, b) => a - b);
  const strictInkP90 = strictInkLums.length >= 8
    ? strictInkLums[Math.min(strictInkLums.length - 1, Math.floor(strictInkLums.length * 0.9))]
    : null;

  const median = (values) => {
    if (!values.length) return 0;
    const sorted = values.slice().sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)];
  };

  const scannerEdgeStrip = ({ minX, maxX, minY, maxY }) => {
    if (strictInkP90 === null) return false;
    const maxStripY = Math.max(2, Math.floor(height * BGS_CONFIG.edgeArtifact.maxStripFraction));
    const maxStripX = Math.max(2, Math.floor(width * BGS_CONFIG.edgeArtifact.maxStripFraction));

    const evaluateHorizontal = (edgeY, innerY) => {
      if (innerY < 0 || innerY >= height) return false;
      const edge = [];
      const inner = [];
      let covered = 0;
      for (let x = 0; x < width; x++) {
        const i = edgeY * width + x;
        if (mask[i]) { covered++; edge.push(luminance[i]); }
        inner.push(luminance[innerY * width + x]);
      }
      if (covered / width < BGS_CONFIG.edgeArtifact.minCoverage || !edge.length) return false;
      const edgeMedian = median(edge);
      const innerMedian = median(inner);
      const uniform = edge.filter((v) => Math.abs(v - edgeMedian) <= 8).length / edge.length;
      const innerBright = inner.filter((v) => v >= 235).length / inner.length;
      return edgeMedian >= 88 && uniform >= 0.98 && innerBright >= 0.95
        && innerMedian - edgeMedian >= 64 && edgeMedian - strictInkP90 >= 24;
    };
    const evaluateVertical = (edgeX, innerX) => {
      if (innerX < 0 || innerX >= width) return false;
      const edge = [];
      const inner = [];
      let covered = 0;
      for (let y = 0; y < height; y++) {
        const i = y * width + edgeX;
        if (mask[i]) { covered++; edge.push(luminance[i]); }
        inner.push(luminance[y * width + innerX]);
      }
      if (covered / height < BGS_CONFIG.edgeArtifact.minCoverage || !edge.length) return false;
      const edgeMedian = median(edge);
      const innerMedian = median(inner);
      const uniform = edge.filter((v) => Math.abs(v - edgeMedian) <= 8).length / edge.length;
      const innerBright = inner.filter((v) => v >= 235).length / inner.length;
      return edgeMedian >= 88 && uniform >= 0.98 && innerBright >= 0.95
        && innerMedian - edgeMedian >= 64 && edgeMedian - strictInkP90 >= 24;
    };

    const thinHorizontal = maxY - minY + 1 <= maxStripY;
    const thinVertical = maxX - minX + 1 <= maxStripX;
    return (thinHorizontal && minY === 0 && maxX - minX + 1 >= width * 0.9 && evaluateHorizontal(0, maxY + 1))
      || (thinHorizontal && maxY === height - 1 && maxX - minX + 1 >= width * 0.9 && evaluateHorizontal(height - 1, minY - 1))
      || (thinVertical && minX === 0 && maxY - minY + 1 >= height * 0.9 && evaluateVertical(0, maxX + 1))
      || (thinVertical && maxX === width - 1 && maxY - minY + 1 >= height * 0.9 && evaluateVertical(width - 1, minX - 1));
  };

  const queue = new Int32Array(count);
  const components = [];
  const stripDecisions = [];
  for (let start = 0; start < count; start++) {
    if (!mask[start] || visited[start]) continue;
    let head = 0;
    let tail = 0;
    let area = 0;
    let minX = width;
    let maxX = 0;
    let minY = height;
    let maxY = 0;
    visited[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const i = queue[head++];
      const x = i % width;
      const y = (i - x) / width;
      area++;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (mask[next] && !visited[next]) { visited[next] = 1; queue[tail++] = next; }
        }
      }
    }
    const component = { area, minX, maxX, minY, maxY };
    if (scannerEdgeStrip(component)) stripDecisions.push({ ...component, excluded: true });
    else components.push(component);
  }

  if (!components.length) return { ...empty, likelyLineArt, stripDecisions, componentCount: 0 };

  components.sort((a, b) => b.area - a.area);
  const main = components[0];
  if (main.area < count * cfg.minInkBoundsAreaRatio) {
    return { ...empty, likelyLineArt, stripDecisions, componentCount: components.length };
  }

  // Every surviving ink component participates in framing — decorative dots, text and
  // detached parts are NOT silently dropped just because they sit away from the body.
  let minX = main.minX;
  let maxX = main.maxX;
  let minY = main.minY;
  let maxY = main.maxY;
  let retained = 0;
  for (const component of components) {
    retained += component.area;
    if (component.minX < minX) minX = component.minX;
    if (component.maxX > maxX) maxX = component.maxX;
    if (component.minY < minY) minY = component.minY;
    if (component.maxY > maxY) maxY = component.maxY;
  }

  const inkBounds = { minX, maxX, minY, maxY };
  const span = Math.max(maxX - minX + 1, maxY - minY + 1);
  const padding = Math.max(cfg.minPaddingPx, Math.round(span * cfg.paddingRatio));
  const paddedMinX = Math.max(0, minX - padding);
  const paddedMinY = Math.max(0, minY - padding);
  const paddedMaxX = Math.min(width - 1, maxX + padding);
  const paddedMaxY = Math.min(height - 1, maxY + padding);

  const crop = {
    x: paddedMinX / width,
    y: paddedMinY / height,
    w: (paddedMaxX - paddedMinX + 1) / width,
    h: (paddedMaxY - paddedMinY + 1) / height,
  };
  const trimFraction = 1 - crop.w * crop.h;
  const retainedInkRatio = retained / Math.max(1, inkTotal);
  const confidence = clamp((neutralRatio - 0.96) * 8 + (brightRatio - 0.55) * 1.4 + (retainedInkRatio - 0.9) * 2, 0, 1);

  return {
    likelyLineArt,
    autoCrop: trimFraction >= cfg.autoCropTrimMin && retainedInkRatio >= cfg.autoCropRetentionMin
      ? { ...crop, upstreamTautologyRatio: 1 }
      : null,
    trimFraction,
    retainedInkRatio,
    confidence,
    inkBounds,
    componentCount: components.length,
    excludedComponentCount: stripDecisions.length,
    stripDecisions,
    strictInkP90,
    sourceForGlyph,
  };
}

/** Convenience: analyze then crop. */
export function autoCropRaster(raster, analysis = null) {
  const src = asRaster(raster);
  const result = analysis || analyzeLineArt(src);
  if (!result.autoCrop) return { raster: src, applied: false, analysis: result };
  const rect = {
    x: result.autoCrop.x * src.width,
    y: result.autoCrop.y * src.height,
    w: result.autoCrop.w * src.width,
    h: result.autoCrop.h * src.height,
  };
  return { raster: cropRaster(src, rect), applied: true, analysis: result, rect };
}

export default {
  computeLuminance,
  resolveBackgroundMask,
  markEdgeArtifacts,
  resolveDarkThreshold,
  analyzeContent,
  analyzeLineArt,
  autoCropRaster,
};
