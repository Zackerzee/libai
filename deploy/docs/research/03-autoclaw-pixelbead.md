# autoclaw-pixelbead-cli 源码审计

审计版本：[`374de10`](https://github.com/Starrylyn/autoclaw-pixelbead-cli/tree/374de10c48cd49fb8185f3e2d4311b7b0e429114)。

## 实际链路

CLI 载图 → Sharp Lanczos3 缩到网格每轴 8/6/5 倍 → 每豆格 RGB 5-bit 桶 dominant → 可选背景去除 → 可选 Floyd–Steinberg → 全色卡 ΔE00 匹配或“先全匹配、再保留边界色/常用色重匹配” → 默认连通域清理 → 可选相近色缩减 → 可选轮廓增强或加黑轮廓。真实调用见 [`convert.ts` L117–181](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/cli/convert.ts#L117-L181)。

## 关键区分

- `extractDominantColors` 是固定 5-bit RGB 桶频数，**没有**格内方差或显著边检测；先缩放再桶投票可能改变 1 豆细节。缩放倍率按板最大边 ≤39/≤80/>80 分别 8/6/5。见 [`image-loader.ts` L94–219](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/image-loader.ts#L94-L219)、[L266–342](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/image-loader.ts#L266-L342)。
- 限色时“边界色”定义是一个色号的豆中超过 30% 与异色相邻/贴板边；保护的是**整个色号**，非精确位置。超过 `maxColors` 仍需按使用量截断保护色。可维护轮廓色，但也可保留噪声边色。见 [`color-matcher.ts` L144–289](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L144-L289)。
- `cleanNoise` 4 邻连通域≤默认 3 颗直接改成接触次数最多邻色，不核对源图、ΔE 或脸部保护，风险高。见 [`noise-cleaner.ts` L249–306](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/noise-cleaner.ts#L249-L306)。
- 描边存在两条可选路径：沿已有边界换深色、或在外圈扩张 1 豆的黑轮廓；不是修复原有木框色连续性的同一种操作。见 [`outline.ts` L112–440](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/outline.ts#L112-L440)。

## 相对 CURRENT

dominant 桶、背景去除、ΔE00、限色和连通域清理均有对应概念。可单独测**色号级边界频率**作为预算排序的辅助指标，但必须和 CURRENT 的像素级轮廓锁/源图证据交叉验证。裸≤3颗合并及自动黑轮廓不建议引入主链。该仓库 [`package.json`](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/package.json) 写 MIT、README 也写 MIT，但快照无独立 LICENSE 文本，复制前需确认授权范围。
