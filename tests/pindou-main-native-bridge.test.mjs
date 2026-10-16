import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { materializePindouResult, runPindouWorker } from '../services/pindou-worker-client.mjs';
import { resolvePindouAspect } from '../src/algorithms/pindou-full/config.mjs';
const app=fs.readFileSync(new URL('../app.js',import.meta.url),'utf8');
const fixture={w:2,h:2,idx:new Int32Array([0,1,-1,0]),sub:[{paletteId:'a:X',code:'X',rgb:[1,2,3]},{paletteId:'b:X',code:'X',rgb:[1,2,3]}],counts:[2,1],config:{colors:2},metrics:{sampling:1}};
test('materialization preserves dimensions, nulls, counts, and same-RGB identities',async()=>{
 const native=await materializePindouResult(fixture);
 assert.equal(native.grid[0][0].paletteId,'a:X');assert.equal(native.grid[0][1].paletteId,'b:X');assert.equal(native.grid[1][0],null);
 assert.deepEqual(native.stats.map(c=>c.count),[2,1]);assert.equal(native.width,2);assert.equal(native.height,2);
 native.grid[0][0].rgb[0]=99;assert.equal(native.originalGrid[0][0].rgb[0],1);assert.equal(fixture.sub[0].rgb[0],1);
});
test('materialization yields and rejects obsolete revisions',async()=>{
 let current=true,yields=0;
 await assert.rejects(materializePindouResult({...fixture,w:4,h:2,idx:new Int32Array(8)},{chunkCells:2,isCurrent:()=>current,yieldTask:()=>{yields++;current=false;}}),{name:'StaleGenerationError'});
 assert.equal(yields,1);
});
test('native route precedes PW/BGS and never invokes V2.5 generation stages',()=>{
 const body=app.slice(app.indexOf('async function processProductionPindou'),app.indexOf('async function processImage('));
 assert.doesNotMatch(body,/processImageV2\(|applyFinalPaletteBudget\(|runAutoTuneV2\(/);
 const route=app.slice(app.indexOf('async function processImage('),app.indexOf('async function processImage(')+550);
 assert.ok(route.indexOf('processProductionPindou')<route.indexOf('processProductionPw'));
 assert.match(body,/if \(!current\(\)\) throw generationOutcomeError\("stale"\)/);
});
test('source ratio, rotation, crop and unlocked explicit dimensions synchronize correctly',()=>{
 assert.equal(resolvePindouAspect({gridW:64},200,100).gridH,32);
 assert.equal(resolvePindouAspect({gridW:64,rotate:90},200,100).gridH,128);
 assert.equal(resolvePindouAspect({gridW:64,crop:{x:0,y:0,w:0.5,h:1}},200,100).gridH,64);
 assert.equal(resolvePindouAspect({gridW:52,gridH:78,lockAspect:false},200,100).gridH,78);
});
test('worker cancellation terminates obsolete computation without fallback',async()=>{
 const saved={Worker:globalThis.Worker,createImageBitmap:globalThis.createImageBitmap,fetch:globalThis.fetch};let terminated=0,current=true;
 try{
 globalThis.fetch=async()=>({blob:async()=>({})});globalThis.createImageBitmap=async()=>({close(){}});
 globalThis.Worker=class{postMessage(){current=false;}terminate(){terminated++;}};
 await assert.rejects(runPindouWorker({source:'fixture',palette:[],config:{}},{isCurrent:()=>current}),{name:'StaleGenerationError'});assert.equal(terminated,1);
 }finally{Object.assign(globalThis,saved);}
});
test('worker transport errors release bitmap and worker resources',async()=>{
 const saved={Worker:globalThis.Worker,createImageBitmap:globalThis.createImageBitmap,fetch:globalThis.fetch};let closed=0,terminated=0;
 try{
 globalThis.fetch=async()=>({blob:async()=>({})});globalThis.createImageBitmap=async()=>({close(){closed++;}});
 globalThis.Worker=class{postMessage(){throw new Error('transport failed');}terminate(){terminated++;}};
 await assert.rejects(runPindouWorker({source:'fixture',palette:[],config:{}}),/transport failed/);assert.equal(closed,1);assert.equal(terminated,1);
 }finally{Object.assign(globalThis,saved);}
});
