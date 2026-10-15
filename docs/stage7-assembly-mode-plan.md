# LIBMS Studio 阶段 7：拼制模式规划（Assembly Mode Plan）

> 生成时间：2026-10-15 · 阶段：7（七阶段计划末项「拼制规划」）
> 性质：**规划文档**。本阶段**不修改任何生产代码** —— 与阶段 0「审计」同型（产出文档、不改源码）。
> 本文件是拼制模式后续实施的**契约来源**：所有条目均来自本次实际取证（源码检索 + 测试运行），不沿用旧报告结论。

---

## 0. 为什么这一阶段只出文档

拼制模式牵动一条**跨模块契约**：`屏幕分区 ↔ 导出分板 ↔ 备料统计` 三者必须对同一个「块」有同一个定义。
本次取证发现这三处**目前是各算各的**（见 §3 G1），且已经产生了一处**用户可见的语义错误**（§3 G1-b）。
在这种状态下直接加功能，等于把不一致固化进新代码。

因此阶段 7 的产出是：**把契约定下来 + 把实施拆成可独立验收的小步**。实施属后续工作，不在本阶段。

---

## 1. 术语对齐（同名不同义是当前最大的沟通成本）

| 术语 | 本文件定义 | 代码位置 | 现状 |
|---|---|---|---|
| **拼制模式**（施工模式） | 屏幕上的「一次只拼一块、只放一色」视图 | `ui/workspace.js:3762-3905`，`body.ws-output-preview` | 已实现 |
| **区块**（block） | 拼制模式下把画布切成的 N 块之一，**纯屏幕概念**，与实体板无关 | `blockLayout()` `ui/workspace.js:3783` | 已实现 |
| **板**（board / 底板） | 实体拼豆底板，**有物理尺寸** | `index.html:419-424` 提供 52 / 78 / 104 | 三档并存 |
| **分板**（tile） | 按「板」把图纸切成可打印的若干张 | `services/pattern-split-service.js:4` | 已实现 |
| **施工图**（construction sheet） | 带表头 / 图例 / 标尺的可打印图纸 | `services/construction-sheet-layout.js` | 已实现 |
| **备料**（material） | 本作品用豆清单 + 底板数量 + 库存台账 | `ui/workspace.js:331-340` | 已实现 |

**当前代码里「区块」和「分板」是两套完全独立的实现，但 UI 上都被叫做「块」** —— 这是 G1 的根源。

---

## 2. 现状取证（逐条带证据）

### 2.1 屏幕侧：拼制模式（build mode）

| # | 能力 | 证据 | 状态 |
|---|---|---|---|
| B1 | 模式切换（快照 / 还原 `view`+`editor`+`ui.activePanel`） | `setWorkspaceMode()` `ui/workspace.js:3859-3883`；`buildActive()` = `body.classList.contains("ws-output-preview")` `:3777` | 已实现 |
| B2 | 分区数可调（1–64） | `build.count = Math.min(64, build.count + 1)` `:3891` | 已实现 |
| B3 | 按宽高比自动排布 cols×rows | `blockLayout()` `:3783-3793`：`cols = round(sqrt(n * w/h))`，再修正到 `cols*ceil(n/cols) ≥ n` | 已实现 |
| B4 | 建议块数（单块边长 ≤ ~30 格） | `advisedBlocks()` `:3809-3812`：`ceil(w/30) * ceil(h/30)`；文案 `:3897` | 已实现 |
| B5 | 区块选择（网格按钮 + 上/下块） | `renderBlockMap()` `:3814-3823`；`data-ws-block="prev/next"` `:3893-3894` | 已实现 |
| B6 | **区块内逐色引导**（当前区块用色 + 颗数 + 上/下色） | `blockColors()` `:3799-3807`；`renderBlockColors()` `:3824-3837`；`applyBuildColor()` `:3850-3858` | 已实现 |
| B7 | 画布区块高亮框 | `updateBuildOverlay()` `:3838-3849` → `#ws-build-spot` `:3768-3771` | 已实现 |
| B8 | 入口（3 处） | 右栏 side-tab `data-ws-panel="build"` `:775`；生成步进卡 step6「打开施工分区预览」`:973`；底栏 `#ws-output-preview` `:4103` | 已实现 |
| B9 | 拼制模式下禁止编辑（画布只允许 pan） | `:1542`（pointerdown 直接走 pan）、`:1910`（选区交互提前 return）、`:3524`（Esc 退出） | 已实现 |

