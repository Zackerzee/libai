import test from 'node:test';
import assert from 'node:assert/strict';
import { applyBudgetPlan } from '../smart-preprocessing/protected-palette-budget-v2.mjs';

for (const plan of [
 [{from:'A',to:'B'},{from:'C',to:'B'}],
 [{from:'A',to:'B'},{from:'B',to:'C'}],
 [{from:'A',to:'C'},{from:'B',to:'C'}],
]) test(`cached flatten preserves dynamic row-major lookup for ${JSON.stringify(plan)}`,()=>{
 const initial=[[{code:'A',rgb:[220,0,0],name:'A-name',hex:'#dc0000'},null,{code:'B',rgb:[0,200,0]}],[{code:'C',rgb:[0,0,200],name:'C-name',hex:'#0000c8'},{code:'A',rgb:[220,0,0]}]];
 const old=structuredClone(initial),optimized=structuredClone(initial);
 const before=applyBudgetPlan(old,c=>c.code,plan,key=>old.flat().find(c=>c?.code===key));
 const flat=optimized.flat();
 const after=applyBudgetPlan(optimized,c=>c.code,plan,key=>flat.find(c=>c?.code===key));
 assert.deepEqual(after,before);
 assert.ok(after.applied>0);
 assert.deepEqual(optimized,old);
 assert.equal(optimized[0][1],null);
});
