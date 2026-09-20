# Perler_Beads_Generator 源码审计

审计版本：[`36ac52d`](https://github.com/Jett-Wu/Perler_Beads_Generator/tree/36ac52d570246ab600611a79edd2236bccb954e5)。

## 实际链路

浏览器 Canvas 原尺寸读图 → 每豆格固定 7×7（cartoon）或 5×5（realistic）均匀采样，识别背景 → 采样点色卡排名/候选限色 → **每个采样点先投影到候选实体色，再以色号投票**；realistic 在主色票占比不足时可退回均值匹配 → 全局相近色合并 → 4 邻小区域清理 → 多轮斑点清理。见 [`imageToBeads.ts` L8–71](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L8-L71)、[L89–147](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L89-L147)、[L309–490](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L309-L490)。

## 独特处与局限

- “色号投票”不同于原 RGB dominant，也不同于豆格均值后一次匹配。固定采样密度、先限色，会使候选预算影响采样表征；值得做**独立采样/限色顺序实验**。`cartoon/realistic` 主色占比阈值分别 0.34/0.26，背景占比阈值 0.72/0.58。见 [L8–38](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L8-L38)、[L309–326](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L309-L326)。
- 色差是加权 RGB，不是 ΔE00；见 [`palette.ts` L350–374](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/palette.ts#L350-L374)。全局相近色合并、4 邻域≤1/2/5/9 颗净化及斑点迭代均按 `speckleStrength` 增强，没有 CURRENT 的显式五官/轮廓保护。见 [`imageToBeads.ts` L328–490](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L328-L490)。
- 对高饱和、亮度差、暗色/浅中性等设不同相似阈值，可作为色块清理候选规则；需对照 CURRENT 的源图证据，不能只看输出 RGB 距离。见 [L462–488](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L462-L488)。

相对 CURRENT：多阶段净化和实体色卡限制概念重复；色号投票与语义/色度感知的清理门槛可 benchmark，但不直接替换现有链路。[MIT LICENSE](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/LICENSE)。

补充核查：[`usage.ts/findIsolatedBeads`](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/usage.ts#L27-L53) 是各用量图层的 4 邻“周围无任何豆”检测，**不要求邻豆同色，也不在该函数内自动删除**；不要与 `reduceTinyRegions()` 的同色 4 邻 BFS 混为一谈。这两者都不是开口/孔洞/桥接保护。见 [四层审计](TOPOLOGY_AUDIT.md)。
