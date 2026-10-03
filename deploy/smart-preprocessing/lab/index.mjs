/**
 * §11 COMBINATION MATRIX —— Lab 候选注册表与组合器。
 *
 * ── 为什么要一个组合器，而不是每个组合写一个类 ────────────────────────
 * §11 列了 11 个条目，其中 5 个是组合。如果每个组合各写一份实现，
 * 「BeanFit+Neutral 比 BeanFit 好在哪」这个问题就永远答不了 ——
 * 两个实现之间除了中性惩罚，还会有一堆没人注意到的差异。
 *
 * 组合器只做一件事：把候选按**优先级顺序**串起来。
 *   · matchCell  依次询问，第一个给出非 undefined 意见的胜出
 *   · refineGrid / cleanup  最多各挂一个；挂两个直接抛
 *
 * 后一条是刻意的：refine 是有状态的迭代过程，cleanup 会改 grid 并产出 records，
 * 两个叠在一起的结果取决于执行顺序，而「取决于执行顺序」在报告里
 * 无法解释。宁可炸，也不要一个没人能复现的数字。
 *
 * ── 组合顺序不是随便排的 ──────────────────────────────────────────────
 * Dual Mode 排在 Bean Fit **前面**：Dual Mode 只在「这格有两群像素、
 * 且少数那群确实是一块结构」时才表态，那是一个比 Bean Fit 更具体、
 * 证据更强的判断。让它先说话，Bean Fit 收拾剩下的。
 *
 * ── §12 纪律：auto 误路由不要修 ────────────────────────────────────────
 * 本文件里**没有**任何路由逻辑。所有候选都挂在同一个 mode 上跑，
 * 这样 §13 的指标差异才能归因到算法本身。
 */

import { createBeanFit } from "./bean-fit.mjs";
import { createDualMode } from "./dual-mode.mjs";
import { createNeutralProtection } from "./neutral-protection.mjs";
import { createSpatialRefine } from "./spatial-refine.mjs";
import { createConservativeCleanup } from "./conservative-cleanup.mjs";

export { createBeanFit, createDualMode, createNeutralProtection, createSpatialRefine, createConservativeCleanup };

/**
 * 把若干候选合成一个 lab 对象。
 * @param {Array<object|null>} labs 按**优先级从高到低**排列
 * @param {string} id 组合 id（会写进 diagnostics.lab.id）
 */
export function combineLabs(labs, id) {
  const list = (labs || []).filter(Boolean);
  if (!list.length) return null;
  if (list.length === 1) return list[0];

  const refiners = list.filter((l) => typeof l.refineGrid === "function");
  if (refiners.length > 1) {
    throw new Error(`combineLabs(${id})：挂了两个 refineGrid（${refiners.map((l) => l.id).join(" + ")}）。refine 是有状态的迭代过程，叠加没有定义。`);
  }
  const cleaners = list.filter((l) => typeof l.cleanup === "function");
  if (cleaners.length > 1) {
    throw new Error(`combineLabs(${id})：挂了两个 cleanup（${cleaners.map((l) => l.id).join(" + ")}）。cleanup 会改 grid 并产出 records，叠加结果依赖执行顺序。`);
  }

  const matchers = list.filter((l) => typeof l.matchCell === "function");
  const refiner = refiners[0] || null;
  const cleaner = cleaners[0] || null;

  return {
    id,
    memberIds: list.map((l) => l.id),
    matchCell: matchers.length ? (ctx) => {
      for (const lab of matchers) {
        const produced = lab.matchCell(ctx);
        if (produced !== undefined) return produced;
      }
      return undefined;
    } : undefined,
    refineGrid: refiner ? (ctx) => refiner.refineGrid(ctx) : undefined,
    cleanup: cleaner ? (ctx) => cleaner.cleanup(ctx) : undefined,
  };
}

/**
 * §11 的组合矩阵。`build()` 每次返回全新实例 —— 组合对象里有 `memberIds` 等
 * 一次性字段，复用实例会让「这一列是谁」和「这一列上一次是谁」混在一起。
 *
 * `build({ mode })` 收到的是**路由之后的**模式名（跑分器算好传进来）。
 * §12.4 起 Bean Fit 要用它查模式策略表；其它候选目前忽略这个参数。
 * 传 `mode` 而不是让候选自己去猜，是因为「这一列是在什么模式下跑的」
 * 必须是跑分器说了算 —— 候选自己猜出来的模式，报告里无法复核。
 *
 * 注意 report **不挂在实例上**：候选的统计挂在引擎每次 `generateV2` 新建的
 * `ctx.report` 上，所以跨运行不会泄漏（tests/candidate-determinism.test.mjs 钉住了）。
 * 但**单次运行内**是逐格累加的，别指望 stat.cells 恒为 1。
 *
 * `recommended-hybrid` 标了 `pending: true`：§15 的裁定必须建立在
 * §14 的 contact sheet 人工看图之上，现在填一个「我猜」的组合，
 * 等于把结论提前写死。跑分器遇到 pending 会明确打印「尚未裁定」而不是跳过。
 */
