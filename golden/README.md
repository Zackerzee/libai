# 金样图回归框架（golden）

用于保护拼豆图纸生成算法不被参数迭代"修 A 毁 B"。零依赖，只需要浏览器和任意本地静态服务器。

## 原理

`golden.html` 在**隐藏 iframe 里加载真实的 `../index.html`**（同源），等待 app.js 就绪后，
直接调用页面里的算法函数（`rasterizeFaceAwarePortraitImage` / `rasterizeImage` 等），对每个样例：

1. 读取 `manifest.json` 中定义的样例图片；
2. 按样例设置粒度和模式（dominant / portrait），高度按宽高比锁定的方式推导（与真实 UI 一致）；
3. 跑通算法管线，统计输出：尺寸、用色数、每个色号的出现次数、背景决策；
4. `check` 模式与 `golden/baseline/<id>.json` 比对，`record` 模式重新生成基线。

> 隔离说明：运行器会跳过本地 NSFW 审查模型（不测安全模型，只测算法），也不会触发"生成图纸"
> 的副作用（不写画廊/拼装进度/工程导出）。iframe 加载真实页面时页面自身的初始化写入
> （如访问计数、字体预载）仍会发生，与日常打开首页一致，可忽略。

## 快速开始

必须用 http(s)/localhost 打开（同源 iframe + fetch 限制，`file://` 不行）。项目若已配静态服务器：

```bash
cd E:\libai
npx serve .            # 或 python -m http.server，任选其一
```

然后浏览器打开：

| 场景 | URL |
|---|---|
| 生成基线（首次/算法预期变更后） | `http://localhost:3000/golden/golden.html?mode=record&auto=1` |
| 全量回归（发布前/每次调参后） | `http://localhost:3000/golden/golden.html?mode=check&auto=1` |
| 只跑单个样例 | `http://localhost:3000/golden/golden.html?fixture=portrait-a-52` |

`mode=record&auto=1` 会给每个样例下载一份 `<id>.json`，**放到 `golden/baseline/` 目录**提交到仓库。
浏览器可能拦截连续下载，允许即可；也可以在结果表格里逐条确认后再放。

## 目录结构

```
golden/
├── golden.html       # 回归页（iframe 加载真实页面）
├── golden.js         # 运行器（manifest 读取、跑算法、统计、比对、生成基线）
├── manifest.json     # 样例清单 + 各样例容差
├── baseline/         # 基线 JSON（record 产出，check 读取，提交进仓库）
└── fixtures/         # 建议把测试图片放这里（git 忽略大图/人脸图可选）
```

## 添加/更新样例

1. 图片放入 `golden/fixtures/`，例如 `portrait-a.jpg`（**带正脸的人像照片**）；
2. 在 `manifest.json` 的 `fixtures` 里加一条：

```json
{
  "id": "portrait-a-52",
  "file": "./fixtures/portrait-a.jpg",
  "mode": "portrait",
  "granularity": 52,
  "skipIfMissing": true,
  "tolerance": { "colorCountDelta": 2, "codes": 4, "countRatio": 0.25 }
}
```

字段说明：

- `mode`：`portrait` 走人脸感知人像 v4 管线；其余走通用 `dominant`/其他模式（运行时以 dominant 为例）；
- `granularity`：横向格数；
- `skipIfMissing`：图片不存在时标记 SKIP 而不是 FAIL，方便先占位；
- `tolerance`：比对容差 —— `colorCountDelta` 用色数允许差、`codes` 色号集合差异允许数、
  `countRatio` 单色数量偏差比例。

3. 有图片的样例：先 `record` 生成基线再提交；`manifest.json` 与 `baseline/` 一起提交。

## 建议

- **基线是"机器相关"的**：人脸检测框、nsfwjs 可用性会随浏览器/环境略有差异。
  建议固定在一台机器 + 同款 Chrome 上做"改动前后对比"；跨机器先用 record 重打基线。
- 回归时先看**用色数与色号集合**是否漂移，再人工抽查效果图确认观感变化是否为预期。
- 仓库内置三条可跑冒烟样例（引用根目录 `images.png` / `libai-logo.png`），无图片也能验证框架本身；
  真正有价值的是人脸照片样例，请自行补充（注意人脸图的隐私与版权）。
