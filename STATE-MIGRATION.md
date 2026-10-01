# STATE-MIGRATION.md — Phase 2 字段迁移表

> 配套文件：`state/store.js`（单一数据源 + 最小状态 API）、`state/store.test.mjs`（状态层单测）、`VERIFY.md` Phase 2 章。
> 本文是 Phase 2 的交付物之一，记录「旧 `state.xxx`（app.js 扁平对象）→ 新 `state/store.js` 分层命名空间」的完整映射。

## 0. 单一数据源（Single Source of Truth）保证

- 旧 `const state = { ... }`（app.js 原 808–908 行，86 个顶层字段）已替换为：
  `const state = window.libmsStore.compat();`
- 真实数据**只存一份**，位于 `state/store.js` 的 store 实例（运行时挂在 `globalThis.libmsStore`）。
- 兼容层 `createCompatState()` 返回一个 **Proxy**，其 `get / set / has / ownKeys / getOwnPropertyDescriptor / deleteProperty`
  全部路由到 store，**没有任何第二份数据，也没有任何「旧 state 改一份 + 新 store 改一份」的同步函数**。
- 旧代码 `state.xxx = v` 与 `const x = state.xxx` 的写法**完全不变**；所有调用方目前仍走 Proxy（即 Phase 2 刻意「不迁移」）。
- 因此满足任务书第 5 条：禁止双向状态源，只能有一个 Source of Truth。

## 1. 命名空间清单（8 个用户指定 + 1 个必要扩展）

| 命名空间 | 职责 | 是否用户指定 |
| --- | --- | --- |
| sourceState | 原图、原始尺寸、原始文件信息、处理后数据 URL、安全校验标记 | 是 |
| patternState | 图纸宽高、最终颜色矩阵(grid)、色号矩阵(stats)、编辑网格、生成原/优化矩阵、各报告、直接导入文件 | 是 |
| processingState | 引擎/算法/预设/采样、源图预处理变换、内容安全、6 个运行时动态生成字段 | 是 |
| paletteState | brand、选中色、当前选中色、色库标签、调色引擎 | 是 |
| rendererState | 预览渲染单元、色号/网格显示开关、编辑器显示偏好(editorPrefs) | 是 |
| viewportState | 预览缩放、编辑器缩放、平移、fit 模式（未来 Navigator/Minimap） | 是 |
| editorState | 当前工具、浮动/选区/参考、撤销栈、拼装/播放态 | 是 |
| pageExportState | 导出类型、预览/图纸导出设置（页边距/纸张/分页等后续扩充） | 是 |
| metaState | **扩展**：旧 state 里 UI 面板态 / 会话态 / 状态标志（livePreview、isProcessingImage、isPainting、lastGenerationError、ui、status） | 否（用户 8 层未覆盖此类，单列成桶，Phase 3/4 可再归并） |

> 为什么有第 9 个 `metaState`：用户给的 8 层都是「画布/图案领域」状态，但 app.js 的旧 state 还携带
> UI 面板（activePanel）、会话（livePreviewTimer）、状态标志（dirty/generating/isProcessingImage）等字段，
> 它们无家可归。为不丢数据、不乱塞，单列 `metaState` 并标注，供 Phase 3/4 决定是否并入 editorState / 新建 sessionState。

## 2. 字段迁移表（共 92 个旧字段）

列说明：**旧字段** = app.js 里 `state.xxx`；**新命名空间 / 新字段** = store.js 中的落点；
**兼容方式** = 当前实现；**是否已迁移调用方** = 是否已有调用方改为 store API（Phase 2 全部 NO，符合「先并存」）；
**默认值** = store 初值（与旧 state 逐位一致；标注「动态」者为运行时赋值、初始 undefined）。

