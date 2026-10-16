import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
test('unified production resets imported independent algorithms before dispatch', () => {
  const prefix = app.split('  setProductionOptions({ engine = "v2.5", generationOptions = {} } = {}) {')[1].split('    state.productionGenerationOptions')[0];
  for (const algorithmEngine of ['bgs', 'pindou-workbench', 'hybrid-pw', 'current']) {
    const state = { algorithmEngine };
    new Function('state', 'engine', 'generationOptions', prefix)(state, 'v2.5', {});
    assert.equal(state.algorithmEngine, 'current');
    assert.equal(state.generationEngine, 'v2.5');
  }
});
test('production requests enable fusion while keeping the shared size contract', () => {
  assert.match(app, /const resolved = buildV25Options\(options, maxColors\);[\s\S]*?resolved\.localFusionEnabled = true/);
  assert.match(app, /localFusion: result\.diagnostics\?\.localFusion \|\| null/);
});
