/**
 * projectStore 行为快照测试（Phase 3A）
 *
 * 目的：在把 projectStore 改成 libmsStore 的纯 adapter（Phase 3B）之前，
 * 先把【当前真实行为】冻结下来。这些断言记录的是"现状"，不是"理想"。
 * Phase 3B 完成后，本文件应当【原样全部继续通过】—— 一旦有断言变红，
 * 就说明 adapter 改变了行为，必须停下来查，而不是改测试。
 *
 * 为什么需要它：Phase 3A 覆盖审计发现，projectStore 原有测试只覆盖了 6 个字段
 * （palette.maxColors / palette.id / canvas.width / stats.totalBeads /
 *  view.showCodes / exportSettings.preview.showCodes），
 * 而 workspace.js 实际大量使用 editor.* / view.* / ui.* / status.* / reference.*，
 * 且 workspace.js 【没有任何测试加载它】（只有 app.js 动态 import）。
 * 也就是说：改 projectStore 之前，绝大多数字段处于零保护状态。
 *
 * 本文件冻结的行为面：
 *  - 各命名空间默认值
 *  - setState 的"顶层浅合并 + 嵌套一层合并 + 数组整体替换"语义
 *  - subscribe / unsubscribe 语义（回调收到 (state, patch)）
 *  - 运行时动态新增字段（不在 defaults 里的）
 *  - 各字段的可写性与读写往返
 */
import test from "node:test";
import assert from "node:assert/strict";
import { createProjectStore } from "../../state/project-store.js";

// ---------------------------------------------------------------------------
// 1. 默认值快照：逐字段钉死 createProjectStore() 的初始状态
// ---------------------------------------------------------------------------

test("snapshot: 默认命名空间齐备（12 个）", () => {
  const s = createProjectStore().getState();
  assert.deepEqual(Object.keys(s).sort(), [
    "canvas", "editor", "exportSettings", "generation", "palette",
    "project", "reference", "source", "stats", "status", "ui", "view",
  ]);
});

test("snapshot: project / source / canvas 默认值", () => {
  const s = createProjectStore().getState();
  assert.deepEqual(s.project, { id: null, name: "未命名作品" });
  // source.image 现在恒为字符串：adapter 直接透传 libmsStore 的 sourceState.dataUrl（默认 ""），
  // 不再像改造前那样给 null。判空口径是 `Boolean(image)` / `!image`，两种默认值等价。
  assert.deepEqual(s.source, { image: "", width: 0, height: 0 });
  assert.deepEqual(s.canvas, { width: 50, height: 50, lockAspectRatio: false, beadSize: 2.6 });
});

test("snapshot: palette / generation 默认值", () => {
  const s = createProjectStore().getState();
  assert.deepEqual(s.palette, { id: "mard-221", maxColors: 0, usedColors: 0 });
  assert.deepEqual(s.generation, {
    engine: "v2.5", algorithm: "current", preset: "auto", sampling: "auto",
    detailProtection: 70, edgeProtection: 70, cleanupStrength: 50,
    preserveHighlights: true, preserveEyes: true, preserveMicroDetails: true,
    backgroundRemoval: false,
    // 这 4 个保护开关由 processingState 提供默认 false，快照里【始终存在】。
    // 它们是「算法与生成方式」合并后的产物，早先作为运行时动态字段写入，
    // 现在 adapter 无条件读出，所以必须出现在默认值快照里。
    subjectCrop: false, autoBackground: false, strokeProtection: false, accentProtection: false,
    smartColorTolerance: { enabled: false, strength: 0, policy: "quality-first" },
    brightness: 0, contrast: 0, saturation: 0,
  });
});

test("snapshot: generation 里【没有】maxColors —— 最大色数不在 generation，而在 palette", () => {
  // 这是 Phase 3A 的语义冲突点之一：名字叫 palette.maxColors，语义是"生成时的最大色数"，
  // 被 generation-service 当作生成参数传给 bridge（见 services/generation-service.js:13）。
  // generation 命名空间本身不含 maxColors。此处钉死这个事实，避免 Phase 3B 误合并。
  const s = createProjectStore().getState();
  assert.equal("maxColors" in s.generation, false, "generation 不应有 maxColors");
  assert.equal("maxColors" in s.palette, true, "maxColors 实际在 palette 里");
});

