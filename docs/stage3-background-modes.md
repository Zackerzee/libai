# 阶段 3：背景处理正式整合 —— 保留背景 / 保留原图透明区域 / 自动移除纯色背景

> 实施日期：2026-10-15 ｜ 状态：已验收（单测 + CDP 真机 20/20）｜ 提交：见 git log「阶段 3」
>
> 上游依据：七阶段正式开发计划·阶段 3。本文件是该阶段的实施与验收存档。

## 1. 要解决什么

阶段 2 收工时，「去纯色背景」只有一个布尔开关（`backgroundRemoval`），语义是「自动移除」。
三类真实诉求没有出口：

1. **保留背景** —— 原图的背景色/底色也是图案的一部分（徽章底、海报底、衣服上的印花），
   用户要的是「所有区域都出豆」，透明区域还要先用「图片调整」的背景色填上；
2. **保留原图透明区域** —— 上传透明底 PNG（贴纸、logo、像素画），透明格应该**留空**，
   熨烫时那片区域不烫；这是改造前采样引擎的既成行为；
3. **自动移除纯色背景** —— 阶段 B2 已有的可靠性门路径，原样保留。

三个阶段前的形状：一个开关、一种语义、预检只服务于「移除」。

## 2. 三模式语义（互不重复，全部有测试锁定）

| 模式 | id | 生成行为 | 预检条 |
|---|---|---|---|
| 保留背景 | `keep` | 所有区域都生成豆；原图透明区域先用背景色填充（缺省 `#ffffff`，取自「图片调整」的 background） | info：`预计 N 格透明区域将填充为背景色 #xxx`；无透明区时 `未检测到透明区域；整幅图像都会生成豆。` |
| 保留原图透明区域 | `transparent` | 原图透明格留空、不填豆（采样引擎 `alphaThreshold:8` → 透明格 null → 空豆） | info：`预计 N 格透明区域将留空、不填豆`；无透明区时 `未检测到透明区域；没有区域会留空。` |
| 自动移除纯色背景 | `auto` | 既有可靠性门：border-connected flood fill + 5 指标，uncertain/none 一律 NO-OP | probing → reliable：`[应用] / [保留背景]`；不可靠：`[知道了]` + 原因 |

**默认模式 = `transparent`。** 理由：构造时套 `keep` 会改变每一个上传透明 PNG 的老用户的
行为（透明格从「空」变成「填满」）。「默认值不许改变既有行为」是本项目的既定纪律
（承阶段 2 `strategy: null` 先例）。

## 3. 架构：单一翻译处，翻译落在 profile 合并之前

```
services/background-mode.mjs        ← 模式语义的唯一解释层（契约）
  ├─ BACKGROUND_MODES / DEFAULT_BACKGROUND_MODE / BACKGROUND_MODE_LIST / BACKGROUND_MODE_HINTS
  ├─ backgroundModeOf(settings)      backgroundMode 优先 → autoBackground===true 兜 "auto" → 默认 transparent
  └─ resolveBackgroundModeOptions(mode, {fillColor})
        keep        → { autoBackground:false, transparentFill: fillColor || "#ffffff" }
        transparent → { autoBackground:false, transparentFill: null }
        auto        → { autoBackground:true,  transparentFill: null }

services/generation-pipeline.mjs    ← 翻译落点：runGenerationPipeline，profile 合并【之前】
services/mode-profile.mjs            ← ENGINE_PASSTHROUGH_KEYS + "transparentFill"
smart-preprocessing/generation-engine-v2.mjs ← compositeTransparentBackground / buildAlphaGrid
services/background-preview-service.mjs     ← 三模式预检（keep/transparent 不跑五指标）
ui/generation-panel.js / ui/workspace.js / app.js / state/*.js  ← 面板、事件、桥接、真源
```

**为什么翻译必须落在 profile 合并之前**：beginner 模式档案自带 `autoBackground:true`。
只有让用户的背景模式在档案合并*之前*盖掉 `engineOverrides.autoBackground`，
`normalizeModeOverrides` 才能把用户选择带进最终配置。

**守卫（不表态就不翻译）**：仅当调用方显式给过 `backgroundMode` / `autoBackground` /
`transparentFill` 任一字段时才翻译；否则跑分器、工具直调的 beginner 档案照旧说话。
app.js 的 `buildV25Options` 因此把 `backgroundMode` 缺省为 `null`（不表态）。

## 4. 引擎填充位置：subjectCrop 之后、采样之前

`compositeTransparentBackground(source, fillColor)` 插在 `timing.subjectCrop` 之后、
采样之前。两个约束都有测试：

