import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('right-click and temporary eyedropper synchronize replacement target without clearing selection',()=>{
  const helper=source.slice(source.indexOf('const syncPickedReplacementTarget'),source.indexOf('const onCanvasDown'));
  assert.match(helper,/input\.value=color\.code/);
  assert.match(helper,/input\.dispatchEvent\(new Event\("change",\{bubbles:true\}\)\)/);
  const right=source.slice(source.indexOf('function pickCurrentColor(id)'),source.indexOf('attachUniversalColorPick(wrap'));
  const eyedropper=source.slice(source.indexOf('if (tool === "eyedropper" && cell)'),source.indexOf('if (tool === "bead" && cell)'));
  const pickHelper=source.slice(source.indexOf('const pickCellColor'),source.indexOf('const updateEyedropperDwell'));
  assert.match(right,/syncPickedReplacementTarget\(color\)/);
  assert.match(eyedropper,/pickCellColor\(cell\)/);
  assert.match(pickHelper,/syncPickedReplacementTarget\(color\)/);
  assert.doesNotMatch(right+eyedropper+pickHelper,/selection:\s*null/);
  assert.doesNotMatch(pickHelper,/cellColorPopover\.open/);
});
test('palette picking is read-only and never silently switches to bead tool', () => {
  const activation = source.split('const activateColor = (code) => {')[1]?.split('\n  };')[0];
  assert.ok(activation);
  assert.match(activation, /buildActivateColorPatch/);
  assert.doesNotMatch(activation, /setCellColor|tool\s*:/);
});
test('usage highlight may be cancelled by repeated click or Escape', () => {
  assert.match(source, /highlightedPaletteId === card.dataset.wsUsage\) \{ clearColorHighlight\(\)/);
  // 底栏「取消高亮」按钮已移除（与右栏同色高亮重复）。取消高亮仍有两条真实路径：
  // 重复点击色块条上的同一张卡片，以及 Esc —— 下面的守卫断言覆盖后者。
  assert.doesNotMatch(source, /ws-usage-clear"\)\.addEventListener\("click", clearColorHighlight\)/);
  assert.match(source, /if \(get\(\).editor.highlightedPaletteId\) clearColorHighlight\(\)/);
  assert.match(source, /function clearColorHighlight\(\) \{\s*store.setState/);
});
test('usage active state follows canonical current palette independently of highlight', () => {
  assert.match(source, /const selected = currentPaletteId\(\);/);
  assert.match(source, /usageSelected !== selected/);
});
test('move tool taps inspect while moved/cancelled drags do not inspect', () => {
  assert.match(source, /Math.hypot\(event.clientX - drag.x, event.clientY - drag.y\) > 4/);
  assert.match(source, /!cancel && drag\?\.type === "pan" && !drag.moved && drag.inspectCell/);
  assert.match(source, /inspectCell: tool === "pan" && !spaceDown && event.button === 0 \? cell : null/);
});
