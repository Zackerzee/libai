# Batch D 验证与交接（2026-09-18）

本批来源需求仓库：`guqiao5757-png/doudou-up-beads`（拼豆图纸生成器·单文件离线版，MARD 221 色）。
用户原话：「我们从这个开始来吧。已使用颜色 163 种 / 26456 颗 这个显示需要在图纸的下方」

版本查询串：`?v=20260917-c` → **`?v=20260918-usage`**（根目录与 `deploy/` 已同步）。

---

## D1 用量汇总行：「已使用颜色 N 种 / M 颗」

doudou-up 把这一行放在**导出的图纸图片里、图案下方、色块图例上方**（作为图例表头）。
本批按用户要求做成**两个落点**，两边文案一致。

### 落点 A：工作台画布正下方（常驻，随编辑实时更新）

`ui/workspace.js`

- `#ws-canvas-area` 的 `innerHTML` 里，在 `#ws-canvas-well` 与 `#ws-canvas-hint` **之间**插入：

  ```html
  <div class="ws-canvas-stats" id="ws-canvas-stats">
    <span>已使用颜色</span> <strong id="ws-stats-colors">0</strong> <span>种</span>
    <i aria-hidden="true">/</i> <strong id="ws-stats-beads">0</strong> <span>颗</span>
  </div>
  ```

- `paint()` 内 `#ws-used-colors` 那一行之后同步刷新，遵守本文件既有的
  「只在值真的变了才写 DOM」约定（`paint` 每次状态变化都会被调用）。
- 未生成图纸时显示 `0 种 / 0 颗` 并挂 `.is-empty` 静默态，**不做 `hidden`**：
  该元素是 CSS grid 的第 2 行，一旦 `display:none` 就会让第 3 行的操作提示串行。

`styles/workspace.css`

```css
.ws-canvas-area { display: grid; grid-template-rows: minmax(0,1fr) auto 26px; }
```

- 由两行改为三行（画布 / 汇总 / 提示），汇总行高度自适应（实测 34px）。
- 词间距由标记里的**字面空格**提供，**不另设 `gap`** —— 这样
  `textContent` 就是完整一句「已使用颜色 16 种 / 1,600 颗」，可原样复制，
  也便于 e2e 做字符串全等断言。

### 落点 B：导出图纸的图案下方、色块图例上方

`app.js` `createChartCanvas()`：

```js
const summaryText = showLegend && stats.length ? `已使用颜色 ${stats.length} 种 / ${formatCount(totalBeads)} 颗` : "";
const summaryBandHeight = summaryText ? 30 : 0;
const summaryY = boardY + boardHeight + 46;
const legendTop = boardY + boardHeight + 54 + summaryBandHeight;
```

- **只在 `showLegend === true` 时出现**。`PREVIEW_CLEAN` / `PREVIEW_EXPORT` / `ZOOM_DETAIL`
  三个预设都是 `showLegend:false`，因此 `summaryBandHeight` 恒为 0，
  预览类渲染的布局与旧版**逐像素一致**（e2e 有断言兜住）。
- **水平居中**（`context.fillText(summaryText, width / 2, summaryY)`），不左对齐。
  原因：`drawLegendPanel()` 会在图例框左上 / 右上角各画一个**半径 10 的黑色角点**
  （圆心在 `legendTop - 22`，即图案底 +62）。左对齐在 `margin` 处会正好压在左角点上；
  居中后文字横跨画布中心约 ±93px，与两个角点（x≈54 与 x≈width-54）都不相交。

命中 `PATTERN_EXPORT`（`showLegend:true`）的出口因此全部带上这一行：
`downloadPattern`（下载图纸 PNG）、`renderExportPattern`（→ `pattern-png` / `pattern-jpg`）、
`refreshChartUrl` 的 `chartUrl`、`getRenderUrl({mode:"pattern"})`。

---

## 验证

单测 **346/346**（`node --test smart-preprocessing/*.test.mjs tests/ui-refactor-baseline/*.test.mjs`）。

浏览器 e2e 新增 `libms-usage-verify.mjs`，**31/31**；

| 套件 | 源码根 :8792 | `deploy/` :8793 |
|---|---|---|
| 用量汇总（新） | 31/31 | 31/31 |
| C1 绘图工具 | 46/46 | 46/46 |
| C2/C3 智能辅助 | 27/27 | 27/27 |

关键断言与实测值：

- 统计条是 `#ws-canvas-area` 的子节点、位于 `#ws-canvas-well` 之下、且在操作提示之上
  （画布底 952 / 统计条 952–986 / 提示顶 986）。