**关键实现事实（决定了后续设计的自由度）**：区块与颜色的选择**不写 `state.grid`**，只作用在叠加层与 `editor.highlightedPaletteId`，所以撤销栈始终干净（源码注释 `:3762-3765` 明写）。

**关键缺陷**：`const build = { count: 1, cols: 1, rows: 1, block: 0, color: null, colors: [] }`（`:3766`）
是**闭包内的普通对象，不进 store、不落 localStorage**。逐项实测：

| 字段 | 退出再进入 | 刷新页面 |
|---|---|---|
| `count`（分区数） | **保留**（闭包存活，`setWorkspaceMode` 退出分支只清 `build.color` `:3880`） | 丢失（回 1） |
| `block`（当前块） | **丢失**（进入时强制 `build.block = 0` `:3871`） | 丢失（回 0） |
| `color`（当前色） | 丢失（进入 `:3871` 与退出 `:3880` 都清） | 丢失 |

即：**用户手选的分区数在刷新后回 1、当前块每次进入都回第 1 块** —— 中途停工后无法回到原处。

### 2.2 导出侧：分板与施工图

| # | 能力 | 证据 | 分块口径 |
|---|---|---|---|
| E1 | 「板型 ZIP」导出（总览 + 每板一张 PNG） | `export-v2-service.js:72-80` → `renderBoardOverview` / `renderBoardSheet`（`board-sheet-export.js:4,13`） | **固定 104×104**（`export-v2-service.js:71,73`） |
| E2 | 板型选择 UI | `ui/workspace.js:527` 文案即「**大型作品 · 104×104 板型分割**」；`:2405` 摘要；`:2406` 不需要分板时 `disabled` | 只有 104 一档 |
| E3 | 施工图版式（表头 5 项 + 色号图例 + 标尺） | `construction-sheet-layout.js:4`（layout）/`:15`（header：作品尺寸 / 拼豆数量 / 颜色数量 / 豆色品牌 / 图纸页数）/`:45`（rulers） | — |
| E4 | PDF 施工图 | `pdf-construction-sheet.js:15 drawPdfConstructionSheet` | — |
| E5 | **legacy「分版下载」**（另一条独立通路） | `index.html:419-424` `#tile-size-select` = **52 / 78 / 104 / 不分版**；`app.js:5935-5938` → `downloadSplitPattern(tileSize)` `:5957` → `splitGridIntoTiles` `:6034` | **用户可选 52 / 78 / 104** |
| E6 | A4 打印套 | `app.js:6069 splitGridIntoA4Pages`（按 A4 物理页面切） | A4 页，与板无关 |

### 2.3 备料与库存

| # | 能力 | 证据 | 分块口径 |
|---|---|---|---|
| M1 | 本作品用豆（色号 + 颗数） | `renderMaterial()` `ui/workspace.js:2517-2546`；`buildUsageEntries` | 整图，不分块 |
| M2 | 底板数量与实物厘米数 | `:2547-2553`，**复用 `exportV2.split()`** | **固定 104×104** |
| M3 | 库存台账（识别外部图纸 / 手工录入 / 补货 / CSV） | `ui/inventory-panel.js:38` `InventoryPanel`（`mount` / `openDetail` / `exportCsv` / `renderReplenish` / `renderSubmissions` / `renderItems`） | — |
| M4 | 材料面板按需计算（非当前 Tab 不算） | `:2520-2532` 与 `tests/material-tab-semantics.test.mjs` | — |

### 2.4 第二套实现：legacy 拼装播放器（`#assembly-modal`）—— 能力更强，但入口已断

本阶段取证最重要的发现：**「拼制」在代码里有两套并存实现**，而 §2.1 描述的那套（屏幕 build 模式）
**不是能力最强的那套**。

