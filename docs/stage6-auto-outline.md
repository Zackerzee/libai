# 阶段 6 · 外轮廓自动描边（统一增强）

> 一句话：描边功能**本来就存在**（`services/outline-service.js` + inline 面板 + 预览/应用闭环）。
> 这一阶段没有从零建第二套实现，而是补上它缺的那块语义 —— 「**整个作品**」，
> 并把两套并存的入口收敛成一套。

## 1. 缺口：三种来源都表达不了「整个作品」

`editor-service.js` 的 `planOutline` 原本只有三种 `sourceMode`：

| 来源 | 含义 | 代价 |
|---|---|---|
| `component` | 当前**连通区域**（需要先点中一个色块） | 什么都没选中时是**空操作** |
| `palette` | 全图**当前颜色**的所有格子 | 只能描一个色号的范围 |
| `selection` | **选区内容** | 要先拉选区 |

三者都是「**先指定范围，再描边**」。而产品对外承诺的是「**自动描边**」
（`index.html` 的「专业精修」能力卡：`改色 · 替换 · 智能修复 · 参考底图 · 对称绘制 · 自动描边 · 明暗工具`）。

**`computeOuterOutline` 其实早就支持这个语义** —— 只要把「全部非空格子」当剪影传进去，
`includeHoles: false` 时它自己会用「全部非空」重算 silhouette，于是描边只长在作品外圈。
缺的只是 `planOutline` 里一个分支和 UI 上的一个选项。

顺带解释了另一个现象：默认来源是 `component`，而它需要先点选色块 ——
**所以用户点开「描边」再点「预览」，在没选任何东西的情况下什么都不会发生**。

## 2. 关键决策

1. **新增 `sourceMode: "artwork"` 并设为默认**。它 = 所有非空格子一起构成剪影，
   不需要用户先选任何东西 —— 这才是「自动描边」。纯增量：既有三种来源一个没动。
2. **描边色不回落到画笔色**。旧入口写的是 `value.trim() || currentPaletteId()`，
   即「没填色号就用画笔色」；新入口改成**没填就拒绝并提示**。
   描边色是作品的边框色，悄悄跟随画笔色会让用户拿到一个自己没选过的颜色。
3. **收敛入口**。旧的一套（右栏隐藏容器里的 `#ws-apply-outline` + `#ws-outline-diagonal`）
   在 `#ws-outline-diagonal` 被 `hidden` 之后就成了「代码活着、用户点不到」的死路径，
   但它还挂着事件、还占着一条禁用逻辑。阶段 6 把它整段删掉，只留 inline 面板一条路。
4. **「无图纸就禁用」的判定迁到新入口**，语义不变（原来是挂在旧按钮上的）。

## 3. 改动清单

| 文件 | 改动 |
|---|---|
| `services/editor-service.js` | `planOutline` 新增 `artwork` 分支；默认值 `component` → `artwork` |
| `ui/workspace.js` | 来源下拉加「整个作品（自动）」并置首；`#ws-outline-summary` 文案；删除旧入口 4 处（HTML 容器 / disabled 行 / click handler / hidden 语句）；`#ws-outline-preview` 补「无图纸禁用」 |
| `tests/outline-service.test.mjs` | +4 条 artwork 用例（默认等价 / 不吃孔洞 / 贴边裁剪 / 空白图纸） |
| `tests/outline-color-control.test.mjs` | 改写为覆盖新入口（原断言切片的是已删除的 handler）+ 新增「拒绝回落到画笔色」 |
| `tests/workspace-functional-wiring.test.mjs` | 2 条钉死 `#ws-apply-outline` 的断言改为新入口 |
| `tests/editor-layout-consolidation.test.mjs` | 引用链断言从「硬编码版本号」改为「必须带 `?v=` 缓存戳」 |

`services/outline-service.js` **一行未改** —— 它本来就是对的。

## 4. 验收证据

### 4.1 单测

```
tests/outline-service.test.mjs     13/13（原 9 + artwork 4）
tests/outline-color-control.test.mjs 3/3
tests/workspace-functional-wiring.test.mjs 通过
```

artwork 用例钉住的契约：
- 不传 `sourceMode` **必须**等价于 `artwork`（默认即自动描边）
- 剪影含全部非空格、不分颜色
- `component` 的描边是 `artwork` 的**子集**（新来源是超集，没抢旧语义）
- 默认不吃内部孔洞，勾选后才吃
- 贴边（左/上）不补，右/下正常描
- 空白图纸产出空计划而不是报错

### 4.2 CDP 真机验收

```
outputs/stage6-outline/probe-outline.mjs → 21/21 PASS
```

| 组 | 条数 | 验的是什么 |
|---|---|---|
| A 可达性 | 5 | 工具按钮 / inline 面板**量 box 真的可见**；默认来源 = `artwork`；**旧入口已不在 DOM** |
| B 服务语义 | 5 | 按真实网格复算 artwork 计划：剪影 = 全部非空、候选全在空格、每颗都贴着作品、`component ⊆ artwork` |
| C 交互闭环 | 6 | 真实鼠标落豆 → 预览 → 应用 → 撤销，四步都验到网格 |
| D 运行期 | 1 | 无 console 错误 |

实测（52×52 图纸，画布上落 9 颗豆）：

| 量 | 值 |
|---|---|
| 落豆 | 9 颗 |
| artwork 剪影 | 9（= 全部非空格） |
| **artwork 描边** | **22 颗** |
| component 描边 | 4 颗（⊆ 22） |
| UI 预览 | 22 颗（与复算逐字段一致） |
| 应用后 | 9 → **31 颗**（+22，与预览承诺完全一致） |
| 撤销 | 精确还原到应用前 |
| overlay 落墨 | 1751 非透明像素 |

### 4.3 全量

```
2103 项 · 通过 2075 · 失败 27 → sync-deploy 后 25（与阶段 5 基线逐条一致）
```

## 5. 已知边界

- **贴边作品描不出外圈**：作品顶到画布边缘时那一侧没有空格可落笔，这是几何事实不是缺陷
  （`computeOuterOutline` 会把它记进 `blockedCells` 之外的空候选集，不报错）。
- **`includeHoles` 默认关**：自动描边只描外轮廓，内部孔洞要用户显式勾选 ——
  对「给整个作品加一圈边框」这个主场景，默认吃孔洞会把图案内部填花。
- `editor-service.js` 的旧 `outline(selection, code, diagonal, {includeHoles})` API **保留**
  （仍有单测覆盖），只是 UI 不再调用它。

## 6. 缓存戳

本阶段改动 `services/editor-service.js` 与 `ui/workspace.js`，整链改为 `?v=20261015-outline-1`：

```
index.html → app.js → ui/workspace-bootstrap.js → ui/workspace.js
                                                      └─ ../services/editor-service.js
```

`tests/editor-layout-consolidation.test.mjs` 的引用链断言同步改成**「每个模块都必须带 `?v=` 缓存戳」**
的正则校验 —— 原来它硬编码单一版本号，每阶段都会漂成「空转的假失败」（`qr-1` → `outline-1` 时刚发生过一次）。
