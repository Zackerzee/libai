# ALGORITHM_AUDIT.md

> **实施状态**：本审计的第一阶段（只分析、不改现有代码）已完成；
> 第二/三阶段已落地 —— 纯算法模块在 `src/algorithms/bgs/`，
> 引擎开关为 `algorithmEngine = "current" | "bgs"`，A/B 对比器见
> `docs/ALGORITHM_AB_TEST.md`，验证记录见 `docs/BATCH_E_VALIDATION.md`。
> 本文件保持为**审计时的原始判断**，未按实施结果回头改写。
>
> 实施中修正过两处审计结论，以 `docs/BATCH_E_VALIDATION.md` §3 为准：
> ① `compareEngines()` 必须把调用方**原始**色板交给 `current` 引擎（否则色板方言串味）；
> ② bgs 的 `resolveGrid` 对越界尺寸是**只报告不改写**，与审计中「上游会静默夹取」的描述相反 —— 这是 libms 侧的修正，已按 libms 规则实现。

**审计对象**：`https://github.com/zwhy149/bead-grid-studio`（豆格工坊 / Bead Grid Studio）
**审计版本**：v1.2.0，`package.json` license `Apache-2.0`
**审计日期**：2026-09-18
**审计范围**：`src/` `docs/` `tests/unit/` 及所有与 image conversion / sampling / quantization / palette matching / topology / color matching / image processing 有关的代码
**审计目标**：提取「图片 → 拼豆颜色矩阵」的纯算法，作为独立模块集成到 libms-studio，**不复制其 UI / CSS / HTML / PWA / i18n / 状态管理 / 导出界面 / SEO / analytics / 品牌元素**

---

## 0. 结构性结论（先读这一段）

**整个图片转换算法只存在于两个文件里。**

| 文件 | 行数 | 含算法 |
|---|---|---|
| `src/app.js` | 3835 | ✅ 几乎全部（含 `convertPixels` 754 行） |
| `src/core/geometry.js` | 130 | ✅ 全部（比例/取景/嵌入几何） |
| `src/palettes/mard221.js` | 60 | 色卡数据（221 色 hex 串） |
| `src/palettes/catalog.js` | 29 | 色卡 provider 注册表 |
| `src/styles.css` | — | CSS（不提取） |
| `src/i18n/*.js` | 1348 | 国际化（不提取） |

**三个关键发现：**

1. **`convertPixels()` 已经是纯函数。** 它零 DOM、零 Canvas、零 `window`、零 `document`、零 `performance`，只吃 typed array、只吐 typed array。原项目为了塞进 Blob Worker，用 `convertPixels.toString()` 序列化它——这个「必须自包含」的约束反而替我们保证了它不引用闭包变量。**它对 `src/app.js` 其余 3081 行的 UI/状态代码没有任何依赖。**

2. **真正的 Canvas 依赖只有一处**：`renderReferenceRaster()`（app.js:1435–1520）。它负责「解码后的 `<img>` → 栅格化 ImageData」这一步（裁剪、EXIF 旋转、镜像、contain/cover 缩放、letterbox）。**这是唯一必须由宿主提供的输入**，也正是我们模块要接手的边界。

3. **本次移植的净增量很小，但价值集中。** C2/C3 批已经从这个仓库移植过 `accent-protection`（强调色保护）与 `auto-background`（自动留空背景）与 `subject-crop`（自动裁边）。因此 E 批真正的新东西是：
   - **小尺寸线稿拓扑保护**（`smallLineArtRefinement`，app.js:1962–2373 共约 410 行）——libms **完全没有对应实现**，这是唯一不可替代的资产；
   - **document（文档）模式**——libms 没有针对文字/表格/框线的分支；
   - **「转换模式」作为一个整体配置轴**（cartoon / document / photo / detail / pixel）。

---

## A. 找到了哪些算法

按用户给定的 17 项逐一对照。`存在` 指原仓库有对应实现，`libms 已有` 指我方现有代码已覆盖。

| # | 目标算法 | 状态 | 实现位置（src/app.js 除注明外） |
|---|---|---|---|
| 1 | 图片缩放与网格采样 | ✅ 存在 | 缩放 `renderReferenceRaster` 1435–1520；采样 2113–2215（5 种模式分支） |
| 2 | 图片 → grid matrix | ✅ 存在 | `convertPixels` 1767–2520，返回 `Int16Array` |
| 3 | RGB / Linear RGB / Lab 颜色空间转换 | ✅ 存在 | `srgbLinear`/`linearSrgb` 1778–1779；`rgbLab`(OKLab) 1780–1786；`rgbCieLab`(CIELAB D65) 1788–1793；预计算版 638–688 |
| 4 | 拼豆色板最近色匹配 | ✅ 存在 | `nearestPalettePosition` 2069–2100（精确直命中 → 缓存 → OKLab 预筛 32 → CIEDE2000 精配） |
| 5 | color quantization | ✅ 存在 | 同 #4。**是「受限调色板最近色量化」，不是 k-means**，无随机种子 |
| 6 | 最大颜色数量控制 | ✅ 存在 | 2496–2515，`loss = count × d² × (0.7+avgImportance) × (1+2.2·chroma)`，锚点 ×40 惩罚 |
| 7 | 黑白锚点保护 | ✅ 存在 | `outlinePalettePosition`/`whitePalettePosition` 1940–1948；`protectDark` + `darkPixelIsChromatic` 1928–1931；anchors 最深/最浅中性色 2455–2459 |
| 8 | 强调色保护 | ✅ 存在 | anchors 中彩度色按 `chroma·log2(count+2)` 排序、环形色相间距 **>0.55 rad** 取 ≤3 个 2460–2470；`colorPriority` 2440–2443 |
| 9 | 小尺寸图案拓扑保护 | ✅ 存在 | `smallLineArtRefinement` 1962、1972–2063、2306–2373（超采样中间栅格 + Zhang-Suen 细化 + 源连通域归属） |
| 10 | 分离部件保护 | ✅ 存在 | `sourceOwners` BFS 连通域 1982–1997；`lineOwnerCandidates` 候选保留 2052–2057；`ownerConnectedWithout` 连通性检查 2332–2345；关节格保护式冲突消解 2346–2367 |
| 11 | 线稿处理 | ✅ 存在 | `analyzeLineArtSubject` 203–289；`lineRasterCutoff` 1965；Otsu `darkThreshold` 1898–1918；`outlineCutoff` 1920；细线一致性 `coherentThinLine` 2292 |
| 12 | 透明区域处理 | ✅ 存在 | alpha 跳过 2157；预乘白底合成 1811–1813、2162；`whiteMode==='auto'` 边界连通 flood fill 1819–1860；透明豆 H1 排除出自动匹配 701–704 |
| 13 | 相近颜色合并 | ✅ 存在 | `mergeStrength` 循环 2473–2493（同色性才可合并、锚点对不合并、按 `colorPriority` 定方向） |
| 14 | 杂色 / 孤立像素处理 | ⚠️ 弱 | cartoon 模式 1–2 格彩色噪点清理 2402–2429；门槛过保守（要求 `bestCount ≥ component.length+2`） |
| 15 | 轮廓保护 | ✅ 存在 | `isOutline` 加权 `factor=1.66+min(1.15, gradient/105)` 2207；`coherentThinLine` 阻止细轮廓被降格 2292–2297 |
| 16 | 自动裁边 | ✅ 存在 | `analyzeLineArtSubject` 的 `autoCrop` 283–288（5% padding、最小 2px，仅当 `trimFraction≥.06 && retainedInkRatio≥.995`） |
| 17 | 不同比例图片 resize/crop 策略 | ✅ 存在 | `src/core/geometry.js` 全文：`gridForLongSide`、`gridFromAspectAnchor`、`orientedSourceDimensions`(EXIF)、`fitGeometryMetrics`(contain/cover 代价)、`fitPatternInsideBoard`(居中嵌入) |

