# Stage C0 产品信息架构

> BASE `8d47bab` · 交付物：右栏 IA 重排 + 可达性真机门 + decodeMs 诊断接线 + Dead UI 审计
> 配套：`docs/stage-b-architecture.md`（Stage B 的算法与提交路径）

## 0. 一句话总览

Stage B 把**生成链路**做对了；Stage C0 修的是另一件事：**用户找不找得到它**。

C0 之前，8 张生成模式卡的 `getBoundingClientRect()` 全是 `0×0`，祖先链上挂着
`section.ws-panel[hidden] { display: none !important }`，而右栏 6 个 tab 里
**没有一个叫「生成」** —— 但所有探针用 `card.click()` 驱动，A–Q 场景全绿。

C0 做三件事：

1. 把右栏从「作品/图片/色彩/编辑/检查/库存」重排成「作品/图片/生成/色彩/编辑/检查/材料」，
   并把 8 个模式**移动**（不是复制）到新的「生成」tab；
2. 建一条**不依赖 `element.click()`** 的可达性门，用真命中测试 + 真鼠标点击校准；
3. 顺手用这条门做一次全界面 Dead UI 审计 —— 它当场抓出一个**已存在很久**的缺陷：
   左轨「形状/选择/镜像」三组共 9 个工具入口全部不可达（见 §8）。

---

## 1. 分类词汇：TOOL / OBJECT / PROPERTY / ACTION

C0 要求所有工作台功能按四类重新确认，**不许把不同层级混在一个 Tab 里**：

| 类 | 含义 | 例子 | 住在哪 |
|---|---|---|---|
| **TOOL** | 用户手里拿的东西，决定「点下去会发生什么」 | 画笔 / 橡皮 / 填充 / 直线 / 魔棒 / 文字 | 左轨（`#gridEditorToolbar`），唯一入口 |
| **OBJECT** | 被操作的对象 | 图纸本体 / 源图 / 文字图层 / 参考底图 | 「图片」「编辑」面板 |
| **PROPERTY** | 对象或输出的属性 | 生成尺寸 / 颜色数量 / 背景处理 / 图纸尺寸 | 「生成」面板（输出属性）、「作品」面板（图纸属性） |
| **ACTION** | 一次性命令 | 重新生成 / 导出 PNG / 清理杂点 / 扣料 | 「生成」面板顶部、「检查」面板、工具坞导出抽屉 |

**两条纪律：**

- **一个 ACTION 只在一个地方渲染。** 左轨「施工模式」按钮是唯一的一级模式入口，
  它不在 tab 数组里（见 §7）。
- **TOOL 不进 Tab。** 工具在左轨；面板只负责 OBJECT / PROPERTY / ACTION。
  右栏任何面板里出现「画笔/橡皮」这类工具选择，都是层级混用。

---

## 2. 两个产品层级：PROJECT 与 OUTPUT

同一份数据在不同层级上**名字必须不同**，否则用户分不清自己在改什么。

| | PROJECT（作品） | OUTPUT（输出） |
|---|---|---|
| 是什么 | 当前这份设计 | 这次要生成/导出的规格 |
| 尺寸 | **图纸尺寸**（宽高独立，可非正方形） | **生成尺寸**（唯一自由度：长边格数） |
| 入口 | 「作品」面板 → `#ws-resize-open` → 对话框 | 「生成」面板 → 尺寸草稿 + `#ws-size-apply` |
| 改了的后果 | 裁切/补边，**不重新匹配颜色** | 重跑算法，**颜色会变** |
| 状态 | `state.canvas.{width,height}` | `state.generation.longEdgeDraft` |

**这两个是独立链路，不共用 state。** 历史上它们都叫「画布尺寸」，用户无法区分
「我想把成品做大一点」和「我想把已经画好的图纸裁小一点」—— C0 §7 把两条链路
在文案和代码注释上彻底分开（详见 §5）。

---

## 3. 右栏 7 个 Tab

`ui/workspace.js` 的 `INSPECTOR_TABS`：

```js
const INSPECTOR_TABS = [["project","作品"],["source","图片"],["generation","生成"],
                        ["color","色彩"],["edit","编辑"],["check","检查"],["material","材料"]];
```

| Tab | 层级 | 职责 | 不负责 |
|---|---|---|---|
| 作品 | PROJECT | 作品身份、图纸尺寸、工程存取、生成历史的作品库 | 生成参数 |
| 图片 | OBJECT | 源图本身：参考底图、原图对照 | 生成参数 |
| **生成** | OUTPUT | **生成尺寸 + 8 个模式 + 生成参数 + 生成状态 + 重新生成** | 图纸尺寸 |
| 色彩 | PROPERTY | 色号墙、用色统计、替换、相近色、手动合并 | 生成模式 |
| 编辑 | OBJECT+TOOL | 选区、历史、描边、巡检与修复、文字图层 | 生成参数 |
| 检查 | ACTION | 问题分类、清理杂点、诊断读数 | 生成参数 |
| 材料 | PROJECT | 本作品用豆、底板与采购、豆子库存台账 | 生成参数 |

**「库存」→「材料」是扩语义，不是删功能。** 材料面板 = 新语义（本作品用豆 +
底板数量 + 实物厘米数）三节 + **原封不动的 `InventoryPanel`**。
`ui/inventory-panel.js` 的 15 项能力逐条被测试点名守着（见 §9）。

---

## 4. 「生成」Tab 里有什么

```html
<section class="ws-panel" data-ws-inspector="generation">
  <!-- ① 生成尺寸：#ws-size-chips / #ws-size-range / #ws-size-number
       #ws-size-value / #ws-size-apply / #ws-size-authority / #ws-size-tier
       —— 这 7 个 id 从顶栏**整体搬入**，没有重命名，所有既有探针继续有效 -->
  <!-- ② 生成参数：<div id="generationPanel"></div> —— 从「色彩」面板搬来 -->
  <!-- ③ 生成状态：<div class="ws-readout" id="ws-generation-status"> -->
</section>
```

`ui/generation-panel.js` 的 `render()` 现在第一段是 `renderActionSection()`：

```html
<button type="button" class="sl-primary-action" id="ws-generation-regenerate" data-action="generate">
  <strong>重新生成</strong><small>按当前设置重算整张图纸</small>
</button>
```

这段以前是**死代码**：`bindEvents()` 里有 `case "generate"`，`workspace.js` 也传了
`onGenerate`，但 `render()` 从来没渲染出任何 `[data-action="generate"]` 元素。
C0 把它渲染出来，于是那条 handler 第一次真正通电。

`onGenerate` 的行为和工具坞的 `#ws-generate` **完全一致**（含手动编辑确认）：

```js
onGenerate: async () => {
  if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
  try { await generation.generate({ overwriteApproved: true }); } catch (error) { ... }
}
```

