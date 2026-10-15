import test from 'node:test';
import assert from 'node:assert/strict';
import {hitCrop,updateCropGesture,createSourceCropController,CROP_HANDLES,cropHandlePoints} from '../ui/source-crop-controller.mjs';
const crop={x:.2,y:.2,width:.5,height:.5},start={x:.4,y:.4},dimensions={width:400,height:600};
test('new free crop works in either drag direction',()=>{
  for(const [a,b] of [[{x:.1,y:.2},{x:.8,y:.7}],[{x:.8,y:.7},{x:.1,y:.2}]]){
    const c=updateCropGesture({mode:'new',start:a,crop:null},b,dimensions);assert.ok(Math.abs(c.x-.1)<1e-8);assert.ok(Math.abs(c.width-.7)<1e-8);
  }
});
test('move keeps crop dimensions and clamps all sides',()=>{
  for(const p of [{x:-3,y:-2},{x:3,y:2}]){const c=updateCropGesture({mode:'move',start,crop},p,dimensions);assert.equal(c.width,crop.width);assert.equal(c.height,crop.height);assert.ok(c.x>=0&&c.y>=0&&c.x+c.width<=1&&c.y+c.height<=1);}
});
for(const mode of CROP_HANDLES)test(`${mode} handle resizes within image and does not cross`,()=>{
  const c=updateCropGesture({mode,start,crop},{x:2,y:2},dimensions);assert.ok(c.width>=1/400&&c.height>=1/600);assert.ok(c.x>=0&&c.y>=0&&c.x+c.width<=1&&c.y+c.height<=1);
  const [x,y]=cropHandlePoints(crop)[mode];assert.equal(hitCrop(crop,{x,y},{width:400,height:600}),mode);
});
test('outside starts a new rectangle and interior moves',()=>{assert.equal(hitCrop(crop,{x:.01,y:.01},{width:400,height:600}),'new');assert.equal(hitCrop(crop,start,{width:400,height:600}),'move');});
for(const pointerType of ['mouse','touch','pen'])test(`${pointerType}: cancel rolls back; other pointer cannot modify or finish`,()=>{
  let current={...crop};const controller=createSourceCropController({getCrop:()=>current,getLayout:()=>({width:400,height:600}),getDimensions:()=>dimensions,setCrop:c=>current=c});
  assert.equal(controller.begin(start,1),true);assert.equal(controller.begin(start,2),false);assert.equal(controller.move({x:.6,y:.5},2),false);assert.deepEqual(current,crop);controller.move({x:.6,y:.5},1);assert.notDeepEqual(current,crop);assert.equal(controller.end(true,2),false);controller.end(true,1);assert.deepEqual(current,crop);
});
test('new crop cancellation restores null; committed crop can be edited again',()=>{
  let current=null;const c=createSourceCropController({getCrop:()=>current,getLayout:()=>({width:400,height:600}),getDimensions:()=>dimensions,setCrop:v=>current=v});
  c.begin({x:.1,y:.1},1);c.move({x:.7,y:.7},1);c.end(true,1);assert.equal(current,null);c.begin({x:.1,y:.1},1);c.move({x:.7,y:.7},1);c.end(false,1);const first={...current};c.begin({x:.4,y:.4},1);c.move({x:.5,y:.5},1);c.end(false,1);assert.notEqual(current.x,first.x);
});
test('new fixed ratio uses oriented pixel aspect',()=>{const c=updateCropGesture({mode:'new',start:{x:.1,y:.1},crop:null},{x:.8,y:.8},{...dimensions,ratio:'1:1'});assert.ok(Math.abs(c.width*400-c.height*600)<1e-8);});
test('every handle moves only the requested edges and leaves its input immutable',()=>{
  const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-10,`${a} != ${b}`);
  for(const mode of CROP_HANDLES){
    const before={...crop},[x,y]=cropHandlePoints(crop)[mode];
    const c=updateCropGesture({mode,start:{x,y},crop},{x:x+.05,y:y+.05},dimensions);
    close(c.x,crop.x+(mode.includes('w')?.05:0));close(c.y,crop.y+(mode.includes('n')?.05:0));
    close(c.x+c.width,crop.x+crop.width+(mode.includes('e')?.05:0));
    close(c.y+c.height,crop.y+crop.height+(mode.includes('s')?.05:0));assert.deepEqual(crop,before);
  }
});
test('all handles clamp negative and positive extremes with minimum one pixel',()=>{
  for(const mode of CROP_HANDLES)for(const p of [{x:-100,y:-100},{x:100,y:100}]){
    const [x,y]=cropHandlePoints(crop)[mode];const c=updateCropGesture({mode,start:{x,y},crop},p,dimensions);
    assert.ok(c.width>=1/400-1e-12&&c.height>=1/600-1e-12);assert.ok(c.x>=0&&c.y>=0&&c.x+c.width<=1+1e-12&&c.y+c.height<=1+1e-12);
  }
});
test('empty crop starts new and committed controller becomes inactive',()=>{
  assert.equal(hitCrop(null,{x:.5,y:.5},{width:400,height:600}),'new');let current=null;
  const c=createSourceCropController({getCrop:()=>current,getLayout:()=>({width:400,height:600}),getDimensions:()=>dimensions,setCrop:v=>current=v});
  assert.equal(c.active,false);c.begin({x:.1,y:.1},1);assert.equal(c.active,true);c.move({x:.6,y:.5},1);c.end(false,1);assert.equal(c.active,false);assert.ok(current);assert.equal(c.move({x:.8,y:.8},1),false);
});
