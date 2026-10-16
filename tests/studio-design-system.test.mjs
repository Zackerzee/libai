import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const read=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
test('homepage and workbench share the final design layer with accessibility fallbacks',()=>{
  const page=read('index.html'),css=read('styles/studio-system.css');
  assert.ok(page.indexOf('styles/studio-system.css')>page.indexOf('styles/homepage.css'));
  assert.match(page,/assets\/studio-bloom\.svg/);
  for(const preference of ['prefers-reduced-motion','prefers-reduced-transparency','prefers-contrast'])assert.ok(css.includes(preference));
  assert.match(css,/generator-intro\.homepage \.hero-copy h2\{color:#f9f5ff/);
});
test('removed legacy export entry cannot break paint; output participates in surface dismissal',()=>{
  const workspace=read('ui/workspace.js');
  assert.match(workspace,/if\(legacyExportButton\)legacyExportButton\.disabled/);
  assert.doesNotMatch(workspace,/\$\("#ws-export"\)\.disabled/);
  assert.match(workspace,/surfaces\.register\('output'/);
  assert.match(workspace,/surfaces\.open\('output'\)/);
});