- 文案与桥接数据全等：`已使用颜色 14 种 / 144 颗` == `getResult().usedColors/totalBeads`。
- 实时性：擦掉一颗豆 → `143 颗`，撤销 → `144 颗`，统计条同步。
- 导出图纸：`getRenderUrl({mode:"pattern"})` 是 **1:1 像素平面**
  （`minLongSide:0` → `outputScale=1`；`cell=18`、`margin=54`、无 subtitle → header 166），
  所以能精确算出行号。实测墨迹落在**相对图案底 +38…+53**（一行文字，高 15px、
  宽 186px、水平中心 480 == 画布中心 480）。改动前该带是纯背景 `#fffdf7`。
- 预览图 `PREVIEW_CLEAN` 高度仍是 `行数×cell`（12×12 → 96×96），未被汇总行撑高。

截图：`docs/batch-d-shots/`

- `workspace-usage-bar.png` —— 画布区（统计条 + 操作提示两层同框）
- `usage-bar-3x.png` —— 统计条 3 倍放大
- `export-summary-line.png` —— 导出图纸整图（汇总行的位置与居中效果）

---

## 已确认：颗数/色数一律不带千分位（`?v=20260918-usage2`）

用户原话给的是 `已使用颜色 163 种 / 26456 颗`（无分隔符），第一版用了 `1,600` 这种
千分位（理由是站内其它计数也这样），经确认后改为**全局不带千分位**。

规则边界：**颗数 / 色数 / 格数 → 无千分位；金额 → 保持千分位。**
（`pricing.js` 的 `formatMoney` 不动，`formatNumber` 动了——它量的是数量与工时。）

改动落点（16 处，全在「格式化函数」这一层，不是逐处拼接字符串）：

| 文件 | 改动 |
|---|---|
| `app.js` | `formatCount()` 加 `useGrouping:false`（覆盖表头「总计」、图例计数、图库、统计列表、拼豆进度、CSV 状态提示）；空白画板「N 个可编辑格子」同样处理 |
| `ui/workspace.js` | 8 处 `toLocaleString("zh-CN")` 加 `useGrouping:false`（画布统计条、检查器「实际使用 N 色 · M 颗」、色号列表、选区豆数、使用量、换色影响数） |
| `ui/inventory-panel.js` | 公共 `number()` 加 `useGrouping:false`（库存、累计已用、缺货、台账） |
| `ui/usage-dialog.js` | 4 处扣料文案加 `useGrouping:false` |
| `pricing.js` | `formatNumber()` 加 `useGrouping:false`；`formatMoney()` 保持千分位 |

### 这一批的验证要点：12×12 的 144 颗证明不了这件事

`libms-usage-verify.mjs` 原先的 12×12 只有 144 颗，本来就没有千分位，断言对
「有没有分组」**零区分度**。所以新增第 7 节：重载页面后生成 **60×60 → 3600 颗**
跨过阈值，再做三重判断：

1. 统计条文案 == `已使用颜色 16 种 / 3600 颗`，且**不含逗号**；
2. 用**同一套「按亮度阈值量墨迹外接框」的方法**，分别量导出图纸上那一行的真实
   墨迹宽度、以及本页离屏渲染的「无分组」/「带分组」两个候选串：
   实测 **无分组 199px · 带分组 203px · 导出图实测 199px** —— 测量方法相同，
   系统偏差互相抵消，所以这是真的判据，不是靠猜阈值；
3. 额外断言两个候选串宽度差 ≥4px，保证用例本身有区分度（否则断言会退化成恒真）。

### 第 7 节踩到的两个坑（都不是应用缺陷）

- **`manualEdited` 会拦生成。** `ui/workspace.js:202` 在 `bridge.getResult().manualEdited`
  为真时先弹「重新生成会覆盖当前手动修改。继续吗？」确认框。第 4 节刚擦过一颗豆，
  正好把 `manualEdited` 置真，脚本不应答就一直等到 3 分钟超时。这是**应用的正确保护**，
  已改为第 7 节先 `page.reload()` 拿到干净状态。
- **`page.click` 的坐标点击会被浮层截走。** 生成按钮紧邻浮层工具栏，真实鼠标点击可能
  落到浮层上（表现为尺寸一直不变）。第 7 节改用 DOM 点击；按钮能否被真实鼠标点到，
  第 2 节已经证过，不必重复。

---

## 已知待确认

- `deploy/smart-preprocessing/` 里仍留有 4 个历史 `*.test.mjs`（与根目录内容一致、不属运行集），本批未动。
