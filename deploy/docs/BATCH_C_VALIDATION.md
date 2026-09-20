# Batch C 验证与交接（2026-09-17）

来源需求：把三个开源项目的能力并入本生成器。

| 来源仓库 | 拿过来的东西 | 落到本批 |
|---|---|---|
| `DanZai233/PixelBead` | 绘图工具集：画笔/橡皮/填充/吸色/直线/圆形/矩形/框选/笔宽/快捷键/功能说明 | **C1** |
| `zwhy149/bead-grid-studio` | 自动配色 + 保留空白点 + 重要强调色 → 「小白一键」 | **C2** |
| `LunarXuan/Pindo` | 三种创作模式算法（主体裁剪 / 背景分离 / 线稿优先） | **C3** |

根目录与 `deploy/` 已同步；两套浏览器 e2e 对**两个根**都跑通。

---

## C1 绘图工具集

新增 `services/shapes-service.js`（纯算法，无 DOM）：

- `lineCells`（Bresenham）、`rectangleCells`、`ellipseCells`、`shapeCells`；
- `brushOffsets`（奇数尺寸圆盘核）、`expandBrush`；
- `magicWandSelection`（CIE76 色差 + BFS 连通）；
- `fitSelectionBox` / `selectAll` / `invertSelection` / `translateSelection`。

接入点：

| 能力 | 位置 |
|---|---|
| 6 个新工具（直线/矩形/圆形/魔棒）+ 快捷键 | `ui/grid-editor-toolbar.js` |
| 形状拖动预览、Shift 约束、魔棒点选 | `ui/workspace.js` |
| 形状落笔 / 复制粘贴剪切 / 方向键搬移 | `services/editor-service.js` |
| 形状预览绘制（半透明填充 + 虚线外框） | `ui/canvas-renderer.js` |
| 笔宽 / 实心 / 魔棒容差 | Inspector 工具选项区 |
| 功能说明对话框 | `GridEditorToolbar.openHelp()` |

快捷键：`N`画笔 `Y`同色 `U`连通 `W`魔棒 `L`直线 `R`矩形 `C`圆形 `M`区域 `V`选择 `H`平移 `I`吸色 `E`擦除 `G`填充 `B`画笔；`[`/`]` 调笔宽，`0`/`1` 缩放，`⌘Z/⌘Y` 撤销重做，`⌘A/I/C/X/V` 选区操作，`Delete` 清选区，方向键搬移（`Shift` 5 格），`Esc` 取消。

### 本批修掉的真实缺陷

1. **偶数跨度椭圆退化成矩形。** 原实现在整数坐标上做隐式椭圆判定，10×6 这类偶数跨度会填满整个外接矩形。改为**格心采样**（`(x+0.5-cx)/rx`）后正常。已加 3 条回归用例。
2. **笔宽滑块与 store 脱钩。** 滑块 `input` 只在「值被夹取」时才通知 store，导致界面显示 3、落笔仍按旧值。改为 `setBrushSize(size, notify)` 显式通知。
3. **工具条换行盖住画布。** 加了控件后浮层撑到 196px，`(1,1)` 那格点不动。改为单行强制（去掉工具条内笔宽、`flex-wrap: nowrap`），并加了两条回归断言。
4. **帮助面板没屏蔽快捷键。** 面板打开时仍能切工具；改为检测 `dialog[open]`。
5. **魔棒默认语义反直觉。** 原本默认在现有选区内叠加；改为默认重选、`Shift` 叠加、`Alt` 减掉。
6. **反选按钮在「有图无选区」时被禁用。** 反选空选区就是全选，改为只要有图就可用。

---

## C2 强调色保护 + 自动留空背景

### `smart-preprocessing/accent-protection.mjs`

`detectAnchorColors` 认定锚点：

- **中性锚点**：彩度 ≤ 12 的颜色里，L\* 最暗 / 最亮各一个（黑描边与高光的稳定端点）；
- **鲜艳锚点**：按 `颗数 × 彩度` 降序贪心挑，最多 3 个，且彼此**环形色相**间距 > 0.55 rad（0 与 2π 视为相邻）。

`buildAnchorLossWeights` 给锚点 40× 损失权重。

### `smart-preprocessing/auto-background.mjs`

`resolveBackgroundMask` 只把**与画面边框连通**的「够亮 + 够中性」区域判为背景：

- 亮度门槛 `L* ≥ 88`、彩度门槛 `≤ 14`；
- 从四条边框 4-连通泛洪，扩散时以**种子色**做 CIEDE2000 门槛（`maxColorDelta = 18`）防漏进异色浅区。

`applyBackgroundBlanks` 把被判定为背景的**原本有颜色**的格清成 `null`（真·空豆）。

> 关键不变量：**被图案包围的封闭浅色区必须保留。** 眼睛高光、白 T 恤、白底 logo 都在这一类。e2e 里用「红底中间一块白色方块」专门验证（`enclosedKept = 16` 格，实际保留）。

