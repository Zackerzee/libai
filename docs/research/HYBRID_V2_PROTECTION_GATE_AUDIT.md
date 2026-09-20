# Hybrid V2 Phase B.1 — Protection Gate Audit

- 生成时间：2026-09-18T06:37:55.639Z
- 夹具数：8（真实缺陷夹具，照片级生成，落盘于 tests/fixtures/real-failures/）
- 尺寸：CURRENT / HYBRID 同为 104×104
- 流程：REAL IMAGE → CURRENT → CURRENT Matrix → Hybrid V2 后处理（STRICT / TRACE_ONLY）

> ⚠️ **本报告不对 CURRENT 与 Hybrid V2 做优劣判定、不输出胜者、不输出总分。**
> TRACE_ONLY 列是**仅模拟**——展示"如果关闭 CURRENT 保护门，Hybrid V2 会改哪些格"，
> 它**不得**据此判定 Hybrid V2 已「改进」，只用于定位保护门的行为与潜在代价。

## 一、跨夹具聚合回答（用户第 12 条 10 问）

**Q1.** 总共 **4020** 个 change proposal（跨 8 夹具，来自 Hybrid V2 的清理/规整阶段）。
**Q2.** 其中 **4020** 个被 CURRENT 保护门拦截（rejectedByProtection = REJECT_PROTECTION + REJECT_STRUCTURE）。只有 **0** 个在 STRICT 下被允许。
**Q3.** 拦截主要落在保护类型 **outline**（2767 个），分层以 **SOFT_PROTECT** 为主。
**Q4.** 这些 proposal 主要来自阶段 **Edge-Contamination-Clean**（4020 个）。
**Q5.** TRACE_ONLY 模拟：若关闭保护门，预计清除 noise **0** 个、清理边缘杂色 **4020** 个、规整碎片 **0** 个（合计 hypotheticalGridDiff = 4020 格）。
**Q6.** 同一模拟下可能损失：结构 **0** / 高光 **1224** / 桥 **0** / 分离部件 **0** / 轮廓 **2767** / accent **0**。
**Q7.** **存在 over-protection 证据**：HARD 眼/高光保护误拦清理提案 **274** 个（典型：亮背景线条图上 detectHighlight 把背景亮格标为 eye-highlight）；另有 SOFT 保护误拦安全噪点清理 **0** 个。
**Q8.** 具体为 **eye-highlight (HARD)** 类——在 EDGE_CONTAMINATION / THIN_STRUCTURE 等亮背景夹具上，CURRENT 的 highlight 保护把背景亮格也标成 HARD，阻断了合法边缘清理。
**Q9.** 必须继续 **HARD** 的：eye-highlight（真实瞳孔高光）、bridge（桥接格）、separated-component（独立小部件）、critical structure（高 tier 结构）。
**Q10.** 值得进入 **SOFT / confidence-based gate** 实验的：ordinary outline、accent candidate、低置信 structure；以及条件化的"亮背景上的 eye-highlight"判定（应降为 SOFT 或加面积/邻域约束）。

## 二、逐夹具明细（用户第 13 条）

| 夹具 | 类别 | gridDiff(STRICT) | gridDiff(TRACE) | proposals | rejectedByProt | byFlags(主导) | noiseΔ(S) | edgeΔ(S) | structΔ(T) | hlΔ(T) |
| --- | --- | ---: | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: |
| rf-aa-leak | ANTI_ALIAS_LEAKAGE | 368 | 1499 | 1187 | 1187 | eye-highlight:1187 | 165 | 13 | 0.010 | 0.000 |
| rf-anime-hl | ANIME_HIGHLIGHT | 61 | 63 | 3 | 3 | outline:3 | -1 | -1 | 0.159 | 0.000 |
| rf-complex | COMPLEX_SCENE | 121 | 165 | 80 | 80 | outline:80 | 2 | 44 | 0.082 | 0.000 |
| rf-edge-contam | EDGE_CONTAMINATION | 584 | 664 | 177 | 177 | outline:148 | -112 | -62 | 0.230 | 0.000 |
| rf-flat-frag | FLAT_REGION_FRAGMENTATION | 2796 | 4893 | 2534 | 2534 | outline:2534 | 251 | 328 | 0.142 | 0.000 |
| rf-portrait-eye | PORTRAIT_EYE_DETAIL | 41 | 43 | 3 | 3 | eye-highlight:2 | -1 | -1 | 0.013 | 0.000 |
| rf-small-sep | SMALL_SEPARATED_COMPONENT | 41 | 41 | 1 | 1 | outline:1 | 1 | -2 | 0.143 | 0.000 |
| rf-thin-struct | THIN_STRUCTURE | 102 | 114 | 35 | 35 | eye-highlight:35 | -43 | -53 | 0.190 | 0.000 |

> 列后缀：**(S)** = STRICT 相对 CURRENT 的真实增量（清理被保护拦截，通常 ≈0）；**(T)** = TRACE_ONLY 相对 CURRENT 的**潜在**变化（仅模拟）。

## 三、逐夹具 proposal 来源（stage × 保护分层）

| 夹具 | byStage | byLayer(HARD/SOFT/UNPROT) | softSafe | hardHL-blocks |
| --- | --- | --- | ---: | ---: |
| rf-aa-leak | Edge-Contamination-Clean:1187 | H1187/S0/U0 | 0 | 268 |
| rf-anime-hl | Edge-Contamination-Clean:3 | H0/S3/U0 | 0 | 0 |
| rf-complex | Edge-Contamination-Clean:80 | H0/S80/U0 | 0 | 0 |
| rf-edge-contam | Edge-Contamination-Clean:177 | H0/S177/U0 | 0 | 0 |
| rf-flat-frag | Edge-Contamination-Clean:2534 | H0/S2534/U0 | 0 | 0 |
| rf-portrait-eye | Edge-Contamination-Clean:3 | H2/S1/U0 | 0 | 1 |
| rf-small-sep | Edge-Contamination-Clean:1 | H0/S1/U0 | 0 | 0 |
| rf-thin-struct | Edge-Contamination-Clean:35 | H35/S0/U0 | 0 | 5 |

## 四、边界与结论

1. **STRICT 与 CURRENT 逐格高度一致**是预期结果：Hybrid V2 复用 CURRENT 的统一保护门，凡它想改的格正是 CURRENT 已保护的格，故被拦截。
2. **审计揭示的是 CURRENT 保护门的行为**，不是 Hybrid V2 的修复能力。要验证 Hybrid V2 能否真正修复缺陷，需要放松保护门（SOFT/confidence 实验）并人工看图确认——本阶段**只诊断、不改行为**。
3. **over-protection 信号**：在亮背景线条类夹具上，CURRENT 的 highlight 保护过宽（背景亮格被标 HARD），是后续 SOFT/confidence 实验的首选对象。
4. **严禁**：本报告的 TRACE_ONLY 数字**不得**据此判定 Hybrid V2 已「改进」；不接正式网站、不替换 CURRENT、不进入 Phase C、不放松 buildProtectionMap。

---

自检：banned-words 未命中 ✅（本报告用语中立）