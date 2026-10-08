/**
 * Generation pipeline — 图像特征分析 + 唯一生产 runner
 *
 * ── Stage B4 §2 之后本文件的定位 ──────────────────────────────────────
 * 模式表**不在**这里了，全部搬到 `services/mode-profile.mjs`（唯一 ModeProfile Registry）。
 * 本文件只剩两件事：
 *   · `analyzeGenerationImage()` —— 给 `auto` 路由提供证据
 *   · `runGenerationPipeline()`  —— 唯一的生成 runner（模式只注入配置，
 *     所有模式仍调用同一个 Generation Engine V2）
 *
 * 历史包袱说明（免得下次有人「顺手」加回来）：
 *   · 这里曾经有第二份 `GENERATION_MODE_PRESETS`。现在是 Registry 的**视图**，
 *     不是第二份数据 —— 改这里不会生效，改 `mode-profile.mjs` 才会。
 *   · 这里曾经手工做 `/100`、`preserveX ? 0.8 : 0` 的换算。现在统一走
 *     `toEngineOptions()`，单位换算只有那一个边界。
 *   · `LEGACY_ALGORITHM_OVERRIDES` 是个没有任何调用方的死导出，已删除。
 */

import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";
import { resolveLabCandidate } from "../smart-preprocessing/lab/index.mjs";
import { classifySource } from "./source-classifier.mjs";
import {
  GENERATION_MODES,
  MODE_PROFILES,
  SAMPLING_STRATEGIES,
  resolveGenerationPipeline,
  toEngineOptions,
} from "./mode-profile.mjs";

export { GENERATION_MODES, SAMPLING_STRATEGIES, resolveGenerationPipeline };

/**
 * @deprecated 历史名字，等价于 `MODE_PROFILES`。保留只为不打断既有导入；
 * 新代码请直接用 `services/mode-profile.mjs` 的 `MODE_PROFILES`。
 */
export const GENERATION_MODE_PRESETS = MODE_PROFILES;

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

/**
 * 源图特征分析 —— `auto` 路由的**唯一证据来源**。
 *
 * **不要在这里补 `portraitLikeness: 0`。** B4 §1 审计抓到过：这个字段曾被硬编码为 0，
 * 而 `auto` 的第一条路由规则是 `portraitLikeness >= .65`，于是那条规则在数学上
 * 永不触发，却看起来「在工作」。现在 `mode-profile.mjs` 的路由规则会检查
 * 证据字段**是否存在**，不存在的字段 → 规则明确地惰性，而不是被一个假 0 糊过去。
 *
 * 6 个指标的含义：
 *   edgeDensity      相邻采样点亮度差 > 32 的比例（轮廓密度）
 *   flatRegionRatio  亮度差 < 8 的比例（平色区占比）
 *   textureScore     归一化纹理能量
 *   colorComplexity  量化后颜色桶数 / 512
 *   pixelLikeness    平坦 + 轮廓 − 颜色复杂度（像素画特征）
 *   （portraitLikeness 暂无生产者，故意不返回）
 */
export function analyzeGenerationImage(source) {
  if (!source?.data || !source.width || !source.height) {
    return { edgeDensity: 0, flatRegionRatio: 0, textureScore: 0, colorComplexity: 0, pixelLikeness: 0 };
  }
  const { data, width, height } = source;
  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 12000)));
  let samples = 0, edges = 0, flat = 0, texture = 0;
  const colors = new Set();
  const lum = (i) => .2126 * data[i] + .7152 * data[i + 1] + .0722 * data[i + 2];
  for (let y = 0; y < height - step; y += step) {
    for (let x = 0; x < width - step; x += step) {
      const i = (y * width + x) * 4, right = (y * width + x + step) * 4, down = ((y + step) * width + x) * 4;
      const delta = Math.max(Math.abs(lum(i) - lum(right)), Math.abs(lum(i) - lum(down)));
      samples++;
      if (delta > 32) edges++;
      if (delta < 8) flat++;
      texture += Math.min(1, delta / 64);
      colors.add(`${data[i] >> 4},${data[i + 1] >> 4},${data[i + 2] >> 4}`);
    }
  }
  const edgeDensity = edges / Math.max(1, samples), flatRegionRatio = flat / Math.max(1, samples);
  const colorComplexity = clamp01(colors.size / 512), textureScore = texture / Math.max(1, samples);
  const pixelLikeness = clamp01(flatRegionRatio * .65 + edgeDensity * .35 - colorComplexity * .15);
  return { edgeDensity, flatRegionRatio, textureScore, colorComplexity, pixelLikeness };
}

