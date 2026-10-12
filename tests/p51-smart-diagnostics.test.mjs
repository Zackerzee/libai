import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encodeSmartDiagnostics, decodeSmartDiagnostics, createSmartDiagnostics } from '../services/smart-tolerance-diagnostics.mjs';
import { buildStructuralDiagnostics } from '../services/structural-diagnostics.js';

const a = { paletteId:'mard:A', code:'A', rgb:[220,220,220] };
const b = { paletteId:'other:A', code:'A', rgb:[220,220,220] };
const grid = Array.from({ length:5 }, () => Array(5).fill(a));
grid[2][2] = b; grid[0][0] = null;
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

test('compact worker input retains ragged dimensions, nulls and same RGB brand identities', async () => {
  const input = [grid[0], [], [a, b, null]];
  const encoded = await encodeSmartDiagnostics(input, () => true);
  assert.deepEqual(decodeSmartDiagnostics(encoded), input.map(row => row.map(cell => cell ? { paletteId:cell.paletteId, code:cell.code } : null)));
});

test('worker transport produces exactly the original structural issue lists', async () => {
  const encoded = await encodeSmartDiagnostics(grid, () => true);
  const expected = buildStructuralDiagnostics(grid, [a,b], {tinyMaxSize:3});
  const actual = buildStructuralDiagnostics(decodeSmartDiagnostics(encoded), [a,b], {tinyMaxSize:3});
  for (const key of ['isolated','tiny','edge']) assert.deepEqual(actual[key], expected[key]);
});

test('actual worker entry returns the exact issue result without its large component scratch index', async () => {
  const previous = globalThis.self;
  let result;
  globalThis.self = { postMessage: value => { result = value; } };
  try {
    await import('../services/smart-tolerance-diagnostics.worker.mjs');
    self.onmessage({ data: { encoded:await encodeSmartDiagnostics(grid,()=>true), palette:[a,b], tinyMaxSize:3 } });
    const expected = buildStructuralDiagnostics(grid,[a,b],{tinyMaxSize:3});
    assert.deepEqual(result.value, { isolated:expected.isolated, tiny:expected.tiny, edge:expected.edge });
    assert.equal('components' in result.value,false);
  } finally { if (previous === undefined) delete globalThis.self; else globalThis.self = previous; }
});

test('transport yields and aborts obsolete input without creating a complete second grid', async () => {
  let active = true, yields = 0;
  const encoded = await encodeSmartDiagnostics([Array(6000).fill(a)], () => active, async () => { yields++; active=false; });
  assert.equal(encoded, null); assert.equal(yields,1);
});

test('worker completion cannot publish an obsolete grid or request revision', async () => {
  const workers = [], results = [];
  const service = createSmartDiagnostics({ createWorker: () => {
    const worker = { terminate(){ this.terminated=true; }, postMessage(data, transfer){ this.data=data; this.transfer=transfer; } };
    workers.push(worker); return worker;
  }, onResult: result => results.push(result) });
  let current = true;
  await service.request({grid,palette:[a,b],tinyMaxSize:3,revision:1,isCurrent:()=>current});
  assert.equal(workers[0].transfer[0], workers[0].data.encoded.indices.buffer);
  current = false;
  workers[0].onmessage({data:{value:{isolated:['stale']}}});
  assert.equal(results.length,0);
  current = true;
  await service.request({grid,palette:[a,b],tinyMaxSize:3,revision:2,isCurrent:()=>current});
  workers[0].onmessage({data:{value:{isolated:['old request']}}});
  workers[1].onmessage({data:{value:{isolated:[],tiny:[],edge:[]}}});
  assert.equal(results.length,1); assert.equal(results[0].revision,2); assert.equal(workers[1].terminated,true);
});

test('cancellation before asynchronous start never allocates a worker', async () => {
  let allocations=0;
  const service = createSmartDiagnostics({ createWorker:()=>{allocations++;}, onResult:()=>assert.fail('obsolete result') });
  const pending = service.request({grid,palette:[a,b],tinyMaxSize:3,revision:1,isCurrent:()=>true});
  service.cancel(); await pending; await tick();
  assert.equal(allocations,0);
});

test('workspace only opts Smart publications into asynchronous diagnostics and hides stale actions', () => {
  const source = fs.readFileSync(new URL('../ui/workspace.js', import.meta.url),'utf8');
  assert.match(source,/smartPublicationRevision = event.detail\?\.smartTolerancePublication \? gridRevision : null/);
  assert.match(source,/smartPublicationRevision === gridRevision/);
  assert.match(source,/else structuralCache = .*buildStructuralDiagnostics/);
  assert.match(source,/smartDiagnosticPending \|\| smartDiagnosticError \? \[\] :/);
  assert.match(source,/gridRevision === revision && bridge.getResult\(\).grid === grid/);
});
