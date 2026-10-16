import test from 'node:test';
import assert from 'node:assert/strict';
import { attachArtworkBirthController, attachGalleryBirthMotion } from '../ui/artwork-motion-controller.mjs';
import { createGenerationService } from '../services/generation-service.js';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

class Element extends EventTarget {
  constructor(doc) { super(); this.ownerDocument=doc; this.style={}; this.dataset={}; this.children=[]; this.isConnected=true; }
  append(...nodes) { this.children.push(...nodes); } appendChild(node){this.append(node);}
  remove(){this.removed=true;this.isConnected=false;} setAttribute(){}
  getBoundingClientRect(){return {left:0,top:0,width:400,height:300};}
}
function setup() {
  const win=new EventTarget(),doc=new EventTarget(),frames=new Map(),timers=new Map(),images=[],storage=new Map();let serial=0;
  const reduced=new EventTarget();reduced.matches=false;
  Object.assign(win,{CustomEvent,matchMedia:()=>reduced,navigator:{},devicePixelRatio:1,
    requestAnimationFrame:fn=>{const id=++serial;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),
    setTimeout:fn=>{const id=++serial;timers.set(id,fn);return id;},clearTimeout:id=>timers.delete(id),
    Image:class{constructor(){images.push(this);}}});
  const ctx={setTransform(){},clearRect(){},save(){},restore(){},beginPath(){},rect(){},clip(){},drawImage(){},fillRect(){}};
  Object.assign(doc,{defaultView:win,hidden:false,createElement:()=>{const e=new Element(doc);e.getContext=()=>ctx;return e;},createTextNode:text=>({text})});
  globalThis.localStorage={getItem:key=>storage.get(key)??null,setItem:(key,value)=>storage.set(key,value)};
  const container=new Element(doc),host=new Element(doc);
  let result={sourceOriginalUrl:'one',sourceUrl:'one',width:2,height:1,grid:[[{hex:'#123456'},null]],manualEdited:false};
  const bridge={getResult:()=>result};
  const fire=(target,type,detail)=>target.dispatchEvent(new CustomEvent(type,{detail}));
  const loaded=(revision,url='one')=>{fire(win,'libms:artwork-upload-started',{uploadRevision:revision});fire(win,'libms:source-loaded',{uploadRevision:revision,url,importMode:'photo'});};
  const complete=revision=>fire(win,'libms:artwork-generation-completed',{...result,artworkUploadRevision:revision});
  const flush=async()=>{await Promise.resolve();await Promise.resolve();};
  const animate=async()=>{images.at(-1).onload();await flush();};
  return {win,doc,reduced,container,host,bridge,fire,loaded,complete,animate,flush,images,frames,timers,storage,setResult:value=>result=value};
}

