/**
 * b4-routing-audit.mjs — Stage B4 §12.1「路由特征审计」的常驻工具。
 *
 * ── 它为什么必须是一个工具，而不是一次性脚本 ────────────────────────────
 * §12 的全部结论（哪个 feature 有区分度、哪个分支不可达、误路由多少张）
 * 都是**可被推翻的经验事实**，不是设计意图。把它们留在一次性的 /tmp 脚本里，
 * 下一次有人改动采样、夹具或路由阈值，就再也没有人能复核这些数字。
 *
 * ── 用法 ────────────────────────────────────────────────────────────
 *   node tools/b4-routing-audit.mjs                 # 人读的表
 *   node tools/b4-routing-audit.mjs --json          # 机器读（报告引用它）
 *   node tools/b4-routing-audit.mjs --json > outputs/stage-b4-routing/audit.json
 *
 * **只读**：不改任何生产文件、不写任何文件（除 stdout）。
 *
 * ── 数据集口径 ──────────────────────────────────────────────────────
 *   A–J     tests/b4-bench-fixtures.mjs      （逻辑 64 → 512，最近邻 ×8）
 *   rf-*    tests/fixtures/real-failures/    （256×256 逐像素）
 *   K–Q     tests/noisy-photo-fixtures.mjs   （512×512 逐像素）
 * 三类**必须同时出现**：只跑 A–J 会得出「像素检测器对十类全体误报」这种
 * 由夹具放大方式造成的假结论（见报告 §12.1 发现 1）。
 */

import { analyzeGenerationImage } from "../services/generation-pipeline.mjs";
import { MODE_ROUTING_RULES, resolveRoutedMode } from "../services/mode-profile.mjs";
import { classifySource, ROUTING_SIGNALS } from "../services/source-classifier.mjs";
import { B4_BENCH_CLASSES, buildBenchGrid, rasterize } from "../tests/b4-bench-fixtures.mjs";
import { NOISY_PHOTO_CLASSES, buildNoisySource, measureBlockStructure } from "../tests/noisy-photo-fixtures.mjs";
import { loadRealFailureFixtures } from "../src/algorithms/engines/hybrid-v2/real-failures.mjs";

/**
 * 每张图「应该」路由到哪里。
 *
 * ⚠️ **A–J 的期望是一个集合，不是单个模式** —— 这是 §12.1 最重要的发现：
 * A–J 十类源图全部是 64 逻辑 → 512 的**最近邻 ×8 放大**，每个 8×8 块内部
 * 逐位恒等（实测 innerChangeRate 恒为 0.000000）。也就是说它们**在风格上就是
 * 像素画**，尽管内容分别是人像 / 动漫 / 插画 / Logo / 回形纹…
 *
 * 于是对同一张 E（Logo）有**两个都成立**的答案：
 *   · `pixel` —— 按风格：它确实是块内逐位恒等的像素画渲染，逐块保留 = 零失真；
 *   · `logo`  —— 按内容：它确实是纯白底 + 厚笔画的品牌标。
 * 拿「E 必须去 logo」去判 pixel 是错的，等于用内容意图考核一个风格判据；
 * 反过来也一样。所以 A–J 的判据是**「pixel 或该类的内容模式」**。
 *
 * 代价要说清楚：**A–J 因此不再有区分力**（它们全部落在 pixel 上，见
 * `summary.benchRoutedToPixel`）。它们的价值只剩两条：
 *   ① 证明「块内恒等」这条判据在十种内容上一致成立；
 *   ② 作为**反向信号**的证据 —— 旧 `pixelLikeness` 在 A–J 上命中 9 张，
 *      其中 D（唯一的真像素画）反而排在阈值以下。
 *
 * 内容模式误路由只在**原生分辨率**子集上统计：
 *   rf-*（256×256 逐像素，8 张）+ K–Q（512×512 逐像素，7 张）= 15 张。
 */
export const BENCH_CONTENT_MODE = Object.freeze({
  A: "portrait", B: "anime", C: "illustration", D: "pixel", E: "logo",
  F: "general", G: "general", H: "logo", I: "general", J: "photo",
});
export const STYLE_EXPECT = "pixel-or-content";
export const EXPECT = {
  K: "portrait", L: "general", M: "photo-or-general", N: "photo-or-general", O: "photo-or-general",
  P: "illustration", Q: "pixel",
  "rf-portrait-eye": "not-pixel", "rf-anime-hl": "not-pixel",
};
const GENERAL_OK = ["auto", "illustration", "photo"];
/** §12 原话：「真实照片 → realistic / smart-general」。realistic 落到引擎侧就是 photo。 */
const PHOTO_OK = ["photo", "auto"];

