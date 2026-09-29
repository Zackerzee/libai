import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { buildRamp, createPaletteMetricCache, stepDarker, stepLighter } from "../services/color-ramp-service.js";

const color=(id,rgb)=>({paletteId:`brand:${id}`,brand:"brand",code:id,rgb});
const palette=[color("BLACK",[0,0,0]),color("DARK",[60,20,20]),color("MID",[140,55,45]),color("LIGHT",[220,150,130]),color("WHITE",[255,255,255]),color("BLUE",[130,130,155])];

test("ramp contains the real base, uses only real identities, and is strictly lightness ordered",()=>{
  const ramp=buildRamp(palette,"brand:MID",{size:5});
  assert.ok(ramp.some(c=>c.paletteId==="brand:MID"));
  assert.ok(ramp.every(c=>palette.some(p=>p.paletteId===c.paletteId)));
  for(let i=1;i<ramp.length;i++)assert.ok(ramp[i].lightness>ramp[i-1].lightness);
  const base=ramp.findIndex(c=>c.paletteId==="brand:MID");
  assert.ok(ramp.slice(0,base).every(c=>c.lightness<ramp[base].lightness));
  assert.ok(ramp.slice(base+1).every(c=>c.lightness>ramp[base].lightness));
});

test("same-hue candidates outrank a different-hue distractor",()=>{
  const ramp=buildRamp(palette,"brand:MID",{size:3});
  assert.equal(ramp.some(c=>c.paletteId==="brand:BLUE"),false);
});

test("low chroma colors prefer a gray ramp",()=>{
  const grays=[color("B",[0,0,0]),color("G1",[70,70,70]),color("G2",[140,140,140]),color("G3",[210,210,210]),color("W",[255,255,255]),color("RED",[145,30,30])];
  assert.equal(buildRamp(grays,"brand:G2",{size:5}).some(c=>c.code==="RED"),false);
});

test("black and white allow asymmetric ramps and scarce palettes return fewer levels",()=>{
  assert.equal(buildRamp(palette,"brand:BLACK",{size:5})[0].paletteId,"brand:BLACK");
  assert.equal(buildRamp(palette,"brand:WHITE",{size:5}).at(-1).paletteId,"brand:WHITE");
  assert.equal(buildRamp([palette[0],palette[4]],"brand:BLACK",{size:7}).length,2);
});

test("shade steps clamp, and identities not in the ramp remain unchanged",()=>{
  const ids=["A","B","C","D","E"];
  assert.equal(stepDarker(ids,"C"),"B"); assert.equal(stepDarker(ids,"B"),"A"); assert.equal(stepDarker(ids,"A"),"A");
  assert.equal(stepLighter(ids,"C"),"D"); assert.equal(stepLighter(ids,"E"),"E"); assert.equal(stepLighter(ids,"X"),"X");
});

test("same RGB identities remain distinct and ramp building is deterministic and fast",()=>{
  const twins=[color("A",[100,100,100]),color("B",[100,100,100]),color("C",[180,180,180])];
  const cache=createPaletteMetricCache(twins); assert.equal(cache.size,3);
  const start=performance.now(),first=buildRamp(twins,"brand:A",{size:5,cache}),elapsed=performance.now()-start;
  assert.deepEqual(buildRamp(twins,"brand:A",{size:5,cache}).map(c=>c.paletteId),first.map(c=>c.paletteId));
  assert.ok(elapsed<10,`build took ${elapsed}ms`);
});
