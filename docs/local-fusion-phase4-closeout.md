# 本地融合引擎 Phase 4 收口报告

日期：2026-10-14（深夜）。本报告覆盖：Phase 2 真实照片/动漫补验结果、全量回归定性、**生产默认引擎状态的事实修正**、发布阻断项、左栏迁移规划（只规划不执行）、待用户决策清单。

## 1. Phase 2 补充验证：真实照片 / 动漫语料闭合

用户供图两张，补齐了此前「磁盘无真实照片/动漫」的硬缺口：

| 输入 | 类别 | 分类器输出 | 结构包络 | calibrated-auto 决策 | 强行 dominant 的代价 |
|---|---|---|---|---|---|
| photo-ifs-night-cityscape（成都 IFS 夜景实拍，1280×1920） | 真实照片 | auto 0.101 | 未过 | **baseline（与 V2.5 零格差异）** | 改动 1546 格 |
| anime-guofeng-character（蓝袍古风角色立绘，1086×1448） | 真实动漫 | illustration 0.599 | 未过 | **baseline（与 V2.5 零格差异）** | 改动 1910 格 |

完整复跑：`docs/local-fusion-real-corpus-phase2/`（12 输入 × 4 变体 = 48 case）。**48 case 全部通过：非法色号 0、paletteId 身份错配 0、尺寸精确、源图不可变。** calibrated-auto 与 previous-auto 的策略翻转仅一处：brand-logo（baseline → dominant，与手动 dominant 全网格一致）——这正是校准的预期目标。corpus 25 个合成夹具策略变化为 0。

至此本地自动路由在全部六个类别都有真实素材决策证据：Logo（dominant 正确）、像素画（硬门 dominant 正确）、文字 ×3（baseline 正确）、插画 ×5（baseline 正确）、照片 ×1（baseline 正确）、动漫 ×1（baseline 正确）。证据目录：`docs/local-fusion-real-corpus-phase2/`（README + metrics/manifest/corpus.json + contact-sheet + 48 张单变体预览）。

样本量边界不变：照片 1、动漫 1，是决策正确性证据，不是泛化性证明；对外表述只能讲「结构决策」，分类器模式标签与语义的对应不可依赖（本轮又把夜景标成 auto 0.101、动漫立绘标成 illustration 0.599）。

## 2. 全量回归定性

`node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)`：2373 测，2349 过，23 挂，1 跳过。

- **本线相关 28/28 全绿**：local-fusion-identity（3）、workbench-consistency-chain（2）、local-fusion-calibration（含 2 条真实素材决策锁）、local-fusion-engine（10）、local-fusion-job（7）等。
- 23 挂的归属：**21 个 stage-c 工作台重构**（UI 线「规格超前于实现」，如隐藏旧尺寸滑块、.ws-button-danger 危险色、rail 单槽位、菜单捕获阶段——与 13:05 记录的基线同一批，非本线引入）+ **2 个 deploy-sync**（#929/#930）。
- deploy-sync 漂移清单（`node tools/sync-deploy.mjs --check`）：缺 1 / 旧 15 / 多 2。其中**本线文件 3 个**：`services/local-fusion-routing.mjs`（缺）、`services/local-fusion-engine.mjs`（旧）、`smart-preprocessing/protected-palette-budget-v2.mjs`（旧，含 paletteId 修复）；其余为 UI 线文件；「多 2」是 `.vercel/` 本地链接产物（本机 vercel 关联时生成，不应留在发布目录，建议管家同步时清理或加入忽略）。

## 3. 事实修正：生产默认引擎已切换（工作区未提交）

此前文档（IMPLEMENTATION / REAL-VALIDATION）均称「未切换生产默认」。**实际代码状态已经变了**：

- `app.js:2612-2614`：`const resolved = buildV25Options(options, maxColors); resolved.localFusionEnabled = true;`——注释为 "Unified production entry: native sampling when safe, shared V2.5 finishing."。这是 **git diff 中的未提交新增行**（+239），即今天工作区内已把生产入口切到融合引擎。
- 消费链：`services/generation-job.mjs:49` `request.overrides?.localFusionEnabled === true ? runLocalFusionEngine : runGenerationPipeline`；Worker 侧 `generation.worker.mjs:22` 已带 `?v=20261014-fusion-production-1` 版本标记；`generation-request.mjs:85` 在融合/容差启用时才序列化 paletteId（身份修复后该路径才真正闭合）。
- 降级路径 `app.js:4022`：契约模块未加载时直调 `runLocalFusionEngine`。
- 因此**线上（deploy）目前仍是旧行为**：`deploy/app.js` 无 `localFusionEnabled`，`deploy/services/` 只有旧版 `local-fusion-engine.mjs` 且缺 `local-fusion-routing.mjs`——deploy 走 `runGenerationPipeline`，不 404、行为不变。融合切换只存在于工作区。

