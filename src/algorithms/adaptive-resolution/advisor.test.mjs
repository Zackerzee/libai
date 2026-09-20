import test from 'node:test';
import assert from 'node:assert/strict';
import { adviseResolution, CANDIDATE_LONG_SIDES } from './advisor.mjs';

const base = { sourceWidth: 1200, sourceHeight: 800, imageAnalysis: {} };
const longSide = overrides => adviseResolution({ ...base, ...overrides }).recommendedLongSide;

test('BGS classification precedence and six requested size branches', () => {
  assert.equal(longSide({ imageAnalysis: { likelyDocument: true, likelyPhoto: true }, qualityMode: 'ultra' }), 100);
  assert.equal(longSide({ imageAnalysis: { likelyPhoto: true }, qualityMode: 'ultra' }), 160);
  assert.equal(longSide({ imageAnalysis: { likelyPhoto: true }, qualityMode: 'normal' }), 100);
  assert.equal(longSide({ imageAnalysis: { likelyLineArt: true }, qualityMode: 'ultra' }), 60);
  assert.equal(longSide({ qualityMode: 'ultra' }), 120);
  assert.equal(longSide({ qualityMode: 'normal' }), 100);
});

test('large source photo fallback overrides line art only when complexity permits', () => {
  const a = adviseResolution({ ...base, imageAnalysis: { likelyLineArt: true, quantizedColorCount: 32, flatPairRatio: 0.83 } });
  assert.equal(a.imageClass, 'photo');
  assert.equal(a.recommendedLongSide, 160);
  assert.ok(a.reasons.includes('largeSourcePhotoFallback'));
});

test('document text is not declared readable from label alone', () => {
  const advice = adviseResolution({ ...base, imageAnalysis: { likelyDocument: true, medianGlyphHeightPx: 20 } });
  assert.equal(advice.diagnostics.document.requiredTextLongSide, 240);
  assert.equal(advice.diagnostics.document.structuralOnly, true);
});

test('manual dimensions never get silently replaced, including outside baseline limit', () => {
  const advice = adviseResolution({ ...base, manualSize: { cols: 221, rows: 73 } });
  assert.deepEqual([advice.recommendedCols, advice.recommendedRows], [221, 73]);
  assert.equal(advice.diagnostics.manualOverride, true);
});

test('hybrid candidate selection needs explicit measured structure evidence', () => {
  assert.deepEqual([...CANDIDATE_LONG_SIDES], [52, 78, 104, 120, 140, 160]);
  const fallback = adviseResolution({ ...base, resolutionAdvisor: 'hybrid-v2' });
  assert.equal(fallback.recommendedLongSide, 120);
  const chosen = adviseResolution({ ...base, resolutionAdvisor: 'hybrid-v2', evaluateCandidate: ({ longSide }) => ({
    structurePreserved: longSide >= 104,
    topologyPreserved: true,
    detailPreserved: true,
  }) });
  assert.equal(chosen.recommendedLongSide, 104);
  assert.equal(chosen.diagnostics.candidates.length, 6);
});
