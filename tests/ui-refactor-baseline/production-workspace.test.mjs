import test from 'node:test';
import assert from 'node:assert/strict';
import { createGenerationService } from '../../services/generation-service.js';
import { createProjectStore } from '../../state/project-store.js';
import { createEditorService } from '../../services/editor-service.js';
import { createExportService } from '../../services/export-service.js';

test('production generation sends V2.5 settings separately and retains canonical grid result', async () => {
  const store = createProjectStore({
    canvas: { width: 104, height: 131 },
    generation: { engine: 'v2.5', preset: 'auto', sampling: 'auto' },
  });
  const cells = [[{ code: 'H07', rgb: [0, 0, 0], hex: '#000000' }]];
  let selected, request;
  const bridge = {
    setProductionOptions(value) { selected = value; },
    async generate(value) { request = value; return { width: 104, height: 131, grid: cells, paletteKey: 'mard-221', usedColors: 1, totalBeads: 1, colors: [{ code: 'H07', count: 1 }], sourceUrl: 'data:image/png;base64,A' }; },
    getResult() { return { grid: cells }; },
  };
  const result = await createGenerationService(bridge, store).generate();
  assert.equal(selected.engine, 'v2.5');
  assert.equal(selected.generationOptions.sampling, 'auto');
  // 尺寸不进 request：store.canvas 是回写命名空间，当入参用会让上一版图纸尺寸污染下一版。
  assert.deepEqual(request, { maxColors: 0, overwriteApproved: false });
  assert.equal(result.grid, cells);
  assert.equal(store.getState().status.hasPattern, true);
});

test('V2.5 failure stays visible and does not call another engine', async () => {
  const store = createProjectStore();
  let calls = 0;
  const bridge = { setProductionOptions() {}, async generate() { calls++; throw new Error('V2.5 failed'); } };
  await assert.rejects(createGenerationService(bridge, store).generate(), /V2.5 failed/);
  assert.equal(calls, 1);
  assert.equal(store.getState().status.generating, false);
});

test('toolbar mirror action changes the export grid and undo restores it', async () => {
  const a = { code: 'A', rgb: [0, 0, 0], hex: '#000000' };
  const b = { code: 'B', rgb: [255, 255, 255], hex: '#ffffff' };
  const grid = [[a, b, b]];
  const bridge = {
    getResult: () => ({ grid, width: 3, height: 1 }),
    getCell: (x, y) => grid[y][x],
    getPaletteColors: () => [a, b],
    applyCellChanges(changes) { for (const { x, y, after } of changes) grid[y][x] = after; return changes.length; },
    downloadPattern: () => grid.map((row) => row.map((cell) => cell.code)),
  };
  const store = createProjectStore({ status: { hasPattern: true } });
  const editor = createEditorService(bridge);
  const exporter = createExportService(bridge, store);
  assert.equal(editor.flip('horizontal'), true);
  assert.deepEqual(await exporter.export('pattern-png'), [['B', 'B', 'A']]);
  assert.equal(editor.canUndo(), true);
  editor.undo();
  assert.deepEqual(await exporter.export('pattern-png'), [['A', 'B', 'B']]);
});
