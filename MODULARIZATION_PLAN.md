# app.js → ES Modules 模块化拆分方案（草案）

> 适用范围：`E:\libai` 单页应用的核心脚本 `app.js`（约 8535 行 / 321KB，vanilla JS、无构建）。
> 行号基于 2026-09-04 工作副本，后续编辑会漂移，仅供参考。
> 目标：**不引入构建链**，用浏览器原生 `type="module"` 完成拆分；每阶段可发布、可用 `golden/` 回归验证。

---

## 1. 为什么拆

1. **单一全局作用域，约 500+ 顶层声明**：函数靠"恰好不重名"耦合，改一处要全局脑内搜索影响面。
2. **隐式依赖**：大量算法函数直接读 `els`（DOM）与 `state`，例如 `rasterizeImage` 内部调用
   `getGranularity()/getGridHeight()/getSimilarityThreshold()` 读 DOM 控件 —— 无法脱离页面单测。
3. **无测试可回归**：人像算法参数迭代频繁（见 git log），每次调参只能人肉看效果。
4. **认知成本**：8385→8535 行的单文件对新接手者不友好；编辑器、拼装、导出三大块几乎彼此独立，
   拆开后可以并行开发。

## 2. 现状结构地图（按行号）

| 行号区间 | 内容 | DOM 耦合 |
|---|---|---|
| 1–9 | 防 iframe 嵌套保护 | 轻（window） |
| 10–225 | 常量与阈值（板子尺寸/粒度/NSFW/导出/人像 v3+v4 参数…） | 无 |
| 226–243 | 像素主题色 | 无 |
| 244–580 | 内联品牌色板文本 + 解析（`BASE_PALETTE`/`BRAND_CODE_MAP_TEXT`） | 无 |
| 581–688 | 色板目录、变体、核验、外部色板数据加载 | 无（fetch） |
| 689–879 | `els` —— 约 190 个 DOM 引用 | **强** |
| 880–954 | `state` —— 全局状态单例 | 中（引用 els 初值） |
| 955–998 | 主题随机化、颜色工具（hex/rgb、距离） | 轻 |
| 999–1036 | `init()` 启动流程 | **强** |
| 1037–1320 | `bindEvents()` 主事件绑定 | **强** |
| 1321–2050 | 尺寸/构图/预设/色板 UI、导入入口、弹窗、教程、中键平移 | **强** |
| 2051–2221 | 本地文件读取 + NSFW 内容安全审查（动态加载 nsfwjs） | 中 |
| 2222–2369 | `processImage` 主处理管线 + 错误归类 + 像素画检测 | **强** |
| 2370–2620 | "成图直扫"：扫描/采样/去噪/尺寸推断 | 中（canvas） |
| 2623–3450 | 人像 v4/v3 与通用光栅化（人脸 ROI、肤色、背景蒙版、抖动） | 中（只读少数 DOM） |
| 3451–4220 | 自适应调色板、Lab/ΔE2000 匹配、采样、分类 | 轻 |
| 4221–4450 | 网格统计、优化、KMeans 限色、孤立点清理 | 轻 |
| 4451–4843 | 画廊(localStorage)、缩略图、图纸库、编辑器配色选择 | 中 |
| 4844–5553 | 图纸画布渲染（表头/水印/图例/计数格/结果 UI） | 中 |
| 5554–6279 | 导出：PNG/分版/A4 PDF/jsPDF/材料清单/自实现 ZIP | 中 |
| 6280–6811 | `HardCodedEngine`（拼装模式画布引擎类） | 中 |
| 6812–7359 | 拼装模式 UI（进度/计时/分板/导航/完成） | **强** |
| 7360–8534 | 图纸编辑器（工具/选区/浮动画布/参考图/变换/撤销历史） | **强** |
| 8535 | `init()` 启动调用 | – |

## 3. 目标模块划分（建议目录 `src/`）

