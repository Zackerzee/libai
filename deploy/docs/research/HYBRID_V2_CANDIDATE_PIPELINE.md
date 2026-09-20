# Hybrid V2 候选链路（设计稿，禁止视为实施计划）

本设计不修改 CURRENT，也不假定外部模块优于现有算法。CURRENT 已有 [Generation Engine V2](../../smart-preprocessing/generation-engine-v2.mjs) 与 [Region-Aware 1.3](../../smart-preprocessing/region-aware-quantizer.mjs)，原则是建立**受控实验臂**，不另造产品主链。图纸固定色卡、目标尺寸、背景规则、保护掩码、评测集后，才比较单模块增益。

| 顺序 | 候选阶段/依赖数据 | 为什么在这里；过早/过晚的代价 | 审计判定 |
|---|---|---|---|
| 0 | 源图、裁剪/旋转/背景候选、前景证据 | 必须先固定坐标映射；若以后再裁，采样来源及手工修改的格坐标失效。背景不可直接由成品色号猜 | [CURRENT 已有](../../smart-preprocessing/subject-crop.mjs)，`DUPLICATE` |
| 1 | 豆格到源图的连续几何映射、alpha/覆盖率/边缘特征 | 是所有采样臂的共同输入；先压缩再测“原图面积采样”会混淆重采样损失。可保存 provenance | [CURRENT 已有](../../smart-preprocessing/sampling-engine-v2.mjs)，`DUPLICATE` |
| 2 | **互斥**采样实验：CURRENT auto vs [A 格内二簇](01-pindou-studio.md) vs [B 方差 dominant](02-mard-bead-generator.md) vs [E 色号投票](05-perler-beads-generator.md) vs [F 格间边缘](06-kuizuo-pin-dou.md) | 在调色板量化前比较源色代表性；E 色号投票例外，依赖候选实体色卡，须作为单独“采样+匹配”联动实验而非插入同一 API | `VARIANT, NEEDS_TESTING` |
| 3 | 可用实体色卡、色彩匹配、候选色预算 | 色卡空间定义后才能评估选色损失；若在源图采样前压预算会改变 E 的投票；若到清理后才预算，结构色可能被挤出 | [CURRENT palette engine](../../smart-preprocessing/palette-engine.mjs) 为基线；[B 误差约束 K 曲线](02-mard-bead-generator.md) 独立测，`POTENTIALLY_USEFUL` |
| 4 | 源图证据与保护图：轮廓、眼/高光、肤色色阶、小结构 | 必须在任何空间平滑/清理前生成；过早于采样难映射到豆格；过晚时已失去细节 | [CURRENT](../../smart-preprocessing/detail-protection-v2.mjs)，`DUPLICATE` |
| 5 | 可选受约束 [A ICM](01-pindou-studio.md) | 必须有量化结果与保护图；若放清理后，会重新引入孤立色；只在特征锁、源图误差阈值和候选色预算约束下试验 | `NEW, NEEDS_TESTING`；**不直接接主链** |
| 6 | 局部区域/碎片清理 | 先保护，再用 [B 的源图误差增量闸门](02-mard-bead-generator.md) 与 CURRENT 清理比较；若提前于预算，后续重映射可能重生碎片 | `VARIANT, POTENTIALLY_USEFUL` |
| 7 | 最终预算与拓扑/质量校验：轮廓连续、颜色数、空白连通、五官微结构 | 必须验收所有前序改动；但失败应回退/报告，而不是无限再跑滤镜。没有通用拓扑保证的源码，不承诺“自动修复全部轮廓” | [CURRENT 轮廓约束](../../smart-preprocessing/region-aware-quantizer.mjs) + [指标](../../smart-preprocessing/pattern-quality.mjs)，`PARTIAL` |

最小可行 **benchmark**（不是功能实施）：

