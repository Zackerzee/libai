# AI-COORDINATION.md — 三 AI 协同作战规程

> 本文件是三个 AI 并发修改本仓库的唯一协调入口。开修前读一遍，动手上五分钟。
> 创建于 2026-10-14 13:05，创建者：负责验证与上线准备的 AI（只读源码，不碰 git）。

## 现状（截至 2026-10-14 13:05 实测）

- 3 个 AI 并发改同一个仓库，**无 git remote，本地是唯一一份代码**——任何人写坏都是永久损失。
- 已观测到的工作流：
  - **UI 重构线**：`ui/`、`state/`、`index.html`、`styles/workspace.css`、`tools/verify-ui-slim.mjs`、`tests/ui-refactor-baseline/`（最活跃，`ui/workspace.js` 一小时前刚被写过）
  - **品牌素材线**：`assets/brand/*`（MARD/Artkal/Hama/Perler 等 12 个品牌图）、`assets/libms-logo.png`、`assets/studio-bloom.svg`（未跟踪，未 commit，deploy 已同步）
  - **算法/基准线**：`.b4-bench-gate-probe/` 跑分产物（近一小时无写入，可能已收工）
- `deploy/` 当前漂移为 0（缺 0 / 旧 0 / 多 2 个 .vercel 链接文件），同步者在尽责，保持。

## 五条军规（所有 AI 强制）

1. **git 写操作只有「提交管家」能执行**：commit / add / stash / checkout / reset / worktree。其他 AI 只改工作区文件，永远不碰 git 命令。
2. **deploy/ 同步只能由提交管家在提交前统一跑**。任何人不得自行执行 `sync-deploy.mjs`——三家各自同步会把 deploy 混成三家半成品的拼接怪。
3. **热文件登记制**。以下文件三人共用，开改前必须在下表登记（AI 代号 + 开始时间），后到者等前人标「已收工」：
   - `ui/workspace.js`、`index.html`、`styles/workspace.css`、`app.js`、`state/store.js`
4. **删除类操作一律禁止**（`rm`、`sync --prune`、`reset --hard`），提交管家除外，且须先在登记区公示。
5. **测试随时可跑（只读无害）**，但对外报告结论必须注明快照时间——这个仓库的文件一小时能变一轮。

## 角色

| 角色 | 是谁 | 职责 |
|---|---|---|
| 提交管家 | **待用户任命**（本会话 AI 自愿担任：只读源码、最有动机保证每次提交是完整状态） | 唯一 git 写权限；收工后统一 commit + sync + 全量测试 |
| 各线 AI | 见下表登记 | 只改自己线的文件 + 登记热文件 |

## 工作线登记（开修前登记，收工后标状态）

| AI 代号 | 负责目录/模块 | 登记时间 | 状态 |
|---|---|---|---|
| 待填 | UI 重构线（ui/、state/、index.html、styles/workspace.css） | 2026-10-14 ~12:52 观测到活动，13:24 仍在写入 | **进行中——hot files 持有中** |
| 待填 | 品牌素材线 | 2026-10-14 观测到活动 | 进行中 |
| 本会话 | 验证 + 上线准备（只读，不碰源码/git） | 13:00 | 进行中 |
| 本会话 | 用户派活：规格行迁移（MARD/色数/颗数/图纸尺寸/实物尺寸 → 底栏，小字体，与 C06·颗数块合并） | 13:25 | **已转派 UI 线**——任务单见下方「§转派任务单」，本会话不执行 |
| 本会话 | **本地融合引擎开发（用户 14:56 正式指派接手）**：路由校准（Logo✅/文字✅回退已验证/像素画✅硬门验证）、真实人像动漫插画对比、正式工作台编辑保存导出一致性 | 14:56 | **Phase 1/2/3/4 全部完成**——真实照片（IFS 夜景）+真实动漫（古风立绘）补验闭合六类素材决策证据；收口报告 `docs/local-fusion-phase4-closeout.md`；待用户决策 5 项（见该报告 §6） |
| 融合线前任 | services/local-fusion-*.mjs、tools/local-fusion-calibration.mjs、docs/local-fusion-calibration/（14:19–14:21 完成 Logo 结构校准） | 14:21 | 已交付，由本会话接管 |

## 热文件登记

