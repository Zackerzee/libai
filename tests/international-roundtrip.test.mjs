import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const hama = { code: 'H01', paletteId: 'hama:H01', rgb: [229, 236, 241], hex: '#e5ecf1' };
const mard = { code: 'H01', rgb: [1, 2, 3], hex: '#010203' };
const extract = (name, next) => source.slice(source.indexOf(`function ${name}(`), source.indexOf(`function ${next}(`));

function harness() {
  const context = vm.createContext({
    state: { grid: [[hama, mard, null]], width: 3, height: 1, stats: [], sourceName: 'example.png' },
    els: { maxColorsInput: { value: '2' } },
    getSchemeName: () => '', getCurrentPaletteKey: () => 'mard-291', getCurrentPaletteLabel: () => 'MARD',
    getCurrentPalette: () => [mard], applySourceDimensions: () => {},
    rgbToHex: rgb => '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''),
    hexFromRgb: rgb => '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''),
    colorFromHex: (code, hex) => ({ code, hex, rgb: hex.slice(1).match(/../g).map(v => parseInt(v, 16)) }),
  });
  vm.runInContext(extract('cloneColor', 'rgb'), context);
  vm.runInContext(extract('calculateStats', 'applyFinalPaletteBudget'), context);
  vm.runInContext(extract('serializeGridForLibrary', 'findColorByCode'), context);
  const build = source.slice(source.indexOf('  buildProjectJson() {'), source.indexOf('  downloadProjectJson('));
  const load = source.slice(source.indexOf('  loadProjectJson(source) {'), source.indexOf('  getChecks:'));
  vm.runInContext(`globalThis.bridge = {${build}${load} replaceGridStructure({grid,width,height}) { state.grid=grid; state.width=width; state.height=height; return true; }, getResult() { return state.grid; } }; state.stats = calculateStats(state.grid);`, context);
  return context;
}
const plain = value => JSON.parse(JSON.stringify(value));

test('same-code mixed brands retain separate statistics and color identity', () => {
  const context = harness();
  assert.equal(context.state.stats.length, 2);
  assert.equal(context.sameColor(hama, mard), false);
  assert.equal(context.sameColor(hama, { ...hama }), true);
  assert.equal(context.sameColor(mard, { ...mard }), true);
  assert.equal(context.sameColor(null, null), true);
});

test('project JSON preserves branded RGB and identity across a different active palette', () => {
  const context = harness();
  const payload = context.bridge.buildProjectJson();
  assert.deepEqual(plain(payload.grid), [['H01', 'H01', null]]);
  assert.deepEqual(plain(payload.gridPaletteIds), [['hama:H01', null, null]]);
  context.bridge.loadProjectJson(JSON.stringify(payload));
  assert.deepEqual(plain(context.state.grid[0][0]), { ...hama, name: '' });
  assert.deepEqual(plain(context.state.grid[0][1]), mard);
});

test('project JSON round-trips editable text layer properties and lock state', () => {
  const context = harness();
  const objects = [{ id: 'text-1', text: '第一行\\n第二行', fontFamily: '本地字体', scale: 640, rotation: 37, locked: true }];
  let restored;
  context.window = { libmsStore: { get: (_ns, key) => key === 'textLayers' ? objects : null, patchState: (_ns, patch) => { restored = patch.textLayers; } } };
  const payload = context.bridge.buildProjectJson();
  assert.deepEqual(plain(payload.textObjects), objects);
  context.bridge.loadProjectJson(payload);
  assert.deepEqual(plain(restored), objects);
});

test('legacy project color codes still prioritize the active palette', () => {
  const context = harness();
  const payload = context.bridge.buildProjectJson();
  payload.colors = [{ code: 'H01', rgb: [90, 90, 90], hex: '#5a5a5a' }];
  payload.grid = [['H01', 'H01', null]];
  delete payload.gridPaletteIds;
  context.bridge.loadProjectJson(payload);
  assert.deepEqual(plain(context.state.grid[0][0]), mard);
});

test('project JSON restores template locks and rejects malformed masks before replacing the document', () => {
  const context = harness();
  let mask = [[true, false, false]];
  context.window = { libmsStore: {
    get: (ns, key) => ns === 'patternState' && key === 'templateLockedMask' ? mask : null,
    patchState: (ns, patch) => { if (ns === 'patternState') mask = patch.templateLockedMask; },
  } };
  const payload = context.bridge.buildProjectJson();
  assert.deepEqual(plain(payload.templateLockedMask), mask);
  mask = null;
  context.bridge.loadProjectJson(payload);
  assert.deepEqual(plain(mask), [[true, false, false]]);
  const before = plain(context.state);
  assert.throws(() => context.bridge.loadProjectJson({ ...payload, templateLockedMask: [[true]] }), /锁定区域无效/);
  assert.deepEqual(plain(context.state), before);
  delete payload.templateLockedMask;
  context.bridge.loadProjectJson(payload);
  assert.equal(mask, null);
});

test('library round-trip preserves optional identity and accepts legacy tokens', () => {
  const context = harness();
  const gridData = context.serializeGridForLibrary(context.state.grid);
  assert.equal(gridData, 'H01|#e5ecf1|hama:H01,H01|#010203,.');
  const restored = context.deserializeGridFromLibrary({ gridData });
  assert.deepEqual(plain(restored), [[hama, mard, null]]);
  assert.deepEqual(plain(context.deserializeGridFromLibrary({ gridData: 'H01|#010203,.' })), [[mard, null]]);
});
