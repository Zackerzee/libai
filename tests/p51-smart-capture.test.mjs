import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeGenerationResult, encodeSmartToleranceCaptureResult, decodeSmartToleranceCaptureResult } from '../services/generation-result-codec.mjs';

test('private capture omits unconsumed per-cell diagnostic graphs but preserves complete baseline evidence', async () => {
  const cell = { paletteId: 'brand:A01', code: 'A01', rgb: [10, 20, 30] };
  const evidence = { grid: [[cell]], palette: [cell], protection: new Float32Array([0.7]),
    baselineRevision: 'r1', algorithmVersion: 'v1', context: { crop: 'fixed' } };
  const input = { ok: true, requestId: 42, width: 1, height: 1, grid: [[cell]],
    diagnostics: { smartToleranceBaselineCapture: evidence, regionContexts: [[{ unused: true }]],
      samplingScoresGrid: [[{ unused: true }]], cleanupRecords: [{ unused: true }] } };
  const compact = encodeSmartToleranceCaptureResult(input);
  assert.deepEqual(Object.keys(compact.diagnostics), ['smartToleranceBaselineCapture']);
  assert.equal(compact.requestId, 42);
  const decoded = await decodeSmartToleranceCaptureResult(structuredClone(compact));
  assert.deepEqual(decoded.diagnostics.smartToleranceBaselineCapture, evidence);
  assert.equal(input.diagnostics.regionContexts[0][0].unused, true);
});

test('ordinary default-off diagnostic transport remains exactly unchanged', () => {
  const input = { ok: true, width: 1, height: 1, grid: [[null]], diagnostics: { regionContexts: [[1]] } };
  assert.deepEqual(encodeSmartToleranceCaptureResult(input), encodeGenerationResult(input));
});
