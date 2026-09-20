# A/B 对比：`current` vs `bgs`

> **这套工具不判定哪套算法更好。** 报告里没有 `winner`、没有评分、没有推荐，
> `verdict` 恒为 `null`。两套算法都保留，选哪套是人的判断。

---

## 为什么要并存

`bgs`（`src/algorithms/bgs/`）是从 `zwhy149/bead-grid-studio` 提取的纯算法模块，
它取代不了 `current`（libms 既有的 `generateV2` V2.5 链路）——两者各有取舍：

- `current` 在 libms 图库上长期标定过，采样/细节保护/降色预算是为「照片转拼豆」调的。
- `bgs` 的独特价值是**小尺寸单色线稿的拓扑保护**（连通域归属 + Zhang–Suen 细化 +
  冲突消解），以及一套不含 Canvas 依赖的采样/匹配实现。

用什么图、要什么效果，决定了哪套更合适。所以两边都留着，把指标摊开给人看。

---

## 两条入口

### A. 浏览器（对当前工作台里那张图）

```js
// 顶部「算法」下拉切到 BGS 算法 → 点「生成 / 更新」，走的是 bgs
// 要对比就调这个（不改 state，两个引擎都只读同一份 imageData）：
const report = await window.LibmsWorkspaceBridge.runAlgorithmAbTest();

report.metrics.current   // { usedColorCount, isolatedPixelCount, edgeNoiseCount,
report.metrics.bgs       //   colorDifference:{meanCiede2000,rmseSrgb,…}, structureRetention, beadCount, … }
report.matrices.current  // 输出矩阵（色号 / null）
report.matrices.bgs
report.diff              // 逐格差异：changedCells / onlyCurrent / onlyBgs / changes[≤5000]
report.blockArt.current  // 方块字符预览，直接看形状差异
report.blockArt.bgs
report.verdict           // null
```

想看全量 JSON 就在控制台里 `copy(JSON.stringify(report))`。

### B. 命令行（对任意 PNG，不用开浏览器）

```bash
node src/algorithms/bgs/ab-run.mjs                              # 三张内置合成图
node src/algorithms/bgs/ab-run.mjs photo.png logo.png           # 你自己的图
node src/algorithms/bgs/ab-run.mjs photo.png --width 128 --max-colors 38 --out docs
```

产出：

- `docs/ALGORITHM_AB_TEST_REPORT.md` — 人读的 Markdown（含指标表 + 方块图预览）
- `docs/algorithm-ab-report.json` — 机读的全量报告（含两个完整矩阵）

PNG 解码用 `node:zlib` 自己实现，零依赖；只支持 **8 位、非隔行**的
灰度 / RGB / 灰度+A / RGBA / 索引色。其它格式会明确报错而不是猜。

---

## 六个指标怎么算

| 指标 | 字段 | 口径 |
|---|---|---|
| 使用颜色数量 | `usedColorCount` | 矩阵里去重后的色号数 |
| 孤立像素数量 | `isolatedPixelCount` | 8 邻域内没有任何同色邻居的格数 |
| 边缘杂色数量 | `edgeNoiseCount` | 位于颜色边界上、且与邻域多数色 CIEDE2000 过大的格数 |
| 色差 | `colorDifference` | 每格「豆色」vs「源图该格均值色」：CIEDE2000 的均值/中位/P95/最大 + sRGB RMSE |
| 结构保持率 | `structureRetention` | 源图结构边在结果里被保住的召回率（`structure` 里另有 precision / f1） |
| 输出矩阵 | `matrices` | `(色号\|null)[][]`；`colorIds` 是机器用的扁平 `Int16Array` |

`delta` 给出 `bgs − current` 的原始差值。**它是个诊断量，不是分数**——
不同指标方向不同（色差越小越好、结构保持率越大越好），不做加权求和。

---

## 两个必须知道的坑

### 1. `current` 一侧必须拿到「它自己的方言」的色板

libms 的 `smart-preprocessing/palette-engine.mjs` 对色板条目的处理是：

```js
lab: Array.isArray(color.lab) ? color.lab : rgbToLab(color.rgb)   // lab 若已存在则**直接采信**
.sort((a, b) => a.distance - b.distance || a.index - b.index)      // 平票按 index 排
```

也就是说：`lab` 被当作 **CIELAB**、`index` 参与排序。而 bgs 的 `preparePalette()`
产出的条目里 `lab` 放的是 **OKLab**、`index` 是按数组位置补的。

把 bgs 准备过的色板喂给生产引擎，匹配结果会被静默改掉。实测（同一张合成图、96×96）：

| 喂进去的色板 | `current` 用色数 | 色差 RMSE |
|---|---:|---:|
| 调用方自己的色板 | 60 | 26 |
| bgs 的 `preparePalette` 输出 | 30 | 190 |

所以 `compareEngines()` 内部**只把调用方的原始色板交给 `currentRunner`**，
`prepared` 只给 bgs 自己和指标计算用。这条契约有回归测试兜着
（`bgs-pipeline.test.mjs` 里那条 identity 断言）。

### 2. `current` 的配置必须与生产链路一致

`generateV2()` 的默认行为和界面默认参数不是一回事。实测同一张图上只差一个
`preset`：

| 传给 `generateV2` 的 options | `current` 用色数 |
|---|---:|
| 只给 `maxColors` | 15 |
| 给 `preset:'auto'`（界面默认） | 6 |

所以：

- 浏览器里的 `runAlgorithmAbTest()` 走的是 `buildV25Options()`——**和
  `processProductionV2` 用的是同一个函数**，不是手抄的副本；
- 命令行里的 `ab-run.mjs` 显式带上界面的默认档位（`preset:'auto'`、`sampling:'auto'`、
  `detailProtection:0.7`、`edgeProtection:0.7`、`highlightProtection:0.8`、
  `eyeProtection:1.0`、`microDetailProtection:0.8`）。

两条路径因此在同一张图上给出**完全一致**的数字——这本身就是「两侧配置没串」的证据。

---

## 一次实测（可复现）

`/tmp/libms-c-fixture.png`（C 批合成图：浅灰背景 + 红底主体 + 黑描边 + 黄眼 + 绿叶 + 蓝块），
48×48，`maxColors` 不限，MARD 221 色。浏览器与命令行结果逐项相同：

| 指标 | `current` | `bgs` |
|---|---:|---:|
| 使用颜色数量 | 6 | 6 |
| 孤立像素数量 | 0 | 0 |
| 边缘杂色数量 | 37 | 31 |
| 色差 CIEDE2000 | 2.881 | 6.003 |
| 色差 sRGB RMSE | 28.52 | 50.69 |
| 结构保持率 | 1 | 1 |
| 豆数 | 2304 | 576 |
| 逐格差异 | 1730 / 2304（75.1%） | 仅 current 有豆 1728 · 仅 bgs 有豆 0 |

读法（供参考，不是结论）：`bgs` 把与边框连通的浅色背景留成了空豆（576 豆），
`current` 默认把背景也铺成豆（2304 豆）；两者色差都在正常量级，
`current` 在这个合成图上色差更小，`bgs` 边缘杂色更少。
**哪套更好取决于你要的是「填满画布」还是「留空背景」。这个判断留给你。**

---

## 复现命令

```bash
# 单测
node --test src/algorithms/bgs/*.test.mjs

# 离线 A/B 报告
node src/algorithms/bgs/ab-run.mjs --width 96 --out docs
```
