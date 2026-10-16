import test from 'node:test';
import assert from 'node:assert/strict';
import {getSrgbContext,readSrgbImageData} from '../services/srgb-canvas.mjs';

test('sRGB context requests exact color space and reports actual browser attributes',()=>{
  const calls=[],context={getContextAttributes:()=>({colorSpace:'srgb'})};
  const result=getSrgbContext({getContext(...args){calls.push(args);return context;}},{willReadFrequently:true});
  assert.equal(result.context,context);assert.deepEqual(calls,[['2d',{colorSpace:'srgb',willReadFrequently:true}]]);
  assert.deepEqual(result.diagnostics,{requestedColorSpace:'srgb',canvasColorSpace:'srgb',contextFallback:false});
});
test('unsupported context option falls back preserving read-frequency and unknown stays unknown',()=>{
  const calls=[],context={};
  const result=getSrgbContext({getContext(...args){calls.push(args);if(calls.length===1)throw new TypeError('unsupported option');return context;}},{willReadFrequently:true});
  assert.equal(result.context,context);assert.deepEqual(calls[1],['2d',{willReadFrequently:true}]);assert.equal(result.diagnostics.contextFallback,true);assert.equal(result.diagnostics.canvasColorSpace,'unreported');
});
test('ignored color-space request never claims conversion to sRGB',()=>{
  const result=getSrgbContext({getContext:()=>({getContextAttributes:()=>({colorSpace:'display-p3'})})});
  assert.equal(result.diagnostics.canvasColorSpace,'display-p3');assert.equal(result.diagnostics.contextFallback,false);
  assert.throws(()=>getSrgbContext({getContext:()=>null}),/unavailable/);
});
test('sRGB image read requests settings and returns untouched original typed pixel data',()=>{
  const imageData={data:new Uint8ClampedArray([10,20,30,255]),width:1,height:1,colorSpace:'srgb'},calls=[];
  const result=readSrgbImageData({getImageData(...args){calls.push(args);return imageData;}},0,0,1,1);
  assert.deepEqual(calls,[[0,0,1,1,{colorSpace:'srgb'}]]);assert.equal(result.imageData,imageData);assert.equal(result.imageData.data,imageData.data);assert.equal(result.diagnostics.readFallback,false);assert.equal(result.diagnostics.imageDataColorSpace,'srgb');
});
test('older image read overload falls back without invented color-space guarantee',()=>{
  const calls=[],imageData={data:new Uint8ClampedArray(4)};
  const result=readSrgbImageData({getImageData(...args){calls.push(args);if(args.length===5)throw Object.assign(new Error('unsupported'),{name:'NotSupportedError'});return imageData;}},2,3,1,1);
  assert.deepEqual(calls[1],[2,3,1,1]);assert.equal(result.imageData,imageData);assert.equal(result.diagnostics.readFallback,true);assert.equal(result.diagnostics.imageDataColorSpace,'unreported');
});
test('tainted Canvas and invalid dimensions propagate instead of retrying',()=>{
  for(const name of ['SecurityError','IndexSizeError']){let calls=0;const error=Object.assign(new Error(name),{name});assert.throws(()=>readSrgbImageData({getImageData(){calls++;throw error;}},0,0,0,0),err=>err===error);assert.equal(calls,1);}
});