| # | 能力 | 证据（源码） |
|---|---|---|
| L1 | 打开入口 | `app.js:6412 openAssemblyPlayer()`；经 `window.LibmsWorkspaceBridge.openMaking` 暴露 |
| L2 | 逐格打点 | `app.js:6597 renderInteractiveBoard` · `:6685 handleAssemblyBoardClick` |
| L3 | 逐色清单 | `app.js:6517 renderAssemblyColorList` |
| L4 | **进度持久化**（load / save / reset） | `app.js:6492 getAssemblyStorageKey` · `:6502 loadAssemblyProgress` · `:6512 saveAssemblyProgress` · `:6700 resetAssemblyProgress` · `:6709 updateAssemblyProgressUi` |
| L5 | legacy 登记 | `ui/legacy-ui-policy.js:1-6` `LEGACY_DIALOG_IDS` 含 `assembly-modal` |

**真机实测（冻结快照，见 §2.5 A 组）—— 这套实现完全可用**：
弹窗能开（`1406×678`）· 逐色清单渲染出可点色号 · 交互棋盘渲染出 9 格 ·
点一格进度读数 `0 / 9 · 0%` → `1 / 9 · 11%` · 进度真的落进 `localStorage["libai-maker-assembly-<hash>"]`。

**但它在 v3 工作台里入口全断**（B 组实测，量 box 而非看存在性）：
`#ws-making`(0×0/hidden) · `#assembly-mode-button`(0×0) · `#start-assembly-button`(不存在) ·
`#start-assembly-panel-button`(不存在) · `#mobile-start-assembly-button`(0×0)；
全量扫描可见按钮文案，**没有任何一个可见控件**指向它（B2 = `[]`）。

→ **结论：G3「没有拼装进度」只在屏幕 build 模式下成立。进度能力本身早已实现，只是被 legacy 策略挡在入口之外。**
这直接决定 §4 的设计：**进度模型应当复用 L4 那套，而不是从零发明**（见 §4.6）。

### 2.5 真机取证汇总（CDP · 无头 Chrome · 冻结快照 `bf4a598`）

**为什么必须真机**：拼制能力**没有任何单测覆盖**。读源码只能看到 `$("#ws-making").hidden = true;` 一行，
看不到「能力本体是否还活着」，也看不到「两套实现的能力落差」。所以本阶段用 CDP 真机打开、真的点、真的量 box。

**取证口径**：为避免落在**正被并发改写的活工作区**上，快照用 `git archive bf4a598` 展开 + 实时预览服务（端口 8812）。
探针 `probe-assembly.mjs` 共 **22 条断言 → 22/22 PASS**，产物在 `outputs/stage7-assembly/`。
（原始 `git archive` 快照因 §10 所述缺件无法启动，取证时在快照上补入那 2 个文件后才运行 —— 这与拼制模式本身无关。）

| 组 | 断言 | 实测结果 |
|---|---|---|
| 就绪 | ① ② ③ | 进工作台 ✓ · 图纸就绪 ✓ · **先造出 9 颗豆**（空白图纸会让 A4/A5/A6 无法成立 —— 阶段 5 已记的坑） |
| **A 能力本体** | A1–A8 | `bridge.openMaking` 是函数 · 弹窗 `1406×678` · 三件套有 box（进度读数 `67×20` / 逐色清单 `251×56` / 棋盘 `1174×1174`）· 色号 1 个 · 棋盘 9 格 · 打点 `0/9 → 1/9` · localStorage 有 `libai-maker-assembly-6D178B28` · 可正常关闭 |
| **B 入口可达性** | B1–B4b | **全部已知入口不可达**（见 §2.4）· 无其它可见控件 · `#assembly-modal` 为 `data-legacy-ui=compat` · 台面入口 `#ws-export-now` 可见；开抽屉并切「打印与分板」后 `#ws-output-preview`（施工图预览 → build 模式）可达 |
| **C 两套实现** | C1–C4b | 已进 build 模式（`body.ws-output-preview`）· **build 模式无进度读数**（`hasProgressNode=false`）· 分板算术：104×104 作品 → **104 板=1 / 78 板=4 / 52 板=4**（G1-b 证据）· **期望块数 vs 实际块数不一致**（count 读数 `3` / 实际「第 1 / 4 块」）· 退出再进入 count `3→3` 但当前块 `第 2 块 → 第 1 块` · **整页刷新 count `3→1`**（G2 直接证据） |
| D 运行期 | D1 | 无 console 错误 / 未捕获异常 |

