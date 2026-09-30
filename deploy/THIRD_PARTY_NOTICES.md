# 第三方组件与来源声明

本站主体为原创代码，采用 **MIT** 许可（见 `LICENSE`）。
以下列出随本仓库一并分发的第三方组件，以及仅作思路参考的来源。

---

## 一、随本仓库分发的第三方组件

这些组件的版权声明与许可条款必须随分发保留。

### 1. `vendor/qrcode.js` — QR Code Generator for JavaScript

- 许可：**MIT**
- 版权：`Copyright (c) 2009 Kazuhiko Arase`
- 上游：<http://www.d-project.com/>
- 用途：导出弹窗中生成分享二维码
- 状态：**原样引入**，未修改

### 2. `smart-preprocessing/palette-brands.mjs` — 品牌色库数据

- 许可：**MIT**
- 版权：`Copyright (c) 2026 HansBug`
- 上游：<https://github.com/HansBug/pindou-color-data>
- 用途：8 个拼豆品牌的官方色卡数据（2158 色）
- 状态：仅搬运**颜色数据与元信息**，不含任何上游源码
- 重新构建：`node tools/build-palette-brands.mjs`

### 3. `src/algorithms/bgs/` — BGS 算法模块

- 许可：**Apache License 2.0**
- 上游：`zwhy149/bead-grid-studio`（豆格工坊），commit `515e180`
- 许可全文：[`src/algorithms/bgs/LICENSE-APACHE-2.0.txt`](src/algorithms/bgs/LICENSE-APACHE-2.0.txt)
- 上游 NOTICE：[`src/algorithms/bgs/NOTICE`](src/algorithms/bgs/NOTICE)
- 状态：独立实现的纯函数改写，已标注修改处

### 4. `src/algorithms/adaptive-resolution/` — 自适应分辨率建议

- 许可：**Apache License 2.0**（同源 `zwhy149/bead-grid-studio`）
- 声明：[`src/algorithms/adaptive-resolution/NOTICE.md`](src/algorithms/adaptive-resolution/NOTICE.md)
- 状态：独立改写，未复制上游色板或界面

### 5. 字体

- **`vendor/source-han-sans/SourceHanSansSC-VF.ttf` — Source Han Sans SC / 思源黑体简体中文**
  - 来源：Adobe 官方 `adobe-fonts/source-han-sans` release 分支
  - 版本：2.005R
  - 许可：SIL Open Font License 1.1（全文见 [`vendor/source-han-sans/LICENSE.txt`](vendor/source-han-sans/LICENSE.txt)）
  - 用途：仅在导出包含中文标题的 PDF 时延迟加载并嵌入；不进入首页或工作台初始 bundle

- **`vendor/fusion-pixel/` — 缝合像素字体 / Fusion Pixel Font**
  - 许可：**SIL Open Font License 1.1**（全文见 [`vendor/fusion-pixel/LICENSE-OFL.txt`](vendor/fusion-pixel/LICENSE-OFL.txt)）
  - 版权：`Copyright (c) 2022, TakWolf (https://takwolf.com)`
  - 上游：<https://github.com/TakWolf/fusion-pixel-font>（上游版本 2026.08.11）
  - 打包来源：npm `@vp-tw/cjk-web-fonts-fusion-pixel-font@0.0.1`（MIT AND OFL-1.1，
    README 声明为 vp-tw 维护的非官方 webfont 打包）
  - 用途：全站界面字体（12px 等宽简体中文子集，77 个 `unicode-range` 分片，共约 1.1 MB）
  - 状态：**原样引入**，未修改字形；`NOTICE.md` 与许可全文随目录一并保留
  - 该字体本身合并了多个 OFL 许可项目的字形，完整许可文本见 `vendor/fusion-pixel/LICENSE-OFL.txt`
- ~~Nunito、Noto Sans SC，经 Google Fonts CDN 引入~~ —— **2026-09-22 已移除**，
  改由上面的本地像素字体承担全部界面字形（同时省掉一次 797ms 的渲染阻塞请求）

### 6. `vendor/fflate.js` — ZIP / DEFLATE 压缩库