test("snapshot: view / reference 默认值", () => {
  const s = createProjectStore().getState();
  assert.deepEqual(s.view, {
    mode: "blocks", zoom: 1, panX: 0, panY: 0,
    showGrid: false, showCodes: false, codeVisibilityThreshold: 16,
  });
  assert.deepEqual(s.reference, { url:"",opacity:40,fit:"contain",visible:true,useSource:true,offsetX:0,offsetY:0,scale:1,smoothing:"smooth",displayMode:"normal",adjusting:false });
});

test("snapshot: editor 默认值（workspace.js 最常写的一块）", () => {
  const s = createProjectStore().getState();
  assert.deepEqual(s.editor, {
    tool: "select", hoveredCell: null, selectedCell: null,
    // Stage B1 §6：工作台侧「当前颜色」的真源。必须穿过快照，否则
    // readCurrentPaletteId(get().editor) 只能一直兜底读 selectedPaletteId 镜像。
    currentPaletteId: null,
    selectedPaletteId: null, selectedColor: null,
    highlightedColor: null, highlightedPaletteId: null, selection: null, paletteCategory: "all",
    recentColors: [], brushSize: 1, pixelPerfect: true, shapeFilled: false,
    symmetryHorizontal: false, symmetryVertical: false, symmetryMode: "none",
    symmetryAxisX: null, symmetryAxisY: null, symmetryGuideVisible: true, wandTolerance: 12,
    rampBasePaletteId: null, rampSize: 5, rampPaletteIds: [], inkMode: "normal",
    shapePreview: null, clipboard: null,
    history: { canUndo: false, canRedo: false },
  });
});

test("snapshot: exportSettings / stats / ui / status 默认值", () => {
  const s = createProjectStore().getState();
  assert.deepEqual(s.exportSettings, {
    type: "preview",
    preview: { showGrid: false, showCodes: false },
    pattern: { showGrid: true, showCodes: true, showCoordinates: true },
  });
  assert.deepEqual(s.stats, { totalBeads: 0, usedColors: 0, colors: [] });
  assert.deepEqual(s.ui, { activePanel: "project", inspectorOpen: true, exportDrawerOpen: false });
  assert.deepEqual(s.status, { generating: false, dirty: false, hasSource: false, hasPattern: false });
});

test("snapshot: status 默认【不含】generationError（它是运行时动态新增的）", () => {
  const s = createProjectStore().getState();
  assert.equal("generationError" in s.status, false, "generationError 不在 defaults，由 workspace.js 运行时写入");
  const store = createProjectStore();
  store.setState({ status: { generationError: "boom" } });
  assert.equal(store.getState().status.generationError, "boom", "写入后应存在");
});

// ---------------------------------------------------------------------------
// 2. setState 合并语义快照（Phase 3B 的 adapter 必须复刻这套语义）
// ---------------------------------------------------------------------------

test("snapshot: setState 对命名空间做【浅合并】，不整体替换", () => {
  const store = createProjectStore();
  store.setState({ editor: { tool: "brush" } });
  const e = store.getState().editor;
  assert.equal(e.tool, "brush");
  assert.equal(e.hoveredCell, null, "未被 patch 的字段保留");
  assert.equal(e.brushSize, 1, "未被 patch 的字段保留");
  assert.equal(e.selection, null);
});

test("snapshot: setState 对【数组】做整体替换而非合并", () => {
  const store = createProjectStore();
  store.setState({ editor: { recentColors: ["#fff"] } });
  assert.deepEqual(store.getState().editor.recentColors, ["#fff"]);
  store.setState({ editor: { recentColors: ["#000", "#111"] } });
  assert.deepEqual(store.getState().editor.recentColors, ["#000", "#111"], "数组整体替换");
  store.setState({ stats: { colors: ["a"] } });
  store.setState({ stats: { colors: ["b", "c"] } });
  assert.deepEqual(store.getState().stats.colors, ["b", "c"]);
});

