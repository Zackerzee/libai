# 算法审计 · `beads9/pindou-workbench`（拼豆工作台）

**审计对象**：<https://github.com/beads9/pindou-workbench>
**审计 commit**：`26e806f`（`feat: 拼豆工作台完整版 - MARD 264, auto cutout, templates, PWA, all pages`，单 commit 仓库，`--depth 1` 克隆）
**审计范围**：`app.js`（重点）、`mard264.js`、`brand-palettes.js`
**审计目标**：只研究「图片 → 拼豆颜色矩阵」的底层算法，不复制 UI / 站点
**本阶段约束**：**未修改本仓库任何现有代码**（本文档为新增文件）

---

## 0. TL;DR —— 必须先说的三件事

### 0.1 算法只存在于 207 行里

仓库共 14 个文件，但**全部图片处理算法集中在 `app.js` 第 47–253 行**：

| 文件 | 行数 | 是否含算法 | 说明 |
|---|---:|---|---|
| `app.js` | 868 | **是，仅第 47–253 行** | 颜色工具 + `autoCutout` + `kMeansPalette`。其余 615 行是 DOM 绑定、Canvas 渲染、编辑工具、四种导出、模板渲染 |
| `mard264.js` | 336 | 否 | 纯色卡数据（`MARD_264` 265 项 + `HAMA_COLORS` 30 项）。**零函数** |
| `brand-palettes.js` | 133 | 否 | 纯色卡数据（Perler/Artkal/Nabbi/Perler Mini 各 24–30 项）。**零函数** |
| `templates.js` | 145 | 否 | 内置模板图案数据（`templates.js` 用参数方程生成爱心/星星等）。**零函数，且属「模板」禁复制项** |
| `data.json` | 194 KB | 否 | 图纸库业务数据（416 条小红书帖子：`rank/title/nickname/avatar/likes/cover/noteId`…）。**业务数据，禁复制项** |
| `sw.js` / `manifest.json` | 70 / 42 | 否 | PWA（禁复制项） |
| `index.html` 等 5 个 html | — | 否 | 已核查：**无任何内联算法脚本**，只有 5 个 `<script src>` 外链 |

> 结论：这是一个「**单文件玩具级实现**」，算法总量约等于 libms 的 `smart-preprocessing/` 的 1/20。真正的可提取资产只有 `autoCutout` 一个函数。

### 0.2 README 把 5 个不存在的算法写成了卖点

README「技术要点」宣称的下列能力，**在代码里根本不存在**（已逐项 grep 实证）：

| README 宣称 | 代码现实 | 证据 |
|---|---|---|
| 「多尺度边缘检测：**3×3 + 5×5 Sobel 融合**」 | **不存在 5×5，不存在融合**。全仓只有一处 3×3 Sobel | `grep -ci "5x5\|sobel5"` → 0 |
| 「自适应阈值：基于边缘强度**直方图**动态调整」 | 存在阈值，但用的是**非零边缘值的中位数**，不是直方图 | `grep -ci histogram\|直方图` → 0 |
| 「**K-means 背景估计**：精准识别复杂背景色」 | **不存在**。背景 = 边框 margin 的**算术平均** | `grep -ci kmeans` → 2，两处都在前景 K-means，与背景无关 |
| 「**边缘羽化**：高斯模糊 mask 边缘」 | **不存在**。`config.feather` 在 93–96 行声明了 3 个值，**从未被读取** | `feather` 全文 4 次命中，全在配置对象字面量里 |
| 「**反向图纸生成**：支持镜像 / 双面作品」 | **不存在**。`state.mirror` 只有声明 | `mirror` 全文 1 次命中（第 18 行声明） |

**这不是可以照抄的设计，而是不能照抄的教训**：本项目的审计结论因此从「提取哪些」变成「**先确认哪些真的存在**」。

### 0.3 实证方法（本次审计不是靠读代码猜的）

我把 `app.js` 的算法区间整段抽取到 Node 里真实执行，用测量代替断言：

```bash
# 1. 抽取算法区间并检查 DOM 引用
node /tmp/pw-audit/extract.mjs
#    → OK 算法区间（47–253 行）零 DOM / Canvas / storage 引用

# 2. 在纯 Node 中实跑上游算法
node /tmp/pw-audit/verify.mjs
node /tmp/pw-audit/probe.mjs
node /tmp/pw-audit/border.mjs
```

**一个重要的自我纠错**：我最初从代码结构推断「形态学循环只遍历 `1..h-2`，且每轮 `eroded` 是全新数组，所以 mask 的 1 像素边框会被强制清零，紧贴画布边缘的主体会被切掉 1px 背景环」。实跑后**这个推断是错的**：膨胀那一步写的是 `dilated2[(y+dy)*w + (x+dx)]`，会**向外写到边框**，因而把边框重新填回来。实测边框前景占比 100%，与「主体铺满四边」的预期一致。**该缺陷不存在，已从清单中删除。** 教训：结构直觉必须用测量复核。

---

## 1. 存在性总表：26 项待查算法

状态图例：**✅ 存在** / **🟡 存在但形态不同**（内联、语义偏差、或入口不可达）/ **❌ 不存在**

