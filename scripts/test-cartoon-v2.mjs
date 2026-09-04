import assert from 'node:assert/strict';
import {generateCartoonBeadPattern,segmentColorRegions,extractRegionColor,calculateCartoonGridSize,detectContentCrop} from '../lib/cartoonEngine.js';
import {loadColorMath,loadPalette} from './lib/color-math.mjs';
const ctx=loadColorMath();
const palette=loadPalette();
const rawDelta=(a,b)=>ctx.deltaE2000(ctx.rgbToLab(...a),ctx.rgbToLab(...b));
const image={width:32,height:32,data:new Uint8ClampedArray(32*32*4)};
for(let y=0;y<32;y++)for(let x=0;x<32;x++)image.data.set(x===4||x===27||y===4||y===27?[0,0,0,255]:[255,255,255,255],(y*32+x)*4);
const before=Buffer.from(image.data);
const result=generateCartoonBeadPattern(image,{forceCartoon:true,width:32,palette,colorMath:ctx});
assert(before.equals(Buffer.from(image.data)));
assert(result.diagnostics.finalColors<=10);
for(let x=4;x<=27;x++)assert(Math.max(...result.grid[4][x].rgb)<45);
assert(result.grid.flat().every(c=>!c||palette.some(p=>p.code===c.code&&String(p.rgb)===String(c.rgb))));
assert.equal(calculateCartoonGridSize(image,'simple',200).width,200,'explicit grid width must not be clamped by tier caps');
assert.equal(calculateCartoonGridSize(image,'simple').width,80,'auto mode keeps tier cap');
assert.throws(()=>generateCartoonBeadPattern(image,{forceCartoon:true,colorMath:ctx,palette,maxColors:0}));
const seg=segmentColorRegions(image,(a,b)=>Math.abs(a[0]-b[0]));
assert(seg.regions.length>=3);assert.deepEqual(extractRegionColor(seg.regions[0],image),[255,255,255]);
// Thin light line on a dark fill must render as ONE connected bead chain --
// regression for the dashed goggle-frame defect (fragments + per-cell
// coverage threshold used to chop lines into dots).
const LN={width:64,height:64,data:new Uint8ClampedArray(64*64*4)};
for(let i=0;i<64*64;i++)LN.data.set([60,60,60,255],i*4);
for(let t=0;t<=48;t++){const x=8+t,y=Math.round(32+t*8/48);LN.data.set([211,207,200,255],(y*64+x)*4);}
const lr=generateCartoonBeadPattern(LN,{forceCartoon:true,palette,colorMath:ctx,width:24,autoTrim:false});
const beadLum=c=>.299*c.rgb[0]+.587*c.rgb[1]+.114*c.rgb[2];
let gaps=0;
for(let t=0;t<=48;t++){const x=8+t,y=Math.round(32+t*8/48);const gx=Math.min(lr.width-1,Math.floor(x*lr.width/64)),gy=Math.min(lr.height-1,Math.floor(y*lr.height/64));if(beadLum(lr.grid[gy][gx])<120)gaps++;}
assert.equal(gaps,0,'thin line must stay connected, gaps='+gaps);
// Auto-trim: a small subject on a large blank canvas must be cropped so the
// subject fills the bead grid (padding ~1%).
const big={width:100,height:100,data:new Uint8ClampedArray(100*100*4).fill(255)};
for(let y=30;y<50;y++)for(let x=60;x<80;x++){const o=(y*100+x)*4;big.data[o]=10;big.data[o+1]=10;big.data[o+2]=10;big.data[o+3]=255;}
const crop=detectContentCrop(big,rawDelta);
assert(crop,'content crop must be detected');
assert(crop.x>=58&&crop.x<=61&&crop.y>=28&&crop.y<=31,'crop x/y near subject: '+JSON.stringify(crop));
assert(crop.width>=20&&crop.width<=24&&crop.height>=20&&crop.height<=24,'crop size near subject: '+JSON.stringify(crop));
const trimmed=generateCartoonBeadPattern(big,{forceCartoon:true,palette,colorMath:ctx});
assert.notEqual(trimmed.diagnostics.crop,'none','auto-trim should engage by default');
assert(trimmed.width>=Math.floor(trimmed.height*0.9)&&trimmed.width<=Math.ceil(trimmed.height*1.1),'grid follows crop aspect');
assert.equal(generateCartoonBeadPattern(big,{forceCartoon:true,palette,colorMath:ctx,autoTrim:false}).diagnostics.crop,'none','autoTrim:false keeps full frame');
// lineLockShare validation
assert.throws(()=>generateCartoonBeadPattern(image,{forceCartoon:true,colorMath:ctx,palette,lineLockShare:1.5}));
console.log('PASS: source immutable, black ring, real palette, budget, dimensions, connected regions, auto-trim, lock share');