- 许可：**MIT**
- 版权：`Copyright (c) 2021 Arjun Barrett`
- 上游：<https://github.com/101arrowz/fflate>
- 版本：0.8.2（UMD 构建，32 KB）
- 用途：`.pixler` 项目文件的 ZIP 解包与 `deflate-raw` 解压
- 状态：**原样引入**，未修改

---

## 二、仅参考思路、未复制源码

以下项目为功能调研与算法设计提供了参考，但**本仓库未复制其任何源码文本**，
相关模块均为独立实现。列出以示透明，不构成许可义务。

| 项目 | 参考内容 | 该上游许可状态 |
|---|---|---|
| `Aswellle/Pindou-Studio` | kmeans++ 调色板、CIEDE2000 色差思路 | MIT |
| `Jett-Wu/Perler_Beads_Generator` | 连续评分选色思路 | MIT |
| `belleqaq/perler-bead-generator` | Floyd–Steinberg 抖动、PDF 分页思路 | MIT |
| `zuili1204/PinDou` | KD-tree 最近色索引思路 | MIT |
| `GuoNH/perler-bead-manager` | 库存与 OCR 功能设计 | 见各仓库 |
| `guqiao5757-png/doudou-up-beads` | 用量汇总设计 | 见各仓库 |
| `DanZai233/PixelBead` | 绘图交互设计 | 见各仓库 |
| `beads9/pindou-workbench` | PW 算法模块设计思路 | 仓库内无 LICENSE 文件，故不作为许可依据，仅参考 |

### 与 Pixler 的关系（格式互操作 + 视觉参照，均未复制源码）

上游：**Pixler** <https://pixler.starrylight.art>（商业产品，闭源，未提供公开许可）。

- `importers/pixler.mjs` —— `.pixler` 项目文件导入适配器
  - 做法：对**用户自己导出的** `.pixler` 文件做**格式反推**，直接读取其中的结构化网格，
    而不是转成图片再识别（避免二次损失）。
  - 未复制上游任何源码文本、未调用上游任何接口、未绕过任何授权校验。
  - 文件内的色板与色号属于**用户自己作品的数据**，随用户文件一并读取；
    色差计算使用公开的 sRGB→CIELAB(D65) 与 CIEDE2000 标准公式，未抄录 Pixler 的数据表。
  - 兼容性范围：`codecVersion 1`。上游若变更格式，导入会明确报错而不是猜测
    （见 `tests/pixler-import.test.mjs` 中「非 Pixler 的 ZIP 应被拒绝」用例）。
- `styles/pixler-skin.css` —— 工作台视觉参照
  - 仅参照其**栅格尺寸与信息密度**（左轨 54px、右栏 244px、顶栏 34px、直角纸张画布）
    这一级别的布局参数。布局尺寸本身不受著作权保护。
  - 未复制其图标、插画、字体文件、文案或配色表；像素字体为独立选用的
    Fusion Pixel（OFL-1.1，见上文第 5 项）。
  - 界面上的品牌名、色号体系、功能命名均沿用本站自身定义。

> 若上游对上述任一项提出异议，`importers/pixler.mjs` 与 `styles/pixler-skin.css`
> 均为可独立摘除的模块，摘除后本站主流程不受影响。

---

## 三、已从本仓库剥离的组件

### `src/algorithms/engines/pindo-native/`

- 上游：`LunarXuan/Pindo`，**GPL-3.0-only**
- 性质：上游 `app/page.tsx` 与 `lib/engine/*` 的 JavaScript 移植，属 GPL 衍生作品
- 处置：为保持本站 MIT 许可的完整性，该模块已**移出本仓库**，不随本站分发
- 备份位置：仓库外 `libms-studio-GPL-quarantine/pindo-native-GPL-3.0/`
- 相关代码路径（`ALGORITHM_ENGINES` 条目、`processProductionPindo`、
  `processImage` 分流、错误处理分支、界面下拉选项）均已移除

---

## 四、免责说明

本文件是来源与许可的记录，不是法律意见。
每个第三方组件的完整许可条款以其上游许可文本为准。
