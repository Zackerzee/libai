/*
 * state/store.js — Phase 2 分层状态模型（单一数据源 / Single Source of Truth）
 *
 * 这是 libms-studio 重构的"状态地基"。它不改动任何 UI 行为、算法结果、导出结果或编辑行为。
 * 旧代码（app.js 里的 `const state = {...}`）通过 createCompatState() 返回的 Proxy 继续以
 * `state.xxx` 的扁平写法读写，但真实数据只存一份 —— 在本 store 的 8 个领域命名空间里。
 *
 * 设计约束（来自 Phase 2 任务书）：
 *  - 8 个领域命名空间（sourceState / patternState / processingState / paletteState /
 *    rendererState / viewportState / pageExportState / editorState）。
 *  - Phase 3B 起，命名空间扩展为 13 个：原 8 个领域命名空间 +
 *    documentState / referenceState / statusState / uiState / statsState。
 *    原先临时用的 metaState 已按 PROJECT-STORE-AUDIT.md §4.7 拆掉
 *    （metaState.ui → uiState，metaState.status → statusState，瞬态标志 → statusState）。
 *    新增的 5 个命名空间用于承接 projectStore 的字段，使全站只有一份真实数据。
 *  - 单一数据源：禁止旧 state 与新 store 各存一份靠同步函数维持。Proxy 直接路由到 store。
 *  - 最小状态 API：getState / setState(path,value) / patchState(ns,patch) /
 *    subscribe(ns,cb) / unsubscribe(...) / resetNamespace(ns) / batch(fn)。
 *
 * 关于 state/project-store.js（Phase 3B 已收口，不再是双源）：
 *  ui/workspace.js 用的是 project-store.js 导出的 projectStore。Phase 2 时它是【独立、不互通】
 *  的第二份状态（12 命名空间），属于既有双源。
 *  Phase 3B 将其改为【纯 adapter】：projectStore 自身不保存任何 backing state，
 *  其 getState/setState/subscribe 全部代理本 store（浏览器里即 globalThis.libmsStore）。
 *  于是运行时真实状态源数量 = 1（app.js 的 state 走兼容层 Proxy，workspace.js 走 adapter，
 *  二者读写同一份数据）。字段映射见 PROJECT-STORE-AUDIT.md §4。
 *  注意：adapter 必须复刻 projectStore 原有的"只合并一层、命名空间内子对象整体替换"语义。
 *
 * 加载方式：经典脚本（app.js 是经典脚本，无法 import）。本文件在 index.html 中
 * 必须排在 app.js【之前】以 defer 引入，挂到 globalThis.libmsStore。
 * 同时兼容 Node（module.exports），供状态层单测 require。
 */
