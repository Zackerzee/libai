# Batch F 验收 · pindou-workbench 算法提取

上游：`https://github.com/beads9/pindou-workbench`（commit `26e806f`）
目标：**只研究与提取「图片 → 拼豆颜色矩阵」的底层算法**，不是复制网站。

- 阶段一审计 → `docs/algorithm-audit-pindou-workbench.md`
- 阶段六实验室实测 → `docs/BATCH_F_LAB_REPORT.md`

---

## 0. 一句话结论

六个阶段全部落地，**121 项新增单元测试 + 全仓 541 项测试全绿**，既有算法一行未删、既有 UI 行为未改、默认引擎仍是 `current`。

---

## 1. 上游真相：README 宣传的 5 个算法在代码里并不存在

`app.js` 只有 868 行，其中**真正承载算法的只有 207 行（`app.js:47–253`）**。审计用「把这段代码抽出来在 Node 里跑」的方式逐条实测，结论：

| 用户点名要求分析 | 上游是否有 | 处理 |
| --- | --- | --- |
| Sobel 3×3 | ✅ 有 | 忠实移植（`sobel3.js`） |
| K-means 降色 | ✅ 有（但忽略调用方色板） | 移植 + 修 4 个缺陷 |
| weighted RGB 距离 | ✅ 有（实测权重 R:G:B = 2:4:3） | 忠实移植 |
| 背景色估计 | ⚠️ 只有边框均值，没有 K-means | 均值照搬，K-means 标 `LIBMS_FILL` 补全 |
| 抠图 / 形态学 | ✅ 有（膨胀 + sum≥5 的多数腐蚀） | 移植，两种腐蚀口径都保留 |
| **Sobel 5×5** | ❌ 不存在 | 本仓库补全 |
| **多尺度 Sobel 融合** | ❌ 不存在 | 本仓库补全 |
| **边缘直方图** | ❌ 不存在 | 本仓库补全 |
| **Gaussian feather** | ❌ 只有 `config.feather` 一个**从未被读取**的数字 | 本仓库补全，真正接上羽化 |
| **主色提取** | ❌ 不存在（只有 K-means） | 本仓库补全（直方图 + 中位切分） |

所以 26 项里 **11 项存在、10 项同名不同实现、5 项纯属 README 夸大**。模块里每个常量都带 `origin` 标记：`upstream-port`（照搬）/ `libms-fill`（本仓库补）/ `mixed`。`PW_CONFIG_META` 共 49 个叶子，逐条可查来源与理由。

典型实测发现（写进了审计 §5）：

- K-1：`kMeansPalette(palette, k)` **根本不看传进去的 palette**，永远返回 MARD 色号 —— 传 HAMA 进去也给你 MARD。已修。
- S-2：边框均值在「主体贴边」时会被拉偏（实测背景估计被拉到 36.9）。已用「最外圈 + K-means 取最近簇」补一档。
- K-2：K-means 里 k 个质心落到同一个色上时**静默缩色板**，不报。已改成显式记 `duplicates`。
- 我最初的怀疑「形态学会裁掉 1px 边框」被实测否决 —— 膨胀是向外写的，边框反而被填回。审计里记为「不修，仅记档」。

---

## 2. 阶段二：模块结构

```
src/algorithms/pindou-workbench/
├── package.json                    # 只为了声明 type:module
├── config.js                       # 49 个可调常量 + 溯源元数据
├── index.js                        # 对外唯一入口
├── sampling/    cover-resize.js  grid-sampling.js
├── segmentation/sobel3.js sobel5.js multi-scale-edge.js
│                adaptive-threshold.js background-kmeans.js
│                morphology.js feather-mask.js
├── quantization/kmeans.js  dominant-colors.js
├── color/       weighted-rgb.js  palette-match.js
└── core/        pipeline.js  hybrid.js  lab.js  metrics.js  grid-stats.js
```

- **全部纯函数**，不碰 DOM / Canvas / state。Canvas 的 `drawImage` 边界用 `cover-resize.js` 的纯数学重采样替代。
- 色板永远由调用方传入，模块**不内置任何色卡数据**（也就不存在复制上游 MARD 表的问题）。
- 上游 README 声明 MIT 但仓库**没有 LICENSE 文件**，因此采取保守策略：不逐字复制任何上游代码，只借鉴算法思想。

## 3. 阶段三：四套引擎并存

`algorithmEngine` 现在有四个取值，默认 `current`：

| 值 | 走哪条路 | 默认 |
| --- | --- | --- |
| `current` | 现有 libms 链路（一行未改） | ✅ |
| `bgs` | `src/algorithms/bgs`（Batch E） | |
| `pindou-workbench` | 本次提取的 PW 管线 | |
| `hybrid-pw` | 混合管线（阶段五） | |

- UI：`ui/workspace.js` 的「算法」下拉新增两个选项（**只加选项，不动既有行为**）。
- `app.js`：`processImage()` 首行分流，只有显式选到新引擎才进新分支。
- 新增 `setPaletteMatchMode` / `getPwReport` / `runPwLab` 三个 bridge 方法。

## 4. 阶段四：色板匹配三档

`paletteMatchMode`：`original-weighted-rgb`（上游口径，仅作实验算法保留）/ `lab` / `ciede2000`（默认）。

