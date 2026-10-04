# Stage B 架构

> 读者：要动生成链路的人。
> 目的：**回答「这条链路上什么是权威、什么是派生、什么已经冻结」**，而不是复述代码。
> 代码里的注释解释「为什么这么写」；这份文档解释「这些东西怎么拼在一起」。

---

## 0. 一句话总览

一次生成，从用户的动作到画布上的 canonical grid，只经过**一个**模式表、
**一个**颜色身份、**一个**执行边界、**一个**提交出口：

```
用户动作（改参数 / 点模式卡 / 应用尺寸）
  → scheduleAutoGenerate(320ms 去抖)
  → generation-service.generate()          ← 唯一写 status.generating 的地方
  → bridge.generate({maxColors, overwriteApproved})
  → processImage → processProductionV2      ← state.isProcessingImage 互斥锁
  → processImageV2
      ├─ runAutoTuneV2   （仅「智能」模式；小尺寸比候选，再按目标尺寸生成一次）
      └─ runGenerationJob（其余情况；三级降级，默认走真实 Worker）
  → 提交：state.grid / stats / chartUrl / libms:project-result / gallery / status
```

**四把锁**（改任何一处之前先读这一节）：

| 锁 | 唯一真源 | 文件 |
|---|---|---|
| 模式 → 配置 | `MODE_PROFILES` | `services/mode-profile.mjs` |
| 当前颜色 | `editorState.currentPaletteId` | `services/current-palette.mjs` |
| 执行边界 | `runGenerationJob` | `app.js` |
| 提交出口 | `processImageV2` 的收尾段 | `app.js` |

---

## 1. Palette system（Stage B1）

### 1.1 颜色身份是 `paletteId`，不是色号字符串，也不是 RGB

生产网格的格子是 `{code, rgb, hex}` —— **没有 paletteId 字段**。
`paletteId` 是「用户在色板上选中的那一个」的稳定身份，形状是
`<brand>-<count>:<CODE>`（见 `services/current-palette.mjs` 的头部注释）。

为什么不能用别的当身份：

- **色号字符串**（`"H5"`）—— 不同品牌的 `H5` 是两种颜色；同一个色号在不同
  count 的色板里也可能不存在。
- **RGB 反查** —— 两个不同色号可以有同一个 RGB；反查会在「同色不同号」时
  静默选错一个，而且这个错误在图上完全看不出来。
- **`selectedColor` 槽位** —— B1 §6 的实测缺陷：工作台写字符串色号、
  旧编辑器写完整颜色对象，**同一个槽位两种类型**。结果是打开旧编辑器就把
  工作台刚选的色静默清成 `null`。现在那个槽位归还给旧编辑器，工作台一律不读不写。

### 1.2 色板 registry

- 来源：`smart-preprocessing/palette-brands.mjs`（自动生成，勿手改）。
  数据来自 `HansBug/pindou-color-data`（MIT），**只搬颜色数据与元信息**，
  不含任何来源源码。8 个品牌 / 2158 色。
- 系列（series）的唯一真源：`services/palette-series.mjs`。
  **禁止**把 `code.match(/^[A-Z]+/)` 当成唯一的系列逻辑 —— 盼盼 / 咪小窝的
  官方色号是纯数字（`"65"` / `"29"`），正则返回 `null`，会让它们 7 个中文系列
  在界面上整体消失。优先级：显式 `entry.group` > 色号字母前缀 > 无系列（空串）。
- Picker 是**懒渲染**：色板按品牌异步 `import`，`libms:brand-palettes-ready`
  到达后重建下拉并恢复选中项。

### 1.3 用色统计与替换

- `services/palette-usage.js` 出统计，`services/palette-usage-strip.mjs` 渲染。
- 全局替换走既有的 `#ws-replace-*` 流程，**一次用户动作 = 一条 History Entry**。
  回归守卫：`tests/palette-usage.test.mjs` / `tests/current-palette-id.test.mjs` /
  `tests/eyedropper-palette-id.test.mjs`。

---

## 2. Background safety（Stage B2）

