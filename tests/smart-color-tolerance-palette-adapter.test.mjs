import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolveSmartTolerancePaletteContext as resolve } from '../services/smart-color-tolerance-palette-adapter.mjs';

const color = (code, rgb = [10, 20, 30], paletteId) => ({ code, rgb, ...(paletteId ? { paletteId } : {}) });
test('adapter needs neither global palette helper', () => {
  assert.equal(typeof globalThis.getAvailablePaletteIds, 'undefined');
  assert.equal(typeof globalThis.getGenerationPaletteColors, 'undefined');
  assert.deepEqual(resolve({ paletteEntries: [color('A01')], paletteKey: 'mard-221' }).paletteIds, ['A01']);
});
test('only runtime dependency is the unchanged HEAD identity contract', () => {
  const head = execFileSync('git', ['show', 'baf7aea9:services/palette-identity.js'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(readFileSync(new URL('../services/palette-identity.js', import.meta.url), 'utf8'), head);
  const source = readFileSync(new URL('../services/smart-color-tolerance-palette-adapter.mjs', import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^import .* from ['"]([^'"]+)['"]/gm)].map(match => match[1]), ['./palette-identity.js']);
});
test('real entries and ordering are preserved without mutation', () => {
  const entries = [color('B02'), color('A01')];
  const before = structuredClone(entries);
  const result = resolve({ paletteEntries: entries, paletteKey: 'original-key' });
  assert.notEqual(result.paletteEntries, entries);
  assert.equal(result.paletteEntries[0], entries[0]);
  assert.equal(result.paletteEntries[1], entries[1]);
  assert.deepEqual(result.paletteIds, ['B02', 'A01']);
  assert.deepEqual(entries, before);
});
test('multi-brand same RGB and same code retain distinct real identity', () => {
  const result = resolve({ paletteEntries: [color('A01', [1, 2, 3], 'mard:A01'), color('A01', [1, 2, 3], 'other:A01')], paletteKey: 'mixed-explicit' });
  assert.deepEqual(result.paletteIds, ['mard:A01', 'other:A01']);
  assert.equal(result.paletteEntries.length, 2);
});
test('palette switch changes the explicit context', () => {
  const entries = [color('A01')];
  assert.notDeepEqual(resolve({ paletteEntries: entries, paletteKey: 'mard-24' }), resolve({ paletteEntries: entries, paletteKey: 'mard-48' }));
});
test('missing key or palette fails explicitly', () => {
  for (const input of [undefined, {}, { paletteEntries: [], paletteKey: 'x' }, { paletteEntries: [color('A')], paletteKey: '' }]) assert.throws(() => resolve(input), TypeError);
});
test('invalid entries fail without silently constructing or filtering colors', () => {
  for (const entry of [null, {}, color(''), color('A', [NaN, 2, 3]), color('A', [256, 2, 3]), color('A', ['1', 2, 3]), color('A', [1, 2]), color('A', new Array(3)), { ...color('A'), paletteId: '' }]) {
    assert.throws(() => resolve({ paletteEntries: [color('valid'), entry], paletteKey: 'x' }), TypeError);
  }
  const sparse = new Array(1);
  assert.throws(() => resolve({ paletteEntries: sparse, paletteKey: 'x' }), TypeError);
});
test('duplicate identity is rejected rather than guessed or RGB-deduplicated', () => {
  assert.throws(() => resolve({ paletteEntries: [color('A'), color('A', [40, 50, 60])], paletteKey: 'x' }), /duplicate/);
});
test('caller-selected generation subset is preserved exactly', () => {
  const palette = [color('A'), color('B'), color('C')];
  const allowed = new Set(['A', 'C']);
  const actual = palette.filter(entry => allowed.has(entry.code));
  const context = resolve({ paletteEntries: actual, paletteKey: 'x' });
  assert.deepEqual(context.paletteEntries, actual);
  assert.deepEqual(context.paletteIds, [...allowed]);
});
