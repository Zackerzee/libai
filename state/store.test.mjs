/*
 * state/store.test.mjs — Phase 2 状态层单测
 *
 * 覆盖任务书第九条的全部要求：
 *  1) 初始值一致            2) 旧 state 读取正常
 *  3) 旧 state 写入反映到新 store
 *  4) 新 store 写入能被旧调用方读取
 *  5) namespace patch 正常
 *  6) subscribe 只触发相关 namespace
 *  7) batch 不重复刷新
 *  8) reset 正常
 *  9) 工程文件 import/export 不变（状态层契约）
 * 10) undo/redo 不受影响（状态层字段一致）
 * 11) 605 个旧测试继续通过 —— 由全量 `node --test` 单独验证（见 VERIFY.md Phase 2）
 *
 * 关键不变量：单一数据源。旧 Proxy 与新 store 指向同一份数据，绝无第二副本。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import storeApi from "../state/store.js";

const { createStore, createCompatState, DEFAULTS, LEGACY_MAP, LEGACY_KEYS } = storeApi;

// 旧 app.js `state.xxx` 的顶层字段总数 = 初始字面量 87 个 + 运行时动态赋值 6 个
// （generationMilliseconds / generationQuality / productionGenerationOptions /
//  smartFeatures / smartReport / lastGenerationError，均在生成流程里赋值，不在初始字面量）。
// 87 = 86 + sourceDimensions（B0.1 新增：尺寸权威链的载体）。
// 94 = 93 + currentPaletteId（B1 新增：当前颜色的唯一真源）。
// 若此数变化，说明 app.js 的 state 被改过，必须同步更新本测试与 STATE-MIGRATION.md。
const LEGACY_FIELD_COUNT = 94;

function fresh() {
  const store = createStore();
  const state = createCompatState(store);
  return { store, state };
}

test("初始值一致：兼容层 Proxy 暴露的 86 个旧字段默认值与 DEFAULTS 逐位相等", () => {
  const { state, store } = fresh();
  assert.equal(LEGACY_KEYS.length, LEGACY_FIELD_COUNT,
    `旧字段应覆盖 ${LEGACY_FIELD_COUNT} 个，实际 ${LEGACY_KEYS.length}`);
  for (const key of LEGACY_KEYS) {
    const [ns, field] = LEGACY_MAP[key];
    const viaProxy = state[key];
    const viaStore = store.get(ns, field);
    // 深比较（Set 用 Array.from）
    const norm = (v) => (v instanceof Set ? Array.from(v).sort() : v);
    assert.deepEqual(norm(viaProxy), norm(viaStore),
      `字段 ${key} 的 Proxy 值与 store 值不一致`);
  }
});

test("旧 state 读取正常：典型字段经 Proxy 可读且类型正确", () => {
  const { state } = fresh();
  assert.equal(state.generationEngine, "v2.5");
  assert.equal(state.algorithmEngine, "current");
  assert.equal(state.selectedBrand, "mard");
  assert.equal(state.editorTool, "pencil");
  assert.equal(state.previewZoom, 1);
  assert.equal(state.generationLongEdge, 0);
  assert.deepEqual(state.sourceDimensions, { width: 0, height: 0, authority: "unresolved", source: "" });
  assert.deepEqual(state.editorPrefs, { showGrid: true, showCodes: true, showCoords: true, snap: true, toolbarPosition: "left" });
  assert.ok(state.playCompletedBeads instanceof Set);
  assert.equal(state.playCompletedBeads.size, 0);
});

test("旧 state 写入能反映到新 store（单一数据源）", () => {
  const { state, store } = fresh();
  state.width = 64;
  state.height = 48;
  state.selectedColor = "#ff0000";
  state.editorTool = "bucket";
  assert.equal(store.get("patternState", "width"), 64);
  assert.equal(store.get("patternState", "height"), 48);
  assert.equal(store.get("paletteState", "selectedColor"), "#ff0000");
  assert.equal(store.get("editorState", "tool"), "bucket");
  // 反向：Proxy 读回与 store 一致
  assert.equal(state.width, 64);
  assert.equal(state.editorTool, "bucket");
});

test("新 store 写入能被旧调用方读取（双向可见）", () => {
  const { state, store } = fresh();
  store.patchState("patternState", { width: 100, height: 75 });
  store.patchState("processingState", { generationLongEdge: 120 });
  store.patchState("editorState", { tool: "eraser" });
  assert.equal(state.width, 100);
  assert.equal(state.height, 75);
  assert.equal(state.generationLongEdge, 120);
  assert.equal(state.editorTool, "eraser");
});

test("namespace patch 正常：浅合并顶层字段，不丢其它字段", () => {
  const { store } = fresh();
  store.patchState("patternState", { width: 32 });
  assert.equal(store.get("patternState", "width"), 32);
  assert.equal(store.get("patternState", "height"), 0, "其它字段保持默认");
  store.patchState("patternState", { height: 24, grid: [[1, 2], [3, 4]] });
  assert.equal(store.get("patternState", "width"), 32, "再次 patch 不覆盖未改字段");
  assert.equal(store.get("patternState", "height"), 24);
  assert.deepEqual(store.get("patternState", "grid"), [[1, 2], [3, 4]]);
});

test("setState 点路径：按 namespace.field 写入并通知", () => {
  const { store } = fresh();
  store.setState("viewportState.previewZoom", 2.5);
  assert.equal(store.get("viewportState", "previewZoom"), 2.5);
  assert.throws(() => store.setState("previewZoom", 2), /点路径/);
  assert.throws(() => store.setState("noSuchNs.x", 1), /未知命名空间/);
});

test("subscribe 只触发相关 namespace：改 A 不触发 B", () => {
  const { store, state } = fresh();
  let patternHits = 0, editorHits = 0, viewportHits = 0;
  store.subscribe("patternState", () => patternHits++);
  store.subscribe("editorState", () => editorHits++);
  store.subscribe("viewportState", () => viewportHits++);

  // 经旧 Proxy 写 patternState 字段
  state.width = 10;
  assert.equal(patternHits, 1, "patternState 订阅应触发 1 次");
  assert.equal(editorHits, 0, "editorState 订阅不应触发");
  assert.equal(viewportHits, 0, "viewportState 订阅不应触发");

  // 经 store 写 editorState
  store.patchState("editorState", { tool: "select" });
  assert.equal(editorHits, 1);
  assert.equal(patternHits, 1, "patternState 订阅未再触发");

  // 经 store 写 viewportState
  store.patchState("viewportState", { editorZoom: 3 });
  assert.equal(viewportHits, 1);
  assert.equal(patternHits, 1);
  assert.equal(editorHits, 1);
});

test("subscribe 返回函数可取消订阅；unsubscribe 双签名可用", () => {
  const { store } = fresh();
  let hits = 0;
  const cb = () => hits++;
  const unsub = store.subscribe("patternState", cb);
  store.patchState("patternState", { width: 1 });
  assert.equal(hits, 1);
  unsub();
  store.patchState("patternState", { width: 2 });
  assert.equal(hits, 1, "取消订阅后不再触发");

  // 双签名 unsubscribe(ns, cb)
  let hits2 = 0;
  const cb2 = () => hits2++;
  store.subscribe("editorState", cb2);
  store.patchState("editorState", { tool: "x" });
  assert.equal(hits2, 1);
  store.unsubscribe("editorState", cb2);
  store.patchState("editorState", { tool: "y" });
  assert.equal(hits2, 1, "unsubscribe(ns,cb) 生效");
});

test("batch 不重复刷新：批内多次写同一 namespace 只通知一次", () => {
  const { store, state } = fresh();
  let patternHits = 0;
  store.subscribe("patternState", () => patternHits++);

  store.batch(() => {
    state.width = 1;
    state.height = 2;
    store.patchState("patternState", { grid: [[0]] });
    state.width = 99; // 同 namespace 反复写
  });
  assert.equal(patternHits, 1, "batch 结束后该 namespace 仅通知 1 次");
  assert.equal(store.get("patternState", "width"), 99, "batch 内最后一次写生效");
  assert.equal(store.get("patternState", "height"), 2);

  // batch 外单写仍各自通知
  state.width = 100;
  assert.equal(patternHits, 2);
});

test("batch 嵌套：内层结束不提前通知，直到最外层结束", () => {
  const { store, state } = fresh();
  let hits = 0;
  store.subscribe("patternState", () => hits++);
  store.batch(() => {
    state.width = 1;
    store.batch(() => {
      state.height = 2;
    });
    assert.equal(hits, 0, "内层 batch 结束不应通知");
  });
  assert.equal(hits, 1, "最外层结束统一通知 1 次");
});

test("resetNamespace 正常：重置回默认且不波及其它 namespace", () => {
  const { store, state } = fresh();
  state.width = 200;
  state.editorTool = "bucket";
  store.resetNamespace("patternState");
  assert.equal(store.get("patternState", "width"), 0, "重置回默认");
  assert.equal(state.width, 0);
  assert.equal(store.get("editorState", "tool"), "bucket", "editorState 不受影响");
  // Set 字段重置后应为新的空 Set
  state.playCompletedBeads.add("A");
  store.resetNamespace("editorState");
  assert.equal(state.playCompletedBeads.size, 0);
  assert.ok(state.playCompletedBeads instanceof Set);
});

test("工程文件导入/导出契约（状态层）：经 Proxy 写入的 pattern 与 store 同源，导出读取一致", () => {
  // 模拟"导入工程文件"：把 width/height/grid 经旧 Proxy 写入
  const { store, state } = fresh();
  const importedGrid = [
    ["mard-01", "mard-02"],
    ["mard-03", "mard-04"],
  ];
  state.width = 2;
  state.height = 2;
  state.grid = importedGrid;

  // 模拟"导出/序列化"：导出函数读 state.width/height/grid —— 必须看到同一份数据
  assert.equal(state.width, 2);
  assert.equal(state.height, 2);
  assert.deepEqual(state.grid, importedGrid);
  // 且这就是 store 里的同一引用（单一数据源，导出不会拿到第二份拷贝）
  assert.equal(store.get("patternState", "grid"), importedGrid);

  // 强校验依赖的 width/height 由 store 单一持有，值不被兼容层改写或克隆漂移。
  // 校验逻辑本身在 app.js（由旧测试覆盖），本测试只保证状态层契约不变。
  assert.equal(store.get("patternState", "width"), state.width);
  assert.equal(store.get("patternState", "height"), state.height);
});

test("undo/redo 不受影响（状态层）：编辑历史数组字段经 Proxy 与 store 同源", () => {
  const { store, state } = fresh();
  // 默认应为空数组 / Set，undo/redo 在这些结构上操作
  assert.deepEqual(state.paintUndo, []);
  assert.deepEqual(state.referenceUndo, []);
  assert.deepEqual(state.replaceUndo, []);
  assert.deepEqual(state.currentPaintAction, []);
  assert.ok(state.playCompletedBeads instanceof Set);

  // 模拟一次撤销栈 push（经旧 Proxy）
  state.paintUndo.push({ type: "cell", before: null, after: "mard-01" });
  // store 看到同一数组（无克隆副本）
  assert.equal(store.get("editorState", "paintUndo").length, 1);
  assert.equal(state.paintUndo.length, 1);
  // 模拟撤销弹出
  state.paintUndo.pop();
  assert.equal(store.get("editorState", "paintUndo").length, 0);
});

test("枚举/序列化一致性：JSON.stringify(state) 与 Object.keys 行为同原扁平对象", () => {
  const { state } = fresh();
  const keys = Object.keys(state);
  assert.equal(keys.length, LEGACY_FIELD_COUNT, `ownKeys 应恰为 ${LEGACY_FIELD_COUNT} 个旧字段`);
  for (const k of LEGACY_KEYS) assert.ok(keys.includes(k), `ownKeys 缺少 ${k}`);
  // JSON 序列化不应抛错，且能往返
  const json = JSON.stringify(state);
  const parsed = JSON.parse(json);
  assert.equal(parsed.generationEngine, "v2.5");
  assert.equal(parsed.editorTool, "pencil");
  // Set 字段在 JSON 中序列化为 {}（与原生行为完全一致：旧 state 的 playCompletedBeads
  // 本就是 Set，JSON.stringify 同样输出 {}；导出走 localStorage 时用 [...set] 显式展开，
  // 不依赖此序列化形态。故兼容层无行为变化。）
  assert.deepEqual(parsed.playCompletedBeads, {});
});

test("单一数据源不变量：不存在第二份数据被反向同步", () => {
  const { store, state } = fresh();
  // 写入经 Proxy，store 直接持有该值（同一引用，对对象类型而言）
  const obj = { a: 1 };
  state.sourceTransform = obj;
  assert.equal(store.get("processingState", "sourceTransform"), obj, "对象字段应为同一引用");
  // 就地修改 store 中的对象，Proxy 立即可见（无延迟同步函数）
  store.get("processingState", "sourceTransform").b = 2;
  assert.equal(state.sourceTransform.b, 2, "就地改 store 对象，Proxy 立即可见（无同步函数）");
});

test("statusState：旧 state 的会话/状态标志正确归桶（Phase 3B 由 metaState 拆分而来）", () => {
  const { store, state } = fresh();
  assert.equal(state.livePreviewTimer, 0);
  assert.equal(state.isProcessingImage, false);
  assert.equal(state.isPainting, false);
  state.livePreviewTimer = 123;
  state.isPainting = true;
  assert.equal(store.get("statusState", "livePreviewTimer"), 123);
  assert.equal(store.get("statusState", "isPainting"), true);
  // statusState 同时承接 projectStore.status 的字段
  assert.equal(store.get("statusState", "generating"), false);
  assert.equal(store.get("statusState", "dirty"), false);
  assert.equal(store.get("statusState", "hasSource"), false);
  assert.equal(store.get("statusState", "hasPattern"), false);
  // generationError 与原 projectStore 契约一致：默认不创建该键，首次失败时动态写入。
  assert.equal(store.get("statusState", "generationError"), undefined);
});

test("uiState / referenceState / documentState / statsState：Phase 3B 新增命名空间默认合理", () => {
  const { store } = fresh();
  assert.deepEqual(store.get("uiState"), { activePanel: "project", inspectorOpen: true, exportDrawerOpen: false });
  assert.deepEqual(store.get("referenceState"), {
    url: "",
    opacity: 40,
    fit: "contain",
    visible: true,
    useSource: true,
    offsetX: 0,
    offsetY: 0,
    scale: 1,
    smoothing: "smooth",
    displayMode: "normal",
    adjusting: false,
  });
  assert.deepEqual(store.get("documentState"), { id: null, name: "未命名作品" });
  assert.deepEqual(store.get("statsState"), { totalBeads: 0, usedColors: 0, colors: [] });
  // metaState 应已不存在
  assert.throws(() => store.get("metaState"), /未知命名空间/);
});

test("Phase 3B：projectStore 字段已能在 libmsStore 中找到归属（无遗漏）", () => {
  const { store } = fresh();
  // 逐项点名 PROJECT-STORE-AUDIT.md §4 里要求承接的字段，缺一个就说明扩容漏了
  const expected = {
    // 目标画布设置与生成结果 patternState 的生命周期不同，统一由 canvasState 承接。
    canvasState: ["beadSize", "lockAspectRatio"],
    processingState: ["maxColors", "detailProtection", "edgeProtection", "cleanupStrength",
      "preserveHighlights", "preserveEyes", "preserveMicroDetails", "backgroundRemoval",
      "subjectCrop", "autoBackground", "strokeProtection", "accentProtection", "colorTuning"],
    paletteState: ["id"],
    rendererState: ["mode", "showGrid", "showCodes", "codeVisibilityThreshold"],
    viewportState: ["zoom"],
    editorState: ["selectedCell", "selectedPaletteId", "hoveredCell", "shapePreview", "highlightedColor", "highlightedPaletteId",
      "brushSize", "wandTolerance", "shapeFilled", "symmetryHorizontal", "symmetryVertical", "symmetryMode", "symmetryAxisX", "symmetryAxisY", "symmetryGuideVisible", "paletteCategory", "recentColors",
      "rampBasePaletteId", "rampSize", "rampPaletteIds", "inkMode",
      "clipboard", "history"],
  };
  for (const [ns, fields] of Object.entries(expected)) {
    for (const f of fields) {
      assert.ok(f in store.get(ns), `${ns}.${f} 缺失（Phase 3B schema 扩容遗漏）`);
    }
  }
});
