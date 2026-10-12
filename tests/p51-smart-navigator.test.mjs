import test from 'node:test';
import assert from 'node:assert/strict';
import { Navigator, navigatorLayout, navigatorThumbnailSteps } from '../ui/navigator.js';

function bitmap() {
  const operations = [];
  const context = new Proxy({}, { get(target, key) { return key in target ? target[key] : (...args) => operations.push([key, ...args]); }, set(target, key, value) { target[key] = value; operations.push([key, value]); return true; } });
  return { operations, getContext: () => context, clientWidth: 180, clientHeight: 120, addEventListener() {} };
}

test('Smart cooperative thumbnail preserves every raster operation, overlap and draw order', () => {
  const grid = Array.from({ length: 20 }, (_, y) => Array.from({ length: 500 }, (_, x) => (x + y) % 3 ? { rgb: [x % 256, y, 40] } : null));
  const result = { grid, width: 500, height: 20 };
  const layout = navigatorLayout(500, 20, 180, 120);
  function render(chunkCells) { const steps = navigatorThumbnailSteps(result, layout, 180, 120, 2, bitmap, chunkCells); let step, yields = 0; do { step = steps.next(); if (!step.done) yields++; } while (!step.done); return { operations: step.value.operations, yields }; }
  const reference = bitmap(), ctx = reference.getContext('2d');
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.fillStyle = '#f7f8f6';
  ctx.fillRect(layout.x, layout.y, layout.width, layout.height);
  const pixel = Math.max(layout.scale, .7);
  grid.forEach((row, y) => row.forEach((color, x) => {
    if (!color) return;
    ctx.fillStyle = color.hex || `rgb(${color.rgb.join(',')})`;
    ctx.fillRect(layout.x + x * layout.scale, layout.y + y * layout.scale, pixel, pixel);
  }));
  ctx.strokeStyle = 'rgba(33, 48, 58, .28)';
  ctx.lineWidth = 1;
  ctx.strokeRect(layout.x + .5, layout.y + .5, Math.max(0, layout.width - 1), Math.max(0, layout.height - 1));
  const chunked = render(2048);
  assert.deepEqual(chunked.operations, reference.operations);
  assert.equal(chunked.yields, 4);
  assert.ok(chunked.operations.some(op => op[0] === 'fillRect' && op[3] === .7 && op[4] === .7));
});

test('Smart thumbnail coalesces and rejects stale grid, layout, DPR and destroyed jobs', async () => {
  const old = { document: globalThis.document, window: globalThis.window, ResizeObserver: globalThis.ResizeObserver, requestAnimationFrame: globalThis.requestAnimationFrame };
  const canvas = bitmap(), frames = [];
  globalThis.document = { createElement: bitmap };
  globalThis.window = { devicePixelRatio: 1 };
  globalThis.ResizeObserver = class { observe() {} disconnect() {} };
  globalThis.requestAnimationFrame = fn => frames.push(fn);
  let revision = 1, result = { width: 100, height: 100, grid: Array.from({ length: 100 }, () => Array.from({ length: 100 }, () => ({ rgb: [20, 30, 40] }))) };
  const host = { classList: { add() {} }, querySelector: () => canvas };
  const nav = Navigator({ host, getResult: () => result, getView: () => ({ zoom: 1, panX: 0, panY: 0 }), getViewportSize: () => ({ width: 300, height: 300 }), getGridRevision: () => revision, getCooperativeRevision: () => revision, onNavigate() {} });
  const wait = () => new Promise(resolve => setTimeout(resolve, 30));
  try {
    nav.draw(); nav.draw(); revision++; result = { ...result, grid: result.grid.slice() }; await wait(); assert.equal(nav.thumbnailRenderCount, 0);
    nav.draw(); canvas.clientWidth++; await wait(); assert.equal(nav.thumbnailRenderCount, 0);
    nav.draw(); window.devicePixelRatio = 2; await wait(); assert.equal(nav.thumbnailRenderCount, 0);
    nav.draw(); nav.draw(); await wait(); assert.equal(nav.thumbnailRenderCount, 1); assert.equal(frames.length, 1);
    frames.shift()(); assert.equal(nav.thumbnailRenderCount, 1); assert.equal(canvas.operations.filter(op => op[0] === 'drawImage').length, 1);
    nav.invalidateThumbnail(); nav.draw(); nav.destroy(); await wait(); assert.equal(nav.thumbnailRenderCount, 1);
  } finally { Object.assign(globalThis, old); }
});
