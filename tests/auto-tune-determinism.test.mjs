/**
 * Stage B4 §13.7 —— 确定性契约（§7-C）。
 *
 * §7-C 把「确定性」列为硬约束之一。它和别的约束有一个关键区别：
 *
 *   **运行时不做重复生成。** 那会让每个候选的成本翻倍（4 个候选 → 8 次生成），
 *   而 §27 的预览预算是硬要求。所以生产里 C 条是 `unverified`，
 *   而**取证责任落在测试与评测工具上** —— 就是本文件。
 *
 * 这件事的意义不只是「省一次重跑」。§5 允许「预览尺寸 == 目标尺寸时
 * 复用预览网格作为最终结果」，这个复用的**唯一合法性来源**就是确定性。
 * 确定性一旦破了，复用会静默产出错误结果：用户看到的是「有时对有时不对」。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_DEFAULTS,
  checkHardConstraints,
  createAutoTuner,
  nullMaskHash,
  paletteFingerprint,
  sourceFingerprint,
} from "../services/auto-tune.mjs";
import { MODE_PROFILES, GENERATION_MODES } from "../services/mode-profile.mjs";
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { resolveCandidates } from "../services/auto-tune-profiles.mjs";
import {
  gridHash, makeCtx, makeEntry, makeRealRunCandidate, syntheticSource, tinyPalette,
} from "./auto-tune-fixtures.mjs";

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

/* =========================================================
 * 引擎层：同输入同输出
 * ======================================================= */

test("§7-C 同一个模式跑两次 → 逐位相同的网格", () => {
  const source = syntheticSource(48, 48, "gradient");
  for (const mode of GENERATION_MODES) {
    const run = () => runGenerationPipeline({
      image: source, mode, size: SIZE, palette: PALETTE, maxColors: 0, overrides: {},
    });
    const a = run();
    const b = run();
    assert.equal(gridHash(a.grid), gridHash(b.grid),
      `${mode} 两次生成的网格不同 —— 确定性破了，§5 的预览复用就不合法了`);
  }
});

test("§7-C 同一套候选跑两次 → 逐位相同的网格（覆盖候选增量，不只是模式默认）", () => {
  const source = syntheticSource(48, 48, "gradient");
  for (const mode of ["auto", "portrait", "illustration"]) {
    for (const candidate of resolveCandidates(mode)) {
      const run = () => runGenerationPipeline({
        image: source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0,
        overrides: { ...MODE_PROFILES[mode], ...candidate.overrides },
      });
      assert.equal(gridHash(run().grid), gridHash(run().grid),
        `${candidate.id} 两次生成不同 —— 候选增量引入了不确定性`);
    }
  }
});

test("§7-C 换一次实例也一致：确定性不是「同一个对象被缓存了」造成的假象", () => {
  const source = syntheticSource(48, 48, "gradient");
  const first = runGenerationPipeline({
    image: source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, overrides: {},
  });
  // 用一份**新的**源图副本（逐字节相同、对象不同），排除「输入对象被就地改写」。
  const clone = { width: source.width, height: source.height, data: new Uint8ClampedArray(source.data) };
  const second = runGenerationPipeline({
    image: clone, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, overrides: {},
  });
  assert.equal(gridHash(first.grid), gridHash(second.grid), "换一份内容相同的源图就变了");
});

test("§7-C 跑完之后源图没有被就地改写（否则第二次的结果取决于第一次跑没跑过）", () => {
  const source = syntheticSource(48, 48, "gradient");
  const before = new Uint8ClampedArray(source.data);
  runGenerationPipeline({ image: source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, overrides: {} });
  assert.deepEqual(Array.from(source.data), Array.from(before),
    "引擎就地改了源图 —— 生产里同一张图要连跑 3–4 个候选，第二次会拿到被污染的数据");
});

/* =========================================================
 * 调优器层：两次完整的调优给出同一个结论
 * ======================================================= */

