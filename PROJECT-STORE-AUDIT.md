# PROJECT-STORE-AUDIT.md — Phase 3A：覆盖审计 + 统一 Schema 设计

> **Phase 3B 最终决策（2026-09-24）**：实施阶段经现有默认值与生命周期测试确认，
> `canvas.width/height/beadSize/lockAspectRatio` 作为“下一次生成的目标画布设置”统一保留在
> `canvasState`；`patternState.width/height` 仍表示“已经生成的图纸结果”。两者暂不合流，
> 避免把默认 50 的生成入参与默认 0 的结果尺寸重新变成双写状态。
> `status.generationError` 保持运行时动态字段，默认不创建该键；首次生成失败时才写入。
> 本说明覆盖下文 Phase 3A 设计稿中关于将这几个 canvas 字段并入 `patternState` 的早期建议。

> 阶段纪律：Phase 3A **不改 `workspace.js`、不删 `projectStore`、不改算法/导出/工具栏**。
> 只做：覆盖审计、Schema 提取、归属设计、语义冲突分析、补行为快照测试。
> 全部证据带 `文件:行号`，不从名称猜测。

---

## 0. 结论摘要

| 项 | 结论 |
|---|---|
| `workspace.js` 是否被测试加载 | **否**。仅 `app.js:882` 动态 `import()`，测试零加载 |
| 改造前 projectStore 字段覆盖 | 12 个命名空间里，仅约 **14 个字段** 有测试触及 |
| 零保护且被高频写入的块 | **`editor.*`（写 35 次）**、**`ui.*`（写 19 次）** —— 改造前完全裸奔 |
| 本次新增 | **28 条行为快照测试**（`tests/ui-refactor-baseline/project-store-snapshot.test.mjs`），全部通过 |
| 发现的语义陷阱 | ① `setState` 只合并一层，命名空间内**子对象整体替换**（`exportSettings.pattern` 会丢字段）<br>② `maxColors` 名字在 `palette`，语义是**生成参数**<br>③ `canvas.width/height` 是**图纸逻辑格数**，不是像素/视口尺寸 |
| 运行时动态字段（不在 defaults） | `generation.subjectCrop / autoBackground / strokeProtection / accentProtection`；`status.generationError` |
| 建议新增命名空间 | `referenceState` / `statusState` / `uiState` / `documentState`；并把 Phase 2 的 `metaState` 拆掉 |
| Phase 3B 准入 | 本报告 + 快照测试全绿（已满足） |

---

## 1. 覆盖审计（要求 1）

### 1.1 谁真正使用了 projectStore

| 使用者 | 位置 | 说明 |
|---|---|---|
| `state/project-store.js` | 定义处 | 12 命名空间 + `createProjectStore(seed)` |
| `ui/workspace.js` | `ui/workspace.js:1` 引入；`ui/workspace.js:24` 绑定；全文读写 | **唯一运行时 UI 消费者** |
| `services/generation-service.js` | 接收 `store` 参数（`:4/:7/:8/:11/:12/:13/:17/:25`） | 读 `generation/canvas/palette`，写 `canvas/palette/stats/status` |
| 测试 6 个文件 | `project-store.test.mjs`、`v2-isolation`、`production-workspace`、`phase3-editor`、`batch-a-rotate-export`、`ui-module-integration` | 直接 import project-store，**不经 workspace.js** |

### 1.2 `workspace.js` 是否被测试经过：**否**

全项目检索 `workspace.js` 的加载点，只有：

- `app.js:882`：`import("./ui/workspace.js?v=20260922-pixler").then(({ mountWorkspace }) => mountWorkspace(...))`

即 **workspace.js 只在浏览器里被 app.js 动态加载，Node 测试从不加载它**。
这意味着：workspace.js 里对 projectStore 的 **35 次 editor 写 + 19 次 ui 写 + 12 次 view 写**，
在改造前**没有任何一层测试兜底**。Phase 3B 一旦改错，Node 全绿也会在浏览器里炸。
→ 这就是必须先写快照测试（要求 7）的原因。

### 1.3 改造前各命名空间的实际测试覆盖

有测试触及的字段（共约 14 个）：

- `project-store.test.mjs`：`palette.maxColors`、`palette.id`、`canvas.width`、`stats.totalBeads`、`view.showCodes`、`exportSettings.preview.showCodes`
- `ui-module-integration.test.mjs`：`canvas.width`、`generation.detailProtection`、`generation.preserveEyes`、`generation.sampling`、`palette.maxColors`
- `v2-isolation.test.mjs`：`palette.maxColors`、`generation`（引擎隔离）
- `production-workspace.test.mjs`：`status.generating`、`status.hasPattern`
- `batch-a-rotate-export.test.mjs`：`exportSettings.pattern`、`reference`

