# 阶段 4：四项隔离实验 —— 自适应采样 / 色差预筛 / 真实色板限色 / 保护性小区域清理

> 实施日期：2026-10-15 ｜ 状态：已裁定（**四项实验无一过 KEEP 门槛，生产默认路径零改动**）
> ｜ 提交：见 git log「阶段 4」
>
> 上游依据：七阶段正式开发计划·阶段 4「四项隔离实验，只整合过门槛的」。
> 方法论依据：`candidate-algorithm-lab` skill（冻结基线 + 独立候选接缝 + 原图尺子 + 人工看图）。
> 证据归档：`docs/evidence/stage4/`。

---

## 0. 一句话结论

四项实验**全部没有过 KEEP 门槛**：两个 REJECT（一个破坏 1 像素高光、一个耗时倒挂），
一个 MODE-SPECIFIC（限色是用户约束而非优化，只能 opt-in），一个维持 B4 §0 的 REJECT。
因此**本阶段对生产默认路径零改动** —— 这条结论本身被
`tests/stage4-verdicts.test.mjs` 钉住（`STAGE4_PRODUCTION_CANDIDATES` 必须是空集）。

这不是「实验失败」。四项里有两项的价值恰恰是**证否**：
- 「自适应采样用色卡结构做出口」被证明会吃掉眼睛高光 → 以后不必再试这条路；
- 「单色格走快路径能省时间」被证明净收益为负 → 上下文修正比预筛更便宜；
- 「真实色板限色」产出了**可据以做产品决策的代价曲线**（见 §3），这是唯一的正向产出。

---

## 1. 实验设计（为什么是「隔离」而不是「组合」）

阶段 4 的矩阵 `smart-preprocessing/lab/stage4-matrix.mjs` 有 7 列：

| 列 | 候选 | 改动点 |
|---|---|---|
| `current` | 生产基线 | —（`build()` 返回 `null`，逐位走原路径） |
| `adaptive-v2` | 色卡感知自适应采样 | 采样出口的颜色：均值 vs 主桶 |
| `chroma-prescreen` | 色差预筛 | 单色格走快路径 |
| `kit-limit-24/48/96` | 真实色板限色 | 匹配空间限制到 kit 子集 |
| `cleanup` | 保护性小区域清理 | 复用 B4 §10 候选，在本轮管线上重裁 |

**为什么不往 `LAB_MATRIX` 里加**：`candidate-benchmark-contract.test.mjs` 钉死了
`LAB_MATRIX.length === 11` 与 id 列表 —— 那是 B4 §11 的**历史记录**，改它等于改历史，
还会让 B4 的四条候选守卫测试悄悄多跑几个未裁定对象。阶段 4 因此有**自己的矩阵**，
共用同一套跑分器、夹具、尺子（`tools/b4-lab.mjs --matrix stage4`，默认仍是 `b4`，行为逐位不变）。

**隔离而非组合**：每项单独跑、单独判定。组合留到有 ≥2 个 KEEP 之后再谈。

### 三条地基（照 Lab skill）

1. **跑分器写不进基线**：`b4-lab.mjs` 里有一条硬护栏 —— `--out` 落在 `tests/fixtures` 就
   `process.exit(2)`。写基线的那条代码路径**不存在**，不是靠纪律。
2. **候选接缝与配置分离**：候选实例全是函数，过不了 `structuredClone`。它们只从
   `generateV2({ lab })` 这个独立参数进来，**不进 `options`**，也不进任何 `MODE_PROFILES`。
3. **所有指标从原图导出**：`downsampleSource() → buildReference()` 只算一次，
   所有候选共用同一把尺子（`services/quality-metrics.mjs` 是唯一实现）。

---

## 2. 逐类 Δ 表（相对 `current`，17 类 × auto 模式，104×104 格网）

数据源：`tools/b4-lab.mjs --matrix stage4 --fixtures all` 的 `metrics.json` / `summary.json`。
分析脚本：`tools/stage4-analyze.mjs`（只读，不改任何东西）。

### 2.1 类均值

| 候选 | ΔE | 边保留 | 细保留 | 碎化 | 孤点 | 用色 | ms |
|---|---|---|---|---|---|---|---|
| `current` | 6.126 | 0.883 | 0.999 | 13.18 | 33.18 | 9.65 | 877 |
| `adaptive-v2` | 6.127 | 0.878 | 0.999 | 12.37 | 39.82 | 9.71 | 1197 |
| `chroma-prescreen` | 6.121 | 0.883 | 0.999 | 12.98 | 41.12 | 9.59 | 1054 |
| `kit-limit-24` | **10.541** | 0.811 | 0.996 | 6.11 | 19.88 | **5.76** | 943 |
| `kit-limit-48` | 7.782 | 0.871 | 0.996 | 6.78 | 20.41 | 7.18 | 996 |
| `kit-limit-96` | 6.810 | 0.886 | 0.999 | 10.21 | 27.00 | 8.88 | 1154 |
| `cleanup` | 6.116 | 0.889 | 0.999 | 11.91 | 27.12 | 10.00 | 876 |