---

## 3. 缺口分析（每条都带证据与用户可见后果）

### G0 · 「拼制」有两套并存实现，能力更强的那套入口已断（本阶段新发现）

| 实现 | 位置 | 独有能力 | 入口 |
|---|---|---|---|
| 屏幕 build 模式 | `ui/workspace.js:227-241` / `:3762-3905` | 区块划分、逐色引导、画布高亮 | **可达**（3 处入口，B8） |
| legacy 拼装播放器 | `app.js:6412` `#assembly-modal` | **逐格打点 + 进度持久化** | **全断**（§2.4 真机实测） |

**后果**：两套实现的能力是**互补**的（屏幕侧有分区引导、播放器有进度），但用户**只能用到其中一套的一半**。
后续实施必须**先决定保留哪一套**，否则新加的进度功能会变成**第三套**（见 §6 第 6 条）。

### G1 · 分块语义有 **三套互不一致** 的实现（最严重）

| 通路 | 分块规则 | 证据 |
|---|---|---|
| 屏幕拼制模式 | 用户手选块数 **N（1–64）**，`cols = round(sqrt(N·w/h))` | `ui/workspace.js:3783-3793`、`:3891` |
| 板型 ZIP / 材料面板 | **固定 104×104** | `export-v2-service.js:71`、`ui/workspace.js:2547` |
| legacy 分版下载 | 用户可选 **52 / 78 / 104** | `index.html:419-424`、`app.js:5957,6034` |

**后果**：用户在屏幕上把作品切成 6 块、逐块拼完，再去导出「板型 ZIP」得到的是 104 板的另一种切法；
材料面板报的「需 N×M 块底板」也与屏幕上的块数无关。**屏幕所见 ≠ 导出所得 ≠ 备料所算。**

**补充（真机实测）**：屏幕侧**自身**还有一层不一致 —— `#ws-block-count` 显示的是**期望块数**（`build.count`，用户手选），
而 `#ws-build-focus` 显示的是**实际网格**（`blockLayout` 会把 count 向上取整到 `cols×rows ≥ count`，`ui/workspace.js:3787-3789`）。
实测：count 读数 `3` → 实际「第 1 / 4 块」。**用户看到「分区数 3」，实际被切成 4 块。**

### G1-b · 材料面板对 52 / 78 板型给出**错误的底板数量**（已存在的用户可见错误）

`renderMaterial` 用 `exportV2.split()`（硬编码 104）算底板数（`ui/workspace.js:2551-2553`）。
一个 104×104 的作品 → `needsSplit = false` → 面板显示「**单块底板**」。
但同一应用的 `#tile-size-select` 明确提供 **52×52 小版**（`index.html:421`，且为**默认选中项**）；
按 52 板拼，同一作品需要 **4 块**。
**也就是说：用默认板型的用户，会在备料面板上被少算 3 块底板。**

### G2 · 拼制模式的状态不持久化

`const build = {...}` 是闭包内对象（`ui/workspace.js:3766`），不进 store、不落盘。
实测：**分区数在刷新后回 1**；**当前块每次进入拼制模式都被重置为第 1 块**（`:3871`）。
→ 中途停工、关掉页面再回来，无法知道拼到哪、也无法回到原处（详见 §2.1 的逐字段表）。

**真机复证（§2.5 C4a/C4b）**：退出再进入 `count 3→3`、当前块 `第 2 块 → 第 1 块`；**整页刷新 `count 3→1`**。

### G3 · 屏幕拼制模式没有拼装进度（**但能力本体已经存在**）

屏幕侧现有能力止于「高亮当前块 + 当前色」（B5/B6/B7），**没有「这一块拼完了」的标记**，也没有跨会话进度记录。