既有保护**一个没删**：Linear RGB 采样、Lab 色差、maxColors、结构边缘保护、眼睛高光保护、孤立杂色清理、边缘杂色清理全部照旧，只是新引擎多了一种可选匹配口径。

跨引擎取色板时坚持**方言纪律**：pw 的 `preparePalette()` 显式产出 `cieLab` / `okLab` 两个字段，绝不复用 bgs 那套把 OKLab 塞进 `lab` 字段的色板 —— 串了不报错、颜色会悄悄错。

## 5. 阶段五：hybrid-pw 的顺序偏差已显式记录

用户要求的顺序是 `…→ maxColors → structure protection → …`，但**保护必须早于降色**，否则保护形同虚设。 therefore：

```
请求顺序（写进报告）：多尺度 Sobel → 结构 Mask → Linear RGB 采样 → CIEDE2000 匹配
                    → maxColors → 结构保护 → 高光保护 → 孤立清理 → 边缘污染清理
有效顺序（实际执行）：多尺度 Sobel → 结构 Mask → Linear RGB 采样 → CIEDE2000 匹配
                    → 保护扫描（结构+高光）→ maxColors(protectedKeys) → 孤立清理 → 边缘污染清理
```

两套顺序 + 偏差理由都写在 `diagnostics.pipelineOrder` 里，**不藏这个决定**。降色通过 `protectedKeys` 在计划构建期生效（不是 plan 后处理 —— 后处理会静默失效）。

## 6. 阶段六：三路并排（不判优劣）

`runAlgorithmLab()` 同一张图、同一份 `imageData`、同一套尺寸/色板/颜色上限，跑 CURRENT / PW ORIGINAL / HYBRID-PW。实测摘录（48×48，MARD 295 色，maxColors=12，源图 `images.png`）：

| 指标 | CURRENT | PW ORIGINAL | HYBRID-PW |
| --- | ---: | ---: | ---: |
| 实际用色数 | 2 | 6 | 12 |
| 平均 ΔE | 6.70 | 2.16 | 10.81 |
| P95 ΔE | 53.27 | 11.44 | 52.60 |
| 孤立单豆 | 0 | 180 | 93 |
| 2 豆小区 | 0 | 7 | 39 |
| 边缘杂色 | 6 | 201 | 145 |
| 轮廓保持率 | 46.9% | 100.0% | 87.9% |
| 高光保持率 | 99.5% | 100.0% | 1.9% |
| Dominant Ratio | 0.544 | 0.465 | 0.696 |
| 透明边缘污染 | 0 | 0 | 0 |

**不做任何判定。** `verdict` 恒为 `null`，报告里没有 winner、没有评分、没有推荐，只有十项读数 + 逐格差异 + 三张字符预览，交人工判断。完整报告见 `docs/BATCH_F_LAB_REPORT.md`。

（提示性观察，非结论：HYBRID-PW 的豆数少了 996 格，是因为它按前景掩码留白而 PW ORIGINAL 全填；读这组数字时先看「空豆数」那一行。）

## 7. 测试

```
node --test smart-preprocessing/*.test.mjs tests/ui-refactor-baseline/*.test.mjs src/algorithms/*/*.test.mjs
# tests 541 / pass 541 / fail 0
```

新增：`src/algorithms/pindou-workbench/pw-core.test.mjs`（90 项）+ `pw-pipeline.test.mjs`（31 项）。

## 8. 修掉的 3 个真实 bug（写测试时暴露的）

1. `core/hybrid.js` 与 `core/lab.js` 动态 import libms 模块时相对路径**少了一级** `../`，解析到 `src/smart-preprocessing/` —— 一跑到 hybrid 就 `Cannot find module`。
2. `resolveGrid()` 用 `Number(request.height)` 读轴，`Number(null) === 0`，把「没给高度」误判成「高度填了 0」，绕过了比例推导。改成 `null` / `undefined` / `""` 一律视为该轴缺失。
3. `cellBounds()` 在「栅格比格数小」时用 `max(x0+1, …)` 造出**重叠格子**，同一像素会被数两次。改成 floor/floor 严格不重叠（与 Batch E 同一套修法）。

另：`config.js` 的 `tunable()` 元数据字段口径统一（`upstreamValue` / `hasUpstream`），避免包装对象混进数值比较。

## 9. 纪律核对

| 铁律 | 状态 |
| --- | --- |
| 不删除任何现有算法 | ✅ `current` / `bgs` 分支一行未改 |
| 不修改现有 UI | ✅ 下拉只加选项，默认仍是「现有算法」 |
| 不静默替换生成结果 | ✅ 新引擎只在显式选中时启用 |
| 不自动判定哪套更好 | ✅ `verdict` 恒 `null`，报告和单测都拦着 |
| 尺寸越界只报告不改写 | ✅ `resolveGrid` 记 `limits.policy = "report-only"` |
| 不复制上游 UI / 数据 | ✅ 无 HTML/CSS 复制，色板不入库 |
| deploy 镜像同步 | ✅ `rsync` + `diff -r -q` 无输出 |
| 版本串 | ✅ `app.js?v=20260918-pw1`、模块 `?v=20260918-pw1` |