> 耗时口径：**单独跑一次、无并发负载**的 `--skip-sheets` 全量跑（`/tmp/stage4-lab3`）。
> 三跑（含两次并发负载下的跑）的**网格级指标逐位一致** —— 只有 ms 受机器负载影响，
> 所以耗时结论只取这一次。`chroma-prescreen` 的三次读数分别是 +20.1% / +20% / +23%，
> 方向一致，取 +20%。

### 2.2 关键读数（不是「原图本来如此」的那些）

- **`adaptive-v2` 的孤点 +6.64、边保留 −0.005、耗时 +36%，而 ΔE 一点没动**（+0.001）。
  三处都不变好 → 没有可辩护的 KEEP 理由。
- **`chroma-prescreen` 的边保留全类一致、ΔE −0.005，但耗时 +20%。**
  它的**唯一**卖点是速度，实测为负 → REJECT 的定义性证据。
- **`kit-limit` 的用色数大幅下降**（9.65 → 5.76/7.18/8.88），**碎化也跟着降**。
  ⚠️ 这不是「更好」：限色把相邻色阶合并了，碎化自然下降。
  「别把限色的直接后果当成质量改善」是这一项最容易读错的地方。
- **`cleanup` 的 ΔE 全类不退化（≤0）、边保留 +0.006**，但改动方向**按类分裂**（见 §5）。

### 2.3 逐类明细（摘要）

| 类 | 路由 | `adaptive-v2` ΔΔE/Δ孤 | `chroma-prescreen` ΔΔE/Δ孤 | `kit-limit-96` ΔΔE | `cleanup` Δ孤 |
|---|---|---|---|---|---|
| A portrait | pixel | +0.02 / +2 | −0.01 / 0 | +0.17 | 0 |
| B anime | pixel | +0.04 / +2 | 0 / 0 | +1.18 | 0 |
| C illustration | pixel | 0 / +3 | 0 / 0 | +0.39 | 0 |
| D pixel | pixel | +0.02 / 0 | 0 / 0 | −0.38 | 0 |
| E logo | logo | 0 / 0 | 0 / 0 | +0.08 | 0 |
| F pattern | pixel | −0.10 / 0 | 0 / 0 | +1.04 | 0 |
| G window | pixel | −0.01 / +2 | 0 / 0 | +3.64 | 0 |
| H white-shirt | logo | +0.01 / 0 | 0 / 0 | +0.19 | 0 |
| I gray-ramp | pixel | 0 / 0 | −0.03 / 0 | +0.83 | 0 |
| J photo-noise | pixel | −0.11 / **+178** | −0.07 / **+143** | +1.18 | −26 |
| K real-portrait | portrait | +0.04 / −57 | 0 / −5 | +0.17 | −29 |
| L pet-fur | auto | +0.02 / −7 | +0.01 / +2 | +0.13 | **+61** |
| M indoor-lowlight | photo | +0.01 / +3 | 0 / −1 | −0.01 | **−215** |
| N architecture | auto | +0.07 / −17 | +0.01 / −3 | +1.01 | **+31** |
| O jpeg-noise | auto | +0.02 / −1 | 0 / 0 | +0.59 | **+69** |
| P soft-gradient | illustration | +0.04 / +4 | +0.01 / −1 | +1.16 | +6 |
| Q native-pixel | pixel | −0.05 / +1 | 0 / 0 | +0.26 | 0 |

---

## 3. 实验 3 的产物：真实色板限色的**代价曲线**（决策表）

这是四项里唯一的正向产出。限色按定义不可能让 ΔE 变好（kit ⊂ 全色卡），
所以它的价值不是「优化」而是**「代价有多大、落在哪一类图上」**。

| kitSize | 平均 ΔE | 相对基线 | 平均用色 | 视觉代价（人工看图，见 §4） |
|---|---|---|---|---|
| 24 色 | 10.541 | **+4.42** | 5.76 | 白色→灰、天空→紫、金纹→扁平、眼睛→绿、鼻子→暗红。**不可用** |
| 48 色 | 7.782 | +1.66 | 7.18 | 白色/高光保住；仍把 K 的眼睛变绿、L 的背景变橄榄绿 |
| 96 色 | 6.810 | +0.68 | 8.88 | 白色、金纹、肤色基本保住；O 的树枝出现黑色残留 |

