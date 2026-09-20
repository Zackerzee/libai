# 时里白拼豆生成器 UI 重构审计（Phase 1）

审计日期：2026-09-15。范围：当前静态站根目录；本阶段只审计，不改页面、算法、色卡或部署文件。当前目录没有 `.git`，无法取得 Git diff；以文件内容和现有测试为基线。

## A. 技术栈、目录与页面

- 原生 HTML/CSS/JavaScript，浏览器本地 Canvas 2D、FileReader、localStorage；无 React/Vue、无打包器、无路由、无后端。`index.html` 是单页入口；`app.js`（约 6,300 行）集中保存 DOM 引用、状态、事件、生成编排、编辑和导出。`styles.css` 是单一层叠样式文件（超过 5,900 行），存在多轮追加覆盖规则。
- `smart-preprocessing/*.mjs`：色卡引擎、前置风格化、人像预处理、结构分析、Region-Aware、Regional Block V2、Stage 4 优化、结构转换检测、渲染策略及单元测试。
- `deploy/`：部署镜像；修改根目录前端文件后必须同步镜像。`pricing.html/js/css` 为独立可选页面；`docs/` 为算法说明；`assets/fonts/` 为本地字体。
- 当前页面是同一 `index.html` 内的上传/生成工作区、最近生成图库、邀请注册以及多个 `<dialog>`（放大预览、编辑器、制作模式、空白画板、图片导入、图纸调整、网格对齐等），没有 Projects/Import/Workspace 路由。
- 初始 HTML 是预览区 + 参数/导出区 + 邀请侧栏。`setupProfessionalEditorLayout()` 在 `init()` 中运行，重排编辑器弹窗；`setupProfessionalMainLayout()` 已存在但没有被调用，其 `data-layout-ready` 相关 CSS 当前不会生效。这是重构前应先验证的结构装配风险。

## B. 功能映射

| 功能 | 当前代码位置 | 输入 | 输出 | 复用建议 |
|---|---|---|---|---|
| 图片上传 | `index.html` `#upload-zone/#file-input`；`app.js` `loadFile`, `prepareLocalImage` | 本地图片 | `state.sourceDataUrl/sourceName`，原图缩略图 | 保留读取和安全审查；换导入容器 |
| 尺寸设置 | `#granularity-input/#granularity-number`；`getGranularity`, `rasterizeImage`, `rasterizePortraitPremium` | 宽度 10–500、原图比例 | 网格宽/高 | 保留计算；高度目前随比例自动计算，不能假装已支持独立高宽生成 |
| 色卡选择 | `app.js` `BASE_PALETTE/EXTRA_PALETTE`, `PALETTES`, `getCurrentPalette`；色卡按钮和选择器 | 品牌、色数 | 实体颜色对象数组 | 原样复用数据和色号；默认 221 色 |
| 最大颜色 | `#max-colors-input`；`processImage`, `applyFinalPaletteBudget`, Region-Aware `enforceMaxPaletteColors` | 0=自动或具体数量（如 38） | 实际上限及校验报告 | 保留真实算法；UI 双向同步前先确认数值传递 |
| 生成 | `processImage` → `rasterizePortraitPremium` / `rasterizeImage` → 色卡/Region-Aware/优化器 | 原图与现有参数 | `grid[row][col]` Color/null、统计、报告 | 编排可封装；计算路径冻结 |
| 预览 | `refreshChartUrl`, `renderBeadPattern`, `render-policy.mjs`, `#result-preview`, `#preview-modal` | 网格、缩放 | Clean Preview、正式图纸 URL | 复用 Canvas 渲染；视图状态须与导出状态分离 |
| 编辑 | `#editor-modal/#editor-canvas`；`renderEditorCanvas`, `paintEditorCell`, `fillEditorRegion`, `replaceColor` | Color 对象网格、工具操作 | `state.editorGrid`，保存后 `state.grid` | 现有单豆、橡皮、吸管、填充、矩形/复制/剪切、换色可复用；不要承诺未验证能力 |
| 撤销/重做 | `paintUndo`, `replaceUndo`, `undoPaint`, `undoReplace` | 编辑动作 | 恢复旧颜色 | 只有分开的撤销栈；未发现统一 redo，不能在新工具栏放可用重做键 |
| 统计/色号 | `calculateStats`, `updateStatsList`, `renderBeadPattern` | Color 网格 | 色号、数量、总豆数 | 原样复用计算；新 Inspector 只消费真实统计 |
| 导出 | `downloadPreviewImage`, `downloadPattern`, `downloadSplitPattern`, `downloadEditorArtwork` | 网格、分板、镜像、预设 | PNG、分板 ZIP | 保留真实格式；PDF/CSV/JPG/项目 JSON 不应当作已实现 |
| 项目/作品库 | `saveCurrentToGallery`, `serializeGridForLibrary`, localStorage 图库 | 网格与摘要 | 最近生成作品、缩略图和本地矩阵 | 可作为 Projects 首版数据源；不是版本化完整 Project 格式 |
| 制作模式 | `#assembly-modal`, `playCompletedBeads`, `loadAssemblyProgress` | 图纸、格子状态 | 高亮、已拼进度 | 现有互动能力可迁入独立 UI；不改生成算法 |

