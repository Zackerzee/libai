# 阶段 5 · 拼豆二维码图层

> 一句话：把一段文字（默认站点地址）编成二维码，按「每模块 N 颗豆」的整数网格铺到图纸上，
> 锁定后并入导出。**这个功能唯一真正难的地方是「保证扫得出来」，而且它的失效是静默的。**

## 1. 为什么这件事需要单独设计

图案看起来完全是二维码，手机却读不出来 —— 这类失败没有报错、没有视觉差异，
只有「用户拿起手机扫，扫不出」这一个现象。所以不能靠肉眼看，必须把「能不能扫」
拆成**可以分别验证的两件事**：

| 风险 | 可执行的验证手段 |
|---|---|
| 编码器本身不合规（矩阵错） | 上游 `vendor/qrcode.js`（Kazuhiko Arase, MIT）+ 对「LIBMS」的 golden hash 钉死 |
| 模块边界没落在格边界（采样点采错） | `cellToModule` 往返投影断言：每一格都必须能反推回它来自哪个模块 |
| 静默区不够（解码器找不到边界） | `quietModules` 默认 4（QR 规范下限），布局层强制计入占格 |
| 深浅对比度不足（二值化失败） | `qrContrast()` 用 WCAG 相对亮度算比值，低于 3:1 直接出 warning |

其中**往返投影无损**是最关键的一条：它把「画出来的图案能不能被解码器采对」退化成一个
纯数学断言（`roundTrip === "complete"`），可以在页面里随时复算。

## 2. 关键设计决策

1. **`beadPerModule` 与原点必须整数。** 面板里位置输入强制 `Math.round()`，拖拽也走整数吸附。
   小数位置会让模块边界错半格 —— 图案看着没问题，扫不出来。
   默认 `beadPerModule = 0` 表示「自动取最大可行整数」，放不下时**不硬凑 1**，而是报 `tooSmall`。
2. **`rasterizeQr` 是唯一出口。** 返回 `{cells, paintLayers, matrix, layout, error, warnings}`，
   预览、诊断、导出三处都从这里取结果，保证「面板上写的落豆数」和「画布上画的」「导出里合成的」是同一份。
   缓存（`rasterizeQrCached`，参数串缓存 48 条）让预览与导出共用同一份计算结果。
3. **二维码在导出时后于文字合成**（`composeExportGrid`：底版 → `composeLockedTextGrid` → `composeLockedQrGrid`），
   所以二维码会盖住底下的文字。契约与文字层一致：只并锁定层、只写副本、越界裁剪。
4. **面板刻意不提供「向下合并」。** 文字面板有，二维码没有 —— 烧进底版就再也改不了内容了，
   而二维码的内容恰恰是最需要改的。
5. **深/浅色号给全色板**（222 个选项），不是「图纸已用色」。二维码要的是高对比黑白，
   图纸已用色里常常凑不出合适的深浅，从那里选只会得到「对比度不足」的诊断。
6. **编码器按需加载**（`loadQrEncoder`），失败时重置标记并 notify，不阻塞工作台启动。

## 3. 数据流

```
text + ecc
  └─ buildQrMatrix() ──────────────► {modules, version, count, isDark, error}
       └─ qrLayout() ──────────────► {beadPerModule, spanCells, box, overflow, fits, tooSmall}
            ├─ cellToModule() ─────► 往返投影（每格 → 模块）
            ├─ qrContrast() ───────► {ratio, ok, inverted}
            └─ rasterizeQr() ──────► {cells, paintLayers, warnings}   ← 唯一出口
                 └─ composeLockedQrGrid() ──► 并入导出网格（只并锁定层、只写副本）
```

## 4. 文件清单

