# mard-bead-generator 源码审计

审计版本：[`309d478`](https://github.com/Archmays/mard-bead-generator/tree/309d47825c5d0a144b17a6fbcb9da9ed86412d42)。

## 实际链路

布局/分析图 → 7×7 或全像素定点抽样 → 线性 RGB 均值或高变化时 dominant RGB 桶 → Lab65 → 全色卡匹配 → 非 `closest` 模式选择实体 MARD 子集并重匹配 → 小连通域净化 → 指标。调用顺序见 [`generate.ts` L45–99](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/generate.ts#L45-L99)。

## 源码事实

- `samplingPositions` 在豆格跨度≤8时全取，大于 8 时每轴 7 个点；RGB 4-bit 桶统计优势色。`variance>0.012` 或亮度跨度 `>0.24`，且最大桶占比 `≥0.2` 时取 dominant，否则取线性均值。另算 `edgeWeight` 与透明覆盖率。不是连续面积积分，也不是语义分割。见 [`imageSampling.ts` L33–169](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L33-L169)。
- 匹配用 `culori` Lab65/ΔE00，但先按 ΔE76 平方距离截 12 候选。理论上可漏掉真实 ΔE00 最优色，因此不能宣称“全色卡精确 ΔE00 最近”。见 [`colorMatching.ts` L1–91](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/colorMatching.ts#L1-L91)。
- `buildRepresentativeClusters` 先压缩到最多 128 个带边缘权重的 Lab 代表点；后续贪心颜色数曲线、交换改良与相对误差质量上限，用于 `balanced/minimal` 模式的色卡子集。见 [`paletteOptimization.ts` L5–20](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/paletteOptimization.ts#L5-L20)、[L65–174](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/paletteOptimization.ts#L65-L174)、[L188–340](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/paletteOptimization.ts#L188-L340)。
- 清理仅检查 4 邻连通域，按模式容许 1/2/3 颗；拒绝高 `edgeWeight`、高色度边界、邻色差过大或源图误差增加过大的替换。比裸多数滤波可控，但没有独立眼/皮肤语义。见 [`regionCleanup.ts` L5–103](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/regionCleanup.ts#L5-L103)。

## 相对 CURRENT

CURRENT 已有多模式采样、色号预算与受保护区域清理。可借鉴并 benchmark 的不是基础 ΔE00，而是**指标约束的自动 K 曲线**和**源图误差增量作为清理准入条件**。12 候选预筛不建议直接迁入，先测 CURRENT 完整 ΔE00 性能与误差。注意质量指标是在代码中计算，不等于已有主观图像基准测试。

许可证及第三方：[MIT LICENSE](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/LICENSE)、[THIRD_PARTY_NOTICES](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/THIRD_PARTY_NOTICES.md)。
