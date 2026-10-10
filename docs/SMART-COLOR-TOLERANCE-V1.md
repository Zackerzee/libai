# Smart Color Tolerance V1：纯算法交付

状态：纯算法与单元测试完成；等待确认。未接 V2.5、UI、导出、状态 store 或硬预算，未同步 deploy，未上线。

## 修改文件

仅新增：

- services/smart-color-tolerance.mjs：基线校验、保护快照、候选层级与派生网格。
- services/smart-color-tolerance-quality.mjs：复用 CIEDE2000、亮度与固定局部对比门控，质量诊断。
- tests/smart-color-tolerance.test.mjs：18项算法测试。
- tests/smart-color-tolerance-quality.test.mjs：9项质量测试。
- docs/SMART-COLOR-TOLERANCE-V1.md：本交付说明。

没有修改任何既有生产文件或标准色卡。

## API

```js
import { createSmartColorTolerance } from '../services/smart-color-tolerance.mjs';

const tolerance = createSmartColorTolerance({
  baselineGrid, // 调用方提供真实“清理后、预算前”矩形网格
  palette,      // 当前实际合法色卡条目，身份唯一，code/rgb完整
  protection,   // 可选：{protectionMap, tierMap}，至少一张有效图
  limits,       // 可选：实验质量门槛，不是智能推荐配置
});
const result = tolerance.evaluate(40); // 0–100强度，允许小数
const hierarchy = tolerance.getHierarchy();
```

算法不读取 generationOriginalGrid、不调用 applyBudgetPlan。调用方负责基线的流程来源；纯模块无法判断一张合法网格是否已经经过预算，后续接入需验证真实捕获位置。

创建时深拷贝 baselineGrid、palette、limits；冻结保护决策和基线对比参考。未传 protection 时复用 buildProtectionMap 在固定基线上推导保护；传入无效/空对象、非法数值/尺寸或稀疏网格会明确拒绝，不静默关闭保护。接受现有 CRITICAL=4 等完整 tier；保护分数≥0.5或 tier≥MEDIUM 的格子保持原色。只传分数图时按分数阈值，提供 tier 时会额外保护 MEDIUM。

基线每个非空格必须与 palette 的 paletteId/code/rgb 一致，否则拒绝。未改色格保留原格完整深拷贝；改色格复制合法目标条目，不平均RGB，不创建色号。目标代表从基线已使用的合法色卡条目中选取，V1不搜索未使用的色卡条目。

### 返回结果

```js
{
  grid,
  baselineColorCount,
  finalColorCount,
  mergedColorCount,       // baselineColorCount - finalColorCount
  rejectedMergeCount,
  protectedConflictCount,
  reasons,
  mapping,
  protectedCells,
  strength,
}
```

- 色数始终按 paletteIdOf（paletteId优先、code兼容）统计，不按RGB去重。
- rejectedMergeCount/reasons 中的拒绝项是整个层级构建过程的候选诊断，不是当前强度尝试数，也不是全局最优合并数。
- protectedConflictCount 是当前强度下，映射希望改色、但保护格保留原色的不同身份数量，不按步骤或颗数重复计数。对应原因带 retainedCells。0强度为0。
- mapping 是非保护格的直接原身份→代表身份；protectedCells 指明局部例外，不能把 mapping 当作整图全局无条件替换。
- 可发生背景格改色但保护格保留原色，此时实际色数不降，mergedColorCount为0。原因明确返回 protected-color-retained。
- 无 maxColors 入参或目标数承诺，V1不调用硬预算，也不宣称“无损”。

quality 模块额外提供 candidateCost、resolveToleranceLimits、buildLocalContrastReference、validateContrastReference、validateLocalContrast 和 measureToleranceQuality。后者输出平均/最大 ΔE00、ΔL、修改格数和局部对比诊断，不输出推荐或加权质量分。

## 层级构建

