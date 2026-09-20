# PineBead-Studio 源码审计

审计版本：[`ac15c4c`](https://github.com/MrHorfen/PineBead-Studio/tree/ac15c4ca6cf5d55f810b5223f09c57543599c51d)。

实际链路：载图 → 浏览器 Canvas 缩成目标网格每轴 2 倍（先铺白底）→ 可选边缘连通白/透明背景去除 → 每格 2×2 个像素中 `alpha>32` 的算术 RGB 均值 → 加权 RGB 最近 MARD 色 → 可选 8 邻多数优化。见 [`imageProcessor.js` L1–224](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L1-L224)。

- 不是原图尺度的高精度每豆格面积采样；先压缩到 2× 中间图。没有基于格内方差的动态采样模式。
- 背景规则：边缘出发的 4 邻 BFS，`alpha<128` 或 RGB 三通道都 `>240`，没有颜色相似容差。浅色主体贴边时可被误删。见 [L17–72](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L17-L72)。
- 色差不是 Lab/ΔE00，而是 `sqrt((2+rmean/256)ΔR²+4ΔG²+(2+(255-rmean)/256)ΔB²)`。见 [`mardColors.js` L88–125](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/data/mardColors.js#L88-L125)。
- `optimizeGrid` 用 8 邻颜色≥6 且当前色邻接<2 才替换，可重复指定轮数；无源图误差与轮廓约束。见 [`imageProcessor.js` L156–224](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L156-L224)。

相对 CURRENT 没有值得直接迁移的新核心算法；可当轻量基线用于 benchmark。高亮脸/浅色轮廓与 8 邻多数最易冲突。README 宣称 MIT，但该快照根目录没有 LICENSE 原文；见 [`README.md` L151–154](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/README.md#L151-L154)，复制代码前须取得可靠许可文本。

补充核查：`removeBackground()` 内确有 4 邻 BFS，但只识别**源图边缘背景**；图纸后处理 [`optimizeGrid()`](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L156-L224) 是 8 邻单格多数规则，[`App.vue` 调用 2 轮](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/App.vue#L685-L705)。未见图纸同色 BFS 区域标注、boundary histogram 或组件级 region merge，不能将用户待审关键词误记为已实现。详见 [四层审计](TOPOLOGY_AUDIT.md)。
