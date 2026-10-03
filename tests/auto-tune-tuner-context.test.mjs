/**
 * Stage B4 §13.7 —— 单例调优器的**请求上下文**契约。
 *
 * ── 这个文件为什么存在 ────────────────────────────────────────────────
 * `app.js` 里 `autoTuner` 是模块级单例（`if (!autoTuner)` 只建一次），
 * 但它的 `runCandidate` 需要读**这一次**调优的图 / 色板 / 模式 / maxColors。
 * 最早那版把这四项直接闭包进 `runCandidate`，于是它们被**第一次调用**
 * 的值冻住了。真机探针抓到的症状：
 *
 *   界面把「颜色数量」设成 12 → 报告里 `maxColors: 12`
 *   → 但每个候选和最终出图都跑在 `maxColors: 0` 上 → **出图 18 色**
 *
 * 也就是 §7-A 那条硬约束在**生产里从未真正生效**，而报告看起来完全正常。
 * 第二重后果更重：同一页面里换一张图，候选和最终出图还是**上一张图**。
 *
 * 以前所有探针都没抓到，是因为它们每张夹具都整页重载 —— 单例每次都是新建的。
 * 「一个页面只跑一次调优」的场景下，这个形状根本不显形。
 *
 * 所以本文件两侧都钉：
 *   · 源码形状：`runCandidate` 只能从 `autoTuneContexts` 取输入
 *   · 行为形状：用真实调优器把「旧形状错在哪 / 新形状对在哪」跑出来
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { AUTO_TUNE_DEFAULTS, createAutoTuner, createTuneCache } from "../services/auto-tune.mjs";
import { makeRealRunCandidate, syntheticSource, tinyPalette } from "./auto-tune-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = fs.readFileSync(path.join(ROOT, "app.js"), "utf8");

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

/** 去掉注释，避免「注释里提到某个名字」被当成代码里的引用。 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1 ");
}

/* =========================================================
 * 一、源码形状
 * ======================================================= */

/** `createAutoTuner({...})` 到 `const tuneRequestId` 之间的那段（含 runCandidate 体）。 */
function tunerFactoryRegion() {
  const start = APP.indexOf("autoTuner = mod.createAutoTuner({");
  assert.ok(start > 0, "app.js 里找不到 createAutoTuner 的建立点 —— 结构变了，本守卫要跟着改");
  const end = APP.indexOf("const tuneRequestId", start);
  assert.ok(end > start, "找不到 tuneRequestId 归一化点");
  return stripComments(APP.slice(start, end));
}

test("§13 单例调优器的 runCandidate 不得闭包 runAutoTuneV2 的形参", () => {
  const region = tunerFactoryRegion();
  // 「闭包了形参」= 这个标识符被当作**值**读出来。
  // 两种不算：
  //   · 前面是 `.`  → `ctx.maxColors`，属性读取，没问题
  //   · 后面是 `:`  → `maxColors: ctx.maxColors`，那是对象**键名**，不是变量引用
  //     （漏掉这条会得到一个假失败：正确写法里的键名会被判成违规）
  const bare = /(?<![.\w$])(sourceImageData|maxColors|palette|resolved)\b(?!\s*:)/;
  const hit = region.match(bare);
  assert.equal(hit, null,
    `runCandidate 里把 \`${hit?.[1]}\` 当值读了。`
    + "autoTuner 是单例，闭包形参会被**第一次调用**的值冻住："
    + "改颜色数量不生效、换图还是上一张。必须走 autoTuneContexts。");
});

