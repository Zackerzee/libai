# LIBMS Studio 开发基线（Stage 0）

> 生成时间：2026-10-15 · 执行范围：阶段 0（审计与基线保护）
> 本文件是下一阶段开发计划（README 见根目录 `AI-COORDINATION.md` 的协同规程）的**基线事实源**。
> 所有状态标注均来自本次实际取证（git / 测试运行 / 源码检索），不沿用旧报告结论。

---

## 1. Git 与工作区状态

| 项 | 实测值 |
|---|---|
| 仓库 | `/Users/gongzhenyan/Documents/libms-studio` |
| 当前分支 | `main` |
| HEAD | `5131f1c docs(coordination): 登记本线收工、deploy 同步完成与左栏迁移施工单` |
| 未提交修改 | **376 个文件**（`git status --porcelain`），diff 统计 103 files, +9883 / −3074 |

### 1.1 未提交修改的处置决策（重要）

未提交修改是**跨会话长期累积的进行中工作**（含已与用户确认的 v3 布局增量、参考图透明度语义、
诊断修复等）。处置原则：

1. **不 reset、不 stash、不 clean、不代用户提交**任何既有未提交文件；
2. 本计划各阶段用 `git switch -c <阶段分支>` 携带未提交修改切换（该操作不清除工作区改动）；
3. 每阶段提交时**只精确 `git add` 本阶段产出的文件**，用户既有修改继续原样留在工作区；
4. 未采用 `git worktree` 的原因：用户的实时预览通道（8792 端口）绑定主工作区目录，
   且隔离工作树无法携带 376 个未提交修改，反而会造成「改了一份、线上看的是另一份」。

## 2. 环境与命令

| 项 | 实测 |
|---|---|
| Node（测试用） | `/Users/gongzhenyan/.workbuddy-ai/binaries/node/versions/22.22.2-6/bin/node`（22.22.2） |
| Python（取证用） | `/Users/gongzhenyan/.workbuddy-ai/binaries/python/envs/default/bin/python`（3.13 + Pillow） |
| package.json | **不存在** —— 纯静态项目（原生 HTML/CSS/JS），**无构建步骤、无 typecheck** |
| 测试命令 | `node --test $(ls tests/*.test.mjs) $(ls tests/*/*.test.mjs)`（注意：`node --test tests/` 会把目录当成单测文件报 `not ok 1 - tests`，非真失败） |
| 测试文件数 | 244 个 `.test.mjs` |
| ESM 语法检查 | `node tools/esm-syntax-check.mjs` → **750 个文件，解析失败 0** |
| 算法基准 | `node tools/b4-bench.mjs --out <dir>`（Node 纯函数口径，冻结基线比对） |
| 本地服务 | 8792（源码根）/ 8793（deploy 根），均在运行 |
| deploy 同步 | `node tools/sync-deploy.mjs`（清单 410 文件） |

## 3. 能力审计（24 项，全部实际取证）

**结论：24 项全部「已实现」，无「尚未实现 / 入口不可达」。**
本计划各阶段的性质因此是**整合与增强**，不是从零建设；严禁新建第二套平行实现。

