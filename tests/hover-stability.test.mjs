import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('usage colour hover does not scale the label under the pointer',()=>{
  const css=readFileSync(new URL('../styles/studio-system.css',import.meta.url),'utf8');
  assert.match(css,/ws-usage-card:is\(:hover,:focus-visible,:active\) \.ws-swatch\{transform:none\}/);
});
test('preview content changes do not reposition the colour suggestion popup',()=>{
  const source=readFileSync(new URL('../ui/cell-color-popover.js',import.meta.url),'utf8');
  assert.match(source,/if \(placementKey !== anchorKey\)/);
  assert.match(source,/\[signature,point.x,point.y,side,host.clientWidth,host.clientHeight\]/);
  assert.doesNotMatch(source.match(/const anchorKey[^;]+;/)?.[0]||'',/previewTarget/);
});
