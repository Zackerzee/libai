import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { stepFrom } from '../ui/zoom-controls.js';

/**
 * 侧栏折叠 / 专注模式 / FIT-MANUAL 模式切换的行为守卫（2026-10-15 用户规格）。
 *
 * 用户原话与规格要点：
 *   ·「有的图太大 缩到 20% 看不完全图」→ 缩放下限改动态（min(20%, 适屏比例)），
 *     这层在 tests/viewport-zoom-fit.test.mjs 纯函数侧守；
 *   ·「左右侧栏独立折叠、一键专注模式、折叠状态本地持久化、折叠后画布必须真正扩大」
 *     → CSS 侧（--ws-pal-col/--ws-task-col）已在阶段 1 落地，这里守 JS 行为；
 *   · 「MANUAL 模式下，侧栏折叠不得强制重置当前缩放」→ 折叠后的 re-fit 必须看 zoomMode；
 *   · 专注模式要快照恢复：用户原来只收了一栏，退出后仍只收那一栏。
 *
 * 做法：把 workspace.js 里的 bindPanelCollapse / setFocusMode 两段切出来，
 * 在 vm 里用桩（假 DOM classList / localStorage / viewport）跑真实行为，
 * 而不是只 grep 字符串 —— 字符串在、逻辑反了，这类测试才是红灯。
 */
const source = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');

const COLLAPSE = source.match(/const bindPanelCollapse =[\s\S]*?\n  \};\n  const paletteCollapse =/);
assert.ok(COLLAPSE, '找不到 bindPanelCollapse 定义');
const FOCUS = source.match(/const FOCUS_STORAGE_KEY = [\s\S]*?\n  \};\n  const focusToggle =/);
assert.ok(FOCUS, '找不到专注模式（FOCUS_STORAGE_KEY / setFocusMode）定义');

// 复用同一段代码、每次换新桩，模拟「进入前只收了左栏」等不同初始状态。
function harness({ palette = false, task = false, mode = 'fit' } = {}) {
  const calls = { fits: 0 };
  const makePanel = (collapsed) => {
    const classes = new Set(collapsed ? ['is-collapsed'] : []);
    return { classList: { contains: (c) => classes.has(c), toggle: (c, on) => { if (on) classes.add(c); else classes.delete(c); return on; } } };
  };
  const palettePanel = makePanel(palette), taskPanelEl = makePanel(task);
  // localStorage 要按初始状态预置：页面加载时 bindPanelCollapse 的初始 sync
  // 会把面板刷成「存储里的状态」，真实 DOM 上两者本来就一致。
  const storage = new Map([['pal', palette ? '1' : '0'], ['task', task ? '1' : '0']]);
  const sandbox = {
    document: {
      createElement: () => ({ type: '', className: '', textContent: '', title: '', id: '',
        classList: { contains: () => false, toggle: () => {} },
        setAttribute: () => {}, addEventListener: () => {}, append: () => {} }),
      body: { classList: { contains: (c) => sandbox.__focus === c, toggle: (c, on) => { if (on) sandbox.__focus = c; else if (sandbox.__focus === c) sandbox.__focus = ''; } } },
    },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) },
    requestAnimationFrame: (fn) => { fn(); }, // 同步执行，让 re-fit 可观测
    viewport: { zoomMode: mode, fitToViewport: () => { calls.fits += 1; } },
    paletteSummary: palettePanel,
    taskPanel: taskPanelEl,
  };
  sandbox.globalThis = sandbox;
  vm.runInNewContext(`${COLLAPSE[0]}\nthis.paletteCollapse=bindPanelCollapse(paletteSummary,'pal','色板');this.taskCollapse=bindPanelCollapse(taskPanel,'task','任务面板');`, sandbox);
  vm.runInNewContext(`${FOCUS[0]}\nthis.setFocusMode=setFocusMode;this.toggle=focusToggle;`, sandbox);
  sandbox.toggle.setAttribute = () => {}; // 桩：aria-pressed 回写
  return { sandbox, calls, storage, panels: { palette: palettePanel, task: taskPanelEl } };
}

test('专注模式：双栏同收、持久化、re-fit', () => {
  const { sandbox, calls, storage, panels } = harness();
  sandbox.setFocusMode(true);
  assert.ok(sandbox.__focus === 'ws-focus-mode', '进入后 body 必须挂 ws-focus-mode');
  assert.ok(panels.palette.classList.contains('is-collapsed'), '左栏必须收起');
  assert.ok(panels.task.classList.contains('is-collapsed'), '右栏必须收起');
  assert.equal(storage.get('libms.workspace.focus.mode'), '1', '专注状态必须持久化');
  assert.equal(calls.fits, 4, '进入前两栏初始 sync 各一次 + 进入专注两栏各一次');
});

test('专注模式退出：按快照逐栏还原（只收过左栏就只收左栏）', () => {
  const { sandbox, storage, panels } = harness({ palette: true, task: false });
  sandbox.setFocusMode(true);
  sandbox.setFocusMode(false);
  assert.ok(!sandbox.__focus, '退出后 body 不得残留 ws-focus-mode');
  assert.ok(panels.palette.classList.contains('is-collapsed'), '进入前收起的左栏应保持收起');
  assert.ok(!panels.task.classList.contains('is-collapsed'), '进入前展开的右栏应恢复展开');
  assert.equal(storage.get('libms.workspace.focus.mode'), '0');
});

