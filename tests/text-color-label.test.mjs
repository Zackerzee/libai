import test from 'node:test';
import assert from 'node:assert/strict';
import {textLayerColorLabel} from '../ui/text-panel.js';
test('text layer color metadata resolves identity not ambiguous code',()=>{
 const palette=[{paletteId:'one',code:'A01',hex:'#ff0000'},{paletteId:'two',code:'A01',rgb:[0,0,255]}];
 const label=textLayerColorLabel({paletteId:'two',color:'A01'},palette);
 assert.match(label,/rgb\(0,0,255\)/);assert.match(label,/A01/);assert.doesNotMatch(label,/#ff0000/);
});