**额外发现（不在 17 项内但值得记录）**

| 算法 | 位置 | 说明 |
|---|---|---|
| 内容自动分类 | `analyzeSourceComplexity` 291–357 | 判定 document / photo / lineArt |
| 参数自动推荐 | `recommendDocumentGrid` 359–367、`recommendAutoHdSettings` 369–384 | 按分类推荐网格与模式 |
| 图案质量评估 | `assessPatternQuality` 189–201 | 低细节/严重细节/比例告警 |
| 紧凑图案嵌入底板 | `embedPatternGrid` 180–187 | 图案居中嵌入真实底板，留空行是正常板容量 |
| 旧色卡迁移映射 | `LEGACY_TO_MARD` 695–699 | 旧 64 色 → MARD 221 的 CIEDE2000 最近邻 |

---

## B. 每个算法所在源文件

| 算法族 | 源文件 | 行区间 |
|---|---|---|
| 网格采样（5 模式） | `src/app.js` | 2113–2304 |
| 图片 → grid matrix | `src/app.js` | 1767–2520 |
| 颜色空间转换（内联版） | `src/app.js` | 1777–1807 |
| 颜色空间转换（色卡预计算版） | `src/app.js` | 638–688 |
| 色板最近色匹配 | `src/app.js` | 2064–2100 |
| 最大颜色数控制 | `src/app.js` | 2495–2515 |
| 黑白锚点 / 强调色保护 | `src/app.js` | 1928–1948、2451–2471 |
| 小线稿拓扑保护（含分离部件） | `src/app.js` | 1962–2373 |
| 线稿分析 + 自动裁边 | `src/app.js` | 203–289 |
| 透明 / 背景处理 | `src/app.js` | 1816–1895、2157、2161 |
| 相近色合并 | `src/app.js` | 2473–2493 |
| 杂色清理 | `src/app.js` | 2402–2429 |
| 内容分类 | `src/app.js` | 291–357 |
| 栅格化（**唯一 Canvas 依赖**） | `src/app.js` | 1435–1520 |
| 几何 / 比例 / 嵌入 | `src/core/geometry.js` | 全文 |
| 色卡数据 | `src/palettes/mard221.js`、`catalog.js` | 全文 |

---

## C. 每个算法入口函数

```js
// ── 主入口 ─────────────────────────────────────────────
convertPixels(payload)                        // app.js:1767   核心，754 行，纯函数
runConversion(payload, jobId)                 // app.js:2522   把上者 toString() 塞进 Blob Worker
convertImage()                                // app.js:2567   UI 编排（含 Canvas 取像素）

// ── 采样 ───────────────────────────────────────────────
// 无独立函数：switch(processMode) 内联在 convertPixels 的 2113–2304 双循环里
// pixel  → 中心单点 (2120–2131)
// photo  → 线性光均值 (2168–2173、2262–2282)
// detail → 线性光均值 + 暗部加权 + 局部反差锐化 (2376–2400)
// document → 结构张量 + 长 run + 文字纹理抑制 (2178–2200、2221–2261)
// cartoon → 逐源像素面积加权投票 + 轮廓加权 (2202–2214、2283–2302)

// ── 颜色空间 ───────────────────────────────────────────
hexToRgb(hex)                                 // app.js:638
rgbToOklab(rgb)                               // app.js:643
rgbToCielab(rgb)                              // app.js:660
deltaE2000(a, b)                              // app.js:671
// convertPixels 内部还有同义的内联版本：
//   srgbLinear / linearSrgb / rgbLab(OKLab) / rgbCieLab / cieDelta / labDistance / darkPixelIsChromatic

// ── 色板匹配 ───────────────────────────────────────────
nearestPalettePosition(r, g, b, forceNeutralOverride)   // app.js:2069
getAllowedPalette()                            // app.js:701  过滤掉透明豆 H1

// ── 分析 / 几何 ────────────────────────────────────────
analyzeLineArtSubject({data, width, height})            // app.js:203
analyzeSourceComplexity({data, width, height, ...})     // app.js:291
analyzeReferenceImage(image, sw, sh, crop)              // app.js:386  ⚠️ 有 DOM
assessPatternQuality({...})                             // app.js:189
recommendAutoHdSettings({...})                          // app.js:369
embedPatternGrid(compact, pc, pr, bc, br, ox, oy)       // app.js:180
renderReferenceRaster({contentOnly})                    // app.js:1435 ⚠️ 有 Canvas
// src/core/geometry.js
gridForLongSide / gridFromAspectAnchor / orientedSourceDimensions
fitGeometryMetrics / fitPatternInsideBoard              // geometry.js:11/40/69/82/106
```

