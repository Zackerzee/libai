import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { measureImageDetail, recommendAutomaticSize, transparentContentBounds, transparentImageBounds, isCurrentSizeSource } from '../services/automatic-generation-size.mjs';

function image(size, colour) {
  const data = new Uint8ClampedArray(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) data.set([...colour(x, y), 255], (y * size + x) * 4);
  return { width: size, height: size, data };
}
test('ordinary images use 97 and actual aspect, not native 64 or inherited 200', () => {
  const size = recommendAutomaticSize({ width: 900, height: 1200 });
  assert.equal(size.width, 73); assert.equal(size.height, 97);
  assert.equal(size.authority, 'logical-heuristic');
  const wide = recommendAutomaticSize({ width: 1600, height: 900 });
  assert.equal(wide.width, 97); assert.equal(wide.height, 55);
  assert.equal(recommendAutomaticSize({width:1600,height:1600}).width,97);
});
test('ordinary detail levels share conservative 97 start without overriding pixel evidence', () => {
  const flat = image(100, () => [180, 140, 100]);
  const medium = image(100, (x) => (Math.floor(x / 10) % 2 ? [255,255,255] : [0,0,0]));
  const detailed = image(100, (x,y) => ((x+y)%2 ? [255,255,255] : [0,0,0]));
  assert.equal(measureImageDetail(flat), 0);
  for (const [input, edge] of [[flat,97],[medium,97],[detailed,97]]) {
    assert.equal(recommendAutomaticSize({ width: 1000, height:1000, imageData:input }).width, edge);
  }
  const moderate = image(100, (x) => (Math.floor(x / 5) % 2 ? [255,255,255] : [0,0,0]));
  assert.equal(recommendAutomaticSize({ width:1000,height:1000,imageData:moderate }).width,97);
});
test('detected pixels preserve logical sizes above old 200 limit, obey crop ratio', () => {
  const size = recommendAutomaticSize({ width: 888, height:1180, multiple:4 });
  assert.equal(size.width,222); assert.equal(size.height,295);
  assert.equal(size.authority,'pixel-multiple');
  const crop = recommendAutomaticSize({ width:888,height:1180,multiple:4,ratio:1 });
  assert.equal(crop.width,295); assert.equal(crop.height,295);
});
test('invalid periods or unresolved dimensions never fabricate grid evidence', () => {
  assert.equal(recommendAutomaticSize({width:0,height:100}),null);
  assert.equal(recommendAutomaticSize({width:100,height:100,ratio:NaN}),null);
  assert.equal(recommendAutomaticSize({width:1001,height:800,multiple:4}).authority,'logical-heuristic');
  assert.equal(recommendAutomaticSize({width:4000,height:4000,multiple:4}).width,97);
});
test('asynchronous old-source result and initial generation both reject replaced source', () => {
  const source = readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
  assert.match(source,/if \(!currentSource\(\)\) return;/);
  assert.match(source,/if \(currentSource\(\)\) applyLogicalSize\(\)/);
  assert.match(source,/shouldAutoWriteLongEdge\(longEdgeAuthority\)/);
  assert.match(source,/sizeSourceRevision \+= 1;\s*multipleDetectionUrl = null;\s*multipleDetection = null;\s*detectedForUrl = null;/);
});
test('same URL reimport invalidates old success/failure and generation callbacks', async () => {
  let revision = 1, url = 'same-image', writes = [];
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const firstRevision = revision;
  const stale = pending.then(() => { if (isCurrentSizeSource(firstRevision, revision, url, url)) writes.push(333); });
  revision += 1;
  const nextRevision = revision;
  if (isCurrentSizeSource(nextRevision,revision,url,url)) writes.push(104);
  complete(); await stale;
  assert.deepEqual(writes,[104]);
  assert.equal(isCurrentSizeSource(nextRevision,revision,url,'other-image'),false);
});
test('tiny detected grids fall back honestly; effective crop dimensions preserve grid', () => {
  const tiny = recommendAutomaticSize({width:300,height:20,multiple:4});
  assert.equal(tiny.authority,'logical-heuristic');
  const cropped = recommendAutomaticSize({width:400,height:600,multiple:4});
  assert.equal(cropped.width,100); assert.equal(cropped.height,150);
});
test('transparent outer margins trim without discarding internal holes or white artwork', () => {
  const value = image(10, () => [255,255,255]);
  assert.equal(transparentContentBounds(value),null);
  for (let y=0;y<10;y++) for(let x=0;x<10;x++) if(x<2||x>7||y<3||y>6||(x===4&&y===4)) value.data[(y*10+x)*4+3]=0;
  assert.deepEqual(transparentContentBounds(value),{x:2,y:3,width:6,height:4});
  value.data.fill(0);
  assert.equal(transparentContentBounds(value),null);
});
test('tiled alpha scan returns exact original coordinates with bounded allocation', async () => {
  let sx,sy,sw,sh, reads=0,yields=0;
  const canvas = {width:0,height:0,getContext:()=>({
    clearRect(){}, drawImage(image,x,y,w,h){sx=x;sy=y;sw=w;sh=h;},
    getImageData(x,y,w,h){
      reads++; assert.ok(w<=512 && h<=512);
      const data=new Uint8ClampedArray(w*h*4);
      for(let py=0;py<h;py++) for(let px=0;px<w;px++) {
        // alpha 1 at a tile boundary is retained, not treated as visually empty.
        if(sx+px>=511 && sx+px<=2050 && sy+py>=513 && sy+py<=2051) data[(py*w+px)*4+3]=1;
      }
      assert.equal(w,sw); assert.equal(h,sh);
      return {width:w,height:h,data};
    },
  })};
  const bounds=await transparentImageBounds({naturalWidth:2601,naturalHeight:2603},{createCanvas:()=>canvas,yieldTask:async()=>{yields++;}});
  assert.deepEqual(bounds,{x:511,y:513,width:1540,height:1539});
  assert.equal(canvas.width,512); assert.equal(canvas.height,512);
  assert.equal(reads,36); assert.equal(yields,2);
});
test('async crop assignment rejects a newer import even when file URL is unchanged',()=>{
  const source=readFileSync(new URL('../app.js',import.meta.url),'utf8');
  const start=source.indexOf('const importedTransform = state.sourceTransform;');
  const end=source.indexOf('importedTransform.crop = automaticCrop;',start);
  assert.ok(start>0 && end>start);
  assert.match(source.slice(start,end),/state\.sourceDataUrl !== prepared\.dataUrl \|\| state\.sourceTransform !== importedTransform\) return;/);
});