(function (root) {
  "use strict";

  // ---------------------------------------------------------------------------
  // 默认值：每个命名空间的初始字段。必须与 app.js 原 `const state = {...}` 的初值逐位一致，
  // 否则"初始值一致"测试会失败，且任何依赖默认值的逻辑会偏离旧行为。
  // 注意：DEFAULT_BRAND 在 app.js 定义为 "mard"（app.js:405），store.js 先于 app.js 加载，
  // 故此处硬编码字面值，绝不能引用 app.js 的全局。
  // ---------------------------------------------------------------------------
  const DEFAULTS = {
    sourceState: {
      dataUrl: "",            // state.sourceDataUrl
      name: "",               // state.sourceName
      naturalWidth: 0,        // state.sourceNaturalWidth
      naturalHeight: 0,       // state.sourceNaturalHeight
      processedDataUrl: "",   // state.processedSourceDataUrl
      safetyChecked: false,   // state.sourceSafetyChecked
    },

    patternState: {
      width: 0,               // state.width
      height: 0,              // state.height
      grid: [],               // state.grid（最终颜色矩阵）
      stats: [],              // state.stats（颜色统计）
      editorGrid: [],         // state.editorGrid
      generationOriginalGrid: null,   // state.generationOriginalGrid
      generationOptimizedGrid: null,  // state.generationOptimizedGrid
      showingOptimizedGrid: true,     // state.showingOptimizedGrid
      directPatternFile: null,        // state.directPatternFile
      // 注：projectStore.canvas 的 width/height 未并入本命名空间，见下方 canvasState 的说明。
      // —— 以下为"生成结果/报告"，用户 8 层没有 reports 命名空间，聚类到 patternState ——
      pindoReport: null,              // state.pindoReport
      bgsReport: null,                // state.bgsReport
      pwReport: null,                 // state.pwReport
      optimizerReport: null,          // state.optimizerReport
      structuralTransitionReport: null,   // state.structuralTransitionReport
      structuralDetectionBaseline: null,  // state.structuralDetectionBaseline
      regionalBlockReport: null,      // state.regionalBlockReport
      chartUrl: "",                   // state.chartUrl（预览渲染输出）
      previewUrl: "",                 // state.previewUrl
      paletteBudget: null,            // state.paletteBudget
      patternAdjustBase: null,        // state.patternAdjustBase
      patternAdjustPreviewGrid: null, // state.patternAdjustPreviewGrid
      patternAdjustTarget: "editor",  // state.patternAdjustTarget
      patternAdjustFrame: 0,          // state.patternAdjustFrame
      gridAlignBase: null,            // state.gridAlignBase
    },

    processingState: {
      generationEngine: "v2.5",       // state.generationEngine
      generationEngineLast: "",       // state.generationEngineLast
      algorithmEngine: "current",     // state.algorithmEngine
      algorithmEngineLast: "",         // state.algorithmEngineLast
      generationPreset: "auto",       // state.generationPreset
      generationSampling: "auto",     // state.generationSampling
      pwPaletteMatchMode: "ciede2000",// state.pwPaletteMatchMode
      pwOptions: null,                // state.pwOptions
      pwHybridOptions: null,          // state.pwHybridOptions
      importMode: "photo",            // state.importMode
      autoProcessAfterLoad: false,    // state.autoProcessAfterLoad
      restoreAutoSizePending: false,  // state.restoreAutoSizePending
      // 源图尺寸的**权威值**：{ width, height, authority, source }。
      // authority 见 services/source-dimensions.mjs 的六级链。
      // 结构化工程 / 人工标定 / 网格识别这三级的尺寸是绝对值，生成时直接采用，
      // 不经过长边、裁剪比例或像素倍数再算一遍。unresolved 表示还没解析出来。
      sourceDimensions: { width: 0, height: 0, authority: "unresolved", source: "" },  // state.sourceDimensions
      // 生成尺寸 = 长边格数 + 有效裁剪比例派生。**只对「普通图片生成」成立**：
      // 存在绝对权威尺寸时，长边让位（见 app.js resolveGenerationDimensions）。
      // 0 表示「尚未解析」；解析失败时生成必须延后，不得回退成方图。
      generationLongEdge: 0,          // state.generationLongEdge
      // 生成请求号：单调递增，用于丢弃陈旧结果（后续异步 Worker 时是硬需求）。
      generationRequestId: 0,         // state.generationRequestId
      importApproved: false,          // state.importApproved
      manualEdited: false,            // state.manualEdited
      backgroundDecision: "",         // state.backgroundDecision
      // 源图预处理变换（裁切/旋转/翻转/亮度…），属生成前处理参数
      sourceTransform: {
        crop: null, cropRatio: "free", rotation: 0, flipX: false, flipY: false,
        brightness: 0, contrast: 0, saturation: 0, sharpen: 0,
        expand: { top: 0, bottom: 0, left: 0, right: 0 }, background: "#ffffff",
      },                                // state.sourceTransform
      // 内容安全模型
      safetyModel: null,              // state.safetyModel
      safetyModelLoading: null,       // state.safetyModelLoading
      safetyModelUnavailable: false,  // state.safetyModelUnavailable
      // —— Phase 3B：承接 projectStore.generation 的"真正可调处理参数" ——
      // 这些参数此前【只在】 project-store.js 的 generation 里，app.js 的 state 没有。
      maxColors: 0,                   // projectStore.palette.maxColors（语义错位，见下）
      detailProtection: 70,           // projectStore.generation.detailProtection
      edgeProtection: 70,             // projectStore.generation.edgeProtection
      cleanupStrength: 50,            // projectStore.generation.cleanupStrength
      preserveHighlights: true,       // projectStore.generation.preserveHighlights
      preserveEyes: true,             // projectStore.generation.preserveEyes
      preserveMicroDetails: true,     // projectStore.generation.preserveMicroDetails
      backgroundRemoval: false,       // projectStore.generation.backgroundRemoval
      // 以下 4 个是 projectStore 里【运行时动态新增】的字段（不在其 defaults），必须收录否则丢
      subjectCrop: false,             // projectStore.generation.subjectCrop
      autoBackground: false,          // projectStore.generation.autoBackground
      strokeProtection: false,        // projectStore.generation.strokeProtection
      accentProtection: false,        // projectStore.generation.accentProtection
      // generation.brightness/contrast/saturation 与 sourceTransform 的同名字段
      // 是【不同阶段】的参数（算法调色 vs 源图预处理），故单独成桶，不合并。
      colorTuning: { brightness: 0, contrast: 0, saturation: 0 },
      // 注：project-store.js 的 generation 命名空间持有"真正的可调处理参数"
      // （maxColors / detailProtection / edgeProtection / cleanupStrength /
      //  preserveHighlights/Eyes/MicroDetails / backgroundRemoval /
      //  brightness/contrast/saturation 等），它们【不在】 app.js 的 state 里，
      //  属 EXTERNAL，待 Phase 3/4 收口到 processingState（见 STATE-MIGRATION.md）。
    },

    paletteState: {
      id: "mard-221",          // projectStore.palette.id（色库标识）
      brand: "mard",           // state.selectedBrand
      selectedColor: null,     // state.selectedColor
      currentSelectedColor: null, // state.currentSelectedColor
      label: "",               // state.paletteLabel
      engine: null,            // state.paletteEngine
      availableColorsByPalette: {}, // 本机生成色卡偏好，不改变完整真实色库
    },

    rendererState: {
      // —— Phase 3B：承接 projectStore.view 的"渲染模式与显示开关" ——
      // 注意：这里的 showGrid/showCodes 与下面的 prefs.showGrid/showCodes 是【两套不同】的开关
      // （前者来自 projectStore.view，后者来自 app.js 的 state.editorPrefs），不可混用。
      mode: "blocks",                   // projectStore.view.mode（blocks / pattern …）
      showGrid: false,                  // projectStore.view.showGrid
      showCodes: false,                 // projectStore.view.showCodes
      codeVisibilityThreshold: 16,      // projectStore.view.codeVisibilityThreshold
      previewRenderCell: 8,            // state.previewRenderCell
      previewDetailCodesVisible: false, // state.previewDetailCodesVisible
      previewModalUsesCurrentGrid: false, // state.previewModalUsesCurrentGrid
      // 编辑器显示偏好整体保留（app.js 多处整体读写 state.editorPrefs）
      prefs: {
        showGrid: true, showCodes: true, showCoords: true,
        snap: true, toolbarPosition: "left",
      },                                // state.editorPrefs
    },

    viewportState: {
      zoom: 1,                 // projectStore.view.zoom（workspace 侧缩放）
      previewZoom: 1,          // state.previewZoom（app.js 预览缩放，Phase 3C 再统一）
      editorZoom: 1,           // state.editorZoom（app.js 编辑器缩放，Phase 3C 再统一）
      panX: 0,                 // 新增（未来 Navigator/Minimap 用）
      panY: 0,                 // 新增
      fitMode: "fit",          // 新增
    },

    editorState: {
      // —— Phase 3B：承接 projectStore.editor 的字段（workspace.js 写 35 次，此前零测试保护）——
      selectedCell: null,      // projectStore.editor.selectedCell
      // —— Stage B1 §6：当前颜色的**唯一真源**（工作台编辑器）——
      // 语义：工作台编辑器正在使用的颜色身份（paletteId；生产网格上等于色号 code）。
      //   null = 未选色（同时是「橡皮擦」的规范表示，§8）。
      // 为什么要有它：工作台与旧编辑器（app.js 的 #editor-modal）都写「当前颜色」，
      // 而 projectStore 适配器的 WRITE.editor 把 `selectedColor` 路由到
      // **paletteState.selectedColor** —— 也就是旧编辑器存**完整颜色对象**的那个槽位。
      // 于是同一个槽位被两种类型写：工作台写字符串色号，旧编辑器写 {code,rgb,hex}。
      // 后果实测：旧编辑器读 `state.selectedColor.code` 得到 undefined，
      // 判定「该色不在色板里」→ 打开旧编辑器就把工作台刚选的色静默清空。
      // 现在 currentPaletteId 是工作台自己的真源；工作台**一律不碰**
      // paletteState.selectedColor，把那个槽位完整归还给旧编辑器。
      // selectedPaletteId 是工作台侧的兼容镜像，只允许
      // services/current-palette.mjs 的 buildCurrentPalettePatch() 写入。
      currentPaletteId: null,
      // 镜像字段（兼容读；禁止直接写）。由 buildCurrentPalettePatch() 同步。
      selectedPaletteId: null,
      hoveredCell: null,       // projectStore.editor.hoveredCell
      shapePreview: null,      // projectStore.editor.shapePreview
      highlightedColor: null,  // projectStore.editor.highlightedColor
      highlightedPaletteId: null,
      brushSize: 1,            // projectStore.editor.brushSize
      pixelPerfect: true,       // 当前 1 格画笔笔迹的确定性转角清理
      wandTolerance: 12,       // projectStore.editor.wandTolerance
      shapeFilled: false,      // projectStore.editor.shapeFilled
      symmetryHorizontal: false,
      symmetryVertical: false,
      symmetryMode: "none",
      symmetryAxisX: null,
      symmetryAxisY: null,
      symmetryGuideVisible: true,
      rampBasePaletteId: null,
      rampSize: 5,
      rampPaletteIds: [],
      inkMode: "normal",
      paletteCategory: "all",  // projectStore.editor.paletteCategory
      recentColors: [],        // projectStore.editor.recentColors
      clipboard: null,         // projectStore.editor.clipboard
      history: { canUndo: false, canRedo: false }, // projectStore.editor.history
      // 注：projectStore.editor.selectedColor 语义是"当前选中颜色"，
      //     已归到 paletteState.selectedColor（与 app.js state.selectedColor 同源，默认同为 null，合流）。
      //
      // 但 editor.tool 与 editor.selection 【不合流】，单独承接：
      //  - app.js 的 editorTool 默认 "pencil"（遗留编辑器），projectStore.editor.tool 默认 "select"（workspace）；
      //  - 两者默认值不同，且分属两个编辑器实例（遗留编辑器 vs workspace 编辑器）。
      //    按"同名不同义不合流"原则（AUDIT §5），先各自保留。
      //    Phase 3C 若确认是同一个编辑器，再统一为单个 tool/selection 字段。
      wsTool: "select",        // projectStore.editor.tool
      wsSelection: null,       // projectStore.editor.selection
      tool: "pencil",          // state.editorTool（app.js 遗留编辑器）
      floating: null,          // state.editorFloating
      selection: null,         // state.editorSelection
      activeSelection: null,   // state.activeEditorSelection
      referenceImage: null,    // state.editorReferenceImage
      reference: null,         // state.editorReference
      referenceUndo: [],       // state.referenceUndo
      currentPaintAction: [],  // state.currentPaintAction
      paintUndo: [],           // state.paintUndo
      replaceUndo: [],         // state.replaceUndo
      lastPaintKey: "",        // state.lastPaintKey
      // 拼装/播放（编辑器播放态）
      assemblyMode: false,     // state.assemblyMode
      assemblyHighlightCode: "",   // state.assemblyHighlightCode
      assemblyHistoryActive: false,// state.assemblyHistoryActive
      assemblyHideCellText: false, // state.assemblyHideCellText
      playActiveCode: "",     // state.playActiveCode
      playCompletedBeads: new Set(), // state.playCompletedBeads（Set 实例）
      playStorageKey: "",     // state.playStorageKey
      playHoverRow: "",       // state.playHoverRow
      playHoverCol: "",       // state.playHoverCol
    },

    pageExportState: {
      // app.js 旧 state 无显式导出设置，导出走 DOM 控件；此处给默认值，
      // 取 project-store.js exportSettings 的同形默认值，便于 Phase 3/4 收敛。
      type: "preview",
      preview: { showGrid: false, showCodes: false },
      pattern: { showGrid: true, showCodes: true, showCoordinates: true },
    },

    // —— Phase 3B：拆掉 metaState，改为语义明确的独立命名空间 ——
    // 依据 PROJECT-STORE-AUDIT.md §4.7：metaState.ui → uiState，metaState.status → statusState，
    // 4 个瞬态状态标志 → statusState。

    /**
     * 图纸"目标尺寸 / 画布"：projectStore.canvas（Phase 3B）
     *
     * 为什么【不】并入 patternState.width/height：
     *  - patternState.width/height（源自 app.js state.width/height）默认 0，语义是"已生成图纸的实际尺寸"；
     *  - canvasState.width/height（源自 projectStore.canvas）默认 50，语义是"生成目标尺寸"，
     *    且 workspace.js:33 挂载时会显式设成 104。
     *  两者默认值不同（0 vs 50）、生命周期不同（结果 vs 入参），按"同名不同义不合流"的原则
     *  （PROJECT-STORE-AUDIT.md §5.1）先分开承接。既有测试
     *  project-store.test.mjs 断言生成入参 height=50，合并会直接把它改坏。
     *  Phase 3C 需在浏览器里实测两者运行时是否始终相等，再决定是否统一。
     */
    canvasState: {
      width: 50, height: 50, lockAspectRatio: false, beadSize: 2.6,
    },

    /** 作品（文档）元信息：projectStore.project */
    documentState: {
      id: null,
      name: "未命名作品",
    },

    /** 参考图叠加层：projectStore.reference */
    referenceState: {
      url: "", opacity: 40, fit: "contain", visible: false, useSource: false,
      offsetX: 0, offsetY: 0, scale: 1, smoothing: "smooth", displayMode: "normal", adjusting: false,
    },

    /** 状态标志：projectStore.status + app.js 的瞬态标志 */
    statusState: {
      generating: false,       // projectStore.status.generating
      dirty: false,            // projectStore.status.dirty
      hasSource: false,        // projectStore.status.hasSource
      hasPattern: false,       // projectStore.status.hasPattern
      // 注：generationError 故意【不】给默认值 —— 在 projectStore 里它是运行时动态字段，
      // 默认必须"不存在该键"（行为快照已冻结）。写入后才出现。
      //
      // notice / generationPhase 是 Stage B3 新增的**瞬态提示位**。
      // 为什么必须进 store 而不是直接写 DOM：#ws-status 的文案由 paint() 统一渲染，
      // 直接 `textContent = ...` 会被紧接着的一次 paint 立刻覆盖 ——
      // 实测「点了取消 → 显示已生成」，用户永远看不到自己刚才那一下的结果。
      // 放进 state 之后，文案就是状态的一部分，谁渲染都不会丢。
      notice: "",              // 最近一次用户可见提示（已取消生成 / 参数已改 …）
      generationPhase: "",     // 生成中的阶段文案（正在分析图片… 等），空闲时为空
      // app.js 侧的瞬态标志
      livePreviewTimer: 0,        // state.livePreviewTimer
      livePreviewPending: false,  // state.livePreviewPending
      isProcessingImage: false,   // state.isProcessingImage
      isPainting: false,          // state.isPainting
      lastGenerationError: "",    // state.lastGenerationError（运行时动态赋值）
    },

    /** UI 面板态：projectStore.ui */
    uiState: {
      activePanel: "project", inspectorOpen: true, exportDrawerOpen: false,
    },

    /** 生成结果统计：projectStore.stats（注意与 patternState.stats 不同：后者是颜色统计） */
    statsState: {
      totalBeads: 0, usedColors: 0, colors: [],
    },
  };

  // ---------------------------------------------------------------------------
  // 旧扁平字段 → [namespace, field] 映射。这是兼容层的核心路由表。
  // app.js 里每一个 `state.xxx` 都经此映射到 store 的某一字段。
  // 每个旧字段【只】映射到唯一一处，确保单一数据源，无双写。
  // ---------------------------------------------------------------------------
  const LEGACY_MAP = {
    sourceDataUrl: ["sourceState", "dataUrl"],
    sourceName: ["sourceState", "name"],
    sourceNaturalWidth: ["sourceState", "naturalWidth"],
    sourceNaturalHeight: ["sourceState", "naturalHeight"],
    processedSourceDataUrl: ["sourceState", "processedDataUrl"],
    sourceSafetyChecked: ["sourceState", "safetyChecked"],

    grid: ["patternState", "grid"],
    stats: ["patternState", "stats"],
    width: ["patternState", "width"],
    height: ["patternState", "height"],
    editorGrid: ["patternState", "editorGrid"],
    generationOriginalGrid: ["patternState", "generationOriginalGrid"],
    generationOptimizedGrid: ["patternState", "generationOptimizedGrid"],
    showingOptimizedGrid: ["patternState", "showingOptimizedGrid"],
    directPatternFile: ["patternState", "directPatternFile"],
    pindoReport: ["patternState", "pindoReport"],
    bgsReport: ["patternState", "bgsReport"],
    pwReport: ["patternState", "pwReport"],
    optimizerReport: ["patternState", "optimizerReport"],
    smartReport: ["patternState", "smartReport"], // 生成诊断报告（app.js 运行时动态赋值）
    structuralTransitionReport: ["patternState", "structuralTransitionReport"],
    structuralDetectionBaseline: ["patternState", "structuralDetectionBaseline"],
    regionalBlockReport: ["patternState", "regionalBlockReport"],
    chartUrl: ["patternState", "chartUrl"],
    previewUrl: ["patternState", "previewUrl"],
    paletteBudget: ["patternState", "paletteBudget"],
    patternAdjustBase: ["patternState", "patternAdjustBase"],
    patternAdjustPreviewGrid: ["patternState", "patternAdjustPreviewGrid"],
    patternAdjustTarget: ["patternState", "patternAdjustTarget"],
    patternAdjustFrame: ["patternState", "patternAdjustFrame"],
    gridAlignBase: ["patternState", "gridAlignBase"],

    generationEngine: ["processingState", "generationEngine"],
    generationEngineLast: ["processingState", "generationEngineLast"],
    generationPreset: ["processingState", "generationPreset"],
    generationSampling: ["processingState", "generationSampling"],
    algorithmEngine: ["processingState", "algorithmEngine"],
    algorithmEngineLast: ["processingState", "algorithmEngineLast"],
    generationMilliseconds: ["processingState", "generationMilliseconds"], // 运行时动态赋值
    generationQuality: ["processingState", "generationQuality"],           // 运行时动态赋值
    productionGenerationOptions: ["processingState", "productionGenerationOptions"], // 运行时动态赋值
    smartFeatures: ["processingState", "smartFeatures"],                   // 运行时动态赋值
    pwPaletteMatchMode: ["processingState", "pwPaletteMatchMode"],
    pwOptions: ["processingState", "pwOptions"],
    pwHybridOptions: ["processingState", "pwHybridOptions"],
    importMode: ["processingState", "importMode"],
    autoProcessAfterLoad: ["processingState", "autoProcessAfterLoad"],
    restoreAutoSizePending: ["processingState", "restoreAutoSizePending"],
    sourceDimensions: ["processingState", "sourceDimensions"],
    generationLongEdge: ["processingState", "generationLongEdge"],
    generationRequestId: ["processingState", "generationRequestId"],
    importApproved: ["processingState", "importApproved"],
    manualEdited: ["processingState", "manualEdited"],
    backgroundDecision: ["processingState", "backgroundDecision"],
    sourceTransform: ["processingState", "sourceTransform"],
    safetyModel: ["processingState", "safetyModel"],
    safetyModelLoading: ["processingState", "safetyModelLoading"],
    safetyModelUnavailable: ["processingState", "safetyModelUnavailable"],

    selectedBrand: ["paletteState", "brand"],
    selectedColor: ["paletteState", "selectedColor"],
    currentSelectedColor: ["paletteState", "currentSelectedColor"],
    paletteLabel: ["paletteState", "label"],
    paletteEngine: ["paletteState", "engine"],
    // Stage B1 §6：当前颜色的唯一真源（工作台编辑器）。
    // 注意它与 paletteState.selectedColor 是**不同编辑器**的字段，故意不合流：
    //   paletteState.selectedColor 属 app.js 的 #editor-modal 旧编辑器，存完整颜色对象；
    //   editorState.currentPaletteId 属工作台编辑器，存 paletteId 字符串。
    // 更要紧的是：适配器会把 projectStore 的 `editor.selectedColor` 路由到
    // paletteState.selectedColor（见 state/project-store.js 的 WRITE.editor），
    // 所以工作台若写 selectedColor，就会和旧编辑器抢同一个槽位、且写进去是字符串。
    // 工作台侧的读写一律走 currentPaletteId。
    currentPaletteId: ["editorState", "currentPaletteId"],

    previewRenderCell: ["rendererState", "previewRenderCell"],
    previewDetailCodesVisible: ["rendererState", "previewDetailCodesVisible"],
    previewModalUsesCurrentGrid: ["rendererState", "previewModalUsesCurrentGrid"],
    editorPrefs: ["rendererState", "prefs"],

    previewZoom: ["viewportState", "previewZoom"],
    editorZoom: ["viewportState", "editorZoom"],

    editorTool: ["editorState", "tool"],
    editorFloating: ["editorState", "floating"],
    editorSelection: ["editorState", "selection"],
    activeEditorSelection: ["editorState", "activeSelection"],
    editorReferenceImage: ["editorState", "referenceImage"],
    editorReference: ["editorState", "reference"],
    referenceUndo: ["editorState", "referenceUndo"],
    currentPaintAction: ["editorState", "currentPaintAction"],
    paintUndo: ["editorState", "paintUndo"],
    replaceUndo: ["editorState", "replaceUndo"],
    lastPaintKey: ["editorState", "lastPaintKey"],
    assemblyMode: ["editorState", "assemblyMode"],
    assemblyHighlightCode: ["editorState", "assemblyHighlightCode"],
    assemblyHistoryActive: ["editorState", "assemblyHistoryActive"],
    assemblyHideCellText: ["editorState", "assemblyHideCellText"],
    playActiveCode: ["editorState", "playActiveCode"],
    playCompletedBeads: ["editorState", "playCompletedBeads"],
    playStorageKey: ["editorState", "playStorageKey"],
    playHoverRow: ["editorState", "playHoverRow"],
    playHoverCol: ["editorState", "playHoverCol"],

    // metaState 已于 Phase 3B 拆为 statusState / uiState，故此处改为 statusState
    livePreviewTimer: ["statusState", "livePreviewTimer"],
    livePreviewPending: ["statusState", "livePreviewPending"],
    isProcessingImage: ["statusState", "isProcessingImage"],
    isPainting: ["statusState", "isPainting"],
    lastGenerationError: ["statusState", "lastGenerationError"], // 运行时动态赋值
  };

  // 旧 state 里共 86 个顶层字段，LEGACY_MAP 应完整覆盖。缺漏会在测试中断言。
  const LEGACY_KEYS = Object.keys(LEGACY_MAP);

  // ---------------------------------------------------------------------------
  // 深克隆：支持 Set / Array / 普通对象 / 原始值。resetNamespace 与初始化需要。
  // ---------------------------------------------------------------------------
  function clone(value) {
    if (value === null || typeof value !== "object") return value;
    if (value instanceof Set) return new Set(Array.from(value, clone));
    if (Array.isArray(value)) return value.map(clone);
    if (value instanceof Date) return new Date(value.getTime());
    const out = {};
    for (const k of Object.keys(value)) out[k] = clone(value[k]);
    return out;
  }

  // ---------------------------------------------------------------------------
  // createStore：单一数据源本体 + 最小状态 API。
  // ---------------------------------------------------------------------------
  function createStore() {
    const data = clone(DEFAULTS);          // 真实数据，唯一副本
    const listeners = Object.create(null); // namespace -> Set<callback>
    const globalListeners = new Set();      // 全量订阅
    let batchDepth = 0;
    const batchDirty = new Set();           // 批处理期间待通知的 namespace

    function ensureListeners(ns) {
      if (!listeners[ns]) listeners[ns] = new Set();
      return listeners[ns];
    }

    function notify(ns) {
      if (batchDepth > 0) { batchDirty.add(ns); return; }
      const nsValue = data[ns];
      const set = listeners[ns];
      if (set) for (const cb of set) cb(nsValue, { namespace: ns, store });
      for (const cb of globalListeners) cb(nsValue, { namespace: ns, store });
    }

    function validateNs(ns) {
      if (!Object.prototype.hasOwnProperty.call(data, ns)) {
        throw new Error("[libmsStore] 未知命名空间: " + ns);
      }
    }

    // 内部：合并 patch 到某命名空间并通知
    function applyPatch(ns, patch) {
      validateNs(ns);
      Object.assign(data[ns], patch);
      notify(ns);
    }

    const store = {
      // 命名空间清单
      namespaces: Object.keys(DEFAULTS),
      legacyKeys: LEGACY_KEYS,
      legacyMap: LEGACY_MAP,

      // 取整个 store（活引用，勿直接改；用 setState/patchState）
      getState() { return data; },
      // 取单个命名空间（活引用）
      getNamespace(ns) { validateNs(ns); return data[ns]; },
      // 取单字段：get("patternState","width") 或 get("patternState") 返回整个 ns
      get(ns, field) {
        validateNs(ns);
        if (field === undefined) return data[ns];
        return data[ns][field];
      },

      // 按点路径写：setState("patternState.width", 50)
      setState(path, value) {
        const dot = path.indexOf(".");
        if (dot === -1) throw new Error("[libmsStore] setState 需要点路径: " + path);
        const ns = path.slice(0, dot);
        const field = path.slice(dot + 1);
        validateNs(ns);
        data[ns][field] = value;
        notify(ns);
        return value;
      },

      // 合并写：patchState("patternState", { width: 50, height: 40 })
      // 注意：对嵌套对象为整体替换（浅合并顶层字段）。
      patchState(ns, patch) {
        applyPatch(ns, patch);
        return data[ns];
      },

      // 订阅某命名空间；返回取消订阅函数。也支持 subscribe("*", cb) 收全量。
      subscribe(ns, callback) {
        if (ns === "*") { globalListeners.add(callback); return () => globalListeners.delete(callback); }
        const set = ensureListeners(ns);
        set.add(callback);
        return () => set.delete(callback);
      },

      // 取消订阅：可传 subscribe 返回的函数，或 (ns, callback)
      unsubscribe(tokenOrNs, callback) {
        if (typeof tokenOrNs === "function") { tokenOrNs(); return; }
        const set = listeners[tokenOrNs];
        if (set && callback) set.delete(callback);
      },

      // 重置某命名空间到默认
      resetNamespace(ns) {
        validateNs(ns);
        data[ns] = clone(DEFAULTS[ns]);
        notify(ns);
        return data[ns];
      },

      // 批处理：fn 内的多次写入，结束后每个变更的 namespace 只通知一次
      batch(fn) {
        batchDepth++;
        try {
          const result = fn(store);
          return result;
        } finally {
          batchDepth--;
          if (batchDepth === 0) {
            const dirty = Array.from(batchDirty);
            batchDirty.clear();
            for (const ns of dirty) notify(ns);
          }
        }
      },

      // 测试/调试用：整体重置
      resetAll() {
        for (const ns of Object.keys(DEFAULTS)) data[ns] = clone(DEFAULTS[ns]);
        notify("*");
        return data;
      },
    };

    return store;
  }

  // ---------------------------------------------------------------------------
  // createCompatState：返回 Proxy，使旧代码 `state.xxx` 读写都路由到 store。
  // 真实数据只在 store；Proxy 是"视图"，不是第二份数据。
  // 完整实现 get/set/has/ownKeys/getOwnPropertyDescriptor/deleteProperty，
  // 让 state 在枚举、JSON.stringify、Object.assign、for...in 下表现得与原扁平对象一致。
  // ---------------------------------------------------------------------------
  function createCompatState(store) {
    const target = Object.create(null); // 仅作 Proxy 的载体，不存数据

    function read(prop) {
      const map = LEGACY_MAP[prop];
      if (!map) return undefined;
      return store.get(map[0], map[1]);
    }
    function write(prop, value) {
      const map = LEGACY_MAP[prop];
      if (!map) { target[prop] = value; return true; }
      store.patchState(map[0], { [map[1]]: value });
      return true;
    }

    return new Proxy(target, {
      get(t, prop) {
        if (typeof prop === "symbol") return t[prop];
        if (prop === "then") return undefined; // 避免被当 thenable
        return read(prop);
      },
      set(t, prop, value) { return write(prop, value); },
      has(t, prop) {
        if (typeof prop === "symbol") return prop in t;
        return prop in LEGACY_MAP || prop in t;
      },
      ownKeys() { return LEGACY_KEYS.slice(); },
      getOwnPropertyDescriptor(t, prop) {
        if (typeof prop === "symbol") return Object.getOwnPropertyDescriptor(t, prop);
        if (prop in LEGACY_MAP) {
          return { enumerable: true, configurable: true, writable: true, value: read(prop) };
        }
        return Object.getOwnPropertyDescriptor(t, prop);
      },
      deleteProperty(t, prop) {
        const map = LEGACY_MAP[prop];
        if (map) { store.patchState(map[0], { [map[1]]: undefined }); return true; }
        delete t[prop];
        return true;
      },
    });
  }

  // ---------------------------------------------------------------------------
  // 暴露：浏览器挂 globalThis.libmsStore；Node 走 module.exports（供单测）。
  // ---------------------------------------------------------------------------
  const api = { createStore, createCompatState, DEFAULTS, LEGACY_MAP, LEGACY_KEYS, clone };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
  // 幂等初始化：本文件在浏览器里会先以 classic <script> 加载，
  // 之后可能被 state/project-store.js 以 ES module 副作用导入再执行一次。
  // 若不守卫，就会创建出第二个 store 实例 —— 那正好是我们拼命要消灭的"第二份真实状态"。
  if (!root.libmsStore) {
    root.libmsStore = api.createStore();
    root.libmsStore.compat = () => createCompatState(root.libmsStore);
  }
  if (!root.libmsStoreApi) root.libmsStoreApi = api;

})(typeof window !== "undefined" ? window : globalThis);
