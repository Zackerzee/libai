#!/usr/bin/env node
/**
 * b4-lab.mjs — Stage B4 §6–§10 候选算法跑分器（§13 指标 + §14 contact sheet）。
 *
 * ── 它存在的唯一理由 ────────────────────────────────────────────────
 * §0 的实验流程是：实现独立候选 → 单测 → 跑固定 A–J benchmark → 输出 metrics diff
 * → 输出 contact sheet → **人工看图** → 给 KEEP / REJECT / MODE-SPECIFIC。
 * 这个工具负责中间那三步，并且**只负责那三步**：
 *   · 它不写任何决策。决策在报告里，由人给出。
 *   · 它不碰 `tests/fixtures/b4-bench/baseline.json`。基线是 §4/§5 冻结的，
 *     Lab 的产物一律写到 `--out` 目录。写基线的那条路径在本文件里**不存在**，
 *     不是靠纪律，是靠代码里没有这个分支。
 *
 * ── 指标为什么全部从「原图」而不是从「引擎中间量」算 ────────────────
 * §13 的 perceptualError / edgeRetention / detailRetention 如果引用
 * `diagnostics.protectionMap`，参照物就跟着候选一起变了 ——
 * 「候选 A 的保护图认为这里该保护、候选 B 的不认为」，两边各自算各自的分数，
 * 最后谁高谁低只是「谁更相信自己」。所以这些指标一律从
 * `downsampleSource()` 的**原图**导出，所有候选共用同一把尺子。
 *
 * ── 取景纪律 ────────────────────────────────────────────────────────
 * `beginner` 模式打开 subjectCrop，取景会变（§4/§5 已经量过：10 类里 8 类变）。
 * 取景一变，任何按归一化坐标做的区域对比都不再成立。所以：
 *   · 默认只跑 `auto`
 *   · 显式跑 `beginner` 时，该行标 `framingStable: false`，
 *     探针与指标**照常计算但不参与汇总**，避免它悄悄污染结论
 *
 * 用法：
 *   node tools/b4-lab.mjs --out <dir>
 *   node tools/b4-lab.mjs --class A,F --only bean-fit,neutral
 *   node tools/b4-lab.mjs --modes auto,beginner --skip-sheets
 *   node tools/b4-lab.mjs --fixtures noisy --class K,P    # §12 的 K–Q 真实照片夹具
 *   node tools/b4-lab.mjs --policy force-allow            # §12.4 反事实：绕过模式策略表
 *
 * ── §12.4 起：候选要在**路由之后的模式**上跑 ──────────────────────────
 * Bean Fit 的模式策略表要按「这张图实际会走哪个模式」决定跑不跑。
 * 路由结果由 `analyzeRoutingEvidence()` + `resolveRoutedMode()` 在**生成之前**算好，
 * 和 `runGenerationPipeline` 用的是同一份接线 —— 跑分器自己再拼一遍，
 * 就会出现「跑分器以为这是 photo、生成时其实是 pixel」这种看不出来的错。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";
import { renderGridPng, compositePanels, stackImages, cropGrid } from "./b4-sheet.mjs";
import { B4_BENCH_CLASSES } from "../tests/b4-bench-fixtures.mjs";
import { NOISY_PHOTO_CLASSES, buildNoisySource } from "../tests/noisy-photo-fixtures.mjs";
import {
  B4_BENCH_PINNED as PINNED,
  benchInputs,
  benchPalette,
  benchSize,
  downsampleSource,
  paletteHash,
  measureProbe,
  runBenchCase,
} from "../tests/b4-bench-runner.mjs";
import { LAB_MATRIX } from "../smart-preprocessing/lab/index.mjs";
import {
  NEUTRAL_CHROMA_THRESHOLD,
  EDGE_LUM_DELTA,
  DETAIL_DELTA,
  buildReference,
  measureGrid as measure,
} from "../services/quality-metrics.mjs";
import { analyzeRoutingEvidence } from "../services/generation-pipeline.mjs";
import { resolveRoutedMode } from "../services/mode-profile.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_DIR = path.join(ROOT, "tests/fixtures");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const OUT_DIR = path.resolve(value("--out", path.join(ROOT, ".b4-lab-out")));
const onlyClasses = (value("--class") || "").split(",").map((s) => s.trim()).filter(Boolean);
const onlyModes = (value("--modes") || "auto").split(",").map((s) => s.trim()).filter(Boolean);
const onlyCandidates = (value("--only") || "").split(",").map((s) => s.trim()).filter(Boolean);
const SKIP_SHEETS = flag("--skip-sheets");
const SHEET_CELL = Number(value("--sheet-cell", 4));
const ZOOM_CELL = Number(value("--zoom-cell", 12));
const ZOOM_PAD = Number(value("--zoom-pad", 2));
/**
 * §12.4 模式策略：
 *   table（默认）  按 `BEAN_FIT_MODE_POLICY` 查表。pixel / logo → OFF。
 *   force-allow    **反事实对照**：把所有模式强制成 allow，只留越界惩罚。
 *   force-pure     **改动前基线**：强制 allow 且关掉源色支持机制 = §6 原口径。
 *
 * 为什么需要 force-allow：默认策略下 A–J 全部落在 OFF 上，
 * `bean-fit` 列会与 `current` 逐位相同 —— 那是**正确的结论**，但它证明不了
 * 「越界惩罚本身有没有用」。两组都跑，才能把「策略关掉的」和「惩罚修掉的」
 * 分开记账，而不是拿一个数去替两件事背书。
 *
 * 为什么还需要 force-pure：§0 的裁定纪律要求**看图**。没有这一档，
 * 「越界增色」就只有数字上的「6 色 → 8 色」，出不了那张改动前的图。
 */
