/**
 * Stage B4 §2 —— 唯一 Generation Pipeline Contract 的结构性防线。
 *
 * 这个文件守的不是「函数返回什么」，而是**契约本身的形状**：
 *
 *   · 模式表只有一份。多出一份就等于多出一个会漂移的真相。
 *   · 每个 ModeProfile 字段都必须有下游读者。写了没人读 = 死配置 ——
 *     B4 §1 审计抓到过 `cleanupStrength` 从 UI 一路走到 resolveOptions 然后被丢掉，
 *     于是 8 个模式的清理强度**全部无效**，pixel（10）与 logo（85）行为逐位相同。
 *   · 路由规则不能依赖没人算的指标。审计抓到 `portraitLikeness` 被硬编码为 0，
 *     而 `auto` 的第一条规则就是它 —— 规则在数学上永不触发，却看起来在工作。
 *   · §3 内部模式纪律：界面只暴露 8 个模式，且不得出现底层算法名。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GENERATION_MODES,
  MODE_LABELS,
  MODE_PROFILES,
  MODE_PROFILE_FIELDS,
  MODE_ROUTING_RULES,
  SAMPLING_STRATEGIES,
  normalizeModeOverrides,
  resolveGenerationPipeline,
  resolveRoutedMode,
  toEngineOptions,
} from "../services/mode-profile.mjs";
import { GENERATION_MODE_PRESETS } from "../services/generation-pipeline.mjs";
import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/**
 * 只保留代码行：**按行首前缀过滤**。
 *
 * 不要用正则剥注释 —— 本仓库的文件里有模板字符串内嵌的 CSS/HTML，
 * 正则剥注释会把真代码一起剥掉。反过来，行首过滤也不会漏掉
 * 「注释里写了禁止出现的字符串」这种情况（本文件里就踩过两次）。
 */
const codeOnly = (text) => text
  .split("\n")
  .filter((line) => {
    const t = line.trim();
    return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
  })
  .join("\n");

const ENGINE = read("smart-preprocessing", "generation-engine-v2.mjs");
const PROTECTION = read("smart-preprocessing", "detail-protection-v2.mjs");
const CLEANUP = read("smart-preprocessing", "smart-cleanup-v2.mjs");
const ENGINE_CODE = codeOnly(ENGINE);
const PROTECTION_CODE = codeOnly(PROTECTION);
const CLEANUP_CODE = codeOnly(CLEANUP);

/* =========================================================
 * ① 模式表只有一份
 * ======================================================= */

test("§2 模式表只有一份：GENERATION_MODE_PRESETS 是 Registry 的视图，不是第二份数据", () => {
  assert.equal(GENERATION_MODE_PRESETS, MODE_PROFILES,
    "generation-pipeline.mjs 又造了第二份模式表 —— 两份必然漂移");
  assert.equal(GENERATION_MODES.length, 8);
  for (const mode of GENERATION_MODES) {
    assert.ok(MODE_PROFILES[mode], `模式 ${mode} 没有档案`);
    assert.ok(MODE_LABELS[mode], `模式 ${mode} 没有界面文案`);
  }
});

test("§2 引擎里不再有 GenerationProfiles（那张表生产链路不可达，已删）", () => {
  assert.doesNotMatch(ENGINE_CODE, /GenerationProfiles/,
    "GenerationProfiles 又回来了 —— 模式表只有 mode-profile.mjs 一份");

  // `options.preset` 在引擎里**另有含义**：它是自适应采样的内容预设提示
  // （决定 autoProfile 开不开），不是生成模式。所以不能全局禁用它 ——
  // 只禁「resolveOptions 拿它去查模式表」这条老路。
  const start = ENGINE_CODE.indexOf("function resolveOptions(");
  const body = ENGINE_CODE.slice(start, ENGINE_CODE.indexOf("\n}", start));
  assert.doesNotMatch(body, /preset/,
    "resolveOptions 又开始按 preset 查表了 —— 那是「回落到某一行」的老路");
});

