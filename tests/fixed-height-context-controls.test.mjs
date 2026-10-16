import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const workspace=readFileSync(new URL('../ui/workspace.js',import.meta.url),'utf8');
const css=readFileSync(new URL('../styles/workspace.css',import.meta.url),'utf8');
const panelSource=readFileSync(new URL('../ui/generation-panel.js',import.meta.url),'utf8');
// 面板 import 的服务依赖由 vm context 注入（这里只测面板自身行为）。
// 阶段 2：面板从 1 条 import 变成 2 条（多了 mode-profile 的 MODE_LABELS），
// 且两条之间隔着注释 —— /^(import…\n)+/ 的连续匹配会被注释行截断，
// 漏网的 import 进 vm 直接 SyntaxError。这里按行全局剥离，并在 context 补 MODE_LABELS。
// 阶段 3：再加 background-mode.mjs 的四个导出（三模式常量表 / 提示 / 默认值 /
// 归一化函数）。这也是面板里那条 import 必须保持单行的原因 —— 见面板注释。
const context={GENERATION_MODE_PRESETS:{},MODE_LABELS:{},
  BACKGROUND_MODE_LIST:[{id:'keep'},{id:'transparent'},{id:'auto'}],
  BACKGROUND_MODE_HINTS:{keep:'填充',transparent:'留空',auto:'自动移除'},
  DEFAULT_BACKGROUND_MODE:'transparent',
  normalizeBackgroundMode:value=>['keep','transparent','auto'].includes(value)?value:'transparent'};
vm.createContext(context);
vm.runInContext(panelSource.replace(/^import[^\n]+\n/gm,'').replace('export class GenerationPanel','class GenerationPanel')+'\nglobalThis.Panel=GenerationPanel;',context);

test('context row is fixed on desktop and mobile; options scroll while symmetry overlays',()=>{
  assert.equal((css.match(/height:72px;min-height:72px;max-height:72px/g)||[]).length,2);
  assert.match(css,/\.ws-context-symmetry> :not\(summary\)\{position:fixed/);
  assert.match(workspace,/getBoundingClientRect\(\)/);
  assert.match(css,/flex-wrap:nowrap;gap:10px;overflow-x:auto;overflow-y:hidden/);
});

test('size controls move as original nodes and visibility follows existing workarea state',()=>{
  assert.match(workspace,/generationTopControls\.append\(generationSizeBlock, generationBackgroundHost\)/);
  assert.match(workspace,/generationTopControls\.hidden = !generationContext/);
  assert.match(workspace,/workarea === 'generate' && !state\.ui\.exportDrawerOpen/);
  assert.match(workspace,/backgroundRoot: "#ws-generation-background-host"/);
  assert.match(panelSource,/backgroundRoot\.replaceChildren\(this\.root\.querySelector\("#ws-generation-background-controls"\)\)/);
});

test('external background mode cards keep one delegated click, mirror and repaint',()=>{
  // 阶段 3：单开关 → 三选一卡片。卡片所在的那一节在 render() 里被
  // replaceChildren 搬进 backgroundRoot（工作台步进卡）—— 点击事件冒泡到
  // backgroundRoot 的祖先，**到不了 this.root**。bindEvents 因此把同一个
  // onClick 绑在两个根上；这条 mock 就是钉这个事实的。
  const listeners=new Map();
  const autoCard={dataset:{bgMode:'auto'},classList:{toggle(){}},setAttribute(){}};
  let cardNode=autoCard;
  autoCard.closest=selector=>selector==='[data-bg-mode]'?cardNode:null;
  const keepCard={dataset:{bgMode:'keep'},classList:{toggle(){}},setAttribute(){}};
  keepCard.closest=selector=>selector==='[data-bg-mode]'?cardNode:null;
  const panel=Object.create(context.Panel.prototype);
  panel.root={addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}};
  panel.backgroundRoot={addEventListener(kind,handler){listeners.set(kind,handler);},querySelectorAll(){return [keepCard,autoCard];},querySelector(){return null;}};
  panel.state={backgroundMode:'transparent'};
  let emitted;
  panel.onChange=settings=>{emitted=settings;};
  panel.bindEvents();
  cardNode=autoCard;
  listeners.get('click')({target:autoCard});
  assert.equal(panel.state.backgroundMode,'auto');
  assert.equal(emitted.backgroundRemoval,true);
  assert.equal(emitted.autoBackground,true);
  // setState → syncUI：双根查卡片高亮 + 状态行（mock 只验证不炸且 state 落地）
  panel.setState({backgroundMode:'keep'},false);
  assert.equal(panel.state.backgroundMode,'keep');
});

test('three-panel layout repositions real inspector and shares palette identity actions',()=>{
  assert.match(workspace,/grid\.prepend\(right\)/);
  assert.match(css,/grid-template-columns:240px var\(--ws-rail-width\) minmax\(0,1fr\) 220px!important/);
  assert.match(css,/\.workspace-grid>\.ws-inspector\.ws-parameter-inspector>\.ws-inspector-scroll\{display:block!important/);
  assert.match(workspace,/ws-summary-colors"\)\.textContent = String\(hasPattern \? state\.stats\.usedColors/);
  assert.match(workspace,/const summaryResult = bridge\.getResult\(\)/);
  assert.match(workspace,/ws-summary-grid"\)\.textContent = hasPattern \? `\$\{summaryResult\.width\}/);
  assert.match(workspace,/querySelector\('#ws-summary-physical'\)\.prepend\(right\.querySelector\('#ws-physical-size'\)\)/);
  assert.match(workspace,/ws-summary-usage"\)\.addEventListener\("click", handleUsageClick\)/);
  assert.match(workspace,/ws-usage-strip"\)\.addEventListener\("click", handleUsageClick\)/);
  assert.match(workspace,/data-ws-usage="\$\{esc\(entry\.paletteId\)\}"/);
});

test('usage and selection cannot resize canvas and mobile summaries have explicit close',()=>{
  // 用量带高度契约 2026-10-16 起改为**内容驱动**（原 80px 固定两行）：
  // 用户反馈「高度过高、占据位置过多」——空态时色块条只有一行提示文字，
  // 固定 80px 下面全是空白。现在 height:auto + min-height:38px，
  // 真机实测有颜色时 41px。仍是「不能撑大画布」：auto 行 + 横向滚动的色块条。
  assert.match(css,/body\.phase2-workspace #ws-canvas-stats\.ws-usage-band\{height:auto;min-height:38px;box-sizing:border-box;overflow:visible/);
  // 单行：色块条（左，1fr 横向滚动）+ 排序组（右）同行 —— 不再是两列两行。
  assert.match(css,/#ws-canvas-stats\.ws-usage-band\{grid-template-columns:minmax\(0,1fr\) auto\}/);
  assert.match(css,/#ws-selection-actionbar\{position:absolute/);
  assert.match(workspace,/关闭配色清单/);
  assert.match(workspace,/summaryCloseButton\.addEventListener\('click'/);
  assert.match(workspace,/生成去纯色背景','generation','ws-generation-background-host'/);
});
