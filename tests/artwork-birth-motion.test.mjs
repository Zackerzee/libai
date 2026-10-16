import test from 'node:test';
import assert from 'node:assert/strict';
import { createBirthGate, createArtworkBirthMotion } from '../ui/artwork-birth-motion.mjs';

function environment() {
  const frames = new Map(), images = [], canvases = [], listeners = new Map(); let id = 0;
  const listen = (name, fn) => listeners.set(name, fn);
  const unlisten = (name) => listeners.delete(name);
  const ctx = { setTransform() {}, clearRect() {}, save() {}, beginPath() {}, rect() {}, clip() {}, drawImage() {}, fillRect() {}, restore() {} };
  const reduced = { matches: false, addEventListener: listen, removeEventListener: unlisten };
  const win = { matchMedia: () => reduced, navigator: {}, devicePixelRatio: 2, addEventListener: listen, removeEventListener: unlisten,
    Image: class { constructor() { images.push(this); } },
    requestAnimationFrame(fn) { frames.set(++id, fn); return id; }, cancelAnimationFrame(key) { frames.delete(key); } };
  const doc = { defaultView: win, hidden: false, addEventListener: listen, removeEventListener: unlisten,
    createElement() { const c = { style: {}, setAttribute() {}, getContext: () => ctx, remove() { this.removed = true; } }; canvases.push(c); return c; } };
  const container = { ownerDocument: doc, isConnected: true, getBoundingClientRect: () => ({ width: 500, height: 400 }), appendChild() {} };
  const options = { container, getBox: () => ({ x: 10, y: 20, width: 200, height: 200 }) };
  const input = { sourceUrl: 'image', grid: [[{ hex: '#123456' }]], width: 1, height: 1 };
  function advance(now) { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(now)); }
  return { frames, images, canvases, listeners, reduced, doc, options, input, advance, ctx };
}

test('first successful generation belongs to source identity and cancellation does not consume it', () => {
  const gate = createBirthGate(); gate.newSource('one'); gate.cancel();
  assert.equal(gate.consumeSuccess('stale'), false); assert.equal(gate.consumeSuccess('one'), true);
  assert.equal(gate.consumeSuccess('one'), false); gate.newSource('two');
  assert.equal(gate.consumeSuccess('one'), false); assert.equal(gate.consumeSuccess('two'), true);
  gate.reset(); assert.equal(gate.consumeSuccess(undefined), false);
});

test('cancel during image loading settles pending play and prevents stale overlay', async () => {
  const e = environment(); const motion = createArtworkBirthMotion(e.options);
  const pending = motion.play(e.input); const staleLoad = e.images[0].onload;
  motion.cancel(); staleLoad(); assert.equal(await pending, false);
  assert.equal(e.canvases.length, 0); assert.equal(e.frames.size, 0); assert.equal(motion.isRunning, false); motion.destroy();
});

test('new play invalidates old image and final frame releases canvas and animation frame', async () => {
  const e = environment(); let finished = 0; const motion = createArtworkBirthMotion({ ...e.options, onFinish: () => finished++ });
  const old = motion.play(e.input); const current = motion.play(e.input);
  assert.equal(await old, false); e.images[1].onload(); assert.equal(await current, true);
  e.advance(0); e.advance(2900);
  assert.equal(e.frames.size, 0); assert.equal(e.canvases[0].removed, true); assert.equal(e.canvases[0].width, 0);
  assert.equal(motion.isRunning, false); assert.equal(finished, 2); motion.destroy(); assert.equal(e.listeners.size, 0);
  assert.equal(e.canvases[1].width, 0);
});

test('completed grid is read once for target raster and never traversed inside animation frames', async () => {
  const e = environment(); let reads = 0;
  const row = new Proxy([{ hex: '#123456' }, null], { get(target, key) { if (key === '0' || key === '1') reads++; return target[key]; } });
  const motion = createArtworkBirthMotion(e.options);
  const pending = motion.play({ ...e.input, grid: [row], width: 2 }); e.images[0].onload(); await pending;
  const initial = reads; e.advance(0); e.advance(1700); e.advance(1900);
  assert.equal(reads, initial); motion.cancel(); assert.equal(e.canvases[1].width, 0); motion.destroy();
});

test('canvas drawing failure cancels overlay and scheduled frames without rejecting generation', async () => {
  const e = environment(); e.ctx.drawImage = () => { throw new Error('visual canvas failure'); };
  const motion = createArtworkBirthMotion(e.options);
  const pending = motion.play(e.input); e.images[0].onload(); await pending;
  assert.doesNotThrow(() => e.advance(0)); assert.equal(motion.isRunning, false);
  assert.equal(e.frames.size, 0); assert.equal(e.canvases[0].removed, true); assert.equal(e.canvases[1].width, 0); motion.destroy();
});

