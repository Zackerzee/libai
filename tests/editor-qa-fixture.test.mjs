import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const fixtureUrl=new URL("./fixtures/editor-104x104.libms-project",import.meta.url);
const load=async()=>JSON.parse(await readFile(fixtureUrl,"utf8"));

test("fixed browser QA project uses the existing 104x104 project contract",async()=>{
  const project=await load();
  assert.equal(project.format,"libms-project"); assert.equal(project.version,1);
  assert.deepEqual(project.canvas,{width:104,height:104}); assert.equal(project.grid.length,104);
  assert.ok(project.grid.every((row)=>row.length===104)); assert.ok(project.colors.length>=20);
});

test("fixed browser QA project contains empty, closed, diagonal, identity and diagnostic samples",async()=>{
  const project=await load(), byCode=new Map(project.colors.map((color)=>[color.code,color]));
  assert.equal(project.grid[0][0],null);
  assert.equal(project.grid[18][18],"QA05"); assert.equal(project.grid[19][19],"QA06");
  assert.equal(project.grid[45][12],"QA12"); assert.equal(project.grid[72][39],"QA12");
  assert.deepEqual(byCode.get("QA23").rgb,byCode.get("QA24").rgb); assert.notEqual("QA23","QA24");
  assert.equal(project.grid[85][85],"QA22"); assert.equal(project.grid[84][84],"QA04");
});
