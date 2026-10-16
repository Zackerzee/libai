import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { LONG_EDGE_AUTHORITY, LONG_EDGE_EVENT, resolveLongEdgeAuthority, shouldAutoWriteLongEdge } from '../services/source-dimensions.mjs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
const commit=source.match(/function commitSize\(\) \{([\s\S]*?)\n  \}/)[1];
test('explicit 104 replaces 128, survives auto detection and subsequent generation',()=>{
 let draft=104, stored=128, authority=LONG_EDGE_AUTHORITY.AUTO, generations=0;
 vm.runInNewContext(`(()=>{${commit}})()`,{lockedAuthority:()=>false,setLongEdgeAuthority:event=>authority=resolveLongEdgeAuthority(authority,event),LONG_EDGE_EVENT,pushDraftToBridge:()=>stored=draft,syncSizeUi:()=>{},scheduleAutoGenerate:()=>generations++});
 assert.equal(stored,104);assert.equal(generations,1);
 if(shouldAutoWriteLongEdge(authority))stored=128;
 assert.equal(stored,104);
});
test('absolute-authority project cannot commit a new source dimension',()=>{
 vm.runInNewContext(`(()=>{${commit}})()`,{lockedAuthority:()=>true});
});
test('presets commit without hidden apply button',()=>{
 const handler=source.slice(source.indexOf('// 预设 chip：'),source.indexOf('let liveGenerationSizeTimer'));
 assert.match(handler,/setLongEdgeDraft\(chip.dataset.size\);\s*commitSize\(\)/);
 assert.match(handler,/clearTimeout\(liveGenerationSizeTimer\)/);
});
test('unedited image regenerates before structural editing and persists user authority',()=>{
 const handler=source.slice(source.indexOf("$('#ws-live-size-range').addEventListener('input'"),source.indexOf("$('#ws-live-size-range').addEventListener('change'"));
 assert.ok(handler.indexOf('pushDraftToBridge()')<handler.indexOf('requestLiveGenerationSize();return;'));
 assert.ok(handler.indexOf('requestLiveGenerationSize();return;')<handler.indexOf('createGridResizeCommand'));
 assert.match(handler,/sourceUrl&&!bridge.getResult\(\).manualEdited/);
});
test('debounced size request upgrades authority immediately and rejects a replaced source or auto mode',()=>{
 const expression=source.match(/const requestLiveGenerationSize = (.*);\n/)[1];
 let revision=1,authority=LONG_EDGE_AUTHORITY.AUTO,callback,commits=0;
 const sandbox={lockedAuthority:()=>false,LONG_EDGE_AUTHORITY,LONG_EDGE_EVENT,setLongEdgeAuthority:event=>{authority=resolveLongEdgeAuthority(authority,event);sandbox.longEdgeAuthority=authority;},pushDraftToBridge:()=>{},clearTimeout:()=>{},setTimeout:fn=>{callback=fn;},sizeSourceRevision:revision,longEdgeAuthority:authority,commitSize:()=>commits++};
 vm.runInNewContext(`var liveGenerationSizeTimer; var request=${expression}; request();`,sandbox);
 assert.equal(authority,LONG_EDGE_AUTHORITY.USER_EXPLICIT);
 sandbox.sizeSourceRevision=2;callback();assert.equal(commits,0);
 sandbox.sizeSourceRevision=1;sandbox.longEdgeAuthority=LONG_EDGE_AUTHORITY.AUTO;callback();assert.equal(commits,0);
 sandbox.longEdgeAuthority=authority;callback();assert.equal(commits,1);
});