**注意（真机实测，§2.5）**：这是**屏幕侧**的缺口，**不是能力缺口** ——
legacy 拼装播放器（§2.4 L4）**已经有**逐格打点与 localStorage 进度持久化，且真机验证可用（A6/A7 PASS）。
所以 G3 的正确修法是**把已有进度模型接进屏幕侧**（§4.6），**不是从零发明**。

### G4 · 跨块拼装顺序没有引导（数据已存在但屏幕侧未用）

`splitPatternGrid` 已经为每块算出四邻接（`pattern-split-service.js:15-19` `tile.neighbors`），
但屏幕侧的 `blockLayout()` **完全不使用**邻接信息，也没有任何「从哪块开始、下一块拼哪块」的建议。

### G5 · 备料不能按块展开

材料面板（M1/M2）只给整图口径。
**无法回答「第 3 块需要哪些色、各多少颗」** —— 而这正是「一次只拼一块」最需要的清单。

### G6 · 屏幕侧与导出侧没有共享模型

屏幕侧用 `blockRect(index)`（`ui/workspace.js:3794-3798`）现算；
导出侧用 `splitPatternGrid()` 产出 `tiles[]`。
两者**数据结构不同、命名不同（`block` vs `tile` / `cols,rows` vs `columns,rows`）、坐标口径不同**，
没有共同的「分区模型」可以同时喂给屏幕、导出、备料。

---

## 4. 设计

### 4.1 核心决策：先立一个**分区模型**，三条通路全部从它派生

> **一句话契约：一个作品有且只有一套「分区」，屏幕、导出、备料都读它。**

```
ArtworkSplit（唯一分区模型）
├─ boardSize: 52 | 78 | 104          ← 实体底板边长（格），默认 104（与现状一致）
├─ source: "board" | "manual"        ← 分块依据：按实体板，或用户手选块数
├─ columns, rows, total
└─ blocks[]: { index, number, row, column, x0, y0, x1, y1, neighbors, usage[] }
                                   ↑ usage[] = 该块逐色号颗数（供 G5 按块备料）
```

- **`boardSize` 是新增的唯一自由度**，把 `#tile-size-select` 的 52/78/104 收敛进来（消除 G1-b）。
- `source="manual"` 保留现有屏幕行为（用户手选 N 块），但**分区结果同样落进 `ArtworkSplit`**，
  这样屏幕选 6 块时，导出与备料也按这 6 块走（消除 G1）。
- `usage[]` 由 `blocks[]` 派生，让材料面板既能给整图口径、也能给「按块」口径（消除 G5）。

**实现落点（复用，不新建平行实现）**：
- 扩 `services/pattern-split-service.js`（已有 `splitPatternGrid` / `countValidCells`，是天然归属），
  不要新建第二个 split 服务；
- `blockLayout()` / `blockRect()`（`ui/workspace.js:3783-3798`）改为**读 `ArtworkSplit`**，
  删除本地现算逻辑；
- `exportV2.split()`（`export-v2-service.js:71`）改为 `split({boardSize})`，默认 104 → **现有调用行为逐位不变**。

### 4.2 状态落点：`build` 进 store

`build`（分区数 / 当前块 / 当前色 / 已完成块集合）写进 `state.ui`（或 `state.build`），
经 `state/project-store.js` 持久化。**理由**：G2 与 G3 都要它；且「已完成块」必须跨刷新存活。
注意与既有约定一致：**分区与颜色选择仍不写 `state.grid`**（保住撤销栈干净，源码 `:3762-3765` 的设计意图不能丢）。

### 4.3 信息架构：放哪

沿用 `docs/stage-c-product-architecture.md:181-184` 的既有结论 ——
`build` 面板是 `reachable-but-not-a-tab`（由左轨「施工模式」进入，进入后 tab 条隐藏）。
**不新开一级 Tab，不新加顶栏按钮**（用户已明确「不要复杂、不要占地方」）。

新增内容全部落在**已存在的 `build` 面板内部**（`ui/workspace.js:227-241`）：

```
施工面板（扩展现有）
├─ 返回编辑
├─ 底板与分区        ← 新增：板型 52/78/104 + 分区依据（按板 / 手选块数）
├─ 区块切换          ← 现有 block map
├─ 本块清单          ← 现有（颜色切换）+ 新增每色颗数合计
├─ 拼装进度          ← 新增：已完成块集合 + 「标记本块完成」+ 进度 N/M
└─ 拼装顺序          ← 新增：按 neighbors 给「下一块」建议
```