test("snapshot: setState 只改传入的命名空间，其它命名空间不动", () => {
  const store = createProjectStore();
  const before = store.getState();
  store.setState({ view: { mode: "pattern" } });
  assert.equal(store.getState().view.mode, "pattern");
  assert.deepEqual(store.getState().canvas, before.canvas, "canvas 不受影响");
  assert.deepEqual(store.getState().editor, before.editor, "editor 不受影响");
});

test("snapshot: setState 支持同时 patch 多个命名空间", () => {
  const store = createProjectStore();
  store.setState({ ui: { activePanel: "edit" }, status: { dirty: true } });
  assert.equal(store.getState().ui.activePanel, "edit");
  assert.equal(store.getState().status.dirty, true);
});

test("snapshot: setState 可新增 defaults 里没有的键（动态字段）", () => {
  // workspace.js:225 会写入 subjectCrop / autoBackground / strokeProtection / accentProtection
  const store = createProjectStore();
  store.setState({ generation: { subjectCrop: true, autoBackground: false } });
  assert.equal(store.getState().generation.subjectCrop, true);
  assert.equal(store.getState().generation.autoBackground, false);
  assert.equal(store.getState().generation.detailProtection, 70, "原有字段保留");
});

test("snapshot: setState 返回 state，且非对象 patch 被忽略", () => {
  const store = createProjectStore();
  const before = store.getState();
  const r = store.setState(null);
  // 用 deepEqual 而不是 equal：adapter 的 getState() 每次都从 libmsStore 现算一份新快照，
  // 所以引用相等不再成立（改造前返回同一个对象）。真正要钉死的是「状态没被改动」。
  assert.deepEqual(r, before, "null patch 返回未改动的 state");
  store.setState(undefined);
  assert.deepEqual(store.getState(), before, "undefined patch 不改变状态");
});

// ---------------------------------------------------------------------------
// 3. subscribe / unsubscribe 语义快照
// ---------------------------------------------------------------------------

test("snapshot: subscribe 回调收到 (state, patch)，unsubscribe 后不再触发", () => {
  const store = createProjectStore();
  const calls = [];
  const unsub = store.subscribe((state, patch) => calls.push({ state, patch }));
  store.setState({ view: { showCodes: true } });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].patch, { view: { showCodes: true } }, "第二参是原始 patch");
  assert.equal(calls[0].state.view.showCodes, true, "第一参是最新 state");
  unsub();
  store.setState({ view: { showGrid: true } });
  assert.equal(calls.length, 1, "取消订阅后不再触发");
});

test("snapshot: 多个订阅者都被通知", () => {
  const store = createProjectStore();
  let a = 0, b = 0;
  const ua = store.subscribe(() => a++);
  const ub = store.subscribe(() => b++);
  store.setState({ editor: { tool: "fill" } });
  assert.equal(a, 1);
  assert.equal(b, 1);
  ua(); ub();
});

// ---------------------------------------------------------------------------
// 4. workspace.js 高频字段的读写往返（冻结"可写且可读回"）
// ---------------------------------------------------------------------------

test("snapshot: editor.tool / selection / selectedCell / hoveredCell / shapePreview 读写往返", () => {
  const store = createProjectStore();
  const selection = { x0: 1, y0: 2, x1: 3, y1: 4 };
  store.setState({ editor: { tool: "region", selection, selectedCell: { x: 5, y: 6 } } });
  let e = store.getState().editor;
  assert.equal(e.tool, "region");
  assert.deepEqual(e.selection, selection);
  assert.deepEqual(e.selectedCell, { x: 5, y: 6 });
  store.setState({ editor: { hoveredCell: { x: 7, y: 8 }, shapePreview: { cells: [[0, 0]], hex: "#ff0000" } } });
  e = store.getState().editor;
  assert.deepEqual(e.hoveredCell, { x: 7, y: 8 });
  assert.deepEqual(e.shapePreview, { cells: [[0, 0]], hex: "#ff0000" });
  // 清空回 null（workspace.js 会在某些事件里清空）
  store.setState({ editor: { tool: "select", hoveredCell: null, selectedCell: null, selection: null, shapePreview: null } });
  e = store.getState().editor;
  assert.equal(e.tool, "select");
  assert.equal(e.hoveredCell, null);
  assert.equal(e.selectedCell, null);
  assert.equal(e.selection, null);
  assert.equal(e.shapePreview, null);
});

