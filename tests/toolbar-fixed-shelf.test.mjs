import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

test('fixed shelf reserves both rows independently of tool visibility',()=>{
  const css=readFileSync(new URL('../styles/workspace.css',import.meta.url),'utf8');
  const shelf=css.slice(css.indexOf('/* Stable tool shelf:'),css.indexOf('/* 用量列表 */',css.indexOf('/* Stable tool shelf:')));
  assert.match(shelf,/height:76px!important;min-height:76px!important;max-height:76px!important/);
  assert.match(shelf,/grid-template-rows:34px 34px!important/);
  assert.match(shelf,/height:26px!important;min-height:26px!important/,'controls leave room for horizontal scrollbar');
  assert.match(shelf,/@media\(pointer:coarse\)/,'touch devices retain larger targets');
  assert.match(shelf,/grid-template-rows:40px 40px!important/);
  assert.match(shelf,/overflow-x:auto!important;overflow-y:hidden!important/);
  assert.match(shelf,/white-space:nowrap/);
  assert.doesNotMatch(shelf,/position:absolute|margin-top:-|transform:/);
  assert.equal(css.slice(css.indexOf('/* Stable tool shelf:')+shelf.length).includes('grid-template-rows'),false,'no later row sizing override');
});