## C. 耦合与必须保护的边界

1. `app.js` 的 `els` 集中抓取具体 ID；事件和状态直接写 DOM。重排节点可保留 ID，但删除或改名会断开事件。生成函数直接读取 `els.modeSelect/maxColorsInput/granularityInput`，因此第一步服务层应做薄适配，而不是大规模搬运算法。
2. `state.grid`, `state.editorGrid`, `generationOriginalGrid`, `generationOptimizedGrid` 是不同快照；编辑保存会整体替换 `state.grid`。`previewUrl/chartUrl` 是网格的派生数据，不能成为独立真相。`showCodes` 已在编辑偏好、放大预览规则及导出 preset 中各自存在，但不是统一视图状态。
3. `saveEditor()` 与 `saveEditorToLibrary()` 重复状态提交逻辑。画笔撤销、换色撤销、参考图撤销彼此独立；项目 dirty 状态和版本化 Project JSON 均缺失。应逐个界面迁移，不做全量 Color Grid → index buffer 换血。
4. `styles.css` 多次定义 `:root` 与同一布局选择器，且 `applyRandomPixelTheme()` 可动态写色值；先确立最终 token 优先级，再减少重复覆盖。主工作台的脚本重排函数未运行，应决定采用静态 DOM 还是运行时重排，不能两套并存。
5. 算法保护清单：Color 对象/色号、默认 221 色、色卡数据、采样/背景掩码、ΔE 色卡匹配、Region-Aware 与 V2、maxColors 实体色合并、Stage 4、统计与渲染 preset。UI 重构不得改变输出矩阵。

## D. 回归基线与已知缺口

- 当前 `node --test smart-preprocessing/*.test.mjs`：37/37 通过；这些主要是合成矩阵/单元测试。没有发现可直接用于“同图重构前后输出 hash”的固定原图 fixture。需先补固定输入及输出摘要，之后才动生成入口接线。
- 普通 Clean Preview 和 Preview Export 已有独立 render preset；正式图纸仍按自己的 preset 生成。新 ViewSettings/ExportSettings 应映射现有 preset，不通过 CSS 隐藏色号来冒充导出能力。
- A4 打印相关函数/DOM 引用仍留在 `app.js`，但当前 `index.html` 未呈现对应控件；属于旧代码残留，审计阶段不删除。
- 当前生成宽度可调，高度按原图比例推导；空白画板可独立输入宽高。若新“作品”面板提供独立高宽图片生成，需后续明确算法扩展，不能仅做 UI。
- 部分注册/下载流程存在限制，重构导出抽屉要维持原有约束而非绕过。未发现原生 PDF/JPG/CSV 或版本化 Project JSON 导出。

## E. 新 UI 对现有功能的映射与建议文件

Projects：首页消费现有图库；Import：保留隐藏 file input 与 `loadFile`；Workspace 中央 Canvas：保留 `renderBeadPattern` 与编辑 Canvas；左侧“作品/色彩/编辑/检查”：分别挂接尺寸/色卡与 maxColors/现有编辑工具/已有结构检测；右侧 Inspector：消费 `state.stats`、选中 Color 与生成报告；底部 View Bar：以现有原图 URL、Clean Preview、正式图纸和编辑 Canvas 组成视图，另建纯 UI `showGrid/showCodes/zoom`；Export Drawer：调用现有 PNG 与分板 ZIP 流程；Making Mode：迁移已有 assembly 进度数据。

拟新增：`docs/UI_REFACTOR_AUDIT.md`（本文件）、`docs/UI_REGRESSION_BASELINE.md`、固定测试图/测试脚本、`ui/design-tokens.css`、`ui/workspace-shell.css`、`ui/project-store.js`、`services/{image,generation,palette,editor,export,project}-service.js`（服务只转接现有能力）。拟修改：`index.html`、`styles.css`、`app.js` 及对应 `deploy/` 镜像。具体文件数应随着每阶段验证收窄；本阶段不创建服务或重写页面。

## F. 分阶段实施门槛

1. Phase 1 审计（本文件）与真实图片回归 fixture；记录矩阵 hash、尺寸、实际色数、主要色号、总豆数。
2. Phase 2 token 与 CSS 优先级梳理；只改视觉基础，运行本地站及测试。
3. Phase 3 Project Store 薄适配：包裹现有 `state`，不替换 Color Grid；区分 ViewSettings/ExportSettings。
4. Phase 4 服务层从生成/导出入口做薄封装，逐项证明输出 hash 不变。
5. Phase 5–10 按 Workspace Shell → Import → 尺寸 → 色彩/maxColors → Canvas → View Modes 接线；每阶段检查真实生成、预览与色号。
6. Phase 11–13 现有编辑、Export Drawer、Making Mode 逐项迁移；不可用能力禁用或隐藏。
7. Phase 14 做 1440/1280 响应式、Canvas 性能及全功能回归；同步 `deploy/` 后再次验证。

本审计完成后停止在 Phase 1，不启动 UI 实现。