| 旧字段 | 新命名空间 | 新字段 | 兼容方式 | 是否已迁移调用方 | 默认值 |
| --- | --- | --- | --- | --- | --- |
| `state.sourceDataUrl` | sourceState | dataUrl | Proxy getter/setter | NO | "" |
| `state.sourceName` | sourceState | name | Proxy getter/setter | NO | "" |
| `state.sourceNaturalWidth` | sourceState | naturalWidth | Proxy getter/setter | NO | 0 |
| `state.sourceNaturalHeight` | sourceState | naturalHeight | Proxy getter/setter | NO | 0 |
| `state.processedSourceDataUrl` | sourceState | processedDataUrl | Proxy getter/setter | NO | "" |
| `state.sourceSafetyChecked` | sourceState | safetyChecked | Proxy getter/setter | NO | false |
| `state.grid` | patternState | grid | Proxy getter/setter | NO | [] |
| `state.stats` | patternState | stats | Proxy getter/setter | NO | [] |
| `state.width` | patternState | width | Proxy getter/setter | NO | 0 |
| `state.height` | patternState | height | Proxy getter/setter | NO | 0 |
| `state.editorGrid` | patternState | editorGrid | Proxy getter/setter | NO | [] |
| `state.generationOriginalGrid` | patternState | generationOriginalGrid | Proxy getter/setter | NO | null |
| `state.generationOptimizedGrid` | patternState | generationOptimizedGrid | Proxy getter/setter | NO | null |
| `state.showingOptimizedGrid` | patternState | showingOptimizedGrid | Proxy getter/setter | NO | true |
| `state.directPatternFile` | patternState | directPatternFile | Proxy getter/setter | NO | null |
| `state.pindoReport` | patternState | pindoReport | Proxy getter/setter | NO | null |
| `state.bgsReport` | patternState | bgsReport | Proxy getter/setter | NO | null |
| `state.pwReport` | patternState | pwReport | Proxy getter/setter | NO | null |
| `state.optimizerReport` | patternState | optimizerReport | Proxy getter/setter | NO | null |
| `state.smartReport` | patternState | smartReport | Proxy getter/setter | NO | undefined（动态）（运行时赋值） |
| `state.structuralTransitionReport` | patternState | structuralTransitionReport | Proxy getter/setter | NO | null |
| `state.structuralDetectionBaseline` | patternState | structuralDetectionBaseline | Proxy getter/setter | NO | null |
| `state.regionalBlockReport` | patternState | regionalBlockReport | Proxy getter/setter | NO | null |
| `state.chartUrl` | patternState | chartUrl | Proxy getter/setter | NO | "" |
| `state.previewUrl` | patternState | previewUrl | Proxy getter/setter | NO | "" |
| `state.paletteBudget` | patternState | paletteBudget | Proxy getter/setter | NO | null |
| `state.patternAdjustBase` | patternState | patternAdjustBase | Proxy getter/setter | NO | null |
| `state.patternAdjustPreviewGrid` | patternState | patternAdjustPreviewGrid | Proxy getter/setter | NO | null |
| `state.patternAdjustTarget` | patternState | patternAdjustTarget | Proxy getter/setter | NO | "editor" |
| `state.patternAdjustFrame` | patternState | patternAdjustFrame | Proxy getter/setter | NO | 0 |
| `state.gridAlignBase` | patternState | gridAlignBase | Proxy getter/setter | NO | null |
| `state.generationEngine` | processingState | generationEngine | Proxy getter/setter | NO | "v2.5" |
| `state.generationEngineLast` | processingState | generationEngineLast | Proxy getter/setter | NO | "" |
| `state.generationPreset` | processingState | generationPreset | Proxy getter/setter | NO | "auto" |
| `state.generationSampling` | processingState | generationSampling | Proxy getter/setter | NO | "auto" |
| `state.algorithmEngine` | processingState | algorithmEngine | Proxy getter/setter | NO | "current" |
| `state.algorithmEngineLast` | processingState | algorithmEngineLast | Proxy getter/setter | NO | "" |
| `state.generationMilliseconds` | processingState | generationMilliseconds | Proxy getter/setter | NO | undefined（动态）（运行时赋值） |
| `state.generationQuality` | processingState | generationQuality | Proxy getter/setter | NO | undefined（动态）（运行时赋值） |
| `state.productionGenerationOptions` | processingState | productionGenerationOptions | Proxy getter/setter | NO | undefined（动态）（运行时赋值） |
| `state.smartFeatures` | processingState | smartFeatures | Proxy getter/setter | NO | undefined（动态）（运行时赋值） |
| `state.pwPaletteMatchMode` | processingState | pwPaletteMatchMode | Proxy getter/setter | NO | "ciede2000" |
| `state.pwOptions` | processingState | pwOptions | Proxy getter/setter | NO | null |
| `state.pwHybridOptions` | processingState | pwHybridOptions | Proxy getter/setter | NO | null |
| `state.importMode` | processingState | importMode | Proxy getter/setter | NO | "photo" |
| `state.autoProcessAfterLoad` | processingState | autoProcessAfterLoad | Proxy getter/setter | NO | false |
| `state.restoreAutoSizePending` | processingState | restoreAutoSizePending | Proxy getter/setter | NO | false |
| `state.generationLongEdge` | processingState | generationLongEdge | Proxy getter/setter | NO | 0（0 = 未解析） |
| `state.generationRequestId` | processingState | generationRequestId | Proxy getter/setter | NO | 0 |
| `state.importApproved` | processingState | importApproved | Proxy getter/setter | NO | false |
| `state.manualEdited` | processingState | manualEdited | Proxy getter/setter | NO | false |
| `state.backgroundDecision` | processingState | backgroundDecision | Proxy getter/setter | NO | "" |
| `state.sourceTransform` | processingState | sourceTransform | Proxy getter/setter | NO | {…} |
| `state.safetyModel` | processingState | safetyModel | Proxy getter/setter | NO | null |
| `state.safetyModelLoading` | processingState | safetyModelLoading | Proxy getter/setter | NO | null |
| `state.safetyModelUnavailable` | processingState | safetyModelUnavailable | Proxy getter/setter | NO | false |
| `state.selectedBrand` | paletteState | brand | Proxy getter/setter | NO | "mard" |
| `state.selectedColor` | paletteState | selectedColor | Proxy getter/setter | NO | null |
| `state.currentSelectedColor` | paletteState | currentSelectedColor | Proxy getter/setter | NO | null |
| `state.paletteLabel` | paletteState | label | Proxy getter/setter | NO | "" |
| `state.paletteEngine` | paletteState | engine | Proxy getter/setter | NO | null |
| `state.previewRenderCell` | rendererState | previewRenderCell | Proxy getter/setter | NO | 8 |
| `state.previewDetailCodesVisible` | rendererState | previewDetailCodesVisible | Proxy getter/setter | NO | false |
| `state.previewModalUsesCurrentGrid` | rendererState | previewModalUsesCurrentGrid | Proxy getter/setter | NO | false |
| `state.editorPrefs` | rendererState | prefs | Proxy getter/setter | NO | {…} |
| `state.previewZoom` | viewportState | previewZoom | Proxy getter/setter | NO | 1 |
| `state.editorZoom` | viewportState | editorZoom | Proxy getter/setter | NO | 1 |
| `state.editorTool` | editorState | tool | Proxy getter/setter | NO | "pencil" |
| `state.editorFloating` | editorState | floating | Proxy getter/setter | NO | null |
| `state.editorSelection` | editorState | selection | Proxy getter/setter | NO | null |
| `state.activeEditorSelection` | editorState | activeSelection | Proxy getter/setter | NO | null |
| `state.editorReferenceImage` | editorState | referenceImage | Proxy getter/setter | NO | null |
| `state.editorReference` | editorState | reference | Proxy getter/setter | NO | null |
| `state.referenceUndo` | editorState | referenceUndo | Proxy getter/setter | NO | [] |
| `state.currentPaintAction` | editorState | currentPaintAction | Proxy getter/setter | NO | [] |
| `state.paintUndo` | editorState | paintUndo | Proxy getter/setter | NO | [] |
| `state.replaceUndo` | editorState | replaceUndo | Proxy getter/setter | NO | [] |
| `state.lastPaintKey` | editorState | lastPaintKey | Proxy getter/setter | NO | "" |
| `state.assemblyMode` | editorState | assemblyMode | Proxy getter/setter | NO | false |
| `state.assemblyHighlightCode` | editorState | assemblyHighlightCode | Proxy getter/setter | NO | "" |
| `state.assemblyHistoryActive` | editorState | assemblyHistoryActive | Proxy getter/setter | NO | false |
| `state.assemblyHideCellText` | editorState | assemblyHideCellText | Proxy getter/setter | NO | false |
| `state.playActiveCode` | editorState | playActiveCode | Proxy getter/setter | NO | "" |
| `state.playCompletedBeads` | editorState | playCompletedBeads | Proxy getter/setter | NO | new Set() |
| `state.playStorageKey` | editorState | playStorageKey | Proxy getter/setter | NO | "" |
| `state.playHoverRow` | editorState | playHoverRow | Proxy getter/setter | NO | "" |
| `state.playHoverCol` | editorState | playHoverCol | Proxy getter/setter | NO | "" |
| `state.livePreviewTimer` | metaState | livePreviewTimer | Proxy getter/setter | NO | 0 |
| `state.livePreviewPending` | metaState | livePreviewPending | Proxy getter/setter | NO | false |
| `state.isProcessingImage` | metaState | isProcessingImage | Proxy getter/setter | NO | false |
| `state.isPainting` | metaState | isPainting | Proxy getter/setter | NO | false |
| `state.lastGenerationError` | metaState | lastGenerationError | Proxy getter/setter | NO | undefined（动态）（运行时赋值） |

