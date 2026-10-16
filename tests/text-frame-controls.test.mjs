import test from 'node:test';
import assert from 'node:assert/strict';
import { textFrameControls, hitTextFrameControl, resizedTextScale } from '../ui/editor-interaction.mjs';

test('text controls share screen-space geometry with the renderer', () => {
  const viewport = { origin: () => ({ cell: 2 }), gridToScreen: (x, y) => ({ x: x * 2 + 10, y: y * 2 + 20 }) };
  const frame = textFrameControls({ x0: 3, y0: 4, width: 20, height: 10 }, viewport);
  assert.deepEqual(frame, { x: 16, y: 28, width: 40, height: 20, move: { x: 36, y: 12 }, resize: { x: 56, y: 48 } });
  assert.equal(hitTextFrameControl(frame, frame.resize), 'resize');
  assert.equal(hitTextFrameControl(frame, frame.move), 'move');
  assert.equal(hitTextFrameControl(frame, { x: 200, y: 200 }), null);
  assert.equal(hitTextFrameControl(null, { x: 0, y: 0 }), null);
});

test('resize is proportional and supports the expanded text scale bounds', () => {
  const anchor = { x: 0, y: 0 }, start = { x: 30, y: 40 };
  assert.equal(resizedTextScale(100, start, { x: 60, y: 80 }, anchor), 200);
  assert.equal(resizedTextScale(100, start, anchor, anchor), 10);
  assert.equal(resizedTextScale(100, start, { x: 600, y: 800 }, anchor), 2000);
  assert.ok(Number.isFinite(resizedTextScale(100, anchor, anchor, anchor)));
});