**零覆盖**：`editor.*` 全部、`ui.*` 全部、`source.*`、`project.*`、`palette.usedColors`、
`canvas.height/beadSize/lockAspectRatio`、`view.mode/showGrid/zoom/panX/panY/codeVisibilityThreshold`、
`stats.usedColors/colors`、`status.dirty/hasSource/generationError`、
`generation` 的大部分（engine/algorithm/preset/edgeProtection/cleanupStrength/preserveHighlights/preserveMicroDetails/backgroundRemoval/brightness/contrast/saturation 及 4 个动态字段）。

---

## 2. Coverage Matrix（要求 2）

`workspace.js 使用字段` 取自对 `ui/workspace.js` 的 `setState` / `get()` 全量扫描。
写入次数：editor 35、ui 19、view 12、status 7、reference 5、generation 4、canvas 2、project 1、exportSettings 1
（`source`/`palette`/`stats` 由 `generation-service.js` 写入，见 `:152/:154/:155/:162/:164`）。

| projectStore 字段 | workspace.js 使用 | 改造前覆盖 | 风险 | 迁移优先级 |
|---|---|---|---|---|
| `editor.tool` | 多处读写（`:171/:176/:382/:420`…） | **uncovered** | **high**（最常写，零保护） | Phase 3B |
| `editor.selection` | 15 处读 + 多处写（`:384/:399/:408/:427/:436`） | **uncovered** | **high** | Phase 3B |
| `editor.selectedCell` | 读 2 + 写多处（`:382/:399/:408/:420/:425/:427`） | **uncovered** | **high** | Phase 3B |
| `editor.hoveredCell` | 写 `:444`，清空 `:171/:176` | **uncovered** | medium | Phase 3B |
| `editor.shapePreview` | 写 `:365/:452` | **uncovered** | medium | Phase 3B |
| `editor.selectedColor` | 读 10 次（`:402/:409/:420`） | **uncovered** | **high** | Phase 3B |
| `editor.highlightedColor` | 读 `:444`，清空 `:171` | **uncovered** | medium | Phase 3B |
| `editor.history`（canUndo/canRedo） | 写 `:146` | **uncovered** | medium | Phase 3B |
| `editor.brushSize / wandTolerance / shapeFilled / paletteCategory / recentColors` | 各 2–3 处读 | **uncovered** | medium | Phase 3B |
| `editor.clipboard` | 无 workspace 使用（仅 schema 存在） | **uncovered** | low | Phase 3B |
| `view.mode` | 读 3 + 写 `:202/:270` | **uncovered** | **high**（决定渲染分支） | Phase 3B |
| `view.showGrid` | 写 `:268` | **uncovered** | medium | Phase 3B |
| `view.showCodes` | 写 `:269` | covered（`project-store.test.mjs`） | low | Phase 3B |
| `view.zoom / panX / panY` | 读（`:2/:1/:1`） | **uncovered** | medium | Phase 3B |
| `view.codeVisibilityThreshold` | 无 workspace 使用 | **uncovered** | low | Phase 3B |
| `canvas.width` | 写 `:33`（104）+ gen-service `:18`；读 `:1` | covered | **high**（生成入参） | **Phase 3B 首批** |
| `canvas.height` | 写 `:33` + gen-service `:18`；读 2 | **uncovered** | **high** | **Phase 3B 首批** |
| `canvas.beadSize` | 写 `:252` | **uncovered** | medium（物理尺寸，非视口） | Phase 3B |
| `canvas.lockAspectRatio` | 写 `:33` | **uncovered** | low | Phase 3B |
| `palette.maxColors` | gen-service `:13` 读取为生成入参；写 `:154` | covered | **high**（语义错位，见 §5） | **Phase 3B 首批** |
| `palette.id` | 写 `:154` | covered | medium | Phase 3B |
| `palette.usedColors` | 写 `:154` | **uncovered** | medium | Phase 3B |
| `generation.detailProtection` | 写 `:225` | covered | **high**（算法参数） | Phase 3B |
| `generation.engine / algorithm` | 写 `:33/:238/:243/:248`；读 `:1/:1` | covered（部分） | **high** | Phase 3B |
| `generation.preset / sampling` | 写 `:225` | covered（sampling） | **high** | Phase 3B |
| `generation.edgeProtection / cleanupStrength / preserveHighlights / preserveMicroDetails / backgroundRemoval / brightness / contrast / saturation` | 写 `:225` | **uncovered** | **high**（直连算法结果） | Phase 3B |
| `generation.subjectCrop / autoBackground / strokeProtection / accentProtection` | 写 `:225`（**动态字段，不在 defaults**） | **uncovered** | **high** | Phase 3B |
| `reference.url / opacity / fit / visible` | 写 `:614/:617/:618/:622/:624` | covered（部分） | medium | Phase 3B |
| `source.image / width / height` | 写 `:152/:162` | **uncovered** | medium | Phase 3B |
| `stats.totalBeads` | 写 `:155` | covered | low | Phase 3B |
| `stats.usedColors / colors` | 写 `:155/:164` | **uncovered** | medium | Phase 3B |
| `ui.activePanel` | 写 19 处（`:200/:261/:325/:329/:382/:399/:402/:408/:409/:412/:420/:425/:427`） | **uncovered** | **high**（驱动整个 inspector 面板） | Phase 3B |
| `ui.inspectorOpen / exportDrawerOpen` | 写 `:264/:265` | **uncovered** | medium | Phase 3B |
| `status.generating / hasPattern` | gen-service `:4/:21/:25` | covered | medium | Phase 3B |
| `status.dirty / hasSource` | 写 `:169/:203/:238/:243` + gen-service `:21` | **uncovered** | medium | Phase 3B |
| `status.generationError` | 写 `:174/:248/:250`（**动态字段**） | **uncovered** | medium | Phase 3B |
| `project.name / id` | 写 `:203` | **uncovered** | low | Phase 3B |
| `exportSettings.pattern.*` | 写 `:267` | covered | medium | Phase 3B |
| `exportSettings.type / preview.*` | 无 workspace 写 | covered（`preview.showCodes`） | low | Phase 3B |

