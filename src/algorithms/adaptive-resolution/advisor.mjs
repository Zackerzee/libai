/**
 * Read-only resolution advice. Not connected to the production generator.
 * `bead-grid-studio` reproduces its documented classification/size decisions
 * for benchmarking; `hybrid-v2` requires measured candidate evidence.
 */

export const CANDIDATE_LONG_SIDES = Object.freeze([52, 78, 104, 120, 140, 160]);

function finitePositive(value, label) {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError(`${label} must be positive`);
  return value;
}

function gridForLongSide(sourceWidth, sourceHeight, longSide) {
  const width = finitePositive(sourceWidth, 'sourceWidth');
  const height = finitePositive(sourceHeight, 'sourceHeight');
  const side = Math.min(160, Math.max(4, Math.round(finitePositive(longSide, 'longSide'))));
  const cols = width >= height ? side : Math.max(4, Math.round(side * width / height));
  const rows = height > width ? side : Math.max(4, Math.round(side * height / width));
  return { cols, rows, ratioLimited: Math.min(cols, rows) === 4 };
}

function classify(analysis, sourceWidth, sourceHeight) {
  const document = analysis?.likelyDocument === true;
  const explicitPhoto = analysis?.likelyPhoto === true;
  const photoFallback = Math.max(sourceWidth, sourceHeight) >= 1200
    && (analysis?.quantizedColorCount ?? 0) >= 32
    && (analysis?.flatPairRatio ?? 1) < 0.84;
  const photo = !document && (explicitPhoto || photoFallback);
  const lineArt = !document && !photo && analysis?.likelyLineArt === true;
  return {
    imageClass: document ? 'document' : photo ? 'photo' : lineArt ? 'lineArt' : 'other',
    photoFallback,
  };
}

function baselineSide(imageClass, qualityMode) {
  if (imageClass === 'document') return 100;
  if (imageClass === 'photo') return qualityMode === 'ultra' ? 160 : 100;
  if (imageClass === 'lineArt') return 60;
  return qualityMode === 'ultra' ? 120 : 100;
}

function documentReadability(analysis, sourceWidth, sourceHeight, longSide) {
  const glyph = analysis?.medianGlyphHeightPx;
  const requiredTextLongSide = Number.isFinite(glyph) && glyph > 0
    ? Math.ceil(4 * Math.max(sourceWidth, sourceHeight) / glyph) : null;
  const textReadable = requiredTextLongSide !== null && requiredTextLongSide <= longSide;
  return { requiredTextLongSide, textReadable, structuralOnly: !textReadable };
}

function confidenceProxy(analysis, imageClass) {
  // Local diagnostic only: upstream does not return a classifier confidence.
  if (!analysis) return 0;
  if (imageClass === 'document') return Math.max(0, Math.min(1, analysis.documentScore ?? 0));
  if (imageClass === 'photo') {
    const colors = Math.max(0, Math.min(1, ((analysis.quantizedColorCount ?? 0) - 32) / 64));
    const texture = Math.max(0, Math.min(1, (0.84 - (analysis.flatPairRatio ?? 1)) / 0.32));
    return Math.round((colors + texture) * 50) / 100;
  }
  return imageClass === 'lineArt' ? 0.5 : 0.25;
}

/**
 * @param {object} input
 * @param {object} input.imageAnalysis output/summary of upstream image analysis
 * @param {number} input.sourceWidth post-crop, post-orientation source width
 * @param {number} input.sourceHeight post-crop, post-orientation source height
 * @param {string} [input.qualityMode='ultra'] only `ultra` selects ultra sizes
 * @param {'bead-grid-studio'|'hybrid-v2'} [input.resolutionAdvisor]
 * @param {{cols:number,rows:number}|null} [input.manualSize] always wins, unmodified
 * @param {(candidate:object)=>object} [input.evaluateCandidate] low-cost, pure pre-evaluator
 */
export function adviseResolution(input) {
  const {
    imageAnalysis = {}, sourceWidth, sourceHeight, qualityMode = 'ultra',
    resolutionAdvisor = 'bead-grid-studio', manualSize = null, evaluateCandidate,
  } = input ?? {};
  finitePositive(sourceWidth, 'sourceWidth');
  finitePositive(sourceHeight, 'sourceHeight');
  if (!['bead-grid-studio', 'hybrid-v2'].includes(resolutionAdvisor)) throw new RangeError('unknown resolutionAdvisor');
  const classification = classify(imageAnalysis, sourceWidth, sourceHeight);
  const baseline = baselineSide(classification.imageClass, qualityMode);
  const candidates = CANDIDATE_LONG_SIDES.map(longSide => {
    const grid = gridForLongSide(sourceWidth, sourceHeight, longSide);
    const assessment = typeof evaluateCandidate === 'function'
      ? evaluateCandidate({ longSide, ...grid, imageClass: classification.imageClass }) : null;
    return { longSide, ...grid, assessment: assessment ?? null };
  });
  // A candidate is usable only if an independent pre-evaluator explicitly says so.
  // No surrogate quality score is fabricated from category labels.
  const viable = candidates.filter(candidate => candidate.assessment?.structurePreserved === true
    && candidate.assessment?.topologyPreserved === true
    && candidate.assessment?.detailPreserved === true);
  const selected = resolutionAdvisor === 'hybrid-v2' && viable.length
    ? viable[0].longSide : baseline;
  const manual = manualSize !== null;
  if (manual && (!Number.isInteger(manualSize?.cols) || manualSize.cols < 1
    || !Number.isInteger(manualSize?.rows) || manualSize.rows < 1)) {
    throw new RangeError('manualSize requires positive integer cols and rows');
  }
  const grid = manual ? { cols: manualSize.cols, rows: manualSize.rows }
    : gridForLongSide(sourceWidth, sourceHeight, selected);
  const longSide = Math.max(grid.cols, grid.rows);
  const document = classification.imageClass === 'document'
    ? documentReadability(imageAnalysis, sourceWidth, sourceHeight, longSide) : null;
  const reasons = [
    `imageClass:${classification.imageClass}`,
    `qualityMode:${qualityMode}`,
    `baselineLongSide:${baseline}`,
  ];
  if (classification.photoFallback) reasons.push('largeSourcePhotoFallback');
  if (resolutionAdvisor === 'hybrid-v2') reasons.push(viable.length ? 'minimumMeasuredViableCandidate' : 'noMeasuredViableCandidate;baselineFallback');
  if (manual) reasons.push('manualSizePreserved');
  if (document?.structuralOnly) reasons.push('documentStructureOnly;textNotProvenReadable');
  return {
    recommendedLongSide: longSide,
    recommendedCols: grid.cols,
    recommendedRows: grid.rows,
    imageClass: classification.imageClass,
    reasons,
    confidence: confidenceProxy(imageAnalysis, classification.imageClass),
    diagnostics: {
      resolutionAdvisor,
      qualityMode,
      baselineLongSide: baseline,
      manualOverride: manual,
      photoFallback: classification.photoFallback,
      document,
      candidates,
      confidenceKind: 'local-proxy-not-upstream',
      qualityAssessment: document?.structuralOnly ? 'structure-only' : 'unverified',
    },
  };
}

export const AdaptiveResolutionAdvisor = Object.freeze({ adviseResolution, candidateLongSides: CANDIDATE_LONG_SIDES });
