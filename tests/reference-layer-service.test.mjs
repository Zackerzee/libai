import test from "node:test";
import assert from "node:assert/strict";
import { referenceLayout,moveReference } from "../services/reference-layer-service.js";
const box={x:10,y:20,width:200,height:100,cell:5};
test("contain preserves landscape portrait and square aspect ratios",()=>{for(const [w,h] of [[400,100],[100,400],[200,200]]){const r=referenceLayout(w,h,box);assert.ok(Math.abs(r.width/r.height-w/h)<1e-9);assert.ok(r.width<=box.width&&r.height<=box.height);}});
test("cover fills grid without changing aspect ratio",()=>{const r=referenceLayout(400,100,box,{fit:"cover"});assert.ok(r.width>=box.width&&r.height>=box.height);assert.equal(r.width/r.height,4);});
test("offset is document-space and therefore follows zoom cell size",()=>{const a=referenceLayout(100,100,{...box,cell:5},{offsetX:2,offsetY:-1}),b=referenceLayout(100,100,{...box,cell:40},{offsetX:2,offsetY:-1});assert.equal(b.x-a.x,70);assert.equal(b.y-a.y,-35);});
test("move converts screen delta to grid coordinates and never touches unrelated state",()=>{assert.deepEqual(moveReference({offsetX:1,offsetY:2,visible:true},40,-20,10),{offsetX:5,offsetY:0,visible:true});});
test("scale is centered and clamped",()=>{assert.equal(referenceLayout(100,100,box,{scale:2}).width,200);assert.equal(referenceLayout(100,100,box,{scale:99}).width,400);});

// 用户 2026-10-16 实测诉求：「参考图是否可以自动和作品对齐大小」。
// stretch 档 = 直接把参考图拉伸成作品矩形的宽高（允许长宽比变形），
// 让参考图的每一格和作品的每一格逐格对上。
test("stretch makes the reference exactly match the artwork box (aspect ratio may distort)",()=>{
  const r=referenceLayout(400,100,box,{fit:"stretch"});
  assert.equal(r.width,box.width);
  assert.equal(r.height,box.height);
  assert.equal(r.x,box.x);
  assert.equal(r.y,box.y);
  // 另外两档必须仍保比例 —— stretch 不能污染 contain/cover。
  assert.equal(referenceLayout(400,100,box,{fit:"contain"}).width,200);
  assert.equal(referenceLayout(400,100,box,{fit:"cover"}).width,400);
});

test("stretch still composes with offset and scale (one-click align = stretch + zeroed offset)",()=>{
  const r=referenceLayout(400,100,{...box,cell:5},{fit:"stretch",scale:0.5,offsetX:2,offsetY:-1});
  assert.equal(r.width,100);
  assert.equal(r.height,50);
  assert.equal(r.x,10+(200-100)/2+2*5);
  assert.equal(r.y,20+(100-50)/2-1*5);
});