> 风险口径：**high** = 改错会直接改变生成结果 / 主交互分支 / 大面积 UI；
> **medium** = 改错影响局部显示或单个面板；**low** = 当前无人使用或影响面很小。

---

## 3. projectStore 完整真实 Schema（要求 3）

来源：`state/project-store.js` defaults + `ui/workspace.js` 读写 + `services/generation-service.js` + 现有测试。
标注 **（动态）** 者 = **不在 defaults 里**，由运行时写入，必须纳入 schema 否则 Phase 3B 会丢字段。

```js
project:   { id: null, name: "未命名作品" }
source:    { image: null, width: 0, height: 0 }
canvas:    { width: 50, height: 50, lockAspectRatio: false, beadSize: 2.6 }
palette:   { id: "mard-221", maxColors: 0, usedColors: 0 }
generation:{ engine: "v2.5", algorithm: "current", preset: "auto", sampling: "auto",
             detailProtection: 70, edgeProtection: 70, cleanupStrength: 50,
             preserveHighlights: true, preserveEyes: true, preserveMicroDetails: true,
             backgroundRemoval: false, brightness: 0, contrast: 0, saturation: 0,
             /* 动态 */ subjectCrop, autoBackground, strokeProtection, accentProtection }
view:      { mode: "blocks", zoom: 1, panX: 0, panY: 0,
             showGrid: false, showCodes: false, codeVisibilityThreshold: 16 }
reference: { url: "", opacity: 40, fit: "contain", visible: true }
editor:    { tool: "select", hoveredCell: null, selectedCell: null, selectedColor: null,
             highlightedColor: null, selection: null, paletteCategory: "all",
             recentColors: [], brushSize: 1, shapeFilled: false, wandTolerance: 12,
             shapePreview: null, clipboard: null,
             history: { canUndo: false, canRedo: false } }
exportSettings:{ type: "preview",
                 preview: { showGrid: false, showCodes: false },
                 pattern: { showGrid: true, showCodes: true, showCoordinates: true } }
stats:     { totalBeads: 0, usedColors: 0, colors: [] }
ui:        { activePanel: "project", inspectorOpen: true, exportDrawerOpen: false }
status:    { generating: false, dirty: false, hasSource: false, hasPattern: false,
             /* 动态 */ generationError }
```

### 3.1 必冻结的两条语义（快照测试已钉死）

