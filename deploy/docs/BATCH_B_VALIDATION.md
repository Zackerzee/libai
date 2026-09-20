# B 批（库存管理）交付与验收

日期：2026-09-17
版本查询串：`?v=20260917-inventory`
来源参考：`GuoNH/perler-bead-manager`（拼豆管理 Pinpin，Vue3 + Express + node:sqlite + Sharp + Tesseract 全栈）
落地方式：**并入现有 `index.html` 工作台**（右侧新增「库存」栏），不新建独立页面；纯前端，无后端、无数据库，全部数据落在浏览器 `localStorage`。

---

## 一、交付内容

### 新增模块

| 文件 | 职责 |
| --- | --- |
| `services/inventory-service.js` | 台账数据层：色号建档、扣料、撤销回补、缺货计算、CSV 导入导出、持久化 |
| `services/ocr-service.js` | tesseract.js 封装：脚本/worker 惰性加载、灰度化、Otsu 二值化、极性强弱判定、区域裁剪与放大 |
| `services/legend-recognition-service.js` | 图例识别编排：色块定位 → 逐块 OCR → 解析编号/颗数 → 色卡匹配 → 三档分级 |
| `services/legend-text-parse.js` | 图例文本解析（编号 + 颗数） |
| `services/pattern-legend-service.js` | 图例色块定位与文字区域配对（移植参考实现的 color/legend/text/pairing 四部分） |
| `ui/inventory-panel.js` | 右侧「库存」面板：概览、扣料、流水、缺货提醒、明细分编辑、CSV 收发 |
| `ui/usage-dialog.js` | 「用豆清单」对话框：OCR 结果校正表与手工录入共用一张表 |

### 关键设计：站内图纸走零 OCR 路径

参考实现只有「OCR 识别」一条路。本站图纸的色号与颗数**本来就有精确值**（`state.stats`），
因此「按当前图纸扣料」直接读统计数据，不经 OCR，数目精确、瞬时完成。
OCR 只用于「外部图纸」这一条真实需要识别的路径。这是本批相对参考实现的主要改进。

### 数据模型

- `state.grid`（`app.js`）仍是图纸唯一事实源；库存只**读**它，不改写。
- 台账存于 `localStorage["libms-inventory-v1"]`，形状 `{ version, items: {色号: 明细}, submissions: [...] }`。
- 扣料 = 写一条 submission（含 lines）+ 递减 `item.stock`；撤销 = 给该条打 `revertedAt` 并把数量加回。
- **允许负库存**：扣后为负即账面缺料，提前暴露，而不是静默截断为 0。

### CSP 变更（三处部署配置 + `deploy/` 镜像同步）

```
script-src 'self' 'wasm-unsafe-eval' https://cdn.jsdelivr.net;
worker-src 'self' blob:;
connect-src 'self' data: blob: https://cdn.jsdelivr.net https://storage.googleapis.com https://tessdata.projectnaptha.com;
```

- `worker-src 'self' blob:` — tesseract 用 blob worker。
- `connect-src ... https://tessdata.projectnaptha.com` — 语言包（`eng.traineddata.gz`，约 10 MB，浏览器缓存）。
- `script-src ... 'wasm-unsafe-eval'` — **必需**：tesseract 核心是 WASM，缺这条会被 CSP 拒绝编译。

涉及文件：`_headers`、`deploy/_headers`、`netlify.toml`、`deploy/netlify.toml`、`vercel.json`、`deploy/vercel.json`。

---

## 二、修掉的两个真实缺陷（来自参考实现）

参考仓库的 OCR 二值化在纯双峰图上会退化，导致「黑字白底」的图例**一个字都读不出**。
这批在移植时一并修正，并补了回归测试：

1. `otsuThreshold` 在**纯双峰直方图**（前景背景各占一半、中间无过渡）上算出的阈值会把整块判为背景，
   结果整块变白。改为：当所有像素落在直方图同一侧时回退取**中点**作为阈值。
2. `guessPolarity` 判定「深色字 / 浅色字」时，两侧计数相等的情况用 `>` 比较会误判为深底，
   改为 `>=` 优先偏向**较亮背景**（即白底黑字，图例的常见形态）。
   同时把 `binarize` 统一为 `<=`，与阈值搜索方向一致。

---

## 三、验收结果

### 单元测试

```
node --test smart-preprocessing/*.test.mjs tests/ui-refactor-baseline/*.test.mjs
→ tests 207 / pass 207 / fail 0
```

新增测试文件：`legend-parse.test.mjs`(11)、`pattern-legend.test.mjs`(6)、
`inventory-service.test.mjs`(16)、`ocr-service.test.mjs`(13)、`legend-recognition.test.mjs`(15)。

### 浏览器端到端验收（真实 CSP 响应头）

`_headers` 里的 CSP 只有经真实响应头发送才测得出拦截问题，因此用一个带 `_headers` 的静态服务器
（多线程 + HTTP/1.1 keep-alive）提供页面，再用无头 Chrome 走完整交互。
**对源码目录与 `deploy/` 目录各跑一遍，两处均 33/33 通过。**

覆盖项：

- 工作台挂载、点「库存」栏后面板可见、初始概览为「台账为空」
- 「按当前图纸扣料」：台账收录全部 16 色、每色库存 = `0 - 图纸颗数`、写入 1 条流水、缺货提醒同步
- CSV 导出（真实下载）：文件名带日期、UTF-8 BOM、表头 `编号,名称,当前库存,最低库存,单位,位置,供应商,备注`、行数一致
- 撤销回补：库存回到 0、流水标记 `revertedAt` 且按钮禁用
- 明细编辑：名称/最低库存/位置保存，补货累加（120 + 80 = 200）
- 搜索过滤「A 抽屉」→ 1 条，清空后恢复全部
- CSV 导入回灌：`ZZ9` 库存 42、最低 5、位置「导入位」
- 用豆清单对话框：「手工录入」可开、按当前图纸填入 16 行、合计 10,816 颗与图纸一致、
  确认扣料新增流水、扣完自动关闭
- 刷新后 localStorage 持久化
- **OCR 在真实 CSP 下端到端跑通**：`识别到 29 条：11 条可直接用，16 条需核对，2 条未识别`
- OCR 相关 CSP 指令（worker / connect / WASM）无拦截；B 批相关运行期无 JS 异常

截图：`docs/batch-b-shots/inventory-panel.png`、`docs/batch-b-shots/ocr-usage-dialog.png`

---

## 四、验收中记录到的既有问题（与本批无关，未改动）

1. **NSFW 图片内容审查栈长期失效**：`nsfwjs@4.2.1/dist/nsfwjs.min.js` 的 CDN 路径 404，
   连带 `@tensorflow/tfjs` 走 `new Function` 被 CSP 拦下抛 `EvalError`。
   修它需改 `app.js` 的 `NSFWJS_SCRIPT_URL`，属行为变更，用户尚未决定。
2. `your-reward-code.png` 404（赞赏码占位图）——用户已明确本批不处理。
3. `@fontsource/maple-mono` 样式表被 `style-src 'self' 'unsafe-inline'` 拦下，站点自定义字体未生效。
   修法是把 `https://cdn.jsdelivr.net` 加进 `style-src`，属独立的外观问题。

## 五、其他说明

- `deploy/` 与根目录运行代码已逐字节比对同步（`smart-preprocessing/` 下的 `*.test.mjs` 与
  `*.benchmark.mjs` 有意不发布）。
- 验收用的本地带 CSP 静态服务器是临时工具，未纳入仓库。
