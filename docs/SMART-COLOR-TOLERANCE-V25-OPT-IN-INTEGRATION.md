# SMART COLOR TOLERANCE — V2.5 opt-in 接入验收

日期：2026-10-10。仅完成默认关闭的生成链路接入；没有 UI、导出重构、推荐强度或发布。性能门发现明显同步阻塞，停止后续 UI 接入。

## 1. 实际接入源码位置

- `smart-preprocessing/generation-engine-v2.mjs:463`：Smart Cleanup、可选 Spatial Refine 完成后，Protected Palette Budget 前执行。
- `services/mode-profile.mjs:317`：仅透传 `smartColorTolerance` 和 `smartToleranceContext`，不混入 legacy merge threshold。
- `app.js` 的 `buildV25Options`、`processImageV2`、`LibmsWorkspaceBridge.updateSmartColorTolerance`：生产 V2.5 配置、提交和无 UI 强度重放入口。
- 没有接到 legacy、PW/BGS、sampling/matching/cleanup 之前或 editor reduction。

## 2. baseline 创建位置及不可变性

`generation-engine-v2.mjs:468` 捕获 `{grid,palette,protection,colorsAfterCleanup,budgetConfig,context,algorithmVersion}`，深拷贝并递归冻结；typed protection arrays 转为普通冻结数组。context 包含源图参数和本次生成的 gridRevision。随后产生 baselineRevision；不读取 `generationOriginalGrid`。

预算只修改容差求值返回的隔离矩阵，不修改 baseline。revision 是内容 FNV32+长度标签，**不单独作为缓存等价性证明**；session 同时核对完整 baseline evidence 和完整 context，app 使用完整序列化 context，不用短 hash 判定源图等价。

## 3. store / cache 字段及 API

正式状态仅存于现有 store：

- `processingState.smartColorTolerance = {enabled:false,strength:0,policy:'quality-first'}`。
- `patternState.smartToleranceReport`、`patternState.smartToleranceBaselineRevision`。
- 唯一正式作品矩阵仍为 `patternState.grid`，是 tolerance + budget 的最终矩阵。

`services/smart-tolerance-session.mjs` 维护可丢弃派生 baseline/controller/cache，提供 `adoptBaseline(value,context,compiled)`、`evaluate({strength,requestId,baselineRevision})`、`invalidate(context)`、`clear()`、轻量 `getMetadata()` 和诊断 `getCache()`。缓存字段包含 baselineRevision、configHash、hierarchy、evaluatedResults；最多八档求值 LRU，避免保存 101 张大矩阵。

生成阶段通过 `diagnostics.smartToleranceHierarchy` 传递 `{format,ids,protectedCells,steps,rejections}`；V1 `restoreSmartColorTolerance` 恢复已有层级，不重复保护、ΔE、局部对比或层级构建。compiled 是可信内部派生数据，不是工程导入格式，不重复携带 grid。

## 4. invalidation 与异步提交

完整 context 覆盖 source image、crop/source transform、尺寸及尺寸权威值、engine、palette、available colors、cleanup、protection、spatial refine/options、算法版本和 budget 配置；同时观察真实 canonical panel settings，避免参数已改但 production options 快照未刷新的漏洞。排除 strength 和 requestId。

参数变化在重放/配置更新时惰性清缓存；提交时再次核对完整 context，因此旧结果不能提交。关闭配置主动清缓存。manualEdited、canonical grid 对象替换也阻止旧基线重放。

初次生成提交验证 requestId、本次 pending baseline revision 和 context；重放提交验证 requestId、baselineRevision、session epoch、canonical grid 身份、engine、enabled/policy 和 context。`20→80→30` 的延迟结果只能提交 30。

## 5. enabled=false 等价性

默认关闭保持原预算及 accent 路径，关闭时不创建 baseline/hierarchy、无新增引擎诊断字段。请求与 app 提交仅在 enabled=true 时保留新增 paletteId，确保关闭生产路径不改变旧 branded palette/grid 形状；缺字段视为关闭。

