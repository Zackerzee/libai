import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import * as applied from '../services/applied-export-grid.mjs';
import * as archive from '../services/applied-project-archive.mjs';

const source = fs.readFileSync(new URL('../app.js', import.meta.url), 'utf8');
const workspace = fs.readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
const functionSource = name => {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf('\nfunction ', start + 1);
  return source.slice(start, end);
};
const cell = { paletteId: 'mard-221:A01', code: 'A01', rgb: [12, 24, 36], extra: { owned: true } };

test('applied export reads formal work with no legacy budget; legacy path stays opt-out', () => {
  let legacyCalls = 0;
  const state = { grid: [[cell, null]], width: 2, height: 1, smartToleranceReport: null };
  const context = vm.createContext({ state, window: { LibmsAppliedExportGrid: applied },
    getLegacyExportGrid() { legacyCalls++; return [['legacy']]; },
    isMirrorEnabled: () => false, mirrorGrid: rows => rows.map(row => row.slice().reverse()),
    console });
  vm.runInContext(functionSource('getExportGrid'), context);
  assert.deepEqual(context.getExportGrid(), [['legacy']]);
  assert.equal(legacyCalls, 1);
  state.smartToleranceReport = { applied: { strength: 50 } };
  const snapshot = context.getExportGrid();
  assert.deepEqual(snapshot, state.grid);
  assert.notEqual(snapshot[0][0].extra, cell.extra);
  assert.equal(legacyCalls, 1);
});

test('applied legacy mirror remains presentation-only and cannot mutate canonical work', () => {
  const state = { grid: [[cell, null]], width: 2, height: 1, smartToleranceReport: { applied: {} } };
  const context = vm.createContext({ state, window: { LibmsAppliedExportGrid: applied },
    isMirrorEnabled: () => true, mirrorGrid: rows => rows.map(row => row.slice().reverse()), console });
  vm.runInContext(functionSource('getExportGrid'), context);
  assert.equal(context.getExportGrid()[0][0], null);
  assert.equal(state.grid[0][0], cell);
});

test('settings export mirrors asymmetric cells once, never again in renderer options', () => {
  for (const active of [false, true]) {
    const state = { grid: [[cell, null]], width: 2, height: 1, smartToleranceReport: active ? { applied: {} } : null };
    const context = vm.createContext({ state, window: { LibmsAppliedExportGrid: applied },
      getLegacyExportGrid: () => [[null, cell]], isMirrorEnabled: () => true,
      mirrorGrid: rows => rows.map(row => row.slice().reverse()), getDownloadCellSize: () => 16,
      EXPORT_MIN_LONG_SIDE: 0, getExportSubtitle: () => '', console });
    vm.runInContext(functionSource('getExportGrid') + '\n' + functionSource('getExportGridForSettings') + '\n' + functionSource('buildExportRenderOptions'), context);
    const matrix = context.getExportGridForSettings();
    const options = context.buildExportRenderOptions(matrix, [], { format: 'png' });
    assert.equal(options.matrix[0][0], null);
    assert.equal(options.matrix[0][1].code, 'A01');
    assert.equal(options.mirror, undefined);
    assert.equal(state.grid[0][0], cell);
  }
});

test('normal JSON schema retains legacy identity rows; applied schema adds exact archive only', () => {
  const start = source.indexOf('  buildProjectJson() {');
  const end = source.indexOf('  downloadProjectJson(', start);
  const state = { grid: [[cell, null]], width: 2, height: 1, sourceName: 'test.png', stats: [{ ...cell, count: 1 }], smartToleranceReport: null };
  const context = vm.createContext({ state, window: { LibmsAppliedProjectArchive: archive },
    els: { maxColorsInput: { value: '0' } }, getSchemeName: () => '用户作品',
    getCurrentPaletteKey: () => 'mard-221', getCurrentPaletteLabel: () => 'MARD', hexFromRgb: () => '#0C1824' });
  const bridge = vm.runInContext(`({${source.slice(start, end)}})`, context);
  const ordinary = bridge.buildProjectJson();
  assert.equal(ordinary.projectName, '用户作品');
  assert.equal(ordinary.gridPaletteIds[0][0], cell.paletteId);
  assert.equal(Object.hasOwn(ordinary, 'appliedGrid'), false);
  state.smartToleranceReport = { applied: { enabled: true, algorithmVersion: 'v1-optin-1', strength: 60, paletteKey: 'mard-221', appliedRevision: 'revision-1' } };
  const confirmed = bridge.buildProjectJson();
  assert.deepEqual(archive.decodeAppliedGrid(confirmed.appliedGrid), state.grid);
  assert.equal(confirmed.smartColorTolerance.strength, 60);
});

test('production name override and upload/reference/picking presentation remain wired', () => {
  assert.match(source, /downloadProjectJson\(projectName\)/);
  assert.match(source, /payload\.projectName = String\(projectName/);
  assert.match(workspace, /bridge\.getSmartTolerancePreviewResult\?\.\(\)\?\?bridge\.getResult\(\)/);
  assert.match(workspace, /previewMirror\(\)==='none'\?effectiveReference\(\)/);
  assert.match(workspace, /smartColorTolerance:draft\.metadata\?\.smartColorTolerance\?\?null/);
});