test("§2 每个模式的每个字段都是已知字段（没有幽灵字段）", () => {
  const known = new Set(Object.keys(MODE_PROFILE_FIELDS));
  for (const mode of GENERATION_MODES) {
    for (const key of Object.keys(MODE_PROFILES[mode])) {
      assert.ok(known.has(key), `模式 ${mode} 的字段 ${key} 不在 MODE_PROFILE_FIELDS 里`);
    }
    for (const key of known) {
      assert.ok(key in MODE_PROFILES[mode], `模式 ${mode} 缺字段 ${key}`);
    }
  }
});

/* =========================================================
 * ② 每个字段都必须有下游读者
 * ======================================================= */

test("§2 每个 ModeProfile 字段在管线源码里都有真实读取点（反死配置）", () => {
  // **只在代码行里搜** —— 注释里提一句不算读取点。
  const sources = `${ENGINE_CODE}\n${PROTECTION_CODE}\n${CLEANUP_CODE}`;
  for (const [field, spec] of Object.entries(MODE_PROFILE_FIELDS)) {
    assert.ok(spec.engineKey, `${field} 没有声明 engineKey`);
    assert.ok(new RegExp(`\\b${spec.engineKey}\\b`).test(sources),
      `${field} → ${spec.engineKey} 在管线源码里找不到读取点：这是死配置`);
  }
});

test("§2 toEngineOptions 发出的每个键，generateV2 的 resolveOptions 都必须认得", () => {
  // resolveOptions 的键集合从源码里取 —— 不导出它是有意的（它只是内部兜底），
  // 但契约测试必须能看见它，否则「引擎加了键、没人发」和「有人发键、引擎不认」
  // 两种漂移都抓不到。
  const start = ENGINE.indexOf("function resolveOptions(");
  assert.ok(start > 0, "找不到 resolveOptions");
  const body = ENGINE.slice(start, ENGINE.indexOf("\n}", start));
  const accepted = new Set([...body.matchAll(/^\s{4}([a-zA-Z][\w]*):/gm)].map((m) => m[1]));
  assert.ok(accepted.size >= 10, `resolveOptions 键解析失败，只拿到 ${accepted.size} 个`);

  const emitted = Object.keys(toEngineOptions(MODE_PROFILES.auto));
  for (const key of emitted) {
    // onPhase 是**故意**不进 cfg 的：它是函数，cfg 要能结构化克隆（Worker 硬前提）。
    if (key === "onPhase") continue;
    assert.ok(accepted.has(key),
      `toEngineOptions 发出 ${key}，但 resolveOptions 不认它 —— 这个值会被静默丢掉`);
  }
});

test("§2 cleanupStrength 不再是死配置：它真的走到引擎里，并且改变可观测结果", () => {
  // 这是审计里那条真实缺陷的回归守卫。之前 cleanupStrength 从 UI 一路走到
  // resolveOptions 然后被丢掉 —— 8 个模式恒等于同一个阈值，pixel（10）与
  // logo（85）行为逐位相同。当时下面这两条断言必然失败。
  //
  // 为什么用 stroke 路径取证：smart-cleanup-v2 的清理还要求
  // `avgEvidence < sourceEvidenceThreshold`，均匀色块永远过不了那道门，
  // 所以「拿一张图比较出图」在清理路径上做不出稳定夹具。而 stroke-mask
  // 用的是**同一个** cfg.cleanupProtectionThreshold，且它的诊断计数
  // raisedAboveThreshold 直接由该阈值决定 —— 是这条链路上最干净的可观测量。
  const source = makeStrokeSource();
  const palette = makePalette();
  const raisedAt = (cleanupStrength) => {
    const profile = resolveGenerationPipeline("auto", null, { cleanupStrength, strokeProtection: true });
    const result = generateV2({
      source, width: 40, height: 40, palette,
      options: toEngineOptions(profile, { maxColors: 0 }),
    });
    return result.diagnostics.strokeProtection?.raisedAboveThreshold ?? null;
  };
  const atZero = raisedAt(0);
  const atHundred = raisedAt(100);
  assert.equal(atZero, 0, "阈值 0 时不可能有格子「从下方跨过阈值」");
  assert.ok(atHundred > 0,
    `阈值 1.0 时应当有描边格子被抬过阈值，实得 ${atHundred} —— cleanupStrength 没走到引擎`);

  // 清理路径的接线也钉住（两条路径共用同一个阈值，不能只接一条）。
  assert.match(ENGINE_CODE, /protectionThreshold: cfg\.cleanupProtectionThreshold/,
    "smart-cleanup-v2 的 protectionThreshold 不再来自 cfg.cleanupProtectionThreshold");
});