除了 missing/explicit-off 比较，保存了**接入前 deploy engine 的固定矩阵**：12×12、17×11，maxColors=0/1/2，accent=false/true，含透明 null，12 项逐格深比较。oracle engine SHA256：`34f7d939c6f6cf99f10677f8bf43f0bee1ca4b468eadcdd1a0d34fc64824672b`。测试不依赖以后被同步覆盖的 deploy 输出。

## 6. 新增测试

六份新增测试文件共 **51/51 通过**：

| 文件 | 数量 | 重点 |
|---|---:|---|
| smart-tolerance-engine-integration.test.mjs | 9 | seam、0、budget、单调、身份、forced、compiled 重放 |
| smart-tolerance-session.test.mjs | 17 | 请求乱序、revision、十类失效、缓存、无累计、非法强度 |
| smart-tolerance-identity-transport.test.mjs | 4 | 同 RGB 多品牌、跨线程隔离、关闭历史形状 |
| smart-tolerance-app-wiring.test.mjs | 6 | store、真实 bridge VM、panel 失效、最终 canonical grid |
| smart-tolerance-production-pipeline.test.mjs | 3 | production runner、refine-before-budget、mode 透传 |
| smart-tolerance-preintegration-golden.test.mjs | 12 | 接入前保存矩阵逐格等价 |

V1 原 27 项与上述一起 **78/78 通过**。实际 bridge VM 使用真实 session / V1 / budget；`0→20→50→80→0` 最终 state.grid 等于固定基线经 budget 的结果，前置生成调用为零，最后一次缓存命中。compiled replay 特意提供不可重新分析的 protection evidence，证明未重建层级。测试不是浏览器端到端 UI 验收。

## 7. 扩展回归

覆盖 `tests`、`smart-preprocessing`、`src`、`state` 四个测试根：**2059 项，2058 通过、0 失败、1 跳过**，约 39.7 秒。最终诊断 notice 微调另经相关 78 项复验；关闭 golden 及 enabled 统计均通过。deploy-sync 排除：本阶段明确禁止同步部署包；跳过项为既有可选联网探测。更新两份状态默认值/字段数量快照，仅因新增三个正式字段，未删除旧断言。

## 8. 四档性能及停止门

Apple M4 / macOS / Node v22.22.0；每档五次。真实 V2.5 sampling/matching/protection/cleanup 的合成相邻灰阶基线实际为 **2 色**。单位 ms，P50 / P95：

| 尺寸 | initial hierarchy build | evaluate cold | cached isolated clone | 同步 event-loop delay |
|---|---:|---:|---:|---:|
|52|12.07 / 17.16|2.89 / 3.05|1.65 / 2.09|16.69 / 21.93|
|78|22.68 / 22.94|6.23 / 6.66|3.86 / 3.93|32.91 / 33.53|
|104|42.21 / 42.79|11.25 / 11.91|6.96 / 7.62|60.57 / 62.08|
|500|981.86 / 1008.30|260.92 / 267.52|191.99 / 196.92|1431.75 / 1463.59|

500 最大 heap **点采样** 592.31 MiB，不是精确峰值。另有真实 8 色四档表及 104×104、32 色补测，后者 build P50/P95=436.23/769.78 ms。

阻塞是 Node 同步 event-loop 代理，**不是浏览器 LongTask/帧率实测**。不包含 Worker 传输、baseline fingerprint/freeze/compiled restore、budget、store/render commit；缓存计时是隔离结果 clone 而非整个 session 热路径。P95 在五个样本下为最大值。不能把局部数字称为完整生成成本或生产保证。详见 `SMART-COLOR-TOLERANCE-V25-PERFORMANCE.md`。

存在明显同步阻塞，性能门不通过；不进入 UI 接入，也不提供“推荐强度”。compiled 修复消除了首次重放的重复分析，但未消除大矩阵求值、拷贝、预算成本。

## 9. tolerance 与 budget 各自减少色数

