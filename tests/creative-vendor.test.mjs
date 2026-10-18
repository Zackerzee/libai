import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
const require=createRequire(import.meta.url);
const pattern=require('../vendor/creative-tools/bead-pattern-importer.js');
const {BeadText:text}=require('../vendor/creative-tools/bead-text-tool.js');
const palette=[{code:'H07',hex:'#000000'},{code:'F03',hex:'#F74941'},{code:'C01',hex:'#3344CC'}];
test('colour mode dropdown updates actual foreground mode and refreshes immediately',()=>{
  const source=readFileSync(new URL('../vendor/creative-tools/bead-text-tool.js',import.meta.url),'utf8');
  const start=source.indexOf("  modeSel.addEventListener('change', function () {");
  assert.ok(start>=0);
  const code=source.slice(start,source.indexOf('  var solidBox',start));
  let listener,refreshes=0;
  const state={fg:{mode:'solid'}};
  const select={value:'gradient',addEventListener:(name,fn)=>{assert.equal(name,'change');listener=fn;}};
  new Function('modeSel','state','refresh',code)(select,state,()=>refreshes++);
  listener();assert.equal(state.fg.mode,'gradient');assert.equal(refreshes,1);
  select.value='solid';listener();assert.equal(state.fg.mode,'solid');assert.equal(refreshes,2);
});
test('shipped bundle: HELLO, width expansion, missing Chinese, multiline and current palette',()=>{
  const build=(value,extra={})=>text.buildText({text:value,fontId:'pixel-5x7',widthBeads:40,palette,codeGrid:true,...extra});
  const hello=build('HELLO');assert.equal(hello.ok,true);assert.deepEqual([hello.value.width,hello.value.height],[40,9]);
  assert.equal(hello.value.grid[0][0],null);
  const wide=build('WWWWWWWWWW');assert.equal(wide.value.width,61);assert.ok(wide.value.note);
  const missing=build('中文');assert.equal(missing.ok,false);assert.match(missing.error,/中文像素/);
  assert.ok(build('HELLO\nHELLO').value.height>hello.value.height);
  const gradient=build('HELLO',{foreground:{mode:'gradient',stops:['#F74941','#3344CC'],direction:'horizontal'}});
  assert.ok(gradient.value.usage.length>1);
  assert.ok(gradient.value.grid.flat().every(code=>code===null||palette.some(p=>p.code===code)));
});
test('shipped recognizer automatically detects 20x16 printed-code grid, ring keeps 320 exact identities',()=>{
  const w=400,h=320,data=new Uint8ClampedArray(w*h*4),colors=palette.slice(1);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
    let rgb=colors[(Math.floor(x/20)+Math.floor(y/20))%2].hex.match(/[a-f\d]{2}/gi).map(v=>parseInt(v,16));
    if(x%20===0||y%20===0||(x%20>=8&&x%20<=10&&y%20>=7&&y%20<=12))rgb=[0,0,0];
    data.set([...rgb,255],(y*w+x)*4);
  }
  const r=pattern.recognizePattern(data,w,h,colors,{autoTrim:false,whiteBalance:'auto',sampleAlgo:'ring'});
  assert.equal(r.grid.length,16);assert.equal(r.grid[0].length,20);
  r.grid.forEach((row,y)=>row.forEach((code,x)=>assert.equal(code,colors[(x+y)%2].code)));
  assert.ok(Array.isArray(r.uncertain));
});
