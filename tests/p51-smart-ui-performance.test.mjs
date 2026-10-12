import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyUiPerformance, assertPreviewAndPublication } from '../tools/smart-tolerance-p51-performance-checks.mjs';
const record = duration => ({mode:'cold',previewExact:true,previewSideEffectsAbsent:true,undoExact:true,redoExact:true,
  phases:{enable:{longestTaskMs:duration},apply:{longestTaskMs:40,renders:[{}]},slider:{longestTaskMs:30}}});
test('enable and apply long-task regressions cannot be certified below the requested gate',()=>{
  assert.equal(classifyUiPerformance([record(99)]).gate,'PASS');
  assert.equal(classifyUiPerformance([record(100)]).gate,'BORDERLINE');
  assert.equal(classifyUiPerformance([record(150)]).gate,'BORDERLINE');
  assert.equal(classifyUiPerformance([record(151)]).gate,'FAIL');
  const apply = record(40);apply.phases.apply.longestTaskMs=160;
  assert.equal(classifyUiPerformance([apply]).gate,'FAIL');
});
test('publication certification rejects preview side effects and duplicate final renders',()=>{
  assert.doesNotThrow(()=>assertPreviewAndPublication(record(40)));
  const sideEffect=record(40);sideEffect.previewSideEffectsAbsent=false;
  assert.throws(()=>assertPreviewAndPublication(sideEffect),/equivalence/);
  const renders=record(40);renders.phases.apply.renders.push({});
  assert.throws(()=>assertPreviewAndPublication(renders),/one final/);
});
