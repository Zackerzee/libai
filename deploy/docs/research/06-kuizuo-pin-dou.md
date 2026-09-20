# kuizuo/pin-dou 源码审计

审计版本：[`e94193c`](https://github.com/kuizuo/pin-dou/tree/e94193cbdebe9ea4d774ca62025ef46f0ef0d281)。主生成路径 [`imageToPattern`](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L621-L698)。

## 实际链路

源图变换/居中布局 → Canvas 重采样成每豆格 8×8 → 每格同时算 alpha 加权的线性 RGB 平均与 RGB 3-bit dominant → `average/dominant/edge` 模式择一（edge 依据相邻格均值 Lab 色差）→ MARD 可用色/排除色选择 → 原像素先映射可用色，再通过候选子集 remap → `edge/dominant` 模式连通域净化 → 全局相近色号合并 → 镜像/装版。见 [`pattern.ts` L433–698](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L433-L698)。

- `edge` 模式：若四邻中最大平均色差≥9 且本格均值与 dominant 色差≥1.5，取 dominant，否则取平均；这是**格间结构判断**，不同于 A 的格内方差触发，也不同于 CURRENT 的综合 edgeScore。见 [`pattern.ts` L505–572](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L505-L572)。
- 色差：RGB→Lab 后的 `color-diff` `diff`；仓库以 34 组公开 CIEDE2000 参考值测试这个 `colorDistance`，因此此调用路径有明确 ΔE00 测试证据；另有 `labDistance` 欧氏距离用于其他用途。见 [`beads.ts` L5–42](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/beads.ts#L5-L42) 和 [`tests/color-diff.test.ts`](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/tests/color-diff.test.ts)。本审计未单独运行依赖包测试。
- `choosePalette`：先把源像素匹配到实体色，统计频数；以最大频数色开局，再按 `到已选色最短色差×sqrt(频数)` 扩展。与随机 K-means 不同，确定性，但可能偏好稀有强对比色。见 [`pattern.ts` L282–319](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L282-L319)。
- 净化：4 邻连通域≤2 颗/色差≤12；dominant 模式放宽到≤4/≤18；随后全局相似色合并默认阈值 5。缺源图/五官/轮廓保护。见 [`pattern.ts` L321–430](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L321-L430)。
- 背景另有边缘取色+4 邻泛洪的处理路径，但与主体生成流程分开；不可误称为无条件背景去除。见 [`background.ts` L7–103](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/background.ts#L7-L103)。

相对 CURRENT：面积/alpha 均值、dominant、edge-aware、实体色卡预算和小域净化均已有变体。可 benchmark **格间边缘触发**和**频数×多样性选色**，但仍需源图误差与保护掩码。快照无根 LICENSE/NOTICE、`package.json` 无 license 字段；**不复制代码**，只研究思想，见 `LICENSE_AUDIT.md`。

Connectivity 补充：[`cleanSmallRegions()`](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L321-L365) 确有同色 4 邻 BFS；[`background.ts`](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/background.ts#L34-L102) 另有背景连通路径。两者不能互相替代，且都没有删除前的桥/孔洞/开口反事实检验。见 [四层审计](TOPOLOGY_AUDIT.md)。