---

## C3 主体自动裁剪 + 线稿掩码

### `smart-preprocessing/subject-crop.mjs`

`floodBackgroundMask` + `boxFromMask` 求主体外接框，按 `paddingRatio = 0.04` 外扩后裁切。
返回 `coverage`（前景占比）供管线判断是否值得采纳。整幅都是背景时原样返回、不抛异常，且**总是返回新数组**（不复用引用）。

### `smart-preprocessing/stroke-mask.mjs`

线性空间 Rec.709 灰度 → Sobel 梯度 → Otsu 阈值（纯双峰退化为中值回退）→ 沿梯度方向 NMS 细线化 → `Float32Array` 连续强度掩码。`dilateMask` 容忍像素级错位，`maskDensity` 出密度。

---

## 接入生成引擎（`generation-engine-v2.mjs`）

V2.5 链路：

```
Source → [主体裁剪] → Sampling → Palette Matching → [自动留空背景]
       → [线稿掩码] → Detail Protection → Smart Cleanup
       → Protected Palette Budget（[强调色锚点保护]） → Final Grid
```

方括号四步是新增的**可选**，由四个开关控制，**默认全关**：

| 开关 | 作用位置 | 效果 |
|---|---|---|
| `subjectCrop` | 采样前，作用于源图 | 裁到主体，图案铺满；**网格宽高不变** |
| `autoBackground` | 采色后、保护图前 | 边框连通浅色 → `null` |
| `strokeProtection` | 保护图生成后 | 线稿强度下采样到格子分辨率，`protectionMap[i] = max(旧值, 强度×gain)` |
| `accentProtection` | 降色预算阶段 | 锚点色作为 `protectedKeys` 传入，阶段一不主动合并 |

`resolveOptions` 用 `=== true` 严格判定，`1`/`"yes"`/`{}`/`[]` 都不会误开。

新增诊断：`diagnostics.smartFeatures`（四个布尔）与 `subjectCrop` / `autoBackground` / `strokeProtection` / `accentProtection` 四个分项（未启用时为 `null`，便于判断「是否真的跑过」）。

### 关键设计决定：锚点保护不走 plan 后处理

`accent-protection.mjs` 里的 `applyAnchorProtectionToPlan` 假设「下游按 plan 顺序应用」，但 `applyBudgetPlan` 是**把 plan 里所有条目一次性应用**（建 `fromTo` 映射 + 传递闭包），所以「把锚点条目挪到末尾」对结果毫无影响 —— 这是一个会静默失效的集成方式。

因此本批改为在**计划构建期**保护：给 `buildPaletteBudgetPlan` 增加可选参数 `protectedKeys`，命中的颜色与 `critical` 同级，**阶段一不主动合并**；只有确实降不到 `maxColors`（阶段二）才被 `forcedProtected` 记录后合并。

- 不传 `protectedKeys` 时，`hasCritical` 的取值与旧版完全一致 → **既有行为与冻结基线逐位不变**。
- `applyAnchorProtectionToPlan` 保留为独立的通用工具（已有单测），引擎不走它。

实测（合成图，6 色 → 5）：非锚点足够消化降色时 `anchorForcedMerges = 0`，被并掉的一定来自非锚点集；降到 4 色时恰好强并 1 个锚点并被记录。

---

## UI

`ui/generation-panel.js`：

- 预设区新增 **「小白一键」**（★，排在最前）：除参数档位偏保守外，四个智能开关**一次全开**；
- 「更多设置」里新增「智能辅助」分组 + 四个独立开关；
- 既有 6 个预设的四个开关**全部保持 false**（不改变老用户行为）。

`ui/workspace.js` 把四个布尔写进 `store.generation`，经 `setProductionOptions` 传给引擎。

`app.js` 新增桥接方法 **`getGenerationReport()`**（只读，不参与计算），暴露 `smartFeatures` 与四个分项 + 预算信息，供验收脚本与排障使用。

### 顺手修掉的死代码

`GenerationPanel.renderAdvancedSection()` 定义了但**从未被 `render()` 调用** —— 也就是说「更多设置」（亮度/对比度/饱和度滑块 + 去除纯色背景开关）在界面上一直不存在，`advancedOpen` 状态与 `toggle-advanced` 点击处理都是死代码。本批把它接进 `render()`，新开关才有落点。

---

## 验证

### 单元测试

```
node --test smart-preprocessing/*.test.mjs tests/ui-refactor-baseline/*.test.mjs
→ 346/346 通过（本批前 332，新增 smart-features.test.mjs 14 项）
```

`smart-features.test.mjs` 覆盖：默认关闭时诊断干净、显式 `false` 与不传**网格逐位相同**、非布尔真值不误开、主体裁剪生效、自动背景清边框而**保留封闭浅色**、线稿掩码抬开门槛、`protectedKeys` 的阶段一/阶段二语义、四开关同时开启且确定、尺寸口径不变。

