# 算法来源与生产集裁定

> 读者：想知道「这个算法是哪来的、能不能用、为什么被裁掉」的人。
> 配套文档：`docs/stage-b-architecture.md`（怎么拼在一起）、
> `THIRD_PARTY_NOTICES.md`（许可与分发义务）。

---

## 一、生产算法集（Stage B5 §1 冻结）

### 1.1 全部 OFF

| 算法 | lab 文件 | 状态 |
|---|---|---|
| Dual Mode | `smart-preprocessing/lab/dual-mode.mjs` | **REJECT** |
| Spatial Refine | `smart-preprocessing/lab/spatial-refine.mjs` | **REJECT** |
| Conservative Cleanup | `smart-preprocessing/lab/conservative-cleanup.mjs` | **REJECT** |
| Neutral Protection | `smart-preprocessing/lab/neutral-protection.mjs` | **REJECT** |
| Bean Fit | `smart-preprocessing/lab/bean-fit.mjs` | 保留在 lab，**生产白名单为空集** |

它们**仍然存在于 `smart-preprocessing/lab/`** —— Lab 是实验场，不是产品路径。
冻结的不是「文件不许存在」，而是「**一个生产入口都不许够到**」。

### 1.2 冻结方式：不可达，不是默认关

> 「默认关」是一个可以被一次误操作打开的开关；「不可达」是结构上到不了。
> 一个被明确否决的算法留在搜索空间里，代价不是「可能被选中」，
> 而是**它会被当成一个仍然有效的选项** —— 下一次调参的人会重新评估它、
> 重新写一份报告、重新得出同一个结论。冻结的意义是终止这个循环。

具体落点：

- `services/auto-tune-profiles.mjs` 的 `AUTO_TUNE_LAB_CANDIDATES = ["bean-fit"]`
  —— 只允许这一个 lab 候选。
- 同文件的 `PRODUCTION_LAB_CANDIDATES = []` —— 生产里一个 lab 候选都不跑。
- `tests/stage-b-release-freeze.test.mjs` 断言四个 REJECT id 不在生产白名单、
  不在候选集、不出现在 `app.js` 里。

### 1.3 每个 REJECT 的理由

| 算法 | 理由 |
|---|---|
| **Dual Mode** | 双模式分流没有带来可测收益，却让「这次用的哪套」变成运行时未知量 —— 报告的每一行都要先问「哪个模式」，而收益是 0。 |
| **Spatial Refine** | 空间细化在边缘上过度处理。实测碎化翻倍，换来的轮廓收益不成立。 |
| **Conservative Cleanup** | 「保守清理」的失败形态与过度清理**同源**：它并不减少清理，只是换了个阈值，在平色区照样造噪点。 |
| **Neutral Protection** | 中性色保护可以被颜色复杂度绕过；它保护的是「灰色」这个类别，而实际需要保护的是「主体的灰色」，两者不等价。 |

---

## 二、Auto Tune 的边界

Auto Tune **不创造新算法**，它只从一组「已验证的候选 Profile」里挑一套。
候选定义在 `services/auto-tune-profiles.mjs`。

- **只对「智能」（`auto`）模式启用**：`AUTO_TUNE_PRODUCTION_MODES === ["auto"]`。
- 其余 7 个模式继续用**固定的** ModeProfile。
- 候选**不许改取景**：`subjectCrop` / `autoBackground` / `strokeProtection` /
  `accentProtection` 是取景不变量。取景一变，任何按归一化坐标做的比较都不再成立。
- 排序用**字典序**，不用加权分数。加权分数无法解释「它高在哪」。

---

## 三、生产链路上实际在跑的算法

| 环节 | 模块 | 来源 |
|---|---|---|
| 采样 | `smart-preprocessing/sampling-engine-v2.mjs` | 本站原创（5 种策略：auto / linear-mean / center / dominant / edge-aware） |
| 细节保护 | `smart-preprocessing/detail-protection-v2.mjs` | 本站原创 |
| 描边保护 | `smart-preprocessing/stroke-mask.mjs` | 本站原创 |
| 点缀保护 | `smart-preprocessing/accent-protection.mjs` | 本站原创 |
| 主体裁剪 | `smart-preprocessing/subject-crop.mjs` | 本站原创 |
| 智能清理 | `smart-preprocessing/smart-cleanup-v2.mjs` | 本站原创 |
| 区域感知量化 | `smart-preprocessing/region-aware-quantizer.mjs` | 本站原创 |
| 受保护色预算 | `smart-preprocessing/protected-palette-budget-v2.mjs` | 本站原创 |
| 背景可靠性门 | `smart-preprocessing/background-reliability.mjs` | 本站原创（Stage B2） |
| 背景掩码 | `smart-preprocessing/auto-background.mjs` | 本站原创 |
| 源图分类 / 路由 | `services/source-classifier.mjs` | 本站原创（Stage B4 §12） |
| 模式表 | `services/mode-profile.mjs` | 本站原创（Stage B4 §2） |
| 调优器 | `services/auto-tune.mjs` + `auto-tune-profiles.mjs` | 本站原创（Stage B4 §13） |
| 结构诊断 | `services/structural-diagnostics.mjs` / `smart-preprocessing/structural-transition-analyzer.mjs` | 本站原创 |
| 质量指标 | `services/quality-metrics.mjs` | 本站原创 |
| 算法引擎（可选） | `src/algorithms/bgs/` | **Apache-2.0**，`zwhy149/bead-grid-studio` @ `515e180`，独立实现的纯函数改写 |
| 自适应分辨率（可选） | `src/algorithms/adaptive-resolution/` | **Apache-2.0**，同源，独立改写 |
| 算法引擎（可选） | `src/algorithms/pindou-workbench/` | 见 `THIRD_PARTY_NOTICES.md` |
| 算法引擎（生产默认） | `src/algorithms/engines/hybrid-v2/` | 本站原创 |

