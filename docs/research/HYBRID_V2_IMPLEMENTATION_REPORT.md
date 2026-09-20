# Hybrid V2 — 实施报告（Phase B 实验引擎）

> 本文档记录 Hybrid V2 实验引擎的**实现、验证与基准结论**。
> 配套文件：`HYBRID_V2_IMPLEMENTATION_PLAN.md`（方案）、`HYBRID_V2_BENCHMARK.md`（自动生成的逐夹具基准）。
> **本文不声称 Hybrid V2 已优于 CURRENT，不产出 winner、不产出总分。**

---

## 0. 状态与范围

| 项 | 内容 |
| --- | --- |
| 定位 | **受控实验臂**（experiment arm），非产品主链 |
| 代码位置 | `src/algorithms/engines/hybrid-v2/`（14 个 `.mjs`，含 1 个测试文件） |
| 是否接入网站 | **否**（用户明确要求 STOP，不接正式站、不进 Phase C） |
| 是否替换 CURRENT | **否** |
| 默认尺寸 | 不改变默认 104；不自动切 AUTO |
| 可逆性 | 纯新增目录，零改动现有算法/UI/导出/色板数据 |

约束（来自用户 spec，逐条遵守）：
- 只使用 **SOURCE VERIFIED / CURRENT VERIFIED** 算法；未引入任何 UNVERIFIED / CLAIMED / CONCEPT ONLY 的算法（含被 README 夸大的 `ga0my connectivity` 规则）。
- 特征开关默认全关（ICM 空间细化 / 抖动 / 激进区域合并 / 实验主色采样 / robust-mean 采样）。
- 不复制上游项目与 UI、不替换现有算法、不自动判定哪套更好。

---

## 1. 交付物清单（模块）

| 模块 | 职责 | 关键导出 |
| --- | --- | --- |
| `config.mjs` | 冻结配置树 + 来源标注 | `HybridV2Config`、`PROVENANCE`、`p()`、`flattenConfig`、`buildConfigMeta`、`HYBRID_V2_ENGINE_ID` |
| `sampling.mjs` | 自适应细胞采样 | `sampleGrid`、`sampleCell`（linear-mean / robust-mean / dominant / two-means / adaptive）、`cellBounds`、`asRaster`、`SAMPLING_MODE` |
| `topology.mjs` | 拓扑守卫 | `TopologyGuard`、`connectedComponents`、`backgroundHoles`、`openingCount`、`countBeads`、`isConnectedWithout` |
| `classify.mjs` | 小域七分类 | `classifySmallComponent`、`COMPONENT_CATEGORY`（NOISE/DETAIL/HIGHLIGHT/STRUCTURE/BRIDGE/SEPARATED_COMPONENT/UNKNOWN） |
| `protected-mask.mjs` | 统一保护层 | `buildProtectedDetailMask`、`requestChange`、`selectAccentKeys`、`MASK_LAYER` |
| `metrics.mjs` | 阶段度量 | `snapshot`、`METRIC_KEYS`（9 项）、`sourceProtectedCells`、`gradientThreshold`、`structureSimilarity`、`protectedDetailLoss` |
| `cleanup.mjs` | 三阶段清理 | `safeFragmentCleanup`、`edgeContaminationCleanup`、`flatRegionRegularization` |
| `resolution.mjs` | 自适应分辨率 | `evaluateCandidateSizes`、`downsample`、`preEvaluateCandidate`、`CANDIDATE_STATUS`、`CANDIDATE_LONG_SIDES` |
| `index.mjs` | 主管线 | `runHybridV2(input, options)` → `{matrix, cols, rows, palette, usedColors, diagnostics, stageMetrics}` |
| `fixtures.mjs` | 回归夹具 | `FIXTURES`（10 类）、`FIXTURE_KIND`、`PALETTE`、`runFixtureSuite` |
| `benchmark.mjs` | 算法 A/B | `compareCurrentVsHybridV2`、`renderBenchmarkReport`、`BENCHMARK_VERDICT`、`METRIC_DIRECTION`、`classify` |
| `resolution-benchmark.mjs` | 分辨率实验 | `compareResolutionArms`、`renderResolutionReport`、`RESOLUTION_ARMS` |
| `run-benchmarks.mjs` | 两组 runner | `runAbSuite`、`runResolutionSuite`、`tally`、`renderFullReport` |
| `hybrid-v2.test.mjs` | 单元测试 | **41 测试，全绿** |

