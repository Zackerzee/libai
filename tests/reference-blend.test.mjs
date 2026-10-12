import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { referenceBlend, referenceLayout } from '../services/reference-layer-service.js';

const source = readFileSync(new URL('../ui/canvas-renderer.js', import.meta.url), 'utf8').replace(/^import .*;$/gm, '').replace(/export /g, '');
function render({ mode = 'pattern', opacity = 40, loaded = true, visible = true, displayMode = 'composite', highlighted = '' } = {}) {
  const records = [], images = [], canvases = [];
  const makeContext = name => {
    const target = { globalAlpha: 1, stack: [], save() { this.stack.push(this.globalAlpha); }, restore() { this.globalAlpha = this.stack.pop(); } };
    return new Proxy(target, { get(obj, key) { if (key in obj) return obj[key]; return (...args) => { if (['fillRect', 'fill', 'fillText', 'drawImage'].includes(key)) records.push({ name, key, alpha: obj.globalAlpha, args }); }; } });
  };
  const grid = [[{ code: 'A01', paletteId: 'mard:A01', rgb: [240, 200, 100] }, null]];
  const before = JSON.stringify(grid);
  const result = { grid, width: 2, height: 1, sourceUrl: 'source.png' };
  const view = { mode, zoom: 1, showCodes: true, showGrid: false, showMajorGrid: false, showCoordinates: false };
  const editor = { highlightedPaletteId: highlighted, textLayers: [] };
  const container = { clientWidth: 200, clientHeight: 100, append(canvas) { canvases.push(canvas); } };
  const context = vm.createContext({
    referenceBlend, referenceLayout, BASE_CELL: 20,
    resolveScreenRenderPolicy: () => ({ showCodes: true, showGrid: false }),
    paletteIdOf: color => color.paletteId, selectionContains: () => false,
    getComputedStyle: () => ({ backgroundColor: 'rgb(245,245,248)' }),
    performance: { now: () => 0 }, requestAnimationFrame: () => {}, clearTimeout,
    window: { devicePixelRatio: 1, location: { hostname: 'example.com' } },
    ResizeObserver: class { observe() {} disconnect() {} },
    Image: class { constructor() { images.push(this); this.naturalWidth = 40; this.naturalHeight = 20; } },
    document: { createElement() { const canvas = { dataset: {}, style: {}, getContext() { return canvas.context ||= makeContext(canvas.dataset.layer); } }; return canvas; } },
  });
  vm.runInContext(source + '\nthis.createRenderer = createCanvasRenderer;', context);
  const renderer = context.createRenderer(container, { origin: () => ({ x: 0, y: 0 }), gridToScreen: (x, y) => ({ x: x * 20, y: y * 20 }) }, () => result, () => view, () => editor, () => ({ url: 'reference.png', opacity, visible, displayMode }));
  renderer.draw();
  if (loaded) for (const image of images) image.onload();
  records.length = 0; renderer.draw();
  assert.equal(JSON.stringify(grid), before, 'render never mutates formal cells');
  return records;
}

for (const mode of ['pattern', 'beads', 'blocks']) for (const opacity of [0, 40, 100]) {
  test(`${mode} loaded reference ${opacity}% complements artwork opacity`, () => {
    const records = render({ mode, opacity });
    const base = records.filter(r => r.name === 'base' && ['fillRect', 'fill'].includes(r.key));
    assert.ok(base.length);
    assert.equal(base[0].alpha, 1 - opacity / 100);
    const reference = records.filter(r => r.name === 'reference' && r.key === 'drawImage');
    assert.equal(reference.length, opacity ? 1 : 0);
    if (opacity) {
      assert.equal(reference[0].alpha, 1);
      assert.equal((1 - base[0].alpha) * reference[0].alpha, opacity / 100, 'composited reference weight must be linear');
    }
    const codes = records.filter(r => r.name === 'codes' && r.key === 'fillText');
    if (mode !== 'blocks') assert.equal(codes[0].alpha, 1 - opacity / 100);
  });
}
for (const settings of [{ loaded: false }, { visible: false }, { displayMode: 'grid-only' }]) {
  test(`unavailable reference does not hide artwork: ${JSON.stringify(settings)}`, () => {
    const records = render({ opacity: 100, ...settings });
    assert.equal(records.find(r => r.name === 'base' && r.key === 'fillRect').alpha, 1);
    assert.equal(records.filter(r => r.name === 'reference').length, 0);
  });
}
test('highlight and null placeholders both retain complementary opacity', () => {
  const fills = render({ highlighted: 'other', opacity: 40 }).filter(r => r.name === 'base' && r.key === 'fillRect');
  assert.equal(fills[0].alpha, .6 * .2);
  assert.equal(fills[1].alpha, .6);
});
test('reference-only hides artwork only after reference loads', () => {
  assert.equal(render({ displayMode: 'reference-only' }).filter(r => r.name === 'base').length, 0);
  assert.ok(render({ displayMode: 'reference-only', loaded: false }).some(r => r.name === 'base'));
});
test('original mode remains source-only and fully opaque', () => {
  const records = render({ mode: 'original', opacity: 100 });
  assert.equal(records.filter(r => r.name === 'reference').length, 0);
  assert.equal(records.find(r => r.name === 'base' && r.key === 'drawImage').alpha, 1);
});
