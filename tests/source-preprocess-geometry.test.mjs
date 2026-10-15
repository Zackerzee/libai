import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {defaultSourceTransform,canonicalizeSourceTransform,transformSourceOrientation,sourceOutputGeometry,renderSourceTransform,renderSourceOrientation} from '../services/source-editor-service.js';
let native;
try{native=createRequire(import.meta.url)('@napi-rs/canvas');}catch{try{native=createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas');}catch{}}
const approx=(a,b)=>{for(const k of ['x','y','width','height'])assert.ok(Math.abs(a[k]-b[k])<1e-10,`${k}: ${a[k]} vs ${b[k]}`);};
test('normalized crop follows display rotations and inverse rotations without changing input',()=>{
 const original={...defaultSourceTransform(),crop:{x:.1,y:.2,width:.3,height:.4}};
 const right=transformSourceOrientation(original,'rotate-right',100,80);
 approx(right.crop,{x:.4,y:.1,width:.4,height:.3});
 approx(transformSourceOrientation(right,'rotate-left',100,80).crop,original.crop);
 assert.equal(original.rotation,0);assert.equal(original.crop.x,.1);
});
test('flip maps normalized crop in the visible orientation and is reversible',()=>{
 const t={...defaultSourceTransform(),rotation:90,crop:{x:.1,y:.2,width:.3,height:.4}};
 const h=transformSourceOrientation(t,'flip-horizontal',100,80);
 approx(h.crop,{x:.6,y:.2,width:.3,height:.4});approx(transformSourceOrientation(h,'flip-horizontal',100,80).crop,t.crop);
 const v=transformSourceOrientation(t,'flip-vertical',100,80);approx(v.crop,{x:.1,y:.4,width:.3,height:.4});
});
test('legacy source crop/flip migrates to oriented coordinates, retaining dimensions',()=>{
 const t=canonicalizeSourceTransform({rotation:90,flipX:true,crop:{x:0,y:0,width:2,height:1}},4,2);
 assert.equal(t.flipX,false);assert.equal(t.flipY,true);approx(t.crop,{x:.5,y:.5,width:.5,height:.5});
 const g=sourceOutputGeometry(4,2,t);assert.equal(g.width,1);assert.equal(g.height,2);
});
function withCanvas(fn){const prev=globalThis.document;globalThis.document={createElement(){const c=native.createCanvas(1,1),ctx=c.getContext('2d'),get=ctx.getImageData.bind(ctx);ctx.getImageData=(x,y,w,h)=>get(x,y,w,h);return c;}};try{fn();}finally{globalThis.document=prev;}}
function source(){const c=native.createCanvas(4,2),ctx=c.getContext('2d');for(const [x,y,color]of [[0,0,'#ff0000'],[2,0,'#00ff00'],[0,1,'#0000ff'],[2,1,'#ffff00']]){ctx.fillStyle=color;ctx.fillRect(x,y,2,1);}return c;}
const pixels=c=>Array.from(c.getContext('2d').getImageData(0,0,c.width,c.height).data);
test('all orientation actions preserve the chosen original quadrant through crop', {skip:!native},()=>withCanvas(()=>{
 const img=source(),t={...defaultSourceTransform(),crop:{x:0,y:0,width:.5,height:.5}};
 for(const action of ['rotate-left','rotate-right','flip-horizontal','flip-vertical']){
  const out=renderSourceTransform(img,transformSourceOrientation(t,action,4,2));
  for(let i=0;i<pixels(out).length;i+=4)assert.deepEqual(pixels(out).slice(i,i+4),[255,0,0,255],action);
 }
}));
test('crop after rotation corresponds exactly to oriented preview; reset and re-edit retain source', {skip:!native},()=>withCanvas(()=>{
 const img=source(),t=transformSourceOrientation(defaultSourceTransform(),'rotate-right',4,2),full=renderSourceOrientation(img,t);
 const crop={...t,crop:{x:0,y:0,width:.5,height:.5}},out=renderSourceTransform(img,crop);
 assert.deepEqual(pixels(out),[0,0,255,255,0,0,255,255]);
 assert.deepEqual(pixels(renderSourceTransform(img,{...crop,crop:null})),pixels(full));
 assert.deepEqual(pixels(renderSourceTransform(img,crop)),pixels(out));assert.equal(img.width,4);
}));
test('cached canvases cannot be corrupted by external mutation and image identity isolates uploads',{skip:!native},()=>withCanvas(()=>{
 const img=source(),t=defaultSourceTransform(),first=renderSourceTransform(img,t),expected=pixels(first);
 first.getContext('2d').clearRect(0,0,4,2);assert.deepEqual(pixels(renderSourceTransform(img,t)),expected);
 const preview=renderSourceOrientation(img,t);preview.getContext('2d').clearRect(0,0,4,2);assert.deepEqual(pixels(renderSourceOrientation(img,t)),expected);
 const other=native.createCanvas(4,2);assert.ok(pixels(renderSourceTransform(other,t)).every(x=>x===0));
}));
test('all legacy rotation and flip combinations retain the original crop-before-orientation pixels',{skip:!native},()=>withCanvas(()=>{
 const img=source();
 for(const rotation of [0,90,180,270])for(const flipX of [false,true])for(const flipY of [false,true]){
  const old={rotation,flipX,flipY,crop:{x:1,y:0,width:3,height:2}},out=renderSourceTransform(img,old);
  const expected=native.createCanvas(rotation%180?2:3,rotation%180?3:2),ctx=expected.getContext('2d');
  ctx.translate(expected.width/2,expected.height/2);ctx.rotate(rotation*Math.PI/180);ctx.scale(flipX?-1:1,flipY?-1:1);ctx.drawImage(img,1,0,3,2,-1.5,-1,3,2);
  assert.deepEqual(pixels(out),pixels(expected),JSON.stringify(old));
 }
}));
test('all sequential visible transforms retain crop pixels, including existing flips',{skip:!native},()=>withCanvas(()=>{
 const img=source();
 for(const rotation of [0,90,180,270])for(const flipX of [false,true])for(const flipY of [false,true]){
  const t={...defaultSourceTransform(),rotation,flipX,flipY,crop:{x:0,y:0,width:.5,height:.5}};
  const before=renderSourceTransform(img,t);
  for(const action of ['rotate-left','rotate-right','flip-horizontal','flip-vertical']){
   const after=renderSourceTransform(img,transformSourceOrientation(t,action,4,2));
   const neutral=defaultSourceTransform(),actionOnly=transformSourceOrientation(neutral,action,before.width,before.height);
   assert.deepEqual(pixels(after),pixels(renderSourceTransform(before,actionOnly)),JSON.stringify([t,action]));
  }
 }
}));
