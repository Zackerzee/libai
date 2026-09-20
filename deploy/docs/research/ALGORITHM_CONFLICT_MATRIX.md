# 算法冲突矩阵（设计判断，尚未 benchmark）

| 算法 A | 算法 B | 冲突原因/风险 | 建议顺序 | 保护闸门 |
|---|---|---|---|---|
| [A/C 抖动](01-pindou-studio.md) | [CURRENT 平坦区规整](../../smart-preprocessing/regional-block-v2.mjs) | 抖动主动造高频异色，后者主动消除；反复抵消并增豆格碎片 | 拼豆主模式默认不抖动；若显式开启，在规整后单独试验 | 限高纹理区、限制色数增量，量化 singleton 比例 |
| [A ICM](01-pindou-studio.md) | [CURRENT 眼睛/高光保护](../../smart-preprocessing/detail-protection-v2.mjs) | 平滑能量倾向吞 1 豆亮点/瞳孔 | 先建 source-derived 保护，再跑受约束 ICM | strong/contour 锁定、源图误差上限，眼区回归测试 |
| [C/E/F 小域清理](03-autoclaw-pixelbead.md) | 细小五官/星光/发丝 | 以面积推断“噪声”，真实局部结构也可能小 | 量化后清理，最后结构验收 | source evidence、局部对比、眼/轮廓强保护 |
| [A/C/F dominant](01-pindou-studio.md) | 渐变/肤色色阶保留 | 多数色选择可能吃掉小范围过渡和暗部 | 采样阶段分模式比较，不和全局平滑叠加 | 平坦区/过渡区分类；肤色分布指标 |
| [B/C/E/F maxColors](02-mard-bead-generator.md) | 轮廓/高光结构保护 | 强制预算可把稀有结构色挤出 | 先汇总结构候选再限色、最终验证实际 K | 保护色预算配额，无法满足则报告而非静默改色 |
| [CURRENT RAG region merge](../../smart-preprocessing/region-aware-quantizer.mjs) | 外轮廓色连续性/线稿 | 仅按区域色差合并可跨硬边 | 源图边缘与轮廓禁区先构建，后合并 | RAG 边界强度、色相族、轮廓 locked mask |
| [D 白背景 flood](04-pinebead-studio.md) | 浅肤色/白发/半透明边 | 亮色接板边时被误判为背景 | 保留在源图预处理，勿在成品色号上猜 | 连通性+源图色差+主体证据+可撤销预览 |
| [E 全局相似色合并](05-perler-beads-generator.md) | 同色系结构层级 | 稀有暗/亮色可能在全局统一替换后消失 | 局部结构先评估，色卡预算后再局部修复 | 不合并被眼、轮廓、肤色层级使用的色号 |
| [F 格间触发 dominant](06-kuizuo-pin-dou.md) | [A 格内二簇触发](01-pindou-studio.md) | 两个触发器判断对象不同，串联会产生双重选择偏差 | 作为互斥采样臂比较 | 相同采样输入和源图证据，记录模式选择 |

以上“风险”均为源码机制推导，不是实测劣化结论。评测应对照同一套原图/图纸，记录轮廓断裂、色块大小分布、singleton、肤色色阶、眼部细节、源图误差及耗时。[CURRENT 质量指标](../../smart-preprocessing/pattern-quality.mjs) 可作基础，但不足以单独判断主观质量。

## G / Connectivity 增补（不推断 ga0my）

| 算法 A | 算法 B | 冲突与风险 | 顺序/保护闸门 | 证据等级 |
|---|---|---|---|---|
| [G 源 owner→目标格拓扑修正](07-bead-grid-studio.md) | [CURRENT isolated cleanup](../../smart-preprocessing/smart-cleanup-v2.mjs) | 前者努力保留小 owner，后者可能把量化后 ≤5 格且证据低的小域当杂色；若两个保护图未共享 owner ID，成果会被后处理吞掉 | owner/细线证据先产生；cleanup 接收 owner 强保护或跳过相应格；记录改格来源 | 两个函数已 `SOURCE VERIFIED`；兼容性/效果 `NEEDS_TESTING` |
| [G forced candidate placement](07-bead-grid-studio.md) | “分离部件绝不粘连”要求 | 上游无无冲突位置时仍会强制放候选，并计数，故不能宣称严格分离 | 发生 forced/unresolved 时报告 `UNKNOWN`、建议提高分辨率，不静默当作成功 | `SOURCE VERIFIED`，风险源于源码 |
| [D 8 邻多数](04-pinebead-studio.md) | [G 开口/细线](07-bead-grid-studio.md) | 多数改格未检验桥、开口和孔洞，可封口或断线 | D 仅作无保护负面基线；需要 Level 4 反事实闸门才可候选 | D/G 函数 `SOURCE VERIFIED`；组合效果 `NEEDS_TESTING` |
| [F/E 小域 merge](TOPOLOGY_AUDIT.md) | G owner 身份 | F/E 按同色区域大小/邻色处理，可能覆盖已保留的源 owner | 源 owner 信息先于量化计算并向清理透传；若缺失默认保留 `UNKNOWN` | F/E/G `SOURCE VERIFIED`；联用为 `CONCEPT ONLY` |
| [G AUTO-HD 固定长边](07-bead-grid-studio.md) | 用户手动尺寸/制作成本 | 上游普通图案模式调用 `applySmartSettings` 会设置行列；高分辨率也增制作成本 | 当前实验 advisor 显式优先 manualSize；未来 Hybrid V2 只在 AUTO 且有测量证据时选最小可用格数 | 上游覆盖行为 `SOURCE VERIFIED`；Hybrid 选择政策 `CONCEPT ONLY` |

`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**。任何冲突或互补性分析均不得基于它；以前若有具体归属，均为 **UNVERIFIED — DO NOT USE AS IMPLEMENTATION EVIDENCE**。
