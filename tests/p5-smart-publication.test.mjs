import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateFinalPattern } from '../smart-preprocessing/region-aware-quantizer.mjs';

const app = readFileSync(new URL('../app.js', import.meta.url), 'utf8');
test('prepared validation is invalidated by actual live cell writer, even before stats refresh', () => {
  const a = { code: 'A01', rgb: [1, 2, 3] }, b = { code: 'B01', rgb: [3, 4, 5] };
  const state = { grid: [[a, a]], stats: [{ ...a, count: 2 }], paletteBudget: { effective: 1 } };
  const applyStart = app.indexOf('  applyCellChanges(changes,');
  const apply = app.slice(applyStart, app.indexOf('  setProductionOptions(', applyStart));
  const checkStart = app.indexOf('  getChecks: () =>');
  const checks = app.slice(checkStart, app.indexOf('\n};', checkStart));
  const mutationEvents = [];
  const bridge = new Function('state', 'window', 'cloneColor', 'CustomEvent', `
    let smartTolerancePublicationChecks = { grid: state.grid, stats: state.stats, actualColors: 1 };
    return { ${apply} ${checks} };`)(state, { LibmsRegionAwareQuantizer: { validateFinalPattern }, dispatchEvent: event => mutationEvents.push(event.type) },
      color => ({ ...color, rgb: [...color.rgb] }), class { constructor(type) { this.type = type; } });
  assert.deepEqual(bridge.getChecks().validation, { valid: true, actualColors: 1, maxColors: 1 });
  assert.equal(bridge.applyCellChanges([{ x: 1, y: 0, after: b }], { live: true }), 1);
  assert.deepEqual(bridge.getChecks().validation, { valid: false, actualColors: 2, maxColors: 1 });
  assert.deepEqual(mutationEvents, ['libms:grid-mutated']);
});

test('prepared publication never calls synchronous PNG or legacy chart regeneration', () => {
  const prepare = app.slice(app.indexOf('async function prepareSmartTolerancePublication'),
    app.indexOf('function publishSmartTolerancePublication'));
  assert.match(prepare, /toBlob/); assert.match(prepare, /scheduler\.checkpoint/);
  assert.doesNotMatch(prepare, /toDataURL|state\.grid\s*=/);
  const publish = app.slice(app.indexOf('function publishSmartTolerancePublication'),
    app.indexOf('function createLightPreviewCanvas'));
  assert.doesNotMatch(publish, /refreshChartUrl|toDataURL|toBlob/);
  assert.match(publish, /cloneColor\(color\)/);
});
