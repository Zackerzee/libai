import test from 'node:test';
import assert from 'node:assert/strict';
import { colorLabelInk } from '../ui/color-label.mjs';
import { compactPaletteLabel } from '../ui/palette-brand-cards.mjs';
test('palette labels choose readable foreground on light and dark colours',()=>{
  assert.equal(colorLabelInk({hex:'#ffffff'}),'#111111');
  assert.equal(colorLabelInk({hex:'#000000'}),'#ffffff');
  assert.equal(colorLabelInk({rgb:[255,255,0]}),'#111111');
});
test('compact kit names state count once and reference tiers retain actual count',()=>{
  assert.equal(compactPaletteLabel({key:'mard-24',colors:Array(24)}),'Kit 24');
  assert.equal(compactPaletteLabel({key:'x-12',tierLabel:'经典',colors:Array(12)}),'经典 · 12 色');
});