> ⚠️ **遗留（C1）**：现在同一个 ACTION 渲染了两处 —— 「生成」面板里常驻的
> `#ws-generation-regenerate`，和工具坞里 `hidden = !(hasSource && manualEdited)`
> 才出现的 `#ws-generate`。功能等价、都带确认，但属于 §1「一个 ACTION 只渲染一处」的
> 例外。C1 应择一：删掉工具坞那个（要同步改 `stage-b-master-probe.mjs`
> 与 `b4-auto-tune-probe.mjs`，它们都用 `#ws-generate` 驱动），或者把面板那个
> 改成只在 `manualEdited` 时出现。

---

## 5. 生成尺寸 vs 图纸尺寸

### 5.1 命名分离（§7）

| 旧文案 | 新文案 |
|---|---|
| 画布尺寸 | **图纸尺寸** |
| 调整画布尺寸 | **调整图纸尺寸** |
| 调整画布 | **调整图纸** |
| 调整画布不会重新匹配颜色。 | **调整图纸**不会重新匹配颜色。 |
| `mode==="canvas" ? "调整画布" : "缩放图案"` | `mode==="canvas" ? "调整图纸" : "缩放图案"` |

**「画布」这个词在界面里专指 `<canvas>` 元素。** 所以 `workspace.js` 里
「画布宽高只从 state 取」这类**渲染器注释**保留不动 —— 那句说的是 canvas 尺寸，
和图纸尺寸无关。测试只点名 `画布尺寸` / `调整画布` 两个具体说法，
不做全文件模糊扫描（模糊扫描会被无关键注释误伤，然后被人加白名单加废）。

### 5.2 顶栏只剩视图缩放

`topControls.innerHTML` 现在只有 `<div id="zoomControls" class="ws-top-zoom">`。
`.ws-top-controls` 加 `justify-content: flex-end`、`.ws-top-zoom { margin-left: auto }`。

**`min-height: 50px` 刻意保留** —— `.ws-canvas-area` 的行轨契约和底部工具坞的定位
都按它算，删掉会让画布区行高塌陷。

---

## 6. `maxColors` 的显示层（§6）

`0` 是内部哨兵值（= 不限制），**不直接甩给用户看**。

```js
[["0","不限制"],["8","8"],["16","16"],["24","24"],["38","38"],["64","64"]]
  .map(([value,label]) => `<button type="button" data-color-cap="${value}">${label}</button>`)
```

- 档位按钮与数字框走**同一条** `setState`，没有旁路字段；
- 读数把 0 翻译成人话：`不限制（由算法按画面自行决定）` / `最多 24 色`；
- 标题从内部字段名 `最大颜色数` 改成 **`颜色数量`**，提示改成
  「限制最终图纸的用色数；不限制时由算法自行决定」；
- **数字框的 `min="0" max="221"` 和取值区间一个都没动** —— 生成侧一条限制都没新增，
  改的只是显示层。面板里不许出现 `Math.max(1, Number(settings.maxColors))` 这类
  「把 0 抬成 1」的代码（有测试点名守着）。

---

## 7. Tab 状态的唯一真源

`state/store.js:319` 的 `ui.activePanel` 是唯一真源（默认 `"project"`）。
显隐逻辑在 `ui/workspace.js` 一处，没有 `colorTabActive` / `generationTabOpen` /
`inventoryVisible` 这类平行布尔量（有测试断言它们不存在）。

**`build`（施工）面板不在 tab 数组里。** 它只能由左轨「施工模式」按钮经
`store.setState({ ui: { activePanel: "build" } })` 激活 —— 属于 §18 的
`reachable-but-not-a-tab`：可达，但不是一级 Tab。`right.querySelector(".ws-side-tabs").hidden = buildMode`
把 tab 条藏起来，避免用户在施工模式里切走。

---

## 8. 可达性门（§8 / §9 / §10）

### 8.1 它存在的唯一理由

`HTMLElement.click()` **能穿透 `display: none`**。它不看可见性，直接派发事件。
所以「点一下看有没有反应」这种探针，对「用户找不找得到入口」**零信息量**。

C0 的实测证据（探针最后两条断言）：

```
✓ 反向验证：面板切走后模式卡被判为不可达  — code=TARGET_NOT_USER_REACHABLE 0×0 ancestorHidden=true
✓ 反向验证：同一个隐藏元素 element.click() 照样生效（旧判据的假绿来源）
```

同一个元素：门说不可达，`element.click()` 照样触发。**这就是假绿的来源。**

### 8.2 九条判据（`tools/ui-reachability-gate.mjs`）

① 存在 ② 自身 `display !== none` ③ **祖先链上没有 `display:none` / `visibility:hidden`**
④ 自身 `visibility` ⑤ 有效 opacity > 0（自身 × 所有祖先，逐层相乘）
⑥ `width > 0` ⑦ `height > 0` ⑧ `pointer-events !== none`
⑨ 滚到最近位置后仍在视口内，且**中心点 `elementFromPoint` 命中它自己**

> ⚠️ ③ 必须单独查：`getComputedStyle(child).display` **不会**继承祖先的 `display:none`，
> 它返回 child 自己声明的值（通常是 `block`）。只查自身 display 的门会对着一个
> 藏在 `display:none` 面板里的按钮说「可见」。

另有两个独立失败码（它们不是「看不见」，是「看得见但点不动」）：
`TARGET_POINTER_EVENTS_NONE` / `TARGET_DISABLED`。

### 8.3 `invoke-handler-only` 声明可以反证

0×0 或 `display:none` 一律 FAIL `TARGET_NOT_USER_REACHABLE`，**除非显式声明
`invoke-handler-only`**（意思是「这个元素故意不给用户直接点，由另一个控件触发」，
例如 `<input type="file" hidden>` 由「添加 / 替换」按钮触发）。

声明方必须给出 `triggeredBy`，且触发者本身要在同一张清单里、走完整套可见性门。

**声明是可反证的**：如果声明成 `invoke-handler-only` 的元素其实可见可点，门报
`INVOKE_HANDLER_ONLY_BUT_VISIBLE`。所以「给所有东西贴个 invoke-handler-only 就全绿」
这条捷径不存在。

> ⚠️ **反证判据必须和主路径一样强。** 第一版反证只查 display / visibility / 尺寸 /
> pointer-events 四项，结果把落地页那个 `class="file-input-hidden"` 的
> `<input type="file">` 误判成「声明与事实不符」—— 它是 1×1 + `opacity: 0.01`，
> 四项全「看起来正常」，但中心点命中的是盖在它上面的 `section.generator-intro`。
> 补上 `hitTestSelf` 之后，一个**正确**的声明才能老实过门。

### 8.4 覆盖清单（§9，11 组 / 35 条）