### 2.1 从「无条件算子」到「有置信度的算子」

`smart-preprocessing/auto-background.mjs` 的边框连通 flood fill 本身没有错，
但它对输入毫无抵抗力：浅灰渐变、主体与背景同色、白底白衣，它都会**安静地**
删掉一大片本该保留的豆。用户看到的是「我的图被啃了一块」，而不是「算法不确定」。

`smart-preprocessing/background-reliability.mjs` 把它变成三态门：

| 结论 | 含义 | 行为 |
|---|---|---|
| `reliable` | 5 个独立指标全部过线 | 应用掩码 |
| `uncertain` | 有任何一项没过 | **NO-OP** |
| `none` | 这张图压根没有可分离的纯色背景 | **NO-OP** |

### 2.2 三条纪律

1. **不用单一阈值判可靠。**「ΔE < X 就算可靠」被明确禁止 —— 任何单一数值都能
   被某一类图绕过去。5 个指标（边框一致性 / 种子一致性 / 前景分离度 / 连通性 /
   内部风险）互相独立，每个都必须过线。
2. **不确定就 NO-OP，不给「部分掩码」。** `uncertain` / `none` 一律返回
   `mask: null`、`removedCount: 0`。从结构上排除「半抠」这种最糟的结果。
3. **不针对样例写 if。** 五个指标都是可解释的通用量，没有「这张图叫什么名字
   就怎么判」形状的特判。

### 2.3 null 是**结果**，不是缺失

被去掉的格子就是 `null`，它必须一路活到最后：

```
B2 mask → Worker 回包 → Auto Tune winner → ModeProfile → cleanup
  → canonical commit → Undo/Redo → Export
```

任何一环把 `null` 重新填成颜色，都是**静默的数据损坏**（用户看不见，导出才炸）。
另外两条硬约束：

- `transparent`（真透明 PNG）**不得被当成 solid background** 去抠。
- 主体内部的同色区域必须保留（只有「与边框连通」的区域才算背景）。

回归守卫：`tests/background-reliability.test.mjs`、
`tests/background-mask-integrity.test.mjs`、`tests/background-transparent-source.test.mjs`、
`tests/background-internal-color.test.mjs`、`tests/background-worker-integration.test.mjs`。

---

## 3. Worker architecture（Stage B3）

### 3.1 边界

| 文件 | 职责 |
|---|---|
| `services/generation-request.mjs` | 可序列化契约：request / result / error 都是纯数据 |
| `services/generation-job.mjs` | 唯一执行入口 `executeGenerationJob`，纯计算、无 DOM |
| `services/generation.worker.mjs` | 真实 Web Worker 壳：收 request → 调 job → 回 result。**不做任何算法** |
| `services/generation-worker-client.mjs` | 主线程侧：组装 request / postMessage / progress / 取消 / 提交 |

主线程**一行算法都不跑**。图像数据用 Transferable 零拷贝搬，
结果用紧凑契约回（palette + Int32Array 下标），避免 25 万个对象跨线程克隆。

### 3.2 三级降级（`runGenerationJob`）

```
① !job || !contract          → 直调 runGenerationPipeline（契约不完整时的兜底）
② client?.supported          → client.run(request)      ← 生产默认路径
     失败 → console.warn("生成 Worker 失败，退回主线程执行")
             （AbortError / StaleGenerationError 原样上抛，不当失败）
③ job.executeGenerationJob   → 主线程直算
```

`client.supported` 一旦为 `false` 就**永久**为 `false`（`worker.onerror` 里置位、
无复位），之后每次生成都静默退回主线程 —— 而界面、结果、导出全都正常，
只有「主线程卡 1 秒」这一个症状。所以**判据必须是发包取证**，不能是
「构造了几个 Worker」：客户端会缓存 Worker 实例，第二次之后构造数恒为 0。

### 3.3 取消与陈旧

- **取消 = 真 `terminate()`**，不是「标记一下等它跑完」。500×375 要跑几分钟，
  「假装取消、其实还在算」既费电又占 CPU。被取消的那次以 `AbortError` 结束。
