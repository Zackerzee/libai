import test from 'node:test';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {BRAND_LOGOS,brandLogo} from '../ui/palette-brand-cards.mjs';
test('all ten supplied display assets exist and official palette aliases share their brand logo',()=>{
 assert.equal(new Set(Object.values(BRAND_LOGOS)).size,10);
 for(const file of Object.values(BRAND_LOGOS))assert.ok(existsSync(new URL('../assets/brand/'+file,import.meta.url)));
 for(const key of ['cocoOfficial','manmanOfficial','panpanOfficial','mixiaowoOfficial'])assert.ok(brandLogo(key));
 assert.equal(brandLogo('artkal197'),brandLogo('youken174'));
 assert.equal(brandLogo('unsupported'),null);
});
