import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('project menu closes in capture phase before new/import actions and outside clicks', () => {
  assert.match(source, /closest\('\[role="menuitem"\]'\)\) projectMenu\.open = false/);
  assert.match(source, /projectMenu\.open = false;\s*\}, true\)/);
  assert.match(source, /!projectMenu\.contains\(event\.target\)\) projectMenu\.open = false/);
});
test('poster options expose artwork background and both requested brands', () => {
  assert.match(source, /value="artwork">图纸虚化背景/);
  assert.match(source, /value="libms">LIBMS Studio/);
  assert.match(source, /value="keqila">氪憩鞡丨时里白/);
  assert.match(source, /id="ws-poster-transparent">海报去底色/);
  assert.match(source, /removeBackground:\$\("#ws-poster-transparent"\)\.checked/);
  assert.match(source, /无法安全自动去除/);
});
test('website uses provided transparent PNG rather than old logo', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles.css', import.meta.url), 'utf8');
  assert.doesNotMatch(html + css, /libai-logo-pixel\.svg/);
  assert.doesNotMatch(html + source, /shiliber-mark-256\.png/);
  assert.match(html, /assets\/libms-logo\.png" type="image\/png"/);
  const png = readFileSync(new URL('../assets/libms-logo.png', import.meta.url));
  assert.equal(png.readUInt32BE(16), 1254);
  assert.equal(png.readUInt32BE(20), 1254);
  assert.equal(png[25], 6, 'RGBA logo retains alpha');
});
