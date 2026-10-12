const { chromium } = require('/opt/homebrew/lib/node_modules/openclaw/node_modules/playwright-core');
const fs = require('node:fs');
const assert = require('node:assert/strict');
let runningBrowser;

(async () => {
  const browser = runningBrowser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
  const output = [];
  for (const [label, url] of [['before', 'http://127.0.0.1:8892/'], ['after', 'http://127.0.0.1:8893/']]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(url);
    await page.waitForFunction(() => typeof window.LibmsWorkspaceBridge !== 'undefined');
    const fixture = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const x = c.getContext('2d'); x.fillStyle = '#18b04c'; x.fillRect(0,0,32,64); x.fillStyle = '#cf2367'; x.fillRect(32,0,32,64);
      return c.toDataURL().split(',')[1];
    });
    await page.evaluate(() => {
      window.__opening = [];
      for (const name of ['loadWorkspaceOnce', 'loadFile', 'runLocalContentSafetyCheck', 'loadLocalSafetyModel', 'refreshChartUrl']) {
        const original = window[name];
        window[name] = function (...args) {
          const start = performance.now();
          const result = original.apply(this, args);
          const done = () => window.__opening.push({name,start,ms:performance.now()-start});
          if (result?.then) return result.then(value => { done(); return value; }, error => { done(); throw error; });
          done(); return result;
        };
      }
    });
    const chooser = page.waitForEvent('filechooser');
    const started = await page.evaluate(() => performance.now());
    await page.locator('#upload-zone').click();
    const picker = await chooser;
    const chooserMs = await page.evaluate(start => performance.now()-start, started);
    // Reproducible three-second file selection interval, not a claimed user average.
    await page.waitForTimeout(3000);
    const selected = await page.evaluate(() => performance.now());
    await picker.setFiles({name:'reference-test.png',mimeType:'image/png',buffer:Buffer.from(fixture,'base64')});
    await page.waitForFunction(() => window.LibmsWorkspaceBridge.getResult().grid?.length && !window.libmsStore.getState().statusState.generating, null, {timeout:180000});
    const ready = await page.evaluate(() => performance.now());
    const row = {label,chooserMs,selectionWaitMs:3000,afterSelectionMs:ready-selected,totalMs:ready-started,
      phases:await page.evaluate(()=>window.__opening),errors,
      safety:await page.evaluate(()=>({modelReady:Boolean(state.safetyModel),unavailable:state.safetyModelUnavailable===true}))};
    console.log(JSON.stringify({label,chooserMs,afterSelectionMs:row.afterSelectionMs,phases:row.phases}));
    if (label === 'after') {
      const check = await page.evaluate(async () => {
        const bridge=window.LibmsWorkspaceBridge, store=window.libmsStore;
        const before=bridge.getResult(), matrix=JSON.stringify(before.grid), images=[before.previewUrl,before.patternUrl];
        const defaultVisible=store.getState().referenceState.visible;
        const projectStore=(await import('./state/project-store.js?v=20261008-selection-popover-r24')).projectStore;
        projectStore.setState({view:{mode:'blocks'},ui:{activePanel:'edit'},reference:{visible:true,useSource:true,opacity:100,displayMode:'normal'}});
        await new Promise(r=>setTimeout(r,300));
        const canvas=document.querySelector('.ws-layer-reference'), base=document.querySelector('.ws-layer-base');
        const data=canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
        const baseData=base.getContext('2d').getImageData(0,0,base.width,base.height).data;
        let hit=null,maxBaseAlpha=0;
        for(let i=3;i<baseData.length;i+=4)maxBaseAlpha=Math.max(maxBaseAlpha,baseData[i]);
        for(let y=20;y<canvas.height-20&&!hit;y+=5)for(let x=20;x<canvas.width-20;x+=5){const i=(y*canvas.width+x)*4;if(data[i+3]===255){hit={x,y,rgb:[...data.slice(i,i+3)]};break;}}
        const rect=canvas.getBoundingClientRect();
        return {defaultVisible,maxBaseAlpha,matrix,images,hit:hit&&{x:rect.left+hit.x/devicePixelRatio,y:rect.top+hit.y/devicePixelRatio,rgb:hit.rgb},
          nearest:hit?bridge.getNearestPaletteCandidates(hit.rgb).nearest:null,tool:store.getState().editorState.wsTool,selection:store.getState().editorState.wsSelection};
      });
      console.log(JSON.stringify({referenceCheck:{defaultVisible:check.defaultVisible,maxBaseAlpha:check.maxBaseAlpha,hit:check.hit}}));
      assert.equal(check.defaultVisible,false);assert.equal(check.maxBaseAlpha,0);assert.ok(check.hit);
      await page.keyboard.down('Shift');await page.mouse.click(check.hit.x,check.hit.y,{button:'right'});await page.keyboard.up('Shift');
      await page.waitForFunction(code=>window.libmsStore.getState().editorState.currentPaletteId===code,check.nearest,{timeout:10000});
      const after = await page.evaluate(()=>{const r=window.LibmsWorkspaceBridge.getResult(),s=window.libmsStore.getState();return{matrix:JSON.stringify(r.grid),images:[r.previewUrl,r.patternUrl],tool:s.editorState.wsTool,selection:s.editorState.wsSelection,currentColor:s.editorState.currentPaletteId};});
      assert.equal(after.matrix,check.matrix);assert.deepEqual(after.images,check.images);assert.equal(after.tool,check.tool);assert.deepEqual(after.selection,check.selection);
      row.referenceAndPick={defaultVisible:false,reference100ArtworkAlpha:0,sourceRgb:check.hit.rgb,matched:after.currentColor,gridUnchanged:true,exportsUnchanged:true,toolUnchanged:true,selectionUnchanged:true};
      await page.screenshot({path:'/tmp/libms-reference-after.png',fullPage:false});
      // Warm runtime timing only: use the existing new/import menu, if exposed.
      row.warmModelMs=await page.evaluate(async()=>{const t=performance.now();await loadLocalSafetyModel();return performance.now()-t;});
    }
    output.push(row);fs.writeFileSync('/tmp/libms-reference-upload-browser.json',JSON.stringify(output,null,2));await page.close();
  }
  await browser.close();
})().catch(async error=>{console.error(error);await runningBrowser?.close();process.exitCode=1;});