const POLICY = value("--policy", "table");
const POLICY_OVERRIDES = { table: null, "force-allow": "allow", "force-pure": "pure" };
if (!Object.hasOwn(POLICY_OVERRIDES, POLICY)) {
  console.error(`--policy 只认 ${Object.keys(POLICY_OVERRIDES).join(" / ")}，收到 ${POLICY}`);
  process.exit(2);
}
const POLICY_OVERRIDE = POLICY_OVERRIDES[POLICY];
/**
 * §12.4 夹具集：
 *   bench（默认）  A–J。§4/§5 冻结的固定 benchmark，**必须保持默认**。
 *   noisy         K–Q。§12 新增的真实照片 / 真实像素画夹具（512×512，逐像素生成）。
 *   all           两组都跑。
 *
 * 为什么需要 noisy：A–J 全部路由到 pixel / logo，而 §12.4 的模式策略把这两档
 * 设成 OFF —— 于是 A–J 上 `bean-fit` 列与 `current` 逐位相同。那是正确的结论，
 * 但它回答不了「Bean Fit 在**允许**的模式上到底有没有用」。
 * K–Q 里有 portrait / photo / illustration / auto 四种落点，才能量到那个问题。
 */
const FIXTURES = value("--fixtures", "bench");
if (!["bench", "noisy", "all"].includes(FIXTURES)) {
  console.error(`--fixtures 只认 bench / noisy / all，收到 ${FIXTURES}`);
  process.exit(2);
}

// 硬护栏：绝不往基线目录里写。写错一次就毁掉 §4/§5 的冻结基线，
// 而那份基线是判断所有候选有没有效的**唯一**参照物。
if (OUT_DIR.startsWith(BASELINE_DIR)) {
  console.error(`拒绝：--out 落在基线目录里（${BASELINE_DIR}）。Lab 产物必须写到别处。`);
  process.exit(2);
}

/* =========================================================
 * §13 指标 —— 实现已抽到 `services/quality-metrics.mjs`（唯一一把尺子）
 * ======================================================= */

// 抽出去的理由：§13 的 Auto Tune 选择器要**用同一批指标**做排序，
// 而它跑在生产里（`services/auto-tune.mjs`），拿不到 tools/ 下的代码。
// 两边各写一份，就会出现「跑分器说 edgeRetention 是 X、选择器按 Y 排序」——
// 谁都不算错，但结论已经没有意义了。
//
// 指标口径、参照物来源、为什么必须从原图导出，全部写在那个文件的头注释里。
// 这里只保留 `measure` 的别名，让下面的调用点一行都不用改。


