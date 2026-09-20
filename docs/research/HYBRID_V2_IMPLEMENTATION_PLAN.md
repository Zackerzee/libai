# Hybrid V2 — Phase B 实施计划

> 本文件是**编码前的计划**，不是实施报告。实施报告另见（完成后生成）
> `HYBRID_V2_IMPLEMENTATION_REPORT.md` / `HYBRID_V2_BENCHMARK.md`。
>
> 唯一研究依据：`docs/research/` 下 8 份审计（01–07、UNIFIED_ALGORITHM_MATRIX、
> TOPOLOGY_AUDIT、ALGORITHM_CONFLICT_MATRIX、HYBRID_V2_CANDIDATE_PIPELINE、
> ALGORITHM_PARAMETERS、LICENSE_AUDIT、EXECUTIVE_SUMMARY）+ `src/algorithms/adaptive-resolution/advisor.mjs`。

---

## 0. 边界声明（先讲清楚不该做什么）

| 项 | 状态 |
|---|---|
| 修改正式 UI / 网站生成流程 | **禁止** |
| 替换 CURRENT 引擎 | **禁止**。CURRENT 必须继续完全可用 |
| 改变默认 104 行为、自动启用 AUTO Resolution | **禁止** |
| 删除旧算法、改变正式导出、改变 Palette 数据 | **禁止** |
| 复制许可证不允许复制的源码（C / D / F） | **禁止**。只抽象思想，不复制代码表达 |
| 声称 Hybrid V2 已优于 CURRENT | **禁止**。报告只给 IMPROVED / REGRESSED / UNCHANGED / INCONCLUSIVE + 证据 |
| 接入正式网站、自动进入 Phase C | **禁止**。完成即 STOP |

---

## 1. 证据分级：谁能进实现

### 1.1 允许（`SOURCE VERIFIED` / `CURRENT VERIFIED`）

| 来源 | 许可 | 可进入实现的资产 |
|---|---|---|
| **CURRENT**（本仓库 `smart-preprocessing/`） | 自有 | `sampling-engine-v2`（cellBounds / sampleLinearMean / clusterColorsLab / sampleDominantCluster / extractCellFeatures / resolveEdgeAware）、`detail-protection-v2`（buildProtectionMap / ProtectionTier / ProtectionReason / detectHighlight / detectEyeLike / detectDarkDetail / calculateSourceEvidence）、`protected-palette-budget-v2`（buildPaletteBudgetPlan + protectedKeys / applyBudgetPlan）、`smart-cleanup-v2`（findConnectedComponents / smartCleanup）、`palette-engine`（ΔE00）、`pattern-quality`、`subject-crop`、`auto-background`、`regional-block-v2`、`region-aware-quantizer` |
| **G** `bead-grid-studio@515e180` | **Apache-2.0**（仓库有 LICENSE + NOTICE；本项目已有 `bgs/NOTICE`，不重复复制） | 内容分类指标（nearWhite / dark / saturated / edgeDensity / transitionDensity / flatPairRatio / quantizedColorCount / longLineRatio / smallComponentCount / medianGlyphHeightPx / documentScore / likelyDocument / likelyPhoto / likelyLineArt）、`gridForLongSide`、safe auto crop、**source owner → 局部连通检查（`ownerConnectedWithout`）**、anchor 色（本次已用色里的最深/最浅中性，含删除损失惩罚 ×40，非绝对锁）、accent 色（OKLab 色度 × log2(使用数+2)，色相角距 > 0.55 rad，≤3）、彩色小域清理准入（≤2 格 / 每格 `cellSupport < 0.42` / 邻色数 ≥ 大小+2） |
| **A** `Pindou-Studio@850a4bf` | **MIT**（根 LICENSE 原文） | 格内**线性 RGB 方差 > 0.008 且 ≥4 像素 → 二簇**：以「格内均值」与「Lab 最远像素」初始化，迭代 3 次，取覆盖权重更高的簇均值；面积加权采样；alpha 权重大于前景时留空 |
| **B** `mard-bead-generator@309d478` | **MIT**（根 LICENSE + THIRD_PARTY_NOTICES） | 格内 7×7 定点（跨度 ≤8 时全取）；**RGB 4-bit 桶 dominant**，准入 `maxBucketShare ≥ 0.20`；切换触发 `variance > 0.012` 或 `亮度跨度 > 0.24`；**清理的源图 ΔE00 增量闸门**（允许增量 3.5、边缘拒绝 0.5、面积档 1/2/3） |
| **E** `Perler_Beads_Generator@36ac52d` | **MIT**（根 LICENSE） | 色号投票思想（先投影候选实体色再投票，阈值 0.34/0.26）；`reduceTinyRegions` 同色 4 邻 BFS；`usage.ts findIsolatedBeads`（**只看四邻有无任意豆，不自动删除**） |
| **F** `kuizuo/pin-dou@e94193c` | **无根 LICENSE** → **只取思想，不复制代码** | `edge` 格间触发（四邻最大平均色差 ≥ 9 且本格均值与 dominant 差 ≥ 1.5 → dominant）；小域 4 邻 ≤2 / 色差 ≤12（dominant 模式 ≤4 / ≤18） |