| 模块 | 职责 | 主要搬迁来源 | 预估行数 |
|---|---|---|---|
| `constants.js` | 全部纯常量（无 DOM、无运算） | 1–225、配置对象 | 220 |
| `color.js` | 颜色工具 + Lab/ΔE2000 + 缓存 | 955–998 局部、3940–4026 区、匹配工具 | 300 |
| `palette-data.js` | 色板文本/解析/变体/核验/外部加载/色号查找 | 244–688 | 450 |
| `palette.js` | 依赖 UI 的"当前色板"取值、品牌选择 | 1589–1660、1522–1660 局部 | 150 |
| `grid.js` | 网格纯函数：统计/优化/KMeans/孤立点/变换/相等 | 4221–4450、7546–7560、8349–8360 | 300 |
| `portrait-core.js` | v3/v4 人像算法（输入 data + 显式参数，不读 DOM） | 2623–3450（去 UI 取值后） | 800 |
| `direct-pattern.js` | 成图直扫采样与去噪 | 2370–2620 | 250 |
| `safety.js` | nsfwjs 动态加载 + 审查 + 结果 | 2051–2218 审查部分 | 170 |
| `import.js` | 文件/链接导入、构图、restore 尺寸 | 1321–2050 导入侧、2051–2221 | 400 |
| `chart.js` | 图纸画布绘制（给定 grid/stats 纯绘制） | 4844–5158 | 320 |
| `export.js` | PNG/分版/A4 PDF/ZIP/下载命名/材料清单 | 5554–6279 | 730 |
| `gallery.js` | 画廊/图纸库 localStorage 读写 | 4451–4843 数据侧 | 200 |
| `assembly-engine.js` | `HardCodedEngine` 类 | 6280–6811 | 530 |
| `assembly.js` | 拼装模式 UI 与进度 | 6812–7359 | 550 |
| `editor.js` | 编辑器（UI+canvas+历史） | 7360–8534 | 1180 |
| `ui.js` | `els`/`state`/结果 UI/设置同步/杂项 UI 动作 | 689–954、1037–2050、5252–5553 等 | 1900 |
| `main.js` | 入口：import 各模块 + `init()` | 999–1036、8535 | 60 |

> `ui.js` 体量仍大，模块化落地后可继续按「导入区 / 结果区 / 弹窗区」再拆；第一步不必一次到位。

## 4. 依赖关系

```
constants.js ─────────────► 所有模块
color.js ─────────────────► portrait-core / palette-data / grid / chart
palette-data.js ──────────► palette.js / portrait-core / export / gallery
grid.js ──────────────────► export / chart / editor / assembly / portrait-core(cleanup)
portrait-core.js ─────────► main(processImage)
safety.js / import.js ────► main(processImage)
chart.js ─────────────────► export.js / ui.js(预览)
gallery.js ───────────────► ui.js / editor.js / assembly.js
assembly-engine.js ───────► assembly.js
export.js / editor.js / assembly.js / ui.js ──► main.js
```

依赖规则：
- **下层（纯函数）不允许 import 上层（DOM/UI）**。`portrait-core` 出现"读 `els`"的函数一律改成
  调用方传入参数（宽、高、模式、阈值、调色板）。
- DOM 只在 `ui / import / editor / assembly / main` 出现；canvas 只在 `chart / export /
  assembly-engine / editor` 出现。
- 所有跨模块共享的 `WeakMap` 缓存（`COLOR_LAB_CACHE`、`PORTRAIT_FAMILY_CACHE`）随宿主模块走。

## 5. 落地顺序（每阶段：跑通 golden → 提交 → 下一阶段）

- **阶段 0 —— 打基线（建议先做）**
  - 先提交当前未合入的「人像 v4 + 收尾」工作区改动；
  - 用 `golden/` 生成当前行为基线；此后任何搬移都以"基线不变"为验收标准。

