import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {constructionSheetLayout,constructionCodeInk} from '../services/construction-sheet-layout.js';
import {renderPngPatternCanvas,pngPatternPixelSize} from '../services/png-pattern-export-renderer.js';
import {mirrorExportGrid} from '../services/export-v2-service.js';
const red={code:'F04',paletteId:'red',rgb:[239,29,36]},black={code:'H07',paletteId:'black',rgb:[0,0,0]},grid=[[red,null],[black,red]];
const native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas');
test('sheet layout uses actual identities counts and grows for wrapped legend',()=>{
  const layout=constructionSheetLayout(grid,48);
  assert.deepEqual(layout.usage.map(c=>[c.code,c.count]),[['F04',2],['H07',1]]);
  const many=[Array.from({length:72},(_,i)=>({code:`C${i}`,paletteId:`id${i}`,rgb:[20,30,40]}))];
  assert.ok(constructionSheetLayout(many,48).headerHeight>layout.headerHeight);
  assert.equal(constructionSheetLayout(grid,48,{showCoordinates:false}).ruler,0);
});
test('final construction dimensions and mirrored cell colors stay exact',()=>{
  const before=structuredClone(grid),g=mirrorExportGrid(grid,'horizontal'),options={constructionSheet:true,showCodes:false,showGrid:false,document:{createElement:()=>native.createCanvas(1,1)}};
  const layout=constructionSheetLayout(g,48),canvas=renderPngPatternCanvas(g,options),bytes=canvas.toBuffer('image/png');
  assert.deepEqual(pngPatternPixelSize(g,48,options),{width:canvas.width,height:canvas.height,cellSize:48});
  assert.equal(bytes.readUInt32BE(16),layout.width);assert.equal(bytes.readUInt32BE(20),layout.height);
  assert.deepEqual([...canvas.getContext('2d').getImageData(layout.gridX+58,layout.gridY+10,1,1).data],[239,29,36,255]);assert.deepEqual(grid,before);
});
test('metadata title legend and all four coordinate edges are actually drawn',()=>{
  const texts=[],ctx={fillRect(){},fillText(value,...coordinates){texts.push({value,font:this.font,color:this.fillStyle,coordinates});},measureText(){return {width:10};}};
  renderPngPatternCanvas([Array(6).fill(red),Array(6).fill(black)],{constructionSheet:true,title:'原始 / 标题 镜像',paletteLabel:'MARD 221',document:{createElement:()=>({getContext:()=>ctx})}});
  for(const value of ['原始 / 标题 镜像','MARD 221','6×2','12','2','F04','H07','×6','作品尺寸','图纸页数'])assert.ok(texts.some(t=>t.value===value),value);
  assert.equal(texts.filter(t=>t.value==='5').length,2);assert.ok(texts.filter(t=>t.value==='5').every(t=>t.font.startsWith('700')));
});
test('construction codes use contrast-safe pure black and white',()=>{assert.equal(constructionCodeInk([239,29,36]),'#000000');assert.equal(constructionCodeInk([0,0,0]),'#ffffff');assert.equal(constructionCodeInk([255,255,255]),'#000000');});
