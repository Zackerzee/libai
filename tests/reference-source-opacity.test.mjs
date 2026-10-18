import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');

function setup(reference = {}, image = '') {
  const state = { view: { mode: 'blocks' }, source: { image }, reference: { url: '', opacity: 40, fit: 'contain', visible: false, displayMode: 'grid-only', ...reference } };
  const nodes = new Map();
  const $ = (selector) => {
    if (!nodes.has(selector)) nodes.set(selector, { classList: { toggle() {} }, setAttribute() {} });
    return nodes.get(selector);
  };
  const get = () => state;
  const predicates = source.slice(source.indexOf('  const hasReference ='), source.indexOf('  const referenceInput ='));
  const sync = source.slice(source.indexOf('  const syncReferenceUi ='), source.indexOf('  $("#ws-ref-pick").addEventListener'));
  const input = source.slice(source.indexOf('  $("#ws-ref-opacity").addEventListener("input"'), source.indexOf('  // 没有对照图时'));
  let onInput;
  $('#ws-ref-opacity').addEventListener = (_, handler) => { onInput = handler; };
  const store = { setState(patch) { for (const key of Object.keys(patch)) Object.assign(state[key], patch[key]); } };
  const syncUi = new Function('$', 'get', 'store', 'clamp', `${predicates}${sync}${input};return syncReferenceUi;`)($, get, store, (n, min, max) => Math.max(min, Math.min(max, n)));
  return { state, $, syncUi, input: value => onInput({ target: { value } }) };
}

test('default source enables and shows opacity without uploading a separate reference', () => {
  const api = setup({}, 'source.png');
  api.syncUi();
  assert.equal(api.$('#ws-top-ref-opacity').hidden, false);
  assert.equal(api.$('#ws-ref-opacity').disabled, false);
  for (const value of [0, 50, 100]) {
    api.input(value);
    assert.equal(api.state.reference.opacity, value);
    assert.equal(api.state.reference.url, '');
    assert.equal(api.state.reference.useSource, true);
    assert.equal(api.state.reference.visible, true);
    assert.equal(api.state.reference.displayMode, 'normal');
    assert.equal(api.state.view.mode, 'pattern');
  }
});

test('dragging opacity reactivates a previously disabled source reference', () => {
  const api = setup({ useSource: false }, 'source.png');
  api.input(50);
  assert.equal(api.state.reference.useSource, true);
  assert.equal(api.state.reference.visible, true);
  assert.equal(api.state.reference.displayMode, 'normal');
});

test('no image hides and disables opacity controls', () => {
  const api = setup();
  api.syncUi();
  assert.equal(api.$('#ws-top-ref-opacity').hidden, true);
  assert.equal(api.$('#ws-ref-opacity').disabled, true);
});

test('explicit reference keeps its identity and source preference while revealing overlay', () => {
  const api = setup({ url: 'reference.png', useSource: false }, 'source.png');
  api.syncUi(); api.input(50);
  assert.equal(api.$('#ws-top-ref-opacity').hidden, false);
  assert.equal(api.$('#ws-ref-opacity').disabled, false);
  assert.equal(api.state.reference.url, 'reference.png');
  assert.equal(api.state.reference.useSource, false);
  assert.equal(api.state.reference.displayMode, 'normal');
});

test('opacity input does not leave the full-opacity comparison mode', () => {
  const api = setup({ displayMode: 'reference-only' }, 'source.png');
  api.input(0);
  assert.equal(api.state.reference.displayMode, 'reference-only');
  assert.equal(api.state.reference.opacity, 0);
  assert.equal(api.state.view.mode, 'blocks');
});
