import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
function setup({ image = 'source.png', url = '', visible = false, useSource = false } = {}) {
  const state = { source: { image }, reference: { url, visible, useSource, opacity: 40, fit: 'contain', scale: 1 } };
  const nodes = new Map();
  const $ = selector => {
    if (!nodes.has(selector)) nodes.set(selector, { addEventListener: (_event, fn) => { nodes.get(selector).change = fn; } });
    return nodes.get(selector);
  };
  const context = vm.createContext({ $, get: () => state, store: { setState: patch => Object.assign(state.reference, patch.reference) } });
  const syncStart = source.indexOf('  const syncReferenceUi =');
  const syncEnd = source.indexOf('  $("#ws-ref-pick").addEventListener', syncStart);
  vm.runInContext(source.slice(syncStart, syncEnd) + '\nsyncReferenceUi();', context);
  const changeStart = source.indexOf('  $("#ws-ref-visible").addEventListener("change"');
  const changeEnd = source.indexOf('\n\n', changeStart);
  vm.runInContext(source.slice(changeStart, changeEnd), context);
  return { state, nodes, sync: () => vm.runInContext('syncReferenceUi();', context), toggle: value => nodes.get('#ws-ref-visible').change({ target: { checked: value } }) };
}

test('reference starts unchecked but can be enabled from the current source', () => {
  const stateSource = readFileSync(new URL('../state/store.js', import.meta.url), 'utf8');
  assert.match(stateSource, /referenceState:\s*\{\s*url: "", opacity: 40, fit: "contain", visible: false/);
  const ui = setup();
  assert.equal(ui.nodes.get('#ws-ref-visible').checked, false);
  assert.equal(ui.nodes.get('#ws-ref-visible').disabled, false);
  ui.toggle(true); ui.sync();
  assert.equal(ui.state.reference.visible, true);
  assert.equal(ui.state.reference.useSource, true);
  assert.equal(ui.nodes.get('#ws-ref-visible').checked, true);
  ui.toggle(false); ui.sync();
  assert.equal(ui.state.reference.visible, false);
  assert.equal(ui.nodes.get('#ws-ref-visible').disabled, false);
});

test('a separately uploaded reference remains the selected source', () => {
  const ui = setup({ url: 'separate.png' }); ui.toggle(true);
  assert.equal(ui.state.reference.url, 'separate.png');
  assert.equal(ui.state.reference.useSource, false);
  assert.equal(ui.state.reference.visible, true);
});

test('empty work has no reference to show, while upload remains available', () => {
  const ui = setup({ image: '' });
  assert.equal(ui.nodes.get('#ws-ref-visible').disabled, true);
  assert.equal(ui.nodes.has('#ws-ref-pick'), false, 'availability sync must not disable upload');
});