### 1.2 禁止进入实现

- **`ga0my connectivity`** —— `UNVERIFIED / SOURCE: NOT CONFIRMED`。
  本计划不研究、不推断、不归属任何 BFS / 连通域 / 拓扑能力给它。
  **代码中不得出现该标识符作为算法来源注释或实现依据。**
- **`UNVERIFIED CLAIMED CONCEPT ONLY`** 一律不直接进实现，包括：
  - 完整孔洞数 / 开口数守恒（G 只有「删除某格后同 owner 是否仍 8 连通」，**不计算背景孔洞、不核查开口封闭**）
  - 「通用拓扑自动修复」
  - 「boundary histogram merge」（六仓未核实独立实现）
  - 「AUTO 尺寸即最优尺寸」
- **C / D 的代码**：许可证未补齐 → `DO NOT COPY CODE`。
  D 的 8 邻多数（≥6 且当前色邻接 <2）**只作负面基线**，不进主链，因为多数改格不检验桥/开口/孔洞。

### 1.3 七分类的准确定位（重要，别误读）

`NOISE / DETAIL / HIGHLIGHT / STRUCTURE / BRIDGE / SEPARATED_COMPONENT / UNKNOWN`
在审计里是 **`CONCEPT ONLY`** —— 它是**本项目自己定的安全要求**，不是从外仓搬来的已验证算法。

因此实现方式必须是：

- **分类标签本身 = 本项目本地策略**（`ORIGIN: LOCAL_POLICY`）；
- **喂给分类器的每一条证据 = 必须可溯源到 SOURCE VERIFIED 或 CURRENT VERIFIED**（见 §6 的证据表）；
- **`UNKNOWN` 默认保留并报告**；只有 `NOISE` 且置信度达阈值 **且 TopologyGuard 放行** 才允许自动改格。

`#10` 要求「不要自己发明未经验证的固定阈值」——本计划把每个阈值都钉到出处，没有出处的参数标
`LOCAL_UNVERIFIED` 并**默认不进入默认链路**。

---

## 2. 目标：要解决的 7 个问题 → 对应阶段

| # | 问题 | 承担阶段 | 主要依赖 |
|---|---|---|---|
| 1 | 边缘杂色 | Edge Contamination Cleanup | CURRENT 源图证据 + B 的 ΔE00 增量闸门 + TopologyGuard |
| 2 | 平色块碎色 | Flat Region Regularization | CURRENT `regional-block-v2` 思想 + G 相近色合并准入 |
| 3 | 小区域误删 | classifySmallComponent + TopologyGuard | 七分类 + G owner 连通检查 |
| 4 | 轮廓/结构损失 | Adaptive Sampling（结构区 dominant/two-means）+ Structure Protection | A 二簇 / B 方差 dominant / F 格间触发 + CURRENT protection map |
| 5 | 眼睛和高光损失 | ProtectedDetailMask + Eye/Highlight Protection | CURRENT `detectEyeLike` / `detectHighlight` |
| 6 | MaxColors 后结构退化 | MaxColors（带 protectedKeys）+ 事后结构验收 | CURRENT `buildPaletteBudgetPlan` + G anchor 惩罚 |
| 7 | 固定尺寸导致信息容量不足 | Adaptive Resolution（实验，不接网站） | `adaptive-resolution/advisor.mjs` + G 分类指标 |

---

## 3. 阶段链路（第一版核心链路）

