import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { renderCompactExportPreview } from '../ui/export-options-panel.mjs';
import { renderPngPatternCanvas } from '../services/png-pattern-export-renderer.js';

const native = createRequire('/Users/gongzhenyan/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/package.json')('@napi-rs/canvas');
const red = { paletteId: 'mard:F01', code: 'F01', rgb: [220, 50, 60] };
const green = { paletteId: 'mard:B01', code: 'B01', rgb: [50, 160, 100] };
const grid = Array.from({ length: 13 }, (_, y) => Array.from({ length: 23 }, (_, x) => [red, green, null][(x + y) % 3]));

for (const cellSize of [1, 2, 3]) for (const showCoordinates of [false, true]) {
  test(`compact ${cellSize}px preview matches original sheet pixels, coordinates=${showCoordinates}`, () => {
    const previous = globalThis.document, before = structuredClone(grid);
    globalThis.document = { createElement() { return native.createCanvas(1, 1); } };
    try {
      const settings = { cellSize, constructionSheet: true, showGrid: false, showCodes: false, showCoordinates, title: 'Series A', paletteLabel: 'MARD', majorGridInterval: 5 };
      const actual = renderCompactExportPreview(grid, settings).canvas;
      const expected = renderPngPatternCanvas(grid, settings);
      assert.equal(actual.width, expected.width); assert.equal(actual.height, expected.height);
      assert.deepEqual(actual.getContext('2d').getImageData(0, 0, actual.width, actual.height).data,
        expected.getContext('2d').getImageData(0, 0, expected.width, expected.height).data);
      assert.deepEqual(grid, before);
    } finally {
      if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    }
  });
}