1. **`setState` 只合并一层**：顶层命名空间浅合并，但**命名空间内的子对象整体替换**。
   - 例：`setState({ exportSettings: { pattern: { showGrid: false } } })` 会让
     `pattern.showCodes` 变成 `undefined`（被替换掉，不是深合并）。
   - 这正是 `ui/workspace.js:267` 写 `{ ...get().exportSettings.pattern, [field]: checked }`
     手动展开的原因 —— 作者在绕开这个语义。
   - `editor.history` 同理（`:146` 每次都同时写 canUndo+canRedo）。
   - **Phase 3B 的 adapter 必须复刻**，否则导出面板开关与撤销按钮状态会静默丢失。
2. **数组整体替换**：`editor.recentColors`、`stats.colors` 是替换不是合并。

---

## 4. 归属设计（要求 4）

### 4.1 `editor.*` → `editorState`

| 原字段 | 新字段 | 备注 |
|---|---|---|
| `editor.tool` | `editorState.tool` | 与 app.js `state.editorTool` 同源，合并 |
| `editor.selection` | `editorState.selection` | 与 `state.editorSelection` 同源 |
| `editor.selectedCell` | `editorState.selectedCell` | 新增（app.js 侧无对应） |
| `editor.hoveredCell` | `editorState.hoveredCell` | 新增 |
| `editor.shapePreview` | `editorState.shapePreview` | 新增 |
| `editor.highlightedColor` | `editorState.highlightedColor` | 新增 |
| `editor.selectedColor` | `paletteState.selectedColor` | **归调色板**（与 `state.selectedColor` 同源），不是 editor |
| `editor.history` | `editorState.history` | 保留子对象（canUndo/canRedo） |
| `editor.brushSize / wandTolerance / shapeFilled / paletteCategory / recentColors / clipboard` | `editorState.*` | 新增 |

### 4.2 `view.*` → 拆到 `rendererState` 与 `viewportState`（不塞一处）

| 原字段 | 新归属 | 理由 |
|---|---|---|
| `view.mode`（blocks/pattern…） | **`rendererState.mode`** | 决定"怎么画"，是渲染模式 |
| `view.showGrid` / `view.showCodes` / `view.codeVisibilityThreshold` | **`rendererState.*`** | 显示开关，属渲染；与 Phase 2 的 `rendererState.prefs` 合并 |
| `view.zoom` | **`viewportState.zoom`** | 视口变换。注意 app.js 侧有 `previewZoom`/`editorZoom` 两套，见 §5 |
| `view.panX` / `view.panY` | **`viewportState.panX/panY`** | 视口平移 |

### 4.3 `canvas.*` → **必须分开，禁止全塞 viewportState**

先区分四种"尺寸/大小"，它们在 projectStore 里只暴露了两种：

| 概念 | projectStore 中是否存在 | 归属 |
|---|---|---|
| **图纸逻辑尺寸**（豆图格数，如 104×78） | **有**：`canvas.width/height` | **`patternState.width/height`** |
| **canvas 渲染尺寸**（像素） | **不存在**（运行时由 `逻辑尺寸 × beadSize × zoom` 推导） | 不存，由渲染层计算 |
| **视口尺寸**（可视区像素） | **不存在**（DOM 决定） | 不存 |
| **beadSize**（单颗豆物理尺寸 mm） | **有**：`canvas.beadSize` | **`patternState.beadSize`**（图纸物理规格，非视口） |
| `lockAspectRatio` | **有** | **`patternState.lockAspectRatio`** |

结论：`canvas` 这个命名空间名是**误导性的**——它装的是"图纸逻辑尺寸 + 物理规格"，
与"canvas 渲染/视口"无关。Phase 3B 应拆散并**废弃 `canvas` 名**，保留兼容 alias。

### 4.4 `generation.*` → `processingState`

全部 13 个 + 4 个动态字段 → `processingState.*`。
其中 `engine/algorithm/preset/sampling` 与 app.js 的
`generationEngine/algorithmEngine/generationPreset/generationSampling` **语义对应**，应合并为同一字段。
`brightness/contrast/saturation` 与 `sourceTransform` 的同名字段**语义不同**（见 §5.3），暂不合并。

### 4.5 `palette.*` → `paletteState` / `processingState`，**`palette.maxColors` 语义重复检查**

| 原字段 | 语义 | 归属 | 说明 |
|---|---|---|---|
| `palette.id` | 当前色库标识 | **`paletteState.id`** | 与 app.js `selectedBrand` 相关但不同粒度，暂并存 |
| `palette.maxColors` | **生成时的最大色数量化上限**（0=自动/不限） | **`processingState.maxColors`** | **语义错位**：名字在 palette，实际是生成参数，被 `generation-service.js:13` 当生成入参。**必须迁移 + 保留 `palette.maxColors` alias** |
| `palette.usedColors` | 生成结果里实际用到的颜色数 | **`statsState.usedColors`** | 是结果统计，不是调色板属性 |

