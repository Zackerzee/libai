/**
 * Stage B4 §13.7 —— Worker 路径与生产接入契约（§5 / §6 / §15 / §16 / §26 / §27）。
 *
 * 这个文件守的是**边界**：Auto Tune 不许把已有的契约撑破。
 *
 *   · §5  候选只在**小尺寸**上跑，赢家才在目标尺寸上跑一次。
 *        「把候选全部在 500 档跑一遍」是最容易犯、也最贵的错。
 *   · §15 报告契约：`{routedMode, selectedProfile, candidates[{profileId,
 *        accepted, rejectReason, metrics, runtimeMs}], reason}`。
 *   · §16 UI 只显示「正在分析图片…」这类人话，不许出现算法术语。
 *   · §26 第一阶段只有智能模式启用；Worker 契约本身一个字都不改。
 *   · §27 预览预算到了就早停，剩下的候选记 `runtime-budget`。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AUTO_TUNE_DEFAULTS,
  AUTO_TUNE_PRODUCTION_MODES,
  createAutoTuner,
  previewMaxColors,
  previewSizeFor,
} from "../services/auto-tune.mjs";
import { FRAMING_INVARIANT_FIELDS, resolveCandidates } from "../services/auto-tune-profiles.mjs";
import { GENERATION_MODES, MODE_PROFILES } from "../services/mode-profile.mjs";
import { makeRealRunCandidate, syntheticSource, tinyPalette } from "./auto-tune-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/** 只保留代码行 —— 按行首前缀过滤，不要正则剥注释。 */
const codeOnly = (text) => text
  .split("\n")
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n");

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

/* =========================================================
 * §5 预览尺寸
 * ======================================================= */

test("§5 预览长边被钳到上限，且**从不放大**", () => {
  const big = previewSizeFor({ width: 2000, height: 1000 }, 104);
  assert.equal(big.width, 104);
  assert.equal(big.height, 52);
  assert.equal(big.scaled, true);

  const small = previewSizeFor({ width: 48, height: 48 }, 104);
  assert.deepEqual({ w: small.width, h: small.height }, { w: 48, h: 48 });
  assert.equal(small.scaled, false, "小图被放大了 —— 那是在预览上造假细节");
});

test("§5 预览尺寸有下限，不会退化成 1px", () => {
  const tiny = previewSizeFor({ width: 4000, height: 100 }, 104, 10);
  assert.ok(tiny.width >= 10 && tiny.height >= 10, `退化成了 ${tiny.width}×${tiny.height}`);
});

test("§5/§6 预览的 maxColors 按长边**比例**缩放，且有下限 2", () => {
  const preview = { width: 104, height: 104 };
  const target = { width: 520, height: 520 };
  assert.equal(previewMaxColors(0, preview, target), 0, "0 = 不限额，不该被缩放");
  assert.equal(previewMaxColors(100, preview, target), 20);
  assert.equal(previewMaxColors(100, target, target), 100, "预览与目标同尺寸时不该缩");
  // 极端比例：24 色在 104 档会缩到 4.8 → 4，但下限保证不会掉到 1
  assert.ok(previewMaxColors(5, preview, { width: 2000, height: 2000 }) >= 2);
});

test("§5 候选**只在预览尺寸**上跑，赢家才在目标尺寸上跑一次", async () => {
  const source = syntheticSource(128, 128, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const calls = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => {
      calls.push({ phase: req.phase, long: Math.max(req.size.width, req.size.height) });
      return real(req);
    },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false, previewLongEdge: 104 },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: { width: 500, height: 500 }, palette: PALETTE, maxColors: 0, requestId: 1,
  });

  const previews = calls.filter((c) => c.phase === "preview");
  const finals = calls.filter((c) => c.phase === "final");
  assert.ok(previews.length >= 2, `预览只跑了 ${previews.length} 个候选`);
  assert.ok(previews.every((c) => c.long === 104),
    `有候选在非预览尺寸上跑了：${JSON.stringify(previews)} —— §5 禁止候选全部在 500 档跑一遍`);
  assert.equal(finals.length, 1, `正式生成跑了 ${finals.length} 次 —— 只允许赢家跑一次`);
  assert.equal(finals[0].long, 500, "正式生成没有用目标尺寸");
  assert.equal(calls.length, previews.length + finals.length, "出现了第三种阶段");
  assert.equal(report.previewSize.width, 104);
});