| 文件 | 持有者 | 开始时间 | 状态 |
|---|---|---|---|
| `ui/workspace.js`（左栏 rail 区域 `#gridEditorToolbar`） | UI 重构线 | 2026-10-14 22:27 观测到最后写入 | **持有中——未标收工**；本会话已登记「等待执行左栏迁移施工单」，UI 线标收工后本会话立即按下方施工单执行 |
| `app.js`（融合启用行 `localFusionEnabled`，约 L2614） | 本会话（关注） | 2026-10-14 23:50 | **工作区保持启用、未提交**——混在 UI 线 661 行 diff 中，待 UI 线收工后由管家随 UI 线版本一并提交；同时提交 `tests/fusion-app-migration.test.mjs`、`tests/unified-fusion-entry.test.mjs` |

---

## §左栏迁移施工单（用户 2026-10-14 23:40 批准启动，本会话执行，UI 线标收工后动手）

前置条件已全部满足（路由校准✓ 真实素材✓ 画板编辑/保存/导出一致性✓，见 docs/local-fusion-phase4-closeout.md §5）。本施工单只做「迁移 + 折叠」，**不删除左栏**。

### 现状（代码实测，ui/workspace.js）
- L150-154：注释「左轨只保留绘图工具；施工预览统一从保存与导出进入」；rail 内容已收敛为 `ws-rail-collapse`（折叠按钮）+ `#gridEditorToolbar`（绘图工具宿主）——UI 线 stage-c 已完成前半。
- 参考图节已整体搬去右栏（L847），左栏无残留。

### 剩余工作（承接区未完工，挂在测试上）
1. **contextual tool options 承接**（tests 挂：#970 `contextual tool options reuse actual controls rather than duplicate IDs`）：rail 内工具动作改由上下文工具区承接，**复用同一控件 ID，禁止 duplicate IDs**。
2. **rail 单槽位收敛**（tests 挂：#1938 `desktop rail is one vertical slot per primary tool without horizontal overflow`）：desktop 下 rail 每主工具一个竖向槽位、无横向溢出。
3. **折叠态保留**：`ws-rail-collapse` 与 54px 折叠宽度保留不动（可及性兜底，不删左栏）。

### 验收标准
- [ ] #970、#1938 两条测试转绿
- [ ] `node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)` 不引入新红（迁移前基线：21 个 stage-c 红 + 0 deploy-sync 红——deploy-sync 已于 23:52 随同步转绿）
- [ ] `tests/workbench-consistency-chain.test.mjs` 2/2 保持绿（编辑→保存→导出链路不受搬家影响）
- [ ] 浏览器实机走查一遍工具切换 + 折叠/展开（参照 docs/local-fusion-browser-acceptance/ 方法）
- [ ] 改完告知提交管家同步 deploy（sync-deploy.mjs，ui/ 在清单内）

### 执行时序
UI 线在 `ui/workspace.js` 标「已收工」前不得动手；动手期间在热文件登记表更新状态。若 UI 线收工时间晚于上线窗口，本施工单自动让位，迁入上线后的下一迭代。

## 上线闸门（顺序不能乱）

1. 三条线全部标记「已收工」
2. 提交管家：全量测试 → commit（信息注明包含哪几条线）→ `sync-deploy.mjs --check` 复验
3. 用户授权（生产操作）
4. 部署 → 管家复核线上资源 200

## 当前进度（2026-10-14 23:55 实测）

- **本线已收工并提交**：commit `586f86e`（277 文件：融合引擎 V1 + paletteId 身份修复 + 路由校准 + 全部证据）。deploy 已同步并 `--check` 零漂移（411 文件，`services/local-fusion-routing.mjs` 补齐、`.vercel/` 两文件已清），deploy-sync 测试 4/4 绿。
- **管家待办**（UI 线收工后）：① 提交 UI 线文件（app.js/index.html/ui/、styles/、state/）；② 一并提交 `app.js` 的 `localFusionEnabled` 启用行 + `tests/fusion-app-migration.test.mjs` + `tests/unified-fusion-entry.test.mjs`（三者必须同一个提交，否则 git 版本跑这两个测试会红）；③ 提交 deploy/ 同步结果；④ 全量回归（当前基线：21 个 stage-c 红，须降为 0 或 UI 线说明理由）。
- **左栏迁移**：施工单见下方「§左栏迁移施工单」，待 UI 线标收工后由本会话执行。

## 已知雷区（踩过的坑，别再踩）

- `deploy/.env.local` 曾含 `VERCEL_OIDC_TOKEN`（已删，待轮换）——任何人不得再往 `deploy/` 放凭证文件
- 最后一个 git 提交（9d46a5c）没同步 deploy/，干净签出发布不了——所以第 2 步的 sync 复验是强制项
- 跑测试必须显式枚举：`node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)`

## 事实同步：生产默认引擎已切换（2026-10-14 深夜，重要）

IMPLEMENTATION / REAL-VALIDATION 两份文档里「未切换生产默认」的表述**已过期**，以代码为准：