| 组 | 条数 | 内容 |
|---|---|---|
| 生成 Tab | 1 | 右栏「生成」tab |
| 生成模式 | 8 | 小白一键 / 智能 / 人像 / 动漫 / 插画 / 像素 / Logo / 写实 |
| **左轨工具** | **9** | 形状（直线/矩形/圆形）+ 选择（框选/魔棒/同色/连通）+ 镜像（左右/上下） |
| Palette Picker | 2 | 色号搜索框、色格墙第一个色格 |
| Usage Strip | 2 | 排序按钮、第一张卡 |
| Resize | 1 | 「调整尺寸」按钮 |
| Text | 1 | 「+ 添加文字」 |
| Reference | 2 | 「添加 / 替换」+ 它的 hidden file input |
| Diagnostics | 2 | 问题分类下拉、「清理杂点」 |
| Material | 3 | 「材料」tab、本作品用豆读数、库存台账首节 |
| Export | 2 | 工具坞「导出」+ 抽屉里的 PNG / PDF |

另有 5 条编排断言（落地页就绪、工作台挂载、首帧生成、真点击校准 ×2、反向验证 ×2）。

**实测：47/47 PASS · 0 FAIL**（`tools/ui-reachability-probe.mjs`，走生产 CSP 头）。

### 8.5 真点击校准

门说「点得中」→ 用 CDP `Input.dispatchMouseEvent` 在同一个中心点**真点一下** →
状态必须真的变。如果门和真点击对不上，那门就是在自说自话。

```
✓ 校准：真鼠标点「生成」Tab 真的切换了面板  — before=false after=true 点击点=(1287,98)
✓ 校准：切换后「生成」面板真的显示出来
```

### 8.6 写探针时踩到的两个竞态（都会伪造成「产品缺陷」）

**① 抽屉滑入动画的第 0 帧。** 导出抽屉是 `transform: translateX(101%)` +
`visibility: hidden`，`.open` 一挂上就进入 240ms 过渡。只等
`classList.contains("open")` 会在第 0 帧就量：此时 `visibility` 还是 `hidden`
（`visibility` 会继承，里面的按钮跟着一起 hidden），`transform` 还没走完，
按钮 rect 落在视口右侧外面（x≈1444 @ 1440 宽）。门如实报
`TARGET_NOT_USER_REACHABLE` —— 但那是**探针的竞态**。

→ 必须等到 `getComputedStyle(d).visibility === "visible"` **且**
`r.right <= window.innerWidth`。

**② 浮层遮挡。** 导出抽屉 `z-index:30` 贴在右侧，开着的时候正好盖住右栏 tab 条。
拿那个状态去校准「真鼠标点生成 Tab」，只会得到一个假的 FAIL。

→ 校准前必须先关抽屉，并等它真的关掉（同样是过渡）。

**这两个坑写进了测试**（`tests/ui-reachability.test.mjs`），防止有人「简化」掉等待条件。

---

## 9. Dead UI 审计（§18）

`tools/ui-dead-audit.mjs` —— 穷举界面状态，每个状态下把候选控件全量过一遍门，取并集。

**状态集（13 个）**：落地页 / 右栏 7 个面板 / 施工模式 / 「新建·导入」折叠菜单 /
导出抽屉 / 调整图纸尺寸对话框 / 新建空白图纸对话框 / 用豆清单对话框。

**分类（`classifyDeadUi()`，纯函数，有单测）：**

| 类 | 含义 |
|---|---|
| `reachable` | 至少一个状态下真的能点到 |
| `disabled` | 看得见、点得动、只是当前没得用（没有撤销历史时的撤销键） |
| `covered` | 有盒子、滚得到，但中心点被别的层占了 |
| `hidden` | `display:none` / 0×0 / 祖先隐藏，且没有任何状态能露出来 |
| `absent` | 任何状态下都不存在 —— **这才是真死代码** |
| `compat` | 旧界面遗留，由 `ui/legacy-ui-policy.js` 登记表认领 |

> ⚠️ **`disabled` 必须和「够不到」分开报。** 混成一句「不可达」，报告里会塞满
> 「没有撤销历史时的撤销键」这种噪音，真正该修的那几条被淹掉。
> 第一版审计没分开，280 个控件「从未可达」，几乎全是噪音。

**实测（328 个交互控件）**：`reachable 154` · `compat 79` · `hidden 48` ·
`disabled 31` · `covered 16` · `absent 0`。

### 9.1 🔴 审计抓到的真缺陷：左轨三组入口全部不可达

**这是 C0 最有价值的产出，因为它已经存在很久而没人发现。**

```
button[data-tool="line"]   panel:project 37×38 display=flex vis=visible disabled=false
                           命中=div#ws-canvas-well.ws-canvas-well  «直线»
```

**根因是一对被测试锁死的、物理上互斥的 pin：**

```css
/* Stage A hotfix：防 102px 窄栏横向溢出 */
.ws-rail { overflow-x: hidden !important; overflow-y: auto; }
/* Stage A hotfix：子菜单向右浮出 */
.sl-rail-menu .sl-tool-menu { position: absolute; left: calc(100% + 8px); top: 0; }
```

`.sl-tool-menu` 的**包含块**是 `.sl-rail-menu`（`position: relative`，在左轨内部），
落在裁剪框里面 —— 所以「从 100% 再往右 8px」那一整块**被整块裁掉**。
按钮有 37×38 的盒子、`display=flex`、`visibility=visible`，
但中心点 `elementFromPoint` 命中的是 `div#ws-canvas-well`。真鼠标点不到。

而 `tests/stage-a-hotfix.test.mjs` **同时 pin 了这两条**（第 12 行与第 14 行），
所以任何单看这个测试的人都会以为它是好的。

**影响面：形状（直线/矩形/圆形）+ 选择（框选/魔棒/同色/连通）+ 镜像（左右/上下）
= 9 个工具入口全部不可达。** 而且任何用 `element.click()` 驱动的探针都会说它们 PASS。

> 计数口径：`targetsForPhase("workspace")` 里 group 为「左轨工具」的目标是 **9 个**
> （形状 3 + 选择 4 + 镜像 2）。可达性报告里这一组打出 **12 行**，多出来的 3 行是
> 每个菜单各一条「子菜单可展开」检查 —— 它验的是菜单本身，不是里面的工具。
> 写报告时别把 12 当成「12 个入口」。

**修法（桌面端）**：改成「就地展开」，不再向右浮出。

```css
body.phase2-workspace .ws-rail .sl-rail-menu .sl-tool-menu {
  position: static !important; right: auto !important; bottom: auto !important;
  left: auto !important; top: auto !important; width: 100% !important;
}
```

**修法（≤760px）**：移动端左轨是贴底的横向条（`overflow-y: hidden`，高 58px），
就地展开会被条高裁掉 → 改用 `position: fixed` 浮到条上方，脱离裁剪。
（`styles/pixler-skin.css` 里对坞的 `.sl-tool-menu` 踩过**同一个坑**，
注释写着「实测 18 个工具只有 6 个能点到」。）