/** 数据集里的 id 是否属于「原生分辨率」子集（可用来评内容模式）。 */
export function isNativeResolution(row) {
  return row.group !== "bench";
}

function isCorrect(expect, routed, id) {
  if (expect === STYLE_EXPECT) {
    if (routed === "pixel") return true;
    const content = BENCH_CONTENT_MODE[id];
    if (content === "general") return GENERAL_OK.includes(routed);
    return routed === content;
  }
  if (expect === "general") return GENERAL_OK.includes(routed);
  if (expect === "photo-or-general") return PHOTO_OK.includes(routed);
  if (expect === "not-pixel") return routed !== "pixel";
  return routed === expect;
}

function pearson(pairs) {
  const n = pairs.length;
  if (n < 3) return null;
  const mx = pairs.reduce((a, p) => a + p[0], 0) / n;
  const my = pairs.reduce((a, p) => a + p[1], 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (const [x, y] of pairs) { const dx = x - mx, dy = y - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxx && syy ? sxy / Math.sqrt(sxx * syy) : null;
}

const FEATURES = [
  ["edgeDensity", (r) => r.gen.edgeDensity],
  ["flatRegionRatio", (r) => r.gen.flatRegionRatio],
  ["textureScore", (r) => r.gen.textureScore],
  ["colorComplexity", (r) => r.gen.colorComplexity],
  ["pixelLikeness", (r) => r.gen.pixelLikeness],
  ["blockInnerChangeRate", (r) => r.block.innerChangeRate],
  ["blockBoundaryChangeRate", (r) => r.block.boundaryChangeRate],
];

export function buildDataset() {
  const rows = [];
  for (const cls of B4_BENCH_CLASSES) {
    rows.push({
      id: cls.id, label: cls.label, group: "bench", expect: STYLE_EXPECT,
      source: rasterize(buildBenchGrid(cls)),
    });
  }
  for (const cls of NOISY_PHOTO_CLASSES) {
    rows.push({ id: cls.id, label: cls.label, group: "noisy-photo", expect: EXPECT[cls.id], source: buildNoisySource(cls) });
  }
  for (const f of loadRealFailureFixtures()) {
    rows.push({ id: f.id, label: f.id, group: "real-failure", expect: EXPECT[f.id] ?? "general", source: f.imageData });
  }
  return rows;
}

export function audit() {
  const rows = buildDataset();
  for (const r of rows) {
    r.gen = analyzeGenerationImage(r.source);
    r.block = measureBlockStructure(r.source);
    // 旧：只有 pixelLikeness 一条可用证据
    r.before = resolveRoutedMode("auto", r.gen);
    // 新：§12.2/§12.3 的分类器
    r.class = classifySource(r.source);
    r.after = r.class.routing.mode;
    r.correctBefore = isCorrect(r.expect, r.before, r.id);
    r.correctAfter = isCorrect(r.expect, r.after, r.id);
    r.native = isNativeResolution(r);
  }

  const stats = FEATURES.map(([name, get]) => {
    const values = rows.map(get).filter((v) => Number.isFinite(v));
    const mean = values.reduce((a, b) => a + b, 0) / Math.max(1, values.length);
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, values.length));
    return {
      name, n: values.length,
      min: Math.min(...values), max: Math.max(...values),
      range: Math.max(...values) - Math.min(...values),
      mean, sd, cv: sd / Math.max(1e-9, Math.abs(mean)),
    };
  });

  const correlations = [];
  for (let i = 0; i < FEATURES.length; i += 1) {
    for (let j = i + 1; j < FEATURES.length; j += 1) {
      const r = pearson(rows.map((row) => [FEATURES[i][1](row), FEATURES[j][1](row)]));
      if (r != null) correlations.push({ a: FEATURES[i][0], b: FEATURES[j][0], r });
    }
  }
  correlations.sort((x, y) => Math.abs(y.r) - Math.abs(x.r));

  const rules = MODE_ROUTING_RULES.map((rule) => {
    const missing = rule.evidence.filter((k) => {
      const v = rows[0].gen[k];
      return v == null || !Number.isFinite(Number(v));
    });
    const hits = rows.filter((row) => rule.evidence.every((k) => Number.isFinite(Number(row.gen[k]))) && rule.test(row.gen)).map((row) => row.id);
    return { id: rule.id, to: rule.to, evidence: rule.evidence, missingEvidence: missing, reachable: missing.length === 0, hits };
  });

  const misrouteList = (key) => rows.filter((r) => !r[key]).map((r) => ({
    id: r.id, group: r.group, expect: r.expect,
    before: r.before, after: r.after,
    pixelLikeness: r.gen.pixelLikeness,
    pixelConfidence: r.class.pixelConfidence,
    confidence: r.class.confidence,
    reason: r.class.routing.reason,
  }));

  const native = rows.filter((r) => r.native);
  const styleRows = rows.filter((r) => !r.native);

  // pixelLikeness 的排序 vs 真实「是像素画吗」。
  //
  // 真像素画的定义是**独立于本工具**的：源图存在 b×b 最近邻放大的块内恒等结构。
  // 由 `tests/noisy-photo-fixtures.test.mjs` 的「裁决对照」两条测试断言
  // （A–J 的 innerChangeRate 恒为 0；O 的 > 0.05 且与 A–J 的差 > 0.05）。
  // 实测满足的是 A–J（×8）与 Q（×4），共 11 张。
  const pixelTruth = new Set(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "Q"]);
  const ranked = rows.map((r) => ({ id: r.id, v: r.gen.pixelLikeness, isPixel: pixelTruth.has(r.id) }))
    .sort((a, b) => b.v - a.v);
  const threshold = 0.62;
  const above = ranked.filter((r) => r.v >= threshold);
  const truePositives = above.filter((r) => r.isPixel).length;
  const falsePositives = above.length - truePositives;
  const falseNegatives = ranked.filter((r) => !r.v || r.v < threshold).filter((r) => r.isPixel).length;

  // 新分类器：信号矩阵
  const signalKeys = Object.keys(ROUTING_SIGNALS);
  const signalStats = signalKeys.map((key) => {
    const values = rows.map((r) => r.class.signals[key]).filter((v) => v != null && Number.isFinite(v));
    if (!values.length) return { key, n: 0, missing: true };
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length);
    return {
      key, n: values.length, missing: false,
      min: Math.min(...values), max: Math.max(...values),
      range: Math.max(...values) - Math.min(...values),
      mean, sd, cv: sd / Math.max(1e-9, Math.abs(mean)),
    };
  }).sort((a, b) => (b.range ?? -1) - (a.range ?? -1));

  return {
    dataset: rows.map((r) => ({
      id: r.id, group: r.group, expect: r.expect, native: r.native,
      before: r.before, after: r.after, correctBefore: r.correctBefore, correctAfter: r.correctAfter,
      candidate: r.class.routing.candidate, confidence: r.class.confidence, reason: r.class.routing.reason,
      topScores: r.class.routing.topScores, signals: r.class.signals,
      features: r.gen, block: r.block,
    })),
    stats, correlations, rules,
    signalStats,
    misroutesBefore: misrouteList("correctBefore"),
    misroutesAfter: misrouteList("correctAfter"),
    summary: {
      total: rows.length,
      nativeTotal: native.length,
      styleTotal: styleRows.length,
      // 内容模式误路由：只看原生分辨率子集
      nativeMisroutedBefore: native.filter((r) => !r.correctBefore).length,
      nativeMisroutedAfter: native.filter((r) => !r.correctAfter).length,
      // 风格一致性：A–J 是否全部被判为像素画
      benchRoutedToPixel: styleRows.filter((r) => r.after === "pixel").length,
      benchRoutedToPixelBefore: styleRows.filter((r) => r.before === "pixel").length,
      // 真正的「误进 pixel」：原生分辨率下被判成 pixel 但不是像素画的
      nativeWronglyPixelBefore: native.filter((r) => r.before === "pixel" && r.expect !== "pixel").map((r) => r.id),
      nativeWronglyPixelAfter: native.filter((r) => r.after === "pixel" && r.expect !== "pixel").map((r) => r.id),
      // 旧 pixelLikeness 在 0.62 阈值上的混淆矩阵（真像素画 11 张）
      pixelRuleHits: above.length,
      pixelRuleTruePositives: truePositives,
      pixelRuleFalsePositives: falsePositives,
      pixelRuleFalseNegatives: falseNegatives,
      pixelTruthTotal: pixelTruth.size,
      /** Q（唯一的原生分辨率像素画）在 pixelLikeness 排序里的名次 */
      nativePixelRankByPixelLikeness: ranked.findIndex((r) => r.id === "Q") + 1,
      pixelThreshold: threshold,
      nearThreshold: ranked.filter((r) => Math.abs(r.v - threshold) <= 0.02).length,
      allBenchInnerChangeRateZero: B4_BENCH_CLASSES.every((cls) => measureBlockStructure(rasterize(buildBenchGrid(cls))).innerChangeRate === 0),
    },
    ranking: ranked,
  };
}