| # | 算法 | 状态 | 位置 | 一句话结论 |
|---:|---|:--:|---|---|
| 1 | Canvas 图片缩放 | ✅ | `app.js:417–425` | `drawImage` 到 `w×h` 离屏画布，浏览器默认双线性/箱式重采样 |
| 2 | cover / crop 算法 | ✅ | `app.js:421–424` | `scale = max(w/iw, h/ih)` + `(w-sw)/2` 负偏移 = **居中 cover 裁切** |
| 3 | ImageData 获取 | ✅ | `app.js:425` | `getImageData(0,0,w,h)`，非 `willReadFrequently` |
| 4 | grid sampling | 🟡 | `app.js:432–434` | **无独立采样函数**；采样被整体委托给 Canvas 缩放（1 格 = 1 像素）。无采样模式选项 |
| 5 | 图片 → 拼豆矩阵 | ✅ | `app.js:443–464` | 双层循环产出**两个**平行矩阵（hex 矩阵 + 豆号矩阵） |
| 6 | K-means | ✅ | `app.js:225–253` | 确定性 strided 初始化、固定 10 轮、加权 RGB 距离 |
| 7 | 主色提取 | 🟡 | `app.js:225–253` | 只有 K-means 一条路径；无直方图 / 中位切分；**不过滤背景像素** |
| 8 | 色彩简化 | 🟡 | `app.js:437–439` | 靠 K-means + `colorLimit`（默认 **16**）实现，无独立实现 |
| 9 | MARD 色板匹配 | ✅ | `app.js:68–80` | 线性扫描取最小距离，**跳过 `special==='transparent'`** |
| 10 | RGB 距离计算 | ✅ | `app.js:61–66` | 加权平方和的平方根 |
| 11 | weighted RGB distance | ✅ | `app.js:61–66` | `sqrt(2Δr² + 4Δg² + 3Δb²)`，权重 **R:G:B = 2:4:3**，最大值 765 |
| 12 | alpha / transparency | ❌ | — | **源码 alpha 通道从未被读取**（全仓 0 处读 `data[i+3]`）。透明度只来自抠图 mask |
| 13 | 自动抠图 | ✅ | `app.js:88–222` | `autoCutout`，本仓库**唯一有实质内容的分割算法** |
| 14 | Sobel 3×3 | ✅ | `app.js:99–115` | 内联；核 `[-1,0,1;-2,0,2;-1,0,1]` 与其转置；luma 用 `0.299/0.587/0.114` |
| 15 | Sobel 5×5 | ❌ | — | 不存在（README 宣称） |
| 16 | 多尺度 Sobel 融合 | ❌ | — | 不存在（README 宣称） |
| 17 | adaptive threshold | 🟡 | `app.js:117–125` | `max(edgeThresh, median(nonzero_edges) * 0.8)`，**非直方图** |
| 18 | edge histogram | ❌ | — | 不存在（README 宣称）。只对非零值排了序取中位数 |
| 19 | background color estimation | ✅ | `app.js:145–170` | 边框 `margin = max(3, floor(min(w,h)*0.03))` 内的**算术平均** |
| 20 | background K-means | ❌ | — | 不存在（README 宣称） |
| 21 | dilation | 🟡 | `app.js:129–143`、`206–217` | 存在但**内联两处**（边缘桥接 / 形态学），无独立函数 |
| 22 | erosion | 🟡 | `app.js:191–204` | 存在但语义是 `sum >= 5` 的**多数腐蚀**，非标准 3×3 min-filter 腐蚀 |
| 23 | morphology | 🟡 | `app.js:190–219` | 「软腐蚀 + 膨胀」开运算，迭代 1/2/3 次。**无关运算、无结构元参数** |
| 24 | Gaussian feather | ❌ | — | **不存在**。`config.feather`（0/1/2）声明后从未被读取 |
| 25 | mask generation | ✅ | `app.js:172–219` | `mask = (膨胀后的边缘) OR (与 bgColor 的加权距离 > colorThresh)`，再经形态学 |
| 26 | foreground/background segmentation | ✅ | `app.js:88–222` | 即 mask。但**不做连通性分析**——与边框不连通的主体不会被剔除，孤立噪点岛也不会被剔除 |

**统计**：真正存在且值得提取 **11 项**（✅），存在但需重构 **10 项**（🟡），**不存在 5 项**（❌）。

---

## 2. 逐函数档案

字段按用户要求：函数名 / 文件位置 / 输入 / 输出 / 算法原理 / 参数 / 默认参数 / 调用关系 / DOM 依赖 / Canvas 依赖 / 可否 pure function 化 / 是否值得集成 / 与现有算法是否重复。

---

### A-1 · `hexToRgb(hex) → [r,g,b]`

| 项 | 内容 |
|---|---|
| 位置 | `app.js:47–52` |
| 输入 | `hex: string`（期望 `#RRGGBB`） |
| 输出 | `[r, g, b]`（0–255 整数） |
| 原理 | `parseInt(hex.slice(1,3),16)` 等三段解析 |
| 参数 / 默认 | 无 |
| 调用关系 | ← `findClosestBead`、`isLightColor` |
| DOM / Canvas | 否 / 否 |
| 可否 pure | ✅ 已纯 |
| 值得集成 | **否**。libms 的 `colors.js` / `rgbToHex` / `hexToRgb` 已覆盖，且不校验非法输入 |
| 与现有重复 | **完全重复**（`app.js` 的 `hexToRgb`、bgs 的 `color-space.hexToRgb`） |

---

### A-2 · `rgbToHex(r, g, b) → string`

| 项 | 内容 |
|---|---|
| 位置 | `app.js:54–59` |
| 原理 | 逐通道 `Math.max(0, Math.min(255, Math.round(x)))` 后 `padStart(2,'0')`，输出**大写** |
| 调用关系 | ← `kMeansPalette`（把质心转 hex） |
| DOM / Canvas | 否 / 否 |
| 可否 pure | ✅ 已纯 |
| 值得集成 | **否**。唯一有信息量的细节是「内部 clamp」——libms / bgs 也都 clamp |
| 与现有重复 | 完全重复 |

---

### A-3 · `colorDistance(c1, c2) → number` ★ 十项核心之一

| 项 | 内容 |
|---|---|
| 位置 | `app.js:61–66` |
| 输入 | `c1, c2: [r,g,b]` |
| 输出 | `number`，范围 `[0, 765]` |
| **原理** | **加权欧氏距离**：`sqrt(2·Δr² + 4·Δg² + 3·Δb²)` |
| 参数 | 权重硬编码，**不可配** |
| 默认参数 | 无 |
| 调用关系 | ← `findClosestBead`、`kMeansPalette` |
| DOM / Canvas | 否 / 否 |
| 可否 pure | ✅ 已纯 |
| 值得集成 | **是**（作为实验档）。这是一个真实存在、可复现的人眼感知近似 |
| 与现有重复 | 与 libms / bgs 的 OKLab、CIELAB、CIEDE2000 **目标重叠、口径不同**。属「同一问题的另一种解法」，可作 A/B 的一档 |

**实证（`verify.mjs`）**：