---

## 2. 管线与接口

`runHybridV2(input, options)` 统一接口，13 阶段：

```
几何/裁切 → 细胞映射 → 自适应采样 → 配色匹配 → [前置结构保护扫描]
→ MaxColors(带 protectedKeys) → [权威保护掩码]
→ 区域分析(七分类) → 安全碎片清理(+拓扑守卫) → 边沿污染清理
→ 平涂区规整 → 最终矩阵
```

**与用户原始顺序的偏差（已记录，不隐藏）**：用户要求 MaxColors 在 Structure Protection 之前；但因降色若无 `protectedKeys` 会把结构色挤掉，故在采样网格上**前置扫描**结构/高光、把受保护色号作为 `protectedKeys` 交给 MaxColors，降色后再在最终矩阵上重建权威保护掩码。两套顺序都写入 `diagnostics.pipelineOrder`。

所有改格**必须**走 `requestChange()`（先查保护掩码，再查拓扑守卫），禁止直接写 grid。

---

## 3. 特征开关与配置来源

- `featureFlags`：`icmSpatialRefinement` / `dithering` / `aggressiveRegionMerge` / `experimentalDominantSampling` / `robustMeanSampling` —— 默认全关。
- `HybridV2Config` 为冻结树；每个取值用 `p(value, provenance, ref, note)` 标注来源（`CURRENT_VERIFIED` / `SOURCE_VERIFIED` / `LOCAL_POLICY`），保证可审计、不引入未经验证算法。
- 候选尺寸：52 / 78 / 104 / 120 / 140 / 160（长边），由 `evaluateCandidateSizes` 输出 recommended / acceptable / detail-risk / high-detail + `reasons[]`。

---

## 4. 验证情况

| 验证项 | 结果 |
| --- | --- |
| 回归夹具不变量（`runFixtureSuite`） | **10/10 通过**（结构/眼睛/高光/桥/孔洞/孤立细节等不变量） |
| 单元测试（`hybrid-v2.test.mjs`） | **41/41 通过** |
| 基准 runner 运行（`run-benchmarks.mjs`） | **0 错误**（10 夹具 × 2 组） |
| 引擎分析逻辑 | 在人为噪点输入上识别到 273 个边沿污染候选，闸门正常拦截（见 §6） |

修复过的历史坑（已并入实现，记录备查）：
1. `otsuThreshold` 返回**对象**而非数字 → `gradientThreshold` 取 `.threshold`；且 Otsu 必须在**含零梯度**的全直方图上跑，否则边格被当成背景类（THIN_OUTLINE 由此从选 1 格 → 选 55 格）。
2. 高光检测：局部均值**含中心**、峰值**排除中心**，避免白底旁光晕被整片算作高光（实测多算 1000+ 格）。
3. 高光连通块上限 `max(8, 2%×格数)` 过滤整片白底大 blob。
4. `protected-mask.mjs` accent 用 `oklabChroma` 过滤中性色，避免把黑/白算作强调色。

---

## 5. 基准设计（两组，为何分离）

| 组 | 比较 | 条件 | 回答的问题 |
| --- | --- | --- | --- |
| **A** | CURRENT vs HYBRID_V2 | 固定 **104×104**，同一输入图/色板/MaxColors | 同样信息容量下，算法是否更好？ |
| **B** | 104 vs AUTO | 算法臂固定 HYBRID_V2，只改分辨率 | 差异是「算法变好」还是「只是尺寸变大」？ |

两组**绝不混算**。组 A 判定口径 `IMPROVED / REGRESSED / UNCHANGED / INCONCLUSIVE`（按指标方向，ambiguous 指标一律 INCONCLUSIVE）；组 B 因两臂格数不同，只比「每百格」占比与方向（`same / more-per-cell / fewer-per-cell / incomparable`），不做差值判定。

