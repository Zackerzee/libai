import test from 'node:test';
import assert from 'node:assert/strict';
import {sampleGridPerceptualV3} from '../smart-preprocessing/perceptual-sampler-v3.mjs';
function image(w,h,pixel){const data=new Uint8ClampedArray(w*h*4);for(let y=0;y<h;y++)for(let x=0;x<w;x++)data.set(pixel(x,y),(y*w+x)*4);return{width:w,height:h,data};}
test('flat medoid is original RGB and null alpha remains empty',()=>{
  const source=image(4,4,()=>[34,79,122,255]),before=[...source.data],r=sampleGridPerceptualV3(source,2,2);assert.deepEqual(r.colors,Array.from({length:2},()=>Array.from({length:2},()=>({r:34,g:79,b:122}))));assert.deepEqual([...source.data],before);assert.equal(sampleGridPerceptualV3(image(2,2,()=>[255,255,255,0]),1,1).colors[0][0],null);
});
test('high contrast connected highlight wins without creating averaged grey',()=>{
  const r=sampleGridPerceptualV3(image(8,8,(x,y)=>x===3?[255,255,255,255]:[0,0,0,255]),1,1);assert.deepEqual(r.colors[0][0],{r:255,g:255,b:255});assert.ok(r.specularMask[0]>0);assert.equal(r.shadowAnchorMask[0],0);
});
test('dominant black anchor is not lifted by isolated white pixel',()=>{
  const r=sampleGridPerceptualV3(image(8,8,(x,y)=>x===3&&y===3?[255,255,255,255]:[0,0,0,255]),1,1);assert.deepEqual(r.colors[0][0],{r:0,g:0,b:0});assert.ok(r.shadowAnchorMask[0]>.9);
});
test('geometry and exact pixel representatives are deterministic with bounded medoid costs',()=>{
  const source=image(64,48,(x,y)=>[x*3,y*4,(x+y)%255,255]),a=sampleGridPerceptualV3(source,7,5),b=sampleGridPerceptualV3(source,7,5),values=new Set();for(let i=0;i<source.data.length;i+=4)values.add([...source.data.slice(i,i+3)].join(','));assert.deepEqual(a.colors,b.colors);assert.equal(a.colors.length,5);assert.ok(a.colors.every(row=>row.length===7));for(const p of a.colors.flat())assert.ok(values.has(`${p.r},${p.g},${p.b}`));assert.ok(a.diagnostics.maxRetainedSamples<=32);assert.ok(a.diagnostics.maxRetainedCandidates<=8);assert.ok(a.diagnostics.distanceEvaluations<=35*32*8);assert.ok(a.diagnostics.approximateCells>0);assert.equal(a.resolvedMode,'perceptual-v3');
});
test('fractional cell overlap and alpha coverage preserve dominant dark samples',()=>{
  const r=sampleGridPerceptualV3(image(3,1,(x)=>x===1?[255,255,255,20]:[0,0,0,255]),2,1);assert.deepEqual(r.colors,[[{r:0,g:0,b:0},{r:0,g:0,b:0}]]);assert.ok(r.shadowAnchorMask.every(v=>v>.9));
  assert.throws(()=>sampleGridPerceptualV3({width:2,height:1,data:new Uint8ClampedArray(4)},1,1),/RGBA/);
});
test('call-local bounded Float64 Lab cache preserves uncached decisions and maps exactly',()=>{
  const source=image(19,13,(x,y)=>[(x*17)%255,(y*31)%255,(x*y*13)%255,255]);
  const a=sampleGridPerceptualV3(source,7,5),b=sampleGridPerceptualV3(source,7,5,{maxSourceLabCacheBytes:0});
  assert.deepEqual(a.colors,b.colors);for(const key of ['specularMask','shadowAnchorMask','contrastMap','edgeMap','importanceMap'])assert.deepEqual(a[key],b[key]);assert.equal(a.diagnostics.sourceLabCacheBytes,19*13*25);assert.ok(a.diagnostics.sourceLabConversions<=19*13);assert.equal(b.diagnostics.sourceLabCacheBytes,0);
  assert.deepEqual(sampleGridPerceptualV3(image(2,2,()=>[255,255,255,0]),3,5).colors,Array.from({length:5},()=>Array(3).fill(null)));
  assert.throws(()=>sampleGridPerceptualV3(image(1,1,()=>[0,0,0,255]),0,1),/positive integer/);
});
test('nearly transparent bright neighbor cannot falsely connect an isolated highlight',()=>{
  const source=image(4,4,(x,y)=>x===1&&y===1?[255,255,255,255]:x===2&&y===1?[255,255,255,9]:[0,0,0,255]);
  const r=sampleGridPerceptualV3(source,1,1);assert.deepEqual(r.colors[0][0],{r:0,g:0,b:0});assert.equal(r.specularMask[0],0);
});