```
黑↔白 : 765.000   (= sqrt(9·65025)，上界)
纯红Δ : 360.624   (= sqrt(2·65025))   → 权重 2
纯绿Δ : 510.000   (= sqrt(4·65025))   → 权重 4
纯蓝Δ : 441.673   (= sqrt(3·65025))   → 权重 3
=> 权重比 R:G:B = 2:4:3 —— 绿最重、蓝次之、红最轻
```

**口径说明**：这里的 `2:4:3` 与常见的 **redmean / CompuPhase 低代价近似**（`(2+ȓ/256)Δr² + 4Δg² + (2+(255-ȓ)/256)Δb²`）不同——上游用的是**固定**权重版本，完全没有 redmean 的可变项。二者在纯红/纯蓝上差异显著。集成时需明确标注是**固定权重版**。

---

### A-4 · `findClosestBead(rgb, palette) → bead` ★ 十项核心之一

| 项 | 内容 |
|---|---|
| 位置 | `app.js:68–80` |
| 输入 | `rgb: [r,g,b]`、`palette: Array<{id,hex,name?,special?}>` |
| 输出 | 单个 palette 条目对象（**不是索引**） |
| **原理** | 线性全扫描 `colorDistance`，取严格小于 `minDist` 的第一个最小者 |
| 关键细节 | `if (bead.special === 'transparent') continue;` —— 跳过透明豆 |
| 参数 / 默认 | 无 |
| 调用关系 | ← `kMeansPalette`（质心落色卡）、← `generatePattern`（逐格映射） |
| DOM / Canvas | 否 / 否 |
| 可否 pure | ✅ 已纯 |
| 值得集成 | **是**，但必须改造：① `O(格数 × 色卡数)` 无缓存；② 无法返回索引；③ 平票靠数组顺序（隐式）；④ 色卡为空或全透明时返回 `palette[0]`（可能是透明豆） |
| 与现有重复 | libms / bgs 的 `createMatcher` 有精确色缓存 + OKLab 预筛 + CIEDE2000 终选，**显著更强** |

**实证（`verify.mjs`）**：`MARD_264` 中 `H1` 是 `{hex:'#FFFFFF', name:'透明', special:'transparent'}`。查询纯白 → 返回 **`H2 #FFFFFF`**，证明 transparent 跳过生效。

**隐患**：`H1`、`H2`、`T1` 三者 hex **都是 `#FFFFFF`**（`T1` 是 `special:'glitter'`，**不在跳过之列**）。因 `H1` 被跳过、`H2` 在数组中先于 `T1`，纯白才恰好落到 `H2`。这是**靠数组顺序兜住的正确性**，一旦色卡重排就会变。`mard264.js` 中另有 `#ED1C24`、`#F9ED32` 两组重复 hex（各 2 项），同样靠顺序消歧。

---

### A-5 · `isLightColor(hex) → boolean`

| 项 | 内容 |
|---|---|
| 位置 | `app.js:82–85` |
| 原理 | `(r*0.299 + g*0.587 + b*0.114) > 150` |
| 用途 | **仅用于色卡表格里决定文字用黑还是白**（`renderColorTable`）。**与生成管线无关** |
| DOM / Canvas | 否 / 否 |
| 可否 pure | ✅ |
| 值得集成 | **否**，属渲染细节 |
| 与现有重复 | libms 有等价亮度工具 |

---

### A-6 · `autoCutout(imageData, precision) → {mask, bgColor}` ★★ 本仓库唯一的核心资产

| 项 | 内容 |
|---|---|
| 位置 | `app.js:88–222`（135 行，占算法区间 65%） |
| 输入 | `imageData: {width, height, data: Uint8ClampedArray}`；`precision: 'fast'\|'balanced'\|'precise'` |
| 输出 | `{ mask: Uint8Array(w*h) /* 0=背景 1=前景 */, bgColor: [r,g,b] (float) }` |
| 参数 | `precision` → 三档预设（见下） |
| **默认参数** | `'balanced'`。**且 `generatePattern` 在 `app.js:428` 硬编码传 `'balanced'`**，`index.html` 无精度控件 → **`fast` / `precise` 从界面不可达，是死参数** |

**六个阶段**（行号为 `app.js`）：

| 阶段 | 行 | 算法 | 参数 |
|---|---:|---|---|
| 1 | 99–115 | **3×3 Sobel** 边缘检测，作用于 luma（`0.299/0.587/0.114`），`edgeMap = sqrt(gx²+gy²)` | 核固定 |
| 2 | 117–125 | **自适应阈值**：对非零边缘值排序取中位数 `m`，`thresh = max(edgeThresh, m*0.8)` | `edgeThresh` |
| 3 | 127–143 | **膨胀桥接**：对边缘图做 `morphIter` 次 3×3 全膨胀 | `morphIter` |
| 4 | 145–170 | **背景色估计**：取上下左右各 `margin` 行/列像素求算术平均 | `margin = max(3, floor(min(w,h)*0.03))` |
| 5 | 172–188 | **前景标记**：`mask[i] = dilated[i] OR (weightedDist(px, bgColor) > colorThresh)` | `colorThresh` |
| 6 | 190–219 | **形态学开运算**：`morphIter` 次 [`sum>=5` 腐蚀 → 3×3 膨胀] | `morphIter` |

**三档预设**（`app.js:92–96`）：

| precision | edgeThresh | colorThresh | morphIter | feather | 界面可达 |
|---|---:|---:|---:|---:|:--:|
| `fast` | 80 | 60 | 1 | 0 | ❌ |
| `balanced` | 60 | 45 | 2 | 1 | ✅（硬编码） |
| `precise` | 40 | 30 | 3 | 2 | ❌ |

**调用关系**：`generatePattern` → `autoCutout`。仅此一处调用。

| 审计项 | 结论 |
|---|---|
| DOM 依赖 | **否** |
| Canvas 依赖 | **否**（只吃 `imageData`） |
| 可否 pure | ✅ **已经是纯函数**，已实证 |
| 值得集成 | **是**——这是本仓库唯一值得提取的资产。但需 4 处改造（见 §5 缺陷清单） |
| 与现有重复 | **部分重复且更弱**：libms 的 `auto-background` 用「与边框连通的 flood fill + CIEDE2000 防漏」；C3 的 `subject-crop` 用 `floodBackgroundMask`。上游的均值 + 阈值法**没有连通性**，是更弱的版本。**真正非重复的只有「多档形态学 + 边缘桥接」这一组合** |

