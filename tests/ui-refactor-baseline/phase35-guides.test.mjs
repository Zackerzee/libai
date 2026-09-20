import test from "node:test";
import assert from "node:assert/strict";
import { defaultGuides, boardGuidePositions, addGuide,moveGuide,removeGuide } from "../../services/guide-service.js";

test("board guides are overlay coordinates and do not touch grid",()=>{
  const grid=[[{code:"A03"}]];
  assert.deepEqual(boardGuidePositions(104,104,52),{vertical:[52],horizontal:[52]});
  let guides=addGuide(defaultGuides(),"vertical",20,104,104);
  guides=moveGuide(guides,"vertical",20,32,104,104);
  assert.deepEqual(guides.vertical,[32]);
  guides=removeGuide(guides,"vertical",32);
  assert.deepEqual(guides.vertical,[]); assert.equal(grid[0][0].code,"A03");
});
