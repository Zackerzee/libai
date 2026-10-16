import test from 'node:test';
import assert from 'node:assert/strict';
import {referencePixelAt,sampleReferencePixel} from '../services/reference-sampling.mjs';
const box={x:20,y:30,width:100,height:100,cell:10};
test('contain maps source and excludes letterboxing',()=>{
  assert.deepEqual(referencePixelAt({x:70,y:80},200,100,box),{x:100,y:50});
  assert.equal(referencePixelAt({x:70,y:40},200,100,box),null);
});
test('cover uses the same cropped renderer layout',()=>{
  assert.deepEqual(referencePixelAt({x:20,y:30},200,100,box,{fit:'cover'}),{x:50,y:0});
  assert.equal(referencePixelAt({x:120,y:80},200,100,box,{fit:'cover'}),null);
});
test('scale and offsets follow cell-scaled renderer displacement',()=>{
  assert.deepEqual(referencePixelAt({x:80,y:70},100,100,box,{scale:2,offsetX:1,offsetY:-1}),{x:50,y:50});
});
test('zoom and pan expressed by the renderer box preserve sampled pixel',()=>{
  assert.deepEqual(referencePixelAt({x:140,y:160},200,100,{x:40,y:60,width:200,height:200,cell:20}),{x:100,y:50});
});
test('display opacity does not affect raw coordinates or RGB',()=>{
  const point={x:70,y:80};
  assert.deepEqual(referencePixelAt(point,100,100,box,{opacity:0}),referencePixelAt(point,100,100,box,{opacity:100}));
  assert.deepEqual(sampleReferencePixel({width:1,height:1,data:new Uint8ClampedArray([10,20,30,128])},{x:0,y:0}),{rgb:[10,20,30],alpha:128,x:0,y:0});
});
test('transparent and invalid samples have no material color',()=>{
  const image={width:1,height:1,data:new Uint8ClampedArray([10,20,30,0])};
  assert.equal(sampleReferencePixel(image,{x:0,y:0}),null);
  assert.equal(sampleReferencePixel(image,{x:1,y:0}),null);
  assert.equal(referencePixelAt({x:NaN,y:0},1,1,box),null);
});
