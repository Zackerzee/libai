import test from 'node:test';
import assert from 'node:assert/strict';
import { generateV2 } from '../smart-preprocessing/generation-engine-v2.mjs';
import { createSmartColorTolerance, restoreSmartColorTolerance } from '../services/smart-color-tolerance.mjs';
import { createSmartToleranceSession } from '../services/smart-tolerance-session.mjs';
import { applySmartToleranceBudget } from '../services/smart-tolerance-budget.mjs';
import { toEngineOptions, MODE_PROFILES } from '../services/mode-profile.mjs';
import { ProtectionTier } from '../smart-preprocessing/detail-protection-v2.mjs';

const palette = [{ code: 'A', paletteId: 'brand:A', rgb: [120,120,120] },
  { code: 'B', paletteId: 'brand:B', rgb: [121,121,121] }, { code: 'C', paletteId: 'brand:C', rgb: [200,60,50] }];
function run(tolerance, extra = {}) {
  const width = 12, height = 12, data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([...palette[(i % width) < 5 ? 0 : (i % width) < 10 ? 1 : 2].rgb,255],i*4);
  return generateV2({ source: { data,width,height },width,height,palette,
    options: { sampling: 'center', ...extra, ...(tolerance ? { smartColorTolerance:tolerance } : {}) } });
}
const config = strength => ({enabled:true,strength,policy:'quality-first'});
test('missing and disabled tolerance preserve every production cell and diagnostic field shape', () => {
  for (const maxColors of [0,1,2]) {
    const before = run(null,{maxColors});
    const after = run({enabled:false,strength:100,policy:'quality-first'},{maxColors});
    assert.deepEqual(after.grid,before.grid);
    assert.deepEqual(Object.keys(after.diagnostics),Object.keys(before.diagnostics));
    assert.equal(after.diagnostics.smartToleranceBaseline,undefined);
  }
});
test('strength zero retains true prebudget baseline; budget replay matches final matrix', () => {
  const out = run(config(0),{maxColors:1});
  const baseline = out.diagnostics.smartToleranceBaseline;
  assert.ok(Object.isFrozen(baseline.grid[0][0].rgb));
  assert.throws(() => {baseline.grid[0][0].rgb[0]=0;},TypeError);
  const original = structuredClone(baseline.grid);
  const evaluated = createSmartColorTolerance({baselineGrid:baseline.grid,palette:baseline.palette,protection:baseline.protection}).evaluate(0);
  assert.deepEqual(evaluated.grid,baseline.grid);
  applySmartToleranceBudget({grid:evaluated.grid,protection:baseline.protection,cfg:baseline.budgetConfig});
  assert.deepEqual(evaluated.grid,out.grid);
  assert.deepEqual(baseline.grid,original);
  assert.equal(out.diagnostics.smartColorTolerance.mergedByBudget,
    out.diagnostics.smartColorTolerance.colorsAfterTolerance-out.diagnostics.smartColorTolerance.colorsAfterBudget);
  assert.equal(out.diagnostics.smartColorTolerance.forcedProtected,out.diagnostics.forcedProtectedMerges);
  assert.match(out.diagnostics.smartColorTolerance.notice,/hard palette budget subsequently forced additional merges/);
});
test('all strength levels share baseline revision and tolerance count is monotonic', () => {
  let count=Infinity, revision;
  for (const strength of [0,20,40,60,80,100]) {
    const result=run(config(strength));
    const report=result.diagnostics.smartColorTolerance;
    revision ??= report.baselineRevision;
    assert.equal(report.baselineRevision,revision);
    assert.ok(report.colorsAfterTolerance<=count);
    count=report.colorsAfterTolerance;
  }
});
test('mode options forward opt-in separately from legacy cleanup strength', () => {
  const options=toEngineOptions({...MODE_PROFILES.photo,smartColorTolerance:config(50)});
  assert.deepEqual(options.smartColorTolerance,config(50));
  assert.equal(options.cleanupProtectionThreshold,0.4);
});
test('unknown policy fails explicitly only when enabled', () => {
  assert.throws(()=>run({enabled:true,strength:10,policy:'hard-limit'}),/quality-first/);
  assert.doesNotThrow(()=>run({enabled:false,strength:10,policy:'hard-limit'}));
});
test('hard budget retains legal target identity even across same code brands', () => {
  const colors=[{code:'A',paletteId:'one:A',rgb:[20,20,20]}, {code:'A',paletteId:'two:A',rgb:[21,21,21]}];
  const grid=[[structuredClone(colors[0]),structuredClone(colors[1])]];
  const out=applySmartToleranceBudget({grid,protection:{protectionMap:[1,1],tierMap:[ProtectionTier.CRITICAL,ProtectionTier.CRITICAL]},cfg:{maxColors:1}});
  assert.equal(out.forcedProtectedMerges,1);
  assert.equal(new Set(grid.flat().map(cell=>cell.paletteId)).size,1);
  for (const cell of grid.flat()) assert.deepEqual(cell,colors.find(color=>color.paletteId===cell.paletteId));
});
test('baseline revision changes for cleanup/protection/context and accent settings', () => {
  const original=run(config(0)).diagnostics.smartToleranceBaseline.baselineRevision;
  for (const change of [{cleanupProtectionThreshold:0.9},{detailProtection:0.9},{smartToleranceContext:{sourceRevision:2}}, {accentProtection:true}]) {
    assert.notEqual(run(config(0),change).diagnostics.smartToleranceBaseline.baselineRevision,original);
  }
});
test('engine compiled hierarchy replays 0/20/50/80/0 without repeating hierarchy or protection analysis', async () => {
  const phases=[];
  const out=run(config(0),{onPhase:name=>phases.push(name)});
  const capturedPhases=[...phases], baseline=out.diagnostics.smartToleranceBaseline;
  const compiled=out.diagnostics.smartToleranceHierarchy;
  const expected=restoreSmartColorTolerance({baselineGrid:baseline.grid,palette:baseline.palette,compiled});
  let requestId=0, observedController;
  const commits=[];
  const session=createSmartToleranceSession({
    isCurrent:(id,revision)=>id===requestId && revision===baseline.baselineRevision,
    commit:value=>commits.push(value),
    compute:(controller,strength)=>{
      observedController ??= controller;
      assert.equal(controller,observedController);
      return controller.evaluate(strength);
    },
  });
  // Invalid raw protection deliberately cannot build V1. Compiled frozen evidence
  // must suffice for replay; maxColors=0 does not read protection during budget.
  session.adoptBaseline({...baseline,protection:{}},baseline.context,structuredClone(compiled));
  for(const strength of [0,20,50,80,0]) {
    requestId++;
    const result=await session.evaluate({strength,requestId,baselineRevision:baseline.baselineRevision});
    assert.equal(result.committed,true);
    assert.deepEqual(result.grid,expected.evaluate(strength).grid);
  }
  assert.equal(commits.length,5);
  assert.deepEqual(phases,capturedPhases);
  assert.deepEqual(commits.at(-1).grid,baseline.grid);
  assert.equal(commits.at(-1).diagnostics.smartColorTolerance.cacheHit,true);
});
test('compiled controller restores exact evaluations and isolates serialized data', () => {
  const out=run(config(50));
  const baseline=out.diagnostics.smartToleranceBaseline;
  const original=createSmartColorTolerance({baselineGrid:baseline.grid,palette:baseline.palette,protection:baseline.protection});
  const compiled=original.getCompiledHierarchy();
  const restored=restoreSmartColorTolerance({baselineGrid:baseline.grid,palette:baseline.palette,compiled});
  compiled.protectedCells.fill(false); compiled.steps.length=0;
  for(const strength of [0,20,50,80,100]) assert.deepEqual(restored.evaluate(strength),original.evaluate(strength));
});
