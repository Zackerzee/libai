/**
 * state/project-store.js —— Phase 3B：改为【纯 adapter】
 *
 * 本文件【不再保存任何 backing state】。
 * projectStore 只是 libmsStore 的一层投影：getState/setState/subscribe 全部代理到
 * state/store.js 的 store 实例。真实状态源只有 1 个。
 *
 * 为什么这么改：
 *  Phase 2 时这里是一份【独立、与 app.js state 不互通】的 12 命名空间副本，
 *  被 ui/workspace.js 使用，构成既有双源。Phase 3B 把它收口：
 *    workspace.js → projectStore(adapter) → libmsStore
 *    app.js       → state(Proxy 兼容层)   → libmsStore
 *  两条路读写同一份数据，运行时真实状态源数量 = 1。
 *
 * 必须复刻的原语义（行为快照已冻结，见 tests/ui-refactor-baseline/project-store-snapshot.test.mjs）：
 *  1. setState 在【命名空间层】浅合并：未 patch 的字段保留。
 *  2. 命名空间内的【子对象整体替换】，不是深合并。
 *     例：setState({exportSettings:{pattern:{showGrid:false}}}) 会让 pattern.showCodes 变 undefined。
 *     workspace.js:267 正是靠手写 {...get().exportSettings.pattern} 绕开这点。
 *  3. 数组整体替换（recentColors / colors）。
 *  4. subscribe 回调收到 (state, patch)，unsubscribe 后不再触发。
 *
 * 字段映射依据：PROJECT-STORE-AUDIT.md §4（归属设计）与 §5（语义冲突）。
 * 凡"同名不同义"的字段一律【不合流】，用独立字段承接（canvasState / wsTool / wsSelection）。
 */
import "./store.js?v=20261007-layout-consolidation"; // 副作用导入：确保 globalThis.libmsStoreApi 就绪。
// 浏览器里 store.js 已由 <script defer> 以 classic 方式加载过；
// store.js 内部有幂等守卫，此处再次执行不会创建第二个 store 实例。

const getApi = () => globalThis.libmsStoreApi;
const getGlobalStore = () => globalThis.libmsStore;