- `cropToSubject` 不读 alpha —— 先填充会让填充色参与取景判定；
- 不碰 `alpha=255` 像素（逐位不变），全不透明图零拷贝（`needsFill` 预扫直接返回原图）；
- 半透明按 `out = src*k + fill*(1-k)`（`k=a/255`）混合；非法 hex 原样返回不炸。

诊断落 `diagnostics.transparentFill = { color, filledPixels, fillRatio }`，
`resolvedConfig.transparentFill` 同步暴露，报告可查。

## 5. 重点保护素材 10 类 → 保护机制映射

「背景处理」问的是「哪些格出豆」；「不要误删有价值的格」由引擎侧的保护机制负责。
阶段 3 的纪律是：**背景模式的任何变化都不得削弱下列任何一类保护**
（预检不是放行凭证、真判定在生成时重跑，见 §6）。下表把 10 类重点素材映射到真实机制
与测试证据：

| # | 素材类型 | 保护机制（代码） | 所在 |
|---|---|---|---|
| 1 | 五官 / 脸部细节 | `detailProtection`（0–100 → 引擎 0–1） | generation-panel 细节保护 → mode-profile.toEngineOptions |
| 2 | 人物 / 动漫 / 物体轮廓 | `edgeProtection`（同上） | 边缘保护 |
| 3 | 眼睛（瞳孔、眼白、眼部结构） | `preserveEyes` → 引擎 `eyeProtection: 1` | 眼睛细节保护开关 |
| 4 | 高光（眼睛高光、局部亮点） | `preserveHighlights` → `highlightProtection: 0.8` | 高光保护开关 |
| 5 | 微细节（低频但有结构意义的颜色） | `preserveMicroDetails` → `microDetailProtection: 0.8` | 微细节保护开关 |
| 6 | 线稿 | `strokeProtection`：线稿像素下采样后进保护图，抬开清理门槛 | smart-features 第 4 项，`diagnostics.strokeProtection` |
| 7 | 锚点色 / 点缀色 | `accentProtection`：降色时锚点色不进「第一阶段主动合并」 | smart-features 第 5 项，`diagnostics.accentProtection` |
| 8 | 主体取景 | `subjectCrop`：取景只认不读 alpha 的颜色口径；阶段 3 的填充刻意排在其后 | generation-engine-v2 主流程 |
| 9 | 纯色背景对面的主体 | `auto` 可靠性门 + 五指标（饱和度 / 亮度 / 边界连通 / 分离度 / 置信度），uncertain/none 一律 NO-OP | background-reliability.mjs |
| 10 | 原图透明区域 | 阶段 3 新增口径：`alphaGrid`（cell 多数像素 alpha≤8 → 透明格）；transparent 留空、keep 先填充再采样 | generation-engine-v2.buildAlphaGrid |

测试证据：`tests/background-mode.test.mjs` B1–B4（引擎基元）/ C1–C3（三模式生成行为）/
D1–D6（管线翻译）/ E1–E4（预检文案）；`smart-preprocessing/smart-features.test.mjs`
（线稿 / 锚点色保护）；`tests/background-reliability*.test.mjs`（五指标门）。

## 6. 任务安全契约

1. **预检不是放行凭证。** 真正的背景判定在生成时由 `generateV2` 在真实格数上重跑
   （B2 纪律原样继承）；预检只决定「要不要问用户」。
2. **auto 的 uncertain / none 一律 NO-OP** —— 不移除、不填充、不改格；结论条告诉用户为什么。
3. **keep / transparent 不跑采样与五指标** —— 它们不移除背景，跑一遍纯属白开销，
   还会给用户一个与当前模式无关的「建议」。
4. **默认值不改既有行为** —— 默认 `transparent`；`backgroundMode` 缺省 `null` 不表态；
   调用方不表态时档案自己说话（守卫见 §3）。
5. **镜像纪律** —— `emitSettings()` 仍产出 `backgroundRemoval = (mode === "auto")`，
   stage-b-release-freeze §20 断言不动；store 侧 `backgroundMode` 是真源，
   `backgroundRemoval` / `autoBackground` 是同一个 setState 里落的镜像。
6. **逐位兼容** —— 全不透明图零拷贝；legacy 存档（无 backgroundMode）走默认 transparent，
   与改造前逐位一致（D6）。
7. **换图不继承** —— 新上传重置 `sourceTransform`，旧的填充色选择不会渗到新图。

## 7. 双根 DOM 与两处实测坑（阶段 3 新知识）