### 4.6 其余

| 原命名空间 | 新命名空间 | 备注 |
|---|---|---|
| `reference.*` | **`referenceState`**（新增） | 与 Phase 2 `metaState` 无重叠，直接新建 |
| `status.*` | **`statusState`**（新增） | 含动态 `generationError` |
| `ui.*` | **`uiState`**（新增） | 含 `activePanel/inspectorOpen/exportDrawerOpen` |
| `project.*` | **`documentState`**（新增） | 作品 id/name；Phase 2 无对应 |
| `source.*` | **`sourceState`** | `image` ↔ `sourceState.dataUrl`；`width/height` ↔ `naturalWidth/naturalHeight` |
| `stats.*` | **`statsState`**（新增，或并入 patternState） | 生成结果统计 |
| `exportSettings.*` | **`pageExportState`** | 形状已与 Phase 2 的 `pageExportState` 一致（type/preview/pattern） |

### 4.7 Phase 2 `metaState` 的处置

Phase 2 我把 UI/状态类字段临时塞进了 `metaState`（含 `ui`、`status` 子对象）。
本阶段明确后应**拆掉 `metaState`**：
- `metaState.ui` → `uiState`
- `metaState.status` → `statusState`
- `metaState.livePreviewTimer / livePreviewPending / isProcessingImage / isPainting` → `statusState.*`（均为状态标志）

---

## 5. 语义冲突表（要求 5）

### 5.1 width / height 家族

| 字段 | 真实语义 | 证据 |
|---|---|---|
| app.js `state.width/height` | **图纸逻辑格数**（最终豆图宽高） | 存于 `patternState.width/height`（Phase 2）；导出/矩阵校验读它 |
| `projectStore.canvas.width/height` | **图纸逻辑格数**（生成入参 + 生成结果回写） | `generation-service.js:11-12` 传给 `bridge.generate({width, height})`；`:18` 用 `result.width/height` 回写 |
| pattern width/height | 同上（就是图纸逻辑尺寸） | — |
| `source.width/height` | **原图自然像素尺寸** | `workspace.js:152/:162` |
| preview width/height | **不存在于 projectStore** | 预览尺寸由 `逻辑尺寸 × beadSize × zoom` 推导，未存储 |
| `view.zoom` | 视口缩放倍率 | 与上述均不同 |

**判定**：app.js `state.width/height` 与 `projectStore.canvas.width/height`
**语义相同（都是图纸逻辑格数）**，可合并为 `patternState.width/height`。
但两者目前是**两套互不相通的副本**，合并会让 workspace 与 app.js 首次共享同一份尺寸
——这是正确方向，但属于**行为耦合变更**，Phase 3B 必须：
- 合并为单一 `patternState.width/height`；
- 保留 `canvas.width/height` 作为 alias 读写同一份数据；
- 用快照测试验证合并前后 `generation-service` 拿到的入参不变。

`canvas.beadSize` **不得**进 viewportState（它是物理规格），归 `patternState.beadSize`。

### 5.2 maxColors 家族

| 字段 | 是否存在 | 真实语义 |
|---|---|---|
| `projectStore.palette.maxColors` | **存在** | **生成时的最大色数上限**，0 = 自动/不限。被 `generation-service.js:13` 当生成入参传给 bridge |
| `projectStore.generation.maxColors` | **不存在** | 已在快照测试中钉死：`generation` 命名空间无此键 |
| `processingState.maxColors`（Phase 3B 目标） | 待建 | 承接 `palette.maxColors` 的语义 |

**判定**：只有一个真实来源（`palette.maxColors`），但**名字与语义错位**——
它叫 palette，干的却是 processing 的活。
处理：**迁移到 `processingState.maxColors`，保留 `palette.maxColors` 作为 alias**
（因为 `generation-service.js:13` 与 `ui-module-integration.test.mjs` 都直接读它，
Phase 3B 不动这些调用方，alias 必须继续可读可写）。

### 5.3 其它需留意的同名/近名

