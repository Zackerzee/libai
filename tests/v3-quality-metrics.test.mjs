import test from 'node:test';
import assert from 'node:assert/strict';
import {percentile,labHue,measureV3Grid,rasterColors,measureV3Colors} from '../services/v3-quality-metrics.mjs';
test('V3 quantiles and black white dynamic range have explicit reproducible definitions',()=>{
  assert.equal(percentile([0,10],.05),.5);assert.equal(percentile([], .5),null);
  const m=measureV3Grid([[{code:'black',rgb:[0,0,0]},{code:'white',rgb:[255,255,255]},null]]);
  assert.equal(m.width,3);assert.equal(m.filledCells,2);assert.equal(m.usedColors,2);assert.ok(Math.abs(m.dynamicRange-90)<.001);assert.equal(m.darkPixels,1);assert.equal(m.highlightPixels,1);assert.equal(m.neutralRatio,1);assert.deepEqual(m.colorUsage,{black:1,white:1});
});
test('V3 Lab hue bins and alpha transparency are measured without mutating source',()=>{
  assert.equal(labHue([50,0,0]),'neutral');assert.equal(labHue([50,0,-50]),'blue');assert.equal(labHue([50,50,0]),'red');
  const image={width:2,height:1,data:new Uint8ClampedArray([255,0,0,255,0,0,255,0])},before=[...image.data];
  const m=measureV3Colors(rasterColors(image),image);assert.equal(m.filledCells,1);assert.equal(m.width,2);assert.deepEqual([...image.data],before);
});