## 3. EXTERNAL：`state/project-store.js`（已知残留双源，待 Phase 3/4 收口）

`ui/workspace.js` 使用的是 `state/project-store.js` 导出的 `projectStore` —— 一套与 app.js 旧 state
**独立、互不通信**的 12 命名空间副本：
`project / source / canvas / palette / generation / view / reference / editor / exportSettings / stats / ui / status`。
它与本 store 目前是两棵不互通的树，属于**既有双源**。

Phase 2 **不动它**（改它 = 动 workspace.js 的 UI 行为，违反「不改 UI 行为」）。收口计划放在 Phase 3/4：
把 `createProjectStore` 重写为本 store 的适配层（保持 `getState/setState/subscribe` API 不变），
并把 `generation` 命名空间的「真正可调处理参数」并入 `processingState`。

其中尤其要留意：`projectStore.generation` 持有**可调处理参数**，它们【不在】 app.js 的旧 state 里，
故不出现在第 2 节，而是本 Phase 2 的「未覆盖」目标：

| projectStore 字段 | 含义 | 应归入 |
| --- | --- | --- |
| generation.maxColors | 最大色数 | processingState.maxColors |
| generation.detailProtection | 细节保护强度 | processingState.detailProtection |
| generation.edgeProtection | 边缘保护强度 | processingState.edgeProtection |
| generation.cleanupStrength | 清理强度 | processingState.cleanupStrength |
| generation.preserveHighlights | 高光保护 | processingState.preserveHighlights |
| generation.preserveEyes | 眼睛保护 | processingState.preserveEyes |
| generation.preserveMicroDetails | 微细节保护 | processingState.preserveMicroDetails |
| generation.backgroundRemoval | 背景移除 | processingState.backgroundRemoval |
| generation.brightness/contrast/saturation | 亮度/对比度/饱和度 | processingState（与 sourceTransform 合并） |
| generation.sampling / preset / engine / algorithm | 采样/预设/引擎/算法 | processingState |
| canvas.width / canvas.height | 图纸尺寸 | patternState.width/height（注意与 app.js state.width/height 是两套，需统一） |
| view.mode / view.zoom / view.showGrid / view.showCodes | 视图模式/缩放/网格 | viewportState / rendererState |
| editor.tool / editor.brushSize / editor.history | 工具/笔刷/历史 | editorState |

