import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { BRAND_PALETTES, BRAND_PALETTE_SOURCE } from '../smart-preprocessing/palette-international.mjs';

const expected = { perler: 103, hama: 92, nabbi: 30, yant: 119 };

test('runtime registration preserves namespaced identities and never overwrites existing brands', () => {
  const source = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
  const build = source.slice(source.indexOf('function buildPaletteVariant('), source.indexOf('function parseBrandCodeMap('));
  const register = source.slice(source.indexOf('function registerExternalBrandPalettes('), source.indexOf('function appendExternalBrandButtons('));
  const context = { BRAND_PROFILES: { mard: { label: 'MARD' } }, PALETTES: {}, EXTERNAL_BRAND_LABELS: {},
    rgbToHex: rgb => '#' + rgb.map(n => n.toString(16).padStart(2, '0')).join(''),
    getPaletteKey: (brand, count) => `${brand}-${count}`, appendExternalBrandButtons() {},
    window: { dispatchEvent() {} }, CustomEvent: class {} };
  vm.createContext(context);
  vm.runInContext(build + register, context);
  const entries = BRAND_PALETTES.map(entry => ({ ...entry, colors: entry.colors.map(color => ({ ...color, paletteId: `${entry.id}:${color.code}` })) }));
  assert.equal(context.registerExternalBrandPalettes(entries, BRAND_PALETTE_SOURCE), 4);
  assert.equal(context.registerExternalBrandPalettes(entries, BRAND_PALETTE_SOURCE), 0);
  assert.equal(context.BRAND_PROFILES.mard.label, 'MARD');
  for (const entry of entries) {
    const colors = context.PALETTES[`${entry.id}-${expected[entry.id]}`];
    assert.equal(colors.length, entry.colors.length);
    assert.ok(colors.every(color => color.paletteId === `${entry.id}:${color.code}`));
    assert.ok(colors.every(color => color.sourceUrl === entry.sourceUrl));
  }
  assert.equal(context.PALETTES['hama-92'].find(c => c.code === 'H01').paletteId, 'hama:H01');
});

test('international palettes retain separate reference catalogs and provenance', () => {
  assert.deepEqual(BRAND_PALETTES.map(p => p.id).sort(), Object.keys(expected).sort());
  assert.equal(BRAND_PALETTE_SOURCE.license, 'MIT');
  assert.match(BRAND_PALETTE_SOURCE.revision, /^[a-f0-9]{40}$/);
  assert.equal(BRAND_PALETTE_SOURCE.retrievedAt, '2026-10-08');
  for (const palette of BRAND_PALETTES) {
    assert.equal(palette.colors.length, expected[palette.id]);
    assert.equal(palette.sourceVersion, BRAND_PALETTE_SOURCE.revision);
    assert.ok(palette.sourceUrl.includes(`/blob/${palette.sourceVersion}/raw/${palette.id}.csv`));
    assert.match(palette.tierLabel, /社区参考/);
    assert.equal(new Set(palette.colors.map(c => c.code)).size, palette.colors.length);
    for (const color of palette.colors) {
      assert.ok(color.code && color.name && color.contributor);
      assert.equal(color.rgb.length, 3);
      assert.ok(color.rgb.every(n => Number.isInteger(n) && n >= 0 && n <= 255));
    }
  }
});

test('Nabbi classic references are not represented as PhotoPearls or BioBeads codes', () => {
  const palette = BRAND_PALETTES.find(p => p.id === 'nabbi');
  assert.deepEqual(palette.colors.map(c => c.code).sort(), Array.from({ length: 30 }, (_, i) => `N${String(i + 1).padStart(2, '0')}`));
  assert.match(palette.summary, /不是 PhotoPearls 45 色或 BioBeads 35 色/);
});

test('Yant retains distinct color codes even where RGB values coincide', () => {
  const colors = BRAND_PALETTES.find(p => p.id === 'yant').colors;
  assert.deepEqual(colors.map(c => c.code).sort(), Array.from({ length: 119 }, (_, i) => `Y${String(i + 2).padStart(3, '0')}`));
  assert.deepEqual(colors.find(c => c.code === 'Y030').rgb, [157, 34, 52]);
  assert.deepEqual(colors.find(c => c.code === 'Y031').rgb, [157, 34, 52]);
  assert.equal(new Set(colors.map(c => c.rgb.join(','))).size, 118);
});