const round2 = (v) => Math.round(v * 100) / 100;
const round3 = (v) => Math.round(v * 1000) / 1000;
const delta = (a, b) => (a == null || b == null ? null : round3(a - b));

/* =========================================================
 * 跑
 * ======================================================= */

const PALETTE = benchPalette();
const PALETTE_HASH = paletteHash(PALETTE);
const size = benchSize();
/**
 * 夹具清单。`source` 为 null 时走 `benchInputs()`（A–J 的逻辑网格 → 栅格化）；
 * K–Q 的源图逐像素生成，没有「逻辑网格」那一层，所以直接给源图。
 */
const allFixtures = [
  ...(FIXTURES === "noisy" ? [] : B4_BENCH_CLASSES.map((cls) => ({ cls, source: null }))),
  ...(FIXTURES === "bench" ? [] : NOISY_PHOTO_CLASSES.map((cls) => ({ cls, source: buildNoisySource(cls) }))),
];
const classes = allFixtures
  .filter(({ cls }) => !onlyClasses.length || onlyClasses.includes(cls.id));
const candidates = LAB_MATRIX.filter((e) => !onlyCandidates.length || onlyCandidates.includes(e.id));

fs.mkdirSync(OUT_DIR, { recursive: true });
const sheetDir = path.join(OUT_DIR, "sheet");
const zoomDir = path.join(OUT_DIR, "zoom");
const originalDir = path.join(OUT_DIR, "original");
if (!SKIP_SHEETS) for (const dir of [sheetDir, zoomDir, originalDir]) fs.mkdirSync(dir, { recursive: true });

console.log(`夹具 ${classes.length} 类（${FIXTURES}）· 模式 ${onlyModes.join("/")} · 候选 ${candidates.length} 个`);
console.log(`色卡 ${PINNED.paletteLabel}（${PALETTE.length} 色，hash ${PALETTE_HASH}）· 格网 ${size.width}×${size.height}`);
console.log(`§12.4 模式策略：${POLICY}${POLICY_OVERRIDE ? `（强制 ${POLICY_OVERRIDE}）` : ""}`);
console.log(`输出 → ${OUT_DIR}\n`);

const results = [];
const sheetImages = [];
const routingByClass = new Map();