| # | 能力 | 证据（文件路径 / 代码） | 状态 |
|---|---|---|---|
| 1 | 工作台页面结构 | `index.html`（1032 行）；工作台 `ws-*` 节点几乎全部由 `ui/workspace.js` 动态生成（`wrap` / `dock` / `right` / `paletteSummary` 等 JS 创建），HTML 里只有静态骨架 | 已实现 |
| 2 | 顶部工具栏 | `ui/grid-editor-toolbar.js`：`GRID_TOOLS` / `PRIMARY_ORDER` / `EXTENDED_TOOL_IDS`，`renderRail`（选择+绘制+形状菜单+pan+help）、`renderExtended`、镜像菜单、undo/redo；三种 variant | 已实现 |
| 3 | 左侧色板 | 左栏 = 工具 rail（`.ws-rail` / `.ws-rail-button`，`styles/workspace.css:40-43`）；选色/配色清单在右栏（`#ws-palette-summary` + `.ws-summary-picker`，`ui/workspace.js:458-486`） | 已实现（形态与计划「左色板」描述不同：当前左侧是工具栏、右侧是选色，阶段 1 按用户简洁化目标重整） |
| 4 | 右侧设置面板 | `INSPECTOR_TABS` 8 个任务面板（project/source/generation/color/edit/check/material/build，`ui/workspace.js:217`）；切换真源 `ui.activePanel` | 已实现 |
| 5 | 图纸画布 | `ui/canvas-renderer.js` 六层 `base→reference→grid→codes→overlay→highlight`（层序为 2026-10-14 修复：参考图在豆格之上，grid/codes 仍在其上）；鼠标中心缩放（`ui/zoom-controls.js` + viewport-service） | 已实现 |
| 6 | 图片导入 | `index.html#file-input` / `#direct-pattern-file-input`；`importers/pixler.mjs`（工程格式）；`app.js:648-649` 绑定；支持 jpeg/png/webp/gif | 已实现 |
| 7 | 生成模式 | `services/mode-profile.mjs`：`MODE_PROFILES` = beginner / auto / portrait / anime / illustration / pixel / logo / photo 共 8 个；`MODE_LABELS` 中文；**唯一模式真源**（原三张表已收敛，`GENERATION_MODE_PRESETS` 是其视图） | 已实现 |
| 8 | 自动调参 | `mode-profile.mjs` 证据路由规则（`routingEvidence`，证据缺失规则惰性）+ `tools/b4-auto-tune.mjs` / `b4-auto-tune-probe.mjs`；`tests/mode-profile-contract.test.mjs` 逐字段反查消费点 | 已实现 |
| 9 | 颜色数量限制 | `runGenerationPipeline({ maxColors = 0 })`（0 = 不限）；UI 滑杆；`maxColors > 0` 时触发 Protected Palette Budget（`smart-preprocessing/protected-palette-budget-v2.mjs`） | 已实现 |
| 10 | 背景处理 | `smart-preprocessing/auto-background.mjs`：`resolveBackgroundMask`（四边颜色统计 → 主导色桶 → 洪水填充 → enclosed 保留）+ `applyBackgroundBlanks`；`background-reliability.mjs`：置信度评估 `assessBackgroundReliability` + 低置信保守保留（`BACKGROUND_KEEP_MESSAGE`） | 已实现（阶段 3 = 增强，不新写） |
| 11 | 透明区域处理 | `services/generation-result-codec.mjs`：`indices: Int32Array`，`-1 = 空豆(null)`；nullMask 派生；空格不计入材料 | 已实现 |
| 12 | 图片采样 | `smart-preprocessing/sampling-engine-v2.mjs`（1221 行）：`SamplingMode` = auto（区域感知自适应）/ linear-mean / center / dominant / edge-aware；`extractCellPixels` / `clusterColorsLab` | 已实现 |
| 13 | 色号匹配 | `generation-engine-v2.mjs` matching 阶段；`BRAND_CODE_MAP`（`app.js`）+ `smart-preprocessing/palette-data.mjs`（mard 291 条）真实色号身份 | 已实现 |
| 14 | 空间优化与区域清理 | `smart-preprocessing/smart-cleanup-v2.mjs`：`protectionThreshold` / `sourceEvidenceThreshold` / `maxComponentSize` 保护性清理 | 已实现 |
| 15 | 生成工作线程 | `services/generation.worker.mjs` + `generation-worker-client.mjs`（另有 `pindou.worker.mjs` 本地融合引擎） | 已实现 |
| 16 | 真实取消 | `generation-worker-client.mjs:205` `cancel()` → **真 `worker.terminate()`** + `GenerationCancelledError`；不是标记后跑完 | 已实现 |
| 17 | 作品数据 | `state/store.js`（统一状态真源）+ `state/project-store.js`（schema / 迁移） | 已实现 |
| 18 | 选区状态 | `services/selection-service.js`：rectangular / sameColor / connected / within 约束 | 已实现 |
| 19 | 撤销重做 | `services/editor-command.js` + `editor-service.js`（history strip `#ws-history-label`）+ 工具栏 undo/redo 按钮 | 已实现 |
| 20 | 材料统计 | `services/palette-usage.js`（`getPaletteIndex` 实时索引）+ `services/palette-usage-strip.mjs`（`buildUsageEntries` / `formatUsageSummary`） | 已实现 |
| 21 | 图纸导出 | `services/export-v2-service.js`（PDF 含 CJK / PNG / poster / A4 分页 / 104 板分割 ZIP）+ `export-service.js` | 已实现 |
| 22 | 现有结构描边 | `services/outline-service.js`：`computeOuterOutline`（thickness / connectivity / includeHoles / 外扩空格判定）；UI `#ws-apply-outline` / `#ws-outline-source` / 描边包含对角 | 已实现（阶段 6 = 统一增强，不重复加按钮） |
| 23 | 文字对象 | `services/text-layer-service.js`：`TEXT_FONTS` / 旋转 / `rasterizeText`；UI `#textPanel` / `#ws-text-objects` | 已实现 |
| 24 | 响应式 | `styles/workspace.css` 49 处 `@media` + `styles.css` 29 处 | 已实现 |

## 4. 测试基线

**全量：1978 项 · 通过 1950 · 失败 27 · 跳过 1（耗时 83s）**

### 4.1 失败分类（27 条 = 17 个文件）

**A 类 · 布局/UI 断言类（陈旧断言，20 条）** —— 全部指向近期工作台大改版后的旧结构断言；
**算法侧零失败**（见 §5）。阶段 1 完成布局重整后逐条更正（更新断言，不删测试）：

