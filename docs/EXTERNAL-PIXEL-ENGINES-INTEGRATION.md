# 两个像素算法核心接入记录（2026-10-18）

## 强制约束

所有新采样器必须接收调用方的目标宽、高，不使用第三方默认 64/128 或自动检测尺寸覆盖作品尺寸。输出经现有 V2 品牌色卡匹配、细节保护、清理、容差与色数预算链路，最终格子来自传入的合法色卡对象，不能凭 HEX 生成品牌色号。`getGenerationPaletteColors` 的品牌型号、可用色和 MARD H01 排除规则保持原样。

不改布局，不增加生成模式入口，不接第三方在线服务，不上传图片。未发布。

## 实际接入范围

### Pixel Art Fixer

上游 `Retro-Diffusion/pixel-art-fixer`，固定 SHA `ef376e57e1c272633ca2dbf5f29ec3fcf6596465`，MIT。

`smart-preprocessing/pixel-art-fixer-sampler.mjs` 是 `adaptive_k` / `two_stage_pack` 的选定 JavaScript 适配：结构颜色标签投票决定形状，再从获胜标签的原始像素取中心加权颜色。传入的宽高定义重建网格，支持非方形与放大。

为适合浏览器，结构聚类改为最多 4096 个四位 RGB 桶、确定性初始化、最多 12 次迭代。透明隐藏 RGB 不参与聚类与颜色投票，源图不变。数值不保证与 cv2/sklearn 完全一致。

**不是完整上游引擎**：不包含自动网格检测器、多检测器仲裁、扭曲网格修复、神经网络或原生 Rust 运行时。完整差异见 `vendor/pixel-art-fixer/PROVENANCE.md`。

### Image-to-Pixel

上游 `Tezumie/Image-to-Pixel`，固定 SHA `3dc4cf82c52b7bcdfc3866a88a8c417d83c3a064`，MIT。

`vendor/image-to-pixel/resample.mjs` 原样抽取其 CPU alpha-weighted box 采样函数；`smart-preprocessing/image-to-pixel-sampler.mjs` 负责参数验证和 RGBA 转换。透明隐藏 RGB 不会染白/染黑可见颜色。

**不是完整上游引擎**：未引入内置色卡、16 种抖动、GPU/ShaderMate、编辑器和视频导出。最终量化继续由本站品牌匹配负责。

## 生产接缝与自动路由

1. `smart-preprocessing/local-fusion-sampler.mjs` 注册 `fusion-pixel-art-fixer` 和 `fusion-image-to-pixel`，复用原 RGBA → colors/features 合同。
2. `services/local-fusion-engine.mjs` 使用原分类与置信度门：高置信度像素类使用 Fixer；高置信度 Logo 或满足原有干净平色结构门的图片使用 Image-to-Pixel；其他图像继续 V2 保守分支。
3. 采样结果仍交给 `generation-engine-v2.mjs` 原有匹配阶段，不增加第二套 grid、品牌身份或导出矩阵。
4. 原 `fusion-pindou-*` 六种策略和 `v2-baseline` 保留；显式策略也能通过已有可序列化 overrides 传入 Worker job。

输出最大 1000×1000。Fixer 源图上限 400 万像素，Image-to-Pixel 上限 16,777,216 像素。自动路由遇到上限会选择能容纳该源图的 Image-to-Pixel／旧 dominant 分支，并在 `sourceSizeFallback` 记录原因；不缩小用户目标尺寸。显式指定超过能力上限时明确报错。

实际大源图复现：2048×2048、置信度约 0.857 的像素棋盘，经自动上限回退至 Image-to-Pixel，成功生成指定 97×97，报告记录 requested Fixer 与 selected Image-to-Pixel。

## 测试与性能

独立专项：Fixer 9/9、Image-to-Pixel 7/7、生产端到端 24/24 通过。新增自动上限边界与大源图案例；相关回归及完整回归最终结果另附执行日志，不以单元测试代替浏览器效果验收。

最终合并专项 **77/77 通过，0 失败**（`/tmp/libms-pixel-engines-focused-20261018.tap`）；包含两个源图上限测试、生产请求及 H01/H02。此前真实图路由与两采样器集合 **22/22 通过**（`/tmp/libms-pixel-adapters.tap`）。

全量回归：**2761 项，2734 通过、26 失败、1 跳过**，日志 `/tmp/libms-pixel-engines-full-20261018.tap`。没有宣称全绿或放宽断言。失败列表未包含本次新采样器、集成、H01 和上限测试；其余仍需独立归因，不能全部笼统视为无关。

其中 `tests/deploy-sync.test.mjs` 读取既有 `vendor/fusion-pixel/Fusion-Pixel-12px-Monospaced-Simplified-Chinese.CJK-Unified-Ideographs-010.woff2` 挂起，CPU 为 0，经文件句柄定位后终止本次检查进程，该项计为失败。同样挂起的同步进程也终止；未删除或改动该字体。其他 25 项主要落在既有界面结构、标尺、色卡 VM 测试夹具、临时菜单与字体断言，未在本算法任务中修改。

本次算法涉及的运行文件及两份许可证已按明确清单同步到 deploy，并逐文件核对一致；因上述字体读取问题，**全清单同步验收未完成**。未发布、未提交，既有工作树修改保留。

端到端检查包含 52×52、97×97、104×78、78×104，尺寸更改、同 RGB 多品牌身份、可用色子集、预算后身份、透明/null、源图不可变、Worker 请求结构化克隆及结果编解码。H01 测试使用真实 MARD 色值和生产过滤器：MARD H01 排除、白色 H02 合法；COCO H01 仍为合法不透明颜色。

Node v22.22.0 / macOS，256×256 合成棋盘带透明区域，每档三次；下表为中位数，毫秒。生产耗时包括匹配和后续处理，不是纯采样。不是浏览器主线程阻塞或真实图片画质测量。

| 目标尺寸 | Fixer 采样 / 整链路 | Image-to-Pixel 采样 / 整链路 |
| --- | --- | --- |
| 52×52 | 1.013 / 222.202 | 0.563 / 174.485 |
| 97×97 | 11.732 / 372.378 | 0.383 / 379.704 |
| 104×104 | 13.950 / 406.693 | 0.336 / 401.177 |
| 256×256 | 2.533 / 1742.974 | 0.607 / 1761.566 |

复现脚本 `tools/external-pixel-benchmark.mjs`；本次原始数据 `/tmp/libms-external-pixel-benchmark-isolated-20261018.json`。仅三次，未据此宣称可靠 P95 或全部图片更好。冷/热 JIT 与图片结构会影响采样耗时；256 档整链路仍约 1.7 秒，应使用现有 Worker，不能宣称 UI 性能通过。

## 验收边界

既有真实 Logo、像素图、插画、贺岁牌、文档测试复跑，检验路由和状态合同；没有把自动采样发生变化的图纸继续断言成与旧输出相同。照片/复杂插画等保守回退仍要求旧输出逐格相同。

浏览器访问此前被安全策略拒绝，本次未绕过。实际页面滑动尺寸、真实图片视觉效果和浏览器性能验收仍未执行；不能据此称生产就绪或完整上游移植完成。所有既有未提交修改继续保留。
