import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,existsSync} from 'node:fs';
const css=readFileSync(new URL('../vendor/misans/ui-font.css',import.meta.url),'utf8');
const ui=readFileSync(new URL('../styles/ui-typography.css',import.meta.url),'utf8');
test('MiSans faces are local, valid WOFF2 assets, unicode-segmented and nonblocking',()=>{
  const urls=[...css.matchAll(/url\("\.\/([^"/]+\.woff2)"\)/g)].map(m=>m[1]);
  assert.equal(urls.length,49);assert.ok(!css.includes('https:'));
  for(const file of urls){const path=new URL(`../vendor/misans/${file}`,import.meta.url);assert.ok(existsSync(path));assert.equal(readFileSync(path).subarray(0,4).toString(),'wOF2');}
  assert.equal((css.match(/font-display: swap/g)||[]).length,49);
  assert.equal((css.match(/unicode-range:/g)||[]).length,49);
});
test('Apple first uses PingFang, then MiSans, and text/export services are not restyled',()=>{
  assert.match(ui,/--ds-font-ui:"PingFang SC","MiSans UI"/);
  assert.ok(!ui.includes('canvas{'));assert.ok(!ui.includes('font-family:.*text-layer'));
  assert.match(ui,/font-size:16px;font-weight:600/);
  assert.match(ui,/font-size:13px;font-weight:500/);
  assert.match(ui,/font-size:14px;font-weight:400/);
  assert.match(ui,/font-size:12px;font-weight:400/);
});