> **注意**：`state.algorithmEngine` 默认是 `"current"`，生产走的是 `app.js` 内联的
> `processImageV2` 链路（上表前 15 行）。`bgs` / `pindou-workbench` / `hybrid-pw`
> 是**平行新增**的可选分支，既有分支一行未改。

---

## 四、被删除的重复表

Stage B4 §1 的只读审计发现，「模式 → 生成配置」的映射散在**三张互相不一致的表**里：

| 表 | 处置 | 理由 |
|---|---|---|
| `smart-preprocessing/generation-engine-v2.mjs` 的 `GenerationProfiles` | **已删除** | 生产链路**不可达**：唯一的模式来源没有 `preset` 字段，`resolveOptions` 恒定回落 `GenerationProfiles.photo`。8 行 × 7 字段 = 56 个值只在 A/B 对比器直调 `generateV2` 时才生效。 |
| `services/generation-pipeline.mjs` 的 `GENERATION_MODE_PRESETS` | 改为 `MODE_PROFILES` 的**视图**（re-export） | 它原本是生产链路活的表，与上面那张不一致 |
| `app.js` 的 `buildV25Options` + `mapDetailProtectionValue` | 只保留「模式 → 请求参数」适配 | 不再自造数值 |

现在 `services/mode-profile.mjs` 的 `MODE_PROFILES` 是**唯一**来源。
`tests/mode-profile-contract.test.mjs` 逐字段反查消费点，防「写了没人读」的死配置回来。

---

## 五、来源与许可

### 5.1 随仓库分发的第三方组件

完整清单与条款见 `THIRD_PARTY_NOTICES.md`。摘要：

| 组件 | 许可 | 用途 |
|---|---|---|
| `vendor/qrcode.js` | MIT | 导出弹窗二维码 |
| `smart-preprocessing/palette-brands.mjs` | MIT（`HansBug/pindou-color-data`） | 8 品牌 / 2158 色官方色卡数据 |
| `src/algorithms/bgs/` | Apache-2.0（`zwhy149/bead-grid-studio` @ `515e180`） | 可选算法引擎 |
| `src/algorithms/adaptive-resolution/` | Apache-2.0（同源） | 自适应分辨率建议 |
| `vendor/source-han-sans/` | OFL-1.1 | 仅 PDF 中文标题，延迟加载 |
| `vendor/fusion-pixel/` | OFL-1.1 | 全站界面字体 |
| `vendor/fflate.js` | MIT | `.pixler` 的 ZIP 解包 |

### 5.2 仅参考思路、未复制源码

kmeans++ 调色板 / CIEDE2000 色差、连续评分选色、Floyd–Steinberg 抖动、
KD-tree 最近色索引、库存与 OCR 设计、用量汇总、绘图交互、PW 算法模块设计 ——
完整列表与各上游许可状态见 `THIRD_PARTY_NOTICES.md` 第二节。

### 5.3 与 Pixler 的关系

上游是**商业闭源产品**，未提供公开许可。两处接触点：

- `importers/pixler.mjs` —— 对**用户自己导出的** `.pixler` 文件做**格式反推**，
  直接读其中的结构化网格。未复制上游源码、未调用上游接口、未绕过授权校验。
  色差计算用公开的 sRGB→CIELAB(D65) 与 CIEDE2000 标准公式。
- `styles/pixler-skin.css` —— 仅参照**栅格尺寸与信息密度**（左轨 54px、右栏 244px、
  顶栏 34px、直角纸张画布）这一级别的布局参数。布局尺寸本身不受著作权保护。
  未复制图标、插画、字体文件、文案或配色表。

两者都是**可独立摘除的模块**，摘除后主流程不受影响。

### 5.4 已剥离

`src/algorithms/engines/pindo-native/`（`LunarXuan/Pindo`，**GPL-3.0-only**）
是上游 `app/page.tsx` 与 `lib/engine/*` 的 JavaScript 移植，属 GPL 衍生作品。
为保持本站 MIT 许可的完整性，已**移出本仓库**，不随本站分发。
备份在仓库外 `libms-studio-GPL-quarantine/pindo-native-GPL-3.0/`。

---

## 六、外部运行时依赖

这些**不在仓库里**，是运行时从境外 CDN 拉的。它们会静默失败 ——
写错路径不报错，只是功能不生效。

| 功能 | 依赖 | 失败形态 |
|---|---|---|
| PDF 导出 | `cdn.jsdelivr.net/npm/jspdf@2.5.2/+esm` | 导出报错 |
| OCR | `tesseract.js@5.1.1` + `tessdata.projectnaptha.com` | 给可读提示 |
| 内容审查 | `tfjs` + `nsfwjs@4.2.1`（模型 + 权重 + 主包三件套） | **静默放行** |

内容审查的三件套必须**按顺序**挂：
`dist/models/mobilenet_v2/model.min.js` → `group1-shard1of1.min.js` →
`dist/browser/nsfwjs.min.js`。顺序错或路径错都会静默放行。
回归守卫：`tests/content-safety-wiring.test.mjs`。

**改这些 URL 前先实测。** 中国大陆访问 `cdn.jsdelivr.net` 经常被重置。
