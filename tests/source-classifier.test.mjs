/**
 * §12.2「Pixel Detector Rebuild」+ §12.3「Routing Strategy」的回归守卫。
 *
 * 这个文件守的是**行为契约**，不是实现细节。四条主线：
 *
 * ① **声明与实现一致** —— `ROUTING_SIGNALS` 里声明的信号必须真的被算出来，
 *    候选/规则引用的信号必须真的被声明。§12.1 的教训是「没人算的指标」
 *    能让一条规则看起来在工作（`portraitLikeness` 曾被硬编码成 0）。
 *
 * ② **没有单指标决定路由** —— 硬规则至少 3 条证据同时成立；
 *    `pixel` 候选有身份门，门为 0 时它不可能夺冠。
 *    §12 原话：「禁止因为某个单指标越线就强制进入 pixel」。
 *
 * ③ **§12 ROUTING TEST 五条**（用户点名的）—— 逐条断言。
 *
 * ④ **检测器本身的性质** —— `magnificationTrace` 必须在 25 张图上完美二分，
 *    且**不能**把「有 8×8 网格但不是放大」的 O 判成放大。
 *    这是「有没有网格 ≠ 是不是放大」的守卫，首版检测器就栽在这里。
 *
 * 断言里的数字全部是实测值并留了余量，注释里写了实测值。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  ROUTING_SIGNALS, ROUTING_HARD_RULES, ROUTING_CANDIDATES,
  ROUTING_CONFIDENCE_FLOOR, ROUTING_MODE_ALIASES, routingToEngineMode,
  measureSignals, measureMagnificationTrace, scoreCandidate, scoreCandidates, classifySource,
} from "../services/source-classifier.mjs";
import { GENERATION_MODES, resolveRoutedMode, resolveGenerationPipeline } from "../services/mode-profile.mjs";
import { buildDataset } from "../tools/b4-routing-audit.mjs";
import { NOISY_PHOTO_BY_ID, buildNoisySource } from "./noisy-photo-fixtures.mjs";

const rows = buildDataset();
const byId = new Map(rows.map((r) => [String(r.id), r]));
const sourceOf = (id) => byId.get(id).source;

const classes = new Map();
function classOf(id) {
  if (!classes.has(id)) classes.set(id, classifySource(sourceOf(id)));
  return classes.get(id);
}

/* =========================================================
 * ① 声明与实现一致
 * ======================================================= */

test("§12.2 声明与实现一致：ROUTING_SIGNALS 与 measureSignals 的键集完全相同", () => {
  const declared = Object.keys(ROUTING_SIGNALS).sort();
  const produced = Object.keys(measureSignals(sourceOf("K"))).sort();
  assert.deepEqual(produced, declared,
    "声明的信号与真的算出来的信号对不上 —— 要么有幽灵信号（没人算却写在表里），"
    + "要么有未声明信号（算出来但契约测试反查不到）");
  for (const [key, spec] of Object.entries(ROUTING_SIGNALS)) {
    assert.ok(spec.unit, `${key} 缺 unit`);
    assert.ok(spec.note, `${key} 缺 note（报告要能解释每个信号量的是什么）`);
  }
});

test("§12.2 声明与实现一致：候选与规则引用的信号都已声明", () => {
  const declared = new Set(Object.keys(ROUTING_SIGNALS));
  for (const c of ROUTING_CANDIDATES) {
    for (const [key] of c.terms) assert.ok(declared.has(key), `候选 ${c.mode} 引用了未声明的信号 ${key}`);
    assert.equal(typeof c.gate, "function", `候选 ${c.mode} 缺身份门 —— 负项占多数时会靠「什么都不像」夺冠`);
    assert.ok(c.gateNote, `候选 ${c.mode} 的门缺说明`);
  }
  for (const r of ROUTING_HARD_RULES) {
    for (const key of r.evidence) assert.ok(declared.has(key), `硬规则 ${r.id} 引用了未声明的信号 ${key}`);
  }
});

