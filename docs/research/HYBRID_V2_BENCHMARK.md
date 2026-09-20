# Hybrid V2 Benchmark

> 本文件只给出**指标与方向性判定**。
> **不产出 winner、不产出总分、不声称 Hybrid V2 已优于 CURRENT。**

- 引擎 ID：`hybrid-v2`
- 夹具数：10（10 类回归场景）
- 判定口径：IMPROVED / REGRESSED / UNCHANGED / INCONCLUSIVE

## 判定分布（组 A，全部夹具 × 全部指标）

| 判定 | 次数 |
| --- | ---: |
| IMPROVED | 0 |
| REGRESSED | 0 |
| UNCHANGED | 110 |
| INCONCLUSIVE | 0 |
| **合计** | **110** |

## 组 A：CURRENT vs HYBRID_V2（固定 104×104）

条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors。

### EDGE_CONTAMINATION — 平坦区边沿散布 8 颗红色杂豆

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 140 + 高光 38923 = 39063 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 10.0 | 10.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.654 | 0.654 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 0.562 | 0.562 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 549）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### FLAT_COLOR_BLOCK — 绿色平块里 2 颗黑色碎片

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 46 + 高光 5408 = 5454 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.993 | 0.993 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 126）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### PORTRAIT_EYE — 双眼瞳孔（各 2×2 深格）

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 94 + 高光 23328 = 23422 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.973 | 0.973 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 262）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### ANIME_HIGHLIGHT — 深色头发中的 5 格高光

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 81 + 高光 9377 = 9458 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.983 | 0.983 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 177）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### THIN_OUTLINE — 1 格宽折线轮廓

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 279 + 高光 0 = 279 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.938 | 0.938 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 279）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### SMALL_SEPARATED_DETAIL — 蓝色区域内 1 格黄色独立细节

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 23 + 高光 1024 = 1047 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.997 | 0.997 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 44）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### HOLE_OPENING — 圆环：中心必须留孔

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 422 + 高光 35344 = 35766 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 211.0 | 211.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 211.0 | 211.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 37.5%　HYBRID_V2 37.5%（受保护格总数 562）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### BRIDGE — 两块绿色区域由 1 格桥连接

# CURRENT vs HYBRID_V2 @ 104×80

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 276 + 高光 0 = 276 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 2.0 | 2.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.668 | 0.668 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 1.0 | 1.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 276）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### COMPLEX_SCENE — 七色斜带复杂场景，maxColors=5

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：5
- 受保护格基准（**来自源图，两臂共用**）：结构 514 + 高光 0 = 514 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 5.0 | 5.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 11.0 | 11.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.426 | 0.426 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 0.689 | 0.689 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 514）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

### SIMPLE_CARTOON — 三色平涂，不应引入碎片

# CURRENT vs HYBRID_V2 @ 104×104

- 条件：同一输入图 / 同一尺寸 / 同一 Palette / 同一 MaxColors
- 色板 8 色　maxColors：AUTO
- 受保护格基准（**来自源图，两臂共用**）：结构 104 + 高光 10816 = 10920 格，判定容差 CIEDE2000 ≤ 12

| 指标 | CURRENT | HYBRID_V2 | Δ | 判定 | 依据 |
| --- | ---: | ---: | ---: | --- | --- |
| paletteSize | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| isolatedCellCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| componentCount | 3.0 | 3.0 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| smallComponentCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| edgeContaminationCount | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedDetailLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| flatRegionFragmentation | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.05 |
| dominantColorRatio | 0.385 | 0.385 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| structureSimilarity | 0.667 | 0.667 | 0.000 | UNCHANGED | |Δ|=0.0000 < 0.01 |
| protectedEdgeLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |
| protectedHighlightLoss | 0.000 | 0.000 | 0.000 | UNCHANGED | |Δ|=0.0000 < 1 |

保护损失占比：CURRENT 0.0%　HYBRID_V2 0.0%（受保护格总数 208）

winner：`null`（本工具不产出）

IMPROVED/REGRESSED 只针对单指标的方向性判断，不构成整体优劣结论；ambiguous 指标一律 INCONCLUSIVE。

## 组 B：104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

这一组**单独**存在，用来区分「算法变好了」与「只是尺寸变大了」。

