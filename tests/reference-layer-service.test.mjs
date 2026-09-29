import test from "node:test";
import assert from "node:assert/strict";
import { referenceLayout,moveReference } from "../services/reference-layer-service.js";
const box={x:10,y:20,width:200,height:100,cell:5};
test("contain preserves landscape portrait and square aspect ratios",()=>{for(const [w,h] of [[400,100],[100,400],[200,200]]){const r=referenceLayout(w,h,box);assert.ok(Math.abs(r.width/r.height-w/h)<1e-9);assert.ok(r.width<=box.width&&r.height<=box.height);}});
test("cover fills grid without changing aspect ratio",()=>{const r=referenceLayout(400,100,box,{fit:"cover"});assert.ok(r.width>=box.width&&r.height>=box.height);assert.equal(r.width/r.height,4);});
test("offset is document-space and therefore follows zoom cell size",()=>{const a=referenceLayout(100,100,{...box,cell:5},{offsetX:2,offsetY:-1}),b=referenceLayout(100,100,{...box,cell:40},{offsetX:2,offsetY:-1});assert.equal(b.x-a.x,70);assert.equal(b.y-a.y,-35);});
test("move converts screen delta to grid coordinates and never touches unrelated state",()=>{assert.deepEqual(moveReference({offsetX:1,offsetY:2,visible:true},40,-20,10),{offsetX:5,offsetY:0,visible:true});});
test("scale is centered and clamped",()=>{assert.equal(referenceLayout(100,100,box,{scale:2}).width,200);assert.equal(referenceLayout(100,100,box,{scale:99}).width,400);});