```
SOURCE IMAGE
  1  Geometry / Crop                 [CURRENT subject-crop / auto-background]
  2  Cell Mapping                    [CURRENT sampling-engine-v2.cellBounds]
  3  Adaptive Cell Sampling          [A 二簇 / B dominant / CURRENT linear-mean]  ★实验臂
  4  Palette Matching                [CURRENT palette-engine ΔE00]
  5  MaxColors                       [CURRENT protected-palette-budget-v2 + protectedKeys]
  6  Structure Protection            [CURRENT detail-protection-v2]
  7  Region Analysis                 [CURRENT smart-cleanup-v2.findConnectedComponents]
  8  Safe Fragment Cleanup           [B ΔE00 增量闸门 + G 彩色小域准入 + 七分类门]
  9  Topology Protection             [TopologyGuard：G ownerConnectedWithout 思路 + 反事实检测]
 10  Edge Contamination Cleanup      [B 边缘拒绝 + CURRENT 源图证据]
 11  Eye / Highlight Protection      [ProtectedDetailMask]
 12  Flat Region Regularization      [CURRENT regional-block-v2 + G 相近色合并准入]
 13  Final BeadMatrix                [输出 + stageMetrics]
```

**顺序不可调换的理由**（与 `HYBRID_V2_CANDIDATE_PIPELINE.md` 一致）：

- 保护图（4/6/11）必须在任何空间平滑 / 清理之前生成 —— 否则「细节已失去」才谈保护无意义。
- `MaxColors`（5）必须在**结构保护之后**：先有 protectedKeys，降色才不会挤掉结构色。
- 清理（8/10）必须在 `MaxColors` 之后：先降色再清理，避免清理成果被重映射重生碎片。
- `TopologyGuard`（9）是**闸门不是阶段**：8/10/12 每一次改格提案都要过它。

### 3.1 Feature Flag（第一版默认 **OFF**）

| Flag | 来源 | 为什么先关 |
|---|---|---|
| `icmSpatialRefinement` | A `spatialRefinement`（MIT 思想） | 审计明确：无眼/高光/轮廓锁，会吞 1 豆亮点；必须有锁定掩码 + 源图误差上限才可试 |
| `dithering` | A/C（思想） | 与平坦区规整直接冲突（一个造高频、一个消高频） |
| `aggressiveRegionMerge` | CURRENT RAG 扩展 | 仅按色差合并会跨硬边 |
| `experimentalDominantSampling` | E 色号投票 | 采样与限色耦合，须作独立臂，不能混进默认采样 |
| `robustMeanSampling` | **LOCAL_UNVERIFIED** | 审计中无对应已验证实现；见 §4 |

---

## 4. Adaptive Sampling：统一 `sampleCell(sourceRegion, context)`

```js
sampleCell(sourceRegion, context) -> { rgb, alpha, mode, features, diagnostics }
```

| 模式 | 证据等级 | 定义与出处 | adaptive 是否会选中 |
|---|---|---|---|
| `linear-mean` | **CURRENT VERIFIED** + A/B VERIFIED | 面积×alpha 加权的线性 RGB 均值（`sampleLinearMean`；A L405–520 同式） | ✅ 平坦区默认 |
| `robust-mean` | **LOCAL_UNVERIFIED**（审计无对应实现） | 去极值后面积加权均值（trim 比例进 config） | ❌ **默认不选中**；只在显式配置 `samplingMode='robust-mean'` 时启用，报告中单列 |
| `dominant` | **B VERIFIED** + CURRENT VERIFIED | RGB 4-bit 桶最高频色；准入 `maxBucketShare ≥ 0.20`（B L90–108）／CURRENT `sampleDominantCluster` | ✅ 高方差/结构区 |
| `two-means` | **A VERIFIED** | 线性 RGB 方差 > 0.008 且 ≥4 像素 → 均值 + Lab 最远像素初始化，迭代 3 次，取高覆盖簇 | ✅ 高方差区 |
| `adaptive` | 组合策略（触发条件全部有出处） | 见下 | ✅ 默认模式 |

### 4.1 `adaptive` 的触发规则（每个阈值都有出处，无自造）

按短路顺序判定：

1. **结构/边缘格** → `dominant`
   - 触发 A：`cellFeatures.variance > 0.008`（A `EDGE_VARIANCE_THRESHOLD` 原值）
   - 触发 B：`variance > 0.012` **或** `luminanceSpan > 0.24`（B 原值）
   - 触发 F（思想，非代码）：四邻最大平均色差 ≥ 9 **且** 本格均值与 dominant 差 ≥ 1.5
   - 且 dominant 桶占比 ≥ `0.20`（B `dominantShare`），否则退回 `two-means`
2. **高方差但 dominant 无优势**（`maxBucketShare < 0.20`）→ `two-means`
3. **平坦区**（以上均不触发）→ `linear-mean`

