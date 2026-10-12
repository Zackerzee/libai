import test from 'node:test';
import assert from 'node:assert/strict';
import { bindSmartToleranceControls } from '../ui/smart-tolerance-controls.mjs';

test('status-only Apply preparation does not redraw the unchanged preview', () => {
  const nodes = new Map();
  class Node extends EventTarget { setAttribute() {} }
  const root = { querySelector(key) { if (!nodes.has(key)) nodes.set(key, new Node()); return nodes.get(key); } };
  const events = new EventTarget();
  const formal = [[null]], preview = [[{code:'A01',rgb:[1,2,3]}]];
  let grid = formal, status = 'idle', renders = 0;
  const bridge = { getSmartToleranceUiState: () => ({status}),
    getResult: () => ({grid:formal}), getSmartTolerancePreviewResult: () => ({grid}) };
  const controls = bindSmartToleranceControls({root,bridge,events,onPreview:()=>renders++});
  assert.equal(renders,1);
  status='ready';grid=preview;controls.paint();assert.equal(renders,2);
  status='applying';controls.paint();controls.paint();assert.equal(renders,2);
  grid=formal;status='idle';controls.paint();assert.equal(renders,3);
  controls.destroy();
});