**修完的实测**：9 条左轨断言全部 PASS，`命中=svg` / `命中=span.sl-tool-glyph`
（命中的是按钮内部的图标，`el.contains(hit)` 成立）。
并且这 9 条已经进 `REACHABILITY_TARGETS`，下次谁把它改回浮出，门会立刻红。

> 📌 教训：**两条 pin 可以互相矛盾，而测试只会各自通过。**
> 断言之间的一致性不在任何单条测试的视野里 —— 只有把界面真的跑起来量一遍才发现。

### 9.2 `hidden` 48 条里的四类（都不是缺陷）

| 类 | 例子 | 为什么不是缺陷 |
|---|---|---|
| 按需出现的控件 | `#ws-bg-preview-apply`、`#ws-draft-restore`、`#ws-usage-only`、`#ws-merge-*` | 它们由「检测到纯色背景」「有草稿」「选中了颜色」等条件触发，C0 的状态集没构造这些条件 |
| 条件可见的工具坞按钮 | `#ws-generate`（`hidden = !(hasSource && manualEdited)`）、`#ws-boards-choice`（不需要分板时 disabled） | 设计如此 |
| 隐藏 file input | `#ws-project-file`、`#ws-ref-file`、`#ws-usage-file`、`#inv-import-file` | 由按钮触发，属 `invoke-handler-only` 形态 |
| **旧界面遗留** | `#mobile-*`（5 个）、`#board-select`、`#preview-stage`、`#preview-download-button`、`#ws-blank-*`、`#ws-engine`、`#ws-legacy-retry`、`#ws-cancel-generate`、`#ws-open-editor`、`#ws-message` 系列 | 属旧单页外壳，见 §10 |

### 9.3 `covered` 16 条

- `#file-input` / `#direct-pattern-file-input`（落地页，1×1 被 `section.generator-intro` 盖住）
  —— 正常，它们由拖放区触发；
- 7 个生成参数复选框 `input[data-field="preserveEyes"]` 等（13×13，中心点命中
  `<small>` / `<span>`）—— 复选框在 `<label>` 内，点标签一样能切换，属正常形态。

---

## 10. legacy compat 的权威来源

`ui/legacy-ui-policy.js` 登记了 12 个旧对话框，并给它们打上
`data-legacy-ui="compat"` + `data-legacy-owner="app"`：

```
preview-modal / register-modal / link-import-modal / direct-pattern-modal /
assembly-modal / exit-modal / donate-modal / editor-modal / blank-board-modal /
pattern-adjust-modal / grid-align-modal / export-settings-modal
```

**审计直接读 DOM 上的这个标记**，不另立一套 compat 名单（两处会漂移）。
登记表里的控件一律归 `compat`，不再逐条分类 —— 它们已经有明确的存在理由和 owner。

`blank-board-modal` 是个有意思的例子：它由**新**界面（顶栏「新建 / 导入」菜单的
`#ws-new-blank`）打开，但对话框本体仍归 `app` 所有 —— 典型的「新壳开旧窗」过渡态。

---

## 11. decodeMs 诊断接线（§15）

`decodeMs` 是 Worker 里 `tDecode` 的实测耗时，此前**在报告里是缺的** ——
于是「500 档为什么慢」只能靠猜。

接线路径：

```
worker-client 量 tDecode → result.decodeMs
  → services/auto-tune.mjs：base.decodeMs / decodeMsSource
       · 缓存命中        → decodeMs: null, decodeMsSource: "cache-hit"
       · 预览候选        → 从 result.decodeMs 取
       · finalDecodeMs   → 复用赢家网格（"preview"）/ 重跑正式（"final"）
  → app.js runAutoTuneV2 返回体补 decodeMs / decodeMsSource
  → window.__libmsCommitProfile.push({ label: "decodeMs(workerClient)", ms, source })
```

**纪律**：`stripEntry` 保持**显式白名单**，不含 `decodeMs` / `diagnostics` ——
诊断字段不许混进会参与排序比较的候选记录里。
缓存命中时必须如实报 `null` + `"cache-hit"`，不能谎报一个 0。

**实测**：`node tools/stage-b-master-probe.mjs --all` 的场景 F（500 长边）里，
`decodeMs(workerClient)` 在智能模式下**不再为 null**。

---

## 12. 响应式（§12）

断点：

| 断点 | 变化 |
|---|---|
| ≤1180px | 品牌缩到 125px，`small` 与状态隐藏 |
| ≤1100px | `--ws-inspector-width: 280px`；品牌 155px；状态隐藏 |
| ≤900px | `#ws-project-meta` 隐藏；品牌 105px |
| **≤760px** | **左轨变成贴底横向条**（`position: fixed; bottom: 0; height: 58px`）；右栏变成贴右滑出面板（`position: absolute; width: min(300px, calc(100vw - 56px))`）；`.ws-brand span:last-child` 隐藏 |
| ≤720px | 落地页 `#ws-start-options` 单列 |
| `prefers-reduced-motion` | 抽屉过渡降级为 `visibility 0s, opacity .12s`；按钮 `:active` 不动 |
| `prefers-contrast: more` | 激活态描边加强 |

≤760px 的三条关键规则：

```css
/* 左轨：横向条 + 子菜单 fixed 浮到条上方（否则被 overflow-y: hidden 裁掉） */
body.phase2-workspace .workspace-grid[data-workspace-ready="true"] > .ws-rail {
  position: fixed; z-index: 72; left: 0; right: 0; bottom: 0; width: 100% !important;
  height: 58px; flex-direction: row !important; overflow-x: auto !important; overflow-y: hidden;
}
.phase2-workspace .sl-rail-menu .sl-tool-menu {
  position: fixed !important; left: 8px !important; right: 8px !important;
  bottom: 64px !important; width: auto !important; z-index: 90;
}
```

**§12 要求的验收**：生成模式在 Tablet / Mobile 视口下仍然可达（四档视口截图 + 门复核）。

### 12.1 🔴 四档视口 QA 抓到的真回归：移动端左轨 9 个工具全不可达

四档跑下来 **1440 / 1280 / 768 都是 47/47 PASS，390 是 37/47**。
红的 10 条里，9 条是左轨工具，1 条是落地页上传拖放区。

**症状（390×844 实测）**：三个 `.sl-tool-menu` 的计算 `position` 是 **`static`**，
矩形 y = 897 / 997 —— 而视口只有 844 高。9 个工具的 `elementFromPoint` 全返回 `null`。

**根因是 CSS 特异性，不是媒体查询没生效**（同一个 `@media` 块里的
`position: fixed` 左轨规则明明生效了）：