分开记录 `colorsAfterCleanup`、`colorsBefore`（refine 后固定基线）、`colorsAfterTolerance`、`colorsAfterBudget`，以及 `toleranceMergedColors/mergedByTolerance` 与 `budgetMergedColors/mergedByBudget`。

strength=80、maxColors=1：2 色 fixture 为 tolerance 0 / budget 1；8 色 fixture 为 0 / 7；104×104、32 色 fixture 为 **tolerance 1 / budget 30**，最终 1 色。没有把硬预算降色归功于智能容差。

## 10. forcedProtected / Debug

上述性能 fixture forcedProtected=0；两个 CRITICAL 保护色、maxColors=1 的显式冲突单测实际 forcedProtected=1。硬预算仍沿用既有行为，不承诺保护色不被其牺牲。

`budgetForcedProtected`、`forcedProtected` 单独统计；凡硬预算继续减少颜色，report 带：

> Smart tolerance preserved protected colors, hard palette budget subsequently forced additional merges.

不称最终矩阵“无损”或“智能容差最终结果”。`[smart-color-tolerance]` 日志按现有 commitProfileOn 控制，包含 enabled、strength、baselineRevision、各阶段色数、分别减少数、protectedConflicts、forcedProtected、hierarchyLevel、cacheHit、runtimeMs；不打印完整 baseline。

## 11. 已知导出与其他风险

未修改 getExportGrid、Export V2、JSON 或 Pixler export。当前 legacy getExportGrid 在预算验证失败时仍可能对 state.grid 的副本再次预算；本阶段不能保证导出对已生成矩阵没有二次处理，留待下一阶段统一。

其他已知限制：合成性能 fixture 不是实图质量标定；compiled snapshot/保护数组/拒绝记录有传输和深拷贝成本；缓存惰性失效会暂留旧内存但不会允许旧提交；浏览器完整工作流、真实图质量和端到端主线程预算尚未实测。版本 context 使用当前 `v1-optin-1`，以后算法升级须同步版本口径。没有 UI、上线、导出二次处理或推荐算法。

## 12. Git 与实际修改文件

BASE = HEAD = `b13fcae619e4d9c461e94d09e346f0ad5cf80c45`。工作树 **dirty**，未创建提交；本任务开始时即有大量既有修改，均保留。没有修改 deploy 或部署。

本任务实际涉及：

- app.js；state/store.js；state/project-store.js。
- smart-preprocessing/generation-engine-v2.mjs。
- services/mode-profile.mjs；services/generation-request.mjs；services/generation-result-codec.mjs。
- services/smart-color-tolerance.mjs（compiled 恢复 API）；新增 services/smart-tolerance-budget.mjs、services/smart-tolerance-session.mjs。
- 上表六份新增测试；state/store.test.mjs；tests/ui-refactor-baseline/project-store-snapshot.test.mjs。
- tools/smart-tolerance-performance.mjs；STATE-MIGRATION.md；本报告；SMART-COLOR-TOLERANCE-V25-PERFORMANCE.md。

停止点：默认关闭的 V2.5 opt-in 功能接线与回归完成；性能门不通过，等待确认后再单独处理性能，不继续 UI、导出或发布。

## 13. 独立 checkpoint 兼容适配验收（2026-10-10）

本节更新 checkpoint 状态；上文测试、性能和 Git 数字属于接入阶段的历史记录。此次没有开始性能优化，也没有同步部署。

两个未提交 helper 原属 app.js 的独立可用色卡功能：`getAvailablePaletteIds` 读取当前 paletteKey 的本机身份白名单（null 表示完整色卡）；`getGenerationPaletteColors` 按白名单过滤真实 registry 对象，保留原顺序，空集报错，不按生成模式变色。该功能的 UI、store availability 字段、helper 及品牌注册修改均不纳入 checkpoint。

