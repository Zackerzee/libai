# 算法参数注册表

`原值`是锁定提交的源码值；`试验范围`仅为本次审计提案，**不是原仓库默认值，也不是最终推荐配置**。敏感度是基于算法影响面的预判，需 benchmark 验证。

| 参数 | 来源 | 原值 | 意义 | 合法/代码范围 | 敏感度 | 试验范围 |
|---|---|---:|---|---|---|---|
| `EDGE_VARIANCE_THRESHOLD` | [A Worker L405–460](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L405-L460) | 0.008 | 格内线性 RGB 方差触发二簇 | 源码无显式调参范围 | 高 | 0.004–0.020 |
| 格内二簇迭代 | [A L478–515](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L478-L515) | 3 | 二簇收敛次数 | 固定 3 | 中 | 1–5 |
| `spatialWeight` / ICM λ | [A L912–919](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L912-L919) | 0.25/0.18/0.12/0.07（按短边） | 邻色平滑相对于 ΔE00 的权重 | 短边≤120才启用 | 高 | 0–0.20，先有锁定掩码 |
| ICM iterations | [A L912–919](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L912-L919) | 高质量4/普通2 | 扫描轮数 | 代码固定 | 中 | 1–4 |
| `targetSamples` | [A L272–289](https://github.com/Aswellle/Pindou-Studio/blob/850a4bf90ddec036839079f035b813560d00c446/src/workers/imageQuantizer.worker.js#L272-L289) | 22000/8000 | K-means 源图样本目标 | 固定模式值 | 中 | 仅性能基准后决定 |
| `variance` / luminance span | [B sampling L53–108](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L53-L108) | 0.012 / 0.24 | 从均值切到 dominant | 固定阈值 | 高 | 方差0.006–0.024；跨度0.16–0.32 |
| `dominantShare` | [B L90–108](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/imageSampling.ts#L90-L108) | 0.20 | dominant 最低覆盖 | 0–1 | 高 | 0.20–0.50 |
| `PRESELECT_COUNT` | [B matching L6–91](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/colorMatching.ts#L6-L91) | 12 | ΔE76 候选截断 | ≥1 | 高（正确性） | 12、24、全色卡；先全色卡对照 |
| balanced cleanup 区域/误差/边 | [B cleanup L5–10](https://github.com/Archmays/mard-bead-generator/blob/309d47825c5d0a144b17a6fbcb9da9ed86412d42/src/core/regionCleanup.ts#L5-L10) | 2 / 3.5 / 0.5 | 面积、允许 ΔE00 增量、边缘拒绝 | 三模式固定 | 高 | 面积1–3，误差0–4，边阈0.3–0.7 |
| 边色占比 | [C matcher L144–213](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/core/color-matcher.ts#L144-L213) | 0.30 | 限色时保留边界色号 | 0–1 | 中 | 0.2–0.5 + 最低样本数 |
| 清理面积 | [C CLI L148–155](https://github.com/Starrylyn/autoclaw-pixelbead-cli/blob/374de10c48cd49fb8185f3e2d4311b7b0e429114/src/cli/convert.ts#L148-L155) | 3 | ≤阈值连通域并色 | 非负整数 | 高 | 1–3，仅受保护门控后 |
| D 背景白阈值 | [D processor L17–32](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L17-L32) | 240 | 每通道大于阈值判背景 | 0–255 | 高 | 不进入 Hybrid 主链 |
| D 多数票/同色邻接 | [D L156–205](https://github.com/MrHorfen/PineBead-Studio/blob/ac15c4ca6cf5d55f810b5223f09c57543599c51d/src/utils/imageProcessor.js#L156-L205) | 6 / <2 | 8 邻覆盖 | 0–8 | 高 | 只作简单基线 |
| E `sampleSide` | [E L17–38](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L17-L38) | cartoon7 / realistic5 | 每轴定点数 | 正整数 | 中 | 5、7、9 |
| E `dominanceThreshold` | [E L17–38](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L17-L38) | 0.34 / 0.26 | 色号票数占比 | 0–1 | 高 | 0.25–0.55 |
| E 小域 size 档 | [E L363–375](https://github.com/Jett-Wu/Perler_Beads_Generator/blob/36ac52d570246ab600611a79edd2236bccb954e5/src/imageToBeads.ts#L363-L375) | 0,1,2,5,9 | 随净化力度增大 | 0–9（代码） | 高 | 1–3，禁用高档作对照 |
| F edge trigger | [F L548–568](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L548-L568) | 邻格差≥9 且均值/主色差≥1.5 | 取 dominant | 非负色差 | 高 | 6–15 / 1–4 |
| F tile scale | [F L573–592](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L573-L592) | 8 | 先缩成每格8×8 | 正整数 | 中 | 4、8、原图面积映射 |
| F 小域 size/色差 | [F L321–365](https://github.com/kuizuo/pin-dou/blob/e94193cbdebe9ea4d774ca62025ef46f0ef0d281/lib/pattern.ts#L321-L365) | edge 2/12；dominant 4/18 | 4 邻清理准入 | 非负 | 高 | size1–3 / 差6–18 |

实验固定条件：相同原图、裁剪、目标尺寸、221/291 实体色卡、`maxColors`、透明规则、初始图；一次只改变一个参数组，并保存算法版本与随机种子。评价不能只看平均 ΔE：还要看轮廓连续性、单颗豆、肤色层级、眼部/高光保留率和延迟。[CURRENT benchmark](../../smart-preprocessing/region-aware-benchmark.mjs) 可作为代码入口，但未见 110 图完整回归资产接入，需另行核实。

## G 补充：Topology 与尺寸参数

下表的“原值”来自 [`bead-grid-studio` 固定提交 `515e180`](07-bead-grid-studio.md)；试验范围是本次审计建议，不是上游参数或当前项目默认值。

| 参数 | 源码位置 | 原值/条件 | 含义/敏感度 | 建议实验范围 |
|---|---|---|---|---|
| `smallLineArtRefinement` | [G `app.js` L1951–1965](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1951-L1965) | 单色 cartoon 且目标长边≤60 | 拓扑支路门控；高 | 16/24/29/52/60/78 格作边界测试，勿直接上全图 |
| micro 超采样 | [G L1972–1979](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L1972-L1979) | `max(4,ceil(192/目标长边))` | 源部件投影精度/性能；高 | 目标 micro 长边 128/192/256（实验值） |
| micro ink cutoff | [G L2019–2037](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2019-L2037) | 0.08，骨架最多64轮 | 微像素二值化/细线生存；高 | 0.04–0.16，检查开口和噪点 |
| owner 候选数/最低支持 | [G L2039–2062、L2307–2330](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2039-L2062) | 最多12；候选支持≥.008 | 小部件落位；高 | 8/12/16；.004–.02 |
| G 彩色小域清理 | [G L2398–2429](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2398-L2429) | ≤2 格、每格 support<.42、邻色数≥大小+2 | 噪点误伤；高 | 面积1–2、支持.25–.5，须先有 source evidence |
| G 强调色相距离 | [G L2459–2470](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2459-L2470) | >.55 rad，≤3 色 | 色相多样性与预算保护；中 | .35–.8 rad、1–4 色 |
| G anchor 删除惩罚 | [G L2495–2515](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L2495-L2515) | 损失×40，**非绝对锁** | 极紧预算时可掉关键色；高 | 绝对锁 vs 20/40/80 惩罚 |
| G 文档/照片/线稿尺寸 | [G L359–384](https://github.com/zwhy149/bead-grid-studio/blob/515e1800c194651a4b2542e99d53c1701a3127e8/src/app.js#L359-L384) | document100；photo ultra160/normal100；lineArt60；other ultra120/normal100 | 固定分类尺寸 baseline；高 | Hybrid 候选52/78/104/120/140/160，需实测最小可用 |

`ga0my connectivity` — **STATUS: UNVERIFIED / 待核实；SOURCE: NOT CONFIRMED**，没有可登记的源码参数。
