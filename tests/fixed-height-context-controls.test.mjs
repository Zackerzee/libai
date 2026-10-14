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
const context={GENERATION_MODE_PRESETS:{},MODE_LABELS:{}};
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

test('external background switch preserves delegated input, mirror and state repaint',()=>{
  const listeners=new Map(), checkbox={dataset:{field:'backgroundRemoval'},type:'checkbox',checked:false};
  const panel=Object.create(context.Panel.prototype);
  panel.root={addEventListener(){},querySelector(){return null;},querySelectorAll(){return [];}};
  panel.backgroundRoot={addEventListener(kind,handler){listeners.set(kind,handler);},querySelectorAll(){return [checkbox];}};
  panel.state={backgroundRemoval:false};
  let emitted;
  panel.onChange=settings=>{emitted=settings;};
  panel.bindEvents();
  checkbox.checked=true;
  listeners.get('input')({target:checkbox});
  assert.equal(panel.state.backgroundRemoval,true);
  assert.equal(emitted.backgroundRemoval,true);
  assert.equal(emitted.autoBackground,true);
  panel.setState({backgroundRemoval:false},false);
  assert.equal(checkbox.checked,false);
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
  assert.match(css,/height:80px;min-height:80px;max-height:80px;box-sizing:border-box;overflow:visible/);
  assert.match(css,/#ws-selection-actionbar\{position:absolute/);
  assert.match(workspace,/关闭配色清单/);
  assert.match(workspace,/summaryCloseButton\.addEventListener\('click'/);
  assert.match(workspace,/生成去纯色背景','generation','ws-generation-background-host'/);
});