- **陈旧结果是双保险**：`app.js` 的 `isStaleGenerationRequest` 是第一道，
  Worker 客户端自己记的「最新 requestId」是第二道。两道都留 ——
  「旧结果覆盖新图纸」是这一阶段最不能出的错。
- 取消 / 陈旧 / 延后都是**预期结局**：只提示、不报错，不写
  `state.lastGenerationError`（否则用户会看到一条他没犯过的「生成失败」）。

---

## 4. Mode routing（Stage B4 §2）

### 4.1 唯一模式表

`services/mode-profile.mjs` 的 `MODE_PROFILES` 是**唯一**的「模式 → 生成配置」来源。
`services/generation-pipeline.mjs` 的 `GENERATION_MODE_PRESETS` 是它的**视图**
（re-export），不是第二份数据。B4 §1 的只读审计抓到的三张互相不一致的表：

| 表 | 处置 |
|---|---|
| `generation-engine-v2.mjs` 的 `GenerationProfiles` | 生产链路**不可达**（没有 `preset` 字段 → 恒定回落 `photo`），**已删除** |
| `generation-pipeline.mjs` 的 `GENERATION_MODE_PRESETS` | 活表，改为 `MODE_PROFILES` 的视图 |
| `app.js` 的 `buildV25Options` | 只做「模式 → 请求参数」的适配，不再自造数值 |

### 4.2 8 个公开模式

`beginner` 小白一键 / `auto` 智能 / `portrait` 人像 / `anime` 动漫 /
`illustration` 插画 / `pixel` 像素 / `logo` Logo / `photo` 写实。

界面只暴露这 8 个，**不得出现底层算法名**（回归守卫：
`tests/stage-b-release-freeze.test.mjs` 的 §19 组）。

### 4.3 单位口径

模式表的数值字段一律 **0–100**（UI 滑杆 / store / project-store 的口径）。
引擎侧（`generateV2`）要 0–1。换算**只发生在 `toEngineOptions` 一处边界**。
双口径是历史包袱，但把它收敛到一个边界比散落各处的 `/100`、`*100` 安全得多。

### 4.4 契约三条（不是风格建议）

1. **一个模式一行**，字段与单位写在 `MODE_PROFILE_FIELDS` 里，每个字段必须声明
   **下游读者**。
2. **每个字段都必须有下游读者。** 审计抓到 `cleanupStrength` 从 UI 一路走到
   `resolveOptions` 然后被丢掉 —— 8 个模式的清理强度**全部无效**，
   `pixel`（10）与 `logo`（85）行为逐位相同。
3. **路由规则必须声明它依赖哪个证据字段。** 证据缺失 → 该规则**不参与**，
   不拿 0 当证据。审计抓到 `portraitLikeness` 被硬编码为 0，而 `auto` 的第一条
   规则就是 `portraitLikeness >= .65` —— 这条规则在数学上永不触发。

守卫：`tests/mode-profile-contract.test.mjs` 逐字段反查消费点。

### 4.5 `auto` 怎么选

`resolveRoutedMode(mode, analysis)`：

1. 非 `auto` → 原样返回（模式是用户的显式选择）。
2. `auto` → 先看 `analysis.routing.mode`（`services/source-classifier.mjs` 的
   `classifySource()` 产出）。只要它是合法的引擎模式名就以它为准 ——
   **包括它判「信心不足」时返回的 `"auto"`**：那是「不要强猜」的明确表态。
3. 再逐个 `MODE_ROUTING_RULES`（显式证据兼容路径，主要服务于契约测试）。

---

## 5. Auto Tune（Stage B4 §13，B5 §2 冻结）

### 5.1 它**不创造新算法**

Auto Tune 只从一组「已验证的候选 Profile」里挑一套。
候选定义在 `services/auto-tune-profiles.mjs`，是唯一来源。

### 5.2 三条硬纪律

1. **不复制完整配置对象。** 每个 Profile 只写 `overrides`（相对
   `MODE_PROFILES[routedMode]` 的**增量**）。复制一整份的后果不是报错，
   是「模式表改了、候选还是旧值」—— 而那个候选看起来还在正常工作。