/**
 * 每个 `build()` 都**显式**传 `id`，值就是矩阵条目的 id。
 *
 * 不这么做的后果不是报错，是报告对不上：跑分器按矩阵 id 建列，
 * 而 `diagnostics.lab.id` 用的是候选实例自己的 id。两者不一致时，
 * 「Neutral 这一列的 diagnostics 在哪」要靠人肉映射，
 * 而映射一错，§15 的裁定就建立在一个错柱子的数据上。
 * （实测：Neutral 列的自报 id 一度是 `neutral-protection`。）
 */
/** 所有带 Bean Fit 的条目共用同一套「把 mode / policy 传进去」的接线 —— 少写一遍就少漂移一次。 */
const beanFit = (id, extra = {}) => (ctx = {}) => createBeanFit({
  id,
  mode: ctx.mode ?? null,
  policyOverride: ctx.policy ?? null,
  ...extra,
});

export const LAB_MATRIX = Object.freeze([
  { id: "current", label: "CURRENT（生产基线）", build: () => null },
  { id: "bean-fit", label: "BeanFit", build: beanFit("bean-fit") },
  { id: "dual-mode", label: "DualMode", build: () => createDualMode({ id: "dual-mode" }) },
  { id: "neutral", label: "Neutral", build: () => createNeutralProtection({ id: "neutral" }) },
  { id: "spatial", label: "Spatial", build: () => createSpatialRefine({ id: "spatial" }) },
  { id: "cleanup", label: "Cleanup", build: () => createConservativeCleanup({ id: "cleanup" }) },
  {
    id: "bean-fit+neutral",
    label: "BeanFit+Neutral",
    // 同一个成本函数里多一项惩罚，不是两个匹配器比大小（见 bean-fit.mjs 的注释）
    build: beanFit("bean-fit+neutral", { neutral: {} }),
  },
  {
    id: "bean-fit+dual-mode",
    label: "BeanFit+DualMode",
    // Dual Mode 优先：它的证据更具体
    build: (ctx = {}) => combineLabs([createDualMode(), beanFit(null)(ctx)], "bean-fit+dual-mode"),
  },
  {
    id: "bean-fit+neutral+cleanup",
    label: "BeanFit+Neutral+Cleanup",
    build: (ctx = {}) => combineLabs([
      beanFit("bean-fit+neutral", { neutral: {} })(ctx),
      createConservativeCleanup(),
    ], "bean-fit+neutral+cleanup"),
  },
  {
    id: "dual-mode+cleanup",
    label: "DualMode+Cleanup",
    build: () => combineLabs([createDualMode(), createConservativeCleanup()], "dual-mode+cleanup"),
  },
  {
    id: "recommended-hybrid",
    label: "Recommended-Hybrid",
    pending: true,
    reason: "§15 裁定必须建立在 §14 contact sheet 的人工看图之上，未看之前不填。",
    build: () => null,
  },
]);

export const LAB_MATRIX_BY_ID = Object.freeze(
  Object.fromEntries(LAB_MATRIX.map((entry) => [entry.id, entry])),
);

/**
 * 按 id 构造一个 lab 候选 —— §13 Auto Tune 的**声明式接缝**。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────
 * 候选实例里全是函数，**过不了 structuredClone**，所以它不能出现在
 * GenerationRequest 里（`generateV2` 的 `lab` 参数是刻意与 `options` 分开的）。
 * 但 Auto Tune 要在生产里试 Bean Fit，而生产走 Worker —— 于是必须有一个
 * 「纯字符串进、函数出」的解析点：请求里只放 `labCandidate: "bean-fit"`，
 * **函数在管线内部现造**。
 *
 * 这不是「把函数塞进 structuredClone」，恰恰相反：它是让 Worker 路径
 * 既能用到候选、又不破坏契约的唯一做法。`overrides.labCandidate` 是纯数据，
 * `validateGenerationRequest` 对 overrides 只要求「是个对象」。
 *
 * ── 三条纪律 ──────────────────────────────────────────────────────────
 *  ① **`pending` 的条目一律拒绝**（`recommended-hybrid` 还没裁定）。
 *  ② **未知 id 返回 null，不抛。** 抛的话「请求里带了个拼错的候选名」
 *     会变成一次生成失败；返回 null 则退化成生产行为，且
 *     `diagnostics.lab.id` 为 null，报告里一眼能看出候选没挂上。
 *  ③ **REJECT 的算法不许从这里拿到。** 白名单在
 *     `services/auto-tune-profiles.mjs` 的 `AUTO_TUNE_LAB_CANDIDATES`，
 *     由测试断言它不含任何 REJECT 条目；这里只是执行者。
 */
export function resolveLabCandidate(id, ctx = {}) {
  if (typeof id !== "string" || !id) return null;
  const entry = LAB_MATRIX_BY_ID[id];
  if (!entry || entry.pending) return null;
  if (typeof entry.build !== "function") return null;
  try {
    return entry.build(ctx) || null;
  } catch {
    return null;
  }
}
