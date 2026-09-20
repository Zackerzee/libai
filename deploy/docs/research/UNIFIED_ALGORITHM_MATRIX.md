# 统一算法去重矩阵

版本、入口和细节见同目录 `01`–`07` 报告。`YES`=已在实际生成路径实现（可选路径也算）；`PARTIAL`=有相关机制但不完整/不在默认链；`NO`=审过主要生成路径未见；`UNKNOWN`=当前扫描不足以断言。A–F 对应前六份报告；新增 G 专项列见本表下半部。CURRENT 只作只读基准。**“YES”不代表质量更好，也不代表可直接移植。**

| 模块 | A | B | C | D | E | F | CURRENT | 源码定位/范围说明 |
|---|---|---|---|---|---|---|---|---|
| Crop | NO | YES | NO | NO | NO | YES | YES | [B 布局](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L273-L320) · [F 变换](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L76-L194) · [CURRENT](../../smart-preprocessing/subject-crop.mjs) |
| Resize | YES | YES | YES | YES | NO | YES | YES | [A Worker](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L668-L773) · [C Sharp](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/image-loader.ts#L266-L342) · [D 2×](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L74-L113) · [F 8×](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L573-L593) |
| Cell Mapping | YES | YES | YES | YES | YES | YES | YES | [A 面积映射](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L405-L445) · [B](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L110-L169) · [CURRENT](../../smart-preprocessing/sampling-engine-v2.mjs) |
| Sampling | YES | YES | YES | YES | YES | YES | YES | 各仓生成入口；见六份报告的“实际链路”与 [CURRENT](../../smart-preprocessing/sampling-engine-v2.mjs) |
| Adaptive Sampling | YES | YES | PARTIAL | NO | PARTIAL | YES | YES | [A 格内方差二簇](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L451-L515) · [B](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L53-L108) · [F 格间边缘](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L505-L572) · [CURRENT](../../smart-preprocessing/sampling-engine-v2.mjs) |
| Dominant Sampling | YES | YES | YES | NO | YES | YES | YES | [A 2-means](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L459-L514) · [C RGB 桶](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/image-loader.ts#L94-L219) · [E 色号投票](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L309-L326) |
| Linear RGB | YES | YES | NO | NO | NO | YES | YES | [A](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L405-L515) · [B](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L23-L108) · [F](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L433-L504) |
| Lab | YES | YES | YES | NO | NO | YES | YES | [A](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L40-L155) · [B](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/colorMatching.ts#L1-L43) · [C](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-science.ts#L44-L258) · [F](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/beads.ts#L5-L42) |
| CIEDE2000 | YES | YES | YES | NO | NO | YES | YES | F 用 `color-diff.diff`，有 [34 组 ΔE00 测试](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/tests/color-diff.test.ts)；[F 调用](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/beads.ts#L35-L42)；[CURRENT](../../smart-preprocessing/palette-engine.mjs) |
| Quantization | YES | YES | YES | YES | YES | YES | YES | 实体色卡匹配：A/B/C/F Lab 系；D/E 加权 RGB 系；参见单仓报告 |
| MaxColors | YES | YES | YES | NO | YES | YES | YES | [A K-means](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L272-L357) · [B 子集](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/generate.ts#L45-L86) · [C 边色](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L214-L289) · [CURRENT](../../smart-preprocessing/protected-palette-budget-v2.mjs) |
| Dithering | YES | NO | YES | NO | NO | NO | YES | [A FS/ordered](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L815-L910) · [C FS](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L332-L448) · [CURRENT legacy](../../app.js) |
| Edge Detection | YES | YES | YES | NO | NO | YES | YES | [A 方差](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L405-L520) · [B edgeWeight](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L53-L108) · [C 邻色](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L144-L213) · [CURRENT](../../smart-preprocessing/detail-protection-v2.mjs) |
| Structure Protection | PARTIAL | YES | PARTIAL | NO | PARTIAL | PARTIAL | YES | [B 清理闸门](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/regionCleanup.ts#L22-L103) · [C 边色限色](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L144-L289) · [CURRENT](../../smart-preprocessing/detail-protection-v2.mjs) |
| ICM | YES | NO | NO | NO | NO | NO | NO | [A 真实逐点坐标下降](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L609-L659)；CURRENT 有空间优化但非同式 ICM |
| Fragment Cleanup | PARTIAL | YES | YES | YES | YES | YES | YES | [B 连通域](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/regionCleanup.ts#L22-L103) · [C](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/noise-cleaner.ts#L249-L306) · [CURRENT](../../smart-preprocessing/smart-cleanup-v2.mjs) |
| Region Merge | NO | NO | NO | NO | PARTIAL | PARTIAL | YES | [E 小域并入邻色](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L363-L427) · [F](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L321-L365) · [CURRENT RAG](../../smart-preprocessing/region-aware-quantizer.mjs) |
| Boundary Merge | NO | NO | PARTIAL | NO | PARTIAL | PARTIAL | YES | [C 边色选取](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L144-L213)；六仓未核实独立“boundary histogram merge”；[CURRENT 轮廓](../../smart-preprocessing/region-aware-quantizer.mjs) |
| Isolated Cell | PARTIAL | YES | YES | YES | YES | YES | YES | [D 8 邻多数](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L156-L224) · [CURRENT](../../smart-preprocessing/pattern-optimizer.mjs) |
| Background | YES | YES | YES | YES | YES | YES | YES | [A](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L167-L261) · [D](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L17-L72) · [CURRENT](../../smart-preprocessing/auto-background.mjs) |
| Topology | NO | NO | NO | NO | NO | NO | PARTIAL | 按严格 LEVEL 4 定义，CURRENT 可选 [BGS topology](../../src/algorithms/bgs/topology.mjs) 有局部 owner 连通检验，却无通用孔洞/开口守恒；见 [四层审计](TOPOLOGY_AUDIT.md) |
| Portrait | NO | NO | NO | NO | PARTIAL | NO | YES | [E 风格参数](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L8-L38)；[CURRENT 人像](../../app.js) |
| Eye Highlight | NO | NO | NO | NO | NO | NO | YES | [CURRENT 强保护](../../smart-preprocessing/detail-protection-v2.mjs) |
| Flat Region | PARTIAL | PARTIAL | NO | PARTIAL | YES | PARTIAL | YES | [E 全局相似色](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L428-L488)；[CURRENT](../../smart-preprocessing/regional-block-v2.mjs) |

分类：基础线性采样/ΔE00/限色/清理为 `DUPLICATE` 或 `VARIANT`；A 的 ICM 为 `NEW, NEEDS_TESTING`；A 格内二簇、E 色号投票、B 误差门控清理、F 格间边缘触发是 `VARIANT, POTENTIALLY_USEFUL, NEEDS_TESTING`；D 的 RGB 近色与裸多数相对 CURRENT 是 `WEAKER` 基线。这里的 `NO` 限于审计快照的生成路径，不声称整个项目绝无相关代码。

## G 扩展列：bead-grid-studio `515e180` vs CURRENT

G 已作为 [`src/algorithms/bgs/`](../../src/algorithms/bgs/README.md) 独立引擎存在于 CURRENT，因此不能再称 G topology 是本项目的新待移植资产。下表状态限定于该引擎/上游代码，不意味着 CURRENT 默认生产路径全部启用。每行源码证据见 [G 专项审计](07-bead-grid-studio.md) 相应段落及 [上游转换入口](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1767-L2520)。

| 模块 | G | CURRENT | 证据/限定 |
|---|---|---|---|
| Crop | YES | YES | [G 自动裁边](07-bead-grid-studio.md#高优先级adaptive-resolution-recommendation-全流程)；CURRENT BGS/subject-crop |
| Resize | YES | YES | [G Canvas 栅格化](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1435-L1520) |
| Cell Mapping | YES | YES | [G 几何](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/core/geometry.js#L11-L38) |
| Sampling | YES | YES | [G 转换](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2113-L2304) |
| Adaptive Sampling | YES | YES | [G 模式/分类](07-bead-grid-studio.md#高优先级adaptive-resolution-recommendation-全流程) |
| Dominant Sampling | YES | YES | [G cartoon 票选](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2113-L2304) |
| Linear RGB | YES | YES | [G photo/detail](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2113-L2304) |
| Lab | YES | YES | [G 颜色转换](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1777-L1807) |
| CIEDE2000 | YES | YES | [G 候选精配](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2064-L2100) |
| Quantization | YES | YES | [G 转换](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1767-L2520) |
| MaxColors | YES | YES | [G 锚点与预算](07-bead-grid-studio.md#a-g结构与颜色保护的实际规则) |
| Dithering | NO | YES | G 转换主路径未见抖动；CURRENT legacy 有可选路径 |
| Edge Detection | YES | YES | [G 线稿/gradient](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1897-L1921) |
| Structure Protection | YES | YES | [G owner/skeleton](07-bead-grid-studio.md#a-g结构与颜色保护的实际规则) |
| ICM | NO | NO | G 的碰撞消解不是 A 所定义的 ICM；CURRENT BGS 亦如此 |
| Fragment Cleanup | YES | YES | [G 彩色小域](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2398-L2429) |
| Region Merge | PARTIAL | YES | G 全局相似色号合并非 CURRENT RAG 空间区块合并 |
| Boundary Merge | PARTIAL | YES | G 对墨线/碰撞调整，但非独立 boundary-histogram merge |
| Isolated Cell | YES | YES | [G 清理支持闸门](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2398-L2429) |
| Background | YES | YES | [G 自动留空/裁边](07-bead-grid-studio.md#高优先级adaptive-resolution-recommendation-全流程) |
| Topology | PARTIAL | PARTIAL | 严格 LEVEL 4 仅局部 owner 连通检验，**非通用拓扑守恒**；[四层审计](TOPOLOGY_AUDIT.md) |
| Portrait | NO | YES | G 无专用人脸/肤色色阶路径 |
| Eye Highlight | NO | YES | G 小 owner 可能保护眼点，但无语义眼/高光分类 |
| Flat Region | PARTIAL | YES | G 相近色合并可能规整色块，但非专门平坦区结构模型 |
| Adaptive Resolution | YES | PARTIAL | G 分类→固定长边→文档文字容量评估；CURRENT 新增离线 [advisor](../../src/algorithms/adaptive-resolution/advisor.mjs) 仅实验，不接生产链 |

`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**。暂停源码分析，不进入上表或候选链路；若旧资料曾把 BFS、Connected Components、Topology 归属于它，统一视为 **UNVERIFIED — DO NOT USE AS IMPLEMENTATION EVIDENCE**。已确认的 G/D/F/E/CURRENT 四层细表见 [TOPOLOGY_AUDIT.md](TOPOLOGY_AUDIT.md)。

**Connectivity 专项维度**（YES/NO/PARTIAL 证据及调用限定均在 [四层源码审计](TOPOLOGY_AUDIT.md)；ga0my 始终 `UNVERIFIED`，不参与比较）：

| 维度 | G | D | F | E | CURRENT |
|---|---|---|---|---|---|
| Connected Components | YES | PARTIAL | YES | YES | YES |
| BFS / DFS | YES | PARTIAL | YES | YES | YES |
| 4-neighbor / 8-neighbor | 8 | 背景4、格邻8 | 区域4、邻格4 | 区域4、孤豆4 | cleanup 区域4/BGS owner8 |
| Small Region Detection | YES | NO | YES | YES | YES |
| Boundary Analysis | YES | NO | PARTIAL | PARTIAL | YES |
| Isolated Cell Detection | PARTIAL | PARTIAL | PARTIAL | YES | YES |
| Separated Part Protection | YES | NO | NO | NO | PARTIAL |
| Hole Preservation | NO | NO | NO | NO | NO |
| Opening Preservation | PARTIAL | NO | NO | NO | PARTIAL |
| Thin Line Preservation | YES | NO | PARTIAL | NO | YES |
| Bridge Protection | PARTIAL | NO | NO | NO | PARTIAL |
| Structure Ownership | YES | NO | NO | NO | PARTIAL |
| Topology Refinement (strict Level 4) | PARTIAL | NO | NO | NO | PARTIAL |

`PARTIAL` 的 CURRENT 分离/开口/桥保护来自**可选 BGS 引擎**，不应写成默认生成链保证。D 的 BFS 只用于边缘背景去除；E 的 `usage.ts` 孤豆检查只看四邻是否存在任意豆且不删除。逐项证据均在专项审计，不能从表面词汇推导胜负。