2. **候选不许改取景。** `FRAMING_INVARIANT_FIELDS = [subjectCrop, autoBackground,
   strokeProtection, accentProtection]`。取景一变，任何按归一化坐标做的比较都不再
   成立。不是靠纪律，是靠测试会红。
3. **REJECT 的算法不许回到搜索空间。** `AUTO_TUNE_LAB_CANDIDATES` 只允许
   `bean-fit`；`PRODUCTION_LAB_CANDIDATES` 是**空集**。

### 5.3 排序用字典序，不用加权分数

§10 明确不要 `score = 0.273*A + 0.194*B + …`。理由不是「权重难调」，
而是加权分数**无法解释**：候选 X 以 0.003 优势胜出时，报告里只能说「它分更高」，
说不出「它高在哪」。字典序给出的是一句话：「先看 detailRetention，
差 0.01 以内才比下一项」。

`epsilon` 是无差异阈值；`epsilon: null` 表示这一项没有阈值（只有前面全部打平时
才会用到，用来在完全同分时给出确定的顺序）。

**一处值得记住的教训**：`beginner` 的第一判据原本是 `usedColors`，结果一条
把整幅图糊成纯色的候选**胜出**了 —— 它的用色数是 1、碎化 0、孤立像素 0，
按 §9 那四项字面意义它确实「最好」，可它把图毁了。而且硬约束拦不住它
（`structureLossTolerance` 是 0.05，糊色只要没把 `detailRetention` 打掉 5% 就能过）。
修法是把 §9 自己列在第一位的「稳定」放回第一位：先用 `detailRetention` /
`flatAreaStability` 保证图**还在**，再谈色数、碎片、风险。

### 5.4 缓存（排查时必须知道）

Auto Tune **带缓存**，键 = 源图 + 尺寸 + 模式 + overrides 指纹 + crop 指纹。

后果：同一张图、同一个尺寸、同一个模式**再生成一次会直接命中缓存** ——
整轮 `generationMilliseconds` 只有 52ms，Worker 一次包都不发，
`isGenerating()` 整个窗口都是 false。

> 这不是 bug，但它会让「再点一次生成看看」这类排查彻底误导人：
> 你看到的不是「生成没跑」，而是「生成跑得太快，快到你没看见」。
> 真机探针踩过这个坑（见 §8.2）。

---

## 6. Rejected algorithms（Stage B4 §0 裁定）

四个算法被**明确否决**，仍然以 lab 候选的形式存在于 `smart-preprocessing/lab/`
（Lab 是实验场，不是产品路径），但**一个生产入口都不许够到**：

| id | 名字 | 否决理由（摘要） |
|---|---|---|
| `dual-mode` | Dual Mode | 双模式分流没有带来可测收益，却让「这次用的哪套」变成运行时未知量 |
| `spatial-refine` | Spatial Refine | 空间细化在边缘上过度处理，碎化翻倍 |
| `conservative-cleanup` | Conservative Cleanup | 「保守清理」的失败形态与过度清理同源 |
| `neutral-protection` | Neutral Protection | 中性色保护被颜色复杂度绕过 |

冻结的方式**不是「默认关」而是「不可达」**：

> 「默认关」是一个可以被一次误操作打开的开关；「不可达」是结构上到不了。
> 一个被明确否决的算法留在搜索空间里，代价不是「可能被选中」，
> 而是**它会被当成一个仍然有效的选项** —— 下一次调参的人会重新评估它、
> 重新写一份报告、重新得出同一个结论。冻结的意义是终止这个循环。

守卫：`tests/stage-b-release-freeze.test.mjs` 断言这些 id 不在生产白名单、
不在候选集、不出现在 `app.js` 里。

---

## 7. Production algorithm set（Stage B5 §1 冻结）

**全部 OFF**：Dual Mode / Spatial Refine / Neutral Protection /
Conservative Cleanup / Bean Fit。