test("§7-C 两次独立的完整调优 → 同一套 Profile、逐位相同的网格", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuneOnce = async () => {
    // 每次都新建调优器 + 不传 cache —— 排除缓存造成的假一致。
    const tuner = createAutoTuner({
      runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
      analyze: () => ({ routing: { mode: "auto" } }),
      limits: { productionOnly: false },
    });
    return tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 });
  };
  const a = await tuneOnce();
  const b = await tuneOnce();
  assert.equal(a.selectedProfileId, b.selectedProfileId, "两次调优选了不同的 Profile");
  assert.equal(a.decision, b.decision, "两次调优给出了不同的理由");
  assert.equal(gridHash(a.grid), gridHash(b.grid), "两次调优的最终网格不同");
  assert.deepEqual(
    a.candidates.map((c) => [c.profileId, c.accepted, c.rejectReason]),
    b.candidates.map((c) => [c.profileId, c.accepted, c.rejectReason]),
    "两次调优的候选淘汰结论不同",
  );
});

test("§7-C 预览复用只在尺寸相等时发生，且复用与重跑给出同一个网格", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const finalSizes = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { finalSizes.push({ phase: req.phase, w: req.size.width }); return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: true },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.equal(report.reusedPreview, true, "预览尺寸等于目标尺寸时没有复用 —— 白跑一次");
  assert.equal(finalSizes.filter((x) => x.phase === "final").length, 0, "复用之后又跑了一次正式生成");

  // 复用的合法性：单独重跑一次赢家，网格必须逐位相同。
  const winner = resolveCandidates("auto").find((c) => c.id === report.selectedProfileId);
  const rerun = runGenerationPipeline({
    image: source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0,
    overrides: { ...winner.overrides },
  });
  assert.equal(gridHash(rerun.grid), gridHash(report.grid),
    "复用的预览网格与重跑结果不同 —— §5 的复用不成立");
});

test("§7-C 预览尺寸不等于目标尺寸时**必须**重跑一次正式生成", async () => {
  const source = syntheticSource(128, 128, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const calls = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { calls.push({ phase: req.phase, w: req.size.width }); return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: true },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: { width: 240, height: 240 }, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.equal(report.reusedPreview, false);
  const finals = calls.filter((x) => x.phase === "final");
  assert.equal(finals.length, 1, `正式生成跑了 ${finals.length} 次`);
  assert.equal(finals[0].w, 240, "正式生成没有用目标尺寸");
});

/* =========================================================
 * 指纹与掩码的纯度
 * ======================================================= */

test("§7-C nullMaskHash 是纯函数：同输入同输出、不同掩码不同指纹", () => {
  const grid = (nulls) => [[{ code: "A" }, nulls.includes(0) ? null : { code: "B" }],
    [nulls.includes(2) ? null : { code: "C" }, { code: "D" }]];
  assert.equal(nullMaskHash(grid([0])), nullMaskHash(grid([0])));
  assert.notEqual(nullMaskHash(grid([0])), nullMaskHash(grid([2])),
    "空豆数量相同、位置不同却给出同一指纹 —— 「位置错」就查不出来了");
  assert.equal(nullMaskHash([]), nullMaskHash([]));
});

test("§7-C 源图指纹与调色板指纹都是纯函数", () => {
  const a = syntheticSource(32, 32, "gradient");
  const b = syntheticSource(32, 32, "gradient");   // 逐字节相同的新对象
  assert.equal(sourceFingerprint(a), sourceFingerprint(b), "内容相同的源图指纹不同");
  assert.equal(paletteFingerprint(PALETTE), paletteFingerprint([...PALETTE]));
  assert.equal(paletteFingerprint(null), paletteFingerprint([]));
});

/* =========================================================
 * C 条在运行时是 unverified，不是假装 PASS
 * ======================================================= */

test("§7-C 运行时未取证 → 通过（不假装 PASS，也不误判为失败）", () => {
  const standard = makeEntry("s", { usedColors: 1, nullCells: 0 });
  const entry = makeEntry("x", { usedColors: 1, nullCells: 0 });
  const ctx = makeCtx({ standard, determinismVerified: null });
  const result = checkHardConstraints(entry, ctx);
  assert.equal(result.ok, true);
  assert.equal(result.violations.length, 0);
  assert.equal(ctx.determinismVerified, null, "默认值被改成了 true —— 那是假装取证过了");
});

test("§7-C 生产报告不声称「确定性已验证」（不把 unverified 说成 PASS）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuner = createAutoTuner({
    runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: true },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  assert.ok(!("determinismVerified" in report),
    "报告里出现了 determinismVerified —— 运行时不取证，这个字段不该存在");
  assert.equal(tuner.limits.determinismVerified ?? null, null);
  assert.equal(AUTO_TUNE_DEFAULTS.determinismVerified, undefined);
});