- `app.js:2614` `resolved.localFusionEnabled = true;`（未提交的新增行）已把生产入口切到 `runLocalFusionEngine`，auto 路由 = 分类器硬门（pixel/logo 且 conf≥0.75）+ 结构包络 eligible → dominant，否则保守 V2.5。
- 该行为已经本会话校准验证：12 个真实输入 × 4 变体 48 case 全过（非法色 0、paletteId 身份错配 0、尺寸精确、源图不可变），唯一策略翻转是真 Logo 走 dominant（预期目标）。证据：`docs/local-fusion-real-corpus-phase2/`。
- **管家同步 deploy 时的硬阻断**：必须带上 `services/local-fusion-routing.mjs`——新版 `local-fusion-engine.mjs` import 它，缺文件则线上 Worker 链 404。另建议清理 deploy 里多出的 `.vercel/` 两个链接文件。**（已于 2026-10-14 23:52 执行：sync --prune 补齐 routing、清理 .vercel，--check 零漂移）**
- deploy 当前是旧行为（app.js 无该启用行、缺 routing 模块），所以**现在上线不会 404、行为不变**；同步之后线上才变成融合行为，变化范围仅少色平坦结构输入。

---

## §转派任务单：规格行迁移到底栏（用户 13:15 截图派活，转 UI 线执行）

### 需求（用户原话）
「圈住的这个部分应该做在箭头指向的位置，同时把字体调小显示；右边选中的 C06 以及数量，和这个在一块显示可以。」

### 现状（截图 + 代码实测）
- 规格行现在渲染在画布上方中部：`MARD Standard 221` + `44种颜色 · 10816颗拼豆 · 104 × 104 图纸尺寸（格）· 27.0 × 27.0 cm 实物尺寸`，右侧带「已生成」状态。
- 底栏（viewBar）右侧现有：`C06 · 1389 颗` 色号块 + `施工图` `对照` 按钮 + `☑色号` `☑主网` 复选框；**左侧是空白区，即箭头指向的目标位置**。
- 全部渲染逻辑集中在 `ui/workspace.js`：底栏 DOM 约在 L200（ws-view-modes），数值更新走 paint()（约 L1944–L1951，ws-compare / ws-grid / ws-codes 一带）。

### 要做什么
1. **移动，不是复制**：规格行从画布上方整体挪到底栏左侧空白区；原位置清空（若「已生成」状态在原位置右侧，状态文案单独保留在生成面板——L1935-1941 已有 ws-generation-status，别重复造）。
2. **字体调小**：规格行在底栏用小字号（建议 11–12px，复用现有小字 token，别新造魔法数），保证对比度可读。
3. **合并成一块**：底栏左块 = 规格行信息 + 当前选中色（`C06 · 1389 颗`）在**同一视觉组**里连排显示；底栏右侧的 施工图/对照/色号/主网 保持原位不动。
4. **数据必须走单一真源，禁止重算**：
   - 品牌/系列名（MARD Standard 221）：现有 palette brand 数据源（ui/palette-brand-cards.mjs / palette-brands.mjs）
   - 色数：`state.stats.usedColors`（L1931 已在用）
   - 图纸格数：`state.canvas.width × state.canvas.height`（L1931 已在用）
   - 总颗数：复用现有统计字段，别新写一遍累加
   - 实物尺寸（cm）：复用现有格数→物理尺寸换算（导出服务里已有，104 豆板逻辑附近）
   - C06 色号 + 颗数：当前 palette id 走 `readCurrentPaletteId(state.editor)`（L1957 已在用）+ `editorService.resolveColor(...).code`；该色颗数取现有按色统计
5. **更新必须走 paint()**：底栏数值只能由 paint() 写 DOM（和 ws-compare/ws-codes 同一条路径），保证状态变化时实时刷新；不要另起定时器或一次性渲染。
6. **别踩重构中的雷**：执行者正在做 UI-slim 重构——动手前先确认自己当前的工作树状态，把这个改动合并进你手中的版本，不要基于旧快照改。

### 验收标准
- [ ] 截图中的规格行在原位置消失，信息完整出现在底栏左侧
- [ ] 底栏左块内：规格信息与 `C06 · 1389 颗` 同组连排，小字号
- [ ] 右侧 施工图/对照/色号/主网 位置与功能不变
- [ ] 换色号 / 重新生成 / 改尺寸后，底栏数字实时更新（paint 路径）
- [ ] `node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)` 不引入新红（基线：HEAD 挂 2 个 deploy-sync，工作区另 21 个重构中态红——不许新增）
- [ ] 改完在 `deploy/` 同步前告知提交管家