**实证（`verify.mjs`）**：在**纯 Node**（无 DOM、无 Canvas）中成功执行 40×40 合成图，`bgColor = 240.0,240.0,240.0`、前景 749/1600 像素。→ 纯函数化可行性已证实，无需任何宿主适配。

**实证（`probe.mjs`，主体铺满四边的极端图）**：

```
fast      bg=36.9  colorThresh=60  dist>thresh 命中 36    mask=1 → 78
balanced  bg=36.9  colorThresh=45  dist>thresh 命中 1600  mask=1 → 1600
precise   bg=36.9  colorThresh=30  dist>thresh 命中 1600  mask=1 → 1600
```

暴露两个真实特性：

1. **背景估计会被「主体压边」带偏**。该图四边都是深色主体，只有左上 6×6 是浅色背景，于是 `margin=3` 采到的 444 个样本里 417 个是深色主体 → `bgColor` 估成 **36.9（接近主体色）**，而不是真实的 245。此后「与背景色差异」这一判据基本失效，前景全靠边缘膨胀撑出来。
2. **阈值档位差一档就翻盘**。`colorThresh` 从 60 → 45 时，前景从 78 突变为 1600（= 全图）。因为主体与误估背景的加权距离为 `sqrt(9·16.9²) ≈ 50.7`，正卡在 45 和 60 之间。**判据是硬阈值、无过渡带**，这是该分割法最脆弱的地方。

---

### A-7 · `kMeansPalette(pixels, k) → bead[]` ★ 十项核心之一

| 项 | 内容 |
|---|---|
| 位置 | `app.js:225–253` |
| 输入 | `pixels: Array<[r,g,b]>`（**全部像素，未过滤背景**）、`k: number` |
| 输出 | `bead[]`，长度 ≤ k，元素是 **MARD_264 的条目** |
| **原理** | ① 初始化：按 `step = max(1, floor(len/k))` **等距抽样**取 k 个种子（确定性，无随机）；② 迭代 **固定 10 轮**；③ 分配用 `colorDistance`；④ 更新用簇内**算术平均**后 `Math.round`；⑤ 末尾把每个质心 `findClosestBead(c, MARD_264)` 落回色卡 |
| 参数 | `k`（来自 `state.colorLimit`） |
| 默认参数 | 10 轮硬编码；无收敛判据、无空簇处理、无 k-means++ |
| 调用关系 | ← `generatePattern:438`（`if (state.colorLimit && state.colorLimit < palette.length)`） |
| DOM / Canvas | 否 / 否 |
| 可否 pure | ✅ 已纯（但**依赖全局 `MARD_264`**，见下） |
| 值得集成 | **部分**。确定性初始化值得保留；其余需重写 |
| 与现有重复 | libms 的 `buildPaletteBudgetPlan` 是「合并近色 + 预算降色」而非聚类，**路径不同**；bgs 的 `mergeSimilarColors`/`limitColors` 同理。**K-means 本身在 libms / bgs 中都没有**，是本仓库独有的思路 |

**实证（`verify.mjs`）—— 一个必须知道的真实缺陷**：

```
传入 30 色 HAMA_COLORS，k=3 -> 返回 3 项，id = R6,P6,E21
返回值全部来自 MARD_264 而非传入色板 : true   <= 调用方色板被丢弃
```

**缺陷 K-1：`kMeansPalette` 无视调用方色板。** 末行 `findClosestBead(c, MARD_264)` 把硬编码全局 `MARD_264` 写死在函数体里，函数签名里没有 palette 参数。后果：用户在界面上选 **HAMA / Perler / Artkal / Nabbi** 色卡时，只要 `colorLimit(默认16) < 色卡长度(30)`（**恒成立**），K-means 分支必然接管，**选中的品牌色卡被整块丢掉，结果全是 MARD 色**。即：**除 `mard264` 外的所有品牌色卡在默认档位下都失效**。

**缺陷 K-2：`k` 个质心落色卡后可能重复。** 多个质心可能映射到同一个 MARD 条目，导致实际可用色数 < k。函数不做去重，也不报告。

**缺陷 K-3：`k > 像素数` 时初始化越界保护不当。** `for (i<k && i*step < len)` 会在种子不足时静默产出少于 k 个初始质心，随后 `centroids[i]` 在分配循环里被当作 `undefined` 访问（`colorDistance(p, undefined)` → `NaN`），`NaN < minDist` 恒为 false → 所有像素被塞进 `clusters[0]`。

**设计事实（对 A/B 很重要）**：`state.colorLimit` 默认 **16**，且 `16 < 265` 恒真 → **上游的默认路径不是「最近色匹配」，而是「K-means 压到 16 色 → 落 MARD」**。265 色的「MARD 色板匹配」实际上只充当 16 个质心的最终取整器。

---

### A-8 · `generatePattern()` —— 采样 / 映射段（`app.js:399–491`）

整个函数与 DOM 深度耦合（读 `customWidth.value`、写 `toastText`、`editorSection.scrollIntoView`…），**不可整体提取**。但内部有三段纯算法：

**A-8a · cover 裁切 + 栅格化（`app.js:417–425`）**

```js
const off = document.createElement('canvas');
off.width = w; off.height = h;
const scale = Math.max(w / img.width, h / img.height);   // ← cover
const sw = img.width * scale, sh = img.height * scale;
offCtx.drawImage(img, (w - sw) / 2, (h - sh) / 2, sw, sh);  // ← 居中裁切
const imageData = offCtx.getImageData(0, 0, w, h);
```

