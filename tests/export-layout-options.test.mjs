import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {mirrorExportGrid,createExportV2Service,renderPosterCanvas} from '../services/export-v2-service.js';
import {renderPngPatternCanvas,pngPatternPixelSize} from '../services/png-pattern-export-renderer.js';
import {renderAuroraPosterBackground,renderPosterArtworkCanvas} from '../services/poster-export-service.js';
const red={code:'F03',rgb:[255,0,0]},blue={code:'C06',rgb:[0,0,255]},grid=[[red,null],[blue,red]];
test('export mirror clones values and does not edit canonical cells',()=>{
  const before=structuredClone(grid),h=mirrorExportGrid(grid,'horizontal'),v=mirrorExportGrid(grid,'vertical');assert.deepEqual(h,[[null,red],[red,blue]]);assert.deepEqual(v,[[blue,red],[red,null]]);h[0][1].rgb[0]=10;assert.deepEqual(grid,before);assert.throws(()=>mirrorExportGrid(grid,'both'),/镜像/);
});
test('construction PNG estimates include header and default four-sided coordinates',()=>{
  const service=createExportV2Service({getGrid:()=>grid,getTitle:()=>'',getPaletteLabel:()=>''});
  assert.deepEqual(service.estimate('hd'),{width:960,height:545,cellSize:48});assert.deepEqual(service.estimate('hd',{showCoordinates:false}),{width:960,height:449,cellSize:48});
  assert.deepEqual(pngPatternPixelSize(Array.from({length:104},()=>Array(104).fill(red)),48),{width:4992,height:4992,cellSize:48});
});
test('coordinate PNG IHDR matches final pixels and mirrored color interiors remain exact',()=>{
  const native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'),canvas=renderPngPatternCanvas(mirrorExportGrid(grid,'horizontal'),{cellSize:48,showCoordinates:true,showCodes:false,showGrid:false,document:{createElement:()=>native.createCanvas(1,1)}}),bytes=canvas.toBuffer('image/png');
  assert.equal(bytes.readUInt32BE(16),192);assert.equal(bytes.readUInt32BE(20),192);assert.deepEqual([...canvas.getContext('2d').getImageData(110,62,1,1).data],[255,0,0,255]);
});
test('aurora gradient and fine grain deterministic, no background drawn into artwork canvas',()=>{
  const make=()=>{const calls=[];return{calls,ctx:{save(){},restore(){},beginPath(){},ellipse(...v){calls.push(['orbit',...v]);},stroke(){calls.push(['stroke',this.strokeStyle,this.lineWidth]);},createLinearGradient(){return{addColorStop(...v){calls.push(['linear',...v]);}}},createRadialGradient(){return{addColorStop(...v){calls.push(['radial',...v]);}}},fillRect(...v){calls.push([typeof this.fillStyle==='string'?this.fillStyle:'gradient',...v]);}}};};
  const a=make(),b=make();renderAuroraPosterBackground(a.ctx,{width:200,height:300});renderAuroraPosterBackground(b.ctx,{width:200,height:300});assert.deepEqual(a.calls,b.calls);assert.ok(a.calls.some(v=>v[0]==='#74648709'));assert.ok(a.calls.some(v=>v[0]==='linear'&&v[2]==='#514887'));assert.equal(a.calls.filter(v=>v[0]==='orbit').length,2);
  const calls=[],canvas={getContext:()=>({fillRect(...v){calls.push([this.fillStyle,...v]);}})};renderPosterArtworkCanvas([[red,null]],{createCanvas:()=>canvas});assert.deepEqual(calls,[['rgb(255,0,0)',0,0,12,12]]);
});
test('PDF coordinate controls reach the complete sheet renderer',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('../services/export-v2-service.js',import.meta.url),'utf8');
  assert.match(source,/showCoordinates:options.showCoordinates!==false/);
  assert.doesNotMatch(source,/PDF 暂不支持坐标/);
});
test('actual aurora poster leaves foreground canonical RGB pure',async()=>{
  const native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'),previous=globalThis.document;
  globalThis.document={createElement(){const c=native.createCanvas(1,1);c.dataset={};return c;}};
  try{const canvas=await renderPosterCanvas([[red]],{background:'aurora',showLogo:false},{},{width:1500});assert.deepEqual([...canvas.getContext('2d').getImageData(750,950,1,1).data],[255,0,0,255]);assert.equal(canvas.width,1500);assert.equal(canvas.height,2000);}finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
