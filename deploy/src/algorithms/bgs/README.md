# `src/algorithms/bgs/` — BGS image→bead algorithm module

An **independent, host-neutral** implementation of the image→bead-colour-matrix
pipeline, extracted from the open-source project
[`zwhy149/bead-grid-studio`](https://github.com/zwhy149/bead-grid-studio) v1.2.0
(Apache-2.0) and adapted for libms-studio.

It is registered as `algorithmEngine = "bgs"` and runs **alongside** the existing
pipeline, which remains `algorithmEngine = "current"`. Neither replaces the other.
See `../../ALGORITHM_AUDIT.md` for the full analysis of what was taken, what was
deliberately left behind, and why, and `../../docs/ALGORITHM_AB_TEST.md` for the
A/B comparison workflow.

> ⚠️ **Attribution obligations apply.** This directory contains third-party code under
> the Apache License 2.0. Read [`NOTICE`](./NOTICE) before copying, moving, or
> relicensing anything here. Do not present `bgs` as a user-facing product name —
> see §6 of the license and `NOTICE` §4(a).

---

## Public API

```js
import { convertImageToBeads } from './src/algorithms/bgs/index.mjs';

const result = convertImageToBeads(imageData, {
  width: 60,                  // 目标格宽
  height: null,               // 省略时按原图比例推导
  maxColors: 24,              // 0 = 不限
  palette,                    // 必填：[{ code, rgb|hex, name? }]
  preserveAspectRatio: true,
  samplingMode: 'auto',       // 'auto' | 'center' | 'linear' | 'dominant' | 'edge-aware' | 'document'
  topologyProtection: 'auto', // true | false | 'auto'
  edgeProtection: 1,          // 0–2，轮廓/饱和像素投票权重
  cleanupStrength: 0.5,       // 0–1，杂色同化强度；0 = 完全复现上游
  whiteMode: 'auto',          // 'auto' | 'keep'
  fitMode: 'auto',            // 'auto' | 'contain' | 'cover' | 'stretch'
  autoCrop: false,
  protectDark: true,
  preserveExactColors: true,
  pixelBudget: 4_000_000,
  crop: { x: 0, y: 0, w: 1, h: 1 },
  transforms: [],             // ['rotate'] | ['mirrorH'] | ['mirrorV']
  whiteCode: 'H2',
  blackCode: 'H7',
  mergeStrength: 0,
});
```

### Return value

| 字段 | 类型 | 说明 |
|---|---|---|
| `width` / `height` | `number` | **格数**（不是像素） |
| `matrix` | `(string\|null)[][]` | **纯拼豆颜色矩阵**，元素是色号字符串，空格为 `null`。不含任何 UI 状态 |
| `colorIds` | `Int16Array` | 扁平索引矩阵，值为 `palette[].index`，空格为 `-1`。给机器用 |
| `palette` | `object[]` | 本次实际使用的色板（含 `index` / `code` / `name` / `hex` / `rgb` / `transparent`） |
| `statistics` | `object` | 见下 |
| `diagnostics` | `object` | 全链路诊断：几何、分类、背景、阈值、采样、拓扑、清理、降色、匹配、耗时 |

`statistics` 的关键字段（也是 A/B 的六个指标来源）：

```js
{
  usedColorCount,          // 使用颜色数量
  isolatedPixelCount,      // 孤立像素数量（8 邻域无同色）
  edgeNoiseCount,          // 边缘杂色数量（边界上且与邻域多数色差过大）
  colorDifference: {       // 色差（相对源图各格均值）
    meanCiede2000, medianCiede2000, p95Ciede2000, maxCiede2000, rmseSrgb, samples
  },
  structureRetention,      // 结构保持率（源结构边的召回）
  structure: { retention, precision, f1, sourceEdgeCells, outputBoundaryCells, matchedCells },
  beadCount, totalCells, fillRatio, colors, componentCount,
  lowAgreementCellCount, boundaryCellCount, largestComponent,
  isolatedCells, noiseCells,   // 最多各 200 个格号，供排查
}
```

---

## Design guarantees

1. **No UI coupling.** Nothing in this directory reads `window`, `document`,
   `localStorage`, or any application state. The matrix is bead colours only.
2. **No Canvas requirement.** The caller supplies one `{ data, width, height }`
   ImageData. `raster.mjs` does crop / transforms / resample / letterbox in pure
   typed arrays, so the module runs identically in a browser, a Web Worker, and
   `node --test`.
3. **Deterministic.** Same pixels + same options ⇒ identical output. There is no
   random seed anywhere (upstream: *"There is no random k-means seed"*).
4. **No silent size clamping.** An out-of-range `width`/`height` is reported in
   `diagnostics.geometry.limits` and never rewritten — libms has an explicit rule
   against that (see `../../docs/BLANK_BOARD_SIZE_FIX.md`).
5. **Palette data is never copied from upstream.** `options.palette` is required;
   libms's own catalogue is passed in.

---

## Module map

| 文件 | 职责 |
|---|---|
| `index.mjs` | 公开入口 `convertImageToBeads` + 管线编排 |
| `config.mjs` | 全部阈值常量；`BGS_CONFIG`（纯值）+ `BGS_CONFIG_META`（上游出处） |
| `color-space.mjs` | sRGB/Linear/OKLab/CIELAB/CIEDE2000、可见色相判定、Otsu、色板预处理 |
| `geometry.mjs` | 格数推导、比例代价、EXIF 换向、底板居中嵌入 |
| `raster.mjs` | **宿主边界**：裁剪/旋转/镜像/重采样/contain·cover/像素预算 |
| `analyze.mjs` | 亮度图、透明与连通背景、扫描边伪影、Otsu 暗阈值、内容分类、线稿分析+自动裁边 |
| `matcher.mjs` | 色板匹配（精确直命中 → OKLab 预筛 → CIEDE2000 精配） |
| `sampling.mjs` | 5 种采样策略 + 局部反差锐化 |
| `topology.mjs` | **小尺寸线稿拓扑保护**（连通域归属 + Zhang–Suen 细化 + 冲突消解） |
| `refine.mjs` | 杂色清理、锚点检测、相近色合并、最大色数控制 |
| `statistics.mjs` | 统计与 A/B 指标 |
| `ab-test.mjs` | A/B 对比器（归一化、指标、矩阵差分、块字符预览） |
| `ab-run.mjs` | **可执行的 A/B 脚本**（Node）：同一张图分别跑 `current` 与 `bgs`，出 Markdown/JSON 报告 |
| `*.test.mjs` | 单测（纯 Node，不落盘、不需浏览器） |

---

## 跑一次 A/B（两套算法并存，供人工比较）

浏览器里：

```js
const report = await window.LibmsWorkspaceBridge.runAlgorithmAbTest();
report.metrics.current   // 使用颜色数量 / 孤立像素 / 边缘杂色 / 色差 / 结构保持率
report.metrics.bgs
report.matrices          // 两个输出矩阵
report.verdict           // 恒为 null —— 不自动判定优劣
```

命令行里（对任意 PNG，无需打开浏览器）：

```bash
node src/algorithms/bgs/ab-run.mjs                       # 三张内置合成图
node src/algorithms/bgs/ab-run.mjs photo.png --width 96  # 你自己的图
# 产出 docs/ALGORITHM_AB_TEST_REPORT.md 与 docs/algorithm-ab-report.json
```

两条路径跑出来的是**同一套配置**：`current` 一侧直接用生产链路的
`generateV2` + 应用默认参数，`bgs` 一侧用本模块；两侧共享同一份 imageData。

> **不做胜负判定。** 没有 `winner`、没有评分、没有推荐。两套算法都保留。
> 详见 [`../../docs/ALGORITHM_AB_TEST.md`](../../docs/ALGORITHM_AB_TEST.md)。

---

## Testing

```bash
node --test src/algorithms/bgs/*.test.mjs
```

The tests are pure Node — no browser, no Canvas, no fixtures on disk. Test images are
generated in memory.

---

## Licence

Code in this directory is a derivative work of `zwhy149/bead-grid-studio`
(Apache-2.0). See [`NOTICE`](./NOTICE) and
[`LICENSE-APACHE-2.0.txt`](./LICENSE-APACHE-2.0.txt).