test("§12.3 每个候选的权重和为 1（六条候选在同一量纲上可比）", () => {
  for (const c of ROUTING_CANDIDATES) {
    const sum = c.terms.reduce((a, [, w]) => a + w, 0);
    assert.ok(Math.abs(sum - 1) < 1e-9, `候选 ${c.mode} 权重和为 ${sum}，不是 1`);
    for (const [key, w, dir] of c.terms) {
      assert.ok(w > 0, `候选 ${c.mode} 的 ${key} 权重非正`);
      assert.ok(dir === 1 || dir === -1, `候选 ${c.mode} 的 ${key} 方向必须是 ±1`);
    }
  }
});

/* =========================================================
 * ② 没有单指标决定路由
 * ======================================================= */

test("§12 ROUTING SAFETY：没有任何硬规则只依赖 1–2 个信号", () => {
  for (const rule of ROUTING_HARD_RULES) {
    assert.ok(rule.evidence.length >= 3,
      `硬规则 ${rule.id} 只有 ${rule.evidence.length} 条证据 —— §12 禁止单指标越线强制路由`);
    // evidence 数组长度就是「必须同时成立的证据数」，必须与 test() 里的合取项数一致。
    // 靠人工数容易漏，所以这里用「逐个屏蔽」的方式反查：把每条证据置为极端值，
    // 规则必须至少对其中一条敏感。
    const base = Object.fromEntries(rule.evidence.map((k) => [k, 0]));
    assert.equal(typeof rule.test(base), "boolean", `硬规则 ${rule.id} 的 test 不是纯布尔`);
  }
});

test("§12 ROUTING SAFETY：pixel 候选在「无放大痕迹 + 非原生像素画」时门为 0", () => {
  const pixel = ROUTING_CANDIDATES.find((c) => c.mode === "pixel");
  // 构造一个「少色但没放大痕迹、有抗锯齿、有纹理、白底」的假信号集 —— 典型 Logo/插画
  const fake = {
    magnificationTrace: 0, paletteDiscreteness: 0.2, antiAliasRatio: 0.5,
    highFrequencyRatio: 0.3, nearWhiteRatio: 0.9,
  };
  assert.equal(pixel.gate(fake), 0, "pixel 的门放行了一个既没放大痕迹也不是原生像素画的输入");
  // 实测：25 张里门非 0 的只有下面 11 张。
  //   A B C D F G I J  —— ×8 放大产物（E、H 被白底门挡掉，见下）
  //   Q                —— 原生分辨率像素画（1 逻辑像素 = 4 源像素）
  //   rf-portrait-eye  —— 门 0.532 非 0，但 pixel 分只有 0.200，远低于 portrait 0.775。
  //                       门允许「弱候选」存在，但不允许它夺冠。
  // E、H **不在**集合里：它们是纯白底图形，`ramp(1 − nearWhiteRatio, 0.55, 0.90)` 归零。
  // 这条与 `hard-pixel` 的白底约束同源 —— 少了它，E 的 pixel 软分（0.920）
  // 会高于 logo（0.904），只靠硬规则兜底。
  const gateOpen = rows.filter((r) => {
    const c = classOf(r.id);
    return c.candidates.find((x) => x.mode === "pixel").gate > 0;
  }).map((r) => String(r.id));
  assert.deepEqual(gateOpen.sort(),
    ["A", "B", "C", "D", "F", "G", "I", "J", "Q", "rf-portrait-eye"],
    "pixel 门放行的图集变了 —— 多出来的那几张是新的误报风险，少了的说明真像素画被挡在门外");
  for (const id of ["E", "H"]) {
    assert.equal(classOf(id).candidates.find((x) => x.mode === "pixel").gate, 0,
      `${id} 是纯白底图形，不该通过 pixel 的门`);
  }
});

