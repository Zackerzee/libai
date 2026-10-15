/**
 * 阶段 4 隔离实验矩阵。
 *
 * ── 为什么不往 §11 的 `LAB_MATRIX` 里加 ────────────────────────────────
 * `LAB_MATRIX` 是 B4 §11 的**记录**：`candidate-benchmark-contract.test.mjs`
 * 钉死了它的长度（11）与 id 列表。往里面加条目等于改历史记录，
 * 而且会让 B4 的四条候选守卫测试（determinism / maxColors / null-integrity）
 * 悄悄多跑几个未裁定对象。
 *
 * 所以阶段 4 有**自己的矩阵**，共用同一套跑分器、夹具、尺子。
 * 跑分器用 `--matrix stage4` 选它（默认仍是 b4，行为逐位不变）。
 *
 * ── 四条纪律（与 §11 同款）─────────────────────────────────────────────
 *   ① 每个 `build()` 返回**新实例**；
 *   ② 条目 id 与候选自报 id **逐字一致**（跑分器按矩阵 id 建列，
 *      诊断按候选自报 id 归档 —— 漂移了就得人肉映射，映射一错结论就错柱子）；
 *   ③ 未裁定的条目 `pending: true` + `reason`，且 `build()` 返回 `null`
 *      —— 绝不能悄悄退化成一个和基线一样的列；
 *   ④ 组合器硬拒绝无定义的叠加（两个 refine / 两个 cleanup 直接抛）。
 *
 * ── 本矩阵只放**隔离**候选，不放组合 ──────────────────────────────────
 * 阶段 4 的任务书是「四项隔离实验」：每项单独跑、单独判定。
 * 组合留到有 ≥2 个 KEEP 之后再谈（那时才需要回答「叠加有没有增益」）。
 */

import { createAdaptiveV2 } from "./adaptive-v2.mjs";
import { createChromaPrescreen } from "./chroma-prescreen.mjs";
import { createKitLimit } from "./kit-limit.mjs";
import { createConservativeCleanup } from "./conservative-cleanup.mjs";

export { createAdaptiveV2, createChromaPrescreen, createKitLimit };

export const STAGE4_MATRIX = Object.freeze([
  { id: "current", label: "CURRENT（生产基线）", build: () => null },

  /* 实验 1：自适应采样 —— 用色卡结构决定逐格采样出口 */
  { id: "adaptive-v2", label: "AdaptiveV2（色卡感知采样）", build: () => createAdaptiveV2({ id: "adaptive-v2" }) },

  /* 实验 2：色差预筛 —— 单色格走快路径 */
  { id: "chroma-prescreen", label: "ChromaPrescreen（色差预筛）", build: () => createChromaPrescreen({ id: "chroma-prescreen" }) },

  /* 实验 3：真实色板限色 —— 三档套装尺寸，给出「代价 vs 色数」曲线 */
  { id: "kit-limit-24", label: "KitLimit-24（真实套装 24 色）", build: () => createKitLimit({ id: "kit-limit-24", kitSize: 24 }) },
  { id: "kit-limit-48", label: "KitLimit-48（真实套装 48 色）", build: () => createKitLimit({ id: "kit-limit-48", kitSize: 48 }) },
  { id: "kit-limit-96", label: "KitLimit-96（真实套装 96 色）", build: () => createKitLimit({ id: "kit-limit-96", kitSize: 96 }) },

  /* 实验 4：保护性小区域清理 —— 复用 B4 §10 候选，在本轮管线上重裁 */
  { id: "cleanup", label: "ConservativeCleanup（保护性小区域清理）", build: () => createConservativeCleanup({ id: "cleanup" }) },
]);

export const STAGE4_MATRIX_BY_ID = Object.freeze(
  Object.fromEntries(STAGE4_MATRIX.map((entry) => [entry.id, entry])),
);