| 规则 | 位置 | 特异性 | `!important` |
|---|---|---|---|
| 桌面「就地展开」 | `workspace.css:530` | **(0,4,1)** | ✅ |
| 移动端「浮起」 | `workspace.css:558`（`@media max-width:760px`） | (0,3,0) | ✅ |

**两条都带 `!important` 时，只有特异性说了算，跟源码顺序无关** ——
所以桌面的 `static` 压掉了移动端的 `fixed`，移动端那条成了死代码。

**这是 C0 §18 引入的回归**：C0 之前那条规则是
`.sl-rail-menu .sl-tool-menu { position: absolute; … }`（(0,2,0)、**无** `!important`），
移动端的 `!important` 能压住它，所以移动端本来是好的。
C0 给它加了 `body.phase2-workspace .ws-rail` 前缀和 `!important`，
顺手把移动端那条判了死刑 —— 而 `tests/stage-a-hotfix.test.mjs`
当时 pin 的是旧的浮出版本，看不出这件事。

**修法**：把桌面规则切进 `@media (min-width: 761px)`。
用媒体查询切开比调特异性稳 —— 桌面规则在 ≤760px **根本不存在**，没有优先级可打。

```css
@media (min-width: 761px) {
  body.phase2-workspace .ws-rail .sl-rail-menu .sl-tool-menu { position: static !important; … }
}
```

修完复量：三个菜单 `position: fixed`，矩形 y = 695 / 736 / 736（都在视口内），
9 个工具全部 `hitTestSelf = true`。

回归守卫：`tests/rail-submenu-breakpoint.test.mjs`（4 例）。
它不断言「某条规则长什么样」，而是断言**断点区间不重叠** ——
同一属性上不许有两条都能作用于同一宽度的 `!important` 规则。

### 12.2 🔴 同时暴露的门缺陷：clamp 出来的假失败

落地页上传拖放区那条 FAIL，detail 写着
「中心点命中的是 `button#mobile-process-button`」。查下去发现是**门的错**，不是产品的：

```js
// tools/ui-reachability-gate.mjs 采集器（改之前）
const x = Math.min(vw - 1, Math.max(0, rect.left + rect.width / 2));
const y = Math.min(vh - 1, Math.max(0, rect.top + rect.height / 2));
```

**clamp 会给视口外的元素凭空造一个视口边缘的点**，再拿它做命中测试。
390×844 上拖放区中心 y = 1252、视口高 844 → 被夹到 843 → 命中了贴底操作条上的按钮 →
门报 `TARGET_HIT_TEST_MISS`。而真相只是「它在折叠线以下」。

还有第二个原因：采集器滚动用的是 `block: "nearest"`。
`nearest` 的语义是「**滚动容器认为**它露出来了就停」，它不知道视口边缘上压着
`position: fixed` 的浮层。拖放区 118px 高，`nearest` 滚到 726–844 就停了，
而 `.mobile-tabbar`（745–844，z-index 100）盖掉了其中 99px，只剩 19px 露出来。

**两处都改**：

1. `block: "nearest"` → `block: "center"` —— 问的才是那个真问题：
   「用户把它滚进视野之后，点得中吗？」
2. 去掉 clamp，如实记 `centerOutsideViewport`，并新增失败码
   **`TARGET_OUT_OF_VIEW`**。「还得滚更多」和「那个位置上是别的东西」
   修法完全不同，混成一个码会让人去改 CSS 遮挡，而其实只要滚一下。

回归守卫：`tests/hidden-click-guard.test.mjs` 新增 3 例
（含一条**直接断言采集器里不许再出现 clamp** 的守卫）。

---

## 13. `deploy/.git` 审计（§17，只读）

**结论：这是误 `git init` 出来的空仓库，建议清理，但本轮不动手。**

| 项 | 值 |
|---|---|
| 路径 | `deploy/.git` |
| 物理占用 | ≈100 KB（321 个松散对象，逻辑 4.61 MB） |
| `HEAD` | `ref: refs/heads/main` |
| `refs/heads` | **空** → 无任何引用，`git rev-list --all --count` = 0 |
| 远端 | **无**（`git remote -v` 空） |
| reflog | 有一条 `commit (initial): 初始提交：libms-studio 拼豆图纸生成器` |
| 悬空提交 | `06f3ff13…` **对象仍在**（`cat-file -t` = `commit`，803 字节，树 18 项） |
| 父仓库是否忽略 | **否**（`git check-ignore` 退出码 1） |
| 父仓库跟踪状态 | `deploy/` 274 个文件**正常跟踪**，`git status` 里是普通 `M`，没有被当成 gitlink |

**判断：**

1. **它没有破坏父仓库。** 嵌入式仓库通常会让父仓库把 `deploy` 当成 gitlink、
   从而不再跟踪里面的文件 —— 这里没有发生（274 个文件照常 `M`）。
2. **真正的风险是发布面。** `netlify.toml` 的 `publish = "deploy"`，而 Netlify
   会上传点文件。`.git` 里的悬空提交消息**写着完整的合规清理叙事**
   （剥离 GPL 模块、删 276 MB 构建产物、仓库体积从 149 MB 降到 18 MB）——
   这些是内部信息，不该随站点公开可取。
3. **建议**：删掉 `deploy/.git`（顺带 `deploy/.gitignore` 也一并考虑，
   它把 `tests/fixtures/b0-size/` 写进忽略表，对发布目录没有意义）。
   加一条 `_headers` 或发布前检查更稳。

> ⚠️ 本轮**没有执行任何删除**。批量删除前需要明确确认。

---

## 13.5 提交路径的「隐藏面板成本」（§16 性能门）

### 13.5.1 症状与第一手数据

C0 首轮全量探针报出一条硬门失败：

```
FAIL  F 500 档提交阶段不比 B3 基线更差（硬回归门 1150ms）  commitTotal=1158.5ms
KNOWN §14 提交阶段 <800ms 目标未达成  实测 1158.5ms · chartUrl 496.2ms + eventDispatch 540.2ms
```

对照 B5 发布门基线（`docs/stage-b-architecture.md` §8.3，500 档 899.6 / 449.3 / 343.4），
涨的是 `eventDispatch`（343.4 → 540.2）。`eventDispatch` 是
`libms:project-result` 的**同步监听者**耗时，也就是 `ui/workspace.js` 的 handler
→ `store.setState` → `paint()` 这一整段。

### 13.5.2 先修工具，再谈数字

`--only F` **不能**用来复测这一档。原因不是产品，是等法：

F 之前没跑过任何场景 → 页面是第一次上传 → 「上传 → 本地内容审查」首次要下
~4.8 MB 模型。那段下载期间 `isGenerating()` 是 false、计数器也不动，
master probe 的 `waitStable(1500)` 会把**下载的空档**误判成静止；紧接着的
`bridge.generate({500,500})` 撞上首帧自动生成，被 `processImage` 的
「正在生成，请稍候」拒掉，而 `waitNewResult` 随即被**自动生成那一轮**唤醒 ——
探针拿到 200×200，却打印 `commitTotal=201.4ms` 并且**判 PASS**。
一次假绿灯，而且它长得像「性能很好」。