---

## D. 调用关系

```
convertImage()                                    [app.js:2567 · UI 编排]
├─ currentPatternPlacement() / currentBoardLayout()        [底板放置]
├─ renderReferenceRaster({contentOnly:true})               [Canvas 栅格化]  ← 唯一图像输入边界
│   └─ cropSourceRect() → drawImage(旋转/镜像/contain/cover)
├─ ctx.getImageData()                                      [→ Uint8ClampedArray]
├─ getAllowedPalette()                                     [过滤 H1 透明豆]
├─ runConversion(payload, jobId)                           [Worker 包装 + 超时看门狗]
│   └─ new Worker(Blob(`(${convertPixels.toString()})(event.data)`))
│       └─ convertPixels(payload)                          ★ 纯算法核心 ★
│           ├─ 预乘白底合成 → luminance[]                   [1810–1814]
│           ├─ whiteMode==='auto' → 边界连通 flood fill      [1819–1860]
│           │     └─ 边框中位数色 + 亮/低彩/相似度三重门槛 → BFS
│           ├─ 扫描边伪影剔除 markEdge/edgeProfile          [1864–1894]
│           ├─ 中性像素直方图 → Otsu → darkThreshold        [1898–1918]
│           ├─ paletteChromatic[] / outlinePos / whitePos   [1932–1948]
│           ├─ monochromeLineArt 判定                       [1952–1961]
│           ├─ if smallLineArtRefinement:                   [1972–2063]
│           │   ├─ sourceOwners ← 源像素级 8 邻接 BFS 连通域
│           │   ├─ micro 栅格（长边 ≥192px）分数面积覆盖率
│           │   ├─ Zhang–Suen 细化（两相位 × ≤64 轮）
│           │   └─ 回投影到目标格 → lineSkeletonCells / lineOwnerCells
│           ├─ nearestPalettePosition 闭包                  [2069–2100]
│           │   └─ exactPalettePosition.get() → 命中即返回
│           │   └─ fineMatching ? Map 精确缓存 : Int16Array(65536) 5-bit 粗桶
│           │   └─ OKLab labDistance 插入排序取 top-32 → CIEDE2000 精配
│           ├─ 双循环 gy×gx：按 processMode 采样 + 投票        [2113–2304]
│           ├─ 小线稿：owner 缺席补位 → 8 邻接冲突消解         [2306–2373]
│           ├─ detailMode 局部反差锐化（无抖动）              [2376–2400]
│           ├─ cartoon 1–2 格彩噪清理                        [2402–2429]
│           ├─ anchors ← 最深/最浅中性色 + 色相间距鲜艳色      [2451–2471]
│           ├─ mergeStrength 相近色合并                      [2473–2493]
│           └─ maxColors 降色（loss 函数 + 锚点 ×40）          [2495–2515]
├─ embedPatternGrid()  [仅 board+contain]                   [180–187]
└─ commitHistory() / renderAll() / updateResultUi()          [UI 副作用]
```

**在 libms 侧的对应位置**：`app.js` 的 `processImage()`（2070）以内联分支选择引擎——`processProductionV2()`（2036）→ `processImageV2()`（1974）→ `generateV2()`。E 批要新增的 `algorithmEngine` 开关插在 `processImage()` 这一层（详见 `docs/` 集成说明）。

---

## E. 输入数据结构

```js
// convertPixels(payload)
{
  data: Uint8ClampedArray,   // RGBA 交错，长度 width*height*4；★ 是「未预乘」的原始值，
                             //    函数内部自己做白底合成：data[p]*a + 255*(1-a)
  width:  number,            // 源栅格宽（不是目标格宽）
  height: number,            // 源栅格高
  cols:   number,            // 目标格列数
  rows:   number,            // 目标格行数
  palette: Array<{
    index:  number,          // ★ 写进 grid 的是这个字段，不是数组下标、不是 code
    code:   string,          // 如 'H7'
    rgb:    [r,g,b],         // 0–255
    lab:    [L,a,b],         // ★ OKLab，必须预计算
    cieLab: [L,a,b],         // ★ CIELAB D65，必须预计算
  }>,
  maxColors:     number,     // 最终色数上限（1 起；0/undefined 会被 Math.round(0)||1 变成 1）
  whiteMode:     'auto' | 'keep',
  processMode:   'cartoon' | 'document' | 'photo' | 'detail' | 'pixel',
  mergeStrength: number,     // 0–30，内部 /100 作为 OKLab 距离阈值
  protectDark:   boolean,
}
```

**移植必读的两条硬约束**

1. **`palette[].lab` 与 `palette[].cieLab` 必须由调用方预计算。** 原项目在 `PALETTE.forEach`（690–694）就地注入这三个字段。`convertPixels` 只读不算。若漏算，`palette[i].cieLab ? ... : candidate.rough * 100` 会静默退化成粗糙距离（2095），**不报错但结果全错**。
2. **`grid` 存的是 `palette[].index`。** 例：`grid[cell] = palette[choice].index`（2299）。这不是数组下标——色板过滤掉 H1 后，下标与 `index` 会错位。反向查找用 `palettePositionByIndex`（1933）。

---

## F. 输出数据结构

```js
{
  buffer:      ArrayBuffer,   // Int16Array(cols*rows) 的底层缓冲，值 = palette 的 index，空格 = -1
  selected:    number[],      // 保留下来的 index，按「颗数降序，同数按 index 升序」排
  nonEmpty:    number,        // 非空格数
  diagnostics: {
    usedBeforeMerge,               // 合并前的色数
    backgroundPixels,              // auto 背景清掉的源像素数
    edgeArtifactPixels,            // 扫描边伪影清掉的像素数
    darkThreshold,                 // Otsu 得到的暗阈值
    outlineCutoff,                 // min(darkThreshold, 70)
    monochromeLineArt,             // boolean
    smallLineArtRefinement,        // boolean
    lineSourceComponents,          // 源墨线连通域数
    lineSeparatedConflicts,        // 被拆开的部件冲突数
    lineUnresolvedConflicts,       // 无法拆解的冲突数
    lineUnrepresentableComponents, // 网格装不下的部件数
    lineForcedCandidatePlacements, // 被迫放到次优格的部件数
    mode: processMode,
  },
}
```

