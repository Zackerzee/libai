import test from 'node:test';
import assert from 'node:assert/strict';
import { rgbToLab } from '../smart-preprocessing/palette-engine.mjs';
import { candidateCost, resolveToleranceLimits, buildLocalContrastReference, validateContrastReference,
  validateLocalContrast, measureToleranceQuality } from '../services/smart-color-tolerance-quality.mjs';

const color = (code, rgb) => ({ code, rgb });
const black = color('H07', [0, 0, 0]), white = color('H02', [255, 255, 255]);
test('candidate distance uses original CIEDE2000 reference pair', () => {
  const cost = candidateCost([50, 2.6772, -79.7751], [50, 0, -82.7485]);
  assert.equal(cost.deltaE.toFixed(4), '2.0425');
  assert.equal(cost.deltaL, 0);
});
test('candidate gates include direct brightness difference', () => {
  const cost = candidateCost(rgbToLab(black.rgb), rgbToLab(white.rgb));
  assert.ok(cost.cost > 1); assert.ok(cost.deltaL > 90);
});
test('quality limits are immutable and invalid options fail closed', () => {
  assert.ok(Object.isFrozen(resolveToleranceLimits()));
  for (const overrides of [{ maxDeltaE: 0 }, { maxDeltaL: -1 }, { minContrastRatio: 2 }, { maxContrastLoss: NaN }, { unknown: 4 }]) {
    assert.throws(() => resolveToleranceLimits(overrides), RangeError);
  }
});
test('local boundary collapse and brightness reversal are rejected', () => {
  const baseline = [[black, white]];
  assert.equal(validateLocalContrast(baseline, [[black, black]]).valid, false);
  const reversed = validateLocalContrast(baseline, [[white, black]]);
  assert.ok(reversed.reasons.some(reason => reason.code === 'LIGHTNESS_ORDER_CHANGED'));
});
test('contrast reference is frozen and unaffected by input mutation', () => {
  const baseline = [[color('a', [0, 0, 0]), color('b', [255, 255, 255])]];
  const reference = buildLocalContrastReference(baseline);
  baseline[0][0].rgb.fill(255);
  assert.equal(validateContrastReference(reference, [[black, white]]).valid, true);
  assert.ok(Object.isFrozen(reference.edges[0]));
});
test('identity quality has zero differences and retains nulls', () => {
  const baseline = [[black, null, white]];
  const metrics = measureToleranceQuality(baseline, structuredClone(baseline));
  assert.equal(metrics.meanDeltaE, 0); assert.equal(metrics.changedCells, 0);
  assert.equal(metrics.nonEmptyCells, 2); assert.equal(metrics.localContrast.valid, true);
});
test('quality metrics reject dimension and null changes', () => {
  assert.throws(() => measureToleranceQuality([[black]], [[black, black]]), RangeError);
  assert.throws(() => measureToleranceQuality([[null]], [[black]]), RangeError);
  assert.throws(() => measureToleranceQuality([[black]], [[null]]), RangeError);
});
test('empty grids have finite zero metrics', () => {
  const metrics = measureToleranceQuality([], []);
  assert.equal(metrics.meanDeltaE, 0); assert.equal(metrics.maxDeltaL, 0);
});
test('quality rejects sparse grids and prototype-name limit overrides', () => {
  assert.throws(() => buildLocalContrastReference([new Array(2)]), TypeError);
  assert.throws(() => buildLocalContrastReference(new Array(2)), TypeError);
  assert.throws(() => resolveToleranceLimits({ toString: 4 }), RangeError);
});