| 项 | 内容 |
|---|---|
| 原理 | **居中 cover**：取 `max` 缩放比使图铺满目标框，溢出部分用负偏移居中裁掉 |
| 参数 | 无。**fit 策略、重采样滤波器、采样点位置全部不可配** |
| 重采样 | 未设置 `imageSmoothingEnabled` → 用浏览器默认（`true` + `quality='low'`），**具体滤波器由浏览器决定，跨浏览器不保证一致**（PWA 场景下这是可复现性隐患） |
| 采样 | **1 格 = 1 像素**。像素中心对齐由 `drawImage` 缩放隐式决定，**不是** `(x+0.5)/cols` 的解析式 |
| DOM / Canvas | **是 / 是**（唯一真正的宿主边界） |
| 可否 pure | ✅ **可改造**：cover 几何是纯数学，重采样可自行实现 |
| 值得集成 | **是**（几何部分）。`scale=max(...)` 的 cover 语义与 libms 的 `fitRaster(contain)` 是**不同策略**，具备 A/B 价值 |
| 与现有重复 | libms `raster.js` 有 `fitRaster(contain/cover/stretch)`、bgs `raster.mjs` 同理。**几何等价，但上游「浏览器代采样」这一点无法复用** |

**A-8b · K-means 触发（`app.js:430–439`）**

```js
const pixels = []; // 全部像素，含背景
for (let i = 0; i < imageData.data.length; i += 4) pixels.push([...3 通道]);  // alpha 被丢弃
if (state.colorLimit && state.colorLimit < palette.length) palette = kMeansPalette(pixels, state.colorLimit);
```

| 项 | 内容 |
|---|---|
| 关键事实 | **`pixels` 包含背景像素**，且**丢弃 alpha**。开了透明背景后，背景仍在消耗色板配额 |
| 值得集成 | 需改造：把抠图 mask 作为 K-means 的采样掩码 |

**A-8c · 逐格映射（`app.js:443–464`）**

```js
for (let y…) for (let x…) {
  const rgb = pixels[x + y*w];
  if (cutout.mask[idx] === 0 && state.transparentBg) { row.push(null); beadRow.push(null); }
  else { const bead = findClosestBead(rgb, palette); row.push(bead.hex); beadRow.push(bead.id); }
}
```

| 项 | 内容 |
|---|---|
| **输出结构** | **两个平行矩阵**：`state.gridData`（hex 字符串或 `null`）+ `state.beadData`（豆号字符串或 `null`） |
| 原理 | 逐格最近色匹配，背景格置 `null` |
| 参数 | `state.transparentBg`（**默认 `true`，且 index.html 无开关 → 恒为 true**） |
| DOM / Canvas | 否 / 否（仅依赖已被 DOM 层算出的 `imageData`） |
| 可否 pure | ✅ 可 |
| 值得集成 | **是**（矩阵语义部分） |
| 与现有重复 | libms / bgs 的 matrix 是 `(code\|null)[][]`（**单矩阵**）。上游的**双矩阵**设计（hex + 豆号）是冗余的：`hex ↔ 豆号` 由色卡一对一映射，第二个矩阵只带来不一致风险。**不建议沿用** |

---

### A-9 · 数据文件（`mard264.js` / `brand-palettes.js`）

| 项 | `MARD_264` | `HAMA_COLORS` | brand-palettes.js |
|---|---|---|---|
| 文件位置 | `mard264.js:5–334` | `mard264.js:301–…` | `brand-palettes.js:4–128` |
| 条目数 | **265** | **30** | Perler 30 / Artkal 30 / Nabbi 30 / Perler Mini 24 |
| 字段 | `{id, hex, name, special?}` | 同 | `{id, hex, name}` |
| 特殊项 | `H1` 透明（`special:'transparent'`）、`T1` 葱粉（`special:'glitter'`） | 无 | 无 |
| 重复 hex | `#FFFFFF`×3（H1/H2/T1）、`#ED1C24`×2、`#F9ED32`×2 | — | 多组 |
| 是否算法 | **否，纯数据** | 否 | 否 |
| 值得集成 | **否** | **否** | **否** |

**为什么不复制**：① libms 已有自己的品牌色卡体系（`getCurrentPalette()` / `getCurrentPaletteKey()`）；② 用户本次明确要求「不复制」；③ 复制数据会引入**数据层许可义务**（见 §7），而算法思想本身不受版权保护。**pw 模块一律由调用方传入 palette。**

**一个可借鉴的数据设计**：`special: 'transparent'` 把「透明豆」建模为色卡内的**成员**而非缺失值，`schema` 干净。libms 的 palette 条目也用 `transparent: true`（`bgs` 的 `preparePalette` 已支持），**语义已对齐，无需引入**。

---

## 3. 调用关系

```
                       ┌─────────────────────────────────────────┐
                       │ index.html（无内联算法，仅 5 个 script） │
                       └────────────────────┬────────────────────┘
                                            │ 全局变量 MARD_264 / HAMA_COLORS
                                            ▼
  handleFile ──► state.originalImage        ┌──────────────────────────┐
       │                                    │  mard264.js（纯数据）      │
       │                                    │  brand-palettes.js（纯数据）│
       ▼                                    └────────────┬─────────────┘
  generatePattern()  ◄── 点击生成按钮                     │ 全局读取
       │                                                  │
       ├─ (1) getPalette() ──────────────────────────────►┘  取色卡
       │
       ├─ (2) 【Canvas】cover 裁切 drawImage ──► getImageData   ← 唯一宿主边界
       │         └─► pixels[]（丢弃 alpha，含背景）
       │
       ├─ (3) autoCutout(imageData, 'balanced')     ← 硬编码档位
       │         ├─ 3×3 Sobel（内联）        ─┐
       │         ├─ 自适应阈值 median*0.8      │
       │         ├─ 膨胀 ×morphIter           ├─ 全部内联，无独立函数
       │         ├─ 背景色 = 边框均值          │
       │         ├─ mask = 边缘 OR 距离>阈值   │
       │         └─ 开运算（sum>=5 腐蚀+膨胀）─┘
       │              └─► { mask, bgColor }
       │
       ├─ (4) kMeansPalette(pixels, colorLimit)     ← 若 colorLimit < 色卡长度（默认 16<265 恒真）
       │         ├─ colorDistance（加权 RGB）
       │         └─ findClosestBead(c, MARD_264)    ← 硬编码全局，丢弃调用方色卡
       │              └─► palette'（≤k 个 MARD 条目）
       │
       ├─ (5) 逐格 findClosestBead(rgb, palette')   ← mask==0 且 transparentBg → null
       │         └─► state.gridData（hex[][]） + state.beadData（豆号[][]）   ← 双平行矩阵
       │
       └─ (6) renderCanvas / renderUsage / renderColorTable / updateStats   ← 纯 UI，不提取

  renderCanvas ──► ctx.fillRect（棋盘格表示透明）
  exportPNG/JPG/PDF/Excel ──► 导出层（禁复制项）
  renderTemplates / loadTemplate ──► 模板库（禁复制项）
```