test("§2 cleanupStrength → cleanupProtectionThreshold 的方向：强度越高清理越积极", () => {
  // smart-cleanup-v2 里 `avgProtection >= protectionThreshold` 即跳过该连通块。
  // 所以阈值高 = 跳过少 = 清得多。强度高必须对应阈值高。
  const low = toEngineOptions(MODE_PROFILES.auto, { maxColors: 0 });
  const lowProfile = resolveGenerationPipeline("auto", null, { cleanupStrength: 0 });
  const highProfile = resolveGenerationPipeline("auto", null, { cleanupStrength: 100 });
  assert.equal(toEngineOptions(lowProfile, { maxColors: 0 }).cleanupProtectionThreshold, 0);
  assert.equal(toEngineOptions(highProfile, { maxColors: 0 }).cleanupProtectionThreshold, 1);
  assert.equal(low.cleanupProtectionThreshold, 0.5, "auto 的清理强度 50 应对应阈值 0.5（= B4 之前的实际值）");
  assert.match(CLEANUP, /avgProtection >= protectionThreshold/,
    "smart-cleanup-v2 的跳过判据变了 —— 上面那条方向断言要重新推导");
});

/* =========================================================
 * ③ 路由规则必须声明证据
 * ======================================================= */

test("§2 辅助配置必须透传到引擎，不能被「只挑已知字段」吃掉", () => {
  // B2 的背景阈值覆盖就是走这条路进来的。toEngineOptions 只从档案里挑模式字段，
  // 所以辅助配置必须显式带过去 —— 否则 `{autoBackground:true, backgroundConfig:{...}}`
  // 里的阈值会被静默丢弃（B4 §2 实测踩过一次）。
  const profile = resolveGenerationPipeline("auto", null, {
    autoBackground: true,
    backgroundConfig: { maxColorDelta: 18 },
    strokeProtectionGain: 2,
    accentConfig: { minArea: 3 },
  });
  const options = toEngineOptions(profile, { maxColors: 0 });
  assert.deepEqual(options.backgroundConfig, { maxColorDelta: 18 });
  assert.equal(options.strokeProtectionGain, 2);
  assert.deepEqual(options.accentConfig, { minArea: 3 });
  // 没传的辅助配置不该凭空出现一个 undefined 键（会让引擎的 `?? 默认` 逻辑看起来被覆盖）
  assert.equal("strokeConfig" in options, false);
  assert.equal("subjectCropConfig" in options, false);
});

test("§2 每条路由规则都声明了证据字段，且证据缺失时规则不参与", () => {
  for (const rule of MODE_ROUTING_RULES) {
    assert.ok(Array.isArray(rule.evidence) && rule.evidence.length,
      `路由规则 ${rule.id} 没声明 evidence`);
    assert.equal(typeof rule.test, "function", `路由规则 ${rule.id} 没有 test`);
  }
  // 证据缺失 → 不拿 0 当证据。`{}` 应当原地停在 auto，而不是被某条规则用 undefined 命中。
  assert.equal(resolveRoutedMode("auto", {}), "auto");
  assert.equal(resolveRoutedMode("auto", null), "auto");
  // 显式给了证据就正常路由
  assert.equal(resolveRoutedMode("auto", { pixelLikeness: 0.8 }), "pixel");
  assert.equal(resolveRoutedMode("auto", { portraitLikeness: 0.8 }), "portrait");
  // 非 auto 模式是用户的显式选择，不参与路由
  for (const mode of GENERATION_MODES) {
    if (mode === "auto") continue;
    assert.equal(resolveRoutedMode(mode, { pixelLikeness: 0.99 }), mode);
  }
});

test("§2 portraitLikeness 没有生产者 → 人像规则是明确惰性的，不是靠假 0 装在工作", () => {
  // analyzeGenerationImage 曾经硬编码 portraitLikeness: 0，于是这条规则永不触发
  // 却看起来在参与。现在证据字段根本不产出，规则惰性是**可断言的事实**。
  const pipelineCode = codeOnly(read("services", "generation-pipeline.mjs"));
  assert.doesNotMatch(pipelineCode, /portraitLikeness/,
    "analyzeGenerationImage 又在伪造 portraitLikeness 了 —— 要么真算出来，要么别产出这个字段");
});