**Auto Tune 只对「智能」（`auto`）模式启用**：`AUTO_TUNE_PRODUCTION_MODES === ["auto"]`。
其余 7 个模式继续用**固定的** ModeProfile，不调优 —— 它们的候选集里只有
`standard` 一个，或者干脆不参与调优。

---

## 8. 提交路径与性能（Stage B5 §12–§14）

### 8.1 分段 profile（默认关闭）

打开方式：`window.__libmsProfileCommit = true`，然后读
`window.__libmsCommitProfile`（数组）与 `window.__libmsCommitProfileMeta`。

段名：`gridObjectConstruction` / `materialStats` / `originalGridClone` /
`chartUrl`（内含 `chart.previewRender` / `chart.previewEncode` /
`chart.exportRender` / `chart.exportEncode`）/ `uiUpdate` / `eventPayload` /
`eventDispatch` / `gallery` / `status`，加上 `decodeMs(workerClient)`、
`commitTotal`、`processImageV2Total`。

`commitTotal` 会**排除** `chart.*` 子段与前两项汇总项，避免重复计数。

### 8.2 500×500 的实测归因

| 段 | 耗时 | 说明 |
|---|---|---|
| `gridObjectConstruction` | 11.5 ms | 建 25 万个对象。B3 原先怀疑的就是它，其实只占 1% |
| `materialStats` | 17.2 ms | 全图统计 |
| `originalGridClone` | 3.9 ms | 整图深拷 |
| **`chartUrl`** | **463.1 ms** | 其中 `chart.exportRender` 303.7 + `chart.exportEncode` 97.0 |
| `uiUpdate` | 12.5 ms | |
| `eventPayload` | 0.0 ms | `getResult()` 只花 0.1ms |
| **`eventDispatch`** | **387.4 ms** | 全在**同步监听者**里（`ui/workspace.js` 的 `libms:project-result` handler） |
| `gallery` | 92.5 ms | |
| **`commitTotal`** | **988.1 ms** | |
| 主线程最长任务 | 1111 ms | |

**结论**：提交段的两大项是**图纸渲染**（`PATTERN_EXPORT` 在 `maxSide > 160` 时
`cell=10` + `margin=50` → 500 档要画 5100×5100 画布并 PNG 编码）与
**同步事件监听者**（`ui/workspace.js` 的 `libms:project-result` handler）。
B3 怀疑的网格构建只占 3–11ms。

### 8.3 尺寸曲线（场景 P，§14 要求逐档记录）

| 长边 | 格数 | `commitTotal` | `chartUrl` | `eventDispatch` | `gridObjectConstruction` | 主线程最长任务 |
|---|---|---|---|---|---|---|
| 104 | 10 816 | **54–71 ms** | 30 | 18–33 | 0.2 | — |
| 200 | 40 000 | **155–158 ms** | 77 | 62 | 1.0–1.1 | — |
| 300 | 90 000 | **330–332 ms** | 165–166 | 122–127 | 1.8–2.2 | — |
| 400 | 160 000 | **597–598 ms** | 289–307 | 227–238 | 3.0–3.6 | — |
| 500 | 250 000 | **932–988 ms** | 470 | 351 | 4.2–11.5 | 1040–1111 ms |

**读法**：`commitTotal` 与格数**近似线性**（104→500 格数 ×23，耗时 ×13–18），
两大项各自也都是线性的。所以 §14 的 `<800ms` 不是「500 档特有的异常」，
而是**这条曲线在 500 档自然越过了 800ms 这条线**：

- 104 / 200 / 300 / 400 **全部达成** `<800ms`（300 档 332ms，还在一半以内）
- 500 档 **未达成**（932–988ms）

要真正压到 800ms 以下，必须动曲线本身（图纸渲染的采样密度 / 同步监听者的
工作拆分），而这两处都会碰到 canonical grid / Undo / Diagnostics / Export 的语义，
属于 Stage C 的范围。这里如实记录，不粉饰。

### 8.4 一处真缺陷：`requestId` 在 `processImageV2` 边界被丢掉

**2026-10-04 实测。** 调用方 `processProductionV2` 把 `requestId` 传在**顶层**：

