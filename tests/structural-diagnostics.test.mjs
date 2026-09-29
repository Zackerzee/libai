import test from "node:test";
import assert from "node:assert/strict";
import { buildColorComponents, neighborProfile, detectIsolatedPixels, detectTinyRegions, detectEdgeContamination, buildStructuralDiagnostics } from "../services/structural-diagnostics.js";

const color=(paletteId,code=paletteId,rgb=[0,0,0])=>({paletteId,code,rgb,hex:"#000"});
const A=color("brand:A","A",[20,20,20]), B=color("brand:B","B",[220,20,20]), C=color("brand:C","C",[20,20,20]);
const grid=(rows)=>rows.map((row)=>[...row].map((v)=>v==="A"?A:v==="B"?B:v==="C"?C:null));

test("isolated pixel detects a center anomaly with dominant 8-neighborhood",()=>{
  const g=grid(["AAA","ABA","AAA"]), index=buildColorComponents(g);
  const found=detectIsolatedPixels(g,index);
  assert.equal(found.length,1); assert.equal(found[0].paletteId,"brand:B");
  assert.equal(found[0].meta.dominantNeighborCount,8);
});

test("two or more same neighbors and continuous details are not isolated",()=>{
  const g=grid(["AAA","ABB","AAB"]);
  assert.equal(detectIsolatedPixels(g,buildColorComponents(g)).length,0);
});

test("corner cells never overflow and dominant profile is correct",()=>{
  const g=grid(["BA","AA"]), profile=neighborProfile(g,0,0);
  assert.equal(profile.neighborCount,3); assert.equal(profile.dominantNeighborPaletteId,"brand:A"); assert.equal(profile.dominantNeighborCount,3);
});

test("tiny components split same palette regions and use 4-connectivity",()=>{
  const g=grid(["AAB", "ABB", "BBA"]), index=buildColorComponents(g,{connectivity:4});
  const a=index.components.filter((item)=>item.paletteId==="brand:A").map((item)=>item.size).sort();
  assert.deepEqual(a,[1,3]);
  assert.equal(detectTinyRegions(g,index,{maxSize:3}).filter((i)=>i.paletteId==="brand:A").length,2);
  assert.equal(detectTinyRegions(g,index,{maxSize:2}).some((i)=>i.meta.componentSize===3),false);
});

test("same RGB but different paletteId never merges components",()=>{
  const g=[[A,C]], index=buildColorComponents(g);
  assert.equal(index.components.length,2);
});

test("globally frequent palette can have a local tiny region",()=>{
  const g=grid(["AAAAAB","AAAAAB","BBBBBA"]), result=buildStructuralDiagnostics(g,[A,B]);
  assert.ok(result.tiny.some((issue)=>issue.paletteId==="brand:A"&&issue.meta.componentSize===1));
});

test("edge contamination detects small surrounded color but not a normal large boundary",()=>{
  const contaminated=grid(["AAAAA","AAAAA","AABAA","AAAAA","AAAAA"]);
  const found=detectEdgeContamination(contaminated,buildColorComponents(contaminated),[A,B]);
  assert.equal(found.length,1); assert.equal(found[0].meta.dominantNeighborPaletteId,"brand:A"); assert.equal(found[0].severity,"high");
  const normal=grid(["AAABB","AAABB","AAABB"]);
  assert.equal(detectEdgeContamination(normal,buildColorComponents(normal),[A,B]).length,0);
  const diagonalDetail=grid(["BAA","ABA","AAA"]);
  assert.equal(detectEdgeContamination(diagonalDetail,buildColorComponents(diagonalDetail),[A,B]).length,0,"斜向连续细节不应被当成边缘污染");
});

test("structural diagnostics are deterministic and never mutate the grid",()=>{
  const g=grid(["AAA","ABA","AAA"]), before=g.map((row)=>row.slice());
  const one=buildStructuralDiagnostics(g,[A,B]), two=buildStructuralDiagnostics(g,[A,B]);
  assert.deepEqual(one.edge,two.edge); assert.deepEqual(g,before);
});
