import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {positionCellPopover,groupColorSuggestions} from '../ui/cell-color-popover.js';
test('hover and keyboard focus preview the destination without writing the grid or target input',()=>{
  const source=readFileSync(new URL('../ui/cell-color-popover.js',import.meta.url),'utf8');
  const preview=source.slice(source.indexOf('const preview=()=>'),source.indexOf("button.addEventListener('click'",source.indexOf('const preview=()=>')));
  assert.match(preview,/previewTarget=candidate;update\(\)/);
  for(const event of ['pointerenter','pointerleave','focus','blur'])assert.ok(preview.includes(`'${event}'`));
  assert.doesNotMatch(preview,/targetInput\.value|dispatchEvent|localButton\.click|setState/);
  assert.match(source,/const target=previewTarget\|\|getTarget\(\)/);
  assert.match(source,/previewTarget=null;update\(\)/);
});
test('picked target remains separate from the inspected global replacement source',()=>{
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  assert.match(source,/const replacementSourceId = selected \? paletteIdOf\(selectedColor\) : selectedPaletteId/);
  assert.match(source,/const from = sourceCell \? paletteIdOf\(editorService.getCell\(sourceCell.x,sourceCell.y\)\) : currentPaletteId\(\)/);
  assert.match(source,/input.value=color.code;\s*input.dispatchEvent\(new Event\("change"/);
  assert.match(source,/!get\(\)\.editor\.selection\s*\?\s*\{\s*selectedCell:\s*cell\s*\}\s*:\s*\{\s*\}/);
});
test('cell recommendations appear below the grid cell when there is space',()=>{
  assert.deepEqual(positionCellPopover({x:40,y:20,cell:20},{width:180,height:100},{width:500,height:400}),{left:70,top:50});
});
test('recommendation click synchronously refreshes target then applies only the local command',()=>{
  const source=readFileSync(new URL('../ui/cell-color-popover.js',import.meta.url),'utf8');
  assert.match(source,/targetInput\.value=candidate\.code;targetInput\.dispatchEvent\(new Event\('change',\{bubbles:true\}\)\);if\(!localButton\.disabled\)localButton\.click\(\)/);
  assert.match(source,/点击建议色立即换色/);
});
test('local and explicit global color replacement do not display confirmation dialogs',()=>{
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  const local=source.slice(source.indexOf('$("#ws-selection-color-replace").addEventListener'),source.indexOf('// 搜索 / 换系列'));
  const sidebar=source.slice(source.indexOf('$("#ws-replace-confirm").addEventListener'),source.indexOf('$("#ws-same-color-highlight").addEventListener'));
  assert.doesNotMatch(local+sidebar,/askConfirmation/);
  assert.match(local,/editorService\.recolorSelection\(selection, to\)/);
  assert.match(local,/editorService\.replaceColor\(from, to\)/);
  assert.match(sidebar,/editorService\.replaceColor\(from, to, get\(\)\.editor\.selection\)/);
  assert.match(source,/askConfirmation\("重新生成将覆盖当前人工编辑/);
});
test('cell recommendations avoid right and bottom edges',()=>{
  assert.deepEqual(positionCellPopover({x:460,y:360,cell:20},{width:180,height:100},{width:500,height:400}),{left:270,top:250});
});
test('cell recommendations keep an eight pixel margin near top and left edges',()=>{
  assert.deepEqual(positionCellPopover({x:-20,y:0,cell:20},{width:180,height:100},{width:220,height:110}),{left:10,top:8});
});
test('recommendation groups retain semantic labels and deduplicate by palette identity',()=>{
  const color=id=>({paletteId:id,hex:'#ffffff'});
  const groups=groupColorSuggestions([{label:'当前替换目标',colors:[color('target')]},{label:'周边用色',colors:[color('source'),color('target'),color('neighbor')]},{label:'相近色',colors:[color('neighbor'),color('similar')]}],'source');
  assert.deepEqual(groups.map(g=>[g.label,g.colors.map(c=>c.paletteId)]),[['当前替换目标',['target']],['周边用色',['neighbor']],['相近色',['similar']]]);
});
test('empty suggestion groups disappear without RGB identity merging',()=>{
  const groups=groupColorSuggestions([{label:'empty',colors:[]},{label:'real',colors:[{paletteId:'A',hex:'#fff'},{paletteId:'B',hex:'#fff'}]}],'source');
  assert.equal(groups.length,1);assert.equal(groups[0].colors.length,2);
});
test('local replacement reuses the existing command with a one-cell fallback and preserves read-click selection',()=>{
  const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  assert.match(source,/get\(\)\.editor\.selection \|\| \(cell\?rectangularSelection\(cell\.x,cell\.y,cell\.x,cell\.y/);
  assert.match(source,/editorService\.recolorSelection\(selection, to\)/);
  assert.match(source,/color:\{\.\.\.real,paletteId:paletteIdOf\(real\)\}/);
  assert.match(source,/buildColorRecommendationGroups\(paletteColors\(\),paletteIdOf\(source\)/);
  const readClick=source.slice(source.indexOf('const inspected = cell ?'),source.indexOf('const onCanvasMove'));
  assert.doesNotMatch(readClick,/selection: null/);
});