for (const { cls, source: presetSource } of classes) {
  const inputs = presetSource ? { source: presetSource } : benchInputs(cls);
  // 路由证据只跟源图有关，与请求的模式无关 —— 每类算一次就够（classifySource 在 512² 上约 30ms）。
  const evidence = analyzeRoutingEvidence(inputs.source);
  const routed = {};
  for (const mode of onlyModes) routed[mode] = resolveRoutedMode(mode, evidence);
  routingByClass.set(cls.id, { candidate: evidence.routing?.candidate ?? null, confidence: evidence.routing?.confidence ?? null, routed });
  const originalGrid = downsampleSource(inputs.source, size.width, size.height);
  const reference = buildReference(originalGrid);
  if (!SKIP_SHEETS) {
    fs.writeFileSync(path.join(originalDir, `${cls.id}-${cls.key}.png`), renderGridPng(originalGrid));
  }
  console.log(`${cls.id} ${cls.key.padEnd(12)} 路由 → ${onlyModes.map((m) => `${m}=${routed[m]}`).join("  ")}`);

  const panels = [{ grid: originalGrid, label: "原图" }];
  const zoomPanels = new Map();
  for (const probe of cls.probes) zoomPanels.set(probe.id, [{ grid: cropGrid(originalGrid, probe.box, ZOOM_PAD), label: "原图" }]);

  for (const entry of candidates) {
    // `pending` 的候选**不许跑**。它的 `build()` 现在返回 null，
    // 跑出来会得到一张和 CURRENT 逐位相同的图 —— 然后被记成
    // 「Recommended-Hybrid 与基线一致」，那是一个凭空造出来的结论。
    // §15 明说裁定要等 §14 的人工看图，所以这里直接跳过，汇总表里明确标「未裁定」。
    if (entry.pending) continue;
    for (const mode of onlyModes) {
      const routedMode = routed[mode];
      let run;
      // 候选实例要留一个引用：`off` 档下 `matchCell` 第一行就返回 `undefined`，
      // 于是引擎的 `report.beanFit` **根本不会被创建** —— 那时
      // 「Bean Fit 这一列为什么和 CURRENT 一样」在 diagnostics 里查不到任何东西。
      // 策略得从**真正被传进去的那个实例**上读。
      const lab = entry.build({ mode: routedMode, policy: POLICY_OVERRIDE });
      const t0 = process.hrtime.bigint();
      try {
        run = runBenchCase(cls, mode, { inputs, palette: PALETTE, size, lab });
      } catch (error) {
        results.push({
          classId: cls.id, classKey: cls.key, mode, candidateId: entry.id, label: entry.label,
          error: `${error.name}: ${error.message}`,
        });
        console.log(`${cls.id} ${mode.padEnd(8)} ${entry.id.padEnd(24)} THROW ${error.message}`);
        continue;
      }
      const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
      const metrics = measure(run.grid, reference);
      const probes = {};
      for (const probe of cls.probes) probes[probe.id] = measureProbe(run.grid, probe);

      results.push({
        classId: cls.id,
        classKey: cls.key,
        mode,
        // §12.4：**这一行实际是按哪个模式跑的**。报告里「Bean Fit 为什么没生效」
        // 这个问题必须能靠数据回答，不能靠人回忆。
        routedMode,
        candidateId: entry.id,
        label: entry.label,
        gridHash: run.gridHash,
        framingStable: run.framingStable,
        subjectCropApplied: run.subjectCropApplied,
        labId: run.labId,
        labMatchFallbacks: run.labMatchFallbacks,
        // 策略从实例上读（`off` 档下报告里没有 beanFit 段），
        // 但把候选自报的那一份也留下 —— 两者不一致说明接线错了。
        labPolicy: lab?.policy?.policy ?? null,
        labSupportMode: lab?.policy?.supportMode ?? null,
        labPolicyReported: run.labDetail?.beanFit?.policy ?? null,
        labAbstained: run.labDetail?.beanFit?.abstained ?? null,
        labSupportRejected: run.labDetail?.beanFit?.supportRejected ?? null,
        labNeighbourhoodApplied: run.labDetail?.beanFit?.neighbourhoodApplied ?? null,
        runtimeMs: Math.round(elapsedMs),
        msPerCell: round3(elapsedMs / Math.max(1, metrics.totalCells)),
        ...metrics,
        probes,
        // 必须是 `run.labDetail`，不能写成 `run.diagnostics?.lab?.detail` ——
        // `runBenchCase` **不返回** diagnostics（基线三个字段的口径里没有它），
        // 所以后者恒为 undefined，metrics.json 里每个候选的诊断都会是 null。
        // 那个失效形状非常安静：跑分器照常出图，只是「候选清理了多少块」
        // 这种只能靠数字回答的问题永远答不了。
        labDetail: run.labDetail,
        maxColorsRespected: PINNED.maxColors === 0 ? true : metrics.usedColors <= PINNED.maxColors,
      });

      if (!SKIP_SHEETS) {
        panels.push({ grid: run.grid, label: entry.id });
        for (const probe of cls.probes) {
          zoomPanels.get(probe.id).push({ grid: cropGrid(run.grid, probe.box, ZOOM_PAD), label: entry.id });
        }
      }
      console.log(
        `${cls.id} ${mode.padEnd(8)} ${entry.id.padEnd(24)} `
        + `${String(metrics.usedColors).padStart(4)}色 空${String(metrics.nullCells).padStart(4)} `
        + `ΔE ${String(metrics.perceptualError).padStart(6)} `
        + `边${fmt(metrics.edgeRetention)} 细${fmt(metrics.detailRetention)} `
        + `碎${String(metrics.fragmentation).padStart(6)} 孤${String(metrics.isolatedPixels).padStart(5)} `
        + `${String(Math.round(elapsedMs)).padStart(5)}ms`,
      );
    }
  }

  if (!SKIP_SHEETS) {
    const perClass = compositePanels(panels, SHEET_CELL);
    if (perClass) fs.writeFileSync(path.join(sheetDir, `${cls.id}-${cls.key}.png`), encodePng(perClass));
    for (const probe of cls.probes) {
      const list = zoomPanels.get(probe.id);
      const img = compositePanels(list, ZOOM_CELL, 8);
      if (img) fs.writeFileSync(path.join(zoomDir, `${cls.id}-${cls.key}-${probe.id}.png`), encodePng(img));
    }
    sheetImages.push(perClass);
  }
}

