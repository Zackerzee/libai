import test from 'node:test';
import assert from 'node:assert/strict';
import { attachSourceAdjustmentControls, SOURCE_ADJUSTMENT_KEYS } from '../ui/source-adjustment-controller.mjs';

function fixture() {
  const element = (key) => ({dataset:{wsSourceAdjust:key},value:'0',listeners:new Map(),addEventListener(type,fn){this.listeners.set(type,fn);},removeEventListener(type){this.listeners.delete(type);}});
  const inputs=SOURCE_ADJUSTMENT_KEYS.map(element),reset=element(),labels=Object.fromEntries(SOURCE_ADJUSTMENT_KEYS.map(key=>[key,{}]));
  let state={brightness:0,contrast:0,saturation:0,sharpen:0,crop:{x:4,y:5,width:20,height:30},rotation:90},source=true,previews=0;
  const schedules=[];
  const root={querySelectorAll:()=>inputs,querySelector:selector=>selector==='#ws-source-reset'?reset:labels[selector.slice(11,-6)]};
  const controls=attachSourceAdjustmentControls({root,getTransform:()=>state,setTransform:patch=>{state={...state,...patch};},requestPreview:()=>previews++,scheduleGenerate:delay=>schedules.push(delay),hasSource:()=>source});
  return {inputs,reset,controls,schedules,get state(){return state;},get previews(){return previews;},input(index,value){inputs[index].value=String(value);inputs[index].listeners.get('input')({target:inputs[index]});},setSource(value){source=value;controls.sync();}};
}
test('rapid input patches absolute latest values and requests debounced generation',()=>{const f=fixture();f.input(0,40);f.input(0,-20);f.input(0,0);assert.equal(f.state.brightness,0);assert.deepEqual(f.schedules,[320,320,320]);assert.equal(f.previews,3);});
test('reset clears only four adjustments and preserves crop and rotation',()=>{const f=fixture();f.input(1,70);f.reset.listeners.get('click')();assert.equal(f.state.contrast,0);assert.equal(f.state.rotation,90);assert.deepEqual(f.state.crop,{x:4,y:5,width:20,height:30});assert.equal(f.schedules.at(-1),0);});
test('without source controls are disabled and input cannot generate',()=>{const f=fixture();f.setSource(false);f.input(0,20);assert.equal(f.inputs[0].disabled,true);assert.equal(f.reset.disabled,true);assert.equal(f.schedules.length,0);});
test('dispose removes control listeners',()=>{const f=fixture();f.controls.dispose();assert.equal(f.inputs[0].listeners.size,0);assert.equal(f.reset.listeners.size,0);});