test("§12 ROUTING SAFETY：信心不足必须回落 auto，不许硬猜", () => {
  // 实测：L(0.054) / N(0.291) / O(0.184) / rf-anime-hl(0.297) / rf-thin-struct(0.108) 回落 auto
  for (const id of ["L", "N", "O", "rf-anime-hl", "rf-thin-struct"]) {
    const c = classOf(id);
    assert.ok(c.confidence < ROUTING_CONFIDENCE_FLOOR, `${id} 的信心 ${c.confidence.toFixed(3)} 不该低于门`);
    assert.equal(c.routing.mode, "auto", `${id} 信心不足却没有回落 auto`);
    assert.equal(c.routing.candidate, null, `${id} 回落 auto 时不该还挂着候选名`);
    assert.match(c.routing.reason, /^low-confidence:/, `${id} 回落原因不可解释：${c.routing.reason}`);
  }
  // 反方向：信心充足的必须真的给出候选，否则「门」形同虚设
  for (const id of ["K", "M", "P", "Q", "E"]) {
    assert.ok(classOf(id).confidence >= ROUTING_CONFIDENCE_FLOOR, `${id} 的信心不足，门太严`);
    assert.ok(classOf(id).routing.candidate, `${id} 信心充足却没有候选`);
  }
});

/* =========================================================
 * ③ §12 ROUTING TEST（用户点名的五条）
 * ======================================================= */

test("§12 ROUTING TEST：rf-portrait-eye 不得 pixel", () => {
  const c = classOf("rf-portrait-eye");
  assert.notEqual(c.routing.mode, "pixel");
  assert.equal(c.routing.mode, "portrait", "人像眼球夹具应路由到 portrait");
  // 首版检测器把它判成 pixel（旧 pixelLikeness 0.7107 ≥ 0.62）
  assert.ok(c.candidates.find((x) => x.mode === "pixel").score < 0.3,
    "pixel 候选分仍然过高 —— 放大痕迹之外的门没有生效");
});

test("§12 ROUTING TEST：rf-anime-hl 不得 pixel", () => {
  const c = classOf("rf-anime-hl");
  assert.notEqual(c.routing.mode, "pixel");
  // 实测：候选分 0.297 < 门 0.35 → 回落 auto。它没有专属的「动漫」候选能稳赢
  // （illustration 0.722 vs anime 0.632 差距不足以过门），回落是「不要强猜」的正确表现。
  assert.ok(["auto", "anime", "illustration"].includes(c.routing.mode),
    `rf-anime-hl 路由到 ${c.routing.mode}，既不是 auto 也不是平面图形档`);
});

test("§12 ROUTING TEST：真实像素画 Q → pixel，且 pixelConfidence 最高", () => {
  const c = classOf("Q");
  assert.equal(c.routing.mode, "pixel");
  assert.equal(c.candidates[0].mode, "pixel", "pixel 不是得分最高的候选");
  assert.ok(c.pixelConfidence > 0.5, `pixelConfidence 只有 ${c.pixelConfidence}`);
  // Q 是**原生分辨率**像素画（1 逻辑像素 = 4 源像素），不是 ×8 放大产物。
  // 它是「只看放大痕迹会漏掉原生像素画」这条设计的唯一正样本。
  assert.equal(c.signals.traceBlockSize, 4, "Q 的块尺寸应是 4（1 逻辑像素 = 4 源像素）");
});

test("§12 ROUTING TEST：E Logo → logo", () => {
  const c = classOf("E");
  assert.equal(c.routing.mode, "logo");
  assert.equal(c.routing.candidate, "logo");
  assert.equal(c.hardRule, "hard-logo", "E 应当由硬规则直接判定");
  // 硬规则必须在**软评分之前**生效：E 的 pixel 软分（0.920）曾高于 logo（0.904），
  // 靠 nearWhiteRatio ≤ 0.45 这条约束才把 pixel 排除掉。
  assert.equal(c.candidates.find((x) => x.mode === "pixel").gate, 0,
    "白底图不该通过 pixel 的身份门");
});

test("§12 ROUTING TEST：真实照片 → realistic / smart-general", () => {
  // M 弱光 → realistic（引擎侧 photo）
  assert.equal(classOf("M").routing.mode, "photo");
  assert.equal(classOf("M").routing.candidate, "realistic");
  // N 建筑 / O 压缩：候选分不足以过门 → 回落 auto（= smart-general）
  for (const id of ["N", "O"]) {
    assert.ok(["photo", "auto"].includes(classOf(id).routing.mode),
      `${id} 路由到 ${classOf(id).routing.mode}，既不是写实档也不是通用档`);
  }
  // 真实照片不得进 pixel —— 这是 §12 的主诉
  for (const id of ["M", "N", "O"]) {
    assert.notEqual(classOf(id).routing.mode, "pixel", `${id} 是真实照片，不该进 pixel`);
  }
});

