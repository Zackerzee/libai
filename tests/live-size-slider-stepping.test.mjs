import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');

/**
 * 行内「尺寸设置」滑杆（#ws-live-size-range）逐格化。
 *
 * 背景：原生 range 把 1–1000 线性铺在 90px 轨道上，实测每拖 1px 跳约 11 格、
 * 从轨道中段抓起的一瞬间从 104 蹦到 500（真机探针 outputs/size-slider/probe-slider-baseline.mjs）。
 * 修复 = 位置↔值两段线性映射（常用区 1 格/位置）+ 两侧 ±1 按钮 + 方向键按值步进。
 *
 * 这些断言钉三件事：
 *   1. 映射本身：往返精确、单调、常用区一格一变（没有它，「UI 同步」会把用户的值改掉）；
 *   2. 接线：handler 真的把位置换算回格数，且生成链路 / 结构缩放的既有纪律原样保留；
 *   3. 隔壁的生成尺寸滑杆 #ws-size-range 不许被顺手改坏（b0/b4 探针直设它的 value）。
 */

const MAP = source.match(/const LIVE_SIZE_FINE_MAX=[\s\S]*?const liveSizePositionToValue=[^\n]*/);
assert.ok(MAP, '找不到位置↔值映射定义');
const sandbox = {};
vm.runInNewContext(`${MAP[0]}\nthis.valueToPosition=liveSizeValueToPosition;this.positionToValue=liveSizePositionToValue;this.maxPosition=LIVE_SIZE_MAX_POSITION;this.fineMax=LIVE_SIZE_FINE_MAX;`, sandbox);
const { valueToPosition, positionToValue, maxPosition, fineMax } = sandbox;

test('映射常量：细区 1–150 一对一，粗区到 1000，位置空间是整数', () => {
  assert.equal(fineMax, 150);
  assert.equal(maxPosition, 234);
  assert.ok(Number.isInteger(maxPosition), 'LIVE_SIZE_MAX_POSITION 必须是整数，否则 input max 出现小数');
});

test('往返精确：每个位置都能原样换回来（UI 同步不得改动用户的值）', () => {
  for (let position = 0; position <= maxPosition; position += 1) {
    assert.equal(valueToPosition(positionToValue(position)), position, `position ${position} 往返失败`);
  }
});

test('单调不减：拖动只会让尺寸朝一个方向走', () => {
  let previous = 0;
  for (let position = 0; position <= maxPosition; position += 1) {
    const value = positionToValue(position);
    assert.ok(value >= previous, `position ${position} 回退了（${previous} -> ${value}）`);
    previous = value;
  }
});

test('常用区一格一变：positionToValue(p) === p + 1（用户诉求「滑动的时候一个一个变化」）', () => {
  for (let position = 0; position < fineMax; position += 1) {
    assert.equal(positionToValue(position), position + 1, `细区 position ${position} 不是 1 格/位置`);
  }
  assert.equal(positionToValue(0), 1);
  assert.equal(positionToValue(fineMax - 1), fineMax);
});

test('粗区步进 10 格且封顶 1000', () => {
  assert.equal(positionToValue(fineMax), 160);
  assert.equal(positionToValue(maxPosition), 1000);
  for (let position = fineMax; position <= maxPosition; position += 1) {
    const value = positionToValue(position);
    assert.equal(value % 10, 0, `粗区 position ${position} -> ${value} 不是 10 的倍数`);
    assert.ok(value >= 160 && value <= 1000, `粗区 position ${position} -> ${value} 越界`);
  }
});

test('越界值被夹住，不会产出 NaN 位置', () => {
  assert.equal(valueToPosition(0), 0);
  assert.equal(valueToPosition(-5), 0);
  assert.equal(valueToPosition(1001), maxPosition);
  assert.equal(valueToPosition(99999), maxPosition);
  assert.equal(positionToValue(-3), 1);
  assert.equal(positionToValue(99999), 1000);
  assert.ok(Number.isFinite(valueToPosition(Number.NaN)) || valueToPosition('x') === 0);
});