test("§6 调优不得改变取景决策：取景不变量的值必须与调用方一致", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { seen.push(req.overrides); return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  // 调用方自己声明了一套取景决策；调优必须原样透传，不许被候选增量改掉。
  const caller = { subjectCrop: true, autoBackground: true, strokeProtection: false, accentProtection: true };
  await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1, overrides: caller,
  });
  assert.ok(seen.length >= 2, "候选没跑起来，用例前提不成立");
  for (const overrides of seen) {
    for (const field of FRAMING_INVARIANT_FIELDS) {
      assert.equal(overrides[field], caller[field],
        `候选把取景不变量 ${field} 改成了 ${overrides[field]} —— §6 明确禁止`);
    }
  }
});

test("§6 候选增量**覆盖**调用方档案（顺序反了会得到「所有候选逐位相同」的假结论）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => { seen.push(req.overrides); return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  // 调用方把 detailProtection 设成 20；候选 `smart-detail-safe` 的增量是 85。
  // 合并顺序必须是 `{...调用方, ...候选增量}` —— 反了的话 85 会被 20 盖掉，
  // 表现是「所有候选输出逐位相同」，一个看起来像「算法没效果」的假结论。
  await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
    overrides: { detailProtection: 20 },
  });
  assert.ok(seen.length >= 2, "候选没跑起来，用例前提不成立");
  // standard 无增量 → 原样透传调用方的 20。
  assert.equal(seen[0].detailProtection, 20, "standard 没有透传调用方档案");
  // 带增量的候选 → 增量必须赢。
  const withDelta = seen.filter((o) => o.detailProtection === 85);
  assert.ok(withDelta.length >= 1,
    `候选增量被调用方档案盖掉了（拿到的都是 ${JSON.stringify(seen.map((o) => o.detailProtection))}）`);
});

/* =========================================================
 * §15 报告契约
 * ======================================================= */

test("§15 报告契约：字段齐全，且候选条目形状统一", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuner = createAutoTuner({
    runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });

  for (const field of ["routedMode", "selectedProfileId", "selectedProfile", "candidates", "reason", "decision", "standardProfileId"]) {
    assert.ok(field in report, `报告缺字段 ${field}`);
  }
  assert.ok(report.selectedProfile, "selectedProfile 是空的 —— §15 要求带上它");
  assert.equal(report.selectedProfile.profileId, report.selectedProfileId);
  assert.ok(Array.isArray(report.candidates) && report.candidates.length >= 2);

  for (const c of report.candidates) {
    for (const field of ["profileId", "accepted", "rejectReason", "metrics", "runtimeMs"]) {
      assert.ok(field in c, `候选条目缺字段 ${field}`);
    }
    assert.equal(typeof c.profileId, "string");
    assert.equal(typeof c.accepted, "boolean");
    assert.ok(c.rejectReason === null || typeof c.rejectReason === "string");
    assert.ok(c.metrics === null || typeof c.metrics === "object");
  }
  assert.equal(typeof report.reason, "string");
  assert.ok(report.reason.length > 0, "reason 是空的 —— 报告就解释不了「为什么选它」");
});

test("§15 报告里**不**带候选网格（那会让快照变得很重）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuner = createAutoTuner({
    runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  for (const c of report.candidates) {
    assert.ok(!("grid" in c), `${c.profileId} 的候选条目里带着网格 —— 只该带指标`);
  }
  assert.ok(!("diagnostics" in report.candidates[0]), "候选条目里带了 diagnostics，报告会膨胀");
});

test("§15 报告能过 structuredClone（要能落进 state 与事件）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuner = createAutoTuner({
    runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  const { grid, ...rest } = report;
  assert.doesNotThrow(() => structuredClone(rest), "报告过不了 structuredClone —— 事件派发会炸");
  assert.ok(grid, "报告里没有网格，调用方拿不到结果");
});

/* =========================================================
 * §27 预算早停
 * ======================================================= */