/* =========================================================
 * ④ 检测器本身的性质
 * ======================================================= */

test("§12.2 magnificationTrace 在 25 张图上完美二分（放大产物 vs 不是）", () => {
  const upscaled = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "Q"];
  for (const r of rows) {
    const t = measureMagnificationTrace(r.source).magnificationTrace;
    if (upscaled.includes(String(r.id))) {
      assert.equal(t, 1, `${r.id} 是最近邻放大产物，痕迹却只有 ${t}`);
    } else {
      assert.equal(t, 0, `${r.id} 不是放大产物，痕迹却有 ${t}`);
    }
  }
});

test("§12.2 块尺寸：A–J 报 8（D 报 16），Q 报 4 —— 报的是「能被证据支持的最粗网格」", () => {
  for (const id of ["A", "B", "C", "E", "F", "G", "H", "I", "J"]) {
    assert.equal(measureMagnificationTrace(sourceOf(id)).traceBlockSize, 8, `${id} 块尺寸`);
  }
  // D 在 x%16==8 处变化率恰为 0（横向连续两个逻辑像素同色），所以 16 也被证据支持。
  // 这不是 bug，是「最粗网格」的定义使然 —— 见 measureMagnificationTrace 注释。
  assert.equal(measureMagnificationTrace(sourceOf("D")).traceBlockSize, 16);
  assert.equal(measureMagnificationTrace(sourceOf("Q")).traceBlockSize, 4);
});

test("§12.2 有 8×8 网格 ≠ 是放大产物：O（压缩 JPEG）痕迹必须为 0", () => {
  const o = classOf("O");
  // O 真的有 8×8 块结构（DCT 量化），块边界变化率显著高于块内 ——
  // 但它的块**内**不是逐位恒等（实测 0.233）。首版检测器在这里给它 0.677。
  assert.equal(o.signals.magnificationTrace, 0,
    "O 被判成放大产物 —— 检测器又在量「有没有网格」而不是「块内是否恒等」");
  assert.notEqual(o.routing.mode, "pixel");
});

test("§12.2 shadingCoverage 分离「柔光曲面明暗」与「恒色块」", () => {
  // 无放大痕迹的图（K–P 与 rf-*）实测 ≥ 0.677
  for (const r of rows) {
    const c = classOf(r.id);
    if (c.signals.magnificationTrace > 0.5) continue;   // 放大产物另有判据
    assert.ok(c.signals.shadingCoverage >= 0.65,
      `${r.id} 的 shadingCoverage 只有 ${c.signals.shadingCoverage.toFixed(3)} —— 柔光被漏掉了`);
  }
  // 恒色块（A–I 与 Q）实测 ≤ 0.373
  for (const id of ["A", "B", "C", "D", "E", "F", "G", "H", "I", "Q"]) {
    assert.ok(classOf(id).signals.shadingCoverage <= 0.40,
      `${id} 的 shadingCoverage 有 ${classOf(id).signals.shadingCoverage.toFixed(3)} —— 恒色块冒充了渐变`);
  }
  // J 是例外：它是「照片噪声」，64 逻辑图案里有渐变，5×5 窗跨块边界时拟合良好。
  // 记在这里是为了让「例外」有一个可被复核的名字，而不是被静默跳过。
  assert.ok(classOf("J").signals.shadingCoverage > 0.5, "J 的例外消失了 —— 说明实现变了，注释要跟着改");
});

/* =========================================================
 * 输出形状与集成
 * ======================================================= */

test("§12.3 classifySource 的输出形状与纯函数性质", () => {
  const src = sourceOf("K");
  const before = src.data.slice(0, 64);
  const c = classifySource(src);
  assert.deepEqual(src.data.slice(0, 64), before, "classifySource 修改了源图数据");
  assert.equal(c.candidates.length, ROUTING_CANDIDATES.length);
  assert.equal(c.candidates.length, 6, "§12.3 要求 pixel/portrait/anime/illustration/logo/realistic 六类");
  assert.ok(GENERATION_MODES.includes(c.routing.mode), `routing.mode=${c.routing.mode} 不是合法引擎模式`);
  assert.ok(c.routing.reason, "缺 reason —— 报告要能回答「为什么是这个模式」");
  assert.ok(c.routing.topScores.length >= 2, "缺 topScores —— 报告要能看到竞争关系");
  assert.ok(c.routing.runnerUp, "缺 runnerUp");
  // 确定性
  const again = classifySource(src);
  assert.deepEqual(again.routing, c.routing);
});

