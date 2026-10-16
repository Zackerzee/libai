import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSurfaceManager } from '../ui/surface-manager.js';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
const start=source.indexOf('  const transientMenus =');
const end=source.indexOf('\n  store.subscribe(paint)',start);
const snippet=source.slice(start,end);
test('export drawer remains open for its controls but closes on outside interaction',()=>{
  assert.match(source,/if \(!drawer\.classList\.contains\("open"\) \|\| drawer\.contains\(event\.target\)\) return;\s*store\.setState\(\{ ui: \{ exportDrawerOpen: false \} \}\);\s*drawer\.classList\.remove\("open"\);\s*\}, true\)/);
});
function setup(){
  const make=()=>({open:false,listeners:{},summary:{contains:()=>false,focus(){this.focused=true;}},contains:target=>false,querySelector(){return this.summary;},addEventListener(type,fn,capture){this.listeners[type]={fn,capture};}});
  const projectMenu=make(),symmetryOptionsMenu=make(),editActions=make();
  projectMenu.id='project';editActions.id='edit';symmetryOptionsMenu.id='symmetry';
  const wrap={addEventListener(){}};
  const top=null,topControls=null,attachWorkspaceV3Layout=()=>{};
  const listeners={};const document={addEventListener(type,fn,capture){listeners[type]={fn,capture};}};
  const window={addEventListener(){}};
  const surfaces=createSurfaceManager({document});
  new Function('projectMenu','symmetryOptionsMenu','editActions','surfaces','wrap','window','top','topControls','attachWorkspaceV3Layout',snippet)(projectMenu,symmetryOptionsMenu,editActions,surfaces,wrap,window,top,topControls,attachWorkspaceV3Layout);
  return{menus:[projectMenu,symmetryOptionsMenu,editActions],listeners};
}
test('menu actions close in capture phase before stopped action bubbling',()=>{
  const {menus}=setup();for(const menu of menus){menu.open=true;
    assert.equal(menu.listeners.click.capture,true);
    menu.listeners.click.fn({target:{closest:selector=>selector==='button'?{}:null}});
    assert.equal(menu.open,false);
  }
});
test('summary opening closes peers; outside pointer closes menus in capture',()=>{
  const {menus,listeners}=setup();menus.forEach(m=>m.open=true);
  menus[1].listeners.click.fn({target:{closest:s=>s==='summary'?{parentElement:menus[1]}:null}});
  assert.deepEqual(menus.map(m=>m.open),[false,true,false]);
  assert.equal(listeners.pointerdown.capture,true);listeners.pointerdown.fn({target:{}});
  assert.deepEqual(menus.map(m=>m.open),[false,false,false]);
});
test('Escape closes active menu and preserves editor shortcut when no menu open',()=>{
  const {menus,listeners}=setup();let stopped=0,prevented=0;
  const e={key:'Escape',preventDefault(){prevented++;},stopImmediatePropagation(){stopped++;}};
  listeners.keydown.fn(e);assert.equal(stopped,0);
  menus[1].open=true;listeners.keydown.fn(e);
  assert.equal(stopped,1);assert.equal(prevented,1);assert.equal(menus[1].open,false);assert.equal(menus[1].summary.focused,true);
});
