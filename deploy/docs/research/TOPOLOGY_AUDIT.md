# Connectivity / Topology 四层源码核查

审计口径：**LEVEL 1 CELL**=单格邻域；**LEVEL 2 REGION**=BFS/DFS 连通区域；**LEVEL 3 STRUCTURE**=轮廓、细线、开口、分离部件等结构证据；**LEVEL 4 TOPOLOGY**=候选改格前后明确检验 component count、连通性、孔洞、开口、桥接及身份。一个仓库做到 Level 2 **不等于**做到 Level 4。状态只对实际调用链成立；`PARTIAL` 说明局部约束，不是通用保证。

`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**。本审计不研究、不推断、不归属算法；任何旧的具体结论均为 **UNVERIFIED — DO NOT USE AS IMPLEMENTATION EVIDENCE**。

| 可核查对象 | Level 1 CELL | Level 2 REGION | Level 3 STRUCTURE | Level 4 TOPOLOGY | 实际调用链/限制 |
|---|---|---|---|---|---|
| [G bead-grid-studio](07-bead-grid-studio.md) | YES，目标格 8 邻冲突/相邻 | YES，源图 8 邻 owner BFS；目标 owner BFS | YES，源 owner→micro skeleton→候选目标格，分离部件/细线保护 | **PARTIAL**：删格前验同 owner 8 连通，追踪不可表达；没有通用孔洞数、开口数或结构同一性全局验证 | [`app.js` L1951–2065](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1951-L2065)、[L2300–2372](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2300-L2372)；仅单色小线稿≤60 格门控 |
| [D PineBead-Studio](04-pinebead-studio.md) | YES，8 邻多数 | **PARTIAL**：边缘背景去除用 4 邻 BFS；**图纸色块优化没有连通域 BFS** | NO，无源 owner/开口/细线证据 | NO | [`removeBackground` L17–72](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L17-L72) 与 [`optimizeGrid` L156–224](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L156-L224) 是两条不同路径；[`App.vue` L685–705](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/App.vue#L685-L705) 仅调用后者 2 轮。**没有验证到 boundary histogram / region merge** |
| [F kuizuo/pin-dou](06-kuizuo-pin-dou.md) | YES，格间边缘色差及邻格计数 | YES，同色 4 邻 BFS 小域；边缘背景也有 flood 逻辑 | **PARTIAL**：edge 模式选择 dominant 有轮廓倾向，但小域清理不保护细线/分离 owner | NO | [`pattern.ts` L321–430](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L321-L430)、[L505–572](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L505-L572)、[L621–698](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L621-L698) |
| [E Perler_Beads_Generator](05-perler-beads-generator.md) | YES；[`usage.ts findIsolatedBeads`](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/usage.ts#L27-L53) 查四邻**是否有任意豆**，不是“是否同色” | YES；`reduceTinyRegions` 用同色 4 邻 BFS | NO，`areSimilarColors` 只是色度/亮度条件，非拓扑结构保护 | NO | [`imageToBeads.ts` L41–70](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L41-L70)、[L363–427](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L363-L427)；`usage.ts` 是材料/孤豆统计路径，不自动删除 |
| CURRENT `smart-cleanup-v2` | YES，8 邻候选色 | YES，同色 4 邻区域 | **PARTIAL**：protection tier/source evidence 阻止重要小域清理 | NO，未对删格的桥接、孔洞、开口做完整反事实检验 | [`smart-cleanup-v2.mjs`](../../smart-preprocessing/smart-cleanup-v2.mjs) |
| CURRENT `bgs` 可选引擎 | 与 G 类似 | 与 G 类似 | YES，小线稿源 owner 投影 | **PARTIAL**，沿用 G 的局部连通检验且有差异修正 | [`bgs/topology.mjs`](../../src/algorithms/bgs/topology.mjs)、[NOTICE](../../src/algorithms/bgs/NOTICE)；不能当作默认 CURRENT 主链能力 |

## 候选小区域的七类证据，不把面积当结论

| 输出类别 | 可用源码证据 | 缺口与允许动作 |
|---|---|---|
| `NOISE` | CURRENT `smartCleanup` 的低 source evidence、低 protection、邻色支持与替换成本；G cartoon 彩色≤2 格且 `cellSupport<.42` | 只在**高置信度**且不碰结构约束时自动改；本轮无实测校准阈值，不宣称这些规则已经充分证明“噪点” |
| `DETAIL` | G 源 owner 有独立覆盖候选；CURRENT source evidence/critical tier | 保留或标记待人工；无可靠语义分类时不强删 |
| `HIGHLIGHT` | CURRENT 高光保护图/源像素证据 | G/D/E/F 无明确高光语义识别；不能从“单颗白豆”直接判断 |
| `STRUCTURE` | G micro skeleton、轮廓归属；CURRENT 轮廓/描边保护图 | 加/删前先测目标结构；现有算法仍非全局保证 |
| `BRIDGE` | G `ownerConnectedWithout` 在删候选格前可检验其同 owner 连通性 | 其他 D/E/F 无桥接反事实检验；CURRENT 原生 cleanup 也没有同等局部检查 |
| `SEPARATED_COMPONENT` | G 源 owner 分离、目标候选冲突计数 | G 仍可能 forced placement；不足以保证可表达，应报告不可表达 |
| `UNKNOWN` | 证据冲突、源图不清、格数过低、保护图缺失 | **默认保留并报告**；不得因为区域小就删除 |

## 孔洞与开口的准确结论

G 的骨架细化与 owner 连通检查可降低细线断裂/部件融合，但 `ownerConnectedWithout` 检验的是**删除某格后同 owner 是否仍 8 连通**。它不计算背景 4 邻/8 邻的孔洞数量，也不核查一个开口是否封闭；F/E/D 更没有这样的实现。若未来设计 Level 4，需同时比较源/目标前后前景组件、背景孔洞、关键开口、桥格以及 owner 身份，且用真实回归图验证；本轮只列 `CONCEPT ONLY`，不以这些仓库作为已实现证据。