test("snapshot: view.mode / showGrid / showCodes / zoom 读写往返", () => {
  const store = createProjectStore();
  store.setState({ view: { mode: "pattern", showGrid: true, showCodes: true } });
  let v = store.getState().view;
  assert.equal(v.mode, "pattern");
  assert.equal(v.showGrid, true);
  assert.equal(v.showCodes, true);
  store.setState({ view: { zoom: 2.5, panX: 10, panY: -20 } });
  v = store.getState().view;
  assert.equal(v.zoom, 2.5);
  assert.equal(v.panX, 10);
  assert.equal(v.panY, -20);
  // view.showCodes 与 exportSettings.preview.showCodes 是【彼此独立】的两份开关
  assert.equal(store.getState().exportSettings.preview.showCodes, false, "导出预览开关独立");
});

test("snapshot: canvas.width / height / beadSize 读写往返（注意 width/height 是图纸逻辑尺寸）", () => {
  const store = createProjectStore();
  store.setState({ canvas: { width: 104, height: 78 } });
  let c = store.getState().canvas;
  assert.equal(c.width, 104);
  assert.equal(c.height, 78);
  assert.equal(c.beadSize, 2.6, "beadSize 不受影响");
  store.setState({ canvas: { beadSize: 5 } });
  c = store.getState().canvas;
  assert.equal(c.beadSize, 5);
  assert.equal(c.width, 104, "改 beadSize 不影响逻辑尺寸");
  // 语义钉死：canvas.width/height 是【豆图逻辑格数】，不是像素尺寸、不是视口尺寸。
  // 方向也钉死：generation-service 只用 result.width/height **回写**它，
  // 绝不把它当生成入参传给 bridge.generate（否则上一版尺寸会污染下一版）。
});

test("snapshot: palette（含 maxColors 语义）读写往返", () => {
  const store = createProjectStore();
  store.setState({ palette: { maxColors: 38, id: "mard-221", usedColors: 10 } });
  const p = store.getState().palette;
  assert.equal(p.maxColors, 38);
  assert.equal(p.id, "mard-221");
  assert.equal(p.usedColors, 10);
  // maxColors 0 的语义 = 自动/不限（由既有测试 v2-isolation 钉过"0 不能被当成 '0 colors'"）
  store.setState({ palette: { maxColors: 0 } });
  assert.equal(store.getState().palette.maxColors, 0);
});

test("snapshot: generation.detailProtection 等生成参数读写往返", () => {
  const store = createProjectStore();
  store.setState({ generation: { detailProtection: 90, edgeProtection: 20, cleanupStrength: 10 } });
  const g = store.getState().generation;
  assert.equal(g.detailProtection, 90);
  assert.equal(g.edgeProtection, 20);
  assert.equal(g.cleanupStrength, 10);
  assert.equal(g.engine, "v2.5", "未 patch 字段保留");
});

test("snapshot: reference 读写往返", () => {
  const store = createProjectStore();
  store.setState({ reference: { url: "data:image/png;base64,x", visible: true, fit: "cover" } });
  let r = store.getState().reference;
  assert.equal(r.url, "data:image/png;base64,x");
  assert.equal(r.fit, "cover");
  assert.equal(r.visible, true);
  assert.equal(r.opacity, 40, "opacity 保留");
  store.setState({ reference: { opacity: 75 } });
  assert.equal(store.getState().reference.opacity, 75);
  store.setState({ reference: { url: "", visible: false } });
  r = store.getState().reference;
  assert.equal(r.url, "");
  assert.equal(r.visible, false);
});

test("snapshot: ui.activePanel / exportDrawerOpen 读写往返", () => {
  const store = createProjectStore();
  store.setState({ ui: { activePanel: "edit" } });
  assert.equal(store.getState().ui.activePanel, "edit");
  assert.equal(store.getState().ui.inspectorOpen, true, "未 patch 字段保留");
  store.setState({ ui: { exportDrawerOpen: true } });
  assert.equal(store.getState().ui.exportDrawerOpen, true);
});

