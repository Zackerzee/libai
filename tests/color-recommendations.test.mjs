import test from 'node:test';
import assert from 'node:assert/strict';
import {buildColorRecommendationGroups} from '../services/color-recommendations.mjs';
import {groupColorSuggestions,positionCellPopover} from '../ui/cell-color-popover.js';
const color=(id,rgb)=>({paletteId:id,code:id,rgb,hex:'#123456'});
const palette=[color('green',[30,150,60]),color('dark',[20,115,40]),color('darker',[10,70,20]),color('light',[65,180,80]),color('lighter',[90,215,100]),color('contrast',[170,40,145]),color('neutral',[150,150,150])];
test('one-step tone suggestions use perceptual hue and lightness, not code arithmetic',()=>{
  const groups=buildColorRecommendationGroups(palette,'green');
  assert.deepEqual(groups.find(g=>g.label==='暗一级 / 亮一级').colors.map(c=>[c.paletteId,c.recommendationLabel]),[['dark','暗一级'],['light','亮一级']]);
  assert.deepEqual(groups.find(g=>g.label==='对比色').colors.map(c=>c.paletteId),['contrast']);
});
test('neighbor overlap preserves semantic reasons while avoiding duplicate swatches',()=>{
  const groups=groupColorSuggestions(buildColorRecommendationGroups(palette,'green',[palette[1],palette[5]]),'green');
  const colors=groups.flatMap(g=>g.colors);
  assert.equal(colors.filter(c=>c.paletteId==='dark').length,1);
  assert.deepEqual(colors.find(c=>c.paletteId==='dark').recommendationLabels,['暗一级','周边用色']);
  assert.deepEqual(colors.find(c=>c.paletteId==='contrast').recommendationLabels,['对比色','周边用色']);
  assert.ok(groups.find(g=>g.label==='暗一级 / 亮一级').colors.some(c=>c.paletteId==='dark'));
  assert.ok(groups.find(g=>g.label==='对比色').colors.some(c=>c.paletteId==='contrast'));
});
test('recommendations only use supplied real palette and do not synthesize tones',()=>{
  const groups=buildColorRecommendationGroups([palette[0]],'green');
  assert.equal(groups.flatMap(g=>g.colors).length,0);
});
test('neutral tone suggestions stay neutral and contrast uses lightness',()=>{
  const gray=[color('gray',[120,120,120]),color('black',[0,0,0]),color('white',[255,255,255]),palette[0]];
  const groups=buildColorRecommendationGroups(gray,'gray');
  assert.deepEqual(groups.find(g=>g.label==='暗一级 / 亮一级').colors.map(c=>c.paletteId),['black','white']);
  assert.ok(groups.find(g=>g.label==='对比色').colors.every(c=>c.paletteId!=='green'));
});
test('edge fallback flips horizontally without covering the selected cell',()=>{
  assert.deepEqual(positionCellPopover({x:450,y:30,cell:20},{width:180,height:100},{width:500,height:400}),{left:260,top:60});
});
test('tight vertical host uses side fallback rather than covering anchor when possible',()=>{
  const p=positionCellPopover({x:30,y:30,cell:20},{width:180,height:100},{width:500,height:110});
  assert.equal(p.left,60);assert.equal(p.top,8);
});
