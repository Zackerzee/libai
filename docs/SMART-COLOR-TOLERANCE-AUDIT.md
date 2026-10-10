# 智能色彩容差 V1：代码审计与待确认方案

审计日期：2026-10-10。范围：当前 libms-studio 源码；只读检查生产代码、运行既有测试。本轮仅新增本报告，没有修改生产代码、色卡、生成算法或发布站点。

SMART COLOR TOLERANCE AUDIT = PASS

PASS 表示审计与方案交付完成，不表示新算法已经实现或通过验收。431／5／12 指定案例复现为 BLOCKED：缺少原图、工程、页面截图或版本信息。

## 1. 主要结论与问题 A–E

| 检查项目 | 当前实现与证据 | 存在问题 | 改进方案 |
|---|---|---|---|
| 容差计算 | index.html:286 旧“颜色合并阈值（推荐30）”；app.js:4450 normalizePixel 对 RGB 通道分档，step≈阈值/5，smooth 为/3，average 跳过 | 不是 ΔE00；不是标准色号间的合并距离；默认 V2.5 未传此参数 | 新增独立标准色卡后处理模块；旧控件与新强度严格区分 |
| 色差算法 | smart-preprocessing/palette-engine.mjs:39 deltaE2000、rgbToLab；标准匹配器 createPaletteEngine | 已有成熟实现，不能再造；魔棒和区域量化还有不同距离口径 | 智能容差候选统一复用 ΔE00，另加亮度、局部对比和保护约束 |
| 颜色合并 | protected-palette-budget-v2.mjs:64 buildPaletteBudgetPlan、:183 applyBudgetPlan；editor-color-reduction.mjs:12 previewEditorColorReduction | 当前目标是色数，不是容差；预算允许 A→B→C 链式映射；原地改 cell，不能拿共享基线调用 | 固定深拷贝基线；稳定候选层级；相对所有原始成员检查距离，不把传递接近当合并许可 |
| 结构保护 | detail-protection-v2.mjs:229 buildProtectionMap；smart-cleanup-v2.mjs:109 smartCleanup；可选线稿保护 | cleanup 修改前门控；预算 :150 可 forcedProtected；没有统一事后恢复机制 | 新模块显式消费保护证据；局部限制与预算冲突分别报告 |
| 自动推荐 | 旧阈值“推荐30”是静态文案；app.js:2601 paletteBudget.recommended 来自 colorsAfterBudget/实际色数 | 不是容差质量搜索；不得包装成真实推荐 | 对固定候选层级做质量约束搜索，实图标定；无合格压缩结果返回0并说明原因 |
| 状态管理 | state/store.js 单源；project-store.js 为适配器；旧 state 是兼容 Proxy | generationOriginalGrid 是已有流程输出快照，不是未经预算的原始匹配结果 | 正式字段设计先确认，新增基线/版本信息放唯一 store；派生缓存不形成第二份可编辑状态 |
| 预览与导出 | app.js:5880 getExportGrid 对非手动作品可能再次强制预算；Export V2 从当前网格读；JSON/Pixler也读作品网格 | 新功能若只改预览，导出会不一致；保护优先可能被旧出口再次压色 | 确认统一应用出口及预算策略；导出不能再悄悄改变已验收矩阵 |

- A：旧阈值作用于 legacy 栅格采样后、标准色卡匹配前的 RGB 通道；V2.5 不使用它。编辑态降色作用于当前最终标准色号网格。魔棒、直读图纸聚类和背景容差是另外的功能。
- B：旧值是 RGB 分档强度，既不是 RGB 欧氏距离，也不是 ΔE76/ΔE00。
- C：旧“推荐30”没有图像质量推荐算法；当前预算报告也不是独立容差推荐。
- D：旧阈值重新从 sourceDataUrl 生成，不累计处理最终网格；仍经过完整生成调度。编辑降色未应用时不累计，应用后再次计算基于修改后的作品，是累计编辑，不具备跨应用的无损容差基线。
- E：V2 保护不是事后把合并结果恢复，而是 cleanup 前阻止修改；硬预算随后可以牺牲保护色。不同引擎不能假设有同一个保护契约。

## 2. 真实流程图与源码清单

```text
旧阈值 input/确认
  → app.bindRangePair(1503) → scheduleLivePreview(1679，320ms)
  → processImage(2980)
      ├ PW/hybrid-PW：独立分支
      ├ BGS：独立分支
      ├ V2.5（默认）：旧 similarity 未传入
      │  → processProductionV2(2658) → processImageV2(2509)
      │  → Auto Tune 或 runGenerationJob(3794)/Worker
      │  → generation-pipeline.runGenerationPipeline(108)
      │  → generation-engine-v2.generateV2(159)
      │     裁剪 → Sampling(251) → 标准色卡 Matching(267)
      │     → 可选可靠背景清空(303) → DetailProtection(345)
      │     → 可选 StrokeMask(353) → SmartCleanup(399)
      │     → 可选 Lab SpatialRefine(441)
      │     → ProtectedPaletteBudget(459) → finalize
      └ legacy：rasterizeImage(4053) → normalizePixel(4450)
         → 匹配/分支处理 → applyFinalPaletteBudget(3048)
         → 可选 optimizer → 状态提交/统计/校验
作品 state.grid → renderer / 导出
  legacy getExportGrid(5880) 可能再次预算；这不是纯读取。
```