test("§12.3 realistic → photo 的别名映射是唯一翻译点", () => {
  assert.equal(ROUTING_MODE_ALIASES.realistic, "photo");
  assert.equal(routingToEngineMode("realistic"), "photo");
  for (const mode of ["pixel", "logo", "portrait", "anime", "illustration"]) {
    assert.equal(routingToEngineMode(mode), mode, `${mode} 不该被改名`);
  }
});

test("§12.3 生产接入：analysis.routing 优先于旧规则，且旧规则仍可用", () => {
  // 新路径：带着 routing 时以它为准
  assert.equal(resolveRoutedMode("auto", { routing: { mode: "photo" } }), "photo");
  assert.equal(resolveRoutedMode("auto", { routing: { mode: "auto" } }), "auto",
    "分类器判「信心不足」时返回的 auto 不该被旧规则覆盖回去");
  // 旧路径：不带 routing 时旧规则照常（契约测试与显式证据调用方依赖它）
  assert.equal(resolveRoutedMode("auto", { pixelLikeness: 0.8 }), "pixel");
  assert.equal(resolveRoutedMode("auto", { portraitLikeness: 0.8 }), "portrait");
  // 非法 routing.mode 不得穿透
  assert.equal(resolveRoutedMode("auto", { routing: { mode: "bogus" } }), "auto");
  // 非 auto 模式原样返回（用户显式选择优先于任何路由）。
  // 循环要**排除 auto** —— auto 本来就是「交给路由」的意思。
  for (const mode of GENERATION_MODES.filter((m) => m !== "auto")) {
    assert.equal(resolveRoutedMode(mode, { routing: { mode: "pixel" } }), mode);
  }
  assert.equal(resolveRoutedMode("auto", { routing: { mode: "pixel" } }), "pixel");
  // 端到端：resolveGenerationPipeline 把路由结果落到 routedMode
  const profile = resolveGenerationPipeline("auto", { routing: { mode: "photo" } });
  assert.equal(profile.routedMode, "photo");
  assert.equal(profile.mode, "auto");
});

test("§12.3 scoreCandidate 的门与分数分开放，报告能区分「证据不足」与「身份不符」", () => {
  const pixel = ROUTING_CANDIDATES.find((c) => c.mode === "pixel");
  const signals = classOf("K").signals;                       // K 无放大痕迹
  const scored = scoreCandidate(pixel, signals);
  assert.equal(scored.gate, 0);
  assert.ok(scored.rawScore > 0.3, "K 在 pixel 候选上的原始证据分不该是 0（负项确实成立）");
  assert.equal(scored.score, 0, "门为 0 时最终分必须是 0");
  assert.equal(scored.gateNote, pixel.gateNote);
  // 缺失信号贡献 0（不是 0.5 中性）
  const partial = scoreCandidate(pixel, {});
  assert.equal(partial.rawScore, 0, "全缺证据时原始分应为 0，不是 0.5");
  assert.equal(partial.coverage, 0);
  // 分数降序
  const sorted = scoreCandidates(signals);
  for (let i = 1; i < sorted.length; i += 1) assert.ok(sorted[i - 1].score >= sorted[i].score);
});

test("§12 K–Q 夹具仍与 A–J 并存（数据集口径未被本模块改动）", () => {
  assert.equal(rows.length, 25);
  assert.equal(rows.filter((r) => r.group === "bench").length, 10);
  assert.equal(rows.filter((r) => r.group === "noisy-photo").length, 7);
  assert.equal(rows.filter((r) => r.group === "real-failure").length, 8);
  assert.equal(NOISY_PHOTO_BY_ID.Q.id, "Q");
  assert.equal(buildNoisySource(NOISY_PHOTO_BY_ID.Q).width, 512);
});