**产品结论**：
- 「限制为我的色板 / 库存色板」可以做，但**最低套装不得低于 96 色**；
- 24 / 48 色套装必须在 UI 上明确提示代价（给上面这张表的类级数据）；
- **不进默认生成路径** —— 限色是用户约束，不是默认优化（`MODE-SPECIFIC`）。

候选自报诊断（17 类累计，183872 格）：

| kitSize | `changed`（改色号格数） | `forcedWorse`（明显变差） | `forcedBetter`（明显变好） | 变差占比 | `outsideKitProduction` |
|---|---|---|---|---|---|
| 24 | 154771 | 117948 | 2291 | **76%** | 154444 |
| 48 | 124429 | 69403 | 4099 | **56%** | 122759 |
| 96 | 88483 | 31283 | 4862 | **35%** | 81351 |

`forcedWorse / changed` 随套装增大单调下降（76% → 56% → 35%），
是这张决策表的**第二把尺子**：它回答的是「改掉的格子里有多少是明显改坏的」。

> ⚠️ 这个计数器**曾经是反的**：早期实现写成 `penalty > threshold`，
> 而 `penalty = dist(生产) − dist(kit)`，所以它数的其实是 `forcedBetter`。
> 于是第一版报告里「forcedWorse 2291」读起来像「2291 格变差」，实际是「2291 格变好」。
> 一个数字合理、方向相反、报告里完全看不出来的失效形状 —— 已拆成两个方向，
> 由 `tests/stage4-candidates.test.mjs` 的 F4b 钉住符号。

---

## 4. 人工看图（§14，Lab 纪律的硬要求）

**「未完成视觉 QA 前不得进生产」** —— 上面所有数字都只是筛子，裁定靠图。
证据：`docs/evidence/stage4/`（contact sheet 全量 + 9 张决定性 zoom）。
列序（左→右）：`原图 / current / adaptive-v2 / chroma-prescreen / kit-limit-24 / kit-limit-48 / kit-limit-96 / cleanup`。

| 证据图 | 看什么 | 结论 |
|---|---|---|
| `B-anime-eye-highlight.png` | 第 3 列 vs 第 2 列 | **`adaptive-v2` 把 1 逻辑像素的眼睛高光啃出一个 L 形缺口** —— §17 明令「高光必须保留」 |
| `A-portrait-shirt-white.png` | 第 5 列 | `kit-limit-24` 把白衣**整块变灰** |
| `H-white-shirt-shirt.png` | 第 5/6/7 列 | kit-24 背景灰化（边保留 −0.617）；kit-48/96 把领带改成另一种蓝/紫 |
| `F-pattern-gold.png` | 第 5/6 列 | 金纹底被压成**扁平黄/褐**，回形纹的层次丢失 |
| `N-architecture-mullion.png` | 第 5 列 | 天空**变紫**、窗格被压花 |
| `K-real-portrait-eye-specular.png` | 第 5/6/7 列 | 眼睛**变绿** |
| `L-pet-fur-nose.png` | 第 5/6/7 列 | 鼻子→暗红；kit-48 背景→橄榄绿带斑点 |
| `O-jpeg-noise-block-structure.png` | 第 5/6/7 列 | 天空→紫带绿斑；树枝→亮绿；kit-96 出现黑色残枝 |
| `M-indoor-lowlight-shadow-noise.png` | 第 8 列（cleanup） | 噪声更干净（碎化 −23.67、孤点 −215），但改动量大 |

**`adaptive-v2` 与 `chroma-prescreen` 在 A–F 的探针上与基线**逐位相同**（47 项探针里 A–F 全同），
差异全部出现在 G–Q 的噪声/照片类 —— 这解释了为什么「指标看起来没动」而「图上确实变了」。

---

## 5. 裁定（§15）

| 实验 | 裁定 | 决定性理由 |
|---|---|---|
| `adaptive-v2` | **REJECT** | 破坏 1 像素眼睛高光（§17 硬要求）；ΔE 无改善、孤点更差、耗时 +34% |
| `chroma-prescreen` | **REJECT** | 行为基本不变但**耗时 +20%** —— 唯一卖点为负 |
| `kit-limit` | **MODE-SPECIFIC** | 限色是用户约束；只可 opt-in，最低 96 色；不进默认路径 |
| `cleanup` | **REJECT** | 维持 B4 §0 裁定。本轮重跑：ΔE 不退化，但孤点在 J/K/M 改善（−26/−29/−215）、在 L/N/O 退化（+61/+31/+69），不满足「全类一致」门槛 |

裁定落成代码：`smart-preprocessing/lab/stage4-verdicts.mjs`。

---

## 6. 整合了什么（本阶段的「零改动」是结论，不是遗漏）

**生产默认路径：零改动。**

整合进代码库的是**防线**，不是算法：