if (!SKIP_SHEETS && sheetImages.length) {
  const overview = stackImages(sheetImages);
  if (overview) {
    const file = path.join(OUT_DIR, "contact-sheet-lab.png");
    fs.writeFileSync(file, encodePng(overview));
    // 列序清单。PNG 里没有文字标注（Node 侧没有可用的位图字体，
    // 为了画几个字母去引一个字体光栅化器不值得），所以列序必须落成文件 ——
    // 「第 7 列是哪个候选」如果只存在于跑分器的一次性输出里，看图的人无从复核。
    const columnIds = ["原图", ...candidates.filter((c) => !c.pending).map((c) => c.id)];
    const manifest = [
      "contact sheet 列序（从左到右）：",
      ...columnIds.map((id, i) => `  ${i}: ${id}`),
      "",
      "sheet/<类>.png     —— 每类一张，每格 " + SHEET_CELL + "px",
      "zoom/<类>-<探针>.png —— 探针框 + " + ZOOM_PAD + " 格边距，每格 " + ZOOM_CELL + "px，列序同上",
      "original/<类>.png  —— 原图列单独存一份",
      "",
      "模式：" + onlyModes.join(", ") + "（beginner 会开 subjectCrop，取景变化，该行不参与汇总）",
    ].join("\n");
    fs.writeFileSync(path.join(OUT_DIR, "sheet-columns.txt"), `${manifest}\n`);
    console.log(`\n总览 sheet（列：${columnIds.join(" / ")}）→ ${file}`);
    console.log(`列序清单 → ${path.join(OUT_DIR, "sheet-columns.txt")}`);
    console.log(`逐类 sheet（能看清 1 格）→ ${sheetDir}`);
    console.log(`局部放大（探针框 + ${ZOOM_PAD} 格边距，每格 ${ZOOM_CELL}px）→ ${zoomDir}`);
  }
}

/* =========================================================
 * metrics.json + 汇总表
 * ======================================================= */

const metricsFile = path.join(OUT_DIR, "metrics.json");
fs.writeFileSync(metricsFile, `${JSON.stringify({
  stage: "B4 §6–§10",
  pinned: PINNED,
  paletteHash: PALETTE_HASH,
  paletteSize: PALETTE.length,
  gridSize: { width: size.width, height: size.height },
  // §12.4：这一轮是「按模式策略表跑」还是「强制 allow 的反事实对照」。
  // 不记下来，两份 metrics.json 就没法区分，而它们的结论是相反的。
  policyMode: POLICY,
  policyOverride: POLICY_OVERRIDE,
  fixtures: FIXTURES,
  routing: [...routingByClass].map(([id, info]) => ({ classId: id, ...info })),
  reference: {
    neutralChromaThreshold: NEUTRAL_CHROMA_THRESHOLD,
    edgeLumDelta: EDGE_LUM_DELTA,
    detailDelta: DETAIL_DELTA,
    note: "全部指标从 downsampleSource 的原图导出，所有候选共用同一把尺子。",
  },
  candidates: candidates.map((c) => ({ id: c.id, label: c.label, pending: Boolean(c.pending) })),
  results,
}, null, 2)}\n`);