test("§13 单例调优器的 runCandidate 确实从 autoTuneContexts 取本次输入", () => {
  const region = tunerFactoryRegion();
  assert.match(region, /autoTuneContexts\.get\(/,
    "runCandidate 没有从 autoTuneContexts 取上下文");
  for (const field of ["sourceImageData", "mode", "palette", "maxColors"]) {
    assert.match(region, new RegExp(`ctx\\.${field}\\b`),
      `runCandidate 没有用 ctx.${field}`);
  }
});

test("§13 上下文是模块级 Map，且按 requestId 存", () => {
  assert.match(APP, /const autoTuneContexts = new Map\(\)/,
    "autoTuneContexts 不是模块级 Map");
  const region = APP.slice(APP.indexOf("const tuneRequestId"), APP.indexOf("const tuneRequestId") + 1200);
  assert.match(region, /autoTuneContexts\.set\(tuneRequestId/,
    "上下文没有按 tuneRequestId 存 —— 两个调优短暂并存时会互相读错图");
  assert.match(region, /finally\s*\{[\s\S]*?autoTuneContexts\.delete\(tuneRequestId\)/,
    "上下文没有在 finally 里清理 —— 异常路径会留下一个永不释放的条目");
});

test("§13 缓存键用的 requestId 与 tune() 收到的是同一个数", () => {
  const region = APP.slice(APP.indexOf("const tuneRequestId"));
  // 归一化：requestId 可能是 undefined / 0，而 tune() 的默认值是 1。
  // 两边不一致的话 `autoTuneContexts.get(rid)` 查不到 → 每个候选都「已过期」。
  assert.match(region, /const tuneRequestId = Number\(requestId\) > 0 \? Number\(requestId\) : 1;/);
  const tuneCall = region.slice(region.indexOf("autoTuner.tune("), region.indexOf("onPhase: reportTunePhase"));
  assert.match(tuneCall, /requestId: tuneRequestId,/,
    "传给 tune() 的不是归一化后的 tuneRequestId —— 会和上下文键错开");
});

test("§13 上下文查不到时抛的是 AbortError（预期结局），不是普通错误", () => {
  const region = tunerFactoryRegion();
  assert.match(region, /if \(!ctx\)/);
  assert.match(region, /error\.name = "AbortError"/,
    "缺上下文时抛普通错误会被调优器记成 candidate-error（每个候选一条告警），"
    + "而它其实是「这次请求已被顶掉」这个预期结局");
});

test("§6 预览上限必须从入参取，不能从 ctx 取（否则预览缩放从未生效）", () => {
  const region = tunerFactoryRegion();
  // 调优器每次调用传的 maxColors 不一样：
  //   预览候选 → previewMaxColors（比例缩放后的）
  //   正式赢家 → 界面原始值
  // 从 ctx 取 = 两者跑在同一个上限上 = §6 的预览缩放形同不存在，
  // 而且预览会突破它自己声明的 previewMaxColors。
  assert.match(region, /maxColors: candidateCap|maxColors: [A-Za-z_$][\w$]*\b/,
    "runCandidate 的入参里没有解构 maxColors");
  assert.match(region, /maxColors: callMaxColors/,
    "传给 runGenerationJob 的 maxColors 不是从入参派生的");
});

test("§19 调优跑完发现已被取代时，不得把报告留下来", () => {
  const start = APP.indexOf("autoTuneContexts.delete(tuneRequestId)");
  assert.ok(start > 0, "找不到 finally 里的上下文清理");
  const after = APP.slice(start, start + 1400);
  const staleAt = after.indexOf("isStaleGenerationRequest(requestId)");
  const publishAt = after.indexOf("autoTuneReport = rest;");
  assert.ok(staleAt > 0, "调优返回后没有再判一次过期 —— 过期报告会被 getAutoTuneReport() 读走");
  assert.ok(publishAt > 0, "找不到发布报告的那一行");
  assert.ok(staleAt < publishAt,
    "过期判定必须在发布报告**之前**，否则报告已经写进去了");
  assert.match(after.slice(staleAt, publishAt), /error\.name = "StaleGenerationError"/,
    "过期时要抛 StaleGenerationError（预期结局），不是普通错误");
});

/* =========================================================
 * 二、行为形状 —— 用真实调优器把两种写法都跑出来
 * ======================================================= */

/**
 * 造一个「只建一次」的单例，形状与 app.js 一一对应。
 * `shape` 决定 runCandidate 从哪儿取值。
 */
function makeSingleton(shape, seen) {
  let tuner = null;
  const contexts = new Map();
  const real = makeRealRunCandidate({ source: syntheticSource(48, 48, "gradient"), palette: PALETTE });
  const source = syntheticSource(48, 48, "gradient");

  const call = async ({ maxColors, requestId }) => {
    if (!tuner) {
      tuner = createAutoTuner({
        cache: createTuneCache({ max: 4 }),
        limits: { productionOnly: true, ...AUTO_TUNE_DEFAULTS },
        runCandidate: async (req) => {
          if (shape === "closure") {
            // 旧形状：直接读形参（第一次调用的值）
            seen.push({ maxColors, requestId: req.requestId });
          } else {
            // 新形状：按 req.requestId 查上下文
            const ctx = contexts.get(Number(req.requestId));
            if (!ctx) {
              const error = new Error("Auto Tune 请求已过期");
              error.name = "AbortError";
              throw error;
            }
            seen.push({ maxColors: ctx.maxColors, requestId: req.requestId });
          }
          return real(req);
        },
      });
    }
    if (shape === "context") {
      const id = Number(requestId) > 0 ? Number(requestId) : 1;
      contexts.set(id, { maxColors });
      try {
        return await tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors, requestId: id });
      } finally {
        contexts.delete(id);
      }
    }
    return tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors, requestId });
  };
  return call;
}