test('滑杆元素改成位置空间，并带两侧 ±1 按钮与无障碍标签', () => {
  assert.match(source, /id="ws-live-size-range" type="range" min="0" max="'\+LIVE_SIZE_MAX_POSITION\+'" step="1" aria-label="图纸长边（格）/);
  assert.match(source, /data-live-size-step="-1" aria-label="长边减一格"/);
  assert.match(source, /data-live-size-step="1" aria-label="长边加一格"/);
});

test('updateLiveSizeUi 写映射后的位置，且不再动态改 slider.min/max', () => {
  const sync = source.match(/const updateLiveSizeUi=\(\)=>\{[^\n]*\};/);
  assert.ok(sync, '找不到 updateLiveSizeUi');
  assert.match(sync[0], /const bounds=liveSizeBounds\(\);const edge=clamp\(Math\.max\(result\.width,result\.height\),bounds\.min,bounds\.max\);liveSizeEdge=edge;slider\.value=String\(liveSizeValueToPosition\(edge\)\)/, '同步要把格数写回单一事实源，并把位置交给映射');
  assert.doesNotMatch(sync[0], /slider\.min=/, 'min/max 是值域概念，已由 liveSizeBounds() 接管；元素属性只能是位置');
  assert.doesNotMatch(sync[0], /slider\.max=/);
});

test('input handler 把位置换算回格数，且两条链路的纪律原样保留', () => {
  const handler = source.slice(
    source.indexOf("$('#ws-live-size-range').addEventListener('input'"),
    source.indexOf("$('#ws-live-size-range').addEventListener('change'"),
  );
  assert.match(handler, /liveSizePositionToValue\(Number\(event\.target\.value\)\)/, '拖拽给的是位置，必须换算成格数');
  assert.match(handler, /setLongEdgeDraft\(edge\)/);
  assert.match(handler, /liveSizeEdge=edge;/, '生效后要记住格数，让步进按钮从它继续');
  // 与 explicit-size-commit / live-size-no-crop 相同的秩序断言（修复不得破坏权威链）
  assert.ok(handler.indexOf('pushDraftToBridge()') < handler.indexOf('requestLiveGenerationSize();return;'));
  assert.ok(handler.indexOf('requestLiveGenerationSize();return;') < handler.indexOf('createGridResizeCommand'));
  assert.match(handler, /sourceUrl&&!bridge\.getResult\(\)\.manualEdited/);
  assert.match(handler, /mode:'pattern'/);
  assert.doesNotMatch(handler, /resizeValue\('ws-resize-mode'\)/);
  assert.match(handler, /patternSource:liveSizeSource/);
});

test('方向键按值步进（±1 / Shift ±10），并阻止原生按 position 步进', () => {
  const keydown = source.match(/\$\('#ws-live-size-range'\)\.addEventListener\('keydown'[\s\S]*?\n  \}\);/);
  assert.ok(keydown, '找不到 #ws-live-size-range 的 keydown 处理器');
  assert.match(keydown[0], /ArrowLeft[\s\S]*ArrowRight[\s\S]*ArrowUp[\s\S]*ArrowDown/, '四个方向键都要拦截');
  assert.match(keydown[0], /event\.preventDefault\(\)/);
  assert.match(keydown[0], /event\.shiftKey\?10:1/);
});

test('步进与预设走精确值通道 + 映射， Shift 一次十格', () => {
  assert.match(source, /liveSizeStep\(Number\(button\.dataset\.liveSizeStep\)\*\(event\.shiftKey\?10:1\)\)/, '按钮点击要把 ±1 放大成 Shift ±10');
  assert.match(source, /const liveSizeStep=\(delta\)=>\{[\s\S]*?liveSizeEdge!==null\?liveSizeEdge:liveSizePositionToValue/, '步进从上次生效的格数继续，不从轨道位置反推');
  assert.match(source, /if\(liveSizeCommand\)finishLiveSize\(\);/, '结构缩放的每一步都要落成可撤销命令');
  const presets = source.match(/resizeDialog\.querySelectorAll\('\[data-resize-preset\]'\)\.forEach\(button=>button\.addEventListener\('click'[^\n]*/);
  assert.ok(presets, '找不到预设按钮处理器');
  assert.match(presets[0], /liveSizeEdge=value;liveSizeSyntheticInput=true;slider\.value=String\(liveSizeValueToPosition\(value\)\)/, '预设也要走映射 + 精确值通道');
});

test('滚轮与方向键同语义（±1 / Shift ±10）', () => {
  const wheel = source.match(/\$\('#ws-live-size-range'\)\.addEventListener\('wheel'[\s\S]*?\{passive:false\}\);/);
  assert.ok(wheel, '找不到 #ws-live-size-range 的 wheel 处理器');
  assert.match(wheel[0], /event\.preventDefault\(\)/);
  assert.match(wheel[0], /liveSizeStep\(\(event\.deltaY<0\?1:-1\)\*\(event\.shiftKey\?10:1\)\)/);
});

test('隔壁的生成尺寸滑杆不许被改坏（b0/b4 探针直设它的 value）', () => {
  assert.match(source, /id="ws-size-range" type="range" min="10" max="500" step="1" value="104" aria-label="图纸长边（格）"/);
  const generationHandler = source.match(/\$\("#ws-size-range"\)\?\.addEventListener\("input", \(event\) => \{[^\n]*\}/);
  assert.ok(generationHandler, '生成尺寸滑杆的 input handler 不见了');
  assert.match(generationHandler[0], /setLongEdgeDraft\(event\.target\.value\)/, '它仍是值空间，不得掺入位置映射');
});