于是新增 `tools/c0-commit-profile-probe.mjs`：驱动方式与 master probe 完全一致
（同一个 `bridge.generate`、同一份 commit profile），只有等法不同 ——
**「图纸已经存在」才算静止**（`grid.length > 0 && !isGenerating()` 连续稳定）。
它还顺带在页内实测一次「整幅深拷贝」的真实代价。

### 13.5.3 根因：按格数计费的重算，算给了看不见的面板

`services/export-v2-service.js` 的 `grid()` 是**整幅深拷贝**：

```js
const grid=()=>getGrid().map(row=>row.map(cell=>cell?{...cell,rgb:[...cell.rgb]}:null));
```

而 `estimate()` 和 `split()` 内部都会调它。500×500 = 25 万格，
一次克隆就是 25 万个对象。页内实测：40 000 格 2.1 ms → 外推 250 000 格 ~15 ms，
叠加分板扫描后更贵。

`paint()` 在一次提交里会被叫醒**多次**（store 订阅 + 若干次 `setState`）。
C0 之前 `paint()` 里有**一处**无条件调用：

```js
if (hasPattern) {                            // ← 只要出过图，每次 paint 都算
  const estimate = exportV2.estimate(...);   // 内含一次深拷贝
  const split = exportV2.split();            // 再一次
  ...
}
```

导出抽屉默认是**关着**的。C0 又把「材料」面板的备料清单也接到了
`exportV2.split()` 上（同样是隐藏面板），于是每次提交再多算一份。

### 13.5.4 修法：两条守卫，同一个原则

| 位置 | 改法 | 效果 |
|---|---|---|
| 导出抽屉摘要 | `if (hasPattern && state.ui.exportDrawerOpen)`，开着时再按 `gridRevision` 缓存 | 关着不算；开着也只算一次 |
| 材料面板 `renderMaterial` | `if (state.ui.activePanel !== "material") return;`，放在签名判断**之前** | 不是当前 Tab 就一个字段都不算 |

**关键细节**：`renderMaterial` 的提前返回**不能写 `materialSignature`**。
写了就等于把「没算过」记成「算过了」，切回该 Tab 会看到空面板 ——
这是「用缓存换性能」最容易引入的静默失效，`tests/commit-path-hidden-work.test.mjs`
用「提前返回之前不许出现 `materialSignature =`」把顺序钉死。

### 13.5.5 修完的实测（同口径 A/B，同一台机器，背靠背）

只报「隔离复测」是不够的 —— 那换了一套口径，而门用的是 `--all` 里场景 F 的口径。
所以又做了一次**同口径 A/B**：`node tools/stage-b-master-probe.mjs --only A,B,C,D,E,F`
（让 F 前面真的跑过 A–E，与 `--all` 完全一致），先用修复前的代码跑一遍，
再用修复后的代码跑一遍：

| 口径 | 代码 | `commitTotal` | `chartUrl` | `eventDispatch` |
|---|---|---|---|---|
| `--only A,B,C,D,E,F` | 修复前 | **1019.6** | 485.6 | **422.7** |
| `--only A,B,C,D,E,F` | 修复后 | **902.5** | 458.4 | **329.6** |
| | | **−117.1** | −27.2 | **−93.1** |

隔离复测（`tools/c0-commit-profile-probe.mjs`，各档两轮）：

| 长边 | 指标 | 修前 | 修后 | B5 发布门基线 |
|---|---|---|---|---|
| 400 | `commitTotal` | 643.7 | **608.0 / 605.1** | 586.2 |
| 400 | `eventDispatch` | 262.7 | **222.3 / 226.0** | 214.6 |
| 500 | `commitTotal` | 992.4 | **877.9 / 860.5**（另两次 855.0 / 861.3） | 899.6 |
| 500 | `eventDispatch` | 375.0 | **294.1 / 284.2**（另两次 275.1 / 276.7） | 343.4 |

两种口径给出同一个结论：**修后 500 档 ≈ 900ms，与 B5 发布门基线持平，
硬回归门（1150ms）有余量。**

- 省下的钱**多于一次深拷贝**（~15 ms）—— 因为原写法是「每次 paint × estimate + split
  两次克隆」，这正是「paint 会被叫醒多次」的倍数。
- **`<800ms` 仍未达成**（902.5 ms）。剩下的钱在 `chartUrl`（画 5100×5100 画布 +
  PNG 编码，458 ms）和 `syncLegacy` 这类既有同步监听者里。
- 顺手排除过一个怀疑对象：`getPaletteIndex` 给 25 万格逐格建 `{x,y}` 对象，
  看起来是最大的一笔分配，实测只值 **8.8 ms**（Node 微基准，500×500）。
  不值得为它改 `services/palette-usage.js` 的对外契约 —— 结论记在这里，省得下次再查一遍。

### 13.5.6 ⚠️ 这个门的单次采样不可信（重要，别被它骗）

`--all` 里场景 F 的单次读数**会被机器负载整个吃掉**。实测三次同样的代码：

| 采样 | 条件 | `commitTotal` |
|---|---|---|
| `--all` #1 | 机器有别的负载 | 1158.5 |
| `--all` #2 | 机器有别的负载（load avg 4–6，另有一个卡住的 headless Chrome） | **1312.2** |
| `--only A,B,C,D,E,F` | 同一台机器，安静一些 | **902.5** |

同一个 commit 路径，902.5 与 1312.2 差 **410ms（+45%）**。
把 1312.2 当成回归会去改根本没坏的东西；把 902.5 当成达标会漏掉真的回归。

还有一层**协议性**偏差，与负载无关、可复现：`--all` 里 F 排在第 6 个，
同一个 origin 已经跑过 A–E 五次「整页重载 + 上传 + 生成」。
`Page.navigate` 清 JS 堆，但**不清 localStorage / IndexedDB / 缓存** ——
草稿、作品画廊、库存台账都会累积，而这些都会进 `paint()`。
实测：在**未改动的代码**上先做 5 次整页载入再测 500 档，
`commitTotal` 从 855 涨到 **1028.8**，`eventDispatch` 从 275 涨到 **374.2**。
（`tools/c0-commit-profile-probe.mjs` 的 `LIBMS_WARM_LOADS=5` 就是干这个的。）

**所以**：

- 要判定回归，用 `--only A,B,C,D,E,F` 做**背靠背 A/B**，或
  `c0-commit-profile-probe.mjs` 多轮取最小值。**不要拿单次 `--all` 的 F 下结论。**
- `--all` 里那条 `FAIL … 1150ms` 仍然保留（它是发布门的原样），
  但读它的时候必须知道它的方差有多大。