### 4.4 交互（保持「一次一块一色」的现有节奏）

1. 进拼制模式 → 默认按 `boardSize` 分区（默认 104，与现状一致），并**恢复上次进度**。
2. 逐块：选块 → 逐色（现有能力）→ 点「标记本块完成」→ 自动跳到按邻接建议的下一块。
3. 进度以 `已完成 / 总块数` 呈现，并可一键「回到上次未完成块」。
4. 导出与备料自动使用**同一套分区**，面板上直接显示「与屏幕分区一致」。

### 4.5 与现有模块的接缝

| 复用对象 | 用途 | 不改的部分 |
|---|---|---|
| `services/pattern-split-service.js` | 唯一分区计算 | 现有签名 `splitPatternGrid(grid, w, h)` 保持兼容（新增参数可选） |
| `services/board-sheet-export.js` | 分板总览 / 单板图 | 不动 |
| `services/construction-sheet-layout.js` / `pdf-construction-sheet.js` | 施工图版式 | 不动 |
| `ui/inventory-panel.js` | 库存台账 | 不动（备料口径扩到按块是新增读取，不改其内部） |
| `editor.highlightedPaletteId` + 渲染器淡化 | 当前色高亮 | 不动（B6 已复用，继续复用） |
| `export-v2-service.js` | 板型 ZIP | 仅把 104 常量改为参数，默认值不变 |

### 4.6 进度模型：复用 legacy 拼装播放器，不重新发明（G0 / G3 的合并解）

G3 的进度需求（逐格 / 跨会话 / 可复位）**在 legacy 播放器里已经完整实现**（§2.4 L4，真机 A6/A7 已验证）：

- 存储键 `libai-maker-assembly-<hash>`（`app.js:6492`），`load` / `save` / `reset` 三件套齐备（`:6502` / `:6512` / `:6700`）；
- 真机实测可写可读（§2.5 A7：`localStorage` 出现 `libai-maker-assembly-6D178B28`）。

因此 P4 的实施口径改为：**把 L4 的进度模型提到可复用层**（例如 `services/assembly-progress-service.js`），
屏幕 build 模式与 legacy 播放器**共用同一份进度** —— 屏幕侧标记「本块完成」后，播放器打开能看到同一进度，反之亦然。

**⚠ 在 P4 之前必须先答一个产品问题**：legacy 播放器（§2.4）与屏幕 build 模式（§2.1）**保留哪一个**？
- 若保留播放器 → 屏幕侧只需补「入口 + 进度读取」，工作量最小；
- 若保留屏幕侧 → 需把播放器的逐格打点搬到屏幕侧，并处理 legacy 策略的移除。

（本阶段只记录该问题，**不替用户决定** —— 见 §6 第 6 条。）

---

## 5. 分步实施计划（每步可独立验收、可独立回滚）

| 步 | 内容 | 验收标准 | 回归面 |
|---|---|---|---|
| **P1** | 立 `ArtworkSplit` 模型（扩 `pattern-split-service.js`），`exportV2.split({boardSize})` 默认 104 | 现有 `tests/board-sheet-export.test.mjs` / `construction-sheet-layout.test.mjs` / `pdf-construction-sheet.test.mjs` 全绿；新增「同一 grid 在 52/78/104 下的 columns×rows×total」逐档断言 | 导出 ZIP 字节级不变（默认档） |
| **P2** | 材料面板按 `boardSize` 算底板数（**修 G1-b**） | 104×104 作品：104 板 →「单块」；52 板 →「4 块」。新增回归断言钉住两档 | `tests/material-tab-semantics.test.mjs` |
| **P3** | `blockLayout/blockRect` 改读 `ArtworkSplit`（**修 G1/G6**） | 屏幕选 6 块时，导出的板数与材料面板的底板数**与屏幕一致**；`build` 面板显示板型 | 拼制模式 CDP 真机探针 |
| **P4** | `build` 进 store + 进度（**修 G2/G3**；进度模型**复用** §4.6，不重新发明） | 刷新后分区数 / 当前块 / 已完成块集合均保留；进度 N/M 正确；**与 legacy 播放器共用同一份进度** | `state/project-store` 快照测试 + 进度服务单测 |
| **P5** | 拼装顺序建议 + 按块备料（**修 G4/G5**） | 每块可列出「色号 × 颗数」；「下一块」建议走 `neighbors` | 新增单测（顺序确定性） |