Worker 回传时 `buffer` 走 transferable，主线程用 `new Int16Array(result.buffer)` 还原（2606）。

---

## G. 是否依赖 DOM / Canvas

| 单元 | DOM | Canvas | 备注 |
|---|---|---|---|
| `convertPixels` | ❌ | ❌ | **完全纯**。零 `document`/`window`/`performance`/`navigator`。只依赖 `Math` 与 typed array |
| `analyzeLineArtSubject` | ❌ | ❌ | 纯，只吃 `{data,width,height}` |
| `analyzeSourceComplexity` | ❌ | ❌ | 纯，只吃 `{data,width,height,sourceWidth,sourceHeight}` |
| `src/core/geometry.js` 全部 | ❌ | ❌ | 纯数学，文件头自述「knows nothing about DOM, Canvas, palettes, or files」 |
| `nearestPalettePosition` | ❌ | ❌ | `convertPixels` 内部闭包，纯 |
| 颜色空间函数（638–688） | ❌ | ❌ | 纯 |
| `renderReferenceRaster` | ❌ | ✅ | `document.createElement('canvas')` + `drawImage`；**必须由宿主提供替代实现** |
| `analyzeReferenceImage` | ✅ | ✅ | `createElement('canvas')` + `getImageData` |
| `runConversion` | ✅ | ❌ | `Worker` + `Blob` + `URL.createObjectURL` |
| `convertImage` | ✅ | ✅ | 全面 UI 编排 |
| `DEVICE_LIMITS`（124–128） | ✅ | ❌ | 读 `navigator.deviceMemory` / `hardwareConcurrency` / `matchMedia` → 决定像素预算 |
| `getAllowedPalette` | ❌ | ❌ | 纯（但依赖全局 `PALETTE` 单例） |

**结论**：`convertPixels` + geometry + 三个 analyze 函数合起来是**一整块无宿主依赖的计算核**。缺口只有两处：**像素栅格化**（Canvas）与**像素预算**（`DEVICE_LIMITS` 读 navigator）。两者都恰好位于「宿主提供输入」这一侧，属于正确分层。

原架构文档 `docs/architecture.md` 自己就写明了目标接口，与用户本次要求几乎一致：

```ts
convert(pixels: PixelBuffer, options: ConversionOptions, palette: Palette): ConversionResult
// "It must not depend on DOM, Canvas, Worker, local storage, or file downloads."
```

也就是说：**我们做的不是改造，而是把原作者自己规划好、但没做完的重构落地。**

---

## H. 是否可以改造成 pure function

| 算法 | 可否纯函数化 | 改造动作 |
|---|---|---|
| 图片 → grid matrix（`convertPixels`） | ✅ **已经是** | 零改动。只需拆成内部子函数、清掉未用变量 |
| 网格采样（5 模式） | ✅ 已是内联 | **必须拆分**为 `sampling/` 子模块（原为 2113–2304 一个大 switch） |
| 颜色空间转换 | ✅ 已是 | 合并两套重复实现（内联版 1777–1807 vs 顶层版 638–688）为单一来源 |
| 色板最近色匹配 | ✅ 已是 | 从闭包改为显式传参（`palette`、`protectDark`、`fineMatching`） |
| 最大颜色数控制 | ✅ 已是 | 从闭包改显式传参；抽 `loss` 函数以便 A/B 调参 |
| 黑白锚点 / 强调色保护 | ✅ 已是 | 从闭包改显式传参 |
| 小线稿拓扑保护 | ✅ 已是 | **最大的一块**：拆出连通域标注、Zhang–Suen 细化、owner 归属、冲突消解四个可独立测试的纯函数 |
| 线稿分析 + 自动裁边 | ✅ 已是 | 直接搬，去掉 `normalizeCrop` 对全局 `clamp` 的依赖（改成局部） |
| 内容分类 | ✅ 已是 | 直接搬；阈值应外提为配置常量 |
| 相近色合并 | ✅ 已是 | 直接搬 |
| 杂色清理 | ✅ 已是 | 直接搬（建议同时放宽阈值，见 K-3） |
| 几何 / 比例 | ✅ 已是 | 直接搬 `geometry.js` 全文 |
| 栅格化 | ❌ **不可** | 保留为「宿主适配层」：模块只接受 `{data,width,height}`，由调用方用 Canvas/OffscreenCanvas/node-canvas 提供 |
| 像素预算 `DEVICE_LIMITS` | ❌ 不可 | 改为 `options.pixelBudget` 显式传入，默认给安全值 |

**纯函数化的三个具体障碍及对策**

1. **`clamp` 依赖全局**（`normalizeCrop` 161 调用模块级 `clamp` 156）→ 复制一份私有实现，不共享全局。
2. **`entryByIndex` / `palettePositionByIndex` 等闭包 Map**（1932–1935）→ 改为由 `createMatcher(palette, options)` 一次性构建并返回的闭包，或每次调用重建（成本仅 O(220)）。
3. **`convertPixels.toString()` 的 Worker 序列化**（2530）→ **不要沿用到 libms**。ESM 下用正常 `import` + 可选 `new Worker(url, {type:'module'})`；原做法让函数无法引用任何外部符号，也导致它内部重复定义了一套颜色空间函数（1117 行左右的重复代码来源）。

---

## I. 与我现有算法可能重复的部分

