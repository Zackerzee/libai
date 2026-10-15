import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { adjustSourcePixels, renderSourceTransform } from '../services/source-editor-service.js';

const source=new Uint8ClampedArray([10,80,150,255,90,100,110,128,255,0,20,0]);
test('zero is byte-exact, detached and preserves hidden transparent RGB',()=>{
  const out=adjustSourcePixels(source,3,1,{});
  assert.deepEqual(out,source); assert.notEqual(out,source);
});
test('high-zero-high is deterministic and never modifies source',()=>{
  const before=source.slice(), settings={brightness:35,contrast:30,saturation:-40,sharpen:80};
  const first=adjustSourcePixels(source,3,1,settings);
  assert.deepEqual(adjustSourcePixels(source,3,1,{}),before);
  assert.deepEqual(adjustSourcePixels(source,3,1,settings),first);
  assert.deepEqual(source,before);
});
test('all combinations preserve alpha and dimensions',()=>{
  for (const brightness of [-100,0,100]) for(const contrast of [-100,0,100])
    for(const saturation of [-100,0,100]) for(const sharpen of [0,100]) {
      const out=adjustSourcePixels(source,3,1,{brightness,contrast,saturation,sharpen});
      assert.equal(out.length,source.length);
      assert.deepEqual([out[3],out[7],out[11]],[255,128,0]);
      assert.deepEqual(out.slice(8),source.slice(8));
    }
});
test('sharpen ignores fully transparent neighbours',()=>{
  const input=new Uint8ClampedArray([100,100,100,255,0,0,0,0]);
  assert.deepEqual(adjustSourcePixels(input,2,1,{sharpen:100}),input);
});
test('combined sharpen uses the completed tonal pass',()=>{
  const input=new Uint8ClampedArray([50,50,50,255,100,100,100,255]);
  const tonal=adjustSourcePixels(input,2,1,{contrast:50,brightness:10});
  assert.deepEqual(adjustSourcePixels(input,2,1,{contrast:50,brightness:10,sharpen:100}),
    adjustSourcePixels(tonal,2,1,{sharpen:100}));
});
test('partial alpha neighbours are weighted without changing center alpha',()=>{
  const input=new Uint8ClampedArray([0,0,0,255,100,100,100,255,200,200,200,128]);
  const out=adjustSourcePixels(input,3,1,{sharpen:100});
  assert.equal(out[4],127); assert.equal(out[7],255); assert.equal(out[11],128);
});
test('invalid pixel geometry is rejected',()=>assert.throws(()=>adjustSourcePixels(source,2,1),RangeError));

let native;
try { native=createRequire(import.meta.url)('@napi-rs/canvas'); } catch {
  try { native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'); } catch {}
}
test('native canvas repeats high-zero-high from original without cumulative damage',{skip:!native},()=>{
  const previous=globalThis.document;
  globalThis.document={createElement(){
    const canvas=native.createCanvas(1,1),ctx=canvas.getContext('2d'),read=ctx.getImageData.bind(ctx);
    ctx.getImageData=(x,y,w,h)=>read(x,y,w,h); return canvas;
  }};
  try {
    const input=native.createCanvas(3,2),ctx=input.getContext('2d');
    ctx.fillStyle='#496a8b';ctx.fillRect(0,0,2,2);
    ctx.fillStyle='#f5a733';ctx.fillRect(2,0,1,1);
    const read=canvas=>Array.from(canvas.getContext('2d').getImageData(0,0,3,2).data);
    const original=read(input),high={brightness:40,contrast:30,saturation:-60,sharpen:90};
    const first=read(renderSourceTransform(input,high));
    assert.deepEqual(read(renderSourceTransform(input,{})),original);
    assert.deepEqual(read(renderSourceTransform(input,high)),first);
    assert.deepEqual(read(input),original);
  } finally { globalThis.document=previous; }
});