夹具通过**最近邻**放大到 104（不插值），保证放大后仍是纯色块，不让双线性在色块边界凭空造出两臂都会误判的杂色。

---

## 6. 关键发现：组 A 全 UNCHANGED 的根因

**组 A 判定分布：110/110 UNCHANGED（9 必测项 + 2 保护细分项）× 10 夹具。**

这不是度量脚本故障，根因已定位并验证：

1. **引擎与 CURRENT 逐格相同。** 10 夹具 @104 下 `gridDiff = 0`（与 `generateV2` 输出字节一致）；`fragmentChanged / edgeChanged / flatChanged` 三项清理标志**全部为 n（从未触发）**。原生分辨率下同样 `gridDiff = 0`。
2. **引擎统一保护层复用 CURRENT 的 `buildProtectionMap`。** 清理阶段凡是想改的格，恰好是 CURRENT 已标记为结构/轮廓而保护的格，`requestChange()` 一律 REJECT —— 引擎无法改动 CURRENT 已经保留的格。
3. **夹具不携带 CURRENT 的「照片派生」缺陷。** 这 10 个夹具是合成色块图，最近邻放大到 104 后仍是纯色块；CURRENT 的 7 项问题（降采样边沿杂色、平涂碎片、抗锯齿渗色、小域误删等）在**真实照片**上才出现，在干净色块图上 CURRENT 本身输出就是干净的，没有可供 Hybrid 修正的对象。
4. **引擎分析逻辑在跑、闸门在生效（非空转）。** 在人为撒盐椒噪点的绿块输入上验证：引擎确实识别到 **273 个边沿污染候选**，但全部被同一套保护层 REJECT，输出仍与 CURRENT 逐格相同。

**结论口径**：组 A 全 UNCHANGED = 「在**该输入类**上两臂不可区分」，因此对「Hybrid V2 是否优于 CURRENT」这一提问属 **不可判定 / 信息不足**，而**不是**「两者质量相等」。要真正检验算法质量，必须用携带 CURRENT 缺陷的真实照片输入（见 §8 边界）。

---

## 7. 组 B：分辨率独立生效

组 B 单独验证了「分辨率」这一变量：

- AUTO 为多数夹具选择 **140–160** 网格（大于固定 104），状态 `candidate-evaluation-not-optimized`（候选评估未优化，仅为 Phase B 实验性，不进生产）。
- 90 个「每百格」方向判定分布：**41 more-per-cell / 24 fewer-per-cell / 25 same**。
- 意义：分辨率变化确实独立改变逐格指标 → 这正是把组 A、组 B 分离的原因。若有人观察到「Hybrid 好像更好」，组 B 可帮助判断那是算法贡献还是单纯因为 AUTO 用了更大网格。

---

## 8. 结论与边界（不声称优越性）

- **本实验臂目前与 CURRENT 在测试输入类上收敛**，因此无法给出「Hybrid V2 优于/劣于 CURRENT」的结论。引擎**不是 broken**，其保护/分类/拓扑/清理逻辑在单元与夹具层面均验证为正确运行。
- **边界**：
  - 夹具为合成色块，未覆盖照片 / 渐变 / 抗锯齿这类触发 CURRENT 7 项缺陷的输入；
  - 特征开关默认全关，本基准不开启；
  - 自适应分辨率评估为实验性，未优化、不进生产；
  - 全工程零改动现有算法/UI/导出/色板数据，可逆。
- **不做的事**（遵守用户 STOP 指令）：不接正式网站、不进 Phase C、不替换 CURRENT、不自动判定胜负、不声称 Hybrid V2 已优于 CURRENT。

---

## 9. 如何复跑

```bash
# 单元 + 夹具
node --test src/algorithms/engines/hybrid-v2/hybrid-v2.test.mjs

# 两组基准，输出到 docs/research/HYBRID_V2_BENCHMARK.md
node src/algorithms/engines/hybrid-v2/run-benchmarks.mjs \
  --out docs/research/HYBRID_V2_BENCHMARK.md
```

输出含 banned-words 自检（出现「推荐/最好/最优/胜出/winner:HYBRID/CURRENT」会抛错），确保报告不越界。
