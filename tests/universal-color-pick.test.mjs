import test from 'node:test';
import assert from 'node:assert/strict';
import { attachUniversalColorPick } from '../ui/universal-color-pick.mjs';
import { readFileSync } from 'node:fs';

function harness(inside = false, diagnostic = false) {
  const listeners = {}, picks = [], jobs = new Map(); let serial = 0;
  const root = { addEventListener: (k,f) => listeners[k]=f, removeEventListener: k => delete listeners[k], contains: n => n === node };
  const node = { dataset: {wsColorPick:'H07'}, isConnected:true, closest:s => s === '[data-ws-color-pick]' ? node : (s === '#ws-canvas-area' && inside) || (s === '[data-ws-inspector="check"]' && diagnostic) ? {} : null, contains:n => n===node };
  const dispose = attachUniversalColorPick(root,{pick:id=>picks.push(id),schedule:(f,ms)=>{assert.equal(ms,800);jobs.set(++serial,f);return serial;},cancel:id=>jobs.delete(id)});
  const fire = (type,extra={}) => listeners[type]({target:node,relatedTarget:null,...extra});
  return {node,picks,jobs,fire,dispose,run:()=>{const fs=[...jobs.values()];jobs.clear();fs.forEach(f=>f());}};
}
test('outside swatch picks exact identity after 800ms only',()=>{const h=harness();h.fire('pointerover');assert.deepEqual(h.picks,[]);h.run();assert.deepEqual(h.picks,['H07']);});
test('leaving cancels delayed picking',()=>{const h=harness();h.fire('pointerover');h.fire('pointerout');h.run();assert.deepEqual(h.picks,[]);});
test('rerendered disconnected swatch does not pick',()=>{const h=harness();h.fire('pointerover');h.node.isConnected=false;h.run();assert.deepEqual(h.picks,[]);});
test('canvas and bottom usage strip never hover-pick',()=>{const h=harness(true);h.fire('pointerover');h.run();assert.deepEqual(h.picks,[]);});
test('diagnostic suggestion swatches never hover-pick but retain explicit right-click',()=>{const h=harness(false,true);h.fire('pointerover');h.run();assert.deepEqual(h.picks,[]);h.fire('contextmenu',{preventDefault:()=>{},stopPropagation:()=>{}});assert.deepEqual(h.picks,['H07']);});
test('right-click swatch picks without clicking button',()=>{const h=harness(true);let prevented=0;h.fire('contextmenu',{preventDefault:()=>prevented++,stopPropagation:()=>{}});assert.deepEqual(h.picks,['H07']);assert.equal(prevented,1);});
test('touch, scroll and pointerdown do not accidentally hover-pick',()=>{const h=harness();h.fire('pointerover',{pointerType:'touch'});h.run();h.fire('pointerover');h.fire('scroll');h.run();h.fire('pointerover');h.fire('pointerdown');h.run();assert.deepEqual(h.picks,[]);h.dispose();});
test('arbitrary backgrounds keep native context menu',()=>{const h=harness();let prevented=false;h.fire('contextmenu',{target:{closest:()=>null},preventDefault:()=>prevented=true});assert.equal(prevented,false);assert.deepEqual(h.picks,[]);});
test('canvas right pointerdown returns before selection, painting or capture',()=>{const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');const body=source.slice(source.indexOf('const onCanvasDown ='),source.indexOf('const onCanvasMove ='));assert.ok(body.indexOf('if (event.button === 2) return;')<body.indexOf('cellColorPopover.close()'));assert.match(source,/if \(!norm && !color\) return;/);});