// 汇总：只统计取景稳定、且策略允许进汇总的行。
//   · 取景一变（beginner 的 subjectCrop），归一化坐标上的对比就不成立；
//   · §12.4 的 `experimental` 档（illustration）同理 —— 算法可以跑，
//     但它的结论还没有人工看图背书，混进平均等于让「未验证」冒充「已验证」。
const experimental = results.filter((r) => r.labPolicy === "experimental");
const stable = results.filter((r) => r.framingStable && !r.error && r.labPolicy !== "experimental");
const skipped = results.length - stable.length;

console.log(`\n汇总（仅取景稳定且非 experimental 的 ${stable.length} 行；`
  + `另有 ${skipped} 行被排除，其中 experimental ${experimental.length} 行）`);
console.log("候选".padEnd(26) + "策略".padStart(14) + "ΔE".padStart(8) + "中性ΔE".padStart(9) + "边保留".padStart(9)
  + "细保留".padStart(9) + "碎化".padStart(8) + "孤点".padStart(8) + "用色".padStart(8) + "ms".padStart(8));

const summary = [];
for (const entry of candidates) {
  const rows = stable.filter((r) => r.candidateId === entry.id);
  // 策略不是候选的属性而是「候选 × 模式」的，所以一列里可能混着多档。
  // 汇总时把它列成集合（如 `allow` 或 `cautious×2/off×8`），
  // 免得「这一列平均了两种策略」这件事被一个单一值盖住。
  const policyCounts = new Map();
  for (const r of results.filter((x) => x.candidateId === entry.id)) {
    const key = r.labPolicy ?? "-";
    policyCounts.set(key, (policyCounts.get(key) || 0) + 1);
  }
  const policyLabel = [...policyCounts].map(([k, n]) => (n > 1 ? `${k}×${n}` : k)).join("/");
  if (!rows.length) {
    summary.push({ candidateId: entry.id, label: entry.label, rows: 0, pending: Boolean(entry.pending), policy: policyLabel });
    console.log(
      entry.id.padEnd(26)
      + policyLabel.padStart(14)
      + (entry.pending ? " 尚未裁定（§15 等 §14 人工看图）" : " 无可用行"),
    );
    continue;
  }
  const agg = (key) => {
    const list = rows.map((r) => r[key]).filter((v) => v != null);
    return list.length ? list.reduce((a, b) => a + b, 0) / list.length : null;
  };
  const line = {
    candidateId: entry.id,
    label: entry.label,
    pending: Boolean(entry.pending),
    policy: policyLabel,
    rows: rows.length,
    perceptualError: round3(agg("perceptualError")),
    neutralError: round3(agg("neutralError")),
    edgeRetention: round3(agg("edgeRetention")),
    detailRetention: round3(agg("detailRetention")),
    fragmentation: round2(agg("fragmentation")),
    isolatedPixels: round2(agg("isolatedPixels")),
    usedColors: round2(agg("usedColors")),
    runtimeMs: round2(agg("runtimeMs")),
  };
  summary.push(line);
  console.log(
    entry.id.padEnd(26)
    + policyLabel.padStart(14)
    + String(line.perceptualError ?? "-").padStart(8)
    + String(line.neutralError ?? "-").padStart(9)
    + fmt(line.edgeRetention).padStart(9)
    + fmt(line.detailRetention).padStart(9)
    + String(line.fragmentation ?? "-").padStart(8)
    + String(line.isolatedPixels ?? "-").padStart(8)
    + String(line.usedColors ?? "-").padStart(8)
    + String(line.runtimeMs ?? "-").padStart(8),
  );
}

const summaryFile = path.join(OUT_DIR, "summary.json");
fs.writeFileSync(summaryFile, `${JSON.stringify({
  policyMode: POLICY, policyOverride: POLICY_OVERRIDE,
  stableRows: stable.length, excludedRows: skipped, experimentalRows: experimental.length, summary,
}, null, 2)}\n`);
console.log(`\n指标 → ${metricsFile}\n汇总 → ${summaryFile}`);
console.log(`\n§15 的 KEEP / REJECT / MODE-SPECIFIC **不在本工具里**：`);
console.log(`  必须看完 ${path.relative(ROOT, zoomDir)} 下的局部放大图之后，在报告里给出。`);

function fmt(v) {
  return v == null ? "-" : String(round3(v));
}