| 能力 | BGS 实现 | libms 现有实现 | 重叠度 | 判断 |
|---|---|---|---|---|
| 网格采样 | `convertPixels` 内联 5 模式（~190 行） | `sampling-engine-v2.mjs`（**1221 行**，linear-mean / center / dominant / edge-aware + auto + 区域自适应 + 空间相干 + 稳定区分析） | 🔴 **高** | libms 明显更细。**不采用** BGS 采样 |
| 色板最近色匹配 | OKLab 预筛 32 + CIEDE2000（2074–2099） | `palette-engine.mjs`（270 行，CIEDE2000 + 肤色专项 + 版本号） | 🔴 **高** | 两者同源思路。**不采用** BGS 匹配 |
| 颜色空间转换 | `rgbToOklab` / `rgbToCielab` / `deltaE2000` | `palette-engine.mjs` 的 `srgbToLinear` / `rgbToLab` / `deltaE2000` | 🔴 **完全重复** | **不采用**。若需 OKLab 只需补 `rgbToOklab` 一个函数 |
| 最大颜色数控制 | loss 函数 + 锚点 ×40（2495–2515） | `protected-palette-budget-v2.mjs`（225 行，tier/reason 分层 + `protectedKeys`） | 🟠 **中** | libms 的分层更成熟。**不采用** BGS 降色 |
| 黑白锚点保护 | anchors 最深/最浅中性色（2455–2459） | `detail-protection-v2.mjs`（398 行）+ `protectDark` 语义 | 🟠 **中** | 理念相同，libms 有 tier/reason 元数据。**不单独采用** |
| **强调色保护** | 彩度排序 + 环形色相间距 **>0.55 rad** 取 ≤3（2460–2470） | `accent-protection.mjs`（186 行，中性锚点 + 鲜艳锚点 ≤3、间距 >0.55 rad） | 🟢 **几乎逐字相同** | ⚠️ **C2 批已移植过本仓库**。**跳过** |
| **自动留空背景** | `whiteMode==='auto'` 边框连通 flood fill（1819–1860） | `auto-background.mjs`（180 行，`L*≥88` + 彩度 ≤14 + CIEDE2000 ≤18 + 边框连通） | 🟢 **同源** | ⚠️ **C2 批已移植**。**跳过** |
| **自动裁边** | `analyzeLineArtSubject.autoCrop`（283–288） | `subject-crop.mjs`（234 行，floodBackgroundMask + 外接框 + padding 0.04） | 🟢 **同源** | ⚠️ **C3 批已移植**。**跳过** |
| 线稿处理 | 连通域拓扑保真 + Zhang–Suen 细化 | `stroke-mask.mjs`（301 行，Sobel → Otsu → NMS → Float32 连续掩码） | 🟡 **方法不同** | ✅ **互补，值得保留**（见 J-1） |
| 杂色 / 孤立像素 | 1–2 格彩噪同化（2402–2429） | `smart-cleanup-v2.mjs`（218 行，sampling-aware + tier 分层 + 源证据） | 🟠 **中** | libms 更完善。**不采用** BGS 清理 |
| 相近颜色合并 | `mergeStrength` OKLab 阈值合并 | `protected-palette-budget-v2` 的合并阶段 | 🟠 **中** | 功能等价。**不采用** |
| 内容分类（文档/照片/线稿） | `analyzeSourceComplexity`（67 行） | ❌ **无**（只有 `analyzeImageFeatures`/`analyzeImageProfile` 的图像统计，不产出文档判断） | 🟢 **无重叠** | ✅ **值得保留**（见 J-2） |
| 几何 / 比例 / 嵌入 | `geometry.js`（130 行） | `getGenerationTargetHeight` + 画布尺寸逻辑（分散） | 🟠 **中** | 部分可借鉴（见 J-8） |
| 小线稿拓扑保护 | `smallLineArtRefinement`（~410 行） | ❌ **完全无** | ⚫ **零重叠** | ✅✅ **最有价值**（见 J-1） |

### I 的关键结论

**C2/C3 两批已经把本仓库最成熟的三个模块移植过了**（强调色保护、自动留空背景、自动裁边）。因此：

- 采样、匹配、颜色空间、降色、清理、合并 → **重复，不要搬**（libms 版本都更完善）
- **真正无重叠的只有三块**：小线稿拓扑保护、内容分类（document 路径）、模式化配置轴
- 若把整条 BGS 管线搬进来，会与 libms 现有 6 个模块**正面撞车**，维护成本翻倍而收益为负

---

## J. 值得保留的算法

**J-1. 小尺寸线稿拓扑保护（`smallLineArtRefinement`，app.js:1962–2373）— 最高优先级**

libms 完全没有对应物。它解决一个 libms 现在的真实缺陷：**在小网格（≤60 格）上，独立的逐格多数投票会让细线变粗、让本来分离的部件粘在一起。**

八步流程（对应 `docs/algorithm.md` 的自述）：

1. **只剔除高置信度的均匀扫描边伪影**（不强删真实边框）
2. 在**与最终网格无关的中间栅格**上分析主体（长边 ≥192px）
3. 投影前先在**源像素层**标注墨线连通域（`sourceOwners`，8 邻接 BFS）
4. 为每个目标格累积**按 owner 归属的支撑度**（`lineOwnerCandidates` 保留每 owner 的 top-12 候选格）
5. **Zhang–Suen 细化**骨架，且**不把全部黑色像素当成同一个连通域**
6. 冲突消解时**保护关节格**（`ownerConnectedWithout` 删格后仍连通才允许删）
7. 未被认领的微小 owner 若有不冲突的支撑格，**补放一颗豆**
8. 装不下时**如实报告**（`lineUnrepresentableComponents`）而**不凭空多放豆**

为什么值得保留：
- 它是**唯一在 libms 中没有任何对应实现的算法**
- 它保护的是「拓扑」而非「颜色」——与 libms 的 `stroke-mask`（连续掩码，管的是"保护权重"）是**正交**的两件事，可以叠加使用
- 它的诊断字段（`lineSeparatedConflicts` / `lineUnresolvedConflicts` / `lineUnrepresentableComponents`）能把「网格容量不足」与「算法失败」区分开——这个能力 libms 现在没有
- 有原项目的浏览器回归覆盖（19 项小线稿不变量，见 `docs/verification.md`）

**J-2. document（文档）模式（app.js:2107、2178–2200、2221–2261）**

