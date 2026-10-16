import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {runPindouPipeline} from '../src/algorithms/pindou-full/pipeline.mjs';
import {PINDOU_DEFAULTS,PINDOU_SCENES,normalizePindouConfig,applyPindouScene} from '../src/algorithms/pindou-full/config.mjs';
import C from '../src/algorithms/pindou-full/color.mjs';
import Q from '../src/algorithms/pindou-full/quantize.mjs';
const require=createRequire(import.meta.url);
const {createCanvas,loadImage}=require('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/@napi-rs/canvas');
const root=new URL('../vendor/pindou/reference/js/',import.meta.url);
const palette=[[0,0,0],[255,255,255],[240,40,50],[30,170,80],[30,90,230],[240,210,70],[180,100,170],[190,150,100]].map((rgb,i)=>({code:'A'+i,paletteId:'fixture',brand:'fixture',rgb,hex:C.rgbToHex(...rgb),lab:C.rgbToLab(...rgb,[0,0,0])}));
function oracle(source,config){
 const context={performance,console,setTimeout,clearTimeout,PD:{},document:{createElement:()=>createCanvas(1,1),getElementById:()=>({})}};context.window=context;
 vm.createContext(context);
 for(const name of ['color.js','quantize.js'])vm.runInContext(fs.readFileSync(new URL(name,root),'utf8'),context);
 const referenceRefine=context.PD.quantize.refinePalette; const trace={};
 context.PD.quantize.refinePalette=function(grid,w,h,pal,sub,...rest){trace.prequant=Array.from(grid);trace.selected=sub.map(c=>c.code);const value=referenceRefine(grid,w,h,pal,sub,...rest);trace.refined=value.map(c=>c.code);return value;};
 context.PD.palettes={get:()=>({colors:palette}),symbols:['a','b','c','d']};
 let code=fs.readFileSync(new URL('app.js',root),'utf8');
 code=code.slice(0,code.indexOf('  function layout()'));
 code+='\n function setStatus(){} function commitLater(){} function updateStats(){} function renderColorList(){} function layout(){} function render(){} function saveSettings(){} PD.oracle={state,opts,compute,sourceCanvas,fitSource};})();';
 vm.runInContext(code,context);
 const cv=createCanvas(source.width,source.height);const ctx=cv.getContext('2d');const image=ctx.createImageData(source.width,source.height);image.data.set(source.data);ctx.putImageData(image,0,0);cv.naturalWidth=cv.width;cv.naturalHeight=cv.height;
 context.PD.oracle.state.img=cv;Object.assign(context.PD.oracle.opts,config);context.PD.oracle.compute();const result=context.PD.oracle.state.result;if(result)result.trace=trace;return result;
}
function tracedPipeline(input){const original=Q.refinePalette,trace={};Q.refinePalette=function(grid,w,h,pal,sub,...rest){trace.prequant=Array.from(grid);trace.selected=sub.map(c=>c.code);const result=original(grid,w,h,pal,sub,...rest);trace.refined=result.map(c=>c.code);return result;};try{const result=runPindouPipeline(input,{canvasFactory:createCanvas});result.trace=trace;return result;}finally{Q.refinePalette=original;}}

