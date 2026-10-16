import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { rectangularSelection } from '../services/selection-service.js';
const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');
test('select tool captures drag, accepts either axis and clamps endpoints', () => {
  assert.match(source, /type: "select", start: cell/);
  assert.match(source, /Math.hypot\(event.clientX - drag.x, event.clientY - drag.y\) > 4/);
  assert.match(source, /selection: drag.previousSelection/);
  assert.match(source, /selection: drag.previousSelection, \.\.\.drag.previousFocus/);
  assert.match(source, /previousFocus: \{ selectedCell: get\(\).editor.selectedCell, \.\.\.buildHighlightOnlyPatch\(get\(\).editor.highlightedPaletteId\)/);
  assert.match(source, /const end = viewport.screenToGridClamped\(p.x, p.y\)/);
  assert.deepEqual(rectangularSelection(2, 3, 6, 3, 10, 10), {kind:'rectangle',x0:2,y0:3,x1:6,y1:3});
  assert.deepEqual(rectangularSelection(2, 6, 2, 3, 10, 10), {kind:'rectangle',x0:2,y0:3,x1:2,y1:6});
});
test('ordinary selection does not enable global highlighting', () => {
  assert.match(source, /buildActivateColorPatch\(inspected.paletteId, paletteColors\(\), \{ highlight: false \}\)/);
  assert.match(source, /if \(!cancel && drag\?\.type === "pan"/);
});
test('usage palette scroll is confined to strip and marching ants respect reduced motion', () => {
  assert.match(source, /usageSelected !== usageScrolledPaletteId/);
  assert.match(source, /strip.scrollBy\(\{ left: offset/);
  assert.doesNotMatch(source, /card.scrollIntoView/);
  assert.match(css, /ws-usage-card.active::after/);
  assert.match(css, /prefers-reduced-motion:reduce\)\{\.ws-usage-card.active::after\{animation:none/);
});