---

## 14. 硬不变量

| # | 不变量 | 守卫 |
|---|---|---|
| 1 | 右栏 tab 恰好 7 个，顺序固定 | `tests/right-panel-tabs.test.mjs` |
| 2 | `#generationPanel` 只挂一次，且在「生成」面板里 | `tests/right-panel-tabs.test.mjs`、`tests/workspace-size-controls.test.mjs` |
| 3 | 尺寸控件住在「生成」面板，顶栏不含尺寸控件 | `tests/workspace-size-controls.test.mjs` |
| 4 | `#inventoryPanel` 保留，库存 15 项能力逐条点名 | `tests/material-tab-semantics.test.mjs` |
| 5 | 生成尺寸与图纸尺寸不共用 state | `tests/generation-size-vs-canvas-size.test.mjs` |
| 6 | `maxColors` 的 0 仍是「不设上限」，显示层不抬高它 | `tests/max-colors-display.test.mjs` |
| 7 | 门对 `display:none` / 祖先隐藏 / 命中失败各自报对码 | `tests/hidden-click-guard.test.mjs` |
| 8 | 探针不得用 `element.click()` 当 PASS 判据 | `tests/ui-reachability.test.mjs` |
| 9 | 左轨子菜单桌面「就地展开」/ 移动「fixed 浮起」，**两者不得作用于同一宽度** | `tests/rail-submenu-breakpoint.test.mjs`（旧的 `tests/stage-a-hotfix.test.mjs` pin 的是浮出版本，已不足以守住这条） |
| 10 | 全仓 `.js` / `.mjs` 过得了真 ESM 解析器 | `tests/esm-syntax-strict.test.mjs` |
| 11 | 500 档 commit < 1150ms（B3 基线） | `tools/stage-b-master-probe.mjs` 场景 F |
| 12 | `deploy/` 与源码一致 | `tests/deploy-sync.test.mjs` |
| 13 | 按格数计费的重算不得算给看不见的面板 | `tests/commit-path-hidden-work.test.mjs` |
| 14 | 可达性门的命中点不得 clamp 进视口；滚动用 `block:"center"`；「视口外」与「被盖住」分开报 | `tests/hidden-click-guard.test.mjs` |
| 15 | 四档视口（1440 / 1280 / 768 / 390）可达性全绿 | `tools/c0-viewport-qa.mjs`（真机，非单测） |

### 14.1 为什么多了一条「ESM 严格语法」不变量

C0 改 `ui/generation-panel.js` 时，在一个模板字面量里嵌了 HTML 注释，
注释里又写了 `` `data-field="maxColors"` `` —— **反引号提前闭合了模板**，
后面的中文被当成标识符，真浏览器直接
`SyntaxError: Unexpected identifier 'data'`，`workspaceState` 落到 `failed`，工作台白屏。

而当时：

- 63 条新增单测**全绿**（它们把源文件当文本读，做正则断言）；
- `node --check ui/generation-panel.js` **也绿**（Node 把 `.js` 当 CommonScript 解析）；
- 抓出它的是**真机探针**（页面挂不上，探针卡在等 `ready`）。

所以补了 `tools/esm-syntax-check.mjs`：用 `vm.SourceTextModule` **只解析不执行**地
扫全仓 507 个文件；失败时再用 `node --check`（复制成 `.mjs` 拿到行号）精确定位。
守卫上线后**立刻又抓到一次同类错误**（这次是在 `ui-reachability-gate.mjs` 里
把新代码插进了 `String.raw` 模板内部）—— 在浏览器之前。

---

## 15. 怎么验

### 15.1 单元 / 契约测试

```bash
# ⚠️ node --test <目录> 在 Node 22 下会把目录当模块解析并报 MODULE_NOT_FOUND。
# 必须显式枚举文件（glob 会漏文件，产生假绿灯）。
node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)
```

C0 新增 **10 个测试文件 / 87 个用例**：

| 文件 | 守什么 |
|---|---|
| `tests/right-panel-tabs.test.mjs` | tab 清单、面板归属、无平行布尔量 |
| `tests/generation-tab.test.mjs` | 生成 tab 的 5 条子契约 |
| `tests/generation-size-vs-canvas-size.test.mjs` | 两条尺寸链路 + 「画布」用词 |
| `tests/max-colors-display.test.mjs` | 档位表 + 0 语义 + 读数 |
| `tests/material-tab-semantics.test.mjs` | 材料三节 + 库存 15 项能力 |
| `tests/hidden-click-guard.test.mjs` | 九条判据 + 反证 + 失败码常量 |
| `tests/ui-reachability.test.mjs` | 清单覆盖 + 反 click 判据 + 竞态守卫 |
| `tests/dead-ui-audit.test.mjs` | 分类函数 + 状态集 + 不另立 compat 名单 |
| `tests/esm-syntax-strict.test.mjs` | 真 ESM 解析 + 守卫非空转 |
| `tests/decode-ms-wiring.test.mjs` | decodeMs 全链路 + 缓存命中不谎报 |

同步改了两条既有测试（IA 变更必须跟）：`tests/workspace-size-controls.test.mjs`、
`tests/stage-a-hotfix.test.mjs`。

### 15.2 真机探针

```bash
# 可达性门（§9/§10）—— 打在生产产物上，带生产 CSP 头
OUT_DIR=<输出目录> node tools/ui-reachability-probe.mjs

# Dead UI 审计（§18）
OUT_DIR=<输出目录> node tools/ui-dead-audit.mjs

# Stage B 集成 + b0/b1/b2/b3/b4-13 全量（§20）
OUT_DIR=<输出目录> node tools/stage-b-master-probe.mjs --all

# 提交阶段单点复测（§16）—— 各档可重复，不受单次抖动影响
LIBMS_SIZES=400,500 LIBMS_REPEAT=2 OUT_DIR=<输出目录> node tools/c0-commit-profile-probe.mjs

# ESM 语法（§8 补充）
node tools/esm-syntax-check.mjs
```

⚠️ **`--only F` 不能用来复测 500 档**（会假绿灯，见 §13.5.2）。要单测提交路径
请用 `tools/c0-commit-profile-probe.mjs`。

**验收必须打在 `deploy/` 产物上，且必须带生产 CSP 头**（`tools/serve-with-headers.mjs`）——
`python3 -m http.server` 不发 CSP，「本地验过」和「线上能上」是两件事。

### 15.3 写探针时最容易踩的坑（C0 累计 12 条）

1. **`element.click()` 会穿透 `display:none`** —— 别用它判入口可达性。
2. **`getComputedStyle(child).display` 不继承祖先的 `display:none`** ——
   只查自身 display 的可见性门必然误报，必须逐层走祖先链。
3. **CSS 过渡的第 0 帧不能量** —— 抽屉/面板的 `visibility` 是继承属性，
   过渡开始那一帧里面的一切都还是 `hidden`。
