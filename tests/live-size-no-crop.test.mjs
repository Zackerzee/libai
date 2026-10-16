import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGridResizeCommand } from '../services/grid-resize-service.js';
const source={width:10,height:20,grid:Array.from({length:20},(_,y)=>Array.from({length:10},(_,x)=>({code:`${x},${y}`,paletteId:`color:${x},${y}`,rgb:[x,y,0]})))};
test('size resamples the complete frame and repeated shrink/enlarge restores the fixed source',()=>{
 let current=structuredClone(source);
 const bridge={replaceGridStructure:s=>{current=structuredClone(s);return true;}};
 const small=createGridResizeCommand(bridge,{...source,targetWidth:5,targetHeight:10,mode:'pattern',patternSource:source});
 small.execute();
 assert.equal(current.grid[0][0].code,'1,1');
 assert.equal(current.grid[9][4].code,'9,19');
 const smallSnapshot=structuredClone(current);
 const large=createGridResizeCommand(bridge,{...smallSnapshot,targetWidth:10,targetHeight:20,mode:'pattern',patternSource:source});
 large.execute();assert.deepEqual(current,source);
 large.undo();assert.deepEqual(current,smallSnapshot);
 large.redo();assert.deepEqual(current,source);
});
test('directional canvas expansion remains independent and preserves every existing cell',()=>{
 let current;
 createGridResizeCommand({replaceGridStructure:s=>{current=s;return true;}},{...source,targetWidth:39,targetHeight:20,mode:'canvas',anchor:'left'}).execute();
 assert.deepEqual(current.grid.map(row=>row.slice(0,10)),source.grid);
 assert.ok(current.grid.every(row=>row.slice(10).every(c=>c===null)));
});
test('live slider cannot select the cropping resize mode',()=>{
 const text=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
 const handler=text.slice(text.indexOf("$('#ws-live-size-range').addEventListener('input'"),text.indexOf("$('#ws-live-size-range').addEventListener('change'"));
 assert.match(handler,/mode:'pattern'/);assert.doesNotMatch(handler,/resizeValue\('ws-resize-mode'\)/);
 assert.match(handler,/patternSource:liveSizeSource/);
});