**建议起点：P1 + P2**。理由：P1 是契约、P2 是**已经影响真实用户的错误**，两者都不动屏幕交互，风险最低、收益最直接。

> **P4 的前置条件**：先完成 §6 第 6 条的产品决策（两套拼制实现保留哪一套）。在决策之前，P4 只能做到「把进度提到可复用层」，不能动入口。

---

## 6. 明确不做的事

1. **不新增一级 Tab / 顶栏按钮**（用户已定调「不要复杂、不要占地方」）。
2. **不新建第二套分块服务** —— 分区计算唯一归属 `services/pattern-split-service.js`。
3. **不让拼制模式写 `state.grid`** —— 保住「拼制操作不进撤销栈」的既有设计（`ui/workspace.js:3762-3765`）。
4. **不引入「损耗余量 / 采购余量」** —— 现面板明写「不含损耗余量」（`:337`），改口径属产品决策，需用户拍板。
5. **不改算法路径** —— 本阶段与 `smart-preprocessing/` 无关，`tools/b4-bench.mjs` 冻结基线必须保持逐位一致。
6. **不在本阶段决定「两套拼制实现保留哪一套」**（G0 / §4.6）—— 这是产品决策，需用户拍板后再进 P4。

---

## 7. 风险

| 风险 | 说明 | 缓解 |
|---|---|---|
| R1 | 分区模型改动会同时触碰屏幕 / 导出 / 备料三处 | 严格按 P1→P5 分步，每步单独提交；P1 默认值不变 → 未使用新参数时行为逐位不变 |
| R2 | `exportV2.split()` 被 `renderMaterial` 在 `paint()` 的同步监听里调用（`ui/workspace.js:2521-2529` 有性能注释，500×500 时整幅深拷贝 ~15ms） | 分区结果按签名缓存（现有 `boardSplitSignature`/`boardSplitCache` 模式 `:1970-1971,2400-2402`），按块 `usage[]` 也用同一签名 |
| R3 | `build` 进 store 会扩大 `project-store` schema | 走既有迁移机制（`state/project-store.js`），缺字段时给默认值，老工程可打开 |
| R4 | 三套分块语义的收敛可能暴露既有测试的隐含假设 | 每步先跑对应测试文件确认基线，再改 |

---

## 8. 验收基线（本阶段实测，供后续对照）

- **相关测试 40/40 通过**（本次实测）：
  `tests/board-sheet-export.test.mjs` · `tests/construction-sheet-layout.test.mjs` ·
  `tests/material-tab-semantics.test.mjs` · `tests/pdf-construction-sheet.test.mjs` ·
  `tests/legacy-construction-export.test.mjs` · `tests/ui-refactor-baseline/inventory-service.test.mjs`
- **全量测试（2026-10-15 复跑复核，命令 `node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)`）**：
  **2539 项 → 2511 通过 / 27 失败 / 1 跳过**。27 项失败全部为既有失败、与本阶段零代码改动无因果关系：
  2 项 deploy 同步（`deploy/` 缺 `ui/source-crop-controller.mjs` + 6 个文件落后）+ 25 项工作区既有 WIP 导致的 UI 基线断言陈旧。
  （本节初稿曾记「2530 / 25」——那是阶段 6 验收（提交 bf4a598 时）的数字；本次以规范命令在**当前工作区**复跑得 2539 / 27，
  差异来自工作区既有 WIP（46 个改动文件含若干测试文件，多出 9 个用例、2 个失败）。以本次复跑数字为准，失败清单见需求文档 §6.2。）