```js
processImageV2(image, palette, { …, requestId: options.requestId, options: state.productionGenerationOptions })
```

而 `processImageV2` 的形参**漏解构了 `requestId`**，函数体里读的是
`options.requestId` —— `options` 是 `state.productionGenerationOptions`
（store 里的模式档案，**没有** requestId）。于是这个值恒为 `undefined`。

**实测证据**：场景 P 的 `__libmsCommitProfileMeta.requestId` 一直是 `null`；
补上解构后立刻变成 `2 → 3 → 4 → 5`。

一个丢参让三处设计好的守卫同时变成**死代码**，而且全都静默：

| 位置 | 后果 |
|---|---|
| `runAutoTuneV2` 的 `tuneRequestId` | 恒为 1，`autoTuneContexts` 只按 1 存 |
| `runAutoTuneV2` 末尾的 `isStaleGenerationRequest` | 恒 false → **§19「被取代的调优不留报告」在生产里从未生效**（B4 §13 defect ③） |
| `processImageV2` await 之后的 `isStaleGenerationRequest` | 恒 false → 旧请求的结果照常提交（§11 的最后一道闸） |

**修法**：只补接线，不动任何算法与提交语义 —— 形参解构 `requestId = null`，
函数体内改用 `reqId = requestId ?? options?.requestId ?? null`。

**反向验证**（`unreachable-branch-acceptance` 的做法）：把修复改回坏形态再跑场景 Q，
精确地在两条断言上变红（取代后出现 `libms:auto-tune` + `libms:project-result`，
报告留在 `getAutoTuneReport()` 里）；恢复修复后全绿。**所以 Q 不是空转断言。**

**可达性要说清楚**：当前界面路径全部经 `runAutoGenerate` 的 `autoGenRunning`
串行化，**构造不出真正的 stale**（见 10.3 坑 4）。所以这三处守卫今天更多是
「引擎层的正确性」与「防御下一个并发入口」，而不是当前 UI 上的可见行为。
真正可观测的那一半是诊断字段（`meta.requestId`）—— 它现在不再是 `null`。
回归守卫：`tests/stage-b-release-freeze.test.mjs` 的三条结构断言 + 场景 Q。

---

## 9. 硬不变量清单

改任何一处之前，逐条确认：

1. **`maxColors > 0` 时，最终 canonical grid 的 `usedColors <= maxColors`。**
   覆盖普通模式 / 智能模式 / Auto Tune winner / background ON-OFF / 大尺寸。
   **不许只验预览。**
2. **`null` 从 B2 mask 到 Export 全程不得被重新填色。**
3. **尺寸权威链**：user-explicit > structured-project > 人工标定 > 网格识别 >
   pixel-multiple > logical-heuristic。显式尺寸是**一次性**的：
   用完还原，且谁的值新听谁的（异步回来不能把用户最新的选择倒回去）。
   不得回归 104×104 fallback / canvas snapshot overwrite / initial-generation race。
4. **`currentPaletteId` 是唯一颜色身份**，导出与重导入必须保持一致。
5. **一次用户动作 = 一条 History Entry**（画笔 / 填色 / 全局替换 / 文字删除 /
   Reference 删除 / Resize / Auto Tune generation commit）。
6. **生产生成必须走真实 Worker**（取证用发包，不用构造数）。
7. **取消 / 陈旧 / 延后是预期结局**，不写成「生成失败」。

---

## 10. 怎么验

### 10.1 单元 / 契约测试

```bash
# ⚠️ node --test <目录> 在 Node 22 下会把目录当模块解析并报 MODULE_NOT_FOUND。
# 必须显式枚举文件（glob 会漏文件，产生假绿灯）。全量是 52 个文件 / 601 个用例。
node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)
```

### 10.2 真机探针

| 探针 | 回答什么 |
|---|---|
| `tools/b0-size-probe.mjs` | 尺寸权威链 |
| `tools/b1-palette-probe.mjs` | 颜色系统 |
| `tools/b2-background-probe.mjs` | 背景可靠性 |
| `tools/b3-worker-probe.mjs` | 生成 Worker |
| `tools/b4-auto-tune-probe.mjs` | Auto Tune |
| `tools/stage-b-master-probe.mjs` | **Stage B 集成场景 A–N + P/Q**，`--all` 会编排上面五个 |