执行顺序不能按 Inspector 阶段编号推测。V2 实际编号顺序是 S1、S2、S3、S5、S4、S6。

其他关键文件与函数：

- smart-preprocessing/sampling-engine-v2.mjs：多策略采样、源图细节证据。
- smart-preprocessing/palette-engine.mjs：rgbToLab、deltaE2000、PaletteEngine；标准色卡匹配。
- smart-preprocessing/detail-protection-v2.mjs：analyzeLocalDetail、calculateStructuralContinuity、calculateSourceEvidence、detectHighlight、detectDarkDetail、detectEyeLike、buildProtectionMap。
- smart-preprocessing/accent-protection.mjs：detectAnchorColors，关键强调色保护。
- smart-preprocessing/protected-palette-budget-v2.mjs：countGridColors、buildPaletteBudgetPlan、nearestTarget、applyBudgetPlan。
- services/editor-color-reduction.mjs:12：当前编辑降色；使用已有色对象恢复完整身份，不等于验证其属于当前选定色卡。
- ui/workspace.js:702–710：resetReductionPreview、previewReduction，140ms防抖；应用前校验网格引用、revision、paletteKey；通过 COLOR_REDUCTION 命令撤销。
- services/editor-service.js:29：createEditorService；executeCommand、undo、redo；现有单格变化命令体系。
- services/quality-metrics.mjs：buildReference、measureGrid、measureAgainstSource；services/v3-quality-metrics.mjs：亮度分位数、动态范围、高光/暗像素等。
- services/auto-tune.mjs:686：整图缓存含源图、裁剪、色卡、颜色上限、模式、尺寸和 overrides；没有智能容差层级缓存。
- app.js:4568 calculateStats：按 paletteId || code 统计非空格；不能用 RGB 去重替代真实身份。
- state/store.js / state/project-store.js：真实状态与适配器；ui/canvas-renderer.js：预览；services/export-v2-service.js / app.js buildProjectJson / services/pixler-exporter.js：输出。

## 3. 数据和保护边界

作品是矩形 grid[y][x]，格子为 null 或含 code、rgb，可能还有 paletteId/hex/name 的色卡对象。尺寸、透明空格、非空颗数、品牌身份都必须保持。保护包含 typed score/tier/reason maps，以及可用时的源图证据，不是人物语义分割；不能宣称已能准确识别所有鼻梁、云纹或门窗。

现有预算 first pass 排除 critical/anchor；不足时 second pass 按 importance 合并受保护色，记录 forcedProtected。nearestTarget 没有容差距离上限。applyBudgetPlan 会原地改 code/rgb 等并解析链式映射，直接共享原始对象会破坏无损调整。

hybrid-v2 protected-mask 的 requestChange 是独立 STRICT/TopologyGuard/置信契约，TRACE_ONLY 允许假设修改；不能把 V2 protectionMap 直接塞进去，也不能拿 TRACE_ONLY 当生产保护。

## 4. 待确认的 V1 设计（尚未实现）

### 基线与集成

先仅显式接入默认 V2.5，保持默认关闭；PW/BGS/legacy、OCR、恢复工程、手工编辑不自动套用。在标准匹配且保护证据可用后捕获不可变基线；实现接缝需要提供清理后、预算前快照及对应保护证据，不能以 generationOriginalGrid 冒充匹配前/预算前基线。

推荐顺序：固定采样/匹配 → 已有清理及保护 → 智能容差派生结果 → 明确的预算政策 → 唯一作品提交。容差0恢复已定义的基线；若保留额外预算，其统计单列。确认时必须选择0是“清理后未预算基线”还是“原有生成最终基线”，不能承诺两种含义同时成立。推荐 V1 采用清理后、预算前基线，界面明确名称。

基线和配置使用唯一 store；候选层级和结果是基于基线revision的可丢弃派生缓存。图片、尺寸、裁剪、模式、色卡身份/RGB、可用色集合、保护选项、算法版本变化均失效；新编辑不能被旧异步结果覆盖，沿用 requestId/revision 守卫。手工编辑后重新建基线必须提示确认，不能自动丢弃编辑。

### 确定性、局部保护与单调性

建议新增独立纯模块 services/smart-color-tolerance.mjs 与质量评估/推荐模块（仅建议名称）。固定原始基线构建稳定嵌套层级，而不是每个强度独立贪心重跑。

