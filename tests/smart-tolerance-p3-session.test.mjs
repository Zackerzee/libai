import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartToleranceSession, useSmartToleranceSyncBuild } from '../services/smart-tolerance-session.mjs';
import { createSmartColorTolerance } from '../services/smart-color-tolerance.mjs';
import { freezeToleranceBaseline } from '../services/smart-tolerance-budget.mjs';
import { freezeToleranceBaselineAsync } from '../services/smart-tolerance-baseline-async.mjs';

const palette = [{ paletteId: 'kit:A', code: 'A', rgb: [100,100,100] },
  { paletteId: 'kit:B', code: 'B', rgb: [104,104,104] }];
function baseline(revision = 'one', key = 'kit', size = 4) {
  const grid = Array.from({ length: size }, (_, y) => Array.from({ length: size }, (_, x) => (x+y)%3 ? palette[0] : palette[1]));
  return { grid, palette, protection: { protectionMap: new Float32Array(size*size), tierMap: new Uint8Array(size*size) },
    baselineRevision: revision, algorithmVersion: 'v1-optin-1', budgetConfig: { maxColors: 0 },
    context: JSON.stringify({ palette: key, paletteContext: { paletteKey: key }, algorithmVersion: 'v1-optin-1' }) };
}

test('async baseline adoption freezes equivalent owned evidence including typed arrays', async () => {
  const value = baseline(), original = structuredClone(value);
  const result = await freezeToleranceBaselineAsync(value);
  assert.deepEqual(result, freezeToleranceBaseline(value));
  assert.equal(Object.isFrozen(result.grid[0][0].rgb), true);
  assert.equal(Object.isFrozen(result.protection.protectionMap), true);
  assert.deepEqual(value, original);
});

test('auto fast path uses measured cell and used-identity caps', () => {
  for (const size of [52,78,104]) assert.equal(useSmartToleranceSyncBuild(baseline('a','a',size).grid), true);
  for (const size of [250,500]) assert.equal(useSmartToleranceSyncBuild(baseline('a','a',size).grid), false);
  assert.equal(useSmartToleranceSyncBuild([Array.from({length:33},(_,i)=>({paletteId:`k:${i}`,code:String(i),rgb:[i,i,i]}))]), false);
});

test('small auto builds synchronously, publishes once, then reuses P2 compact cache', async () => {
  const value=baseline(), commits=[], reports=[];
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:r=>commits.push(r),onBuildProfile:r=>reports.push(r)});
  session.adoptBaseline(value);
  assert.equal(session.getBuildState().status,'idle');
  const first=await session.evaluate({strength:20,requestId:1,baselineRevision:'one'});
  assert.equal(first.committed,true);
  assert.equal(session.getBuildState().mode,'sync');
  assert.equal(reports.length,0);
  const cached=await session.evaluate({strength:20,requestId:1,baselineRevision:'one'});
  assert.equal(cached.diagnostics.smartColorTolerance.cacheHit,true);
  assert.equal(commits.length,2);
  assert.equal(session.getCacheRepresentation().retainedFullGrids,0);
});

test('forced async build equals sync, exposes ready token, and never rebuilds strength replay', async () => {
  const value=baseline(), profiles=[], commits=[];
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:r=>commits.push(r),buildMode:'async',onBuildProfile:r=>profiles.push(r)});
  assert.equal(await session.adoptBaselineAsync(value,value.context,null,{requestId:1}),true);
  const before=profiles.length;
  const expected=createSmartColorTolerance({baselineGrid:value.grid,palette:value.palette,protection:value.protection});
  for(const strength of [0,20,50,80,0]) {
    const result=await session.evaluate({strength,requestId:1,baselineRevision:'one'});
    assert.deepEqual(result.grid,expected.evaluate(strength).grid);
  }
  assert.equal(profiles.length,before+1);
  assert.equal(session.getBuildState().status,'ready');
  assert.equal(session.getBuildState().paletteKey,'kit');
  assert.equal(session.getBuildState().algorithmVersion,'v1-optin-1');
  assert.equal(commits.length,5);
  assert.equal(session.getCacheRepresentation().cacheEntries,4);
});

