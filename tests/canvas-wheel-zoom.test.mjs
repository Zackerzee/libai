import test from 'node:test';
import assert from 'node:assert/strict';
import {canvasWheelZoomFactor} from '../ui/canvas-wheel-zoom.mjs';
test('ordinary canvas wheel reverses prior direction',()=>{
  assert.ok(canvasWheelZoomFactor({deltaY:100})>1);
  assert.ok(canvasWheelZoomFactor({deltaY:-100})<1);
  assert.equal(canvasWheelZoomFactor({deltaY:0}),1);
});
test('pinch direction retained and wheel units normalized',()=>{
  assert.ok(canvasWheelZoomFactor({deltaY:-100,ctrlKey:true})>1);
  assert.equal(canvasWheelZoomFactor({deltaY:1,deltaMode:1}),canvasWheelZoomFactor({deltaY:16}));
  assert.ok(Number.isFinite(canvasWheelZoomFactor({deltaY:1e10})));
});