| 文件 | 体量 | 角色 |
|---|---|---|
| `services/qr-layer-service.js` | 511 行 | 编码 / 布局 / 投影 / 对比度 / 栅格化 / 合成（纯函数，无 DOM） |
| `ui/qr-panel.js` | 237 行 | 右栏面板：图层列表 + 素材表单 + 诊断读数 |
| `tests/qr-layer.test.mjs` | 445 行 | 36 条单测（A 常量 / B 图层 / C 矩阵 / D 布局 / E 对比度 / F 栅格化 / G 合成 / H 契约） |
| `ui/workspace.js` | — | 状态、命令、拖拽（整数吸附）、`composeExportGrid`、面板显隐、编码器预加载、快捷键 K |
| `state/project-store.js` | — | 快照白名单补 `qrLayers` / `activeQrLayerId`（漏一行就是「写进去读不回来」） |
| `ui/canvas-renderer.js` | — | overlay 层绘制二维码（浅色层加极淡描边，防止白豆画在白底上消失） |
| `ui/grid-editor-toolbar.js` | — | 工具项 + 快捷键 K + 图标映射 |
| `ui/workspace-icons.mjs` | — | `qr` 图标（三个回字定位块 + 数据区散点） |
| `styles/workspace.css` | — | `.ws-qr-panel` 及其子块；`[hidden]` 显式补 `display:none` |

## 5. 验收证据

### 5.1 服务层单测

```
tests/qr-layer.test.mjs → 36/36 通过
```

含 golden hash 钉死：`"LIBMS"` + M 级 → version 1、21×21、FNV-1a `cd80e723`。

### 5.2 CDP 真机验收（无头 Chrome 驱动真实页面）

```
outputs/stage5-qr/probe-qr.mjs → 43/43 PASS
```

| 组 | 条数 | 验的是什么 |
|---|---|---|
| A 可达性 | 5 | 按钮存在；面板**量 box 真的可见**（`element.click()` 能穿透 `display:none`，只看点击成功是假绿灯） |
| B 状态 | 9 | 图层进得去也**读得回来**（快照白名单）；默认 ECC=H、静默区 4、落点为整数 |
| C 不变量 | 10 | 在**页面里**调服务，证明与工作台是同一个模块实例且数学成立 |
| D 像素 | 1 | 画布 overlay 真的落了墨（非透明像素 177390） |
| E 交互 | 10 | 输入即时写回、小数位置被取整（7.6 → 8）、锁定后合成改写 1089 格 |
| G 结构合规 | 5 | 三个定位图案 7×7 回字逐位校验、定时图案严格交替、深色占比 52.5% |
| F 运行期 | 1 | 无 console 错误 |

### 5.3 实测数据

| 输入 | 矩阵 | 整码占格 | 落豆 | 对比度 |
|---|---|---|---|---|
| `https://www.libms.net` + ECC H | 29×29（版本 3） | 37×37 | 426 深 + 943 浅 = 1369 | 17.17:1 |
| `https://www.libms.net/pindou` + ECC L | 25×25（版本 2） | 33×33 | 328 深 + 761 浅 = 1089 | 17.17:1 |

图纸 52×52 时的容量上限：**44 模块**（即最大 44×44 的码）。
`roundTrip: "complete"`、`cacheHit: true`；合成改写格数（1089）与诊断落豆数**完全对上**。

### 5.4 静态校验

```
ESM 严格语法校验 → 6/6 通过
```

## 6. 已知边界

- **未做「限制为我的色板」**（用户明确保留思路，本阶段不做）。当前深/浅色号给全色板。
- `vendor/qrcode.js` 在 Node 侧不注册 `globalThis.qrcode`，单测必须显式注入
  `createRequire` 加载的工厂；`resolveQrEncoder` 因此容忍返回 `null`。
- 溢出时 `qrcode(0, ecc)` 抛的是**字符串**而不是 `Error`，`buildQrMatrix` 统一归一成 `{error}` 不抛。

## 7. 缓存戳

本阶段内容变更的文件，`?v=` 统一改为 `20261015-qr-1`，整条引用链一起改：

```
index.html → app.js → ui/workspace-bootstrap.js → ui/workspace.js
                                                      ├─ canvas-renderer.js
                                                      ├─ grid-editor-toolbar.js
                                                      ├─ qr-panel.js
                                                      ├─ ../state/project-store.js
                                                      └─ ../services/qr-layer-service.js
```

`services/qr-layer-service.js` 的 query string 在 `workspace.js` / `qr-panel.js` / `canvas-renderer.js`
三处**必须逐字一致** —— 不一致就是三个模块实例、三份缓存，`createQrLayer` 的 `seq` 各自从 0 开始，
图层 id 就有撞车的可能。

> `ui/workspace-icons.mjs` 被 5 个文件 import 且全部不带 `?v=`（v3 增量引入的既有状态）。
> 本阶段**没有**给其中任何一处加版本号 —— 只加一处会造成同一模块两个实例。这个缓存缺口留待统一处理。