1. 固定 CURRENT 输出与样本集（含人像、Q版、像素画、木框、透明发丝；若已有 110 张参考图，先整理合法可用的指标基准）。
2. 单独替换采样臂；优先 A 格内二簇、B 方差 dominant、E 色号投票，F 格间触发作补充；全部保留原版 CURRENT 对照。
3. 单独测试 B 的误差门控清理；记录 source ΔE00 增量、保护格被改数、singleton 和轮廓变化。
4. 只有前两类指标成立后才测带保护锁的 ICM；任何提升须同时证明眼/高光/轮廓不退化及耗时可接受。

延后：抖动、随机 K-means 直接替换、黑轮廓扩边、C/D 裸多数清理、全局强相近色合并、全新通用拓扑修复。它们或与现有目标冲突，或缺可验证保护条件。[冲突矩阵](ALGORITHM_CONFLICT_MATRIX.md) 详述。

## G 与尺寸推荐补充：证据分级（不实施）

`SOURCE VERIFIED` 只用于能给出仓库、文件、函数、实际调用链的模块；“看起来合理”的融合仍是 `CONCEPT ONLY`。`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**，绝不进入候选链。

| 阶段/候选 | 证据等级 | 实际来源与调用 | Pipeline 位置与约束 |
|---|---|---|---|
| G 内容分类和固定尺寸 baseline | `SOURCE VERIFIED` | [`bead-grid-studio/src/app.js` `analyzeReferenceImage`→`analyzeSourceComplexity`→`recommendAutoHdSettings`](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L291-L399)、[`gridForLongSide`](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/core/geometry.js#L11-L38) | 在裁剪/旋转之后、采样之前；只是 benchmark baseline `resolutionAdvisor='bead-grid-studio'`，不静默改变手动尺寸 |
| G 源 owner / micro skeleton / 冲突修正 | `SOURCE VERIFIED` | [`bead-grid-studio/src/app.js` `convertPixels` 内 `smallLineArtRefinement`](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1951-L2372)；CURRENT [bgs/topology](../../src/algorithms/bgs/topology.mjs) 已有纯函数版 | owner 证据在量化前采，目标格修正在量化后、碎片清理前；不重复移植，需隔离实验 |
| D 背景 BFS 与 8 邻多数 | `SOURCE VERIFIED`（两条不同流程） | [`removeBackground`/`optimizeGrid`](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L17-L224) | 背景处理可作预处理对照；多数规则不视为 topology，不列主链 |
| F 4 邻小域清理；E 4 邻小域清理 | `SOURCE VERIFIED` | [`F cleanSmallRegions`](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L321-L365)；[`E reduceTinyRegions`](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L363-L427) | 仅作受保护 cleanup 的比较臂；二者都不是 Level 4 拓扑保证 |
| 统一 `NOISE/DETAIL/HIGHLIGHT/STRUCTURE/BRIDGE/SEPARATED_COMPONENT/UNKNOWN` 证据门 | `CONCEPT ONLY` | 七分类是本项目安全要求；外仓只给出部分证据，见 [四层审计](TOPOLOGY_AUDIT.md) | 先采源证据，后判可否改格；只有高置信度 `NOISE` 可自动删，`UNKNOWN` 保留 |
| 开口/孔洞/桥接的完整反事实守恒 | `CONCEPT ONLY` | G 仅检验单 owner 删除后连通，不测所有孔洞/开口 | 若未来实施应在每次改格前/后核查，当前不宣称任何已审仓库提供完整实现 |

独立实验接口已放在 [`advisor.mjs`](../../src/algorithms/adaptive-resolution/advisor.mjs)，仅返回建议和诊断，不连接 UI/生成器。它输出 `recommendedLongSide/Cols/Rows, imageClass, reasons[], confidence, diagnostics`：`bead-grid-studio` 复现上述固定分类/尺寸 baseline；`hybrid-v2` 候选长边 **52/78/104/120/140/160**，只有调用方低成本预评估明确给出结构、拓扑和细节均保留时，才选最小可用尺寸，否则退回 baseline 并标未验证。`manualSize` 原样保留。这里的 `confidence` 是**本项目本地代理值，不是上游提供/校准的概率**；不得用于产品质量承诺。候选预评估的实际图像 evaluator 尚未接入，故 Hybrid V2 仍为 `CONCEPT ONLY`，不能把接口存在当作算法通过 benchmark。