HEAD `b13fcae` 已提供 `PALETTES`、`getCurrentPaletteKey/getCurrentPalette`、V2.5 的实际 palette 入参及 `services/palette-identity.js`。身份读取沿用已有 `paletteIdOf` 合约：显式 paletteId 优先，否则原有 legacy code 身份；不猜品牌、不生成编号、不按 RGB/hex 去重。

新增 `services/smart-color-tolerance-palette-adapter.mjs` API：

```js
resolveSmartTolerancePaletteContext({ paletteEntries, paletteKey })
// → { paletteEntries, paletteIds, paletteKey }
```

输入必须为调用方的真实、非空合法生成色卡。适配器仅复制外层数组、保留真实 entry 对象并验证身份和 RGB；缺失、非法或重复身份明确失败。生产 `processImageV2` 只在 enabled 时加载适配器，显式传入实际 palette/key；context 与冻结 baseline 捕获实际子集。重放缓存保留该子集，registry/key 变化使 context 失效。调用方若改变可用集合，须显式提供新的 `updateSmartColorTolerance({strength,paletteContext})` 或重新生成；此适配层不监听或重建未提交的 availability 系统。

Smart 路径已完全移除对两个 helper 的引用；checkpoint 的原生产 caller 保留 HEAD 的 `getCurrentPalette()`。关闭时不加载、不调用适配器，并通过接入前固定矩阵逐格等价测试。

只读语义对照 **8/8 PASS**：真实 HEAD／工作树 MARD 291、Artkal 197 的全卡与合法子集，以及 MARD T01／Artkal C01 同 RGB 的跨品牌身份。运行当前 app 的实际 helper，再将其真实 V2.5 输入传入适配器；entry 对象、code、paletteId、RGB、身份集合、数量、顺序与 key 完全保留。仅证明容差上下文等价，不宣称整个可用色卡系统等价。

原 **78/78** 均保留，适配器新增 **9/9**，接线补充 **4/4**，合计 **91/91 PASS**。新增真实 bridge 的延迟加载乱序测试：入口同步取得 requestId 和 baselineRevision；每个 await 后核验请求、baseline、grid、enabled/policy 与 context，旧请求不得写配置/色卡上下文或覆盖较新的强度。

暂存树由 **HEAD + 本功能 26 文件** 导出到独立本地 clone，没有未提交 UI、导出、deploy、品牌、V3 或可用色卡逻辑。独立树本功能 **91/91 PASS**；四根扩展回归 **1781 项 / 1780 PASS / 0 FAIL / 1 SKIP**。完整 dirty 工作树同范围扩展回归 **2073 项 / 2072 PASS / 0 FAIL / 1 SKIP**。deploy-sync 按本阶段禁止部署要求排除；两树计数不同来自未纳入 checkpoint 的既有功能测试，而非删除回归。

混合的 app.js、generation-engine-v2.mjs、store/project-store 及两份状态快照测试均使用 partial staging，只纳入 Smart hunks。未使用 stash；原工作树从未被隔离/还原，独立验证使用另一个本地 clone。完整备份及剩余 dirty 清单保存在未提交的 `docs/_tmp-smart-color-tolerance-checkpoint-state.txt`。性能报告/工具与 STATE-MIGRATION 的历史未提交修改保留在原树，不纳入此次 26 文件 checkpoint。

checkpoint 文件：app.js；本目录 AUDIT、V1、本 V25 报告；services 下 generation-request、generation-result-codec、mode-profile、smart-color-tolerance、smart-color-tolerance-quality、smart-color-tolerance-palette-adapter、smart-tolerance-budget、smart-tolerance-session；generation-engine-v2；state/store、state/project-store、state/store.test；tests 下三个 smart-color-tolerance 测试及六个 smart-tolerance 测试；ui-refactor-baseline/project-store-snapshot.test。

提交后须再从 checkpoint 创建干净 clone 复验。本节不将尚未完成的提交后验证提前声明为成功；最终 CHECKPOINT SHA、完整状态列表及复验结果写入不提交的审计文件并由最终回复报告。完成后停止，等待性能阶段授权。
