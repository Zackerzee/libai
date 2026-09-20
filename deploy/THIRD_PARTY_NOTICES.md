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

- Nunito、Noto Sans SC，经 Google Fonts CDN 引入
- 许可：**SIL Open Font License 1.1**
- 状态：仅通过 CDN 链接加载，字体文件本身不随本仓库分发

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