### EDGE_CONTAMINATION — 平坦区边沿散布 8 颗红色杂豆

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.03 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.42 | more-per-cell |
| componentCount | 0.09 | 12.85 | more-per-cell |
| smallComponentCount | 0 | 4.35 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 50.22 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 0.562 | 0.917 | more-per-cell |

保护损失占比：固定104 0.0%（39063 个受保护格）　AUTO 60.7%（45632 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### FLAT_COLOR_BLOCK — 绿色平块里 2 颗黑色碎片

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.02 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.27 | more-per-cell |
| componentCount | 0.03 | 12.28 | more-per-cell |
| smallComponentCount | 0 | 3.29 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 50.64 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 1 | 0.921 | fewer-per-cell |

保护损失占比：固定104 0.0%（5454 个受保护格）　AUTO 58.6%（59527 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### PORTRAIT_EYE — 双眼瞳孔（各 2×2 深格）

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.02 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.29 | more-per-cell |
| componentCount | 0.03 | 12.35 | more-per-cell |
| smallComponentCount | 0 | 3.43 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 49.78 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 1 | 0.911 | fewer-per-cell |

保护损失占比：固定104 0.0%（23422 个受保护格）　AUTO 58.8%（58300 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### ANIME_HIGHLIGHT — 深色头发中的 5 格高光

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：140×140（19600 格，长边 140）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:2 / smallestViable:140

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.02 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.01 | same |
| componentCount | 0.03 | 6.76 | more-per-cell |
| smallComponentCount | 0 | 0.04 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 0.93 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0.01 | same |
| structureSimilarity | 1 | 0.033 | fewer-per-cell |

保护损失占比：固定104 0.0%（9458 个受保护格）　AUTO 54.2%（1490 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### THIN_OUTLINE — 1 格宽折线轮廓

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.02 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.33 | more-per-cell |
| componentCount | 0.02 | 12.54 | more-per-cell |
| smallComponentCount | 0 | 3.79 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 48.26 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 1 | 0.891 | fewer-per-cell |

保护损失占比：固定104 0.0%（279 个受保护格）　AUTO 59.0%（55967 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### SMALL_SEPARATED_DETAIL — 蓝色区域内 1 格黄色独立细节

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.02 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.27 | more-per-cell |
| componentCount | 0.02 | 12.28 | more-per-cell |
| smallComponentCount | 0 | 3.29 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 51.01 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 1 | 0.924 | fewer-per-cell |

保护损失占比：固定104 0.0%（1047 个受保护格）　AUTO 58.7%（59803 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### HOLE_OPENING — 圆环：中心必须留孔

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.01 | 0 | fewer-per-cell |
| isolatedCellCount | 0 | 0.16 | more-per-cell |
| componentCount | 0.01 | 5.75 | more-per-cell |
| smallComponentCount | 0 | 1.56 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 1.95 | 25.19 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 1 | 0.886 | fewer-per-cell |

保护损失占比：固定104 37.5%（35766 个受保护格）　AUTO 60.8%（27708 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### BRIDGE — 两块绿色区域由 1 格桥连接

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×80（8320 格）
- AUTO 臂：160×123（19680 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.02 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.32 | more-per-cell |
| componentCount | 0.04 | 12.51 | more-per-cell |
| smallComponentCount | 0 | 3.71 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 33.55 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0.01 | 0 | fewer-per-cell |
| structureSimilarity | 1 | 0.796 | fewer-per-cell |

保护损失占比：固定104 0.0%（276 个受保护格）　AUTO 53.8%（31366 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### COMPLEX_SCENE — 七色斜带复杂场景，maxColors=5

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：140×140（19600 格，长边 140）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:2 / smallestViable:140

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.05 | 0.03 | fewer-per-cell |
| isolatedCellCount | 0 | 0.07 | more-per-cell |
| componentCount | 0.1 | 7.84 | more-per-cell |
| smallComponentCount | 0 | 0.57 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 32.86 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0 | 0 | same |
| structureSimilarity | 0.689 | 0.697 | same |

保护损失占比：固定104 0.0%（514 个受保护格）　AUTO 71.1%（20924 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

### SIMPLE_CARTOON — 三色平涂，不应引入碎片

# 104 vs AUTO（分辨率实验，算法臂固定为 HYBRID_V2）