// ---------------------------------------------------------------------------
// 读：把 libmsStore 的命名空间还原成 projectStore 的 12 命名空间形状
// ---------------------------------------------------------------------------
function snapshot(store) {
  const s = store.getState();

  // status.generationError 是"运行时动态字段"：默认不存在该键，写入后才出现。
  // 必须与快照测试一致，故用条件展开，不能用 null 兜底。
  const status = {
    generating: s.statusState.generating,
    dirty: s.statusState.dirty,
    hasSource: s.statusState.hasSource,
    hasPattern: s.statusState.hasPattern,
  };
  if (s.statusState.generationError !== undefined) {
    status.generationError = s.statusState.generationError;
  }
  // notice / generationPhase（Stage B3）：同样是运行时动态字段，默认不出现。
  // 默认就写 `notice: ""` 会让默认快照多出两个 own key，deepStrictEqual 立刻变红。
  // 而它们**必须**能穿过 snapshot —— 否则 workspace 写的提示文案读不回来，
  // 又退化成「直接写 DOM、被下一次 paint 覆盖」的老问题。
  if (s.statusState.notice) status.notice = s.statusState.notice;
  if (s.statusState.generationPhase) status.generationPhase = s.statusState.generationPhase;

  // 文字图层是"运行时动态字段"：默认不存在该键，写入后才出现。
  // 与 status.generationError 同样的条件展开 —— 直接写 textLayers: undefined 会让
  // editor 默认值快照多出一个 own key，deepStrictEqual 立刻变红。
  const editor = {
    tool: s.editorState.wsTool,
    hoveredCell: s.editorState.hoveredCell,
    selectedCell: s.editorState.selectedCell,
    // Stage B1 §6：工作台侧「当前颜色」的真源必须穿过快照。
    // 少了这一行，readCurrentPaletteId(get().editor) 永远读不到真源，
    // 只能一直兜底读 selectedPaletteId 镜像 —— 真源就成了摆设（实测踩过）。
    currentPaletteId: s.editorState.currentPaletteId,
    selectedPaletteId: s.editorState.selectedPaletteId,
    selectedColor: s.paletteState.selectedColor,
    highlightedColor: s.editorState.highlightedColor,
    highlightedPaletteId: s.editorState.highlightedPaletteId,
    selection: s.editorState.wsSelection,
    paletteCategory: s.editorState.paletteCategory,
    recentColors: s.editorState.recentColors,
    brushSize: s.editorState.brushSize,
    pixelPerfect: s.editorState.pixelPerfect,
    shapeFilled: s.editorState.shapeFilled,
    symmetryHorizontal: s.editorState.symmetryHorizontal,
    symmetryVertical: s.editorState.symmetryVertical,
    symmetryMode: s.editorState.symmetryMode,
    symmetryAxisX: s.editorState.symmetryAxisX,
    symmetryAxisY: s.editorState.symmetryAxisY,
    symmetryGuideVisible: s.editorState.symmetryGuideVisible,
    rampBasePaletteId: s.editorState.rampBasePaletteId,
    rampSize: s.editorState.rampSize,
    rampPaletteIds: s.editorState.rampPaletteIds,
    inkMode: s.editorState.inkMode,
    wandTolerance: s.editorState.wandTolerance,
    shapePreview: s.editorState.shapePreview,
    clipboard: s.editorState.clipboard,
    history: s.editorState.history,
  };
  if (s.editorState.textLayers !== undefined) editor.textLayers = s.editorState.textLayers;
  if (s.editorState.activeTextLayerId !== undefined) editor.activeTextLayerId = s.editorState.activeTextLayerId;
  if (s.editorState.textRecentColors !== undefined) editor.textRecentColors = s.editorState.textRecentColors;
  if (s.editorState.outlineTargetPaletteId !== undefined) editor.outlineTargetPaletteId = s.editorState.outlineTargetPaletteId;
  if (s.editorState.outlinePreview !== undefined) editor.outlinePreview = s.editorState.outlinePreview;

  return {
    project: { ...s.documentState },
    source: {
      image: s.sourceState.dataUrl,
      width: s.sourceState.naturalWidth,
      height: s.sourceState.naturalHeight,
    },
    canvas: { ...s.canvasState },
    palette: {
      id: s.paletteState.id,
      maxColors: s.processingState.maxColors,
      usedColors: s.statsState.usedColors,
    },
    generation: {
      engine: s.processingState.generationEngine,
      algorithm: s.processingState.algorithmEngine,
      preset: s.processingState.generationPreset,
      sampling: s.processingState.generationSampling,
      detailProtection: s.processingState.detailProtection,
      edgeProtection: s.processingState.edgeProtection,
      cleanupStrength: s.processingState.cleanupStrength,
      preserveHighlights: s.processingState.preserveHighlights,
      preserveEyes: s.processingState.preserveEyes,
      preserveMicroDetails: s.processingState.preserveMicroDetails,
      backgroundRemoval: s.processingState.backgroundRemoval,
      // 4 个保护开关：由 processingState 提供默认 false，快照里【始终存在】。
      // 早先是「写入后才出现的运行时动态字段」，现已进入默认值面。
      subjectCrop: s.processingState.subjectCrop,
      autoBackground: s.processingState.autoBackground,
      strokeProtection: s.processingState.strokeProtection,
      accentProtection: s.processingState.accentProtection,
      // 算法调色：单独成桶，与 sourceTransform 的同名字段区分
      brightness: s.processingState.colorTuning.brightness,
      contrast: s.processingState.colorTuning.contrast,
      saturation: s.processingState.colorTuning.saturation,
    },
    view: {
      mode: s.rendererState.mode,
      zoom: s.viewportState.zoom,
      panX: s.viewportState.panX,
      panY: s.viewportState.panY,
      showGrid: s.rendererState.showGrid,
      showCodes: s.rendererState.showCodes,
      codeVisibilityThreshold: s.rendererState.codeVisibilityThreshold,
    },
    reference: { ...s.referenceState },
    editor,
    exportSettings: {
      type: s.pageExportState.type,
      preview: s.pageExportState.preview,
      pattern: s.pageExportState.pattern,
    },
    stats: {
      totalBeads: s.statsState.totalBeads,
      usedColors: s.statsState.usedColors,
      colors: s.statsState.colors,
    },
    ui: { ...s.uiState },
    status,
  };
}

