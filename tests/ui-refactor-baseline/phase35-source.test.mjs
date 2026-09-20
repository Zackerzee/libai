import test from "node:test";
import assert from "node:assert/strict";
import { defaultSourceTransform, normalizeSourceCrop, cropFromDrag, sourceOutputGeometry, hasSourceTransform } from "../../services/source-editor-service.js";

test("source transform defaults leave the uploaded file untouched", () => {
  const transform=defaultSourceTransform();
  assert.equal(hasSourceTransform(transform),false);
  assert.deepEqual(sourceOutputGeometry(400,300,transform).crop,{x:0,y:0,width:400,height:300});
});

test("free crop, 1:1 crop, rotation and canvas expansion report actual processed dimensions", () => {
  assert.deepEqual(normalizeSourceCrop({x:40,y:20,width:120,height:100},400,300),{x:40,y:20,width:120,height:100});
  const square=cropFromDrag(.1,.1,.7,.9,400,300,"1:1"); assert.ok(Math.abs(square.width-square.height)<=1);
  const transformed={...defaultSourceTransform(),crop:{x:40,y:20,width:120,height:100},rotation:90,expand:{top:10,bottom:20,left:30,right:40}};
  assert.deepEqual([sourceOutputGeometry(400,300,transformed).width,sourceOutputGeometry(400,300,transformed).height],[170,150]);
  assert.equal(hasSourceTransform(transformed),true);
});