跑法：

```bash
node tools/stage-b-master-probe.mjs          # 只跑集成场景
node tools/stage-b-master-probe.mjs --all    # 加上 b0/b1/b2/b3/b4-13
node tools/stage-b-master-probe.mjs --only F,P,Q   # 调试单个/几个场景（也认 SB_ONLY=F,P,Q）
```

**`LIBMS_BASE` 必须指向带生产 CSP 头的服务**（`tools/serve-with-headers.mjs`）。
不带 CSP 的「验过」和「能上」是两件事。

场景字母表：`A` 普通图智能生成 · `B` 人像固定档 · `C` Logo 背景去除
（预检 → 应用 → null）· `D` 透明 PNG · `E` 像素 · `F` 500 长边提交分段 ·
`P` **104/200/300/400 提交分段扫描** · `G` 中途取消 ·
`H` 在飞请求 vs 切模式（**排队**语义）· `Q` **Auto Tune 请求号接线 +
取消后的报告卫生（§8 defect ③ / §19）** · `I` maxColors 上限 · `J` 同页换图 ·
`K` Pixler roundtrip · `L` 全局替换 + 撤销 · `M` 尺寸竞态 · `N` 八种导出 ·
`CSP` 生产 CSP。

> 字母表按**执行顺序**排（P 紧跟 F、Q 紧跟 H），不是按字典序 ——
> 同一台浏览器里跑，顺序会影响缓存与单例状态。

### 10.3 写探针时最容易踩的四个坑

1. **HELPERS 是模板字符串。** 注释和字符串里**不能出现反引号**（会提前结束模板），
   单反斜杠转义（`\n`）会被外层提前还原成真换行。
   `tests/b4-probe-helpers-syntax.test.mjs` 会在 0.1 秒内抓这两类错误 ——
   但它**只查 `tools/*-probe.mjs`**，新增探针请照它的结构写 HELPERS。
2. **`bridge.generate` 是引擎层。** 它不写工作台的 `status.generating`，
   所以「取消生成」按钮永远不会出现；它还会把显式尺寸写进
   `state.generationLongEdge` 然后立刻在 `finally` 还原。
   要验 UI 状态机（取消按钮、状态栏文案），必须走工作台自己的入口。
3. **Auto Tune 带缓存。** 缓存键 = 源图 + 尺寸 + 模式 + overrides 指纹 + crop 指纹。
   同一张图、同一尺寸、同一模式**再生成一次会直接命中缓存** ——
   整轮 `generationMilliseconds` 只有 ~52ms，Worker 一次都不发包，
   `isGenerating()` 的窗口短到抓不住。
   于是「原地重生成一次然后测取消 / 测竞态」这类写法会**静默退化成空测**：
   断言看着在跑，其实这一轮什么都没算。
   → 要触发真算，先改一个缓存键分量（`clickMode(...)` 或 `setMaxColors(n)`）。
   → 判据用 `getGenerationReport().generationMilliseconds` 是否远大于 52ms，
     而不是「我点了按钮」。
4. **「切模式」不作废在飞请求，只是排队。** 界面路径都经 `runAutoGenerate` 的
   `autoGenRunning` 串行化，新请求只把 `autoGenQueued` 置真、等这一轮跑完再跑。
   所以想构造真正的 stale，**必须直调 `bridge.generate()`**（它一进来就推进
   `state.generationRequestId`）—— 但注意第二次调用会撞上 `processProductionV2`
   的重入早退（「正在生成，请稍候」），所以它**不产生新图**，只推进请求号。
   用 `evalJs` 时务必 `void` 掉这个 promise：`evalJs` 是 `awaitPromise: true`，
   直接返回会让 CDP 一直等它结算，而结算时主线程很可能正被调优的提交段占着 ——
   探针会以「CDP Runtime.evaluate 超时」的样子挂死，报错却指向别处。
