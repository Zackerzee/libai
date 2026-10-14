# 本地融合 V1：采样接缝实现

日期：2026-10-14。状态：可独立调用的实验算法模块及测试完成，未切换生产默认、未增加网页入口、未修改布局、未删除左栏、未接 API、未上线。

## 实现文件

- `services/local-fusion-engine.mjs`：本地自动策略与实验 runner。
- `smart-preprocessing/local-fusion-sampler.mjs`：六种原生降采样到 V2 RGB/null/feature 契约的适配。
- `smart-preprocessing/generation-engine-v2.mjs`：色卡匹配前的显式可选采样分支及诊断。
- `services/generation-pipeline.mjs`：验证命名策略并消费纯数据 overrides，不向生产配置泄漏控制字段。
- `tests/local-fusion-engine.test.mjs`、`tests/local-fusion-job.test.mjs`。

## API 与范围

`runLocalFusionEngine({image, size, palette, sampler:'auto', mode:'auto', maxColors, overrides})` 返回原有 pipeline 结果，附加 `fusion:{version,strategy,reason,evidence,scope:'sampling-only',legacyOptimization:false}`。

`sampler` 可为 auto、v2-baseline，或 fusion-pindou-area/nearest/dominant/edge/dpid/ssim。默认策略只在本地路由为 pixel/logo 且 confidence≥0.75 时选择 dominant，其余保守保留 V2 采样。这是待真实图片标定的实验规则，不是已证明最佳的推荐，更不宣称语义识别准确。

实际链路：原图与既有裁剪 → 单次原生 raw downsample（可选）→ 既有 V2 色卡匹配 → 保护 → 清理/精修 → 容差及预算 → finalize。没有运行原生量化/refine/remap，也没有叠加旧版 optimizer。旧版独有区域化/人像策略仍待独立评估，因此本版本不是完整“三引擎融合”成品。

Worker 边界可使用原有 `createGenerationRequest` 的 `overrides:{localFusionSampler:'fusion-pindou-dominant'}`，不传函数。原有 `executeGenerationJob` 可消费六个名称；错误名称显式报错。自动 runner 本阶段不挂到网站 Worker/按钮，不增加第二套画板状态。

## 透明与保护契约

保留原生采样 RGB 浮点结果；采样后 alpha≤8 转 null，复用 V2 阈值，而不是原生最终 remap 的 128 阈值。源图坐标及格子 bounds 留给现有保护分析；nearest 可选中透明孔洞，不能宣称所有采样策略 null 分布相同。高级采样对应既有 edge-aware 清理类别，是兼容策略，不是原生清理行为等价承诺。

## 已观察验证

- 新融合算法 10/10 PASS，现有任务边界 7/7 PASS。
- 合并相关回归 243/243 PASS：融合、源分类器、生成 pipeline/request/worker 协议、清理、感知采样、原生 54 组合及检查器。
- 最后加强非法策略验证后，任务边界 7 项重新通过。
- 关闭融合时，以修改前 pipeline 源码实际执行，对 52/78/104/250/500 五档合成输入输出矩阵做 deepEqual，全部相同；不是只比较色数，也不代表所有实图都已测试。
- 原生六采样 raw RGBA parity、确定性、源图不变、透明输入、上采样、输出合法色卡颜色均有测试。
- 日志：`/tmp/libms-fusion-v1-final.tap`、`/tmp/libms-fusion-job-final.tap`、`/tmp/libms-fusion-disabled-check.log`。

## 待验收与风险

需要真实照片、动漫、插画、像素、文字与透明图对比；五档性能/P50/P95/主线程阻塞在下一阶段实测，不能仅凭单元测试认定性能门通过。现有 request 在关闭容差时可能省略 paletteId，旧 code-based 预算也有多品牌同 code 兼容限制；本阶段没有修改请求/预算或声称 Worker 多品牌身份验收完成。后续已去重源分析：自动 runner 将同一原图的分类证据同步传入 pipeline，手动策略复用 pipeline 自身的分析；默认入口仍保持原来的分类路径。

未改工程/导出，既有 legacy 导出二次预算风险仍存在。必须在生产接入与简化界面前验证正式 grid、编辑、存档及导出一致性。

代码位于主项目工作树，所有既有未提交修改保留；未提交混合工作树。修改前备份：`/tmp/libms-fusion-v1-pipeline-before.mjs` 与 `/tmp/libms-fusion-v1-engine-before.mjs`。