test('专注模式幂等：重复进入不改写快照', () => {
  const { sandbox, panels } = harness({ palette: false, task: true });
  sandbox.setFocusMode(true);
  sandbox.setFocusMode(true); // 第二次必须是 no-op，否则快照被「双收」覆盖
  sandbox.setFocusMode(false);
  assert.ok(!panels.palette.classList.contains('is-collapsed'), '退出后左栏应恢复（快照未被覆盖）');
  assert.ok(panels.task.classList.contains('is-collapsed'), '退出后右栏应收起（快照未被覆盖）');
});

test('MANUAL 模式下折叠不触发 re-fit（不得强制重置用户缩放）', () => {
  const { calls } = harness({ mode: 'manual' });
  assert.equal(calls.fits, 0, '初始 sync 在 MANUAL 下也不得 re-fit');
});

test('FIT 模式下折叠触发 re-fit', () => {
  const { calls } = harness({ mode: 'fit' });
  assert.equal(calls.fits, 2, '初始 sync 两栏各 re-fit 一次');
});
test('接线：折叠 re-fit 看 zoomMode；专注走 CSS 双列归零', () => {
  assert.match(source, /if \(viewport\?\.zoomMode === 'fit'\) viewport\?\.fitToViewport\?\.\(\)/, '折叠后的 re-fit 必须受 FIT 模式保护');
  const css = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');
  assert.match(css, /ws-focus-mode \.workspace-grid\{--ws-pal-col:0px!important;--ws-task-col:0px!important\}/, '专注模式两列必须归零（画布真正全宽）');
  assert.match(css, /ws-focus-mode \.workspace-grid>\.ws-palette-summary,\s*\n?body\.phase2-workspace\.ws-focus-mode \.workspace-grid>\.ws-parameter-inspector\{display:none!important\}/, '专注模式两个面板本体必须隐藏');
});

test('接线：ResizeObserver 只在 FIT 模式重适配', () => {
  assert.match(source, /new ResizeObserver\(\(\) => \{\s*if \(viewport\.zoomMode !== "fit"\) return;/, '画布尺寸变化的重适配必须看模式');
  assert.match(source, /viewport\.zoomMode === "fit"\) viewport\(\.fitToViewport\(\)|viewport\.zoomMode === "fit"\) viewport\.fitToViewport\(\)/, '重适配前二次确认模式（避免 rAF 期间被切换）');
});

test('CSS：折叠态不得把折叠按钮一起藏掉（2026-10-15 修复的坑）', () => {
  const css = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');
  // 修复前：.ws-palette-summary.is-collapsed :is(.ws-palette-content,...){display:none!important}
  // h2（含 .ws-panel-collapse）在内容滚动化改造时被挪进 .ws-palette-content，
  // 于是整块隐藏把折叠按钮一起藏了 —— 左栏一旦收起就再也展不开。
  assert.match(css, /\.ws-palette-summary\.is-collapsed \.ws-palette-content\{display:contents\}/, '折叠态必须用 display:contents 保住标题行');
  assert.doesNotMatch(css, /\.ws-palette-summary\.is-collapsed :is\(\.ws-palette-content/, '不得再整块隐藏 .ws-palette-content');
  assert.match(css, /\.ws-palette-summary\.is-collapsed \.ws-palette-content>:not\(h2\)\{display:none!important\}/, '标题行以外的内容仍要隐藏');
  assert.match(css, /\.ws-palette-summary\.is-collapsed \.ws-palette-content>h2>:not\(\.ws-panel-collapse\)\{display:none!important\}/, '标题行内只留折叠按钮');
});

test('档位步进：低于动态下限时「−」落到下限而不是退回取整值', () => {
  // 复刻真机探针发现的坑：fit 出来的 3.52% 读数取整成 4%，按「−」时
  // stepFrom 找不到更低档位就退回 current(4%)，等于「越按越大」。
  assert.equal(stepFrom(4, -1, 3.52), 3.52, '非档位值按下限收口，不得退回取整读数');
  assert.equal(stepFrom(20, -1, 20), 20, '已贴下限：原地不动');
  assert.equal(stepFrom(20, -1, 2), 12, '正常走档位表（20% → 12%）');
  assert.equal(stepFrom(4, -1, 2), 3, '从 4% 往下走到 3%');
  assert.equal(stepFrom(3, 1, 3.52), 5, '向上仍走档位表');
  assert.equal(stepFrom(800, 1, 20), 800, '已贴上限 800%：原地不动');
});

test('接线：ZoomControls 拿动态下限；fit 走 clipped 提示', () => {
  assert.match(source, /floor: \(\) => viewport\.minZoom\(\) \* 100/, 'ZoomControls 的 floor 必须是 viewport.minZoom() 的 getter');
  assert.match(source, /const fitWithNotice = \(\) => \{\s*const outcome = viewport\.fitToViewport\(\);/, '适应窗口统一走 fitWithNotice');
  assert.match(source, /if \(outcome\?\.clipped\) notify\("当前比例已低于完整显示极限，为总览状态/, '低于工程地板必须提示「总览状态」');
  assert.match(source, /if \(key === "f" && !withModifier && !event\.altKey\) \{ setFocusMode\(!document\.body\.classList\.contains\("ws-focus-mode"\)\); return; \}/, 'F 快捷键开关专注模式');
  assert.match(source, /if \(document\.body\.classList\.contains\("ws-focus-mode"\)\) \{ setFocusMode\(false\); return; \}/, 'Esc 优先退出专注模式');
});