- **双根事件**：背景卡所在节在 `render()` 里被 `replaceChildren` 搬进
  `backgroundRoot`（工作台步进卡）。事件冒泡到 backgroundRoot 的祖先后**到不了**
  面板 `this.root` —— `onClick` 必须同时绑两个根，`syncUI` 的查询也必须双根。
  症状是「卡片看得见、点不动」。既有 `[data-field]` 双根查询是同一纪律。
- **ID 权重陷阱**：`styles/workspace.css` 原规则
  `body.phase2-workspace #ws-generation-background-controls small{display:none}`
  （顶栏紧凑态的遗留）按 ID 权重压过一切类名放行规则，把三张卡的说明文字全藏了。
  已收窄为 `#ws-generation-top-controls #ws-generation-background-controls small`
  （仅紧凑顶栏内生效；`moveToStep` 是 append 移动语义，搬进步进卡后规则自然失效）。
  同类坑：pixler-skin 对 `.sl-preset-copy small` 的 display:none，已在阶段 3 放行段显式翻身。

## 8. 验收证据

### 8.1 单元测试

- `tests/background-mode.test.mjs`：22/22 通过（A 契约 / B 引擎基元 / C 生成行为 /
  D 管线翻译 / E 预检文案）。
- 受影响既有测试全部更新并通过：generation-tab、background-worker-integration、
  generation-size-ui-wiring、fixed-height-context-controls、
  project-store-snapshot、palette-location。
- 全量：2029 项 · 通过 2003 · 失败 25 · 跳过 1。25 条**全部命中基线 A 类陈旧 UI
  断言表**（逐条核对过清单），阶段 3 新增失败 0；ESM 758 文件 0 失败。

### 8.2 CDP 真机验收（实时预览 8811，`/tmp/stage3-probe.mjs`，20/20 通过）

上传 `tests/fixtures/background/transparent-split.png`（不透明外框 + 透明内芯，
内容四边贴边 → 落地页自动取景不会裁掉它）：

| 步骤 | 实测 |
|---|---|
| 进入工作台 / 三卡片渲染 / 说明文字可见 | ✓（卡片 238×64，small 全部 display:block） |
| 初态 = 保留原图透明区域 | ✓ 高亮正确；状态行「透明区域将留空、不填豆；这是默认行为」 |
| 初态用豆数 | **4368**（只有外框；透明内芯 5293 格留空） |
| 点「保留背景」 | store.backgroundMode=keep、autoBackground=false；预检条 info「预计 5293 格透明区域将填充为背景色 #ffffff」；按钮只剩 [知道了]；用豆数 **4368 → 9409** |
| 点「自动移除纯色背景」 | backgroundMode=auto、autoBackground=true；预检条 probing → 「没有检测到可以安全分离的纯色背景，已保持原图。」（图案无纯色背景，结论正确） |
| 回「保留原图透明区域」 | 预检条 info「预计 5293 格透明区域将留空、不填豆」；用豆数 **精确回到 4368** |
| 界面高亮与 store 同步 | ✓ |

截图：`/tmp/stage3/stage3-modes.png`（三卡片 + 外框出豆 / 内芯留空的画布 + 底部预告条）。
**4368 → 9409 → 4368 这组数字就是引擎侧 fill 生效、且关闭后逐位还原的端到端证据。**

### 8.3 已知边界（既有行为，非阶段 3 回归）

- **落地页上传链路会自动裁掉「整行/整列全透明」的外缘**（`transparentImageBounds`，
  importMode=photo 时）。所以透明外缘 + 不透明芯的图（如旧 fixture `transparent-png.png`）
  在上传后就没有透明区了 —— 预检如实回答「未检测到透明区域」。透明区要与内容交错
  （四边有内容贴边）才能留到引擎。验收 fixture 即按此设计。
- `tests/fixtures/background/` 整个目录被 .gitignore（既有约定，fixture 随文档路径引用，
  不入库）；新增 `transparent-split.png` 与 manifest 条目已在本地登记。

## 9. 落地文件清单

新增：`services/background-mode.mjs`、`tests/background-mode.test.mjs`、
`tests/palette-location.test.mjs`、`docs/stage3-background-modes.md`、
fixture `tests/fixtures/background/transparent-split.png`（不入库）。

修改：`smart-preprocessing/generation-engine-v2.mjs`、`services/generation-pipeline.mjs`、
`services/mode-profile.mjs`、`services/background-preview-service.mjs`、
`ui/generation-panel.js`、`ui/workspace.js`、`app.js`、`state/store.js`、
`state/project-store.js`、`styles/generation-editor.css`、`styles/pixler-skin.css`、
`styles/workspace.css`、`index.html`（缓存戳）、6 个既有测试文件、
`tests/fixtures/background/manifest.json`、`deploy/` 同步镜像。