用结构张量相干性 + 最长暗色 run + 转移密度共同判定，区分四种情形：连续长线（框线/表格）、相干边缘、实心墨块、文字纹理。**文字纹理会被主动抑制**（`textTexture && !continuousRule && !solidColor && !solidFill` → 不落格）。

libms 没有文档分支。对「用户上传截图/表格/带字 logo」的场景有实际价值。

**J-3. 精确色号直命中（`exactPalettePosition`，1934–1935、2071–2072、2203）**

`(r<<16)|(g<<8)|b` 建精确 RGB 索引，命中即返回，**绕过一切量化与缓存**。保证「源图里本来就是色卡色」的像素绝不漂移。libms 的 `palette-engine` 没有这层短路。代价 O(220) 建表，几乎免费。

**J-4. Otsu 自适应暗阈值（app.js:1898–1918）**

用**中性像素**（`chroma<50`）的直方图跑 Otsu，再夹到 `[54,148]` 后 `+14`，得到 `darkThreshold`；`outlineCutoff = min(darkThreshold, 70)`。避免为每张图写死黑色阈值。注：本仓库与我方 `legend-text-parse.js` 用的是同一套 Otsu——**同样需要注意纯双峰直方图退化**（我方已修，见下）。

**J-5. 扫描边伪影剔除（`scannerEdgeStrip` 227–257、`markEdge` 1884–1894）**

判定条件极严（边缘 uniform ≥0.98、neutral ≥0.98、median 在 [80,220]、内侧两条边 nearWhite ≥0.98、与真实墨线 P90 差 ≥24）。**误删真实轮廓的风险极低**，而收益是消除 JPG/截图最外沿那条孤立灰线。

**J-6. detail 模式的暗部加权 + 局部反差锐化（2168–2173、2262–2282、2376–2400）**

- 暗部加权：`darkWeight/totalWeight ≥ 0.24` 时按 `min(0.55, 0.18+(ratio-0.24)*0.9)` 混入暗部均值，避免黑色被均值冲淡
- 局部反差：与 4 邻域均值做 `±0.38`（亮差 ≥8）或 `±0.18` 的反差增强
- **明确不使用抖动**，理由是「避免近看出现彩色噪点」——这是个正确的产品判断，值得沿用到 libms

**J-7. contain / cover 的代价披露（`fitGeometryMetrics`，geometry.js:82–104）**

输出 `letterboxFraction` / `cropFraction` / `contentCols` / `contentRows`，把「留白多少」「裁掉多少」变成**可显示给用户的数字**，而不是静默处理。与我方「不要静默夹取用户输入」的教训同向。

**J-8. EXIF 换向判定（`orientedSourceDimensions`，geometry.js:69–80）**

用 `|log(decodedAspect / rawAspect)|` 与交换后版本比较，取误差小者并返回 `orientationSwapped` 标志。**比「看宽高谁大」稳健**，且把判断结果显式回传。

**J-9. OKLab 预筛 + CIEDE2000 精配的两级加速（2084–2097）**

先用 OKLab 欧氏距离插入排序取 top-32，再对这 32 个算完整 CIEDE2000。作者自述理由：全量 CIEDE2000 对 4MP 图片代价过高；32 个候选把漏掉全局最近色的概率降到可忽略。libms 的 `palette-engine` 可以借鉴这个分级（若尚未这么做）。平票时按 `index` 升序决胜 → 保证确定性。

**J-10. 确定性（无随机种子）**

`docs/algorithm.md` 明确：「There is no random k-means seed.」同输入 → 同输出，逐格可比。这对 A/B 测试与我方冻结快照基线都是**必要前提**。移植的任何替代实现都必须保持这一点。

---

## K. 不建议采用的算法

**K-1. `convertPixels.toString()` 塞进 Blob Worker（app.js:2530）**