test("§7-A 反向验证：闭包形参的旧形状**确实**会把 maxColors 冻在第一次的值", async () => {
  const seen = [];
  const call = makeSingleton("closure", seen);
  // 第一次调优：maxColors 0（上传后的自动生成）
  await call({ maxColors: 0, requestId: 1 });
  const firstRound = seen.length;
  assert.ok(firstRound > 0, "第一轮一个候选都没跑，测不到东西");
  // 第二次调优：用户把颜色数量改成 12
  await call({ maxColors: 12, requestId: 2 });
  const secondRound = seen.slice(firstRound);
  assert.ok(secondRound.length > 0, "第二轮一个候选都没跑（大概命中缓存了）");
  assert.ok(secondRound.every((s) => s.maxColors === 0),
    "旧形状居然拿到了新 maxColors —— 那本缺陷的成因不是这个，得重新查");
});

test("§7-A 新形状：第二轮候选拿到的是第二轮的 maxColors，且 requestId 对得上", async () => {
  const seen = [];
  const call = makeSingleton("context", seen);
  await call({ maxColors: 0, requestId: 1 });
  const firstRound = seen.length;
  assert.ok(firstRound > 0, "第一轮一个候选都没跑");
  assert.ok(seen.slice(0, firstRound).every((s) => s.requestId === 1),
    "runCandidate 拿到的 requestId 不是本轮 tune() 的 requestId —— 上下文会查不到");
  await call({ maxColors: 12, requestId: 2 });
  const secondRound = seen.slice(firstRound);
  assert.ok(secondRound.length > 0, "第二轮一个候选都没跑（大概命中缓存了）");
  assert.ok(secondRound.every((s) => s.maxColors === 12),
    `第二轮候选拿到的是 ${JSON.stringify([...new Set(secondRound.map((s) => s.maxColors))])}，不是 12`);
  assert.ok(secondRound.every((s) => s.requestId === 2));
});

test("§19 上下文已清理时，候选抛 AbortError 而不是拿错图去算", async () => {
  const seen = [];
  const real = makeRealRunCandidate({ source: syntheticSource(48, 48, "gradient"), palette: PALETTE });
  const source = syntheticSource(48, 48, "gradient");
  const contexts = new Map();
  const errors = [];
  const tuner = createAutoTuner({
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true, ...AUTO_TUNE_DEFAULTS },
    runCandidate: async (req) => {
      const ctx = contexts.get(Number(req.requestId));
      if (!ctx) {
        const error = new Error("Auto Tune 请求已过期");
        error.name = "AbortError";
        errors.push(error.name);
        throw error;
      }
      seen.push(ctx.maxColors);
      return real(req);
    },
  });
  // 故意不建上下文 —— 模拟「这次请求已被新请求顶掉」
  //
  // 期望是**原样上抛**，不是被吞掉退回 STANDARD：
  // 取消 / 过期是「预期结局」，必须让调用方知道这一轮没有结果；
  // 吞掉它会让上层以为「调优做完了，就用 STANDARD 吧」，
  // 而实际上用户点的是取消 —— 那就是「点了取消反而又开始算」。
  await assert.rejects(
    () => tuner.tune({ source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 12, requestId: 77 }),
    (error) => error?.name === "AbortError",
    "上下文缺失时没有原样抛 AbortError",
  );
  assert.ok(errors.length > 0, "没有上下文却一个候选都没被拦住");
  assert.equal(seen.length, 0, "没有上下文却仍然把候选跑起来了");
});