test("§2 归一化：已知字段被校验，未知字段原样透传（不建白名单）", () => {
  const normalized = normalizeModeOverrides({
    detailProtection: 999,        // 越界 → clamp 到 100
    edgeProtection: -5,           // 越界 → clamp 到 0
    sampling: "不存在的策略",       // 非法 → 删掉，保持档案自己的值
    preserveEyes: "yes",          // 非严格 true → false
    autoBackground: true,
    backgroundConfig: { maxColorDelta: 18 },  // 未知字段 → 必须留下
    somethingNewFromB5: 42,       // 未来新增 → 必须留下
  });
  assert.equal(normalized.detailProtection, 100);
  assert.equal(normalized.edgeProtection, 0);
  assert.equal("sampling" in normalized, false);
  assert.equal(normalized.preserveEyes, false);
  assert.equal(normalized.autoBackground, true);
  assert.deepEqual(normalized.backgroundConfig, { maxColorDelta: 18 },
    "未知字段被白名单吃掉了 —— 新增选项会静默失效");
  assert.equal(normalized.somethingNewFromB5, 42);

  // 非法采样策略不能把档案的值也带偏
  const resolved = resolveGenerationPipeline("anime", null, { sampling: "bogus" });
  assert.equal(resolved.sampling, "dominant", "非法覆盖不该把 dominant 静默换成 auto");
  assert.ok(SAMPLING_STRATEGIES.includes(resolved.sampling));
});

/* =========================================================
 * ④ §3 内部模式纪律
 * ======================================================= */

test("§3 界面只暴露这 8 个模式，不多不少", () => {
  const panel = read("ui", "generation-panel.js");
  const declared = [...panel.matchAll(/presetButton\(\s*"([a-z]+)"/g)].map((m) => m[1]);
  assert.deepEqual(declared.slice().sort(), GENERATION_MODES.slice().sort(),
    `生成面板的模式清单与 Registry 不一致：${declared.join(",")}`);
});

test("§3 底层算法名不得出现在用户界面里", () => {
  // 这些是实验性算法 / 内部参数名。它们可以存在于算法模块与实验室，
  // 但**绝不能**出现在工作台或生成面板上。
  const forbidden = [
    "Bean Fit", "Dual Mode", "ICM", "Neutral Penalty", "Cleanup Lambda",
    "AutoTune", "Auto Tune", "autoTuneScore", "beanFit", "dualMode",
    "neutralPenalty", "cleanupLambda", "spatialRefine", "conservativeCleanup",
  ];
  const uiFiles = ["ui/workspace.js", "ui/generation-panel.js", "index.html"];
  for (const file of uiFiles) {
    const text = read(...file.split("/"));
    for (const needle of forbidden) {
      assert.ok(!text.includes(needle),
        `${file} 里出现了内部算法名「${needle}」—— §3 禁止把它暴露给用户`);
    }
  }
});

/* =========================================================
 * 夹具
 * ======================================================= */

/** 高对比描边图：黑方块 + 内部细线，保证 sobel 有明确的极值像素（strength = 1）。 */
function makeStrokeSource() {
  const width = 160, height = 160;
  const data = new Uint8ClampedArray(width * height * 4);
  const put = (x, y, v) => {
    const i = (y * width + x) * 4;
    data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
  };
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) put(x, y, 248);
  // 外框 + 两条内部细线：细线宽度 2px，落在格子边界上，sobel 响应明确。
  for (let y = 24; y < 136; y++) for (let x = 24; x < 136; x++) {
    const onBorder = x < 27 || x >= 133 || y < 27 || y >= 133;
    const onLine = Math.abs(x - 80) < 2 || Math.abs(y - 80) < 2;
    put(x, y, onBorder || onLine ? 16 : 248);
  }
  return { data, width, height };
}

function makePalette() {
  return [
    { code: "W1", rgb: [240, 240, 236] },
    { code: "K1", rgb: [40, 40, 44] },
    { code: "B1", rgb: [30, 90, 190] },
    { code: "G1", rgb: [120, 170, 120] },
    { code: "R1", rgb: [200, 70, 60] },
  ];
}