> 冲突矩阵提示：A 的格内触发与 F 的格间触发**串联会产生双重选择偏差**，
> 因此 `adaptive` 内部按上述**互斥短路**执行，并在 `diagnostics.modeCounts` 记录每次实际选择。

### 4.2 参数登记（`HybridV2Config`，初值 = 审计原值）

| 参数 | 初值 | 出处 | 状态 |
|---|---|---|---|
| `sampling.varianceThresholdTwoMeans` | 0.008 | A L405–460 | SOURCE VERIFIED |
| `sampling.twoMeansIterations` | 3 | A L478–515 | SOURCE VERIFIED（固定值） |
| `sampling.minPixelsForTwoMeans` | 4 | A L405–460 | SOURCE VERIFIED |
| `sampling.varianceThresholdDominant` | 0.012 | B L53–108 | SOURCE VERIFIED |
| `sampling.luminanceSpanThreshold` | 0.24 | B L53–108 | SOURCE VERIFIED |
| `sampling.dominantShare` | 0.20 | B L90–108 | SOURCE VERIFIED |
| `sampling.neighborDeltaTrigger` | 9 | F L548–568 | 思想（无 LICENSE） |
| `sampling.meanDominantDeltaTrigger` | 1.5 | F L548–568 | 思想（无 LICENSE） |
| `sampling.dominantBucketBits` | 4 | B L53–108 | SOURCE VERIFIED |
| `sampling.trimFraction` | 0.15 | — | **LOCAL_UNVERIFIED**，仅 `robust-mean` 用，默认不启用 |
| `sampling.alphaEmptyThreshold` | 0.5 | A（透明权重 > 前景 → 留空） | SOURCE VERIFIED |

> 试验范围（审计 `ALGORITHM_PARAMETERS.md` 提案）：方差 0.004–0.020、dominantShare 0.20–0.50。
> **第一版只用原值**，试验范围写进 config 但默认不启用，避免「改参数」和「改算法」混在一起。

---

## 5. `classifySmallComponent()`

```js
classifySmallComponent(component, context) ->
{ category, confidence, reasons[], evidence, allowAutoAction }
```

分类：`NOISE` / `DETAIL` / `HIGHLIGHT` / `STRUCTURE` / `BRIDGE` / `SEPARATED_COMPONENT` / `UNKNOWN`

### 5.1 证据 → 类别（每条证据都有出处）

| 类别 | 判据（全部来自 VERIFIED 证据） | 允许动作 |
|---|---|---|
| `HIGHLIGHT` | CURRENT `detail-protection-v2.detectHighlight` 命中，或源图高亮证据 | 强制进 ProtectedDetailMask |
| `STRUCTURE` | CURRENT protection map 的 contour/outline tier ≥ MEDIUM；或 G 的源 owner 有独立覆盖候选 | 保留 |
| `DETAIL` | CURRENT `sourceEvidence` 达标 / `ProtectionTier` ≥ HIGH；或 G 源 owner 有候选 | 保留或标记待人工 |
| `BRIDGE` | **G `ownerConnectedWithout` 思路**：移除该格后同 owner 不再连通 | 保留（删除会断连） |
| `SEPARATED_COMPONENT` | G：源图中该部件是独立 owner；目标格存在候选冲突计数 | 保留；冲突不可解 → 报告 `UNKNOWN` + 建议提高分辨率 |
| `NOISE` | 同时满足：CURRENT 低 sourceEvidence + 低 ProtectionTier + 邻色支持足够 + **G 彩色小域准入**（≤2 格 / `cellSupport < 0.42` / 邻色数 ≥ size+2）+ **B 允许 ΔE00 增量 ≤ 3.5** | 仅在此类别且 confidence ≥ `safetyThreshold` 且 TopologyGuard ALLOW 时自动改 |
| `UNKNOWN` | 证据冲突 / 源图不清 / 格数过低 / 保护图缺失 | **默认保留并报告** |

### 5.2 安全阈值（有出处）

- `noiseConfidenceThreshold`：初值 `0.75`（**LOCAL_POLICY**，审计无校准值 → 在 config 中标
  `LOCAL_UNVERIFIED`，并写进报告的限制章节）。理由：审计明确「本轮无实测校准阈值」，
  宁可保守（高阈值 → 少删 → 保细节），与问题 #3「小区域误删」方向一致。
