/**
 * Stage B4 §13.7 —— Bean Fit 策略契约（§4 / §9 / §13 / §0）。
 *
 * Bean Fit 是 §12 唯一活下来的候选算法，也是 §13 里唯一一个
 * 「跑得通、但要不要上生产还没定」的东西。所以这个文件守三件事：
 *
 *   ① **模式闸门**：pixel / logo 直接 OFF，anime 不放（§4 / §9）。
 *   ② **生产闸门**：`PRODUCTION_LAB_CANDIDATES` 是空集时，
 *      生产路径上一个 lab 候选都不许跑（§13 说「继续测」，没说「已上线」）。
 *   ③ **可达性**：`labCandidate` 只能以**纯字符串**穿过 Worker 契约，
 *      函数必须在管线内部现造。这条如果破了，Worker 路径会 DataCloneError。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_ELIGIBILITY,
  AUTO_TUNE_LAB_CANDIDATES,
  AUTO_TUNE_PROFILE_BY_ID,
  PRODUCTION_LAB_CANDIDATES,
  resolveCandidateRequest,
  resolveCandidates,
} from "../services/auto-tune-profiles.mjs";
import { createAutoTuner, isAutoTuneEnabledFor } from "../services/auto-tune.mjs";
import { resolveLabCandidate } from "../smart-preprocessing/lab/index.mjs";
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { gridHash, makeRealRunCandidate, syntheticSource, tinyPalette } from "./auto-tune-fixtures.mjs";

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

const beanFitIds = (mode) => (AUTO_TUNE_ELIGIBILITY[mode] || [])
  .filter((id) => AUTO_TUNE_PROFILE_BY_ID[id].labCandidate === "bean-fit");

/* =========================================================
 * ① 模式闸门
 * ======================================================= */

test("§9/§13 pixel 与 logo 的 Bean Fit 直接 OFF（§12 已确认）", () => {
  assert.deepEqual(beanFitIds("pixel"), [], "pixel 上出现了 Bean Fit —— 逐块保留就是零失真，加它只会引入失真");
  assert.deepEqual(beanFitIds("logo"), [], "logo 上出现了 Bean Fit —— logo 的失败形态是「颜色多出来」");
  assert.deepEqual([...AUTO_TUNE_ELIGIBILITY.pixel], ["pixel-standard"]);
  assert.deepEqual([...AUTO_TUNE_ELIGIBILITY.logo], ["logo-standard"]);
});

test("§4 anime 不放 Bean Fit（§12 没有数据支持它在这一档可用）", () => {
  assert.deepEqual(beanFitIds("anime"), []);
  assert.ok(AUTO_TUNE_ELIGIBILITY.anime.length >= 2, "anime 至少要有一个非 standard 候选，否则 Auto Tune 在它上面无事可做");
});

test("§13 继续测的三个模式（人像 / 写实 / 插画）都保留 Bean Fit 候选", () => {
  for (const mode of ["portrait", "photo", "illustration"]) {
    assert.ok(beanFitIds(mode).length >= 1,
      `${mode} 没有 Bean Fit 候选 —— §13 明确要求继续测这三个模式`);
  }
});

test("§13 智能模式的候选集合里带 Bean Fit（路由到人像/插画时才有机会用上）", () => {
  const ids = AUTO_TUNE_ELIGIBILITY.auto;
  assert.ok(ids.some((id) => AUTO_TUNE_PROFILE_BY_ID[id].labCandidate === "bean-fit"),
    "智能模式的候选里没有 Bean Fit —— 那 §13 要测的东西在生产路径上不可达");
  assert.equal(ids[0], "smart-standard");
});

/* =========================================================
 * ② 生产闸门
 * ======================================================= */

test("§13 生产白名单为空时，生产候选集里一个 lab 候选都没有", () => {
  assert.deepEqual([...PRODUCTION_LAB_CANDIDATES], []);
  for (const mode of Object.keys(AUTO_TUNE_ELIGIBILITY)) {
    for (const c of resolveCandidates(mode, { production: true })) {
      assert.equal(c.labCandidate, null,
        `${mode} 的生产档里出现了 lab 候选 ${c.id} —— 生产白名单还是空集`);
    }
  }
});

test("§13 生产闸门不误伤 pixel / logo：它们本来就只有一个候选，过滤后仍然是 1 个", () => {
  for (const mode of ["pixel", "logo"]) {
    const all = resolveCandidates(mode);
    const prod = resolveCandidates(mode, { production: true });
    assert.equal(all.length, 1);
    assert.equal(prod.length, 1, `${mode} 的生产档被过滤空了 —— 那就没有 standard 可以回落`);
    assert.equal(prod[0].id, all[0].id);
  }
});

test("§13 生产档至少保留 standard，且 standard 一定是第一个", () => {
  for (const mode of Object.keys(AUTO_TUNE_ELIGIBILITY)) {
    const prod = resolveCandidates(mode, { production: true });
    assert.ok(prod.length >= 1, `${mode} 的生产档是空的`);
    assert.equal(prod[0].id, AUTO_TUNE_ELIGIBILITY[mode][0]);
  }
});