/* ── CLI ──────────────────────────────────────────────────────────── */

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop());
if (isMain || process.argv.includes("--run")) {
  const result = audit();
  if (process.argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    const f = (v) => (v == null ? "  n/a " : Number(v).toFixed(4));
    const pad = (s, n) => String(s).padEnd(n);
    const padL = (s, n) => String(s).padStart(n);

    console.log("表 1 · 数据集 + 两组路由（before = pixelLikeness 单指标 / after = §12.2 分类器）");
    console.log([pad("id", 18), pad("group", 13), pad("expect", 17), pad("before", 13), pad("after", 13),
      pad("candidate", 13), padL("conf", 7)].join(" "));
    console.log("-".repeat(110));
    for (const r of result.dataset) {
      console.log([pad(r.id, 18), pad(r.group, 13), pad(r.expect, 17), pad(r.before, 13), pad(r.after, 13),
        pad(r.candidate ?? "-", 13), padL(Number(r.confidence).toFixed(3), 7)].join(" ")
        + (r.correctAfter ? "" : "   ← MISROUTE")
        + (!r.correctBefore && r.correctAfter ? "   [已修复]" : "")
        + (r.correctBefore && !r.correctAfter ? "   [**回归**]" : ""));
    }

    console.log("");
    console.log("表 2 · 旧特征区分度（§12.1 口径，range 小 = 几乎恒定）");
    console.log([pad("feature", 24), padL("min", 10), padL("max", 10), padL("range", 10), padL("mean", 10), padL("sd", 10), padL("cv", 8)].join(" "));
    for (const s of result.stats) {
      console.log([pad(s.name, 24), padL(f(s.min), 10), padL(f(s.max), 10), padL(f(s.range), 10),
        padL(f(s.mean), 10), padL(f(s.sd), 10), padL(f(s.cv), 8)].join(" "));
    }

    console.log("");
    console.log("表 3 · |r| ≥ 0.90 的旧特征对（冗余证据）");
    let shown = 0;
    for (const p of result.correlations) {
      if (Math.abs(p.r) < 0.9) continue;
      shown += 1;
      console.log(`  r = ${p.r >= 0 ? "+" : ""}${p.r.toFixed(4)}   ${p.a}  ⟷  ${p.b}`);
    }
    if (!shown) console.log("  （无）");

    console.log("");
    console.log("表 4 · 旧路由规则触发情况");
    for (const rule of result.rules) {
      console.log(`  ${pad(rule.id, 14)} → ${pad(rule.to, 14)} ${rule.reachable ? `命中 ${rule.hits.length}：${rule.hits.join(", ") || "（无）"}` : `**不可达**（无生产者：${rule.missingEvidence.join(",")}）`}`);
    }

    console.log("");
    console.log("表 5 · pixelLikeness 排序 vs 真像素画（反向信号的证据）");
    result.ranking.forEach((r, i) => {
      console.log(`  ${String(i + 1).padStart(2)}. ${pad(r.id, 18)} ${f(r.v)}  ${r.v >= result.summary.pixelThreshold ? "→ pixel" : "  (不触发)"}${r.isPixel ? "   ← 真像素画" : ""}`);
    });

    console.log("");
    console.log("表 6 · §12.2 新信号区分度（range 大 = 有区分度）");
    console.log([pad("signal", 26), padL("n", 4), padL("min", 10), padL("max", 10), padL("range", 10), padL("cv", 8)].join(" "));
    for (const s of result.signalStats) {
      if (s.missing) { console.log([pad(s.key, 26), padL(0, 4), "  全部为 null（无生产者）"].join(" ")); continue; }
      console.log([pad(s.key, 26), padL(s.n, 4), padL(f(s.min), 10), padL(f(s.max), 10), padL(f(s.range), 10), padL(f(s.cv), 8)].join(" "));
    }

    console.log("");
    console.log("表 7 · 误路由 before / after");
    console.log(`  before（旧单指标）：${result.misroutesBefore.length} / ${result.summary.total}`);
    for (const m of result.misroutesBefore) {
      console.log(`    ${pad(m.id, 18)} ${pad(m.group, 13)} expect=${pad(m.expect, 17)} got=${pad(m.before, 12)} pixelLikeness=${f(m.pixelLikeness)}`);
    }
    console.log(`  after（§12.2 分类器）：${result.misroutesAfter.length} / ${result.summary.total}`);
    for (const m of result.misroutesAfter) {
      console.log(`    ${pad(m.id, 18)} ${pad(m.group, 13)} expect=${pad(m.expect, 17)} got=${pad(m.after, 12)} conf=${Number(m.confidence).toFixed(3)} reason=${m.reason}`);
    }

    console.log("");
    console.log("摘要");
    for (const [k, v] of Object.entries(result.summary)) console.log(`  ${pad(k, 32)} ${v}`);
  }
}

export default { buildDataset, audit, isNativeResolution, EXPECT, STYLE_EXPECT };