- `maxAutoDeleteComponentSize`：初值 `2`（G 彩色小域准入 ≤2 格）。
- `cellSupportMax`：初值 `0.42`（G L2398–2429）。
- `neighborColorBonus`：初值 `2`（G：邻色支持数 ≥ 组件大小 + 2）。
- `maxSourceDeltaEIncrement`：初值 `3.5`（B `regionCleanup` 允许 ΔE00 增量）。

**`UNKNOWN` 绝不因为「区域小」就删除** —— 这是审计里写死的要求。

---

## 6. `TopologyGuard`

```
proposal → TopologyGuard → { verdict: ALLOW | REJECT, checks[], reasons[] }
```

### 6.1 检测项（用户要求的 7 项，逐项对齐审计能力）

| 检测项 | 实现方式 | 审计状态 |
|---|---|---|
| component count change | 同色 4 邻 BFS（CURRENT `findConnectedComponents`）前后对比 | **VERIFIED**（CURRENT + E/F 同式） |
| bridge removal | G `ownerConnectedWithout` 思路：删除/改色后该 owner 是否仍连通 | **VERIFIED**（G 思路，BGS 已有纯函数版可参照） |
| hole change | 背景 4/8 邻组件数前后对比 | **本项目实现，但审计明确 G/F/E/D 都没有** → 只能**检测并报告**，不得声称守恒保证 |
| opening closure | 前景边界开口段计数前后对比 | 同上：**检测并报告** |
| separated component loss | 源 owner 对应目标格集合是否归零 | **VERIFIED**（G 源 owner 分离） |
| connectivity break | 同 owner 8 邻连通性 | **VERIFIED**（G） |
| component identity | owner ID / 颜色 key 映射保持 | **VERIFIED**（本项目本地实现） |

### 6.2 硬性规则

- 任何 cleanup / merge 操作执行前**必须**过 Guard。
- `hole change` / `opening closure` 检测到**变化** → 默认 `REJECT` 并计入
  `diagnostics.topologyRejects`，除非 config 显式 `allowHoleChange`（默认 `false`）。
- Guard 只判 `ALLOW / REJECT`，**不做修复**，不声称「自动修复轮廓」。

---

## 7. `ProtectedDetailMask`

至少包含 5 层，全部来自 CURRENT VERIFIED：

| 层 | 来源 |
|---|---|
| structure（轮廓/描边） | `detail-protection-v2` protection map，tier ≥ MEDIUM |
| outline（外轮廓） | CURRENT 轮廓保护（RAG / protection map contour） |
| eye / highlight | `detectEyeLike` / `detectHighlight` |
| important accent | G accent 规则（OKLab 色度 × log2(使用数+2)，色相角距 > 0.55 rad，≤3）——**Apache-2.0，思想可用** |
| small separated component | 七分类为 `SEPARATED_COMPONENT` / `BRIDGE` / `DETAIL` 的组件 |

**Gate 不可绕过**：Cleanup、MaxColors 后处理、Region Merge 三处必须在改格前查询该 Mask。
实现方式：改格提案统一走 `requestChange(x, y, newColor)`，内部先查 Mask 再查 TopologyGuard。

---

## 8. Adaptive Resolution（实验，不接网站）

- 继续保留 `src/algorithms/adaptive-resolution/advisor.mjs` 的实验状态，**不接网站**。
- 候选尺寸：`52 / 78 / 104 / 120 / 140 / 160`（advisor 的 `CANDIDATE_LONG_SIDES`）。
- 新增**候选尺寸评估框架**：对每个候选跑低成本预评估，输出
  `recommended` / `acceptable` / `detail-risk` / `high-detail` + `reasons[]`。

### 8.1 评估维度（避免「越大越好」）

不许用「尺寸大」当「质量好」的代理。每个候选必须给出：

| 维度 | 度量 | 判定 |
|---|---|---|
| 结构保留 | 源图梯度边 vs 网格边 的保留率（两侧同一 Otsu 口径） | 低于阈值 → `detail-risk` |
| 细节保留 | 小组件（G `smallComponentCount` 口径）可表达比例 | 归零或严重损失 → `detail-risk` |
| 拓扑保留 | 关键开口/桥在候选网格是否仍可表达 | 不可表达 → `detail-risk` |
| 信息冗余 | `flatPairRatio` 高 + 颜色数低 → 更大尺寸无增益 | 判 `high-detail`（提示有充裕余量） |

- 目标：**满足结构保留要求的较小尺寸**，不是最大尺寸。
- **当前阶段不声称「最优尺寸」**。输出里必须带
  `status: "candidate-evaluation-not-optimized"`。
