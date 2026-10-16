import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {auroraSignatureInk,drawAuroraArtworkDepth,renderPosterArtworkCanvas} from '../services/poster-export-service.js';
import {renderPosterCanvas} from '../services/export-v2-service.js';
const red={code:'F03',rgb:[247,73,65]},blue={code:'C06',rgb:[80,170,240]};
test('aurora signature chooses contrasting light or dark ink from actual background',()=>{
  const dark=auroraSignatureInk([85,73,128]),light=auroraSignatureInk([235,217,232]);assert.equal(dark.color,'#fff9f2');assert.equal(light.color,'#17111f');assert.ok(dark.contrast>5);assert.ok(light.contrast>10);
});
test('depth respects alpha outline and uses lower light strength for solid photographs',()=>{
  const draws=[],stack=[],ctx={save(){stack.push({globalAlpha:this.globalAlpha,filter:this.filter,shadowColor:this.shadowColor});},restore(){Object.assign(this,stack.pop());},drawImage(...v){draws.push({v,alpha:this.globalAlpha,filter:this.filter,shadow:this.shadowColor});},globalAlpha:1,filter:'none'};
  const box={x:40,y:60,width:300,height:400},art={};drawAuroraArtworkDepth(ctx,art,box,{transparent:true});assert.equal(draws[0].alpha,.06);assert.deepEqual(draws[0].v,[art,40,68,300,400]);assert.equal(draws[0].filter,'blur(12px)');assert.equal(draws[1].shadow,'#34234d24');assert.equal(ctx.globalAlpha,1);assert.equal(ctx.filter,'none');
  draws.length=0;drawAuroraArtworkDepth(ctx,art,box);assert.equal(draws[0].alpha,.03);assert.equal(draws[1].shadow,'#34234d18');
});
test('actual transparent artwork and solid photo foreground stay exact under aurora lightfield',async()=>{
  const native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas'),previous=globalThis.document;
  globalThis.document={createElement(){const c=native.createCanvas(1,1);c.dataset={};return c;}};
  try{
    const grid=[[null,null,null],[null,red,null],[null,null,null]],before=structuredClone(grid),art=renderPosterArtworkCanvas(grid);
    assert.equal(art.getContext('2d').getImageData(1,1,1,1).data[3],0);
    const poster=await renderPosterCanvas(grid,{background:'aurora',showLogo:false},{},{width:1500});assert.deepEqual([...poster.getContext('2d').getImageData(750,950,1,1).data],[247,73,65,255]);assert.deepEqual(grid,before);
    const photo=await renderPosterCanvas([[blue,blue],[red,red]],{background:'aurora',showLogo:false},{},{width:1500});assert.deepEqual([...photo.getContext('2d').getImageData(650,850,1,1).data],[80,170,240,255]);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