| 文件 | 条数 | 失败标题（节选） |
|---|---|---|
| `tests/adaptive-grid-rulers.test.mjs` | 2 | quiet grid ink… / tiny artwork hides all coordinate boxes… |
| `tests/available-palette.test.mjs` | 5 | browser store is window.libmsStore… / empty palette preference… / same RGB… / preferences persist… / corrupt local preferences… |
| `tests/compact-workspace-controls.test.mjs` | 2 | size slider remains compatible… / tool context wraps… |
| `tests/editor-information-architecture.test.mjs` | 1 | text objects expose a selectable list… |
| `tests/editor-layout-consolidation.test.mjs` | 1 | contextual tool options reuse actual controls… |
| `tests/fixed-height-context-controls.test.mjs` | 2 | size controls move as original nodes… / three-panel layout repositions… |
| `tests/generation-cancel-outcome.test.mjs` | 1 | 取消按钮：有独立危险色样式… |
| `tests/pindou-main-layout-integration.test.mjs` | 1 | both engines share the existing preset grid… |
| `tests/right-panel-tabs.test.mjs` | 1 | §11 Tab 切换唯一真源 ui.activePanel… |
| `tests/selection-unlock.test.mjs` | 1 | drawing tools release old masks… |
| `tests/stage-a-hotfix.test.mjs` | 2 | desktop rail is one vertical slot… / project settings expose visible… resize dialog |
| `tests/studio-design-system.test.mjs` | 1 | homepage and workbench share the final design layer… |
| `tests/transient-menu-dismiss.test.mjs` | 3 | menu actions close in capture phase… / summary opening closes peers… / Escape closes active menu… |
| `tests/ui-refactor-baseline/ui-module-integration.test.mjs` | 1 | zoom percent bridge clamps… |
| `tests/ui-typography.test.mjs` | 1 | Apple first uses PingFang, then MiSans… |

**B 类 · 环境性（2 条）**：`tests/deploy-sync.test.mjs`（deploy 缺文件 / deploy 是旧版本）。
成因：测试运行期间外部会话改写了 `services/generation-pipeline.mjs` 等文件，deploy 镜像瞬时落后；
重跑 `node tools/sync-deploy.mjs` 后单跑该文件即恢复（历史已验证 4/4 通过）。
**处置：不改测试、不改同步逻辑，环境噪声。**

### 4.2 既有失败 vs 本次新增

本阶段为纯审计，未改任何源码 → **本次新引入失败 0**；27 条全部为进入本计划前既有的失败面。

## 5. 算法基准（冻结基线比对）

`node tools/b4-bench.mjs --out /tmp/baseline-bench`：10 类夹具（A–J）× auto/beginner 两模式，
104×104 网格，**与冻结基线逐位一致（gridHash 全对），零漂移**。
Node 纯函数口径耗时 ~0.8–2.1 s/张（耗时只记录、不作门禁）。

含义：未提交的 376 个文件修改**没有改变生成算法行为** —— 阶段 2/3/4 的算法改动有干净对照面。

## 6. 性能基线

| 口径 | 现状 |
|---|---|
| 生成算法（Node） | 104×104 ≈ 1.0–2.1 s（10 夹具均值区间），bench 可复现 |
| 真实浏览器（8792/8793） | 有现成真机 QA 夹具（`tools/b3-worker-probe.mjs` / `tools/b4-mode-smoke-probe.mjs`），阶段验收时逐阶段实测 |
| 尺寸上限 | `ui/workspace.js:4026` 提示上限 1000×1000 格；52/104/200/300/500 均在支持范围 |
| ESM 语法 | 750 文件 0 失败 |

新功能接入后不得使上述口径明显退化；已有门槛不放松。

## 7. 给后续阶段的基线衔接

- **阶段 1（布局）**：负责收窄 §4.1 A 类失败 —— 布局落定后逐条更正陈旧断言（如 rail 单列、
  three-panel 重定位、菜单捕获期等），把基线失败面从 27 压到 ≤2（deploy 环境性除外）。
- **阶段 2/3/4（算法）**：任何算法改动跑 `tools/b4-bench.mjs --check` 比对冻结基线，
  差异必须能解释来源；`tests/mode-profile-contract.test.mjs` 是模式契约防线。
- **阶段 5/6（创意工具/描边）**：复用 `outline-service.js` / `text-layer-service.js` /
  `editor-command.js`，不新建作品网格。

## 8. 风险与阻塞

1. **376 个未提交文件与多会话并发**：`AI-COORDINATION.md` 是三 AI 协同规程，开修前必读；
   提交前先 `git status --porcelain` 复核，避免卷入他人半成品。
2. **deploy 双根**：8792=源码根、8793=deploy 根；改完必须 `node tools/sync-deploy.mjs`
   否则线上看不到（缓存戳同步改：`index.html` / `workspace-bootstrap.js` / `workspace.js` 的 `?v=`）。
3. **`$()` 作用域坑**（`ui/workspace.js:107`）：`$ = (s) => wrap.querySelector(s)`，
   节点一旦 append 进游离容器再查就是 null，`?.` 会静默吞失败 —— 移动节点顺序要紧。
4. **CSS 加载顺序坑**：`workspace.css` 之后还加载 `studio-system.css` / `ui-typography.css`，
   新规则一律用 id 选择器兜特异性。
5. 本阶段**未修改任何源码、未部署**（按计划「本次不自动部署生产环境」）。
