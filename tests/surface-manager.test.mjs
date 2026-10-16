import test from 'node:test';
import assert from 'node:assert/strict';
import { createSurfaceManager } from '../ui/surface-manager.js';

function setup(){
  const handlers={};
  const manager=createSurfaceManager({document:{addEventListener(type,fn,capture){assert.equal(capture,true);handlers[type]=fn;}}});
  const entry=()=>({opened:false,focused:false,element:{contains:t=>t==='inside'},trigger:{contains:t=>t==='trigger'},isOpen(){return this.opened;},close(){this.opened=false;},restoreFocus(){this.focused=true;}});
  const a=entry(),b=entry();manager.register('menu',a);manager.register('color',b);
  return {manager,handlers,a,b};
}
test('opening color suggestions closes a menu without changing editor data',()=>{
  const {manager,a,b}=setup();a.opened=true;manager.open('color');b.opened=true;
  assert.equal(a.opened,false);assert.equal(b.opened,true);assert.equal(a.focused,false);
});
test('inside and trigger clicks stay open; outside interaction dismisses',()=>{
  const {handlers,a}=setup();a.opened=true;
  handlers.pointerdown({target:'inside'});assert.equal(a.opened,true);
  handlers.pointerdown({target:'trigger'});assert.equal(a.opened,true);
  handlers.pointerdown({target:'outside'});assert.equal(a.opened,false);
});
test('Escape dismisses only the surface and restores focus; idle Escape reaches editor',()=>{
  const {manager,handlers,b}=setup();let stopped=0;
  const event={key:'Escape',preventDefault(){},stopImmediatePropagation(){stopped++;}};
  manager.open('color');b.opened=true;handlers.keydown(event);
  assert.equal(b.opened,false);assert.equal(b.focused,true);assert.equal(stopped,1);
  handlers.keydown(event);assert.equal(stopped,1);
});
