/** Experimental structural calibration; neither semantic recognition nor probability. */
import { analyzeGenerationImage } from './generation-pipeline.mjs';
import { classifySource } from './source-classifier.mjs';

export function analyzeLocalFusionEvidence(image) {
  const classified = classifySource(image);
  return { ...analyzeGenerationImage(image), routing: classified.routing, fusionSignals: classified.signals };
}

// Narrow calibration envelope. Magnification is handled by the existing confidence gate.
// Thick, low-texture, few-color raster artwork only: textured signs and thin strokes fall back.
export function evaluateLocalFlatStructure(signals) {
  const s = signals ?? {};
  const checks = {
    fewCoverageColors: Number.isFinite(s.paletteSize95) && s.paletteSize95 >= 2 && s.paletteSize95 <= 12,
    largeConstantRegions: Number.isFinite(s.largeFlatBlockRatio) && s.largeFlatBlockRatio >= 0.70,
    lowLocalVariety: Number.isFinite(s.localColorVariety) && s.localColorVariety <= 0.12,
    lowTexture: Number.isFinite(s.highFrequencyRatio) && s.highFrequencyRatio <= 0.03,
    thickStructure: Number.isFinite(s.structureThickness) && s.structureThickness >= 0.80,
    limitedShading: Number.isFinite(s.shadingCoverage) && s.shadingCoverage <= 0.65,
    notMagnified: s.magnificationTrace === 0,
    visibleStructure: Number.isFinite(s.edgeDensity) && s.edgeDensity >= 0.005,
  };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  return { category: Object.values(checks).every(Boolean) ? 'clean-flat-structure' : 'unconfirmed-structure',
    eligible: Object.values(checks).every(Boolean), score, scoreKind: 'experimental-structural-check-fraction-not-probability', checks };
}
