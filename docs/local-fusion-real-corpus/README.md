# 真实素材语料与路由决策（2026-10-14，Phase 1/2）

用户批准「磁盘候选 + 明确标注局限」后的第一轮真实素材对比。输入清单：
`local-fusion-real-corpus-inputs.json`（每条带 provenance 与局限标注）。
复跑：`node tools/local-fusion-calibration.mjs --out=docs/local-fusion-real-corpus --inputs=docs/local-fusion-real-corpus-inputs.json`
（`--out` / `--inputs` 均为新增参数，默认行为不变；基础三件保留以保持可比。）

## 路由决策总表（calibrated-auto）

| 输入 | 分类器输出 | 置信度 | 结构包络 | 决策 | 与手动 dominant 一致 |
|---|---|---:|---|---|---|
| brand-logo（真 Logo） | illustration | 1.000 | **eligible** | **dominant** | 是（全网格一致） |
| pixel-guoqingsi-preview（真实像素结构） | pixel | 0.969 | 不适用（走硬门） | **dominant** | 是（全网格一致） |
| new-year-sign（贺岁牌） | auto | 0.054 | 未过 | baseline | — |
| fantasy-illustration（幻想插画） | photo | 0.381 | 未过 | baseline | — |
| text-handwritten-letter（真实手写信） | illustration | 1.000 | 未过 | baseline | — |
| text-handwritten-pledge（真实手写承诺书） | illustration | 0.395 | 未过 | baseline | — |
| document-license-scan（营业执照扫描） | anime | 1.000 | 未过 | baseline | — |
| illustration-2903 | illustration | 0.953 | 未过 | baseline | — |
| illustration-pixler-screenshot（带 UI 的截图） | illustration | 0.852 | 未过 | baseline | — |
| illustration-ai-generated（AI 生成，非真实摄影/动漫） | illustration | 0.581 | 未过 | baseline | — |

40 个变体（10 输入 × 4 变体）：**非法色号 0、paletteId 身份错配 0**、尺寸精确、源图不可变，全部通过。

## 结论

1. **文字类：校准结果 = 保守回退，已被三个真实样本证实。** 两份手写件 + 一张执照扫描全部落 baseline；若强行 dominant，手写信会改掉 6804 格、承诺书 4498 格——细笔画会被采样策略摧毁。分类器把手写信路由成 illustration 1.000、把执照路由成 anime 1.000，**模式标签在文档面前不可靠，但决策链（结构包络 + 硬门）给出了正确保守答案**。文字不需要新策略，需要的是这条已被证实的回退。
2. **像素画类：真实样本（国清寺预览）经原生像素硬门（0.969）正确选 dominant，与手动 dominant 全网格一致。** 硬门与结构包络两条路各司其职，互不替代。
3. **插画类：五个候选全部正确回退**（含 AI 生成图——按用户要求标注局限，不计入真实摄影/动漫）。
4. **仍未覆盖：真实照片/人像、真实动漫。** 磁盘候选里没有（所有「照片」实为文档扫描）。这是 Phase 2 的硬缺口，需要用户供图，不能用合成夹具冒充。

## 测试锁定

`tests/local-fusion-calibration.test.mjs` 新增两条真实素材决策测试：
像素预览必须走硬门选 dominant 且与手动一致；手写信/承诺书必须保持 baseline
且与 previous-auto 一致。与身份修复测试（local-fusion-identity）、
链路测试（workbench-consistency-chain）合计 14/14 通过。

## 边界

- 每类真实样本量小（文字 3、像素 1、插画 5），是「决策正确性」证据，不是泛化性证明。
- 营业执照扫描件被分类器标为 anime 1.000：再次说明**不能把分类器模式当语义结论**，
  自动路由的对外表述只能讲「结构决策」，不能讲「识别出了文字/动漫」。
- 未碰布局、色块条、左栏、API、发布配置；未提交、未同步 deploy、未上线。
