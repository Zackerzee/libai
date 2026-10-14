# paletteId 身份修复 — 实图复验（2026-10-14）

Phase 3 优先修复项。修复 `applyBudgetPlan` 合并颜色后不同步 `paletteId` 的缺陷；
只改身份字段，颜色输出与视觉输出可证明零变化。既有证据未被覆盖：
`../local-fusion-calibration/` 保持修复前原样，本目录是修复后复跑结果。

## 根因

`smart-preprocessing/protected-palette-budget-v2.mjs` 的 `applyBudgetPlan`
合并颜色时同步 `code/rgb/hex/name`，唯独不同步 `paletteId`。于是合并后格子
`code/rgb` 是目标色、`paletteId` 还是来源色旧值（实测例：
`{code:'F3', rgb:[247,73,65], paletteId:'mard:F2'}`）。`paletteIdOf` 先读
`paletteId` 再回落 `code`，编解码按 identity 归并色板时会把两个色号并成一条，
导出身份随之错配。

opt-in 容差路径（`services/smart-tolerance-budget.mjs`）早有补救；
**默认路径（容差关闭）直接调 `applyBudgetPlan`，没有这层保护**——生产默认
管线因此漏身份。修复落在 `applyBudgetPlan` 自身：目标色有 `paletteId` 则同步，
没有则删除来源色陈旧身份；对不携带身份的调用方（hybrid 内部矩阵等）为无操作。

## 复现与回归

- 新增 `tests/local-fusion-identity.test.mjs`：修复前三红（含默认引擎路径
  端到端实测 32 格错配），修复后三绿。
- 回归 82/82 PASS：预算模块自身、融合全家桶、容差双路径、编辑器减色、
  生产引擎、smart-color-tolerance，零回归。
- 复跑：`node tools/local-fusion-calibration.mjs --out=docs/local-fusion-identity-fix`
  （`--out` 为本次新增参数，默认值不变；重跑务必写新目录，勿覆盖既有证据）。

## 实图对比（修复前 → 修复后）

同一贺岁牌/品牌 Logo/幻想插画，MARD 291 色，maxColors 16，104 长边：

| 输入 | 变体 | 身份错配 | 非法色 | 与 V2.5 差异格 | 策略 |
|---|---|---:|---:|---:|---|
| brand-logo | v25 | 110→0 | 0→0 | 0→0 | 不变 |
| brand-logo | previous-auto | 110→0 | 0→0 | 0→0 | 不变 |
| brand-logo | calibrated-auto | 0→0 | 0→0 | 2305→2305 | dominant 不变 |
| brand-logo | manual-dominant | 0→0 | 0→0 | 2305→2305 | dominant 不变 |
| new-year-sign | v25 | 1193→0 | 0→0 | 0→0 | 不变 |
| new-year-sign | previous-auto | 1193→0 | 0→0 | 0→0 | 不变 |
| new-year-sign | calibrated-auto | 1193→0 | 0→0 | 0→0 | 不变 |
| new-year-sign | manual-dominant | 6→0 | 0→0 | 2203→2203 | dominant 不变 |
| fantasy-illustration | v25 | 2028→0 | 0→0 | 0→0 | 不变 |
| fantasy-illustration | previous-auto | 2028→0 | 0→0 | 0→0 | 不变 |
| fantasy-illustration | calibrated-auto | 2028→0 | 0→0 | 0→0 | 不变 |
| fantasy-illustration | manual-dominant | 2242→0 | 0→0 | 3557→3557 | dominant 不变 |

不变量全部保持：`differingCellsVsV25` 逐项一致（颜色输出零变化）、
策略决策不变、源图不可变、尺寸精确。12 份对比图 + contact sheet 与修复前
**字节级相同**（视觉输出零变化）。gridSha256 变化 10/12，恰为此前有错配的
变体；2 个未变项此前已一致。

## 边界

- 本修复不改变任何 code/rgb/hex，不宣称画质变化；只保证身份与色号一致。
- 未碰布局、色块条、工程/导出格式、API、发布配置；未提交、未同步 deploy、
  未上线。deploy/ 当前落后于本修复，发布前须由提交管家统一同步。
- legacy 导出二次预算风险仍未排查（Phase 3 下一项）。
