import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createProjectStore } from '../state/project-store.js';

const source = await readFile(new URL('../app.js', import.meta.url), 'utf8');
const buildBody = source.split('  buildProjectJson() {')[1].split('\n  downloadProjectJson(')[0].replace(/\n  },\s*$/, '');
const loadBody = source.split('  loadProjectJson(source) {')[1].split('\n  getChecks:')[0].replace(/\n  },\s*$/, '');

test('creator nickname survives actual project JSON build and load without changing the name or grid', () => {
  const store = createProjectStore();
  const previousWindow = globalThis.window;
  globalThis.window = { libmsStore: store.__target() };
  // Project adapter and legacy bridge share the same backing store.
  store.setState({ project: { creator: '小豆匠' } });
  const color = { code: 'A1', rgb: [1, 2, 3], hex: '#010203' };
  const state = { grid: [[color]], width: 1, height: 1, stats: [{ ...color, count: 1 }], sourceName: '作品.png' };
  const els = { maxColorsInput: { value: '1' } };
  const build = new Function('state', 'els', 'getSchemeName', 'getCurrentPaletteKey', 'getCurrentPaletteLabel', 'hexFromRgb', buildBody);
  const load = new Function('source', 'state', 'els', 'getCurrentPalette', 'cloneColor', 'applySourceDimensions', loadBody);
  const bridge = { replaceGridStructure({ grid }) { state.grid = grid; return true; }, getResult() { return state; } };
  try {
    const payload = build(state, els, () => '作品', () => 'mard', () => 'MARD', () => '#010203');
    assert.equal(payload.metadata.creator, '小豆匠');
    assert.equal(payload.projectName, '作品');
    store.setState({ project: { creator: '另一人' } });
    load.call(bridge, JSON.stringify(payload), state, els, () => [color], value => ({ ...value }), () => {});
    assert.equal(store.getState().project.creator, '小豆匠');
    assert.deepEqual(state.grid, [[color]]);
    delete payload.metadata;
    load.call(bridge, payload, state, els, () => [color], value => ({ ...value }), () => {});
    assert.equal(store.getState().project.creator, '');
    assert.equal(build(state, els, () => '作品', () => 'mard', () => 'MARD', () => '#010203').metadata, undefined);
  } finally { globalThis.window = previousWindow; }
});
