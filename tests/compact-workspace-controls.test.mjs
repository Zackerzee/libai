import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { colorLabelInk } from '../ui/color-label.mjs';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');

test('selected color actions reuse their existing nodes in the view row', () => {
  assert.ok(source.includes("viewBar.prepend($('#ws-usage-actions'))"));
  assert.ok(source.includes("$('#ws-summary-usage').hidden = true"));
  assert.ok(source.includes("paletteSummary.querySelector('.ws-summary-filter').hidden = true"));
  assert.ok(source.includes("$('#ws-project-meta').hidden = true"));
  assert.match(css, /#ws-dock-view #ws-usage-actions\{flex:0 0 auto;flex-wrap:nowrap/);
  assert.ok(source.includes("usageAlignmentObserver.observe($('#ws-canvas-stats'))"));
  assert.ok(source.includes("swatch.closest('.ws-usage-card').getBoundingClientRect().left"));
  assert.match(css, /margin:0 0 0 var\(--ws-usage-align,14px\)/);
});

test('size slider remains compatible but is not visible and generation row has no scroll', () => {
  assert.ok(source.includes("querySelector('#ws-size-range').hidden = true"));
  assert.match(css, /#ws-size-range\{display:none!important/);
  assert.match(css, /#ws-generation-top-controls\{overflow:hidden;gap:6px;flex-wrap:wrap/);
  assert.ok(source.includes("saveNow.before(top.querySelector('.ws-project-menu'))"));
});

test('fine grid defaults on and only major emphasis has a visible toggle', () => {
  assert.ok(source.includes('store.setState({ view: { showGrid: true } })'));
  assert.ok(!source.includes('id="ws-grid-mode"'));
  assert.ok(source.includes("$('#ws-grid').closest('label').hidden = true"));
  assert.ok(!source.includes("$('#ws-major-grid').closest('label').hidden = true"));
  assert.ok(source.includes('id="ws-major-grid-interval"'));
});

test('summary sizes are compact nonwrapping rows, physical size does not repeat grid count', () => {
  assert.match(css, /#ws-summary-grid\{font-size:16px;white-space:nowrap/);
  assert.match(css, /\.ws-summary-totals\{grid-template-columns:1fr/);
  const assignment = source.split('$("#ws-physical-size").textContent = ')[1].split(';')[0];
  assert.ok(assignment.includes(' cm'));
  assert.ok(!assignment.includes(' 豆'));
});

test('swatch code ink contrasts light and dark colors including RGB colors', () => {
  assert.equal(colorLabelInk({ hex: '#FFFFFF' }), '#111111');
  assert.equal(colorLabelInk({ hex: '#000000' }), '#ffffff');
  assert.equal(colorLabelInk({ rgb: [255, 255, 0] }), '#111111');
  assert.equal(colorLabelInk({ rgb: [0, 0, 180] }), '#ffffff');
  assert.match(source, /class="ws-code-swatch"/);
  assert.match(source, /color:\$\{swatchInk\(entry\)\}">\$\{esc\(entry\.code\)\}/);
});

test('tool context wraps without horizontal scrolling and retains add/properties actions', () => {
  assert.match(css, /#ws-tool-options\{overflow:visible;flex-wrap:wrap;align-content:center/);
  assert.ok(source.includes('id="ws-context-text-properties"'));
  assert.ok(source.includes("addTextButton.id=\"ws-context-text-add\""));
  assert.match(css, /#ws-context-text-summary\{display:none/);
});

test('mobile brush overflow moves live controls into a popup and restores desktop ordering', () => {
  assert.ok(source.includes("mobileBrushBody.append(group)"));
  assert.ok(source.includes("marker.after(group)"));
  assert.ok(source.includes("mobileBrushMedia.addEventListener('change',syncMobileBrushOptions)"));
  assert.ok(source.includes("group!==brushSizeContext"));
  assert.match(css, /\.ws-mobile-brush-options-body\{position:fixed;z-index:99/);
  assert.ok(source.includes("mobileBrushOptions.open=false"));
});

test('actual palette picker moves to summary and all its DOM updates are signature guarded', () => {
  assert.ok(source.includes("paletteSummary.append(palettePickerSection)"));
  assert.ok(source.includes("palettePickerSection.append($(selector))"));
  const render = source.slice(source.indexOf('function renderPicker()'), source.indexOf('// ── Stage C0 §16'));
  assert.ok(render.indexOf('if (signature === pickerSignature) return') < render.indexOf('$("#ws-palette-categories").innerHTML'));
  assert.ok(render.indexOf('if (signature === pickerSignature) return') < render.indexOf('$("#ws-recent-colors").innerHTML'));
  assert.ok(source.includes("dockViewSettings.append(viewBar.querySelector('.ws-view-modes'),viewBar.querySelector('.ws-view-toggles'))"));
  assert.match(css, /\.ws-dock-view-settings\{display:flex;align-items:center;gap:10px;margin-left:auto/);
});

test('text frame resize previews then commits one object command and cancellation restores snapshot', () => {
  assert.ok(source.includes('const control=hitTextFrameControl(frame,p)'));
  assert.ok(source.includes('resizedTextScale(drag.initialScale,drag.start,p,drag.anchor)'));
  assert.ok(source.includes('if (cancel) setTextLayers(drag.before,drag.beforeActive)'));
  assert.ok(source.includes('drag.type===\'text-resize\'?"TEXT_UPDATE":"TEXT_MOVE"'));
  assert.ok(source.includes("well.style.cursor='';"));
});
