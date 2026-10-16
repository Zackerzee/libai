import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createExportV2Service} from '../services/export-v2-service.js';

test('PNG service renders canonical grid, defaults to48 and reports real canvas and blob dimensions',async()=>{
  const savedDocument=globalThis.document,savedDpr=globalThis.devicePixelRatio;
  const calls=[],diagnostics=[];
  const context={fillRect(...args){calls.push(args);},fillText(){},measureText(){return {width:12};},drawImage(){throw new Error('preview scaling forbidden');},scale(){throw new Error('DPR scaling forbidden');}};
  let encoded;
  const canvas={getContext(){return context;},toBlob(callback,type){encoded=type;callback(new Blob(['png-bytes'],{type}));}};
  globalThis.document={createElement(tag){if(tag==='canvas')return canvas;return {click(){},remove(){}};},body:{append(){}}};
  globalThis.devicePixelRatio=3;
  try{
    const service=createExportV2Service({getGrid:()=>[[{code:'A06',rgb:[255,160,50]},null]],getTitle:()=> 'QA',getPaletteLabel:()=> 'MARD',onPngDiagnostic:value=>diagnostics.push(value)});
    assert.deepEqual(service.estimate(),{width:960,height:497,cellSize:48});
    assert.deepEqual(service.estimate('standard'),{width:480,height:249,cellSize:24});
    assert.deepEqual(service.estimate('ultra'),{width:1280,height:663,cellSize:64});
    assert.equal(await service.png(),canvas);
    assert.equal(encoded,'image/png');
    assert.deepEqual(calls[0],[0,0,960,497]);
    assert.deepEqual(diagnostics[0],{gridWidth:2,gridHeight:1,cellSize:48,exportWidth:960,exportHeight:497,'canvas.width':960,'canvas.height':497,DPR:3,fileSize:9});
  }finally{globalThis.document=savedDocument;if(savedDpr===undefined)delete globalThis.devicePixelRatio;else globalThis.devicePixelRatio=savedDpr;}
});

test('PNG UI and independent renderer contain no preview scaling or viewport inputs',()=>{
  const renderer=readFileSync(new URL('../services/png-pattern-export-renderer.js',import.meta.url),'utf8');
  assert.doesNotMatch(renderer,/\.drawImage\(|\.scale\(|\.transform\(|devicePixelRatio|viewport|canvas\.style/);
  const workspace=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  assert.match(workspace,/value="hd" selected>高清 · 48px\/格/);
  assert.match(workspace,/value="standard">标准 · 24px\/格/);
  assert.match(workspace,/value="ultra">超高清 · 64px\/格/);
});