test("§27 预览预算耗尽 → 剩余候选记 runtime-budget，不静默跳过", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuner = createAutoTuner({
    runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false, previewBudgetMs: 1 },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  const budgeted = report.candidates.filter((c) => c.rejectReason === "runtime-budget");
  assert.ok(budgeted.length >= 1, "预算耗尽时剩余候选既没跑、也没记账");
  for (const c of budgeted) {
    assert.equal(c.metrics, null);
    assert.match(String(c.note), /预算/);
  }
  // standard 永远要跑 —— 没有基线就没有比较。
  const std = report.candidates.find((c) => c.profileId === report.standardProfileId);
  assert.notEqual(std.rejectReason, "runtime-budget", "standard 被预算裁掉了");
  assert.ok(report.selectedProfileId, "预算裁完之后没有选出候选");
});

test("§27 预算裁掉的候选不会因为「没指标」而被当成打平而胜出", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const tuner = createAutoTuner({
    runCandidate: makeRealRunCandidate({ source, palette: PALETTE }),
    analyze: () => ({ routing: { mode: "auto" } }),
    limits: { productionOnly: false, previewBudgetMs: 1 },
  });
  const report = await tuner.tune({
    source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  const chosen = report.candidates.find((c) => c.profileId === report.selectedProfileId);
  assert.notEqual(chosen.rejectReason, "runtime-budget",
    "选了一个根本没评估过的候选 —— 那是靠「缺指标 = 打平」混进来的");
});

/* =========================================================
 * §16 UI 文案
 * ======================================================= */

test("§16 三个调优阶段都有中文文案，且**不含算法术语**", () => {
  const app = read("app.js");
  for (const phase of ["tune-analyze", "tune-preview", "tune-final"]) {
    assert.ok(app.includes(`"${phase}"`), `缺少阶段文案 ${phase}`);
  }
  // 取出这三条文案，逐条检查用词。
  const labels = [...app.matchAll(/"(tune-(?:analyze|preview|final))":\s*"([^"]+)"/g)]
    .map((m) => ({ phase: m[1], label: m[2] }));
  assert.equal(labels.length, 3, `抓到的调优阶段文案数不对：${JSON.stringify(labels)}`);
  const banned = ["Auto Tune", "Profile", "Bean", "bean", "lab", "候选", "算法", "评分"];
  for (const { phase, label } of labels) {
    for (const word of banned) {
      assert.ok(!label.includes(word),
        `阶段文案「${label}」（${phase}）里出现了内部术语「${word}」—— §16 明确不许`);
    }
    assert.match(label, /^正在/, `阶段文案「${label}」不像进度提示`);
  }
});

test("§16 工作台 UI 不展示调优细节：报告只走 bridge，不进渲染路径", () => {
  const app = read("app.js");
  const code = codeOnly(app);
  // 报告只能通过 getAutoTuneReport 暴露给探针，不能出现在任何 innerHTML / textContent 赋值里。
  const assignments = [...code.matchAll(/(innerHTML|textContent|insertAdjacentHTML)\s*[+]?=\s*[^;]*autoTune/gi)];
  assert.equal(assignments.length, 0,
    `调优报告被渲染进了界面：${JSON.stringify(assignments.map((a) => a[0]))}`);
  assert.ok(code.includes("getAutoTuneReport"),
    "没有给探针留读取入口 —— 真机验收会拿不到证据");
});

/* =========================================================
 * §26 Worker 契约一个字都不改
 * ======================================================= */

test("§26 Worker 契约不被 Auto Tune 污染：worker 里没有 auto-tune 的任何引用", () => {
  const worker = codeOnly(read("services", "generation.worker.mjs"));
  for (const banned of ["auto-tune", "autoTune", "AutoTune", "profile-registry", "selectProfile"]) {
    assert.ok(!worker.includes(banned),
      `generation.worker.mjs 里出现了 ${banned} —— §0 明确不许改 Worker 契约`);
  }
});

test("§26 生成请求契约不认识 autoTune 字段（调优只传一个字符串 labCandidate）", () => {
  const req = codeOnly(read("services", "generation-request.mjs"));
  for (const banned of ["autoTune", "auto-tune", "selectedProfile"]) {
    assert.ok(!req.includes(banned), `generation-request.mjs 里出现了 ${banned}`);
  }
  assert.ok(codeOnly(read("services", "generation-pipeline.mjs")).includes("labCandidate"),
    "管线没有接 labCandidate 这个纯字符串字段");
});

test("§26 带 labCandidate 的请求能原样穿过 structuredClone（Worker 路径的硬要求）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => {
      // 模拟 Worker 边界：请求必须能克隆过去。
      //
      // ⚠️ `labCandidate` 是**独立字段**，不在 `overrides` 里 —— 这正是这道接缝的设计：
      // 函数过不了 structuredClone，所以请求里只放一个纯字符串，
      // 函数由管线内部的 `resolveLabCandidate` 现造。
      // 一开始这里读的是 `overrides.labCandidate`，永远是 null，
      // 断言失败的样子像「接缝断了」，其实是我读错了字段。
      const cloned = structuredClone({
        size: req.size, overrides: req.overrides, labCandidate: req.labCandidate,
        maxColors: req.maxColors, requestId: req.requestId,
      });
      seen.push(cloned.labCandidate ?? null);
      return makeRealRunCandidate({ source, palette: PALETTE })(req);
    },
    analyze: () => ({ routing: { mode: "illustration" } }),
    limits: { productionOnly: false },
  });
  await tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 });
  assert.ok(seen.includes("bean-fit"), `labCandidate 没有以字符串形式过界：${JSON.stringify(seen)}`);
  assert.ok(seen.every((x) => x === null || typeof x === "string"),
    `过界的 labCandidate 不是字符串：${JSON.stringify(seen)}`);
});