1. 以完整身份排序基线色；候选按归一化距离、目标身份、来源身份稳定排序，不依赖palette或对象遍历顺序。
2. 归一化代价=max(ΔE00/maxDeltaE, ΔL/maxDeltaL)，色差直接复用已有 deltaE2000。
3. 合并两簇之前，检查全部原始成员到拟定合法目标的直接ΔE00/ΔL。完整簇内存在同RGB不同身份时拒绝，第三种近色不能绕过该限制。
4. 用冻结基线渲染完整候选网格；保护格不变。对所有基线四邻边界检查最低对比和明显明暗顺序，不只比较当前中间输出。
5. 实际色数增加则拒绝；色数相等可接受局部合并，以保留保护格原色。
6. 接受后，将全部成员直接映射到目标，记录层级。层级激活强度=max(前层强度,1,ceil(簇最大归一化代价×100))。
7. evaluate只选择同一层级的前缀，并从原始深拷贝基线派生输出；不读上一次evaluate的grid。所有返回数据都是拷贝。

## 单调性与无环说明

令接受后的实际色数为 C0,C1,...。每个接受步骤显式校验 Ci≤Ci-1；激活强度序列非递减。若 s2≥s1，evaluate(s1)的步骤前缀包含于evaluate(s2)，所以 C(s2)≤C(s1)。相等强度的多个步骤整体激活，也不可能使色数增加。全部激活值至少1，故 evaluate(0)逐格等于基线。

每个簇代表都映射到自身；合并时所有原始成员一次性直接改指向新代表，新代表仍指向自身。不存在 A→B→C 的递归映射或环。即使层级后来换代表，也重新检查所有原始成员到最终代表的距离，不能用传递接近逃避距离约束。重复0↔100、修改输出或getHierarchy返回值不改变隐藏基线和层级。

## 验证

新增单元测试：27/27通过，0失败；独立代码复核确认无阻断。覆盖：

- 0逐格还原、嵌套对象深拷贝、输出及输入变更不污染基线；反复0↔100。
- 确定性、palette逆序、禁用空间门时颜色首次遇到顺序变化。
- 全部整数强度0–100扫描单调，身份/code/rgb合法、尺寸/null/非空颗数不变。
- 直接映射无环，每个原成员到代表满足门槛；不存在递归链式漂移。
- 保护格原色与同色背景格改色并存，冲突按不同身份计数，重复格不重复计数。
- 同RGB多品牌身份、无brand元数据身份、第三近色绕过回归。
- 明暗差、局部对比坍塌/明暗反转、固定对比参考、既有CIEDE2000标准参考值。
- CRITICAL=4保护、无效保护图/强度/门槛/色卡/稀疏输入明确拒绝。
- 空网格、单色网格、空诊断有限值。

扩大回归（tests与smart-preprocessing，排除发布同步检查）：1748项，1747通过、1项跳过、0失败，耗时42.29秒。最后的保护参数严格数组校验补充后，27项新增单测再次全部通过（84.54ms）。这些是测试套件耗时，不是实际图纸合并性能。

首次包含发布同步检查的扫描为1751项，1749通过、1跳过、1失败；失败仅为deploy缺少两个新services。发布同步检查不属于本阶段验收：它要求新services进入deploy；遵守“不得上线”边界，本轮刻意不打包这两个模块，未修改该检查以掩盖差异。

## 已知风险与下一阶段边界

- 默认实验门槛 maxDeltaE=12、maxDeltaL=6、minBaselineContrast=3、minContrastRatio=0.65、maxContrastLoss=2，未经过8类实图标定；不可称为最终画质标准或智能推荐。
- 基于当前图纸推导的保护不具备人物/服装/建筑语义识别；生产阶段应传递已有源图证据和冻结保护图。局部对比目前只检查四邻，不是完整拓扑验证。
- 固定候选排序仅走一遍，不重试已拒绝方向；同RGB不同身份采取保守分离，可能保留较多色。没有全局最优压色保证。
- 构建候选最坏约O(K²×格数)，当前仍多次渲染深拷贝并重新算候选Lab；需要后续真实尺寸/内存/阻塞测试与优化。未宣称生产性能达标。
- 单调测试覆盖整数强度；数学前缀设计覆盖全部有限0–100小数强度。
- 此阶段没有撤销、UI、导出集成；纯算法往返恢复已测试，不能据此宣称生产撤销/导出已验收。

停止点：不继续接V2.5，不同步deploy、不提交上线。等待确认后，再实施真实清理后/预算前基线接缝、唯一store和缓存失效、显式预算政策及预览/导出一致性。
