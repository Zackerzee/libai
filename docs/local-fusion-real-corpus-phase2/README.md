# 真实照片 / 动漫语料补验（2026-10-14，Phase 2 收尾）

用户供图后对 Phase 1/2 硬缺口的补充复跑：首批真实照片（成都 IFS 夜景实拍）与真实动漫（蓝袍古风角色立绘）。
输入清单：`../local-fusion-real-corpus-phase2-inputs.json`（9 个真实输入 + 工具内置基础 3 件 = 12 行，每条带 provenance）。
复跑：`node tools/local-fusion-calibration.mjs --out=docs/local-fusion-real-corpus-phase2 --inputs=docs/local-fusion-real-corpus-phase2-inputs.json`
（该工具为全串行流程，12 行约需 6 分钟，前台跑超过 Bash 默认超时会被 SIGTERM，须后台执行。）

## 本轮新增两项的路由决策

| 输入 | 分类器输出 | 置信度 | 结构包络 | 决策 | 与手动 dominant 一致 |
|---|---|---:|---|---|---|
| photo-ifs-night-cityscape（真实照片，1280×1920） | auto | 0.101 | 未过（eligible=false） | **baseline** | — |
| anime-guofeng-character（真实动漫，1086×1448） | illustration | 0.599 | 未过（eligible=false） | **baseline** | — |

两项的 calibrated-auto 与 V2.5 / previous-auto **零格差异**（diff=0），即保守回退被真实照片与真实动漫同时证实；
若强行 manual-dominant，分别会改动 1546 / 1910 格——夜景的灯光渐变层次与动漫的cel 层次会被 dominant 采样抹平。
这与 Phase 1 的结论方向一致：结构包络只对「少色平坦结构」（Logo/像素画）放行 dominant。

## 全量结果

48 个 case（12 输入 × 4 变体）：**非法色号 0、paletteId 身份错配 0、尺寸精确、源图不可变，全部通过**。
calibrated-auto 与 previous-auto 的策略翻转仅一处：brand-logo（v2-baseline → dominant），即校准的预期目标——
真 Logo 少色平坦结构放行 dominant，与手动全网格一致；其余 11 项决策不变。
corpus 25 个合成夹具策略变化为 0（本地夹具集合无回归）。

## 结论

1. **Phase 2 的硬缺口（真实照片 / 真实动漫）已由用户供图闭合**：两类素材各 1 个样本，均正确保守回退，
   至此本地自动路由在全部六个类别（Logo/像素画/文字×3/插画/照片/动漫）上都有真实素材决策证据。
2. **样本量仍小**：照片 1、动漫 1，是决策正确性证据，不是泛化性证明；对外表述沿用「结构决策」，
   不宣称「识别出了照片/动漫」——本轮分类器把夜景标为 auto 0.101、把动漫立绘标为 illustration 0.599，
   标签与语义的对应关系依然不可依赖。
3. **仍未做**：浏览器层 ICC 一致性、生产默认引擎切换（见 Phase 4 决策报告）、左栏迁移（只规划不删除）。

## 证据文件

- `metrics.json`：48 case 的 strategy/diff/illegal/identity/dimensions/immutable 逐项数据
- `manifest.json`：输入文件 SHA256、尺寸、证据与包络判定、调色板哈希
- `corpus.json`：25 个合成夹具的 previous/calibrated 策略对照
- `contact-sheet.png`：12 行 × 5 列总览（源图 / v25 / previous-auto / calibrated-auto / manual-dominant）
- `*-v25.png` 等 48 张单变体预览
