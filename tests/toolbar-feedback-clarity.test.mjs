import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GridEditorToolbar} from '../ui/grid-editor-toolbar.js';
test('eyedropper colors its own icon and has no corner badge',()=>{
  const writes=[],toolbar=Object.create(GridEditorToolbar.prototype);
  toolbar.root={querySelector(selector){assert.equal(selector,'[data-tool="eyedropper"]');return {style:{setProperty:(...args)=>writes.push(args)}};}};
  toolbar.setEyedropperColor('#ff2233');toolbar.setEyedropperColor('#ff2233');toolbar.setEyedropperColor(null);
  assert.deepEqual(writes,[['--picked-color','#ff2233'],['--picked-color','none']]);
  assert.doesNotMatch(readFileSync(new URL('../ui/grid-editor-toolbar.js',import.meta.url),'utf8'),/data-eyedropper-swatch/);
});
test('selection outlines are thin, slow and reduced-motion aware',()=>{
  const renderer=readFileSync(new URL('../ui/canvas-renderer.js',import.meta.url),'utf8');
  assert.match(renderer,/lineWidth=1;overlay.strokeStyle='#ffffff'/);
  assert.match(renderer,/performance.now\(\)\/300/);
  assert.match(renderer,/matches\?0:/);
  const css=readFileSync(new URL('../styles/workspace.css',import.meta.url),'utf8');
  assert.match(css,/ws-cell-selected-marker rect\{fill:none;stroke-width:1/);
  assert.match(css,/ws-cell-ants 6s/);
});
test('inspector tabs cannot shrink underneath header while content scrolls',()=>{
  const css=readFileSync(new URL('../styles/studio-system.css',import.meta.url),'utf8');
  assert.match(css,/\.ws-inspector \.ws-side-tabs\{[^}]*flex:0 0 auto/);
  assert.match(css,/\.ws-inspector \.ws-inspector-scroll\{flex:1 1 auto;overflow:auto;min-height:0/);
});
test('usage cards and selected-color actions preserve a compact single row',()=>{
  const css=readFileSync(new URL('../styles/studio-system.css',import.meta.url),'utf8');
  assert.match(css,/\.ws-usage-card\{[^}]*min-height:28px/);
  assert.match(css,/#ws-usage-actions\{flex-wrap:nowrap/);
  assert.match(css,/\.ws-usage-current\{flex:0 0 auto/);
});