test('async compiled adoption restores identical hierarchy and avoids rebuilding', async () => {
  const value=baseline(), controller=createSmartColorTolerance({baselineGrid:value.grid,palette,protection:value.protection});
  const profiles=[];
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:()=>{},onBuildProfile:r=>profiles.push(r),buildMode:'async'});
  assert.equal(await session.adoptBaselineAsync(value,value.context,controller.getCompiledHierarchy(),{requestId:1}),true);
  const count=profiles.length;
  const result=await session.evaluate({strength:80,requestId:1,baselineRevision:'one'});
  assert.deepEqual(result.grid,controller.evaluate(80).grid);
  assert.equal(profiles.length,count);
  assert.equal(session.getBuildState().status,'ready');
});

test('real timed A→B→C→palette D burst discards old builders and publishes only D', async () => {
  let requestId=1, key='kit'; const commits=[], reports=[];
  const session=createSmartToleranceSession({buildMode:'async',buildTimeBudgetMs:0.5,
    isCurrent:(id,revision,token)=>id===requestId && (!token || token.paletteKey===key),
    commit:r=>commits.push(r),onBuildProfile:r=>reports.push(r)});
  const value=baseline('one','kit',250); session.adoptBaseline(value);
  const a=session.evaluate({strength:0,requestId,baselineRevision:'one'});
  await new Promise(resolve=>setTimeout(resolve,15));
  const b=session.evaluate({strength:80,requestId:++requestId,baselineRevision:'one'});
  await new Promise(resolve=>setTimeout(resolve,10));
  const c=session.evaluate({strength:20,requestId:++requestId,baselineRevision:'one'});
  key='other'; requestId++;
  const next=baseline('next','other'); session.adoptBaseline(next);
  const d=session.evaluate({strength:60,requestId,baselineRevision:'next'});
  const results=await Promise.all([a,b,c,d]);
  assert.deepEqual(results.map(r=>r.committed),[false,false,false,true]);
  assert.equal(commits.length,1);
  assert.equal(commits[0].baselineRevision,'next');
  assert.equal(session.getBuildState().paletteKey,'other');
  assert.deepEqual(session.getCacheRepresentation().cachedStrengths,[60]);
  assert.ok(reports.some(r=>r.cancelled));
});

test('adoption cancelled by clear never publishes baseline or retained cache', async () => {
  const pending=[];
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:()=>{throw Error('must not commit');},
    yieldTask:()=>new Promise(resolve=>pending.push(resolve))});
  const job=session.adoptBaselineAsync(baseline(),undefined,null,{requestId:1});
  assert.equal(session.getBuildState().status,'building');
  session.clear(); pending.shift()();
  assert.equal(await job,false);
  assert.equal(session.getMetadata(),null);
  assert.equal(session.getCacheRepresentation(),null);
  assert.equal(session.getBuildState().status,'idle');
});

test('context invalidation cancels async hierarchy with no cache publication', async () => {
  const pending=[];
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:()=>{throw Error('must not commit');},buildMode:'async',
    yieldTask:()=>new Promise(resolve=>pending.push(resolve))});
  const value=baseline();session.adoptBaseline(value);
  const job=session.evaluate({strength:20,requestId:1,baselineRevision:'one'});
  assert.equal(session.invalidate(JSON.stringify({palette:'changed'})),true);
  pending.shift()();
  assert.equal((await job).stale,true);
  assert.equal(session.getCacheRepresentation(),null);
  assert.equal(session.getBuildState().status,'idle');
});

test('palette invalidation during pending adoption aborts before baseline publication', async () => {
  const pending=[];
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:()=>{},
    yieldTask:()=>new Promise(resolve=>pending.push(resolve))});
  const value=baseline();
  const job=session.adoptBaselineAsync(value,value.context,null,{requestId:1});
  assert.equal(session.getMetadata(),null);
  assert.equal(session.invalidate(JSON.stringify({palette:'new'})),true);
  pending.shift()();
  assert.equal(await job,false);
  assert.equal(session.getMetadata(),null);
  assert.equal(session.getCacheRepresentation(),null);
});

test('invalid async build reports error and publishes no hierarchy', async () => {
  const value=baseline();value.grid[0][0]={paletteId:'missing',code:'X',rgb:[1,2,3]};
  const session=createSmartToleranceSession({isCurrent:()=>true,commit:()=>{},buildMode:'async'});
  session.adoptBaseline(value);
  await assert.rejects(session.evaluate({strength:20,requestId:1,baselineRevision:'one'}),TypeError);
  assert.equal(session.getBuildState().status,'error');
  assert.equal(session.getCacheRepresentation().cacheEntries,0);
  assert.equal(session.getCache().hierarchy,null);
});