/**
 * 路由证据 = 旧特征 + §12.2 分类器。
 *
 * 抽成一个导出函数，是因为**跑分器需要在生成之前就知道路由结果**：
 * §12.4 的 Bean Fit 模式策略要按路由后的模式决定候选跑不跑，
 * 而候选是在 `generateV2` 之前构造的。跑分器如果自己再拼一遍
 * `{...analyzeGenerationImage(), routing: classifySource().routing}`，
 * 那就是第二份接线 —— 两份必然漂移，而漂移的表现是
 * 「跑分器以为这图是 photo、生成时其实是 pixel」这种谁都看不出来的错。
 */
export function analyzeRoutingEvidence(image) {
  return { ...analyzeGenerationImage(image), routing: classifySource(image).routing };
}

/**
 * 唯一生产 runner。模式只注入配置，所有模式仍调用同一个 Generation Engine V2。
 *
 * `lab` 是 Stage B4 §6–§10 的候选算法接缝，**默认 null = 生产行为逐位不变**。
 * 它刻意不放进 `overrides`：overrides 是纯数据、要能结构化克隆，
 * 而 lab 里全是函数。
 *
 * ⚠️ 这条参数**不会**经由 `executeGenerationJob` 传进来（Worker 只吃纯数据）。
 * 也就是说 `lab` 只有主线程直调时存在 —— 这是对的，Lab 是实验场不是产品路径。
 * 反过来说：**任何「让 Worker 也支持 lab」的改动都意味着把函数塞进
 * structuredClone**，那是设计错误，不是功能缺失。
 */
export function runGenerationPipeline({ image, mode = "auto", size, palette, maxColors = 0, overrides = {}, onPhase = null, lab = null, inspect = false, experimentalSampler = null }) {
  if (typeof onPhase === "function") onPhase("analyze");
  // §13：`overrides.labCandidate` 是**纯字符串**的候选名（例如 "bean-fit"），
  // 在这里被解析成真正的 lab 实例。函数绝不跨进程边界 —— 请求里只有名字。
  //
  // 显式传进来的 `lab` 优先：那是主线程直调实验场（§6–§10 跑分器）的路径，
  // 它手里已经有实例了，不需要（也不该）再按名字造一个。
  //
  // `labCandidate` 必须**从 overrides 里摘掉**再往下走。`toEngineOptions` 只挑
  // 声明过的字段，理论上会丢掉它；但「理论上会丢掉」正是那种会在某次重构后
  // 变成「悄悄漏进引擎选项」的东西 —— 显式摘掉，让它是**结构上不可能**。
  const { labCandidate, ...engineOverrides } = (overrides && typeof overrides === "object") ? overrides : {};
  // §12.3：路由证据来自 `classifySource()`（19 个信号 + 硬规则 + 候选评分），
  // 不再来自 `analyzeGenerationImage().pixelLikeness`（§12.1 实测命中 9 张、真阳性 0 张）。
  // `routing` 挂在 analysis 上而不是新增一个参数：analysis 就是「路由证据」的载体，
  // 而 `toEngineOptions` 只挑声明过的字段，挂在这里不会漏进引擎选项。
  const analysis = analyzeRoutingEvidence(image);
  const profile = resolveGenerationPipeline(mode, analysis, engineOverrides);
  const activeLab = lab || (typeof labCandidate === "string" && labCandidate
    ? resolveLabCandidate(labCandidate, { mode: profile.routedMode })
    : null);
  // onPhase 单独传，**不放进 profile** —— 它是函数，配置要能结构化克隆。
  const options = toEngineOptions(profile, { maxColors, onPhase });
  if (inspect === true) options.inspector = true;
  if (experimentalSampler === "perceptual-v3") options.experimentalSampler = experimentalSampler;
  const result = generateV2({ source: image, width: size.width, height: size.height, palette, options, lab: activeLab });
  return {
    ...result,
    pipeline: {
      mode: profile.mode,
      routedMode: profile.routedMode,
      sampling: profile.sampling,
      analysis: profile.analysis,
      // 报告要能证明「这一列挂的是哪个候选」。null = 生产路径。
      labId: result.diagnostics?.lab?.id ?? null,
      // 请求里声明的候选名。即使解析失败（拼错 / pending）也原样带出来，
      // 这样「我请求了 bean-fit 但 labId 是 null」在报告里是可查的，而不是猜的。
      requestedLabCandidate: typeof labCandidate === "string" && labCandidate ? labCandidate : null,
    },
  };
}