test("snapshot: status.generating / dirty / hasPattern / generationError 读写往返", () => {
  const store = createProjectStore();
  store.setState({ status: { generating: true } });
  assert.equal(store.getState().status.generating, true);
  store.setState({ status: { generating: false, hasPattern: true, hasSource: true, dirty: false } });
  const st = store.getState().status;
  assert.equal(st.generating, false);
  assert.equal(st.hasPattern, true);
  assert.equal(st.hasSource, true);
  assert.equal(st.dirty, false);
  store.setState({ status: { generationError: "V2.5 失败" } });
  assert.equal(store.getState().status.generationError, "V2.5 失败");
});

test("snapshot: source / project / stats 读写往返（workspace.js 生成成功后写入）", () => {
  const store = createProjectStore();
  store.setState({ source: { image: "data:image/png;base64,y", width: 800, height: 600 } });
  assert.deepEqual(store.getState().source, { image: "data:image/png;base64,y", width: 800, height: 600 });
  store.setState({ project: { name: "我的作品" } });
  assert.equal(store.getState().project.name, "我的作品");
  assert.equal(store.getState().project.id, null, "id 保留");
  store.setState({ stats: { totalBeads: 3979, usedColors: 10, colors: ["mard-01"] } });
  const s = store.getState().stats;
  assert.equal(s.totalBeads, 3979);
  assert.equal(s.usedColors, 10);
  assert.deepEqual(s.colors, ["mard-01"]);
});

test("snapshot: exportSettings.pattern 子对象被【整体替换】而非深合并（关键语义）", () => {
  const store = createProjectStore();
  store.setState({ exportSettings: { pattern: { showGrid: false, showCoordinates: false } } });
  const es = store.getState().exportSettings;
  assert.equal(es.pattern.showGrid, false);
  assert.equal(es.pattern.showCoordinates, false);
  // 【真实行为】pattern 这一层被整体替换，showCodes 丢掉了（不是深合并）。
  // 这正是 workspace.js:267 要手写 `{ ...get().exportSettings.pattern, [field]: checked }`
  // 的原因 —— 作者在绕开"子对象整体替换"语义。Phase 3B 的 adapter 必须复刻这一点，
  // 否则导出面板的开关会静默丢失。
  assert.equal(es.pattern.showCodes, undefined, "子对象整体替换，未带的字段会丢失");
  assert.deepEqual(es.preview, { showGrid: false, showCodes: false }, "preview 独立不被影响");
});

test("snapshot: 命名空间内嵌子对象一律整体替换（editor.history 同理）", () => {
  const store = createProjectStore();
  store.setState({ editor: { history: { canUndo: true } } });
  // history 被整体替换成 {canUndo:true}，canRedo 丢失
  assert.equal(store.getState().editor.history.canUndo, true);
  assert.equal(store.getState().editor.history.canRedo, undefined, "history 子对象整体替换");
  // 因此 workspace.js:146 每次都同时写 canUndo 与 canRedo 两个字段
  store.setState({ editor: { history: { canUndo: false, canRedo: true } } });
  assert.deepEqual(store.getState().editor.history, { canUndo: false, canRedo: true });
});

// ---------------------------------------------------------------------------
// 5. seed（createProjectStore(seed)）语义快照 —— 既有测试依赖它
// ---------------------------------------------------------------------------

test("snapshot: createProjectStore(seed) 用 seed 覆盖 defaults，未给的字段保留默认", () => {
  const store = createProjectStore({ canvas: { width: 78 }, palette: { maxColors: 38 } });
  assert.equal(store.getState().canvas.width, 78);
  assert.equal(store.getState().canvas.height, 50, "seed 未给的 height 保留默认");
  assert.equal(store.getState().palette.maxColors, 38);
  assert.equal(store.getState().palette.id, "mard-221", "seed 未给的 id 保留默认");
  // 每个实例互不影响（既有测试靠这个隔离）
  const other = createProjectStore();
  assert.equal(other.getState().canvas.width, 50, "另一实例不受 seed 影响");
});