- `manualSize` 原样保留；不自动启用 AUTO。

---

## 9. Stage Metrics

每个阶段记录 **BEFORE / AFTER**：

| 指标 | 说明 |
|---|---|
| `paletteSize` | 色板/实际用色数 |
| `isolatedCellCount` | 四邻全异己的孤豆数 |
| `componentCount` | 同色 4 邻连通域数 |
| `smallComponentCount` | ≤ `smallComponentMaxSize` 的组件数 |
| `edgeContaminationCount` | 边缘杂色数 |
| `protectedDetailLoss` | ProtectedDetailMask 命中格被改的数量（**关键安全指标**） |
| `flatRegionFragmentation` | 平坦区内色号碎片度 |
| `dominantColorRatio` | 最大色占比 |
| `structureSimilarity`（可选） | 源图结构边 vs 输出结构边的 F1 |

统一结构：`stageMetrics: [{ stage, before: {...}, after: {...}, delta: {...} }]`。

---

## 10. Benchmark 设计（两组严格分离）

### 10.1 组 A：CURRENT vs HYBRID_V2（**固定 104×104**）

- 同一输入图、同一尺寸、**同一 Palette**、**同一 MaxColors**、同一透明/背景规则。
- **禁止**为了让 Hybrid V2 好看而使用不同输入参数。
- 回答的问题：**在完全相同的信息容量下，Hybrid V2 是否真的优于 CURRENT？**

### 10.2 组 B：104 vs AUTO（分辨率实验，**独立一组**）

- 只比较分辨率，算法臂固定（都用 Hybrid V2）。
- **禁止**与组 A 混在一起。
- 回答的问题：改善来自「算法变好」还是「尺寸变大」。

### 10.3 判定口径

每个指标标 `IMPROVED` / `REGRESSED` / `UNCHANGED` / `INCONCLUSIVE`：

- 差值需超过**最小可分辨阈值**才判 IMPROVED/REGRESSED，否则 `UNCHANGED`；
- 样本不足或指标本身不可靠（如 `structureSimilarity` 在无结构图上）→ `INCONCLUSIVE`；
- **不给总分、不给 winner**。

---

## 11. Regression Fixtures（10 类）

`EDGE_CONTAMINATION` · `FLAT_COLOR_BLOCK` · `PORTRAIT_EYE` · `ANIME_HIGHLIGHT` ·
`THIN_OUTLINE` · `SMALL_SEPARATED_DETAIL` · `HOLE_OPENING` · `BRIDGE` ·
`COMPLEX_SCENE` · `SIMPLE_CARTOON`

- 第一版用**程序化合成夹具**（无外部图片依赖、可复现），每类一张小图 + 一组断言。
- 断言重点是**不退化**：例如 `THIN_OUTLINE` 要求细线不断、`BRIDGE` 要求连接不消失、
  `HOLE_OPENING` 要求孔洞不被填、`PORTRAIT_EYE` 要求眼格不被改色。
- 现有真实失败案例**优先加入**（本阶段先留接口 `fixtures/real/`，有真实图再挂进去）。

---

## 12. 接口契约

```js
runHybridV2(input, options) -> {
  matrix,        // (string|null)[][]  色号二维行数组
  cols, rows,
  palette,       // 使用的色板（原样回传，不改写）
  usedColors,    // 实际使用色号数组
  diagnostics,   // { engine, version, config, featureFlags, topologyRejects, modeCounts, ... }
  stageMetrics,  // [{ stage, before, after, delta }]
}
```

- 纯函数：不碰 DOM / Canvas / state；色板由调用方传入。
- 引擎 ID：`hybrid-v2`；`algorithmEngine` 轴**不新增网站下拉**（本阶段不接 UI）。
- CURRENT 完全不受影响：`src/algorithms/engines/hybrid-v2/` 是**新增目录**，不改任何既有一行。

---

## 13. 完成条件与 STOP

1. Hybrid V2 实验 Engine（`runHybridV2` 全链路可跑）
2. Unit Tests
3. Regression Tests（10 类夹具）
4. CURRENT vs Hybrid V2 benchmark runner（104×104）
5. 104 vs AUTO resolution benchmark runner
6. `docs/research/HYBRID_V2_IMPLEMENTATION_REPORT.md`
7. `docs/research/HYBRID_V2_BENCHMARK.md`（明确 IMPROVED / REGRESSED / UNCHANGED / INCONCLUSIVE + 证据）

**完成后 STOP。** 不接入正式网站，不自动进入 Phase C。