```js
const source = `self.onmessage=function(event){try{const result=(${convertPixels.toString()})(event.data);...`;
```

- 脆弱：函数一旦引用任何外部标识符就运行时才炸
- 副作用：**迫使 `convertPixels` 内部重复定义一整套颜色空间函数**（1777–1807），与文件顶层的 638–688 版本重复约 120 行
- 无法 tree-shake、无法静态分析、无法单测（单测里没有 Worker）
- libms 侧应使用正常 ESM `import`，Worker 作为**可选**执行策略（`InlineRunner` / `WebWorkerRunner` 双 Adapter，原架构文档 D 节自己也这么规划）

**K-2. 5-bit 粗桶 LUT（`coarseCache`，2068、2074–2079）**

```js
const coarseCache = fineMatching ? null : new Int16Array(65536).fill(-1);
const bucketR = fineMatching ? r : r >> 3;                       // 丢掉低 3 bit
const matchR  = fineMatching ? r : Math.min(255, bucketR*8+3.5); // 用桶中心代替真值
```

- **会用桶中心色代替真实颜色做匹配 → 最多引入 ±4/255 的色偏**，且偏在桶边缘最明显
- `forceNeutralOverride` 用**同一个数组**偏移常量 32768 区分（2076），而 `Int16Array(65536)` 的合法下标是 0–65535 → `32768 + 32767 = 65535` 恰好贴边，**任何 key 计算变化都会越界**
- 卡通/文档模式本就逐源像素投票（每次调用都是新颜色），缓存命中率低
- libms 的 `palette-engine` 直接匹配，无此问题。**不采用**

**K-3. cartoon 模式的 1–2 格噪点清理门槛过保守（app.js:2402–2429）**

```js
if(component.length>2 || component.some(p => cellSupport[p] >= .42)) continue;   // 只清 ≤2 格
...
if(bestCount >= component.length + 2) for(...) grid[position] = replacement;      // 邻居票数还要够多
```
三重条件叠加后，**大量 2 格以下的边缘杂色实际清不掉**。libms 的 `smart-cleanup-v2` 有 tier + 源证据双判据，更完整。**不采用 BGS 版本**。

**K-4. `analyzeSourceComplexity` 的硬编码阈值（app.js:352–355）**

```js
const likelyDocument = nearWhiteRatio>=.48 && edgeDensity>=.03 && darkRatio<.30 && documentTexture && documentScore>=.60;
const likelyPhoto    = !likelyDocument && quantizedColorCount>=42 && flatPairRatio<.76;
```

- 数值无出处、无标定文档，四张阈值同时命中才分类，**可解释性差**
- `colorBins` 只取 `r>>5`（3 bit/通道，512 桶），「量化色数」在 42 这种小阈值附近**分辨率不足**
- `documentScore` 的权重（1.25 / 2.1 / 2.4 / 1.5 / 0.18 / 0.45）无推导
- **可以采用「分类」这个想法，但阈值必须在 libms 侧重新标定并写成具名常量**

**K-5. 几何层的静默 clamp（geometry.js:11–38、40–67）**

```js
export function gridForLongSide(width, height, longSide, minSide = 4, maxSide = 160) {
  const longest = Math.round(clamp(longSide, minSide, maxSide));   // ← 静默改写
  ...
  return { cols: Math.round(clamp(cols, minSide, maxSide)), rows: ... };  // ← 再夹一次
}
```

**与 libms 已确立的规则正面冲突**：`docs/BLANK_BOARD_SIZE_FIX.md` 记录了「任何用户输入尺寸的地方都不要静默夹取——用户看到的摘要是唯一线索，夹取后无法察觉自己拿到的是另一个画板」。

移植时**必须去掉 clamp，改为返回 `{cols, rows, clamped: true, reason}` 由调用方决定报错还是接受**。`ratioLimited` 标志是个好设计，应扩展为完整的越界原因。

**K-6. document 模式的黑箱多分支决策（app.js:2227–2256）**

```js
if(!(textTexture && !continuousRule && !solidColor && !solidFill)){
  if(continuousRule||coherentEdge||solidInk){ ... }         // → 轮廓色或主彩度色
  else if(solidColor && dominantSaturated>=0){ ... }        // → 主彩度色
  else if(solidFill && documentColorWeight>.02){ ... }      // → 非白区线性光均值
  else if(whiteMode==='keep' && totalWeight>.02){ ... }     // → 全格线性光均值
}
```

- 四层嵌套分支 + 6 个 magic 系数，**任何一个出问题都很难定位**
- `confidence` 的三种取法（`max(darkCoverage,longRun,coherence)` / `max(saturatedCoverage,dominantSupport)` / 常数 0.25）量纲不统一
- 建议：**只借用「结构张量相干性 + 最长暗 run」这两个特征量**，决策树在 libms 侧重写为显式规则 + 诊断

**K-7. `LEGACY_TO_MARD` 旧色卡迁移映射（app.js:695–699）**

为老用户项目文件兼容而存在（原项目在开源前有自己的 64 色编辑器）。libms 没有这批用户，**无意义**。

**K-8. 大量无出处的魔数**

`1.66` / `1.15` / `105` / `58` / `24` / `22` / `0.55` / `0.42` / `0.30` / `0.075` / `40`（锚点惩罚）/ `2.2`（色度惩罚）……

这些是**针对该项目的测试图库调出来的**，直接搬到 libms 的图片分布上**不一定成立**。移植原则：**保留公式结构，系数全部提到具名配置常量并标注「需在 libms 图库上重新标定」**。

**K-9. 用户可见的 "Bead Grid Studio / 豆格工坊" 品牌**

见 L 节的商标条款——不得暗示关联或背书。技术标识符 `bgs` 可用，**用户可见文案必须写成「算法参考自开源项目 bead-grid-studio」这类中性表述**。

---

## L. Apache-2.0 来源与 NOTICE / 署名义务

### L-1. 来源事实

| 项 | 值 |
|---|---|
| 仓库 | `https://github.com/zwhy149/bead-grid-studio` |
| 版本 | v1.2.0（`package.json`） |
| 许可证 | **Apache License 2.0**（`LICENSE`；`package.json` `"license": "Apache-2.0"`） |
| 版权人 | `Copyright 2026 Bead Grid Studio contributors` |
| 是否带 NOTICE | ✅ 有（`NOTICE`，2858 字节） |
| 决策记录 | `docs/adr/0003-apache-license.md` |
| 商标声明 | ✅ 有（`TRADEMARKS.md`） |

`NOTICE` 的核心内容：

```
Bead Grid Studio / 豆格工坊
Copyright 2026 Bead Grid Studio contributors

This product includes MARD-compatible color data derived from:
  maxcleme/beadcolors
  https://github.com/maxcleme/beadcolors
  pinned data commit 94b99999652866f1a1879d6369fe735f811949e5

The upstream dataset is distributed under the MIT License:
  Copyright (c) 2020 maxcleme
  ...（MIT 全文）...

The third-party license permits use of the data. It does not imply that MARD or
any other bead manufacturer is affiliated with or endorses this project.
```

在其 `NOTICE` 之外，源文件注释还给出了色卡数据的 pinned commit：

```js
// src/palettes/mard221.js:1-4
/** Versioned palette catalog for the community edition.
 *  Data provenance: maxcleme/beadcolors@94b99999652866f1a1879d6369fe735f811949e5 (MIT). */
export const MARD_PALETTE_SOURCE = 'maxcleme/beadcolors@94b99999652866f1a1879d6369fe735f811949e5';
```

### L-2. Apache-2.0 §4 施加给 libms 的义务

移植的是**代码**，因此 §4 全部适用。逐条落地要求：

| 条款 | 要求 | libms 需做的动作 |
|---|---|---|
| **§4(a)** 随附许可证 | 必须给任何收到作品的人一份 Apache-2.0 副本 | 在 `src/algorithms/bgs/` 放 `LICENSE-APACHE-2.0.txt`；在「关于」页 / `docs/` 注明本模块含 Apache-2.0 代码 |
| **§4(b)** 修改声明 | 修改过的文件必须带显著声明，说明改了什么 | **每个移植文件头加注释**，形如：<br>`Derived from zwhy149/bead-grid-studio v1.2.0 (Apache-2.0), src/app.js convertPixels(). Modified for libms-studio: removed closure state, split into pure helpers, externalized thresholds.` |
| **§4(c)** 保留声明 | 必须保留全部版权、专利、商标、署名声明 | 不得删除原文件头里的版权与 provenance 注释；移植后的文件头**同时保留原声明** |
| **§4(d)** NOTICE 传递 | 若原作品含 NOTICE，分发衍生作品时**必须**在自方 NOTICE 中包含其内容 | libms 需新增/扩展 `NOTICE`（或 `docs/THIRD_PARTY_NOTICES.md`），**完整转载 BGS 的 NOTICE 内容**，包括其中 maxcleme/beadcolors 的 MIT 全文 |
| **§5** 贡献 | 除非显式声明，提交给项目的贡献按 Apache-2.0 授权 | 无关（我们不向其提交） |
| **§6** 商标 | 许可证**不授予**商标使用权 | 不得使用 "Bead Grid Studio"、"豆格工坊" 或其 logo 作 libms 的品牌/名称/宣传；不得暗示官方关联或背书（见 K-9） |

**关键判断：Apache-2.0 不是 copyleft。** 不要求 libms 开源其余代码，允许把衍生作品放进专有/闭源产品，也允许改用其它许可证分发衍生作品。**但 §4 的署名与 NOTICE 义务不因再许可而消失。**

### L-3. 色卡数据是独立的 MIT 来源（重要区分）

`mard221.js` 里的 221 色 hex 串**不是** BGS 的原创内容，而是从 `maxcleme/beadcolors`（**MIT**，pinned commit `94b99999…`）派生的。

- 若**直接复制这份色卡数据** → 需同时满足 **MIT**：保留 `Copyright (c) 2020 maxcleme` + MIT 许可全文
- **libms 已有自己的 `smart-preprocessing/palette-data.mjs`** 与 `services/palette-service.js` → **不需要复制 BGS 色卡数据**

**建议的移植边界（义务最小化）**：

```
✅ 移植：算法代码（Apache-2.0 → 履行 §4(a)(b)(c)(d)）
❌ 不移植：mard221.js 的色卡数据串（避免叠加 MIT 义务）
❌ 不移植：catalog.js 的 provider 注册表（依赖其色卡单例）
❌ 不移植：LEGACY_64_DATA（对 libms 无意义）
```

这样：libms 侧只需履行 Apache-2.0 §4，并在 `NOTICE` 中**转述** BGS NOTICE 提到的色卡来源（因为该段在 BGS NOTICE 里，§4(d) 要求一并转载）。

> ⚠️ 若后续决定**同时**复制色卡数据，则必须把 `Copyright (c) 2020 maxcleme` 与 MIT 全文也加进 libms 的 `NOTICE`——**这条路建议避免**，因为 libms 的色卡体系已独立成型。

### L-4. 建议写入 libms 的署名块

`src/algorithms/bgs/NOTICE`（新增文件）：

```
This directory contains code derived from:

  Bead Grid Studio / 豆格工坊
  https://github.com/zwhy149/bead-grid-studio
  Version 1.2.0
  Copyright 2026 Bead Grid Studio contributors
  Licensed under the Apache License, Version 2.0

Modifications for libms-studio (里白造物拼豆图纸生成器):
  - extracted the conversion core from a browser IIFE closure into pure ESM functions
  - removed all DOM / Canvas / Worker / i18n / UI dependencies
  - externalized hard-coded thresholds into named configuration constants
  - removed the Blob-Worker toString() serialization in favor of standard ESM imports
  - removed the legacy 64-color palette migration mapping
  - removed silent size clamping in favor of explicit out-of-range reporting
  - added an options-driven public entry point: convertImageToBeads(imageData, options)

The upstream NOTICE file, reproduced as required by Apache License 2.0 §4(d):

  ——————————————————————————————————————————————
  Bead Grid Studio / 豆格工坊
  Copyright 2026 Bead Grid Studio contributors

  This product includes MARD-compatible color data derived from:
    maxcleme/beadcolors
    https://github.com/maxcleme/beadcolors
    pinned data commit 94b99999652866f1a1879d6369fe735f811949e5

  The upstream dataset is distributed under the MIT License:
    Copyright (c) 2020 maxcleme
    ...（MIT 全文，逐字转载）...

  The third-party license permits use of the data. It does not imply that MARD or
  any other bead manufacturer is affiliated with or endorses this project.
  ——————————————————————————————————————————————

Note: libms-studio does not use the "Bead Grid Studio" / "豆格工坊" name or marks,
and claims no affiliation with or endorsement by that project, in accordance with
Apache License 2.0 §6.
```

配套动作：
1. 复制 `LICENSE` 到 `src/algorithms/bgs/LICENSE-APACHE-2.0.txt`（逐字）
2. 在 libms 根 `NOTICE`（若尚无则在 `docs/THIRD_PARTY_NOTICES.md`）中加一节指向该目录
3. 若 libms 站内有「关于 / 开源致谢」页面，加一行中性表述：「部分图像转换算法参考开源项目 Bead Grid Studio（Apache-2.0）」

---

## 审计小结

**该搬的**：小线稿拓扑保护（J-1）、内容分类与 document 模式（J-2）、精确色号直命中（J-3）、Otsu 自适应暗阈值（J-4）、扫描边伪影剔除（J-5）、detail 模式无抖动锐化（J-6）、几何代价披露与 EXIF 判定（J-7/J-8）。

**不该搬的**：采样、色板匹配、颜色空间、降色、清理、相近色合并（libms 版本均更完善）；粗桶 LUT（K-2）；Blob Worker `toString()`（K-1）；静默 clamp（K-5）；旧色卡映射（K-7）。

**已搬过的（C2/C3）**：强调色保护、自动留空背景、自动裁边——不要重复移植。

**法务**：Apache-2.0 无 copyleft，可以闭源使用衍生代码，但 **§4(a)(b)(c)(d) 四项署名/NOTICE 义务 + §6 商标禁用** 必须履行；**不复制色卡数据**可把 MIT 义务降到只需转述。

---

*审计完成。下一步见 `src/algorithms/bgs/README.md` 与 `docs/ALGORITHM_AB_TEST.md`。*