test('target raster preserves exact colors and blank cells at one pixel per bead', async () => {
  const e = environment(), painted = [];
  e.ctx.fillRect = (...box) => painted.push({ box, color: e.ctx.fillStyle });
  const motion = createArtworkBirthMotion(e.options);
  const pending = motion.play({ sourceUrl: 'image', grid: [[{ hex: '#123456' }, null, { rgb: [12, 34, 56] }]], width: 3, height: 1 });
  e.images[0].onload(); await pending;
  assert.equal(e.canvases[1].width, 3); assert.equal(e.canvases[1].height, 1);
  assert.deepEqual(painted, [{ box: [0, 0, 1, 1], color: '#123456' }, { box: [2, 0, 1, 1], color: 'rgb(12,34,56)' }]);
  motion.destroy();
});

test('initial ResizeObserver callback and identical-size callback preserve first animation', async () => {
  const e = environment(); let observerCallback, disconnected = false;
  e.doc.defaultView.ResizeObserver = class {
    constructor(callback) { observerCallback = callback; }
    observe() { observerCallback(); }
    disconnect() { disconnected = true; }
  };
  const motion = createArtworkBirthMotion(e.options);
  const pending = motion.play(e.input); observerCallback();
  assert.equal(motion.isRunning, true);
  e.images[0].onload(); assert.equal(await pending, true); observerCallback();
  assert.equal(motion.isRunning, true);
  e.options.container.getBoundingClientRect = () => ({ width: 510, height: 400 }); observerCallback();
  assert.equal(motion.isRunning, false); motion.destroy(); assert.equal(disconnected, true);
});

test('completion callback error never escapes cancel', async () => {
  const e = environment(); const motion = createArtworkBirthMotion({ ...e.options, onFinish() { throw new Error('callback'); } });
  const pending = motion.play(e.input); assert.doesNotThrow(() => motion.cancel());
  assert.equal(await pending, false); motion.destroy();
});

test('reduced motion skips loading; hidden document immediately cancels drawing', async () => {
  const e = environment(); const motion = createArtworkBirthMotion(e.options);
  e.reduced.matches = true; assert.equal(await motion.play(e.input), false); assert.equal(e.images.length, 0);
  e.reduced.matches = false; const pending = motion.play(e.input); e.images[0].onload(); await pending;
  e.doc.hidden = true; e.listeners.get('visibilitychange')(); assert.equal(e.frames.size, 0); assert.equal(motion.isRunning, false);
  motion.destroy();
});

test('display tiles stay clearly sized independently of production grid resolution', async () => {
  const capture = async resolution => {
    const e = environment(), patches = [];
    e.options.getBox = () => ({ x: 0, y: 0, width: 334, height: 334 });
    e.ctx.drawImage = (...args) => { if (args.length === 9) patches.push(args); };
    const grid = Array.from({ length: resolution }, () => Array(resolution).fill({ hex: '#ff0000' }));
    const motion = createArtworkBirthMotion(e.options);
    const pending = motion.play({ sourceUrl: 'image', grid, width: resolution, height: resolution });
    e.images[0].onload(); await pending; e.advance(0); e.advance(1100);
    assert.ok(patches.length > 100);
    assert.ok(patches.every(args => args[7] >= 11 && args[8] >= 11));
    const dimensions = patches.map(args => args.slice(5));
    motion.destroy(); return dimensions;
  };
  assert.deepEqual(await capture(104), await capture(200));
});

test('moving tiles cover complete cached production raster and final reveal is exact', async () => {
  const e = environment(), draws = [];
  e.ctx.drawImage = (...args) => draws.push(args);
  const motion = createArtworkBirthMotion(e.options);
  const pending = motion.play({ ...e.input, width: 104, height: 104,
    grid: Array.from({ length: 104 }, () => Array(104).fill({ hex: '#00ff00' })) });
  e.images[0].onload(); await pending; e.advance(0); e.advance(2150);
  const target = e.canvases[1], tiles = draws.filter(args => args.length === 9);
  assert.equal(tiles.length, 16 * 16);
  assert.equal(Math.min(...tiles.map(args => args[1])), 0);
  assert.equal(Math.max(...tiles.map(args => args[1] + args[3])), 104);
  assert.equal(Math.max(...tiles.map(args => args[2] + args[4])), 104);
  e.advance(2750);
  assert.ok(draws.some(args => args.length === 5 && args[0] === target && args.slice(1).join() === '10,20,200,200'));
  e.advance(2900); assert.equal(motion.isRunning, false); assert.equal(target.width, 0);
  motion.destroy();
});