### 浏览器端到端（无头 Chrome + CDP，带真实 CSP 头的静态服务）

合成测试图 `300×300`（浅灰背景 + 中央红底 / 近黑描边 / 亮黄 / 绿叶 / 蓝块 + 一块被红包围的白色区），画布设 48×48。

| 套件 | 覆盖 | 源根 | `deploy/` |
|---|---|---|---|
| C1 `libms-tools-verify.mjs` | 工具条内容/单行回归、11 个快捷键、笔宽、连贯落笔、擦除撤销、直线 Bresenham、Shift 吸附、矩形/圆形描边与实心、魔棒、复制/粘贴/反选/全选、方向键搬移、删除撤销、帮助面板、填色取色 | **46/46** | **46/46** |
| C2/C3 `libms-smart-verify.mjs` | 预设卡片、默认全关、单开自动背景、小白一键全开、四项报告、裁剪生效、背景清空、线稿抬升、锚点识别、回退不粘连 | **27/27** | **27/27** |

关键实测数字：

- 默认（智能预设）：2,304 豆，角落 `H02`，四个分项报告均为 `null`。
- 只开自动留空背景：2,304 → **576 豆**，`blankedCells = 1728`，`enclosedKept = 16`，被封的白色区 `(27,18)` 仍为 `H02`。
- 小白一键：源图 300 → **162**（裁剪生效），2,304 − 360 空豆 = **1,944 豆 / 11 色**，线稿 `raisedAboveThreshold = 340 / strokeCells = 445`，锚点 `["H07","H02","F15","C09","B08"]`。
- 单独关掉「自动裁主体」后只有它变 `false`，其余保持 `true`。

既有已知问题（与前批结论一致，**本批不处理**）：nsfwjs CDN 404 导致 tfjs `new Function` 被 CSP 拦（3 条）；`@fontsource/maple-mono` 被 style-src 拦；`your-reward-code.png` 404。

截图存于 `docs/batch-c-shots/`：

- `workspace-beginner-mode.png`：选「小白一键」后的整页（预设卡高亮 + 画布出图）。
- `advanced-smart-switches.png`：「更多设置 → 智能辅助」四个开关。
- `generated-pattern.png`：裁剪 + 留空背景后的成品矩阵（被包围的白色区仍在）。

---

## 明确的边界（不要对外宣称成已支持）

- **主体裁剪会改变实际取景。** 它裁的是源图，网格宽高不变，所以「图变大了」其实是留白被去掉了；若原图主体本来就占满画面，`coverage` 高、几乎没有变化。
- **自动留空背景只认「与边框连通」的浅色。** 贴边但颜色偏艳的底色（如浅蓝渐变）不会被判为背景；这是刻意的保守取向。
- **强调色保护在「锚点本身就多于预算余量」时仍会降色。** 此时 `anchorForcedMerges > 0`，会在诊断里明示；不会为了保色而静默超出 `maxColors` 之外再多留色（超出的部分正是「非锚点优先被并」换来的）。
- **线稿掩码是像素级启发式，不是语义分割。** 它只提高「该处不要被清理」的权重，不保证描边一定连成 1 格宽。
- **四个开关默认全关。** 想要「小白一键」的效果必须显式选该预设或手动打开，默认路径与旧链路逐位一致。
- **`deploy/smart-preprocessing/` 里仍留有 4 个历史 `*.test.mjs`**（`region-aware-quantizer` / `regional-block-v2` / `render-policy` / `structural-transition-analyzer`），与根目录内容一致但不在部署运行集内；本批未动它们。`deploy/` 的**运行代码**已与根目录逐字节一致。

---

## 变更文件

新增：

- `smart-preprocessing/accent-protection.mjs` / `auto-background.mjs` / `subject-crop.mjs` / `stroke-mask.mjs`
- `smart-preprocessing/smart-features.test.mjs`
- `services/shapes-service.js`
- `tests/ui-refactor-baseline/shapes-service.test.mjs`

修改：

- `smart-preprocessing/generation-engine-v2.mjs`（V2.5 管线 + `beginner` 预设 + 诊断）
- `smart-preprocessing/protected-palette-budget-v2.mjs`（`protectedKeys`）
- `ui/generation-panel.js`（小白一键 + 四开关 + 接回 `renderAdvancedSection`）
- `ui/workspace.js`、`ui/grid-editor-toolbar.js`、`ui/canvas-renderer.js`
- `services/editor-service.js`、`services/viewport-service.js`、`state/project-store.js`
- `app.js`（引擎选项透传 + `getGenerationReport`）
- `styles/generation-editor.css`（工具条单行 + 帮助面板 + 分组小标题）

版本查询串：`?v=20260917-tools` → **`?v=20260917-c`**；`app.js` 里 `generation-engine-v2.mjs` 的动态导入也补上了 `?v=20260917-c`。
