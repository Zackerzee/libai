# Pindou-Studio 源码审计

审计版本：[`850a4bf`](https://github.com/Aswellle/Pindou-Studio/tree/850a4bf90ddec036839079f035b813560d00c446)。主入口是 Worker 的 `QUANTIZE` 消息；下文仅描述该版本实际代码，不等同于效果验证。

## 实际链路

载入 RGBA → 可选锐化 → 可选背景识别 → K-means++ 在源图 Lab 上选中心、将中心映射到实体色卡并补足 `maxColors` → 每豆格面积加权采样 → 在选中色卡内以 ΔE00 匹配（可选 FS/ordered dithering）→ 小图 ICM 迭代 → `Uint16Array` 色号索引输出。见 [Worker 主流程 L668–945](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L668-L945)。

## 关键算法

- **采样**：原图像素与豆格矩形的相交面积作权重，在线性 RGB 中求均值；格内线性 RGB 方差 `>0.008` 且至少 4 像素时，以均值和最远 Lab 像素初始化二簇、迭代 3 次，取覆盖权重更高簇的均值。透明权重大于前景权重时留空。此处是确实可运行的 edge-aware cell sampling，但边界色仍可能因多数簇而丢失。见 [L405–520](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L405-L520)。
- **色卡限制**：源图最多采 22000/8000 点，ΔE76 平方距离做 K-means++ 与 16/8 次迭代；中心用 ΔE00 映射实体色，重复中心去重，缺位按原色卡顺序补齐。初始化用 `Math.random`，同图非确定性；补位并非质量最优。见 [L272–357](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L272-L357)。
- **ICM**：每个非空格候选为当前色、四邻色、该格最近色；代价为 `ΔE00(source,candidate)+spatialWeight×平均邻接异色ΔE76`，最多 4/2 次，短边 ≤120 才启用，权重随尺寸取 0.25/0.18/0.12/0.07。真实实现，不是 README 口号；它用顺序原地更新，结果依赖扫描顺序，且无脸部/轮廓锁定。见 [L609–659](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L609-L659)、[L912–919](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L912-L919)。
- **抖动**：蛇形 Floyd–Steinberg 按局部方差及网格分辨率衰减误差；有序抖动只扰动 Lab L；均非默认必经步骤。见 [L815–910](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L815-L910)。

## 相对 CURRENT

CURRENT 已有面积×alpha 采样、Lab/ΔE00 dominant clustering、edge-aware/auto sampling、实体色卡限制、细节保护、连通域清理与轮廓锁定，故这些概念不是空白。真正值得独立 benchmark 的是**格内二簇方差触发策略**与**受保护约束的有限候选 ICM**，不能整段移植：CURRENT 的 [sampling-engine-v2.mjs](../../smart-preprocessing/sampling-engine-v2.mjs) 已有多个采样模式，[region-aware-quantizer.mjs](../../smart-preprocessing/region-aware-quantizer.mjs) 已有保护逻辑。建议以同源输入、同色卡、同预算比较轮廓断裂、脸部小细节和耗时。

许可证：仓库根目录 [MIT LICENSE](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/LICENSE)；归属与依赖见 `LICENSE_AUDIT.md`。