**结论：本线的校准工作（12 真实输入 + 25 夹具 + 身份修复 + 链路测试 + 浏览器验收）验证的正是这个已发生的切换。**生产启用的 auto 路由规则 = 硬门（pixel/logo 且 conf≥0.75）+ 结构包络 eligible → dominant，否则保守 V2.5——与校准工具 calibrated-auto 变体逐字同规则。

## 4. 发布阻断项（管家同步 deploy 前必须处理）

1. **必须同步 `services/local-fusion-routing.mjs`**：新版 `local-fusion-engine.mjs` import 它，缺文件则 Worker 链 `generation.worker.mjs → generation-job.mjs → local-fusion-engine.mjs` 在线上 404。这是唯一的硬阻断。
2. 同步后线上行为变化范围 = 第 3 节所述：仅少色平坦结构输入（真 Logo/像素画类）从 V2.5 切 dominant，其余零差异。已有 48 case 证据。
3. `.vercel/README.txt` 与 `.vercel/project.json` 不应进发布目录，建议清理。
4. 提交前建议把 IMPLEMENTATION / REAL-VALIDATION 的「未切换生产默认」表述更新为实际状态（本报告可作为附件），避免三线对同一事实各说各话。

## 5. 左栏迁移规划（只规划，不执行，不删除）

「左栏」= 工作台绘图工具栏 rail（`ui/workspace.js` 的 `ws-rail` / `#gridEditorToolbarHost`，含可折叠按钮 `#ws-rail-collapse`，折叠宽度 54px）。REAL-VALIDATION 的收栏前置条件（路由校准 ✓、真实人像/动漫 ✓、画板编辑/保存/导出一致性 ✓）现已全部满足。规划如下，执行权在 UI 线 + 用户：

1. **能力先行**：rail 内的工具动作（画笔、橡皮、取色、区域选择、撤销重做入口）先由 stage-c 的上下文工具区（contextual tool options）承接——该重构 UI 线已在做（测试 #970 contextual tool options reuse actual controls 当前挂起，属其收工范围）。
2. **单槽位收敛**：按 #1938「desktop rail is one vertical slot per primary tool」的口径，rail 从「常驻多按钮」收敛为单主工具槽位。
3. **折叠而非删除**：rail 保留折叠态（54px）作为可达性兜底，与「收起常驻设置」目标一致；删除动作不在本线职责内。
4. **验收**：迁移后重跑 `tests/workbench-consistency-chain.test.mjs`（编辑→保存→导出链路）与浏览器实机走查（参照 `docs/local-fusion-browser-acceptance/` 的方法论），确保工具搬家不影响生成与工程格式。
5. 时序：必须晚于管家提交与 deploy 同步，避免与发布窗口叠加。

## 6. 待用户决策清单

| # | 事项 | 本线建议 | 归属 |
|---|---|---|---|
| 1 | 生产默认保留融合引擎（app.js:2614 已启用，未提交） | **保留并提交**：有 12 真实输入 + 25 夹具 + 身份/链路/浏览器四层证据；不保留则校准工作无生产意义 | 用户批准 → 管家提交 |
| 2 | deploy 同步（含 local-fusion-routing.mjs，清理 .vercel/） | 随决策 1 一并做 | 管家 |
| 3 | 左栏迁移（第 5 节规划） | 前置条件已满足，可启动；晚于发布窗口 | UI 线 + 用户 |
| 4 | 上线授权（Vercel 项目 libai） | 三线收工 + 管家同步 + 回归绿后，由用户人工执行 | 用户 |
| 5 | 文档表述更新（IMPLEMENTATION/REAL-VALIDATION 的「未切默认」） | 提交时一并更正，引用本报告 | 管家或本线代拟 |

## 7. 本线红线遵守情况

未重排布局、未改色块条、未删左栏、未接外部 API、未自动上线；所有修改保留未提交；deploy 未同步；`deploy/.env.local`（Vercel 凭证）维持删除状态。本线全部修改清单：`smart-preprocessing/protected-palette-budget-v2.mjs`（paletteId 修复 4 行）、`tests/local-fusion-identity.test.mjs`、`tests/workbench-consistency-chain.test.mjs`、`tests/local-fusion-calibration.test.mjs`（+2 决策锁）、`tools/local-fusion-calibration.mjs`（--out/--inputs 参数，默认行为不变）、`docs/local-fusion-real-corpus*` 证据目录、`AI-COORDINATION.md`。