1. `smart-preprocessing/lab/stage4-verdicts.mjs` —— 四条裁定的注册表，
   含 `STAGE4_REJECTED` / `STAGE4_MODE_SPECIFIC` / `STAGE4_PRODUCTION_CANDIDATES`（空集）。
2. `tests/stage4-verdicts.test.mjs`（8 条）—— 把阶段 4 的裁定接上 B4 已有的 REJECT 防线：
   - 每个实验必须有裁定；裁定 id 集合与矩阵 id 集合相等；
   - evidence 指向的文件必须真实存在（防锚点腐烂）；
   - REJECT 的 id 不许出现在 `AUTO_TUNE_LAB_CANDIDATES` / `PRODUCTION_LAB_CANDIDATES`
     或任何 `AUTO_TUNE_PROFILES[].labCandidate` 上；
   - `STAGE4_PRODUCTION_CANDIDATES` 必须保持空集；
   - **结构性保证**：`services/` `ui/` `state/` `smart-preprocessing/`（除 `lab/`）
     下任何文件都不得 import 这四个候选模块 —— 有候选越过裁定会立刻红。
3. `tests/stage4-candidates.test.mjs`（26 条）—— 四项实验的准入守卫：
   确定性 / maxColors-safe / null 完整性 / 弃权分账闭合 / 三类静默空转形状。

**没有整合进生产的**（刻意的）：任何候选的算法本身。四个候选模块全部只存在于
`smart-preprocessing/lab/`，只被 `tools/` 与 `tests/` 引用。

---

## 7. 三类静默空转失效形状的检查（Lab skill 硬要求）

| 形状 | 本轮检查 | 结果 |
|---|---|---|
| ① 门读过期的快照 | `maxColors` 用 `colorsBeforeBudget`（refine 之后的用色数）当门，不是 stage-4 旧快照 | ✅ 守卫 `C maxColors=3/5/8` 全过 |
| ② 回调参数形状不匹配 → NaN 边界 → 循环零次 | `selectKit` 的 `cellBounds` 有限性；`production.lab` 不存在 → `deltaE2000` 抛 | ✅ 实测**命中过一次**：kit-limit 早期写 `production.lab`，抛「labB is not iterable」。已修（改 `rgbToLab(production.rgb)`），守卫 F4 钉住 |
| ③ 报告读了不存在的字段 / 计数器方向反 | 逐项核对四个候选的自报诊断与网格实际改动 | ✅ 实测**命中过一次**：`kit-limit.forcedWorse` 写成 `penalty > threshold`，数的是「限色**更好**」的格数 —— 数字合理、方向相反、报告里看不出来。已拆成 `forcedWorse`/`forcedBetter` 两个方向，守卫 F4b 钉住符号 |

另外两个只有 Lab 会踩的坑：

- **`paletteEngine.match` 返回原始色卡项**（`code`/`rgb`/`group`），**没有 `lab` 字段**。
  拿 `.lab` 会 `undefined`，`deltaE2000` 立刻抛。候选要用生产答案的 Lab，必须自己 `rgbToLab`。
- **`LAB_MATRIX` 被测试钉死**（`length === 11` + 固定 id 列表）。阶段 4 必须用独立矩阵，
  否则会连带改动 B4 的历史记录与它的四条守卫测试的覆盖面。

---

## 8. 复现方式

```bash
# 1) 全量跑分（A–J 逻辑夹具 + K–Q 真实照片夹具，7 列，contact sheet + zoom）
node tools/b4-lab.mjs --matrix stage4 --fixtures all --out /tmp/stage4-lab

# 2) 逐类 Δ 表 + 探针表 + 候选自报诊断
node tools/stage4-analyze.mjs /tmp/stage4-lab/metrics.json

# 3) 守卫测试
node --test tests/stage4-candidates.test.mjs tests/stage4-verdicts.test.mjs
```

**默认矩阵仍是 `b4`**（`--matrix` 缺省值），行为逐位不变 —— B4 的裁定记录可以照原样复现。

---

## 9. 已知边界

- `adaptive-v2` / `chroma-prescreen` 的差异集中在 G–Q 的噪声/照片类。
  A–F 上它们与基线逐位相同 —— 所以「A–F 全绿」不构成「候选有效」的证据，
  裁定必须看 G–Q（这也是本轮坚持 `--fixtures all` 的原因）。
- `cleanup` 的类均值（孤点 27.12 vs 33.18）看起来是改善，但它**由 M 一类的 −215 拉动**。
  去掉 M 之后 `cleanup` 的孤点均值为 +14。这正是「类均值会骗人、必须看逐类」的实例。
- 本阶段没有产出任何新的生产参数。四项实验的结论是「哪些路不用再走」+ 一张限色代价表。