- **阶段 1 —— 纯库模块（零行为变化、风险最低）**
  - 搬 `constants.js`、`color.js`、`palette-data.js`、`grid.js`。
  - 方法：新建 `src/*.js` 把函数复制进模块并 `export`；`app.js` 中对应函数改为
    `import { ... } from "./src/grid.js"` 后在**同一文件里立即再导出到全局**
    （`export` 不能用于 classic 脚本，需先把 app.js 改成 module —— 见注意事项 6）。
  - 若想避免一次性切换 module，可把"纯函数集"先行拆成**多个 classic `<script>`**（按依赖顺序），
    全局函数照常共享；等最后再整体切 module。此中间态对 golden 透明。

- **阶段 2 —— 算法参数显式化（为可测铺路）**
  - 把 `rasterizeImage / rasterizeFaceAwarePortraitImage / dither / cleanup` 内部对
    `getGranularity()/getGridHeight()/els.modeSelect` 的读取上移到 `processImage`，
    改为显式入参（或统一的 `options` 对象）。

- **阶段 3 —— 拆 portrait-core（收益最大）**
  - 完成上述参数化后，2623–3450 可整体搬迁为纯模块，并直接接入 golden 的人像用例。

- **阶段 4 —— direct-pattern / safety / import / gallery**

- **阶段 5 —— chart / export**

- **阶段 6 —— assembly-engine / assembly**

- **阶段 7 —— editor（最大块，最后拆，避免长期 diff 冲突）**

- **阶段 8 —— ui 收编 + main.js + index.html 切 `type="module"`**
  - `els`/`state`/`bindEvents` 收进 `ui.js`，其余模块显式 import；删除全局中间导出；
  - index.html：`<script src="./app.js" defer>` → `<script type="module" src="./src/main.js">`。

## 6. 迁移注意事项（都踩过的坑）

1. **module 只在 http(s)/localhost 生效**：`file://` 直接双击会因 CORS 失败。若存在"下载后离线
   打开"的使用场景，需保留一份经典脚本构建或明确告知用户走本地服务器（与 nsfwjs/FaceDetector
   的安全上下文要求一致，问题不大）。
2. **经典脚本顺序**：`security-canvas.js` 与 `denoise-integration.js` 仍是普通脚本（提供全局副作用），
   module 默认延迟执行，只要主模块放在它们之后即可；不要把它们也"模块化"到一半。
3. **`defer` 不再需要**：module 天然延迟；删掉 `defer` 避免误解。
4. **顶层 `const` 与函数声明的差异**：classic 脚本里顶层函数会挂 `window`、跨脚本可用；切 module 后
   不再有隐式全局，任何共享都必须 `import/export`——搬移前先给每个函数标注"被谁调用"。
5. **localStorage key 一律不变**（画廊 `libai-maker-generated-gallery`、拼装进度、诊断计数等），
   保证老用户数据不丢。
6. **切换方式二选一**：(a) 一次性把 app.js 改 `type=module`，文件顶部集中 `import` 各模块；
   (b) 中间态多 classic script。推荐 (a) 与"先提交再拆"配合，避免长期半迁移态。
7. **`index.html` 的 `?v=` 版本串是手工维护的**：每次可发布的拆分提交都要 bump
   `app.js`（拆完后是 `src/main.js`）的版本串，否则线上吃旧缓存。
8. **`PORTRAIT_DEBUG`/`PORTRAIT_V4` 这类顶层常量**会随 `constants.js` 走；`location` 读取在模块
   顶层执行没有问题。
9. **行号大漂移**：先提交 v4 WIP（含本次收尾），再开始拆，避免两套大 diff 互相覆盖。

## 7. 验收与回归

- 每个阶段前后运行 `golden/golden.html?mode=check&auto=1`：基线不变才允许合入；
  预期内的算法改动先 `?mode=record` 重新生成基线再合入。
- 阶段 1–5 之后人工过一遍主链路：导入图片 → 生成 → 预览 → 下载 PNG → 拼装模式 → 编辑器保存。
- 阶段 8（切 module）后重点回归：页面首屏、`init()` 异步初始化、画廊恢复、拼装进度恢复。

## 8. 建议工作量

纯函数模块（阶段 1–3）约 1–2 个会话；UI 模块（阶段 4–8）约 2–3 个会话。
每阶段独立可发布，**不必等全部完成才收益**。