**结论**：真正的算法调用链只有 **3 → 4 → 5**，且三段都已经是可以脱离 DOM 的纯计算（3 需替换 Canvas 部分）。**算法密度极低、耦合极浅**——这是个好消息：提取风险很小。

---

## 4. 输入 / 输出数据结构

### 4.1 `autoCutout` 的输入

```js
// 上游直接吃 Canvas 的 ImageData（仅用到 width/height/data）
{
  width:  number,                  // 栅格宽（= 目标格数 w）
  height: number,
  data:   Uint8ClampedArray(w*h*4) // RGBA，行优先；注意上游只读 [0..2]，alpha 被忽略
}
```

### 4.2 `autoCutout` 的输出

```js
{
  mask:    Uint8Array(w*h),   // 0 = 背景，1 = 前景
  bgColor: [number, number, number]  // 浮点均值，非整数
}
```

### 4.3 `kMeansPalette` 的输入 / 输出

```js
// 输入
pixels: Array<[r,g,b]>   // 长度 = w*h，含背景像素
k:      number

// 输出：MARD_264 的子集（元素是**引用**，不是副本）
Array<{ id: string, hex: string, name: string, special?: string }>
```

### 4.4 最终矩阵（上游形状）

```js
state.gridData : (string|null)[][]   // hex 或 null
state.beadData : (string|null)[][]   // 豆号或 null
// 两者一一对应；null 表示「透明 / 无豆」
```

### 4.5 与本仓库 / bgs 的形状对照

| 概念 | 上游 pindou-workbench | libms `state.grid` | bgs `result.matrix` |
|---|---|---|---|
| 矩阵单元 | `hex` 字符串（另有豆号矩阵） | `{code, rgb, hex, name?}` 对象 | `code` 字符串 |
| 无豆表示 | `null` | `null` | `null` |
| 矩阵数 | **2 个平行矩阵** | 1 个 | 1 个 |
| 色板 | 模块内全局常量 | `getCurrentPalette()` 传入 | `options.palette` 传入 |
| 尺寸来源 | 用户输入（16–256，**静默 clamp**） | `getGranularity()` + 比例 | `options.width/height` |

> **适配成本**：上游的「hex 矩阵」→ libms 的 `{code,rgb,hex}` 需一次 `byCode` 查表（与 bgs 的 `gridFromBgsMatrix` 完全同构，可直接复用该模式）。

---

## 5. 上游缺陷清单（已实证）

按「是否会在集成后咬人」排序。

| # | 缺陷 | 位置 | 证据 | 集成时的处置 |
|---|---|---|---|---|
| **K-1** | `kMeansPalette` 硬编码 `MARD_264`，**丢弃调用方色板** → HAMA/Perler/Artkal/Nabbi 在默认档位下全部失效 | `app.js:251` | 实证：传 HAMA 返回 MARD id | **修**：palette 作为显式参数 |
| **K-2** | `k` 个质心落色卡后可能重复，实际色数 < k，且不报告 | `app.js:249–252` | 代码可见 | **修**：去重 + 在 diagnostics 里报告 `duplicates` |
| **K-3** | `k > 像素数` 时种子不足 → `centroids[i]` 为 `undefined` → `NaN` 比较 → 所有像素塌进簇 0 | `app.js:229–231` | 代码可见 | **修**：`k = min(k, len)` |
| **K-4** | 固定 10 轮、无收敛判据、**无空簇重播种** | `app.js:232` | 代码可见 | **修**：收敛提前退出 + 空簇处理 |
| **S-1** | 背景估计 = **边框算术均值**，主体压边时被主体污染（实测把 245 的真实背景估成 **36.9**） | `app.js:145–170` | `probe.mjs` | **修**：改用边框**连通域 + 众数/聚类**，或直接换成 libms 已有的 `floodBackgroundMask` |
| **S-2** | 前景判据是**硬阈值、无过渡带**，阈值动 15 就让前景从 78 变 1600 | `app.js:184` | `probe.mjs` | **保留为实验特性**（这正是 A/B 要看的东西）；但需暴露参数 |
| **S-3** | **无连通性分析**：与边框不连通的主体不被剔除，孤立噪点岛也不被剔除 | `app.js:172–219` | 代码可见 | **修**：加连通域过滤（libms 的 flood fill 已具备） |
| **S-4** | 腐蚀用 `sum >= 5` 的**多数腐蚀**，非标准 3×3 min-filter；「开运算」因此偏弱 | `app.js:201` | 代码可见 | **保留为独立算子** `majorityErode`，另加标准 `erode` |
| **S-5** | 形态学**只处理内部** `1..h-2`；膨胀会向外写到边框把边框填回（实测无边框伪影） | `app.js:191–217` | `probe.mjs`：边框前景 100%，符合预期 | **不修**，仅记档（我最初的怀疑已被实测否决） |
| **S-6** | `precision` 三档中 `fast`/`precise` **界面不可达**（硬编码 `'balanced'`） | `app.js:428` | `index.html` 无精度控件 | **修**：三档全部可达 |
| **S-7** | `config.feather` 声明后**从未被读取** → 边缘羽化完全缺失 | `app.js:93–96` | `grep feather` → 4 次，全在配置字面量 | **补实现**（见 §6 的 `feather-mask.js`） |
| **T-1** | **源码 alpha 通道从未被读取** → 透明 PNG 的透明区 RGB 为 `(0,0,0)`，会被匹配成**黑豆** | 全仓 0 处读 `data[i+3]` | `grep "+ 3\]"` → 无命中 | **修**：读 alpha，`alpha < ε` 直接判背景 |
| **T-2** | `state.transparentBg` / `state.mirror`：前者无开关（恒 true），后者**纯死变量** | `app.js:18–19` | `grep mirror` → 1 次 | 不引入 `mirror` |
| **T-3** | `isSmart` 计算后**从未使用**，且 `data-palette="smart"` 按钮不存在 | `app.js:414` | `grep smart` → 仅 1 处 | 不引入 |
| **T-4** | `PERLER_MINI_COLORS` 已定义但**无按钮可达** | `brand-palettes.js:103` | `grep data-palette` | 不引入 |
| **E-1** | 未设 `imageSmoothingEnabled` → 重采样滤波器**由浏览器决定，跨浏览器不可复现** | `app.js:420` | 代码可见 | **修**：自行实现确定性的 area-average / bilinear |
| **E-2** | 尺寸 **静默 clamp**：`Math.min(256, Math.max(16, …))` | `app.js:407–408` | 代码可见 | **不沿用**。libms 铁律：用户给的尺寸只报告不改写 |

