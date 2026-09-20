# Batch E 验证与交接（2026-09-18）

本批来源需求：分析开源项目 [`zwhy149/bead-grid-studio`](https://github.com/zwhy149/bead-grid-studio)
（Apache-2.0，Bead Grid Studio / 豆格工坊 v1.2.0），提取其中「图片 → 拼豆颜色矩阵」的**纯算法**，
作为**独立模块**并入 libms，并保留两套算法供人工对比。

用户明确边界：**不复制这个项目、不复制它的 UI**、第一阶段不改现有代码、
**不要立即替换现有算法**、**不要自动决定哪套算法更好**。

- 分析报告：`ALGORITHM_AUDIT.md`（A–L 十二节）
- 算法模块：`src/algorithms/bgs/`
- A/B 工作流：`docs/ALGORITHM_AB_TEST.md`
- 版本查询串：`?v=20260918-usage2` → **`?v=20260918-bgs1`**（根目录与 `deploy/` 已同步）

---

## 交付物

| 项 | 位置 |
|---|---|
| A–L 算法审计 | `ALGORITHM_AUDIT.md` |
| 纯算法模块（12 个源文件） | `src/algorithms/bgs/{index,config,color-space,geometry,raster,analyze,matcher,sampling,topology,refine,statistics,ab-test}.mjs` |
| 可执行 A/B 脚本 | `src/algorithms/bgs/ab-run.mjs` |
| 授权与署名 | `src/algorithms/bgs/{LICENSE-APACHE-2.0.txt,NOTICE,README.md}` |
| 算法引擎开关 | `app.js`（`algorithmEngine`）+ `ui/workspace.js`（顶部「算法」下拉） |
| A/B 桥接接口 | `window.LibmsWorkspaceBridge.runAlgorithmAbTest()` |
| 单测 | `src/algorithms/bgs/{bgs-core,bgs-pipeline,ab-run}.test.mjs` |
| 报告产物 | `docs/ALGORITHM_AB_TEST_REPORT.md`、`docs/algorithm-ab-report.json` |

---

## 1. 算法引擎开关：`current` / `bgs`

设计要点：这是与 `generationEngine`（`v2.5` / `legacy`）**正交的第二条轴**，
不是它的第三个取值——两者组合有 2×2 种语义，混在一个下拉里会讲不清。

- `state.algorithmEngine`（默认 `"current"`）；`state.algorithmEngineLast` 记「上一次实际跑的是谁」。
- `processImage()` 第一行分流：只有显式选到 `bgs` 才走新模块，**否则完全落进原有分支**。
  因此不切 bgs 时，全站行为与以前逐位一致（既有 346 项测试全绿即证据）。
- `processProductionBgs()` 与 `processProductionV2()` 完全平行：同一条源图准备
  （`loadProductionRaster()`，共用 `sourceTransform`）、同一个调色板、同一组尺寸/颜色上限，
  唯一区别是最后把 imageData 交给 `convertImageToBeads`。
- 纯矩阵 → `state.grid`：`gridFromBgsMatrix()` 按色号映射回 libms 色对象，
  **未知色号不静默吞掉**，计数写进 `state.bgsReport.unknownCodes`（实测恒为 0）。
- 收尾时清空 `smartFeatures` / `smartReport`，避免把上一轮 V2.5 的诊断误读成本轮 bgs 的。

### 顺带修掉的既有缺陷

`state.generationEngineLast` 只在 V2.5 链路里写过。走 legacy 分支后诊断报告仍显示 `v2.5`。
本批在 legacy 收尾处补上 `generationEngineLast = "legacy"`，并同步写入
`algorithmEngineLast = "current"`——否则「切回 current 再生成」会让记分牌停在 `bgs`。
（浏览器验收里那条「记分牌跟着最后一次实际运行走」就是钉这个的。）

---

## 2. A/B 对比器

`compareEngines()` / `compareMatrices()`（`ab-test.mjs`）+ 浏览器桥接 `runAlgorithmAbTest()`。

- `current` 一侧用 `generateV2`（生产 V2.5 同款）+ `buildV25Options()`——该函数是从
  `processImageV2` **原样抽出来**的，两边共用，杜绝手抄副本漂移。
- `bgs` 一侧用 `convertImageToBeads`。
- **两侧共享同一份 imageData**，所以差异只来自算法。
- 输出六项：使用颜色数量 / 孤立像素数量 / 边缘杂色数量 / 色差（CIEDE2000 + sRGB RMSE）/
  结构保持率 / 输出矩阵（另附逐格差异与方块字符预览）。
- **`verdict` 恒为 `null`**；对象里没有 `winner`、没有 `recommendation`、没有加权评分。
  这条有单测与浏览器断言双重钉死。

---

## 3. 本批踩到并修掉的两个真缺陷

### 3.1 色板「方言」串味（会让 A/B 完全失去意义）

libms 的 `palette-engine.mjs:135` 对色板条目的 `lab` 字段是**直接采信**的，
并按 CIELAB 语义使用；排序平票还看 `index`。而 bgs 的 `preparePalette()` 把
**OKLab** 放在 `lab`、把数组位置补进 `index`。

最初 `compareEngines()` 把 `preparePalette` 的输出交给了 `currentRunner`，
于是生产引擎拿到一份「bgs 方言」的色板。实测同一张合成图 96×96：

| 交给 `current` 的色板 | 用色数 | 色差 RMSE |
|---|---:|---:|
| 调用方原始色板 | 60 | 26 |
| bgs `preparePalette` 输出 | **30** | **190** |

**没有任何报错**，只是颜色悄悄变错。修法：`compareEngines()` 只把调用方的原始色板
交给 `currentRunner`。回归测试：`bgs-pipeline.test.mjs` 里断言 runner 收到的是
**同一个数组对象**（identity），且条目上不含 `lab` / `cieLab` / `position` / `index` / `transparent`。

### 3.2 自写 PNG 解码器把每一行清零

`ab-run.mjs` 的行缓冲拷贝方向写反了（`current.set(prior)` 应为 `prior.set(current)`），
导致每行像素写出前被清成 0 —— 整张图解码成全透明。单行夹具看不出来，
所以补的测试是**多行 + 覆盖 Sub/Up/Average/Paeth 四种滤波器**的。
已做「改回坏版本 → 3 项失败」的反证，确认测试真的抓得住。

另外顺手对齐了 CLI 与 App 的 `current` 配置：`generateV2` 少了 `preset:'auto'`
会让同一张图从 6 色变成 15 色（实测），所以 CLI 显式带上界面默认档位。

---

## 4. 验收结果

### 4.1 单元测试

```
node --test smart-preprocessing/*.test.mjs tests/ui-refactor-baseline/*.test.mjs src/algorithms/bgs/*.test.mjs
# tests 415  pass 415  fail 0
```

其中 bgs 自身 **69 项**（core 43 + pipeline 22 + ab-run 4）。既有 346 项无一回归。

### 4.2 浏览器端到端（源码根 + `deploy/` 各跑一遍）

脚本：`/Users/gongzhenyan/.workbuddy/binaries/node/workspace/scripts/libms-bgs-verify.mjs`

```
LIBMS_BASE=http://127.0.0.1:8792 → 36/36 通过
LIBMS_BASE=http://127.0.0.1:8793 → 36/36 通过
```

覆盖：开关存在且默认 current、默认生成仍走 V2.5、切 bgs 后生成成功、
纯矩阵色号 100% 命回色板（`unknownCodes = 0`）、A/B 六项指标齐备、
`verdict` 为 null、切回 current 可复现首次结果、以及
**「A/B 的 current 侧与 App 实际生成同色数 / 同豆数」**（这条是 3.1 的浏览器侧照妖镜）。
无本批新引入的 JS 异常与 404。

### 4.3 浏览器与命令行数字一致

同一张 `/tmp/libms-c-fixture.png`，48×48，MARD 221 色：

| 指标 | `current` | `bgs` |
|---|---:|---:|
| 使用颜色数量 | 6 | 6 |
| 孤立像素数量 | 0 | 0 |
| 边缘杂色数量 | 37 | 31 |
| 色差 CIEDE2000 | 2.881 | 6.003 |
| 色差 sRGB RMSE | 28.52 | 50.69 |
| 结构保持率 | 1 | 1 |
| 豆数 | 2304 | 576 |

两条入口（浏览器 `runAlgorithmAbTest()` / `ab-run.mjs`）**逐项相同**。
差异来源也说得清：`bgs` 把与边框连通的浅色背景留成了空豆（576 豆），
`current` 默认把背景也铺成豆（2304 豆）。

**不给出结论。** 两套算法都保留，选哪套由人看图决定。

---

## 5. 明确没做的事

- **没有替换现有算法**：`generationEngine` 两条分支一行未改（除 3 节所述记分牌修复）。
- **没有复制上游 UI / CSS / HTML / PWA / i18n / 导出界面 / 品牌元素**；
  唯一新增的界面是 libms 自己风格的一个下拉（顶部「算法」）。
- **没有复制上游色卡数据**：`options.palette` 必填，用 libms 自己的 MARD 色卡，
  因此不触发 `mard221.js` 的 MIT 义务（详见 `ALGORITHM_AUDIT.md` §L）。
- **没有采用**上游的 5 位分桶 LUT、Blob-Worker `toString()` 序列化、静默夹取、
  遗留 64 色映射表（见审计报告 §K）。
- **没有自动判定胜负**：`verdict` 恒为 `null`。

---

## 6. 已知遗留

- `app.js` 的 `NSFWJS_SCRIPT_URL` 路径仍失效（jsdelivr 404），图片内容审查长期未生效。
- `index.html:602` 的 `./your-reward-code.png` 仍缺文件（用户已明确暂不处理）。
- `@fontsource/maple-mono` 仍被 CSP `style-src` 拦下。
- `ab-run.mjs` 的 PNG 解码只支持 8 位非隔行；需要 WebP / JPEG / 隔行 PNG 时
  走浏览器入口（浏览器用原生解码）。