for (const path of ['assets/brand/shiliber-mark-256.png', ...['rf-aa-leak','rf-thin-struct','rf-edge-contam','rf-flat-frag','rf-small-sep','rf-portrait-eye','rf-anime-hl','rf-complex'].map(id=>`tests/fixtures/real-failures/${id}/image.png`)]) {
 test(`PNG fixture upstream identity: ${path}`, async()=>{
  const img=await loadImage(new URL('../'+path,import.meta.url).pathname);
  const cv=createCanvas(img.width,img.height);cv.getContext('2d').drawImage(img,0,0);
  const source={width:img.width,height:img.height,data:cv.getContext('2d').getImageData(0,0,img.width,img.height).data};
  const config=normalizePindouConfig({gridW:52,gridH:52,colors:8,sampleMode:'ssim',dither:'fs'});
  const actual=runPindouPipeline({source,palette,config},{canvasFactory:createCanvas}),expected=oracle(source,config);
  assert.deepEqual(Array.from(actual.idx),Array.from(expected.idx));assert.deepEqual(actual.counts,Array.from(expected.counts));assert.deepEqual(actual.sub.map(c=>c.code),Array.from(expected.sub,c=>c.code));
 });
}
function fixture(){const width=23,height=17,data=new Uint8ClampedArray(width*height*4);for(let y=0;y<height;y++)for(let x=0;x<width;x++){const i=(y*width+x)*4;data[i]=(x*31+y*17)%256;data[i+1]=(x*13+y*41)%256;data[i+2]=(x*7+y*19)%256;data[i+3]=(x+y)%11===0?0:255;}return{width,height,data};}
for(const sampleMode of ['ssim','area','dpid','edge','dominant','nearest'])for(const algo of ['kmeans','mediancut','direct'])for(const dither of ['none','fs','ordered'])test(`upstream bytes: ${sampleMode}/${algo}/${dither}`,()=>{
 const source=fixture(),config=normalizePindouConfig({gridW:9,gridH:7,colors:5,sampleMode,algo,dither,mosaic:2,sharpen:27,brightness:4,contrast:8,saturation:12,gamma:115,texture:180});
 const actual=tracedPipeline({source,palette,config});const expected=oracle(source,config);
 assert.deepEqual(actual.trace.prequant,expected.trace.prequant,'prequant RGBA floats exact');assert.deepEqual(actual.trace.selected,Array.from(expected.trace.selected),'pre-refine palette selection exact');assert.deepEqual(actual.trace.refined,Array.from(expected.trace.refined),'post-refine palette selection exact');
 assert.deepEqual(Array.from(actual.idx),Array.from(expected.idx));assert.deepEqual(actual.sub.map(c=>c.code),Array.from(expected.sub,c=>c.code));assert.deepEqual(actual.counts,Array.from(expected.counts));assert.equal(actual.total,expected.total);
 assert.deepEqual(Array.from(runPindouPipeline({source,palette,config},{canvasFactory:createCanvas}).idx),Array.from(actual.idx));
});
test('default and scene partial merges retain unmentioned values',()=>{assert.equal(PINDOU_DEFAULTS.gridW,64);assert.equal(PINDOU_DEFAULTS.colors,16);for(const id of Object.keys(PINDOU_SCENES)){const v=applyPindouScene({brightness:19,bgTol:27,ditherAmt:13},id);assert.equal(v.brightness,19);assert.equal(v.bgTol,27);if(!('ditherAmt'in PINDOU_SCENES[id]))assert.equal(v.ditherAmt,13);}});
for(const fitMode of ['cover','contain','stretch'])test('geometry and blur/removal oracle '+fitMode,()=>{const source=fixture(),config=normalizePindouConfig({gridW:7,gridH:5,colors:5,fitMode,rotate:90,flipH:true,crop:{x:0.1,y:0.2,w:0.7,h:0.6},blur:1.5,bgRemove:true,bgColor:'#ffffff',bgTol:18});const actual=runPindouPipeline({source,palette,config},{canvasFactory:createCanvas}),expected=oracle(source,config);assert.deepEqual(Array.from(actual.idx),Array.from(expected.idx));assert.deepEqual(actual.counts,Array.from(expected.counts));});
test('RGBA source immutable and palette identity preserved',()=>{const source=fixture(),before=source.data.slice();const r=runPindouPipeline({source,palette,config:{gridW:4,gridH:4}},{canvasFactory:createCanvas});assert.deepEqual(source.data,before);for(const entry of r.sub)assert.ok(palette.includes(entry));});
test('invalid config sanitized and intentional extended bounds',()=>{const c=normalizePindouConfig({gridW:0,gridH:9999,algo:'bad',gamma:NaN,crop:{x:2,y:0,w:1,h:1}});assert.equal(c.gridW,1);assert.equal(c.gridH,1000);assert.equal(c.algo,'kmeans');assert.equal(c.gamma,100);assert.equal(c.crop,null);});
test('all-transparent and absent palette explicit',()=>{const source={width:2,height:2,data:new Uint8ClampedArray(16)};const r=runPindouPipeline({source,palette,config:{gridW:2,gridH:2}},{canvasFactory:createCanvas});assert.equal(r.total,0);assert.ok(Array.from(r.idx).every(i=>i===-1));assert.throws(()=>runPindouPipeline({source,palette:[]},{canvasFactory:createCanvas}),/No available/);});
test('mixed brand same code does not rewrite output identities',()=>{const mixed=palette.map((c,i)=>({...c,code:'X',brand:'B'+i,paletteId:'P'+i}));const r=runPindouPipeline({source:fixture(),palette:mixed,config:{gridW:7,gridH:5,colors:6}},{canvasFactory:createCanvas});for(const c of r.sub){assert.ok(mixed.includes(c));assert.equal(c.code,'X');}assert.ok(r.sub.length>1);});
for(const id of Object.keys(PINDOU_SCENES))test('scene upstream bytes '+id,()=>{const source=fixture(),config=applyPindouScene({gridW:13,gridH:11},id);const actual=runPindouPipeline({source,palette,config},{canvasFactory:createCanvas}),expected=oracle(source,config);assert.deepEqual(Array.from(actual.idx),Array.from(expected.idx));assert.deepEqual(actual.sub.map(c=>c.code),Array.from(expected.sub,c=>c.code));});
test('adjustments always start from supplied immutable source',()=>{const source=fixture(),config={gridW:7,gridH:5};const initial=runPindouPipeline({source,palette,config},{canvasFactory:createCanvas});runPindouPipeline({source,palette,config:{...config,brightness:70,sharpen:90,contrast:40}},{canvasFactory:createCanvas});const reset=runPindouPipeline({source,palette,config},{canvasFactory:createCanvas});assert.deepEqual(reset.idx,initial.idx);assert.deepEqual(reset.counts,initial.counts);});
