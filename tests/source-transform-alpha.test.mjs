import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { defaultSourceTransform, renderSourceTransform } from '../services/source-editor-service.js';

let native;
try { native=createRequire(import.meta.url)('@napi-rs/canvas'); } catch {
  try { native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'); } catch {}
}
function run(patch, verify) {
  const previous=globalThis.document;
  globalThis.document={createElement(){
    const canvas=native.createCanvas(1,1),ctx=canvas.getContext('2d');
    // Native Canvas takes a color-space string, unlike the browser's options
    // object. Keep this adapter in the test rather than change production.
    const read=ctx.getImageData.bind(ctx);
    ctx.getImageData=(x,y,w,h)=>read(x,y,w,h);
    return canvas;
  }};
  try {
    const input=native.createCanvas(5,5),ctx=input.getContext('2d');
    ctx.fillStyle='#ffffff';ctx.fillRect(1,1,3,3);ctx.clearRect(2,2,1,1);
    const result=renderSourceTransform(input,{...defaultSourceTransform(),...patch});
    const pixel=(x,y)=>Array.from(result.getContext('2d').getImageData(x,y,1,1).data);
    verify(result,pixel);
  } finally { globalThis.document=previous; }
}
test('automatic transparent-bounds crop preserves internal alpha and opaque white',{skip:!native},()=>run({crop:{x:1,y:1,width:3,height:3}},(out,p)=>{
  assert.equal(out.width,3);assert.equal(p(1,1)[3],0);assert.deepEqual(p(0,0),[255,255,255,255]);
}));
test('rotation and flips retain transparent holes',{skip:!native},()=>run({rotation:90,flipX:true},(_,p)=>{
  assert.equal(p(0,0)[3],0);assert.equal(p(2,2)[3],0);assert.equal(p(1,1)[3],255);
}));
test('brightness contrast saturation sharpening retain source alpha',{skip:!native},()=>run({brightness:15,contrast:10,saturation:20,sharpen:30},(_,p)=>{
  assert.equal(p(0,0)[3],0);assert.equal(p(2,2)[3],0);assert.equal(p(1,1)[3],255);
}));
for (const background of ['#ffffff','#ff0000']) {
  test(`expansion fills only added margins (${background}), preserving original holes`,{skip:!native},()=>run({expand:{left:2,right:1,top:1,bottom:2},background},(out,p)=>{
    assert.equal(out.width,8);assert.equal(out.height,8);
    assert.equal(p(2,1)[3],0);assert.equal(p(4,3)[3],0);assert.equal(p(3,2)[3],255);
    assert.deepEqual(p(0,0),background==='#ffffff'?[255,255,255,255]:[255,0,0,255]);
    assert.equal(p(7,7)[3],255);
  }));
}
