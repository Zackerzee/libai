import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync, unlinkSync } from 'node:fs';
import { generateV2 } from '../smart-preprocessing/generation-engine-v2.mjs';
import { getMardPalette } from '../smart-preprocessing/palette-data.mjs';

test('release default-off and capture-only match deployed baf7aea cells at all five sizes', async () => {
  const target = new URL(`../smart-preprocessing/.sct-release-baseline-${process.pid}.mjs`, import.meta.url);
  const source = execFileSync('git', ['show', 'baf7aea9:smart-preprocessing/generation-engine-v2.mjs'], {cwd:new URL('..',import.meta.url),encoding:'utf8'});
  writeFileSync(target, source);
  try {
    const baseline = await import(target.href);
    const palette = getMardPalette(221);
    const sourceWidth=24, sourceHeight=24, data=new Uint8ClampedArray(sourceWidth*sourceHeight*4);
    for(let y=0;y<sourceHeight;y++)for(let x=0;x<sourceWidth;x++) {
      const rgb = x<4?[230,210,195]:x>18?[30,30,30]:y<8?[250,250,248]:y>18?[200,140,110]:[245,190,160];
      data.set([...rgb,(x===0&&y===0)?0:255],(y*sourceWidth+x)*4);
    }
    for(const size of [52,78,104,250,500]) {
      // Large default-unlimited runs exercise the actual deployed algorithms.
      // Legacy hard-budget parity is covered separately at52, avoiding its
      // established per-cell grid.flat().find() cost on the 500 fixture.
      const input={source:{data,width:sourceWidth,height:sourceHeight},width:size,height:size,palette,options:{sampling:'center',maxColors:size===52?3:0,detailProtection:0.7,edgeProtection:0.7}};
      const expected=baseline.generateV2(input).grid;
      assert.deepEqual(generateV2({...input, options:{...input.options,smartColorTolerance:{enabled:false,strength:100,policy:'quality-first'}}}).grid,expected,`disabled ${size}`);
      const captured=generateV2({...input,options:{...input.options,smartToleranceCaptureBaseline:true}});
      assert.deepEqual(captured.grid,expected,`capture ${size}`);
      assert.ok(captured.diagnostics.smartToleranceBaselineCapture);
    }
  } finally {unlinkSync(target);}
});
