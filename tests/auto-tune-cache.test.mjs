/**
 * Stage B4 §13.7 —— 缓存与失效契约（§17 / §18）。
 *
 * §17 说的是一件很具体的事：**同一个 source hash / crop / palette / size /
 * maxColors / mode 之下允许缓存**，而且「只改 zoom / panel / selection 不能重新跑」。
 *
 * §18 说的是反面：source / crop / palette / maxColors / background decision /
 * mode / target size policy 变化**必须失效**。
 *
 * 这两条合起来才是完整规则，所以本文件两侧都测：
 *   · 键里的每一个轴，改了就**必须**变
 *   · 键外的每一个轴（zoom / 面板 / 选中项 / 任何未知字段），改了**必须不变**
 *
 * 第二条特别值得单独测，因为它是**静默的**：如果哪天有人图省事把整个 state
 * 塞进键里，功能不会坏，只会「每动一下缩放就重跑 4 个候选」——
 * 用户看到的是卡顿，而不是错误。
 */
import test from "node:test";
import assert from "node:assert/strict";

import {
  AUTO_TUNE_DEFAULTS,
  createAutoTuner,
  createTuneCache,
  overridesFingerprint,
  paletteFingerprint,
  sourceFingerprint,
  tuneCacheKey,
} from "../services/auto-tune.mjs";
import { makeRealRunCandidate, syntheticSource, tinyPalette } from "./auto-tune-fixtures.mjs";

const PALETTE = tinyPalette();
const SIZE = { width: 48, height: 48 };

const BASE_INPUT = Object.freeze({
  sourceHash: "abc123",
  cropKey: null,
  paletteHash: "p1",
  maxColors: 24,
  backgroundDecision: null,
  mode: "auto",
  targetWidth: 48,
  targetHeight: 48,
  previewLongEdge: 104,
  signature: "prod",
});

const key = (patch = {}) => tuneCacheKey({ ...BASE_INPUT, ...patch });

/* =========================================================
 * §18 必须失效的轴
 * ======================================================= */

test("§18 键是稳定的：同样的输入永远同样的键", () => {
  assert.equal(key(), key());
  assert.equal(key(), tuneCacheKey({ ...BASE_INPUT }));
});

test("§18 source 变了 → 键变", () => {
  assert.notEqual(key(), key({ sourceHash: "def456" }));
});

test("§18 crop 变了 → 键变", () => {
  assert.notEqual(key(), key({ cropKey: "crop-1" }));
  assert.notEqual(key({ cropKey: "crop-1" }), key({ cropKey: "crop-2" }));
});

test("§18 palette 变了 → 键变", () => {
  assert.notEqual(key(), key({ paletteHash: "p2" }));
});

test("§18 maxColors 变了 → 键变（0 与 24 是两种策略，不是同一个）", () => {
  assert.notEqual(key(), key({ maxColors: 0 }));
  assert.notEqual(key({ maxColors: 12 }), key({ maxColors: 24 }));
});

test("§18 background decision 变了 → 键变", () => {
  assert.notEqual(key(), key({ backgroundDecision: "transparent" }));
  assert.notEqual(key({ backgroundDecision: "transparent" }), key({ backgroundDecision: "keep" }));
});

test("§18 用户选的 mode 变了 → 键变", () => {
  assert.notEqual(key(), key({ mode: "portrait" }));
});

test("§18 target size policy 变了 → 键变（宽、高各自独立成轴）", () => {
  assert.notEqual(key(), key({ targetWidth: 64 }));
  assert.notEqual(key(), key({ targetHeight: 64 }));
});

test("§18 预览长边 / 生产档位变了 → 键变（选择结果依赖于这两者）", () => {
  assert.notEqual(key(), key({ previewLongEdge: 128 }));
  assert.notEqual(key(), key({ signature: "all" }));
});

/* =========================================================
 * §17 必须**不**失效的轴
 * ======================================================= */

