import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../ui/text-panel.js', import.meta.url), 'utf8');
const load = () => {
  const context = vm.createContext({ TEXT_FONTS: [], TEXT_SCALE_RANGE: { min: 1, inputMax: 10000 }, layerLabel: layer => layer.text, paletteIdOf: color => color.paletteId, colorLabelInk: () => '#000' });
  vm.runInContext(source.replace(/^import .*;$/gm, '').replace(/export /g, '') + '\nthis.Panel = TextPanel;', context);
  return context.Panel;
};
test('creative text uses shared color targets, never a per-property palette dropdown', () => {
  const Panel = load();
  const root = { innerHTML: '', querySelectorAll: () => [] };
  const panel = Object.create(Panel.prototype);
  Object.assign(panel, { root, _palette: [{paletteId:'mard:H02',code:'H02',hex:'#fff'}, {paletteId:'mard:A01',code:'A01',hex:'#000'}] });
  panel.build({ activeId:'a', layers:[{id:'a',text:'多行\n文字',colorMode:'gradient',scale:100,x:0,y:0}],palette:panel._palette });
  assert.match(root.innerHTML, /创意工具/);
  assert.match(root.innerHTML, /data-text-color-target="gradient"/);
  assert.match(root.innerHTML, /ws-text-writing-mode/);
  assert.match(root.innerHTML, /data-text-style="lineHeight"/);
  assert.match(root.innerHTML, /pixel-5x7/);
  assert.match(root.innerHTML, /ws-text-local-font/);
  assert.doesNotMatch(root.innerHTML, /<select data-text-palette-role|type="color"/);
});
test('gradient stops are derived without mutating layer storage', () => {
  const Panel = load();
  const panel = Object.create(Panel.prototype);
  const layer = {gradientStops:[{paletteId:'brand:a',code:'a',hex:'#fff'},{paletteId:'brand:b',code:'b',hex:'#000'}]};
  const stops = panel.gradientStops(layer);
  stops[0].code = 'changed';
  assert.equal(layer.gradientStops[0].code, 'a');
  assert.equal(stops.length, 2);
});
test('color clicks forward active layer, effect role and gradient stop index', () => {
  const Panel = load();
  const handlers = {};
  const root = {addEventListener:(name, fn) => { handlers[name] = fn; }};
  const calls = [];
  const panel = new Panel({root,onColorTarget:(...args) => calls.push(args)});
  panel._activeId = 'text-1';
  handlers.click({target:{closest:selector => selector === '[data-text-color-target]' ? {dataset:{textColorTarget:'gradient',stopIndex:'1'}} : null}});
  assert.deepEqual(calls, [['text-1','gradient',1]]);
});
