import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {touchPair,hueOf,filterAndSortUsage,readEditorPreference,saveEditorPreference} from '../ui/editor-interaction.mjs';
test('two finger midpoint and distance use screen coordinates',()=>{assert.deepEqual(touchPair([{x:0,y:0},{x:6,y:8}]),{x:3,y:4,distance:10});assert.equal(touchPair([{x:1,y:1}]),null);});
test('hue ordering is deterministic and preserves palette identity',()=>{const entries=[{paletteId:'b',code:'B',rgb:[0,0,255]},{paletteId:'r',code:'R',rgb:[255,0,0]},{paletteId:'r2',code:'R2',rgb:[255,0,0]}];assert.deepEqual(filterAndSortUsage(entries,{hue:true}).map(x=>x.paletteId),['r','r2','b']);assert.equal(entries[0].paletteId,'b');assert.equal(hueOf([20,20,20]),360);});
test('usage search does not merge equal RGB colors',()=>{assert.equal(filterAndSortUsage([{code:'H5'},{code:'H6'}],{query:'h'}).length,2);});
test('preferences tolerate unavailable storage and persist booleans',()=>{const values=new Map(),storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};assert.equal(readEditorPreference('codes',false,storage),false);saveEditorPreference('codes',true,storage);assert.equal(readEditorPreference('codes',false,storage),true);assert.equal(readEditorPreference('codes',false,{getItem(){throw Error();}}),false);});
test('canvas touch cancellation cancels held action and clears gesture before any commit',()=>{const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');assert.match(source,/if\(cancel\)\{endTouchAction\(true\);endDrag\(true\);touchPoints\.clear\(\);gesturePair=null;cursorMarker\.hidden=true;return;/);assert.match(source,/pointerId:-1/);});