4. **浮层遮挡下的「点不到」是正确行为** —— 校准前先关浮层。
5. **`node -e` 里用中文 needle 做 `includes` 会因 shell 编码静默 false** ——
   要么写进文件跑，要么改用前缀断言。
6. **本机系统代理会拦 127.0.0.1** —— Chrome 必须加
   `--no-proxy-server --proxy-bypass-list=127.0.0.1;localhost`，否则页面落在
   `chrome-error://chromewebdata/`，所有选择器静默变 null，会伪装成「入口全都不可达」。
7. **「等静止」必须要求「结果已经存在」** —— 只等「快照 N 毫秒没变 + 不在生成」
   会把**首次内容审查的模型下载期**当成静止（那段期间两个条件都成立）。
   紧接着的 `generate()` 被拒，而等待器被**上一轮**的结果唤醒 →
   探针量到的尺寸和耗时都不是它以为的那一轮，而且**判 PASS**。
   判据要写成 `grid.length > 0 && !isGenerating()`。
8. **探针 HELPERS 必须包成 IIFE** —— `tests/b4-probe-helpers-syntax.test.mjs`
   用「结尾是不是 `})()`」当模板字符串**截断判据**。原因是截断后剩下的源码
   **往往仍然能解析**（实测：body 被腰斩到 3421 字符，文件级 `node --check`
   照样绿，只有页内 eval 才炸）。不包成 IIFE 就会红，而且红得有理。
9. **往 `String.raw` 模板里写注释时，注释里不能出现反引号。**
   这是坑 8 的**同族但反向**：坑 8 是模板被腰斩，这条是注释自己带刀。
   本轮实测：在采集器注释里写了一句 `` // …`nearest` 滚到 726–844 就停了 ``，
   反引号当场闭合了 `String.raw` 模板 → `SyntaxError: Unexpected identifier 'nearest'`。
   **写「不许出现某写法」的守卫时也一样**：解释「为什么不许」的注释里
   天然会引用那个写法本身，守卫会把自己的解释文字当成违规代码。
   两个办法都用上：注释里不写反引号；守卫匹配前先剥注释
   （`tests/hidden-click-guard.test.mjs` 的 `collectCode`）。
10. **性能门不要用单次采样下结论，先量方差。** 同一份代码三次 `--all`
    实测 1158.5 / 1312.2 / 902.5（差 45%）。要证明一次修复有效，
    只能用**同口径背靠背 A/B**（用 `--only A,B,C,D,E,F` 把前缀压到最小），
    并且先确认没有别的无头 Chrome 在抢 CPU。
11. **`Page.navigate` 不清 `localStorage` / `IndexedDB` / cache。**
    多场景连跑时，前面几轮上传的残留会全部喂给 `paint()`，
    系统性地把后面的场景抬高。未改动代码上实测：+170ms（`LIBMS_WARM_LOADS=5` 可复现）。
12. **多视口必须发 `Emulation.setDeviceMetricsOverride`。**
    headless 下 `--window-size` 是**窗口**尺寸不是 layout viewport，
    差几十 px 就会把「刚过断点」的那一档测错（断点是按 CSS px 判的）。

---

## 16. 遗留与 C1 / C2 的接缝

| # | 项 | 说明 |
|---|---|---|
| 1 | **重复的「重新生成」** | `#ws-generation-regenerate`（面板常驻）与 `#ws-generate`（坞，仅 `manualEdited` 时出现）是同一个 ACTION 的两处渲染。C1 择一 |
| 2 | **`#ws-engine` 隐藏** | 引擎选择器（智能 V2.5 / Legacy）`display:none`，用户没有切换路径。C1 决定「永久移除」还是「放进高级设置」 |
| 3 | **`#ws-open-editor` / `#ws-making` 隐藏** | 旧画板/施工视图的入口在工具坞里是 `hidden`；施工模式改由左轨进入。C1 清理或显式降级为 compat |
| 4 | **`#mobile-*` 五个按钮** | 0×0 且永不显示，旧移动端外壳遗留。C1 删 |
| 5 | **48 条 `hidden` 里的「按需出现」类** | 审计的状态集没构造背景预检/草稿恢复/选中色等条件。C1 扩状态集，把它们变成 `reachable` 或明确 `dead` |
| 6 | **`deploy/.git`** | 建议删（见 §13） |
| 7 | **`maxColors` 档位上限** | 现在是 64；面板的输入框上限仍是 221。C1 若做「专业档位」，需要重新设计而不是加数字 |
| 8 | **C1 专业输出 / C2 商业基础** | 本次已铺的结构：「生成」tab 承载 OUTPUT 层；「材料」tab 承载备料与台账；工具坞导出抽屉是导出 ACTION 的唯一容器。C1 的导出规格（分辨率档位、分板、PDF 矢量）应挂在「生成」tab 的 OUTPUT 语义下，而不是新开一个 tab |
| 9 | **提交阶段剩下的两笔钱（§16）** | `<800ms` 仍未达成（同口径 A/B 902.5ms，全量 `--all` 977ms）。剩下的是 `chartUrl`（458ms，画 5100×5100 画布 + PNG 编码）与 `getPaletteIndex`（25 万格逐格 `cells.push({x,y})`，而调用方只要 count）。后者是一笔**纯浪费**、且有干净改法（按需才建 cells 数组），但会碰到 `services/palette-usage.js` 的对外契约，留给 C1 |

---

## 17. 交付摘要

- **改动**：`ui/workspace.js`、`ui/generation-panel.js`、`styles/workspace.css`、
  `services/auto-tune.mjs`、`app.js`、`ui/inventory-panel.js`、`ui/text-panel.js`
- **新增工具**：`tools/ui-reachability-gate.mjs`（门 + 纯函数分类）、
  `tools/ui-reachability-probe.mjs`（真机探针）、`tools/ui-dead-audit.mjs`（审计）、
  `tools/esm-syntax-check.mjs`（ESM 语法）、
  `tools/c0-commit-profile-probe.mjs`（提交阶段可重复复测）
- **新增测试**：11 个文件 / 93 个用例
- **可达性门**：47/47 PASS · 0 FAIL
- **Dead UI 审计**：328 个交互控件 → reachable 154 / compat 79 / hidden 48 /
  disabled 31 / covered 16 / absent 0，并抓到并修掉左轨 9 个工具入口不可达
- **提交阶段（§16）**：500 档 `commitTotal` 同口径背靠背 A/B **1019.6 → 902.5 ms**
  （B5 基线 899.6），全量 `--all` 复跑 977 ms；
  硬回归门 1150ms 通过；`<800ms` 仍未达成，如实带 KNOWN
- **发布**：`node tools/sync-deploy.mjs` → `deploy/` 与源码一致（清单 274 个文件）
