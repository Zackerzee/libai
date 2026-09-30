import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { GENERATION_MODES, GENERATION_MODE_PRESETS, SAMPLING_STRATEGIES, resolveGenerationPipeline } from "../services/generation-pipeline.mjs";
import { createEditorService } from "../services/editor-service.js";

test("all public generation modes resolve to existing sampling strategies",()=>{
  assert.equal(GENERATION_MODES.length,8);
  for(const mode of GENERATION_MODES){assert.ok(GENERATION_MODE_PRESETS[mode]);assert.ok(SAMPLING_STRATEGIES.includes(resolveGenerationPipeline(mode).sampling));}
});
test("smart router adapts flat, textured, pixel and portrait inputs",()=>{
  assert.equal(resolveGenerationPipeline("auto",{flatRegionRatio:.8,edgeDensity:.2}).routedMode,"illustration");
  assert.equal(resolveGenerationPipeline("auto",{textureScore:.7,colorComplexity:.8}).routedMode,"photo");
  assert.equal(resolveGenerationPipeline("auto",{pixelLikeness:.8}).routedMode,"pixel");
  assert.equal(resolveGenerationPipeline("auto",{portraitLikeness:.8}).routedMode,"portrait");
});
test("advanced override wins without changing the shared preset",()=>{
  const resolved=resolveGenerationPipeline("logo",{}, {sampling:"center",cleanupStrength:12});
  assert.equal(resolved.sampling,"center");assert.equal(resolved.cleanupStrength,12);assert.equal(GENERATION_MODE_PRESETS.logo.sampling,"dominant");
});
test("ordinary workspace hides engines while Algorithm Lab retains them",()=>{
  const workspace=fs.readFileSync(new URL("../ui/workspace.js",import.meta.url),"utf8");
  const lab=fs.readFileSync(new URL("../algorithm-lab.html",import.meta.url),"utf8");
  const app=fs.readFileSync(new URL("../app.js",import.meta.url),"utf8");
  assert.doesNotMatch(workspace,/id="ws-algorithm"/);assert.doesNotMatch(workspace,/>BGS 算法</);assert.match(lab,/BGS.*PW.*HYBRID-PW/s);assert.match(app,/runAlgorithmAbTest/);assert.match(app,/runPwLab/);
});
test("multi-color merge uses paletteId and records one undo command",()=>{
  const colors=[{paletteId:"p:a",code:"A",rgb:[1,1,1]},{paletteId:"p:b",code:"B",rgb:[1,1,1]},{paletteId:"p:c",code:"C",rgb:[2,2,2]}];
  const result={width:3,height:1,grid:[[colors[0],colors[1],colors[2]]]};
  const bridge={getResult:()=>result,getPaletteColors:()=>colors,getCell:(x,y)=>result.grid[y][x],applyCellChanges(changes){for(const c of changes)result.grid[c.y][c.x]=c.after;return changes.length;}};
  const editor=createEditorService(bridge);
  assert.equal(editor.mergePaletteColors(["p:a","p:b"],"p:c"),true);
  assert.deepEqual(result.grid[0].map((c)=>c.paletteId),["p:c","p:c","p:c"]);assert.equal(editor.getHistory().length,1);
  editor.undo();assert.deepEqual(result.grid[0].map((c)=>c.paletteId),["p:a","p:b","p:c"]);
});