---

## 6. 「值得保留」与「不值得采用」

### 6.1 值得保留（J）

| 资产 | 理由 | 提取形态 |
|---|---|---|
| **`autoCutout` 的整体骨架**（边缘 → 自适应阈值 → 桥接膨胀 → 背景估计 → 二值化 → 开运算） | 是真实的、能跑通的经典管线；**与 libms 的 C2/C3（flood fill + CIEDE2000）是不同思路**，具备 A/B 价值 | `segmentation/` 7 个算子 + `segmentForeground()` 组合器 |
| **`colorDistance` 加权 RGB（2:4:3 固定权重）** | 真实存在、可复现的人眼近似；libms 没有这一档 | `color/weighted-rgb.js` |
| **`kMeansPalette` 的确定性等距初始化** | 无随机种子 → 结果可复现，符合 libms「确定性」原则 | `quantization/kmeans.js`（保留该初始化，另加 k-means++ 可选） |
| **`findClosestBead` 的「跳过 transparent 条目」语义** | 语义干净：透明是色卡成员而非缺失值 | 并入 `color/palette-match.js` |
| **三档精度的参数组合**（80/60/1、60/45/2、40/30/3） | 真实的调节经验值，可作预设 | `config.js` |
| **cover（居中裁切）几何** | 与 libms 的 `contain` 是不同策略 | `sampling/cover-resize.js` |

### 6.2 不值得采用（K）

| 资产 | 不采用的理由 |
|---|---|
| `hexToRgb` / `rgbToHex` / `isLightColor` | 与现有实现**完全重复**，纯冗余 |
| **双平行矩阵**（`gridData` + `beadData`） | 违背单一事实源；两者不一致时无仲裁。libms / bgs 的单矩阵 + code 查表更稳 |
| **Canvas 代采样**（`drawImage` + `getImageData`） | 依赖 DOM / Canvas；滤波器不可控、跨浏览器不可复现。**必须**换成纯数学重采样 |
| **静默 clamp 尺寸** | 直接违反 libms 的 `docs/BLANK_BOARD_SIZE_FIX.md` 铁律 |
| `MARD_264` / `HAMA_COLORS` / 4 个品牌色卡**数据** | ① 用户要求不复制；② libms 已有自己的色卡体系；③ 避免数据层许可义务 |
| `templates.js` / `data.json` / `sw.js` / `manifest.json` / 5 个 html | **明确禁复制项**（模板库 / 图库 / PWA / 页面） |
| 4 种导出的实现（PNG/JPG/PDF/Excel） | 禁复制项（导出层） |
| `renderCanvas` / `renderUsage` / `renderColorTable` / `updateStats` / 编辑工具 / 水印 | 禁复制项（渲染 / UI / 业务逻辑） |
| `isSmart` / `state.mirror` / `fast`+`precise` 死参数 / `config.feather` 死声明 | 死代码 |
| **README 的「多尺度 5×5 Sobel / 背景 K-means / 边缘直方图 / 高斯羽化」** | **上游没有**。这四项**不属「提取」范畴**——若集成，只能作为**本仓库补全**，且必须显式标注来源不是上游 |

---

## 7. 许可证与署名义务

| 项 | 事实 |
|---|---|
| README 声明 | `## 📄 License` → **`MIT License`** |
| 仓库内 LICENSE 文件 | **不存在**（`ls \| grep -i licen` 无命中） |
| 版权声明行 | **不存在**（无 `Copyright (c) …` 行，GitHub 上也未标注 license） |
| 第三方依赖 | `jsPDF`（MIT）、`SheetJS`（Apache-2.0，CDN 引入）。**均与算法无关**（仅导出用） |
| 上游原创性 | `mard264.js` 自述「数据来源：MARD 官方色卡图（用户提供）」—— **色卡数据的权利归属本身存疑**，谨慎起见不复制 |

**因此本仓库的义务与做法**：

1. **MIT 的许可文本在仓库中缺失**，严格来说无法确认授权条款的完整内容。但**算法思想、数学公式、处理流程不受版权保护**（思想/表达二分法）；受保护的是**具体代码表达**。
2. 采取的**最保守做法**：**不逐字复制上游任何一行代码**。所有模块均以 ESM 重写、重命名、纯函数化、参数化，代码表达与原作不同；只在注释与文档中标注「算法来源 + commit + 原文件行号」。
3. **不复制任何数据文件**（色卡、模板、图库）。`palette` 一律由调用方注入。
4. 附 `NOTICE` 文件，记录：来源仓库、commit `26e806f`、参考的算法清单与原行号、以及**本仓库补全（非上游）**的算法清单。
5. **绝不**把 `pindou-workbench` 用作产品名 / 品牌名（沿用 bgs 批次同样的纪律）。

---

## 8. 与现有算法的重叠矩阵