- **ESM 严格语法**：795 文件 / 0 解析失败（src 侧 98 个 `.js` 拷为 `.mjs` 后 `node --check` + 462 个原生 `.mjs` + deploy 镜像 235 个）
- **真机取证（CDP · 无头 Chrome · 冻结快照 `bf4a598`）**：**22 条断言 → 22/22 PASS（当日复跑二次复核，结果一致）**
  （产物：`outputs/stage7-assembly/probe-assembly.mjs` · `probe-result.json` · `01-assembly-player-works.png`，已随本阶段提交归档至 `docs/stage7-assembly-evidence/`）
- 本阶段**未修改任何源码、未部署**。

---

## 9. 附：本次取证的关键行号索引

```
屏幕拼制模式   ui/workspace.js:227-241（面板）· :3762-3905（逻辑）· :3777 buildActive
分区计算       ui/workspace.js:3783-3793 blockLayout · :3794-3798 blockRect · :3809-3812 advisedBlocks
区块状态       ui/workspace.js:3766（闭包对象，未持久化）
分板服务       services/pattern-split-service.js:4 splitPatternGrid · :15-19 neighbors
板型 ZIP       services/export-v2-service.js:71,73（硬编码 104）· :72-80 boards()
施工图版式     services/construction-sheet-layout.js:4 / :15 / :45
PDF 施工图     services/pdf-construction-sheet.js:15
分板渲染       services/board-sheet-export.js:4 renderBoardOverview · :13 renderBoardSheet
legacy 分版    index.html:419-424（52/78/104/不分版）· app.js:5957 · app.js:6034
A4 打印套      app.js:6069
材料面板       ui/workspace.js:2517-2554 · :2551-2553（底板数量，硬编码 104 口径）
库存台账       ui/inventory-panel.js:38 InventoryPanel
导出抽屉分栏   ui/workspace.js:4178-4193（outputTaskNav / outputPanels / showOutputTask）· :4184 把 #ws-output-preview 放进 print 面板
legacy 播放器  app.js:6412 openAssemblyPlayer · :6492 getAssemblyStorageKey · :6502 loadAssemblyProgress · :6512 saveAssemblyProgress
               app.js:6517 renderAssemblyColorList · :6597 renderInteractiveBoard · :6685 handleAssemblyBoardClick
               app.js:6700 resetAssemblyProgress · :6709 updateAssemblyProgressUi
legacy 登记    ui/legacy-ui-policy.js:1-6（LEGACY_DIALOG_IDS 含 assembly-modal）
```

---

## 10. 附：本阶段取证时发现的仓库完整性缺陷（与本阶段无关，但需处理）

> 这条**不是拼制模式的问题**，而是阶段 7 取证过程中**意外发现**的既有缺陷，记在此处以免丢失。

### 现象

`git archive bf4a598`（即阶段 6 提交）展开的冻结快照，**工作台根本起不来** ——
`body.className` 为空（没有 `phase2-workspace`）、0 颗豆、控制台报错。

### 根因

`ui/workspace.js` 请求 `composeLockedTextGrid`，但**已提交的** `services/text-layer-service.js` **不导出它**。
即 **阶段 5 的提交漏了 2 个文件**：

| 文件 | 缺失内容 | 归属 |
|---|---|---|
| `services/text-layer-service.js` | `composeLockedTextGrid` / `ensureUploadedFont` / `closestPaletteColor` | 阶段 5（拼豆二维码图层） |
| `ui/text-panel.js` | `textPaletteChoices` / `textLayerColorLabel` | 阶段 5 |

### 取证方法（可复现）

用 `/tmp/bootfix.mjs` 反复跑启动自检，把报错指向的模块**逐个从工作区补入快照**，直到工作台挂上 ——
这样得到的是**精确缺件集合**（2 个文件），而不是「猜」。

### 状态与影响

- **deploy 侧已含新内容、src 落后** —— 说明这 2 个文件的改动曾经存在，只是**没进阶段 5 的提交**。
- 影响面：任何 `git clone` + `git checkout bf4a598` 的人都**无法启动工作台**（本地 `src` 因为工作区残留文件而看不出来）。
- 本阶段**未修**（阶段 7 是规划阶段，不改源码）。**建议**：在下一阶段以独立提交补齐这 2 个文件，并加一条启动自检测试钉住。
