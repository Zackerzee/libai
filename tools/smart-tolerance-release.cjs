const {chromium}=require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const url=process.env.LIBMS_URL||'http://127.0.0.1:8900/index.html';
const baseUrl=process.env.LIBMS_BASE_URL||'http://127.0.0.1:8901/index.html';
const output=process.env.LIBMS_OUTPUT||'/tmp/sct-release-browser.json';
const rows=[];
const identity=page=>page.evaluate(()=>JSON.stringify(window.LibmsWorkspaceBridge.getResult().grid.map(row=>row.map(c=>c?[c.paletteId??null,c.code,c.rgb]:null))));
(async()=>{
 const browser=await chromium.launch({executablePath:'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',headless:true});
 const setup=async(target,size)=>{
  const page=await browser.newPage({viewport:{width:1440,height:1000}});page.on('dialog',d=>d.accept());page.on('pageerror',e=>console.error('pageerror',e.message));
  await page.goto(target);await page.waitForFunction(()=>!!window.LibmsWorkspaceBridge);
  const png=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=c.height=64;const ctx=c.getContext('2d');ctx.fillStyle='#ed524b';ctx.fillRect(0,0,64,64);ctx.fillStyle='#ee5b53';ctx.fillRect(0,0,32,64);ctx.fillStyle='#fff5e9';ctx.fillRect(20,20,24,24);ctx.fillStyle='#263c58';ctx.fillRect(24,25,4,4);return c.toDataURL().split(',')[1];});
  await page.locator('#file-input').setInputFiles({name:'容差验收.png',mimeType:'image/png',buffer:Buffer.from(png,'base64')});
  await page.waitForFunction(()=>window.LibmsWorkspaceBridge.getResult().grid.length>0,null,{timeout:120000});
  await page.waitForFunction(()=>!window.libmsStore.getState().statusState.generating,null,{timeout:120000});await page.waitForTimeout(500);
  await page.locator('[data-ws-workarea="generate"]').click();await page.locator('[data-ws-panel="generation"]').click();await page.locator('#ws-size-number').fill(String(size));await page.locator('#ws-size-apply').click();
  await page.waitForFunction(n=>window.LibmsWorkspaceBridge.getResult().width===n&&!window.libmsStore.getState().statusState.generating,size,{timeout:120000});
  await page.waitForTimeout(300);return page;
 };
 try{
  for(const size of(process.env.LIBMS_SIZES||'52,78,104,250,500').split(',').map(Number)){
   const page=await setup(url,size),base=await setup(baseUrl,size);
   await page.locator('[data-ws-workarea="generate"]').click();await page.locator('[data-ws-panel="generation"]').click();
   const before=await identity(page);assert.equal(before,await identity(base),`defaultoff ${size}`);await base.close();
   assert.equal(await page.evaluate(()=>window.LibmsWorkspaceBridge.getSmartToleranceUiState().enabled),false);
   if(size===52)await page.locator('[data-smart-tolerance-controls] .sl-switch-row').click();
   else await page.evaluate(()=>window.LibmsWorkspaceBridge.setSmartToleranceEnabled(true));
   await page.waitForFunction(()=>{const s=window.LibmsWorkspaceBridge.getSmartToleranceUiState();return s.status==='ready'||s.error;},null,{timeout:120000});
   const initial=await page.evaluate(()=>window.LibmsWorkspaceBridge.getSmartToleranceUiState());assert.equal(initial.error,null,JSON.stringify(initial));
   const counts=[];
   for(const strength of[0,20,40,60,80,100,0]){
    await page.evaluate(async s=>{await window.LibmsWorkspaceBridge.previewSmartTolerance(s);},strength);
    await page.waitForFunction(s=>{const u=window.LibmsWorkspaceBridge.getSmartToleranceUiState();return u.status==='ready'&&u.previewStrength===s;},strength,{timeout:120000});
    assert.equal(await identity(page),before,'unconfirmed preview must not mutate formal grid');
    counts.push(await page.evaluate(()=>{const u=window.LibmsWorkspaceBridge.getSmartToleranceUiState();const p=window.LibmsWorkspaceBridge.getSmartTolerancePreviewResult();return{strength:u.previewStrength,count:new Set(p.grid.flat().filter(Boolean).map(c=>c.paletteId||c.code)).size};}));
   }
   for(let i=1;i<6;i++)assert(counts[i].count<=counts[i-1].count,'monotonic colors');assert.equal(counts.at(-1).count,counts[0].count,'zero roundtrip');
   await page.evaluate(()=>window.LibmsWorkspaceBridge.previewSmartTolerance(60));
   await page.waitForFunction(()=>window.LibmsWorkspaceBridge.getSmartToleranceUiState().status==='ready');
   const preview=await page.evaluate(()=>JSON.stringify(window.LibmsWorkspaceBridge.getSmartTolerancePreviewResult().grid.map(row=>row.map(c=>c?[c.paletteId??null,c.code,c.rgb]:null))));
   await page.locator('[data-smart-apply]').click();await page.waitForFunction(()=>!window.LibmsWorkspaceBridge.getSmartToleranceUiState().enabled);
   const applied=await identity(page);assert.equal(applied,preview,'applied equals preview');
   await page.locator('#ws-undo').click();assert.equal(await identity(page),before,'undo');await page.locator('#ws-redo').click();assert.equal(await identity(page),applied,'redo');
   const saved=await page.evaluate(async()=>{const b=window.LibmsWorkspaceBridge,p=b.buildProjectJson(),{decodeAppliedGrid}=await import('/services/applied-project-archive.mjs');return{exact:JSON.stringify(decodeAppliedGrid(JSON.parse(JSON.stringify(p)).appliedGrid))===JSON.stringify(b.getResult().grid),metadata:p.smartColorTolerance,referenceDefault:document.querySelector('#ws-ref-visible')?.checked};});
   assert(saved.exact,'saved archive exact');assert.equal(saved.metadata.strength,60);
   const reload=await page.evaluate(()=>{const b=window.LibmsWorkspaceBridge,p=b.buildProjectJson(),old=JSON.stringify(b.getResult().grid);b.loadProjectJson(p);return old===JSON.stringify(b.getResult().grid);});assert(reload,'reload exact');
   rows.push({size,defaultOffExact:true,counts,applyExact:true,undoRedoExact:true,saveReloadExact:true,metadata:saved.metadata});fs.writeFileSync(output,JSON.stringify({rows},null,2));console.log(JSON.stringify(rows.at(-1)));await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);fs.writeFileSync(output,JSON.stringify({rows,error:String(e.stack||e)},null,2));process.exitCode=1;});
