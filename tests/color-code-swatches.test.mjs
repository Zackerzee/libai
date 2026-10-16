import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
test('all color inputs receive swatch picker while legacy replacement uses code values',()=>{
 for(const id of ['ws-current-color-target','ws-repair-target','ws-merge-target','ws-outline-target','ws-ramp-level-target'])assert.ok(source.includes(`"#${id}"`));
 assert.match(source,/paletteColorPickers\.push\(\.\.\./);
 assert.match(source,/attachPaletteColorPicker\(\$\("#ws-replace-from"\), \{getColors:replacementSourceColors,surfaces,valueMode:"code"\}/);
 assert.match(source,/getUsedPaletteColor\(id\)/);
 assert.match(source,/picker\?\.sync\(\)/);
});
test('merge swatches preserve native selectedOptions and existing change handlers',()=>{
 assert.match(source,/data-ws-merge-source/);
 assert.match(source,/option\.selected\s*=\s*checkbox\.checked/);
 assert.match(source,/selectedOptions/);
 assert.match(source,/dispatchEvent\(new Event\("change",\{bubbles:true\}\)\)/);
});