- 固定臂：104×104（10816 格）
- AUTO 臂：160×160（25600 格，长边 160）
- 尺寸评估状态：`candidate-evaluation-not-optimized`
- 选择理由：viableCandidates:1 / smallestViable:160

| 指标 | 固定104（每百格） | AUTO（每百格） | 方向 |
| --- | ---: | ---: | --- |
| paletteSize | 0.03 | 0.01 | fewer-per-cell |
| isolatedCellCount | 0 | 0.31 | more-per-cell |
| componentCount | 0.03 | 12.47 | more-per-cell |
| smallComponentCount | 0 | 3.66 | more-per-cell |
| edgeContaminationCount | 0 | 0 | same |
| protectedDetailLoss | 0 | 38.72 | more-per-cell |
| flatRegionFragmentation | 0 | 0 | same |
| dominantColorRatio | 0 | 0 | same |
| structureSimilarity | 0.667 | 0.823 | more-per-cell |

保护损失占比：固定104 0.0%（10920 个受保护格）　AUTO 58.5%（31240 个受保护格）

注：两臂分辨率不同 → 受保护格集合本身不同，**只比占比、不比绝对数**。

winner：`null`（本工具不产出）

两臂格数不同，**逐格指标不可直接相减**。以下 comparison 只标方向，不做差值判定。

## 逐指标判定明细（组 A）

| 指标 | IMPROVED | REGRESSED | UNCHANGED | INCONCLUSIVE |
| --- | ---: | ---: | ---: | ---: |
| paletteSize | 0 | 0 | 10 | 0 |
| isolatedCellCount | 0 | 0 | 10 | 0 |
| componentCount | 0 | 0 | 10 | 0 |
| smallComponentCount | 0 | 0 | 10 | 0 |
| edgeContaminationCount | 0 | 0 | 10 | 0 |
| protectedDetailLoss | 0 | 0 | 10 | 0 |
| flatRegionFragmentation | 0 | 0 | 10 | 0 |
| dominantColorRatio | 0 | 0 | 10 | 0 |
| structureSimilarity | 0 | 0 | 10 | 0 |
| protectedEdgeLoss | 0 | 0 | 10 | 0 |
| protectedHighlightLoss | 0 | 0 | 10 | 0 |

---

## 解读与边界（重要）

组 A（CURRENT vs HYBRID_V2 @104）出现 **110/110 UNCHANGED**，根因已定位，不是度量脚本故障：
1. Hybrid V2 的统一保护层直接复用 CURRENT 的 `buildProtectionMap`；清理阶段凡是想改的格，恰好是 CURRENT 已标记为结构/轮廓而保护的格，`requestChange()` 一律 REJECT。
2. 这 10 个夹具是**合成色块图**（最近邻放大到 104 后仍是纯色块），不携带 CURRENT 的「照片派生」缺陷（降采样边沿杂色、平涂碎片、抗锯齿渗色）—— 这些缺陷在真实照片上才出现，在干净色块图上 CURRENT 本身输出就是干净的，没有可供 Hybrid 修正的对象。
3. 在人为撒盐椒噪点的输入上验证：引擎确实识别到 273 个边沿污染候选，但全部被同一套保护层 REJECT，输出仍与 CURRENT 逐格相同。说明引擎**分析逻辑在跑、闸门在生效**，只是与 CURRENT 收敛。
**结论口径**：组 A 全 UNCHANGED = 「在该输入类上两臂不可区分」，故对「Hybrid V2 是否优于 CURRENT」这一提问属于**不可判定 / 信息不足**，而非「两者一样好」。要真正检验算法质量，需要用携带 CURRENT 缺陷的真实照片输入（见下方边界）。

### 边界

- 夹具为合成色块，未覆盖照片 / 渐变 / 抗锯齿这类会触发 CURRENT 7 项缺陷的输入；
- 引擎特征开关默认全关（ICM / 抖动 / 激合并 / 实验主色采样），本 benchmark 不开启；
- 组 B（104 vs AUTO）单独存在，用于把「分辨率差异」与「算法差异」解耦；
- 本文件不产出 winner、不产出总分、不声称 Hybrid V2 已优于 CURRENT。

---

结论栏：**留空**。三组结果并排供人工判断。