test("§26 候选的 `overrides` 里**不许**出现 labCandidate（否则函数会混进 structuredClone）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const seen = [];
  const tuner = createAutoTuner({
    runCandidate: async (req) => {
      seen.push(req.overrides);
      return makeRealRunCandidate({ source, palette: PALETTE })(req);
    },
    analyze: () => ({ routing: { mode: "illustration" } }),
    limits: { productionOnly: false },
  });
  await tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 });
  for (const o of seen) {
    assert.ok(!("labCandidate" in o),
      "labCandidate 混进了 overrides —— 管线会把它当引擎选项透传，接缝就失效了");
  }
});

test("§26 生产闸门只在 auto 上开：AUTO_TUNE_PRODUCTION_MODES 精确等于 ['auto']", () => {
  assert.deepEqual([...AUTO_TUNE_PRODUCTION_MODES], ["auto"]);
  for (const mode of GENERATION_MODES) {
    if (mode === "auto") continue;
    assert.ok(!AUTO_TUNE_PRODUCTION_MODES.includes(mode), `${mode} 也进了生产闸门`);
  }
});

/* =========================================================
 * app.js 接入点
 * ======================================================= */

test("§5/§19 app.js 的候选执行器**不转移** image buffer（转移之后第二个候选会拿到空 buffer）", () => {
  const code = codeOnly(read("app.js"));
  const i = code.indexOf("runAutoTuneV2");
  assert.ok(i > 0, "app.js 里找不到 runAutoTuneV2");
  const body = code.slice(i, i + 4000);
  assert.ok(body.includes("transfer: []"),
    "候选执行器没有显式关掉 Transferable —— 调优要在一张图上连跑 3–4 次，转移是不可逆的");
});

test("§19 app.js 的取消会先通知调优器（否则杀掉 Worker 后循环里的下一个候选会接着跑）", () => {
  const code = codeOnly(read("app.js"));
  const i = code.indexOf("function cancelGeneration");
  assert.ok(i > 0, "找不到 cancelGeneration");
  const body = code.slice(i, i + 900);
  const tuneIdx = body.indexOf("autoTuner?.cancel");
  const workerIdx = body.indexOf("generationWorkerClient?.cancel");
  assert.ok(tuneIdx > 0, "cancelGeneration 没有通知调优器");
  assert.ok(workerIdx > tuneIdx, "顺序反了：先杀 Worker 再通知调优器，中间那一瞬可能又起一个候选");
});

test("§23 app.js 在调优失败时退回单次生成，但**取消/过期要原样上抛**", () => {
  const code = codeOnly(read("app.js"));
  const i = code.indexOf("Auto Tune 失败，退回单次生成");
  assert.ok(i > 0, "找不到退回单次生成的处理");
  const body = code.slice(Math.max(0, i - 900), i + 300);
  assert.match(body, /AbortError/);
  assert.match(body, /StaleGenerationError/);
  assert.ok(/throw error/.test(body), "取消/过期没有原样上抛 —— 会被当成失败而退回重跑");
});