// ---------------------------------------------------------------------------
// 写：把 projectStore 的命名空间 patch 映射到 libmsStore 的命名空间
// ---------------------------------------------------------------------------
const WRITE = {
  project: (store, v) => store.patchState("documentState", v),

  source: (store, v) => {
    const p = {};
    if ("image" in v) p.dataUrl = v.image;
    if ("width" in v) p.naturalWidth = v.width;
    if ("height" in v) p.naturalHeight = v.height;
    if (Object.keys(p).length) store.patchState("sourceState", p);
  },

  canvas: (store, v) => store.patchState("canvasState", v),

  palette: (store, v) => {
    if ("id" in v) store.patchState("paletteState", { id: v.id });
    // 语义错位字段：名为 palette.maxColors，实为生成参数 → processingState
    if ("maxColors" in v) store.patchState("processingState", { maxColors: v.maxColors });
    if ("usedColors" in v) store.patchState("statsState", { usedColors: v.usedColors });
  },

  generation: (store, v) => {
    const p = {};
    const tune = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "engine") p.generationEngine = val;
      else if (k === "algorithm") p.algorithmEngine = val;
      else if (k === "preset") p.generationPreset = val;
      else if (k === "sampling") p.generationSampling = val;
      else if (k === "brightness" || k === "contrast" || k === "saturation") tune[k] = val;
      else p[k] = val; // detailProtection / edgeProtection / … / subjectCrop / autoBackground / …
    }
    if (Object.keys(p).length) store.patchState("processingState", p);
    if (Object.keys(tune).length) {
      const cur = store.get("processingState", "colorTuning") || {};
      store.patchState("processingState", { colorTuning: { ...cur, ...tune } });
    }
  },

  view: (store, v) => {
    const r = {};
    const vp = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "zoom" || k === "panX" || k === "panY") vp[k] = val;
      else r[k] = val; // mode / showGrid / showCodes / codeVisibilityThreshold
    }
    if (Object.keys(r).length) store.patchState("rendererState", r);
    if (Object.keys(vp).length) store.patchState("viewportState", vp);
  },

  reference: (store, v) => store.patchState("referenceState", v),

  editor: (store, v) => {
    const e = {};
    for (const [k, val] of Object.entries(v)) {
      if (k === "selectedColor") store.patchState("paletteState", { selectedColor: val });
      else if (k === "tool") e.wsTool = val;          // 不合流：与 app.js editorTool 区分
      else if (k === "selection") e.wsSelection = val; // 不合流：与 app.js editorSelection 区分
      else e[k] = val;
    }
    if (Object.keys(e).length) store.patchState("editorState", e);
  },

  exportSettings: (store, v) => store.patchState("pageExportState", v),
  stats: (store, v) => store.patchState("statsState", v),
  ui: (store, v) => store.patchState("uiState", v),
  status: (store, v) => store.patchState("statusState", v),
};

function applyPatch(store, patch) {
  for (const [ns, value] of Object.entries(patch)) {
    if (!Object.prototype.hasOwnProperty.call(WRITE, ns)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      WRITE[ns](store, value);
    } else {
      // 顶层传非对象（如数组/null）时沿用原语义：整体替换该命名空间
      WRITE[ns](store, value ?? {});
    }
  }
}

// ---------------------------------------------------------------------------
// adapter 工厂：本身不持有任何状态，只持有一个"目标 store 的解析器"
// ---------------------------------------------------------------------------
function createAdapter(resolveTarget) {
  const listeners = new Set();

  return {
    getState() {
      return snapshot(resolveTarget());
    },

    setState(patch) {
      const target = resolveTarget();
      const next = typeof patch === "function" ? patch(this.getState()) : patch;
      if (!next || typeof next !== "object") return this.getState();
      applyPatch(target, next);
      const state = this.getState();
      // 只在【本 adapter 自己的 setState】时通知，与改造前行为一致。
      // 不转发 libmsStore 的其它变更（如 app.js 经 Proxy 写入），
      // 否则 workspace.js:971 的 paint() 会被 app.js 的高频写入反复触发。
      for (const listener of listeners) listener(state, next);
      return state;
    },

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    // Phase 3B 新增的调试/验收入口：证明本 adapter 代理的是哪个 store
    __target: resolveTarget,
  };
}

/**
 * 创建一个【独立实例】的 adapter（供测试使用）。
 * 每个实例背后是一个新建的 libmsStore，互不干扰 —— 与改造前 createProjectStore 的隔离语义一致。
 * 注意：adapter 自身不存状态，状态在它代理的那个 libmsStore 里。
 */
export function createProjectStore(seed = {}) {
  const api = getApi();
  if (!api) throw new Error("[projectStore] libmsStore 未初始化：state/store.js 未加载");
  const store = api.createStore();
  if (seed && Object.keys(seed).length) applyPatch(store, seed);
  return createAdapter(() => store);
}

/**
 * 运行时单例：代理【全局唯一的 libmsStore】（浏览器里即 window.libmsStore）。
 * ui/workspace.js 用的就是它 —— 于是 workspace 与 app.js 读写同一份数据，真实状态源 = 1。
 * 延迟解析，避免模块加载顺序问题。
 */
export const projectStore = createAdapter(getGlobalStore);
