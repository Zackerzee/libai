import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildHighlightOnlyPatch } from '../services/current-palette.mjs';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('inspection navigation highlights issue without replacing repair colour or panel', () => {
  const body = source.slice(source.indexOf('const activateInspectionCurrent ='), source.indexOf('const updateInspection ='));
  assert.match(body, /buildHighlightOnlyPatch\(issue.paletteId\)/);
  assert.doesNotMatch(body, /inspectPalette\(|buildActivateColorPatch|activePanel/);
  assert.match(body, /viewport.focusCell/);
  const editor = { currentPaletteId: 'H07', selectedPaletteId: 'H07', selectedColor: 'H07' };
  assert.deepEqual({ ...editor, ...buildHighlightOnlyPatch('H02') }, { ...editor, highlightedPaletteId: 'H02', highlightedColor: null });
});
test('grid edits during inspection do not reset manually picked repair colour', () => {
  const body = source.slice(source.indexOf('window.addEventListener("libms:grid-edited"'), source.indexOf('window.addEventListener("libms:legacy-editor-saved"'));
  assert.match(body, /if \(selected && !inspectionState.active\)/);
});
test('temporary eyedropper preserves inspection panel', () => {
  const body = source.slice(source.indexOf('const pickCellColor'), source.indexOf('const updateEyedropperDwell'));
  assert.match(body, /!inspectionState.active \? \{ ui:/);
});
test('switching repair tools preserves the inspection panel', () => {
  // 阶段 1：工具切换逻辑提取为命名函数（主工具条与「更多工具」扩展实例共用），
  // 锚点随重构从 onToolChange: (tool) => 移到 const handleToolChange。
  const body = source.slice(source.indexOf('const handleToolChange = (tool) =>'), source.indexOf('const gridToolbar = new GridEditorToolbar'));
  assert.match(body, /inspectionState.active \? get\(\)\.ui.activePanel : "edit"/);
  // 共用引用是硬约束：不许出现第二份工具切换逻辑（两处实例会各自漂移）。
  assert.match(source, /onToolChange: handleToolChange/);
  assert.doesNotMatch(source, /onToolChange: \(tool\) =>/);
});
