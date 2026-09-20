# 08 · LunarXuan/Pindo 源码级审计与隔离实验

固定源码：[`4ae361383a1912eac843a1ea4ed44298ca6cd660`](https://github.com/LunarXuan/Pindo/tree/4ae361383a1912eac843a1ea4ed44298ca6cd660)。本地取得源码并逐一核对被实际网页入口调用的文件；以下 `PINDO VERIFIED SOURCE` 仅表示该固定提交的真实实现，不表示质量结论。`PINDO_NATIVE` 是 [独立 GPL 派生实验目录](../../src/algorithms/engines/pindo-native/NOTICE.md)，**没有接入 CURRENT 或正式网站**。

## 真实入口与调用链

`app/page.tsx::generate`（约 L151–244）是网页“生成图纸”的实际入口：

`loadPalette → applyPaletteFilters → loadImage → imageToPixels → [cropToSubject，仅 lowResOptimize 且双边≤58] → sharpenSource → downscale → adjustPixels → sharpenPixels → [applyDithering] → matchColors → buildUsageMap/selectKeyColorIds → [limitPaletteWithKeyColors → 再次 dither/match] → [removeIsolatedNoise → majorityFilter，仅 lowResOptimize] → BeadPattern.cells → PatternPreview/ExportPanel`。

`lib/engine/pipeline.ts::runPipeline` 是另一个公开函数，但在该提交的 `app/page.tsx` 中**没有被调用**。它仅做载图、默认平均采样、抖动/匹配、矩阵构造，**不能代表实际 UI 的调色、限色和低分辨率链路**。`pattern-recognition.ts` 属于另一个“图纸识别”工作模式，不是照片生成链路。`stroke-extract.ts::extractStrokeMask` 存在，但生成入口未调用；不能据此声称实际生成已启用描边保护。

## 算法账本（PINDO VERIFIED SOURCE）

表中输入/输出采用简写：RGBA=宽高及四通道像素；Pixel[]=每颗豆的 RGB 数组；Color[]=含 id/code/rgb/lab 的色卡；Cells=二维 colorId 矩阵。源码链接均固定提交。

| 文件 / 函数 | Caller → Callee | 输入 → 输出；参数 | 实际算法与用途 |
|---|---|---|---|
| [`lib/data/palettes/loader.ts::loadPalette`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/data/palettes/loader.ts) | `generate` → JSON 动态导入 | brand → Color[]；默认 `mard` | 按品牌加载预编译 RGB/Lab 色卡并缓存；无图像量化。 |
| `app/page.tsx::applyPaletteFilters` | `generate` → 两次 filter | Color[]、include/exclude 集合 → Color[] | 可按色号系列和具体色号筛选；筛空则退回原色卡。 |
| [`lib/engine/image-loader.ts::loadImage/imageToPixels`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/image-loader.ts) | `generate` → 浏览器 Image/Canvas | File、background → RGBA；默认 white | 浏览器解码；先用白/黑填画布，再 `drawImage`，`getImageData`。无独立滤镜/类别识别。`processAlpha` 函数存在，但该入口未调用。 |
| [`subject-crop.ts::cropToSubject`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/subject-crop.ts) | `generate` 条件调用 → 边框背景估计/BFS | RGBA、background、alphaThreshold=20、colorTolerance=20、paddingRatio=.02、minCropFillRatio=.96 → RGBA 裁剪及偏移 | 边框 4-bit RGB 直方图估背景；前景采样到最长边≤256 的粗网格；4 邻域组件、保留≥最大组件 2% 的组件；padding 后若裁剪过小或接近全图则不裁。只在低分辨率优化打开且宽高均≤58 时使用。 |
| [`adjustments.ts::sharpenSource`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/adjustments.ts) | `generate` → — | RGBA、sharpness → 原地 RGBA | 缩小前 4 邻域 Laplacian 锐化；默认 0。 |
| [`downscaler.ts::downscaleAverage`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/downscaler.ts) | `generate/downscale` → `srgbToLinear/linearToSrgb` | RGBA、目标宽高 → Pixel[]；默认 average | 每格取 `floor` 起点、`ceil` 终点构成的源图矩形，**对区域内所有像素做线性 RGB 算术平均后编码回 sRGB**。不是中心点、median、cluster，也不是插值库。相邻格在非整数缩放时可共享边缘源像素。 |
| `downscaler.ts::downscaleDominant` | `downscale` → — | RGBA、尺寸 → Pixel[]；mode=dominant | 每格将 RGB 各右移 2 位建频次桶，选出现最多的桶，再取桶内原 RGB 平均。 |
| `downscaler.ts::downscaleEdgeAware` | `downscale` → 局部亮度/直方图 | RGBA、尺寸、edgeLumaDelta=18（低分辨率时10）、dominantFill=false（低分辨率时true）→ Pixel[] | 中心加权线性均值，比较右/下像素亮度差；edgeStrength≥.25 计入 6-bit 色桶；edgeRatio≥.045、edgeShare≥.55 且最佳边缘色亮度比 fill 暗≥阈值时选边缘色，否则可选非边缘主桶或均值。是**格内颜色采样保护**，不是连通性/拓扑保护。 |
| [`adjustments.ts::adjustPixels/sharpenPixels`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/adjustments.ts) | `generate` → — | Pixel[]、brightness/contrast/saturation/sharpness → Pixel[] | 亮度加 `brightness×2.55`，对比度以128为轴缩放，饱和度按亮度灰值缩放；高亮低色度区域抑制饱和提升/可去色，以减轻彩色 halo；再做格网 Laplacian 锐化。默认均0。 |
| [`dithering.ts::applyDithering`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/dithering.ts) | `generate` → matchFn | Pixel[]、width/height、mode、matchFn → Pixel[] | 默认 none；Floyd–Steinberg 从左到右、从上到下，误差给右7/16、下左3/16、下5/16、下右1/16，每次扩散后 RGB 四舍五入并裁到0..255。`ordered` 只是 placeholder，原样返回像素。 |
| [`color-matcher.ts::rgbToLab/matchColor/matchColors/ciede2000`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/color-matcher.ts) | `generate` → 每格遍历 Color[] | Pixel[]、Color[] → 匹配 Color[] | 源 RGB 先 sRGB 解码转 XYZ/Lab；色卡使用 JSON 内预编译 Lab；对**全部候选逐个计算其源码实现的 CIEDE2000**，严格 `<` 取首个最小者。无 RGB 欧氏、ΔE76 预筛或缓存。`buildPaletteMap` 存在但本调用链未用。 |
| [`palette-limit.ts::buildUsageMap/selectKeyColorIds/limitPaletteWithKeyColors`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/palette-limit.ts) | `generate` → 再次 `matchColors` | 已匹配 Color[]、Color[]、maxColors → 缩减 Color[]/protectedIds | **先全色卡匹配再限色**。统计色号使用量；关键色包含全色卡最暗/最亮，以及稳定已用色里高饱和分≥28的候选。使用量前 N 入选，再补关键色；超额优先删未保护的低饱和中亮灰，直至预算，然后**用缩减色卡重新匹配原调整后格色**。不是自由色量化后落色卡。默认 maxColors=16。 |
| [`pattern-cleanup.ts::removeIsolatedNoise`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/pattern-cleanup.ts) | `generate` 仅 lowRes → 4 邻域 BFS | Cells、尺寸、size≤2、关键色集合、色号亮度 → Cells | 同色 4 邻域组件≤2 才考虑；保护关键色；若与邻居最大亮度差≥42，入口没有传高反差 mask，故**一律保留**；其余换成边界 4 邻域频次最高色。无语义化“眼睛/耳环/桥”分类。 |
| `pattern-cleanup.ts::majorityFilter` | `generate` 仅 lowRes → — | Cells、尺寸、minMajority=6 → Cells | 3×3（含自身）最高频色计数≥6 即替换。函数支持 strokeMask，但实际生成调用**未传**。 |
| [`creative-mode.ts::CREATIVE_MODE_SETTINGS`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/engine/creative-mode.ts) | UI preset → `generate` 参数 | fine/rough/simple → mode/dithering/lowRes/contrast/saturation | 不是照片/插画/像素画自动识别；fine=average/no cleanup；rough=dominant+lowRes；simple=edge-aware+lowRes。 |
| `app/page.tsx::generate` → [`lib/export/png-exporter.ts::renderPatternToCanvas`](https://github.com/LunarXuan/Pindo/blob/4ae361383a1912eac843a1ea4ed44298ca6cd660/lib/export/png-exporter.ts) | ExportPanel → canvas | BeadPattern.cells、Color[]、cellSize/grid/codes → PNG canvas/blob | `generate` 最终按匹配色 id 建二维矩阵；PNG 出图有珠格、棋盘分块、色号/图例选项。渲染不反馈生成算法。 |

## 十个专项回答

1. **为什么照片效果可能好？** VERIFIED：大范围线性 RGB 平均可抑制格内随机噪点；实体色卡 ΔE00 映射、固定预算重匹配有助控制色数；高亮低色度调整减少彩边。**推断**：这几项可能解释某些照片观感；当前源码和夹具没有证明它在所有照片上优于 CURRENT，且本次 8 张合成照片级夹具的小组件指标反而普遍更高。
2. **每颗豆颜色**：默认是源区域所有像素线性 RGB 平均；dominant/edge-aware 为手选的替代模式。不是中心点。
3. **顺序**：裁剪（仅条件）→缩小到豆格→格色调整→匹配。没有先插值放大再抽中心点。
4. **插值**：默认使用手写 floor/ceil 区域均值，非 nearest/bilinear/bicubic API；浏览器仅用于原始解码与 alpha compositing。
5. **Palette Matching**：源码版 CIEDE2000 全候选扫描，色卡 Lab 预存；无 ΔE76 shortlist。
6. **MaxColors**：首次实体色卡匹配→使用量/关键色限色→二次实体色卡匹配。可能 `usedColors < maxColors`；筛出的 palette 不等于最终 usedColors。
7. **Cleanup**：只有低分辨率优化分支中的小组件替换与3×3多数滤波；没有独立 edge cleanup/anti-alias cleanup/similar-color merge。邻接、边界频次存在，但不是完整 topology 改变检测。
8. **Dithering**：默认关闭；Floyd–Steinberg 如上；ordered 尚未实现实际抖动。
9. **图片类别策略**：没有 PHOTO/ILLUSTRATION/PIXEL ART 自动分类及分支。只有 fine/rough/simple 用户创作预设。
10. **保护**：edge-aware 采样可保较暗边缘；关键色保护的是全局最暗/最亮/高饱和色号，不是逐格结构；高亮低色度去 halo。没有可验证的 opening/hole/bridge/separated-part topology guard，也没有人眼高光语义保护。`stroke-extract` 未接生成。

## 实验引擎、接口与限制

`runPindoNative(input, options)` 与 `runPindoLibmsPalette(input, {...options,palette})` 位于 [`index.mjs`](../../src/algorithms/engines/pindo-native/index.mjs)。输入是已解码 RGBA `{width,height,data}` 或 `{imageData}`，输出 `{matrix,cols,rows,palette,usedColors,diagnostics}`。这里把浏览器 `File→Image→Canvas` 边界换成 RGBA 注入；算法顺序、Pindo 调色/采样/匹配/预算/低分辨率清理独立移植。上游八套色卡均在隔离目录，默认 Pindo MARD 291 色；`options.brand` 可切换，`options.creativeMode` 可选 fine/rough/simple，其他数值也可显式覆盖。第二实验臂仅替换为 CURRENT 的 MARD 色板，其他参数不变。**这是源码移植，不是对上游 UI 的逐像素一致性认证**；尚未做浏览器端同图 golden-output 对拍。透明 PNG 在浏览器 Canvas 的 premultiplied alpha/色彩管理可能与 Node PNG 解码有差异。

`matrix` 单元统一 `{code,rgb}` 供独立指标统计。上游 `BeadPattern` 用 `{colorId}`；这是接口适配而非生成算法改动。若跨平台复用，应先验证色卡 JSON 的第三方数据权利。

## CURRENT vs PINDO_NATIVE vs PINDO_LIBMS_PALETTE

可重跑：`node src/algorithms/engines/pindo-native/benchmark.mjs --images`。8 张现有 `tests/fixtures/real-failures` 均是**程序生成的“照片级”测试图**，不是真实用户照片/人工真值；同一 PNG、104×104、`maxColors=24`。CURRENT 使用项目 `generateV2(preset:auto)`；PINDO_NATIVE 用 Pindo MARD 291 色；PINDO_LIBMS_PALETTE 只换为项目 MARD 色表。两套 MARD 基础色在此数据集上非常接近，所以 native/libms 指标多处相同。`maxColors` 数字一致，但预算语义不同。三联 PNG 顺序固定为 **CURRENT | PINDO_NATIVE | PINDO_LIBMS_PALETTE**；可逐张检查 [眼睛](pindo-ab/rf-portrait-eye.png)、[平色碎片](pindo-ab/rf-flat-frag.png)、[抗锯齿污染](pindo-ab/rf-aa-leak.png)、[边缘](pindo-ab/rf-edge-contam.png)、[复杂场景](pindo-ab/rf-complex.png)、[高光](pindo-ab/rf-anime-hl.png)、[分离部件](pindo-ab/rf-small-sep.png)、[细线](pindo-ab/rf-thin-struct.png)。

| 夹具 | CURRENT 色数/单颗组件 | Pindo 原色板 色数/单颗组件 | Pindo 我方色板 色数/单颗组件 |
|---|---:|---:|---:|
| anti-alias leakage | 8 / 1986 | 14 / 3830 | 14 / 3830 |
| anime highlight | 14 / 35 | 23 / 808 | 23 / 808 |
| complex scene | 21 / 259 | 22 / 338 | 22 / 342 |
| edge contamination | 19 / 711 | 23 / 1188 | 23 / 1188 |
| flat fragmentation | 5 / 1048 | 15 / 5219 | 15 / 5219 |
| portrait eye | 14 / 65 | 24 / 1039 | 24 / 1037 |
| small separated part | 13 / 39 | 23 / 765 | 23 / 765 |
| thin structure | 6 / 95 | 14 / 790 | 14 / 792 |

这里“单颗组件”指**相同色号的 4 邻域连通块恰有一格**，并不自动等同噪点。Pindo 默认低分辨率清理在 104×104 **不会启动**；不能据此评价其低分辨率预设。外边框变化次数、≤2格组件、总组件等也由脚本给出。三联图肉眼可见：此夹具中的眼睛黑瞳在三臂均保留，而 Pindo 两臂的肤色背景有更多细小色点；平色绿场也更碎。这只是当前夹具现象，不是一般照片优劣结论。人物眼睛、高光、轮廓连贯、色彩还原的好坏仍需要人工真值或盲评；测试图来自固定合成分布，不能推断真实照片总体表现。

## Hybrid V2 候选分类（不接入）

| 模块 | 分类 | 依据/冲突 |
|---|---|---|
| 线性 RGB 区域平均（Pindo 默认） | EXPERIMENTAL_MERGE | `downscaler.ts::downscaleAverage` 已验证；对真实照片需与 CURRENT 自适应采样盲评，不能直接替换。 |
| 边缘暗色采样 / dominant fill | EXPERIMENTAL_MERGE | `downscaleEdgeAware` 已验证，但与 CURRENT 结构采样可能冲突；只做隔离 A/B。 |
| ΔE00 全色卡匹配 | KEEP_CURRENT | Pindo 也已验证，但 CURRENT 已有对应能力，无须引入 GPL 派生实现。 |
| 关键色预算与二次匹配 | CONFLICT | 与 CURRENT 保护预算语义不同；可比较，不能直接叠加。 |
| Floyd–Steinberg | NOT_NEEDED | 本产品默认无抖动；传统误差扩散可能增加孤立豆。 |
| ≤2组件删除、3×3多数滤波 | KEEP_CURRENT | Pindo 只在≤58低分辨率预设用，无完整 topology guard；不能代替 CURRENT 保护门。 |
| Pindo MARD palette JSON | CONFLICT | 色值近似，数据条目标 `community` 并非清晰单独授权；无需合并。 |
| 项目正式生成主链 | KEEP_CURRENT | 本阶段禁止替换。 |

本阶段到此停止：无网站改动、无 CURRENT 改动、无自动 Hybrid 融合。