test("§17 只改 zoom / 面板 / 选中项 → 键**不变**（否则每动一下缩放就重跑候选）", () => {
  const base = key();
  for (const extra of [
    { zoom: 2.5 }, { zoom: 0.14 },
    { panel: "palette" }, { panel: "inspect" },
    { selectedCell: { x: 3, y: 4 } },
    { galleryOpen: true },
    { assemblyHideCellText: true },
    { scrollTop: 1200 },
    { locale: "zh-CN" },
  ]) {
    assert.equal(tuneCacheKey({ ...BASE_INPUT, ...extra }), base,
      `键里混进了与生成无关的字段：${JSON.stringify(extra)}`);
  }
});

test("§17 未知字段一律不进键（防「把整个 state 塞进来」）", () => {
  assert.equal(tuneCacheKey({ ...BASE_INPUT, 随便什么: 1, __proto__x: 2 }), key());
});

/* =========================================================
 * LRU 行为
 * ======================================================= */

test("§17 缓存是 LRU：超过上限淘汰最久未用的那一条", () => {
  const cache = createTuneCache({ max: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  assert.equal(cache.size, 2);
  cache.set("c", 3);
  assert.equal(cache.has("a"), false, "最久未用的那条没被淘汰");
  assert.equal(cache.has("b"), true);
  assert.equal(cache.has("c"), true);
});

test("§17 get 会刷新「最近使用」，被读过的不会被淘汰", () => {
  const cache = createTuneCache({ max: 2 });
  cache.set("a", 1);
  cache.set("b", 2);
  cache.get("a");            // a 变成最近使用
  cache.set("c", 3);
  assert.equal(cache.has("a"), true, "读过的条目被淘汰了 —— 那不是 LRU");
  assert.equal(cache.has("b"), false);
});

test("§17 未命中返回 null（不是 undefined，也不是抛）", () => {
  const cache = createTuneCache();
  assert.equal(cache.get("没有这个键"), null);
});

test("§17 默认上限是 4（每条含一张网格，不能无限增长）", () => {
  const cache = createTuneCache();
  for (let i = 0; i < 10; i += 1) cache.set(`k${i}`, i);
  assert.equal(cache.size, 4);
});

/* =========================================================
 * 端到端：真的省掉了一次重跑
 * ======================================================= */

test("§17 同一输入第二次调用命中缓存：不再跑候选，且报告标记 cached", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  let calls = 0;
  const tuner = createAutoTuner({
    runCandidate: async (req) => { calls += 1; return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true },
  });
  const input = { source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0, requestId: 1 };

  const first = await tuner.tune(input);
  const callsAfterFirst = calls;
  assert.equal(first.cached, false);
  assert.ok(callsAfterFirst >= 2, `第一次只跑了 ${callsAfterFirst} 个候选`);

  const second = await tuner.tune({ ...input, requestId: 2 });
  assert.equal(second.cached, true, "同一输入第二次没有命中缓存");
  assert.equal(calls, callsAfterFirst, "命中缓存后仍然跑了候选 —— 缓存没起作用");
  assert.equal(second.selectedProfileId, first.selectedProfileId, "命中缓存后选择结果变了");
  assert.ok(second.grid, "命中缓存后没有网格");
});

test("§18 改了 maxColors → 缓存不命中，重新跑候选", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  let calls = 0;
  const tuner = createAutoTuner({
    runCandidate: async (req) => { calls += 1; return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true },
  });
  const base = { source, mode: "auto", size: SIZE, palette: PALETTE, requestId: 1 };
  await tuner.tune({ ...base, maxColors: 0 });
  const after = calls;
  const changed = await tuner.tune({ ...base, maxColors: 12, requestId: 2 });
  assert.equal(changed.cached, false, "maxColors 变了却命中了缓存 —— §18 失效规则漏了一轴");
  assert.ok(calls > after, "maxColors 变了但没有重跑候选");
});