| 字段对 | 语义差异 | 处置 |
|---|---|---|
| `generation.brightness/contrast/saturation` vs `processingState.sourceTransform.brightness/contrast/saturation` | 前者是**生成算法**的调色参数；后者是**源图预处理**的调整。同名但作用阶段不同 | **不合并**。分别存 `processingState.colorTuning.*` 与 `processingState.sourceTransform.*`，并重命名前者避免混淆 |
| `palette.usedColors` vs `stats.usedColors` | 同一结果被写到两处（`:154`/`:155` 与 `:19`/`:20`） | 合并为 `statsState.usedColors`，`palette.usedColors` 保留 alias |
| `view.showCodes` vs `exportSettings.preview.showCodes` vs `exportSettings.pattern.showCodes` | 三处**彼此独立**的开关（既有测试专门钉过"view 与 export preview 独立"） | **必须保持三份独立**，禁止合并 |
| app.js `previewZoom` / `editorZoom` vs projectStore `view.zoom` | app.js 有两套缩放（预览/编辑器），projectStore 只有一套 `view.zoom` | Phase 3B 先各自保留（`viewportState.previewZoom/editorZoom/zoom`），Phase 3C 再统一；**不在此刻强行合并** |

---

## 6. 缺失测试 → 已补齐（要求 7）

改造前零保护、本次已冻结的字段（28 条快照，全绿）：

`editor.tool` ✅、`editor.selection` ✅、`editor.selectedCell` ✅、`editor.hoveredCell` ✅、
`editor.shapePreview` ✅、`editor.selectedColor` ✅、`editor.highlightedColor` ✅、`editor.history` ✅、
`view.mode` ✅、`view.showGrid` ✅、`canvas.width` ✅、`canvas.height` ✅、`canvas.beadSize` ✅、
`generation.maxColors`（= `palette.maxColors`，并钉死 generation **无**此键）✅、
`generation.detailProtection` ✅、`palette.id` ✅、`palette.maxColors` ✅、`palette.usedColors` ✅、
`reference.*` ✅、`status.generationError` ✅、`ui.activePanel` ✅、`source.*` ✅、`stats.*` ✅、
`project.*` ✅、`exportSettings.pattern` ✅；
并额外冻结：`setState` 合并语义、数组替换语义、**子对象整体替换陷阱**、subscribe/unsubscribe 语义、
`createProjectStore(seed)` 语义。

未覆盖（当前无人使用，风险 low，Phase 3B 顺带）：
`editor.clipboard`、`view.codeVisibilityThreshold`、`exportSettings.type`、`ui.inspectorOpen`。

---

## 7. Phase 3B 准入与约束（要求 9 / 10）

**准入**：本报告 + `project-store-snapshot.test.mjs` 28/28 + 全量套件全绿 → **已满足**。

Phase 3B 要做的事：
1. `libmsStore` schema 扩容，承接 §4 的全部字段（含 5 个动态字段）。
2. `project-store.js` 改为**纯 adapter**：`getState/setState/subscribe` 全部代理 `libmsStore`。
3. **硬约束**：`projectStore` 自己**不得持有任何 backing state**——
   不是两份、不是同步、不是镜像、不是定时复制。最终真实状态源数量 = **1**。
4. adapter 必须复刻 §3.1 的两条语义（一层合并 + 子对象整体替换 + 数组替换）。
5. **不动 `workspace.js`**：保持 `workspace.js → projectStore API → libmsStore`。
6. Phase 3B 完成后，本快照测试应**原样全部继续通过**；变红即说明行为被改，必须停下来查。

Phase 3C 才把 `workspace.js` 逐步改成直接调 store API。

---

## 8. 测试结果

| 项 | 结果 |
|---|---|
| 新增快照测试 `project-store-snapshot.test.mjs` | **28 / 28 通过** |
| 全量 `node --test`（根目录发现，含 `deploy/` 镜像） | **671 发现 / 670 通过 / 0 失败 / 1 跳过**，EXIT=0 |
| 与 Phase 2 收尾对账 | Phase 2 收尾 643 / 642 通过；本轮 **+28** 条快照 → 671 / 670 通过，差值完全吻合，**零回归** |
| `deploy-sync` 守卫 | 通过（本轮只新增 `*.test.mjs` 与根目录文档，二者均不在发布清单，故无漂移） |
| 代码改动 | **仅新增测试文件**；`workspace.js` / `project-store.js` / `state/store.js` / 算法 / 导出 / 工具栏 **均未改动** |

> 全量口径说明：从根目录跑 `node --test` 会把 `deploy/` 镜像副本也计入，故总数 671；
> 源码真实约 605（既有）+ 16（Phase 2 状态层）+ 28（本轮快照）。