test("§13 生产闸门真的作用到调优器上：productionOnly 时跑不到 lab 候选", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { seen.push(req.labCandidate ?? null); return real(req); },
    analyze: () => ({ routing: { mode: "illustration" } }),   // 插画有 bean-fit 候选
    limits: { productionOnly: true },
  });
  await tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 });
  assert.ok(seen.length >= 1, "一个候选都没跑，用例前提不成立");
  assert.ok(seen.every((x) => x === null),
    `productionOnly 时仍然跑了 lab 候选：${JSON.stringify(seen)}`);
});

test("§13 放开生产闸门后 bean-fit 真的会被跑到（证明闸门不是「永远空转」）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { seen.push(req.labCandidate ?? null); return real(req); },
    analyze: () => ({ routing: { mode: "illustration" } }),
    limits: { productionOnly: false },
  });
  await tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 });
  assert.ok(seen.includes("bean-fit"),
    `非生产档也没跑到 bean-fit：${JSON.stringify(seen)} —— 说明候选表或解析层断了`);
});

/* =========================================================
 * ③ 可达性：字符串进、函数出
 * ======================================================= */

test("§13 lab 候选只能以纯字符串穿过请求契约", () => {
  for (const mode of Object.keys(AUTO_TUNE_ELIGIBILITY)) {
    for (const c of resolveCandidates(mode)) {
      const req = resolveCandidateRequest(c);
      assert.ok(req.labCandidate === null || typeof req.labCandidate === "string",
        `${req.profileId} 的 labCandidate 不是字符串`);
      // 整份请求必须能过 structuredClone —— 这是 Worker 契约的硬要求。
      assert.doesNotThrow(() => structuredClone(req), `${req.profileId} 的请求过不了 structuredClone`);
    }
  }
});

test("§13 resolveLabCandidate：已知 id 出实例，未知/拼错/pending 出 null 且不抛", () => {
  const bean = resolveLabCandidate("bean-fit", { mode: "illustration" });
  assert.ok(bean, "bean-fit 解析不出来 —— §13 的声明式接缝断了");
  assert.equal(typeof bean.matchCell, "function");

  for (const bad of ["bean-fit-typo", "不存在", "", null, undefined, 42, {}]) {
    assert.equal(resolveLabCandidate(bad, { mode: "illustration" }), null,
      `${String(bad)} 被解析成了实例 —— 一个拼错的候选名会变成一次生成失败`);
  }
  // §11 里 `pending` 的条目（还没裁定）一律拒绝。
  assert.equal(resolveLabCandidate("recommended-hybrid", { mode: "illustration" }), null,
    "pending 的条目被放行了 —— 那等于把一个没裁定的算法接进生产");
});

test("§13 「plain」与「拼错」必须产出逐位相同的结果（拼错等于没挂候选）", () => {
  const source = syntheticSource(48, 48, "gradient");
  const run = (labCandidate) => runGenerationPipeline({
    image: source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0,
    overrides: labCandidate ? { labCandidate } : {},
  });
  const plain = run(null);
  const typo = run("bean-fit-typo");
  assert.equal(gridHash(plain.grid), gridHash(typo.grid),
    "拼错的候选名改变了输出 —— 它应该退化成生产行为");
  assert.equal(typo.pipeline.requestedLabCandidate, "bean-fit-typo",
    "报告里没有留下「用户请求过这个候选」的痕迹 —— 排障时查不出来");
});

test("§13 闸门对 pixel / logo 生效：即使显式请求 bean-fit，也不改变输出", () => {
  // §12.4 的结论必须在**新的声明式接缝**上继续成立。
  const source = syntheticSource(48, 48, "checker");
  const size = { width: 16, height: 16 };   // 小方块 → 路由到 pixel
  const plain = runGenerationPipeline({
    image: source, mode: "pixel", size, palette: PALETTE, maxColors: 0, overrides: {},
  });
  const withBean = runGenerationPipeline({
    image: source, mode: "pixel", size, palette: PALETTE, maxColors: 0,
    overrides: { labCandidate: "bean-fit" },
  });
  assert.equal(gridHash(plain.grid), gridHash(withBean.grid),
    "pixel 模式下 Bean Fit 改变了输出 —— 模式闸门失效了");
});

test("§0 白名单只有一个条目，且不是任何 REJECT 算法", () => {
  assert.deepEqual([...AUTO_TUNE_LAB_CANDIDATES], ["bean-fit"]);
  for (const banned of ["spatial", "cleanup", "neutral", "dual-mode"]) {
    assert.ok(!AUTO_TUNE_LAB_CANDIDATES.includes(banned), `${banned} 被放回了搜索空间`);
  }
});

test("§26 Bean Fit 候选存在，但第一阶段它进不了生产（两道闸门各管一段）", () => {
  // 这两件事要一起看，否则容易得出错的结论：
  //   · 候选表里有 bean-fit（§13 要测它）
  //   · 生产白名单是空的（§13 还没裁定它能上）
  //   · 而且 Auto Tune 本身只在 auto 模式跑（§26）
  assert.ok(AUTO_TUNE_ELIGIBILITY.auto.includes("smart-bean-fit"));
  assert.deepEqual([...PRODUCTION_LAB_CANDIDATES], []);
  assert.equal(isAutoTuneEnabledFor("auto"), true);
  assert.equal(isAutoTuneEnabledFor("portrait"), false);
});