test("§18 改了目标尺寸 → 缓存不命中", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = createAutoTuner({
    runCandidate: async (req) => real(req),
    analyze: () => ({ routing: { mode: "auto" } }),
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true },
  });
  const base = { source, mode: "auto", palette: PALETTE, maxColors: 0 };
  await tuner.tune({ ...base, size: SIZE, requestId: 1 });
  const bigger = await tuner.tune({ ...base, size: { width: 96, height: 96 }, requestId: 2 });
  assert.equal(bigger.cached, false, "目标尺寸变了却命中了缓存");
});

test("§17 指纹是纯函数：同输入同输出，不同输入不同输出", () => {
  const a = syntheticSource(24, 24, "gradient");
  const b = syntheticSource(24, 24, "checker");
  assert.equal(sourceFingerprint(a), sourceFingerprint(a));
  assert.notEqual(sourceFingerprint(a), sourceFingerprint(b));
  assert.equal(sourceFingerprint(null), "empty");
  assert.equal(paletteFingerprint(PALETTE), paletteFingerprint(PALETTE));
  assert.notEqual(paletteFingerprint(PALETTE), paletteFingerprint(PALETTE.slice(1)));
});

test("§17 缓存可以关掉（useCache: false）—— 评测工具需要每次都真跑", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  let calls = 0;
  const tuner = createAutoTuner({
    runCandidate: async (req) => { calls += 1; return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true, ...AUTO_TUNE_DEFAULTS },
  });
  const input = { source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0 };
  await tuner.tune({ ...input, requestId: 1, useCache: false });
  const after = calls;
  await tuner.tune({ ...input, requestId: 2, useCache: false });
  assert.ok(calls > after, "useCache: false 时仍然命中了缓存 —— 评测会拿到假数据");
});

/* =========================================================
 * §18 —— 调用方参数（overrides）必须进键
 *
 * 这一组是 2026-10-04 真机排障挖出来的。当时的键里**没有** overrides，
 * 于是「把细节保护从 70 拖到 90 再点生成」会命中缓存、返回 70 的图纸。
 * 表现是「滑杆没反应」—— 比选错 Profile 严重得多：选错只是不够好，
 * 这是明确的错误输出，而且不报错。
 * ========================================================= */

test("§18 调用方 overrides 变一个数，缓存键必须变", () => {
  const base = { sourceHash: "s", paletteHash: "p", mode: "auto", targetWidth: 104, targetHeight: 104 };
  const a = tuneCacheKey({ ...base, overridesHash: overridesFingerprint({ detailProtection: 70 }) });
  const b = tuneCacheKey({ ...base, overridesHash: overridesFingerprint({ detailProtection: 90 }) });
  assert.notEqual(a, b, "细节保护变了但键没变 —— 用户拖滑杆会拿到旧参数的图纸");
});

test("§18 四个保护档 + 去背景意图，每一项单独变都要换键", () => {
  const keys = ["detailProtection", "edgeProtection", "cleanupStrength", "preserveEyes", "preserveHighlights",
    "preserveMicroDetails", "autoBackground", "subjectCrop", "strokeProtection", "accentProtection"];
  const base = Object.fromEntries(keys.map((k) => [k, typeof k === "string" && k.startsWith("preserve") ? true : 50]));
  const baseKey = overridesFingerprint(base);
  for (const key of keys) {
    const changed = { ...base, [key]: typeof base[key] === "boolean" ? !base[key] : base[key] + 1 };
    assert.notEqual(overridesFingerprint(changed), baseKey, `${key} 改了但指纹没变`);
  }
});

test("§18 指纹与书写顺序无关（否则缓存会时灵时不灵）", () => {
  const a = overridesFingerprint({ detailProtection: 70, edgeProtection: 80, autoBackground: true });
  const b = overridesFingerprint({ autoBackground: true, edgeProtection: 80, detailProtection: 70 });
  assert.equal(a, b, "同一个 overrides 换个键顺序就成了另一个键");
});