| pw 模块 | libms 现状 | bgs 现状 | 重叠判定 |
|---|---|---|---|
| `sampling/cover-resize.js` | `raster.js` `fitRaster(contain/cover/stretch)` | `raster.mjs` `fitRaster` | **完全重叠**（几何）。新增价值仅「浏览器代采样 → 确定性纯数学」 |
| `sampling/grid-sampling.js` | `sampling-engine-v2.mjs`（5 档采样） | `sampling.mjs`（5 档） | **完全重叠且上游更弱**（上游只有 point） |
| `segmentation/sobel3.js` | C3 `stroke-mask.mjs`（Sobel + Otsu + NMS） | `stroke-mask` 同源 | **部分重叠**。差异：上游用**自适应中位数阈值**，libms 用 **Otsu**；上游**不做 NMS 细线化** |
| `segmentation/sobel5.js` | **无** | **无** | **无重叠**（但上游也没有 → 属本仓库补全） |
| `segmentation/multi-scale-edge.js` | **无**（libms 是单尺度 Sobel） | **无** | **无重叠**（属本仓库补全）★ 这是 hybrid 的核心新意 |
| `segmentation/adaptive-threshold.js` | `otsuThreshold`（bgs 已带 plateau 修正） | 同 | **重叠**。上游是 median×0.8，libms 是 Otsu。**两种都保留**，供 A/B |
| `segmentation/background-kmeans.js` | `auto-background.mjs`（边框连通 flood fill + CIEDE2000） | `analyze.resolveBackgroundMask` | **重叠且上游更弱**。上游的「边框均值」是本仓库补全 K-means 的起点 |
| `segmentation/morphology.js` | **无独立形态学** | **无** | **无重叠** ★ 值得引入 |
| `segmentation/feather-mask.js` | **无** | **无** | **无重叠**（属本仓库补全） |
| `quantization/kmeans.js` | **无 K-means** | **无** | **无重叠** ★ 值得引入 |
| `quantization/dominant-colors.js` | **无** | **无** | **无重叠**（属本仓库补全） |
| `color/weighted-rgb.js` | `palette-engine.mjs`（CIELAB / OKLab） | `matcher.mjs`（OKLab 预筛 + CIEDE2000） | **口径不同**，可作 A/B 第 2 档 |
| `color/palette-match.js` | `palette-engine.mjs` | `matcher.mjs` | **重叠**，但上游版本**无缓存、无索引、无平票规则** → 只作实验档 |
| `core/pipeline.js` | `generation-engine-v2.mjs` `generateV2()` | `index.mjs` `convertImageToBeads()` | **重叠**（都是全管线），作为第三条独立管线并存 |

**净结论**：pw 相对 libms/bgs **真正非重复的资产只有 3 个**——**多尺度边缘、形态学算子、K-means 量化**。其余 10 个模块要么重叠、要么是上游缺口需本仓库补全。

---

## 9. 第二阶段提取计划（文件映射）

严格按用户指定的目录树落实，每个导出函数带 **provenance 标记**：

- `ORIGIN.UPSTREAM_PORT` = 忠实移植上游（附 `app.js:起–止` 行号）
- `ORIGIN.LIBMS_FILL` = **上游不存在**，本仓库补全（README 宣称但代码无，或纯为新组合而写）

| 目标文件 | 主要算法 | Provenance |
|---|---|---|
| `sampling/cover-resize.js` | 居中 cover 几何 + 确定性 area-average / bilinear 重采样 | `UPSTREAM_PORT`（几何） |
| `sampling/grid-sampling.js` | 逐格点采样 / 面积均值 / 主色（支持超采样因子） | `UPSTREAM_PORT`（point）/ 其余 `LIBMS_FILL` |
| `segmentation/sobel3.js` | 3×3 Sobel（核与 luma 权重照搬） | `UPSTREAM_PORT` |
| `segmentation/sobel5.js` | 5×5 Sobel（两尺度平滑核） | **`LIBMS_FILL`** |
| `segmentation/multi-scale-edge.js` | 3×3 + 5×5 归一化融合（含可选高斯前置尺度） | **`LIBMS_FILL`** |
| `segmentation/adaptive-threshold.js` | `max(edgeThresh, median×0.8)` + Otsu / mean-std / fixed 四模式 + 边缘直方图 | `UPSTREAM_PORT`（median 档） |
| `segmentation/background-kmeans.js` | 边框均值（上游）+ 边框样本 K-means 多簇（补全） | 混合 |
| `segmentation/morphology.js` | `dilate` / `erode`（标准 min-filter）/ `majorityErode`（上游 `sum>=5`）/ `open` / `close` | `UPSTREAM_PORT`（dilate、majorityErode） |
| `segmentation/feather-mask.js` | 可分离高斯模糊 → 连续 alpha mask | **`LIBMS_FILL`** |
| `quantization/kmeans.js` | K-means（保留确定性等距初始化；修 K-1~K-4；新增 k-means++、mask 采样、收敛检测） | `UPSTREAM_PORT`（核心）+ 修复 |
| `quantization/dominant-colors.js` | 直方图分桶 + 频次主色 + 中位切分 | **`LIBMS_FILL`** |
| `color/weighted-rgb.js` | `sqrt(2Δr²+4Δg²+3Δb²)` + 归一化 + redmean 变体对照 | `UPSTREAM_PORT` |
| `color/palette-match.js` | `paletteMatchMode`: `original-weighted-rgb` / `lab` / `ciede2000` | 混合 |
| `core/pipeline.js` | 完整 pw 管线（忠实复刻上游语义 + 可配改进） | `UPSTREAM_PORT` |

**跨模块依赖声明**：`color/palette-match.js` 的 `lab` / `ciede2000` 两档**复用** `bgs/color-space.mjs` 的 `rgbToCielab` / `deltaE2000`（已对 Sharma 参考对验证），**不重复实现色彩科学**。依赖方向单向 `pw → bgs`，bgs 不反向依赖。这正好绕开上一批踩到的「色板方言」坑（bgs 的 `lab` 字段是 OKLab，因此 pw **只取函数、不取 prepared 色板**）。

---

## 10. 给第三～六阶段的约束提醒

1. **不得删除任何现有算法**；不得修改任何现有 UI（唯一例外：在既有「算法」下拉里**新增 option**）。
2. **不得静默替换**任何现有生成结果——默认 `algorithmEngine` 必须保持 `current`。
3. `hybrid-pw` 的下半段必须 réellement 走**我们自己的**算法（Linear RGB 采样 / Lab·CIEDE2000 匹配 / maxColors / 结构边缘保护 / 眼睛高光保护 / 孤立杂色清理 / 边缘杂色清理），不能等价于 pw。
4. 三路实验室的 `verdict` **恒为 `null`**，只并排呈现数据，不做任何排名或推荐。
5. 沿用 libms 铁律：**用户给的尺寸只报告不改写**（`E-2` 不得沿用）；**跨引擎传色板要用各自方言**。
