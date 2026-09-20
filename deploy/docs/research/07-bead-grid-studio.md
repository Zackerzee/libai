# G · bead-grid-studio 源码审计补充

审计快照 [`515e180`](https://github.com/zwhy149/bead-grid-studio/tree/515e1800c194651a4b2542e99d53c1701a3127e8)，Apache-2.0，附 [LICENSE](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/LICENSE) 与 [NOTICE](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/NOTICE)。当前项目**已经有**独立的 [`src/algorithms/bgs/`](../../src/algorithms/bgs/README.md) 衍生模块与 NOTICE，本轮没有重写它。以下是固定版本的源码事实，不是质量胜负。

## A–G：结构与颜色保护的实际规则

**A. Topology refinement** 不是一般后处理平滑。它仅在 `processMode==='cartoon'`、高白底低彩度且有暗墨线的 `monochromeLineArt`、目标长边≤60 时开启。先在源栅格用 8 邻把暗/低彩度像素标为不同 owner，投影到长边至少约 192 像素的 micro 栅格（每豆格至少 4×4、最多约 240），coverage≥0.08 二值化，再做至多 64 轮两相 Zhang–Suen 细化。将 skeleton/墨线面积投票折回目标豆格；每个源 owner 最多存 12 个真实覆盖候选。最后补未落格的小 owner、消解异 owner 8 邻碰撞，必要时报告不可表达。见 [`src/app.js` L1951–2065](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1951-L2065)、[L2300–2372](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2300-L2372)。

**B. 噪点 vs 有意义小部件** 是两条不同判断：源图中独立墨线 owner 即使很小，也保留候选，不用面积单独删除；目标图中的彩色小连通域仅在 cartoon 模式、同色 8 邻组件≤2、所有格 `cellSupport<0.42` 且邻色支持数≥`组件大小+2` 时替换。它没有语义识别“鼻子/眼睛”；依赖的是**源图归属与覆盖支持**。见 [L2039–2062](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2039-L2062)、[L2398–2429](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2398-L2429)。

**C. 开口、孔洞、细线、分离结构**：细线靠源 owner + micro skeleton + coherent-thin-line 门槛；异 owner 接触时优先移除较大 owner 的非关节格，移除前用 8 邻 BFS 验证该 owner 剩余格仍连通；单格 owner 不可牺牲。候选实在冲突或无格可放会进入 `lineUnresolvedConflicts`/`lineUnrepresentableComponents`，并非保证所有开口/孔洞都能保留。源码**没有通用 Euler number/孔洞数不变量**，所以只能说对开口/孔洞有间接保护，不能声称拓扑严格守恒。见 [L2290–2372](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2290-L2372)。特别注意：未落格 owner 的候选若无无冲突位置，会退回有冲突位置并计 `lineForcedCandidatePlacements`；这不是“绝不粘连”的硬保证。

**D. Anchor Color** 有两层：量化时找色卡中最暗中性色作描边锚、优先 `H2` 作白色锚（没有则取最亮中性色）；限色/并色时在**本次已使用色号**里找最深、最浅中性色，加到 anchors 集合。它不是固定把 H7/H2 永远保留：未出现的色不强行加入。见 [L1932–1948](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1932-L1948)、[L2451–2459](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2451-L2459)。

**E. Accent Color**：从已使用且判作可见彩色的色号中，按 `OKLab 色度×log2(使用数+2)` 排序；贪心保留最多 3 个，色相之间环形角距离须 `>0.55 rad`。因此“accent”是色卡级的高色度/使用量/色相多样性启发式，不是人脸或眼睛位置检测。见 [L2459–2470](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2459-L2470)。

**F. 时序**：源图复杂度/线稿识别、取景先于量化；源 owner/micro skeleton 在豆格采样前建立，目标格黑白锚参与采样/匹配；topology 对初始量化格作修正；彩色小域清理在其后；已使用色的黑白/强调锚被计算后，才做相近色合并与 `maxColors` 压缩。预算压缩把 anchor 删除损失乘 40，**不是绝对锁**，预算极紧仍可能删除。见 [L1951–2065](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1951-L2065)、[L2300–2515](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2300-L2515)。

**G. Pure function 可行性**：上游 `convertPixels` 主要计算使用 typed array，可脱离 UI；但源图解码/Canvas 栅格化、app 闭包内设置、色卡索引仍需显式依赖注入。CURRENT 已做这项拆分：[`bgs/index.mjs`](../../src/algorithms/bgs/index.mjs)、[`topology.mjs`](../../src/algorithms/bgs/topology.mjs)、[`refine.mjs`](../../src/algorithms/bgs/refine.mjs) 为无 DOM 的算法边界，色卡由调用方传入。新审计不再重复移植。

## 高优先级：Adaptive Resolution Recommendation 全流程

入口 [`analyzeReferenceImage` L386–399](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L386-L399)：按裁剪矩形把图绘到最长边≤384 的白底 Canvas，像素用于 [`analyzeSourceComplexity` L291–357](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L291-L357) 和 [`analyzeLineArtSubject` L203–289](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L203-L289)。这一步在压缩后的图上算统计，不是原始像素逐点统计。

| 指标 | 计算/阈值（上游源码） |
|---|---|
| `nearWhiteRatio` | alpha 与白色合成后，亮度 `>228` 且通道极差 `<30` 的像素比例 |
| `darkRatio` | 亮度 `<182` 的像素比例；同时建 4 邻小暗组件掩码 |
| `saturatedRatio` | 通道极差 `>52` 且亮度 `<245` 的像素比例 |
| `edgeDensity` | 横/纵邻像素亮度差 `>42` 的邻接对 ÷ 全部横纵对 |
| `transitionDensity` | 相邻像素 `darkMask` 状态不同的对 ÷ 全部横纵对 |
| `flatPairRatio` | 相邻合成 RGB 三通道绝对差之和 `<28` 的对 ÷ 全部横纵对 |
| `quantizedColorCount` | 每 RGB 通道右移 5 位，3×3-bit 共 512 桶中非空桶数 |
| `longLineRatio` | 每行/列最长连续暗段≥对应轴长 `42%` 的行/列数量 ÷ `(width+height)` |
| `smallComponentCount` | 4 邻暗组件，面积 `2…max(24,floor(像素数×.025))`、框宽高≤图宽高 `16%`、框高≥2 的数量 |
| `medianGlyphHeightPx` | 上述组件至少 4 个时，框高按 `sourceHeight/analysisHeight` 还原为源像素后取中位；否则 `null` |
| `documentScore` | `clamp01((nearWhite-.42)×1.25+edge×2.1+transition×2.4+longLine×1.5+(dark∈(.008,.42)? .18:0)-saturated×.45)` |
| `likelyDocument` | `nearWhite≥.48 && edge≥.03 && dark<.30 && ((smallComponents≥4 && transition≥.025)||transition≥.05) && documentScore≥.60` |
| `likelyPhoto` | 非文档且 `quantizedColorCount≥42 && flatPairRatio<.76` |
| `likelyLineArt` | 中性色比例≥.985、亮中性比例≥.62、强墨线比例在 `.006… .38`、彩色比例≤.012；像素门槛分别为色度≤20、亮度≥235且色度≤24、亮度≤175且色度≤24、色度≥22且相对色度≥.15 |

**分类优先级与尺寸**：[`recommendAutoHdSettings` L369–384](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L369-L384) 先文档，再照片，再线稿，最后其他。照片还有覆盖条件：**非文档**且 `source 长边≥1200 && quantizedColorCount≥32 && flatPairRatio<.84`，即便 `likelyPhoto=false` 也可升照片。长边结果：document→100；photo ultra→160、其他 quality→100；lineArt→60；other ultra→120、其他→100。`gridForLongSide()` 再将长边钳在 4–160，短边按比例四舍五入且至少 4，极长宽比会触发 `ratioLimited`，见 [`geometry.js` L11–38](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/core/geometry.js#L11-L38)。**文档并不一定文字可读**：[`recommendDocumentGrid` L359–367](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L359-L367) 要 `requiredTextLongSide=ceil(4×源长边/medianGlyphHeightPx)≤推荐长边` 才算 `textReadable`，否则 `structuralOnly`。

**质量评估**：[`assessPatternQuality` L189–201](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L189-L201) 还计算 contain/cover 有效容量与比例失配：文档有效长边 `<100` 告警、`<64` 严重；照片 `<64`/`<40`；线稿目标长边 `≤16`/`<16`；其他 `<32`/`<20`；比例失配 `>0.05` 告警。**注意真实 UI 覆盖**：`updateDetailAdvice()` 遇文档文字不可读或比例警告，可分别改用文档100或保持当前长边修正比例，而不是一律用 AUTO-HD 值；`currentSmartSettings()` 固定传 `quality='ultra'`；`applySmartSettings()` 在实体底板模式保留底板行列，但在普通图案模式会改写 `state.cols/rows`。因此不能把上游当作“手动尺寸绝不被覆盖”的已满足实现。见 [`src/app.js` L520–560](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L520-L560)。

**Safe auto crop**：仅线稿且非文档/照片才向上层提供自动裁边；源图所有有效墨线连通组件都并入边框（除严格识别的扫描边伪影），加 `max(2px, 主体跨度×5%)` 留边，裁掉面积至少 6% 才建议。`retainedInkRatio≥.995` 在该上游实现里因分子/分母均累加同一批组件而恒为 1，**不是独立安全保证**；CURRENT 的 BGS 衍生模块已对此修正。见 [`src/app.js` L259–289](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L259-L289)、[L386–399](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L386-L399)、[CURRENT NOTICE](../../src/algorithms/bgs/NOTICE)。

## Connectivity / Topology 对照

`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**。本轮暂停该名称的源码分析，不归属任何 BFS、连通域或拓扑能力，也不用于 Hybrid V2 证据。已确认仓库与 CURRENT 的四层比较见 [TOPOLOGY_AUDIT.md](TOPOLOGY_AUDIT.md)。

CURRENT 不只有 `smart-cleanup-v2.mjs`：已存在纯函数 [`bgs/topology.mjs`](../../src/algorithms/bgs/topology.mjs) 与 A/B 并行路径，所以 G 的 topology 对本项目**不是新待移植算法**。