test("§18 候选名不进指纹 —— 否则每个候选各 miss 一次，缓存等于没有", () => {
  const base = overridesFingerprint({ detailProtection: 70, cleanupStrength: 50 });
  assert.equal(overridesFingerprint({ detailProtection: 70, cleanupStrength: 50, labCandidate: "bean-fit" }), base);
});

test("§18 指纹只吃原始值：嵌套对象也稳定，函数不参与", () => {
  const a = overridesFingerprint({ subjectCropConfig: { top: 1, left: 2 }, mode: "auto" });
  const b = overridesFingerprint({ mode: "auto", subjectCropConfig: { left: 2, top: 1 } });
  assert.equal(a, b);
  assert.notEqual(a, overridesFingerprint({ subjectCropConfig: { top: 1, left: 3 }, mode: "auto" }));
  assert.equal(overridesFingerprint(null), "");
  assert.equal(overridesFingerprint(undefined), "");
  assert.equal(overridesFingerprint("not-an-object"), "");
});

test("§18 端到端：改 overrides 之后必须真跑候选，不能命中缓存", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  let calls = 0;
  const tuner = createAutoTuner({
    runCandidate: async (req) => { calls += 1; return real(req); },
    analyze: () => ({ routing: { mode: "auto" } }),
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true, ...AUTO_TUNE_DEFAULTS },
  });
  const base = { source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0 };
  const first = await tuner.tune({ ...base, overrides: { detailProtection: 70 }, requestId: 1 });
  assert.equal(first.cached, false);
  const afterFirst = calls;
  // 同一组参数：这次**应该**命中
  const again = await tuner.tune({ ...base, overrides: { detailProtection: 70 }, requestId: 2 });
  assert.equal(again.cached, true, "同参数第二次没命中缓存，§17 的意义就没了");
  assert.equal(calls, afterFirst, "缓存命中却仍然跑了候选");
  // 改一个保护档：必须重跑
  const moved = await tuner.tune({ ...base, overrides: { detailProtection: 90 }, requestId: 3 });
  assert.equal(moved.cached, false, "细节保护从 70 改到 90 却命中了缓存 —— 会返回旧参数的图纸");
  assert.ok(calls > afterFirst, "参数变了但一个候选都没跑");
});

test("§18 cropKey 变化必须失效（app.js 传的是 sourceTransform 的排序指纹）", async () => {
  const source = syntheticSource(48, 48, "gradient");
  const real = makeRealRunCandidate({ source, palette: PALETTE });
  const tuner = createAutoTuner({
    runCandidate: async (req) => real(req),
    analyze: () => ({ routing: { mode: "auto" } }),
    cache: createTuneCache({ max: 4 }),
    limits: { productionOnly: true, ...AUTO_TUNE_DEFAULTS },
  });
  const base = { source, mode: "auto", size: SIZE, palette: PALETTE, maxColors: 0 };
  await tuner.tune({ ...base, cropKey: "crop=null", requestId: 1 });
  const same = await tuner.tune({ ...base, cropKey: "crop=null", requestId: 2 });
  assert.equal(same.cached, true);
  const cropped = await tuner.tune({ ...base, cropKey: "crop={x:1}", requestId: 3 });
  assert.equal(cropped.cached, false, "裁剪变了却命中缓存（§18 明确要求失效）");
});

test("app.js 真的把 cropKey 传给了调优器（不是只有调优器支持）", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const app = fs.readFileSync(path.join(root, "app.js"), "utf8");
  assert.match(app, /cropKey:\s*sourceTransformFingerprint\(state\.sourceTransform\)/,
    "调优器支持 cropKey，但 app.js 没传 —— 裁剪变化不会让缓存失效");
  assert.match(app, /function sourceTransformFingerprint\(/);
});