候选按明确数值代价及完整色卡身份稳定排序，不依赖对象遍历顺序。目标只能引用当前合法色卡条目，不能平均 RGB 或自造色号。每个合并簇的目标需要对所有原始成员检查 ΔE00、ΔL 和局部对比界限，禁止仅靠 A近B、B近C 推导 A可并C。记录原身份→目标身份、局部格子例外和拒绝原因。

保护图从固定基线冻结。保留关键区域原色时，背景局部改色可能不减少全图色数，必须如实统计。层级不能重新引入已经消失的色号；一层后果不满足全图合法性、质量和单调性就拒绝该层。对每个可选强度全扫验证“不反弹”，不能只测示例数值。

### maxColors 的冲突政策

建议新功能默认“画质优先”：保护约束不能满足目标时保留更多颜色，显示实际色数、未达目标原因。标准色号合法性始终硬约束。

已有硬 maxColors 行为不静默改成软约束；仅在启用新功能时显式选择策略。若用户选择硬上限，必须显示可能牺牲保护色以及 forcedProtected 数量，不能称为无损智能容差。导出出口不得再不经提示强制压回上限。此策略与基线定义需用户确认后实现。

### 推荐与 UI

0–100 是用户强度，不宣称等于 ΔE00。对应阈值、归一化指标、权重和质量门限先用真实样本标定；未标定时不显示“真实智能推荐”。基于固定层级测量色差、亮度损失、结构损失、局部对比与制作复杂度；在合法且质量合格候选中选较少色的方案。无合格压缩候选时推荐0，解释原因。

UI保持现有面板位置/主题，不重做页面。但当前工作台没有指令所示色彩容差面板，需确认升级旧阈值入口还是扩展“智能降色”入口。强度拖动只处理缓存的格子/映射，不全量采样；推荐计算可异步，过期结果丢弃。显示基线标准色号数→最终实际标准色号数，容差和预算减少数分开；应用为一条可撤销命令，取消预览不改作品。导出只读取已应用作品；浮层文字须先说明是否已合并进作品。

## 5. 验证计划与本轮真实结果

本轮实跑既有 palette-engine、detail-protection-v2、protected-palette-budget-v2、smart-cleanup-v2、editor-color-reduction、generation-pipeline-consolidation、international-roundtrip、v3-quality-metrics 测试：35/35通过，0失败。总耗时129ms为测试套件时间，不是新容差性能。

V1验收：0逐格等同基线、输出合法色卡身份及RGB、确定性/输入排列不变、无循环/传递过并、全部强度单调、null与尺寸及颗数不变、局部保护、反复0↔高强度不累计、应用撤销重做一致、旧异步结果不覆盖、预览应用与所有导出矩阵一致、多品牌同RGB身份不混淆。

实图覆盖用户列出的8类；现有 fixtures 不能据文件名认定已经覆盖卡通、宠物、回形纹等，需逐张确认标签/授权和质量基准。431／5／12没有对应数据和当前UI来源，无法复现，不判定它是过度合并或统计错误。请补充原图/工程、截图、色卡和生成设置。

性能分开测：52、78、104与大尺寸；首建层级、缓存命中拖动、推荐扫描、主线程阻塞、峰值内存；冷/热运行及中位数/P95记录实际数据。当前模块未开发，无法提供其耗时、内存或缓存命中结论。不得关闭关键保护换速度。

## 6. 分阶段开发与停止点

1. 审计及方案：本报告；等待确认，不开发。
2. V1纯算法：固定基线、合法色卡、稳定层级、局部保护与单调性；只测试，不接生产。
3. 推荐标定：真实8类样本、归一化与门限、拒绝原因；质量证据不足就不启用推荐。
4. V2.5 opt-in 集成：唯一状态、缓存、预算政策、取消/过期保护、应用/撤销；每项真实结果交付后验收。
5. 原位UI与导出：轻量预览、真实统计、恢复、主题、最终矩阵一致性。
6. 全量回归与性能/实图验收：达到标准后再申请发布，不自动把未验收算法上线。

## 7. 风险、影响与回滚

高风险：硬预算牺牲保护、局部保留导致目标不达、链式色差漂移、输入基线污染、旧导出再次预算、不同引擎保护契约不一致、缺乏语义细节识别证据。中风险：强度与色差单位误读、异步缓存失效不全、复杂图内存及UI阻塞。

本轮生产影响为零。后续默认关闭保证旧流程不变，不改色卡或文件格式；导入旧工程保持兼容，不要求旧工程含新字段。新功能先V2.5，不扩大到其他引擎。发布前保存旧版本与开关；关开关回旧生成路径，当前会话取消/恢复从深拷贝基线或现有撤销命令完成，不能把重新从原图生成称为无损回滚。

待确认：基线定义、画质优先的预算政策、UI入口。确认后才进入 V1 基础算法开发。
