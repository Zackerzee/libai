import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
test('原图取色按实际绘制的图纸矩形映射，不使用原图编辑区旧布局', () => {
  const body = source.match(/const sourcePickPoint = event => \{([\s\S]*?)\n  \};/)[1];
  const pick = new Function('get', 'point', 'viewport', 'bridge', 'BASE_CELL', 'sourceImage', 'sourceLayout', `return event => {${body}}`)(
    () => ({ ui: { activePanel: 'edit' }, view: { mode: 'original', zoom: .5 } }), e => e,
    { gridToScreen: () => ({ x: 50, y: 60 }) }, { getResult: () => ({ sourceUrl: 'image', width: 100, height: 50 }) }, 20,
    {}, { x: 0, y: 0, width: 1, height: 1 });
  assert.deepEqual(pick({ x: 550, y: 310 }), { x: .5, y: .5 });
  assert.equal(pick({ x: 49, y: 310 }), null);
  assert.equal(pick({ x: 1050, y: 310 }), null);
});
test('原图取色独立按钮默认关闭，点击开启吸管，再点击恢复原模式和工具', () => {
  const block = source.slice(source.indexOf('  const originalPickButton ='), source.indexOf('  const gridToolbar ='));
  let state = { view: { mode: 'pattern' }, editor: { tool: 'brush' }, ui: { activePanel: 'source' }, reference: { adjusting: true } }, handler;
  const button = { setAttribute() {}, addEventListener(type, fn) { handler = fn; } };
  const store = { setState(patch) { state = { view: { ...state.view, ...patch.view }, editor: { ...state.editor, ...patch.editor }, ui: { ...state.ui, ...patch.ui }, reference: { ...state.reference, ...patch.reference } }; }, subscribe() {} };
  new Function('document', '$', 'bridge', 'store', 'get', 'buildActive', 'setWorkspaceMode', 'endDrag', block)(
    { createElement: () => button }, () => ({ after() {} }), { getResult: () => ({ sourceUrl: 'image' }) }, store, () => state, () => false, () => {}, () => {});
  assert.equal(state.view.mode, 'pattern');
  handler(); assert.equal(state.view.mode, 'original'); assert.equal(state.editor.tool, 'eyedropper');
  assert.equal(state.ui.activePanel, 'edit');
  assert.equal(state.reference.adjusting, false);
  handler(); assert.equal(state.view.mode, 'pattern'); assert.equal(state.editor.tool, 'brush');
  assert.equal(state.ui.activePanel, 'source');
  assert.equal(state.reference.adjusting, true);
});
test('原图显示时吸管分支先取色再返回，不落入豆格绘制', () => {
  assert.match(source, /if \(get\(\)\.view\.mode === "original"\) \{ if \(\['eyedropper', 'source-eyedropper', 'reference-eyedropper'\]\.includes\(tool\)\) pickDisplayedOriginal\(sourcePickPoint\(event\)\); return; \}/);
  assert.match(source, /addEventListener\("pointerup", endCompare\)/);
});
test('施工入口先退出施工再保存编辑视口，结束取色通过正式入口恢复施工', () => {
  const block = source.slice(source.indexOf('  const originalPickButton ='), source.indexOf('  const gridToolbar ='));
  let active = true, handler, state = { view: { mode: 'pattern' }, editor: { tool: 'pan' }, ui: { activePanel: 'build' }, reference: { adjusting: false } };
  const modes = [], button = { setAttribute() {}, addEventListener(type, fn) { handler = fn; } };
  const store = { setState(patch) { for (const key of Object.keys(patch)) state[key] = { ...state[key], ...patch[key] }; }, subscribe() {} };
  const mode = value => { modes.push(value); active = value === 'build'; state.ui.activePanel = active ? 'build' : 'color'; state.editor.tool = active ? 'pan' : 'brush'; };
  new Function('document', '$', 'bridge', 'store', 'get', 'buildActive', 'setWorkspaceMode', 'endDrag', block)(
    { createElement: () => button }, () => ({ after() {} }), { getResult: () => ({ sourceUrl: 'image' }) }, store, () => state, () => active, mode, () => {});
  handler(); assert.equal(active, false); assert.equal(state.view.mode, 'original');
  handler(); assert.equal(active, true); assert.equal(state.ui.activePanel, 'build');
  assert.deepEqual(modes, ['edit', 'build']);
});
