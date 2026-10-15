import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { raw, ICON_COUNT, ICON_NAMES } from '../ui/workspace-icons.mjs';
import { resolveTheme, THEME_MODES } from '../ui/workspace-theme.mjs';
import { selectionCombineMode } from '../ui/selection-context-controls.mjs';
/**
 * 设计稿原稿枚数（拼豆工具-图标总表.html）。它是**来源**，不是上限。
 * 后续按需新增的图标必须登记在 ADDED_ICONS 里 —— 这样 ICON_COUNT 的断言
 * 仍然是精确相等，「删掉一枚原稿、再加一枚新的」这种悄无声息的漂移会立刻变红；
 * 如果只是把 76 改成 77，这个断言就退化成「有人记得改数字」了。
 */
const SUPPLIED_ICON_COUNT = 76;
const ADDED_ICONS = ['qr'];

test('supplied icon library retains all 76 standalone SVGs', () => {
  assert.equal(ICON_COUNT, SUPPLIED_ICON_COUNT + ADDED_ICONS.length, `原稿 ${SUPPLIED_ICON_COUNT} 枚 + 登记新增 ${ADDED_ICONS.length} 枚`);
  for (const name of ICON_NAMES) assert.match(raw(name), /^<svg viewBox="0 0 24 24">/);
  for (const name of ADDED_ICONS) assert.ok(ICON_NAMES.includes(name), `新增图标 ${name} 必须真的存在于图标库`);
});
test('fill and pick color semantics remain intact', () => {
  assert.match(raw('text'), /fill-rule="evenodd"/);
  assert.match(raw('qr'), /fill-rule="evenodd"/);
  assert.match(raw('pencil'), /var\(--pick\)/);
  assert.match(raw('dropper'), /var\(--pick-ink\)/);
  assert.equal(raw('unknown'), '');
});
test('light/dark toggle retains deterministic resolution for old system preference', () => {
  assert.deepEqual(THEME_MODES, ['light', 'dark']);
  assert.equal(resolveTheme('light', true), 'light');
  assert.equal(resolveTheme('dark', false), 'dark');
  assert.equal(resolveTheme('system', true), 'dark');
  assert.equal(resolveTheme('system', false), 'light');
});
test('visible drawing labels are Chinese, and navigation reuses original controls', () => {
  const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
  assert.doesNotMatch(source, />Ink<|Shade Darker|Shade Lighter|canonical grid|> Pixel Perfect/);
  assert.match(source, /navigateSize:/);
  assert.match(source, /navigateSize: \(\) => showInlineSizeSettings/);
  assert.match(source, /inlineSizeSettings\.append\(resizeDialog\)/);
  const layout = readFileSync(new URL('../ui/workspace-v3-layout.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(layout, /navigateReference|ws-ref-pick/);
});
test('the horizontal toolbar is the existing toolbar host and the usage strip is not relocated', () => {
  const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
  const css = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');
  assert.match(source, /topControls\.prepend\(toolRail\)/);
  assert.match(source, /topControls\.prepend\(toolRail\)/);
  assert.match(source, /id='ws-export-now'.*textContent='导出作品'/);
  assert.match(source, /exportNow\.addEventListener\('click',openExportDrawer\)/);
  assert.match(source, /top\.querySelector\('#ws-status'\),[\s\S]*?\]\.filter\(Boolean\)\)/);
  assert.match(source, /wrap\.addEventListener\('click', event =>/);
  // 阶段 1：三列对调为「左色板 / 中画布 / 右任务面板」（原先是左任务 / 右色板）。
  // 列宽走变量，折叠只由 :has() 改变量，JS 不写布局数字。
  assert.match(css, /grid-template-columns:var\(--ws-pal-col,240px\) minmax\(0,1fr\) var\(--ws-task-col,300px\)!important/);
  assert.match(css, /\.ws-palette-summary\{grid-column:1;grid-row:1;[^}]*border-left:0;border-right:1px solid var\(--ws-border\)/);
  assert.match(css, /\.ws-parameter-inspector\{[^}]*grid-column:3;grid-row:1;[^}]*border-left:1px solid var\(--ws-border\);border-right:0/);
  assert.match(css, /workspace-grid:has\(> \.ws-palette-summary\.is-collapsed\)\{--ws-pal-col:44px\}/);
  assert.match(css, /workspace-grid:has\(> \.ws-parameter-inspector\.is-collapsed\)\{--ws-task-col:44px\}/);
  // 底栏状态五要素：统计行 + 当前色号 + 当前工具 + 缩放 + 视图设置（zoomControls 移入 dock）
  assert.match(source, /dockTool\.id = 'ws-dock-tool'/);
  assert.match(source, /viewBar\.insertBefore\(zoomControlsNode, dockSettings\)/);
  assert.match(css, /workspace-grid\[data-workspace-ready="true"\]>\.ws-rail\{display:none!important\}/);
  assert.match(css, /sl-grid-toolbar-rail\{display:flex!important;flex-direction:row!important/);
  assert.match(source, /const usageBand=\$\("#ws-canvas-stats"\)/);
  // 底栏顺序：配色清单（最左，跨两行）→ 隐藏的旧统计 → 色块条 → 排序组（条下方）→ 相近色列表。
  assert.match(source, /usageBand\.append\(usageSummaryInline,usageTotals,\$\("#ws-usage-strip"\),usageBandTools,\$\("#ws-usage-similar-list"\)\)/);
  // 左栏步骤卡（旧断言停在更早的 onboarding 文案上，已随本轮更新）：
  // 「参考图」整节搬到右栏，不再是左栏的一个步骤。
  assert.match(source, /stepSpecs=\[\['3','一键预设'\],\['1','画面调整'\],\['2','扩容画布'\]/);
  assert.doesNotMatch(source, /moveToStep\('7',referenceGroup\)/);
  assert.match(css, /Six-step toolbar\/layout wins over legacy responsive declarations above/);
  // 右栏垂直分配：.ws-summary-picker 是 flex:1 1 auto + min-height:0，参考图节（实测 574px）
  // 搬进右栏后它会静默塌成 0 高，里面 1706px 的色板整块被裁掉 —— 右栏选色直接不可用。
  // 这条守卫钉住「选色区有保底高度 + 参考图节不参与收缩」两个不变量，别退回纯 flex 挤压。
  assert.match(css, /#ws-palette-summary \.ws-summary-picker\{min-height:260px\}/);
  assert.match(css, /#ws-palette-summary \.ws-reference-group\{flex:0 0 auto\}/);
  // 透明度只留竖向一个控件：横向那行与竖向滑杆是同一份 reference.opacity，
  // 并排摆两个控件调同一个值是重复。节点与监听保留，只是加 hidden 不再露面。
  // 注意：该选择器住在逗号分隔的 [hidden] 兜底块里，后面跟的是 "," 而不是 "{"。
  assert.match(source, /referenceGroup\.querySelector\('#ws-ref-opacity'\)\?\.closest\('label'\)\?\.setAttribute\('hidden',''\)/);
  assert.match(css, /#ws-palette-summary \.ws-reference-group label\[hidden\]/);
  // 参考图必须画在豆格「之上」：透明度条调的是「参考图 ↔ 作品」的此消彼长，
  // 排在 base 之下时它只在空格处透出来，永远盖不住豆格，滑杆调到头也看不出作品变淡。
  const renderer = readFileSync(new URL('../ui/canvas-renderer.js', import.meta.url), 'utf8');
  assert.match(renderer, /const LAYER_NAMES = \["base", "reference", "grid", "codes", "overlay", "highlight"\]/);
  // 透明度条 = 右栏最左侧的独立竖条（不是塞进内容流）；参考图整节撤出右栏内容区。
  assert.match(source, /paletteSummary\.append\(opacityRail,paletteContent\)/);
  assert.match(source, /referenceGroup\.hidden=true/);
  assert.match(css, /#ws-palette-summary\{flex-direction:row;gap:0;padding:0;overflow:hidden\}/);
  assert.match(css, /#ws-palette-summary \.ws-reference-group\{display:none!important\}/);
  assert.match(css, /#ws-reference-opacity\{flex:0 0 auto;width:30px/);
  // 「作品信息」必须进【内容列】而不是直接挂右栏：右栏已是横向两栏，直接挂上去它会被
  // 并排成一列（实测挤到 58px 宽，输入框没法用）。钉住它走 paletteContent。
  assert.match(source, /paletteContent\.prepend\(projectInfo\)/);
  assert.doesNotMatch(source, /paletteSummary\.prepend\(projectInfo\)/);
  // blocks（成像）分支在画参考图之前就 return —— 导入工程/新建空白板若停在 blocks，
  // 「上传参考图 → 透明度条 → 按住对照」整条流程都看不到参考图。底栏已无「成像」按钮，
  // blocks 是回不去的死状态，两处写入都必须是 pattern。
  assert.doesNotMatch(source, /view:\s*\{\s*mode:\s*"blocks"\s*\}/);
  assert.doesNotMatch(source, /view:\s*\{\s*mode:\s*'blocks'\s*\}/);
  const layoutChoice = css.slice(css.lastIndexOf('/* v3 layout choice:'));
  assert.doesNotMatch(layoutChoice, /#ws-canvas-stats|#ws-usage-strip|\.ws-usage-band/);
});
test('selection modifiers preserve configured mode and Shift/Alt behavior', () => {
  assert.equal(selectionCombineMode({}, 'replace'), 'replace');
  assert.equal(selectionCombineMode({}, 'add'), 'add');
  assert.equal(selectionCombineMode({ shiftKey: true }, 'subtract'), 'add');
  assert.equal(selectionCombineMode({ altKey: true, shiftKey: true }, 'add'), 'subtract');
});
test('closed lasso, selection move and reference sampling are wired as presentation over existing state', () => {
  const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
  const renderer = readFileSync(new URL('../ui/canvas-renderer.js', import.meta.url), 'utf8');
  assert.match(source, /closedLassoSelection\(drag\.points, width, height\)/);
  assert.match(source, /editorService\.applySelectionTransform\(preview\)/);
  assert.match(source, /referencePixelAt\(p, image\.naturalWidth, image\.naturalHeight, box, ref\)/);
  assert.match(source, /sampleReferencePixel\(context\.getImageData\(0, 0, 1, 1\)/);
  assert.match(source, /selectionUI\?\.within\(\)/);
  assert.match(renderer, /editor\.shapePreview\?\.selectionTransform/);
  assert.match(renderer, /editor\.shapePreview\?\.selectionPath/);
  assert.doesNotMatch(source, /selectionGrid|editableSelectionGrid/);
});