> 这些字段**不计入**下文「未迁移调用点」（因为它们从未走 app.js 的 `state`，而是走 projectStore）。
> Phase 3/4 收口时，第 2 节与本节的字段才会真正汇流到同一份数据。

## 4. UNCLASSIFIED

**无。** app.js 全部的 92 个 `state.xxx` 字段已全部归类（含 6 个运行时动态赋值字段：
`generationMilliseconds / generationQuality / productionGenerationOptions / smartFeatures / smartReport / lastGenerationError`，
分别归入 processingState / patternState / metaState，初始值 undefined，与旧代码一致）。
未发现「无法明确归类」的字段，故无 UNCLASSIFIED 项。

## 5. 未迁移调用点（Phase 2 预期状态）

- app.js 中 `state.` 共出现 **956 次**，跨 **92 个不同字段**，全部仍经兼容层 Proxy 读写（即 **0** 个调用方被改为 store API）。
- 这是 Phase 2 的设计意图：「先让新旧代码并存，等 Phase 3/4 再逐步迁 UI」。
- 迁移判据：当某调用方改为 `libmsStore.patchState(...)` / `libmsStore.subscribe(...)` 时，从本表第 2 节对应行划掉「是否已迁移」为 YES。
- 注意 `state.projectStore` 相关字段（第 3 节）不在此计数内。

## 6. 契约保持（均未触动）

- 工程文件 `format: "libms-project"` v1 ✔
- 工程文件导入 / 导出路径 ✔（状态层经 Proxy 透传，导出读取 `state.width/height/grid` 看到同一份数据）
- pattern 矩阵宽高强校验 ✔（校验逻辑在 app.js，未改）
- 现有颜色算法结果 ✔
- 色卡跨卡兜底 ✔
- 现有 605 个（源码）旧测试全部继续通过 ✔（全量 `node --test`：642 通过 / 0 失败 / 1 跳过，含本 Phase 2 新增 16 个状态层测试）
- 当前编辑器行为 ✔
- 当前移动端工具坞行为 ✔（见 VERIFY.md 第七节）

---
生成自 `state/store.js` 的 LEGACY_MAP / DEFAULTS，避免手抄漂移。
