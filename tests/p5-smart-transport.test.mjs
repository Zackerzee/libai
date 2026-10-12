import { test } from 'node:test';
import assert from 'node:assert/strict';
import { encodeGenerationResult, encodeSmartToleranceCaptureResult, decodeSmartToleranceCaptureResult } from '../services/generation-result-codec.mjs';
import { createGenerationWorkerClient } from '../services/generation-worker-client.mjs';

function fixture(width = 3, height = 2) {
  const a = { code: 'A01', paletteId: 'brand-a/A01', rgb: [1, 2, 3], hex: '#010203', name: 'first', extra: { protected: true } };
  const b = { ...a, paletteId: 'brand-b/A01', name: 'second' };
  const grid = Array.from({ length: height }, () => Array.from({ length: width }, (_, x) => x % 3 === 0 ? a : x % 3 === 1 ? b : null));
  return { ok: true, requestId: 1, width, height, grid,
    diagnostics: { smartToleranceBaselineCapture: { grid, palette: [a, b], protection: new Float32Array(width * height), baselineRevision: 'revision', algorithmVersion: 'version' } } };
}

test('P5 capture transport preserves every metadata field, brand identity and evidence', async () => {
  const original = fixture();
  const compact = encodeSmartToleranceCaptureResult(original);
  assert.equal(compact.grid, undefined);
  assert.equal(compact.diagnostics.smartToleranceBaselineCapture.grid, undefined);
  assert.equal(compact.cells.length, 2);
  const wire = structuredClone(compact, { transfer: [compact.indices.buffer] });
  const decoded = await decodeSmartToleranceCaptureResult(wire);
  assert.deepEqual(decoded.diagnostics.smartToleranceBaselineCapture, original.diagnostics.smartToleranceBaselineCapture);
  assert.equal(decoded.grid, null);
  decoded.diagnostics.smartToleranceBaselineCapture.grid[0][0].extra.protected = false;
  assert.equal(decoded.diagnostics.smartToleranceBaselineCapture.grid[1][0].extra.protected, true);
});

test('P5 ordinary disabled generation retains exact legacy codec', () => {
  const original = fixture();
  original.diagnostics = { timing: 1 };
  assert.deepEqual(encodeSmartToleranceCaptureResult(original), encodeGenerationResult(original));
});

test('P5 capture decode yields and rejects stale revision before completion', async () => {
  let current = true;
  let yields = 0;
  await assert.rejects(decodeSmartToleranceCaptureResult(encodeSmartToleranceCaptureResult(fixture(100, 100)), {
    chunkCells: 100, isCurrent: () => current,
    yieldTask: async () => { yields += 1; current = false; },
  }), { name: 'AbortError' });
  assert.equal(yields, 1);
});

test('P5 client cancelled during async decode cannot settle replacement request', async () => {
  const workers = [];
  class FakeWorker {
    constructor() { workers.push(this); }
    postMessage() {}
    terminate() {}
  }
  const client = createGenerationWorkerClient({ WorkerCtor: FakeWorker });
  const first = client.run({ requestId: 1 });
  const rejected = assert.rejects(first, { name: 'StaleGenerationError' });
  const decoding = workers[0].onmessage({ data: { type: 'result', requestId: 1, envelope: encodeSmartToleranceCaptureResult(fixture(100, 100)) } });
  const second = client.run({ requestId: 2 });
  const ordinary = encodeGenerationResult({ ok: true, requestId: 2, width: 1, height: 1, grid: [[{ code: 'B', rgb: [3, 2, 1] }]] });
  await workers[1].onmessage({ data: { type: 'result', requestId: 2, envelope: ordinary } });
  assert.equal((await second).grid[0][0].code, 'B');
  await decoding;
  await rejected;
  client.dispose();
});
