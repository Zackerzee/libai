# Unified Bead Algorithm Audit — Phase A 结论

范围：六仓固定提交源码 + CURRENT 只读比较；没有修改生成器、UI、导出或色卡，没有实现 Hybrid V2。证据汇总见 [统一矩阵](UNIFIED_ALGORITHM_MATRIX.md)、[参数](ALGORITHM_PARAMETERS.md)、[冲突](ALGORITHM_CONFLICT_MATRIX.md)、[许可](LICENSE_AUDIT.md)。下面按任务指定的 10 个问题作答。

1. **CURRENT 未有的算法？** [A 的有限候选、空间平滑能量逐格 ICM](01-pindou-studio.md) 是最明确的 `NEW`。A 的格内方差触发二簇、E 的“先匹配实体色再格内投票”、B 的自动 K 质量曲线，是 CURRENT 未以相同方式实现的 `VARIANT`，不等于 CURRENT 没有采样、限色或清理。六仓未确认独立的 boundary-histogram merge 或通用 topology analyzer，不能虚报新算法。
2. **哪些重复？** RGB/线性 RGB 均值、dominant、Lab/ΔE00、实体色卡匹配、maxColors、边缘/结构保护、背景去除、连通域与孤豆净化、平坦色块规整，都在 [CURRENT](../../smart-preprocessing/) 有相应机制；外仓常是规则/参数不同。D 的加权 RGB 与 8 邻多数还比 CURRENT 保护能力弱。
3. **Adaptive Cell Sampling 几种真实实现？** 至少四类不同触发：A 格内线性 RGB 方差→二簇；B 格内方差/亮度跨度→RGB 桶 dominant；F 邻格 Lab 色差→格内 dominant；CURRENT 以梯度/方差/簇分离综合 edgeScore 选模式。E cartoon/realistic 是不同固定 profile 加色号投票，不宜误叫同一类“自适应”；C 的缩放倍率随板尺寸变是**采样密度**适应，不是逐格颜色策略自适应。
4. **哪几种进 benchmark？** A 二簇、B 方差 dominant、E 色号投票、F 邻格触发，均与 CURRENT 同图、同尺寸、同色卡比较。A 二簇/B 最先，E 因采样与限色耦合须独立臂；C/D 仅作简单基线。无数据前不排序为“更好”。
5. **真正可用的 ICM？** 有，[A `spatialRefinement`](01-pindou-studio.md) 确实运行，以 ΔE00 数据项 + 邻色差平滑项迭代，短边≤120 时启用。它无 CURRENT 的眼/高光/轮廓锁，不能直接作为安全主链；应做受约束原型 benchmark。
6. **Region Cleanup 测什么？** 优先 [B 的边缘/色度/源图误差增量闸门](02-mard-bead-generator.md) 相对 CURRENT 清理的消融；次选 E 的色度条件。C/D 的裸多数和高档 E 小域阈值适合负面基线，不建议直接引入。
7. **谁最易伤细节？** C/D 裸多数、小域阈值过大、E 全局合并、A 无保护 ICM、强 dominant、强 maxColors、白背景 flood；对应眼睛、高光、五官、发丝、外轮廓。源码机制见六份仓库报告；实际风险大小仍待回归集。
8. **明显冲突？** 抖动 vs 平坦规整；ICM 平滑 vs 眼/高光；碎片清理 vs 1 豆五官；dominant vs 渐变；maxColors vs 结构色；区域合并 vs 轮廓；白背景去除 vs 白发/浅肤色。见 [冲突矩阵](ALGORITHM_CONFLICT_MATRIX.md)。
9. **Hybrid V2 最小可行内容？** 首先不是新 UI/新主链，而是 CURRENT 固定基线 + 互斥采样臂 + 源图/结构保护图 + B 式误差门控清理 + 最终颜色数/轮廓/眼部指标验收。ICM 只作为第二轮受约束实验。详见 [候选顺序](HYBRID_V2_CANDIDATE_PIPELINE.md)。
10. **哪些暂缓？** 默认 dithering、随机 K-means 替换实体色卡预算、12 候选 ΔE76 近似预筛、黑轮廓扩边、裸多数/强全局合并、未定义的“拓扑自动修复”、大规模 UI/架构更改。先建样本基准和性能剖析再决定。

许可证边界：A/B/E 有 MIT 原文；C 有 MIT 元数据与 README 声明但无独立 LICENSE；D 只有 README 声明；F 无明确根许可。C/D/F 仅研究思想，**不复制实现**。本阶段到此停止。

## G 与纠错追加结论

G [`bead-grid-studio`](07-bead-grid-studio.md) 的源码确认小尺寸单色线稿有**源部件 owner→micro skeleton→目标格候选→局部连通检查**；这比单纯清理孤豆更接近结构/局部拓扑保护。但没有完整孔洞数和开口守恒，不能写成“通用 Level 4 Topology”。CURRENT 已有 G 的独立 BGS 衍生引擎和 Apache-2.0 NOTICE，本轮没有重写/接入第二套。[四层比较](TOPOLOGY_AUDIT.md) 说明 PineBead 的 BFS 仅用于背景，kuizuo/Perler 有小色块连通域却无等价的源 owner 保护。

`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**；从所有实现证据和 Hybrid V2 候选中排除。此前若有算法归属，均撤销为 **UNVERIFIED — DO NOT USE AS IMPLEMENTATION EVIDENCE**。

G 固定尺寸 baseline 的六个分支已在[专项报告](07-bead-grid-studio.md#高优先级adaptive-resolution-recommendation-全流程)逐项核对，另有“非文档大图照片 fallback”、比例最短边 4 格和 UI 提示逻辑可影响结果。独立 [`AdaptiveResolutionAdvisor`](../../src/algorithms/adaptive-resolution/advisor.mjs) 只作离线实验：手动尺寸原样保留，Hybrid V2 仅在六个候选格数均有明确结构/拓扑/细节评估证据时选最小可用格数；目前未连接真实图像预评估器，也未接生成/UI，**不能宣称已找到最优分辨率**。该追加工作不改变原 Phase A 六仓结论的实测状态。