test('first success is consumed once; failed/cancelled generation and stale same-image jobs cannot consume a new upload',async()=>{
  const e=setup(),c=attachArtworkBirthController({container:e.container,preferenceHost:e.host,bridge:e.bridge,viewport:{origin:()=>({x:8,y:12,cell:10})}});
  e.loaded(1);e.fire(e.win,'libms:generation-error','failure');e.fire(e.win,'libms:artwork-motion-cancel');
  e.loaded(2);e.complete(1);assert.equal(e.images.length,0);
  e.complete(2);await e.animate();assert.equal(e.container.dataset.artworkMotionPlays,'1');
  e.complete(2);assert.equal(c.isRunning,false);assert.equal(e.images.length,1);
  e.loaded(3);e.complete(3);await e.animate();assert.equal(e.container.dataset.artworkMotionPlays,'2');
  e.fire(e.win,'libms:grid-edited',{});assert.equal(c.isRunning,false);assert.equal(e.frames.size,0);c.destroy();
});
test('old image decode never overlays a new upload; source reset invalidates pending identity',async()=>{
  const e=setup(),c=attachArtworkBirthController({container:e.container,preferenceHost:e.host,bridge:e.bridge,viewport:{origin:()=>({x:0,y:0,cell:10})}});
  e.loaded(1);e.complete(1);const stale=e.images[0].onload;
  e.loaded(2);stale();await e.flush();assert.equal(e.container.dataset.artworkMotionPlays,undefined);
  e.fire(e.win,'libms:artwork-source-reset',{uploadRevision:3});
  e.fire(e.win,'libms:source-loaded',{uploadRevision:2,url:'one',importMode:'photo'});e.complete(2);assert.equal(e.images.length,1);c.destroy();
});
test('preference off stops loading/playing without a visible switch; reduced motion consumes first success without playback',async()=>{
  const e=setup();const options={container:e.container,preferenceHost:e.host,bridge:e.bridge,viewport:{origin:()=>({x:0,y:0,cell:10})}};
  const c=attachArtworkBirthController(options);e.loaded(1);e.complete(1);await e.animate();
  // 底栏那个「首次上传动效」勾选框已移除：控制器不再往 preferenceHost 里塞任何东西，
  // 偏好改由存储键 + libms:artwork-motion-preference 事件驱动（默认开）。
  assert.equal(e.host.children.length,0,'控制器不再往底栏插入开关');
  e.storage.set('libms.editor.firstUploadMotion','false');e.fire(e.win,'libms:artwork-motion-preference',false);
  assert.equal(c.isRunning,false);c.destroy();
  const next=attachArtworkBirthController(options);
  e.loaded(2);e.complete(2);assert.equal(e.images.length,1);next.destroy();
  e.storage.set('libms.editor.firstUploadMotion','true');e.reduced.matches=true;
  const third=attachArtworkBirthController(options);e.loaded(3);e.complete(3);assert.equal(e.images.length,1);
  e.reduced.matches=false;e.complete(3);assert.equal(e.images.length,1);third.destroy();
});
test('gallery hover uses delay, stays single-play, leaves restore immediately; focus and touch work without hover',async()=>{
  const e=setup(),card=new Element(e.doc),img=new Element(e.doc);card.dataset.artworkId='a';card.querySelector=()=>img;e.container.querySelectorAll=()=>[card];
  const artwork={sourceUrl:'one',width:2,height:1,grid:[[{hex:'#123456'},null]]};
  const dispose=attachGalleryBirthMotion(e.container,()=>artwork);
  const pointer=(type,pointerType)=>{const event=new Event(type,{cancelable:true});event.pointerType=pointerType;card.dispatchEvent(event);return event;};
  pointer('pointerenter','mouse');assert.equal(e.images.length,0);assert.equal(e.timers.size,1);
  for(const callback of [...e.timers.values()])callback();await e.animate();assert.equal(card.dataset.artworkMotionPlays,'1');
  card.dispatchEvent(new Event('focus'));assert.equal(e.images.length,1);
  pointer('pointerleave','mouse');assert.equal(e.frames.size,0);
  card.dispatchEvent(new Event('focus'));await e.animate();assert.equal(card.dataset.artworkMotionPlays,'2');card.dispatchEvent(new Event('blur'));
  pointer('pointerdown','touch');card.dispatchEvent(new Event('focus'));const click=pointer('click','touch');assert.equal(click.defaultPrevented,true);
  await e.animate();assert.equal(card.dataset.artworkMotionPlays,'3');dispose();assert.equal(e.frames.size,0);
});
test('gallery missing original remains static; preference off cancels scheduled and active gallery playback',async()=>{
  const e=setup(),card=new Element(e.doc),img=new Element(e.doc);card.dataset.artworkId='a';card.querySelector=()=>img;e.container.querySelectorAll=()=>[card];
  let dispose=attachGalleryBirthMotion(e.container,()=>({grid:[],sourceUrl:''}));card.dispatchEvent(new Event('focus'));assert.equal(e.images.length,0);dispose();
  dispose=attachGalleryBirthMotion(e.container,()=>({grid:[[{hex:'#112233'}]],sourceUrl:'one',width:1,height:1}));
  card.dispatchEvent(new Event('focus'));await e.animate();e.storage.set('libms.editor.firstUploadMotion','false');e.fire(e.win,'libms:artwork-motion-preference',false);assert.equal(e.frames.size,0);dispose();
});
test('generation presentation signal uses one existing result and snapshots upload revision before awaits',async()=>{
  const previousWindow=globalThis.window;globalThis.window=new EventTarget();const events=[];
  window.addEventListener('libms:artwork-generation-completed',event=>events.push(event.detail));
  let revision=1,calls=0;const result={grid:[[{hex:'#123456'}]],width:1,height:1};
  const service=createGenerationService({getSourceUploadRevision:()=>revision,async generate(){calls++;revision=2;return result;}},{getState:()=>({generation:{},palette:{}}),setState(){}});
  try{assert.equal(await service.generate(),result);assert.equal(calls,1);assert.equal(events[0].grid,result.grid);assert.equal(events[0].artworkUploadRevision,1);}finally{globalThis.window=previousWindow;}
});
test('real upload entry discards a slow earlier read when a newer image has already loaded',async()=>{
  const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const body=app.slice(app.indexOf('let artworkUploadRevision = 0;'),app.indexOf('async function prepareLocalImage(file)'));
  const pending=new Map(),events=[];
  const state={importMode:'restore',manualEdited:false,sourceDataUrl:'',autoProcessAfterLoad:false};
  const context=vm.createContext({state,CustomEvent,workspaceMounted:true,console,
    window:{dispatchEvent:event=>events.push(event),alert(){}},
    els:{processButton:{},modeSelect:{},sourcePreview:{},uploadZone:{classList:{add(){},remove(){}}}},
    isImageFile:()=>true,syncRangeControls(){},setStatus(){},resetSourceDimensions(){},applyRestoreSizing(){},clearResult(){},
    prepareLocalImage:file=>new Promise(resolve=>pending.set(file.name,resolve)),
    runLocalContentSafetyCheck:async()=>({allowed:true}),loadImage:async()=>({naturalWidth:64,naturalHeight:32})});
  vm.runInContext(body,context);
  const a=context.loadFile({name:'old.png'}),b=context.loadFile({name:'new.png'});
  pending.get('new.png')({dataUrl:'new'});await b;
  pending.get('old.png')({dataUrl:'old'});await a;
  assert.equal(state.sourceDataUrl,'new');assert.equal(state.sourceName,'new.png');
  assert.deepEqual(events.filter(e=>e.type==='libms:source-loaded').map(e=>e.detail.uploadRevision),[2]);
});
