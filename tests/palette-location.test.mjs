import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {GenerationPanel} from '../ui/generation-panel.js';

test('palette cards move as the existing live selector into generation color organization',()=>{
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  assert.equal((source.match(/id="ws-brand-cards"/g)||[]).length,1);
  assert.equal((source.match(/id="ws-brand-selector"/g)||[]).length,1);
  assert.ok(source.indexOf('$("#ws-generation-palette-slot").append($("#ws-brand-selector"))')>source.indexOf('const generationPanel = new GenerationPanel'));
  const section=GenerationPanel.prototype.renderColorSection();
  assert.ok(section.indexOf('ws-generation-palette-slot')>section.indexOf('<h3>色彩整理</h3>'));
  assert.ok(section.indexOf('ws-generation-palette-slot')<section.indexOf('sl-color-presets'));
});

test('generation rerender preserves the live palette selector and its event listeners',()=>{
  const selector={};
  let mounted;
  const root={querySelector: selectorText=>selectorText==='#ws-brand-selector'?selector:{append:node=>{mounted=node;}},innerHTML:''};
  // mock 桩与 render() 调用的段渲染器一一对应。阶段 3 把背景单开关换成
  // 三选一卡片后多了一个 backgroundModeCards()，这里补上同名桩 ——
  // 本用例只关心色板选择器的搬运，不关心背景区内容。
  GenerationPanel.prototype.render.call({root,syncUI(){},renderActionSection(){return '';},renderGenMethodSection(){return '';},renderColorSection:GenerationPanel.prototype.renderColorSection,renderAdvancedSection(){return '';},switchRow(){return '';},backgroundModeCards(){return '';}});
  assert.equal(mounted,selector);
  assert.equal((root.innerHTML.match(/id="ws-generation-palette-slot"/g)||[]).length,1);
});
