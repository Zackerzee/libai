#!/usr/bin/env node
/**
 * b4-auto-tune.mjs — Stage B4 §13 的评测工具。
 *
 * ── 它回答的问题 ──────────────────────────────────────────────────────
 * §21 要求三方对比：
 *   STANDARD            —— 生产现状（模式表里那一套，不调优）
 *   AUTO-TUNE SELECTED  —— 选择器实际选出来的那一套
 *   ORACLE BEST         —— 离线跑完所有允许候选后，指标最优的那一套
 * 并给出 §22 的 `AutoTuneRegret = OracleBestQuality − SelectedQuality`。
 *
 * ── 为什么 oracle 要单独跑一遍 ────────────────────────────────────────
 * 「Auto Tune 比 Standard 好」这句话本身没有意义 —— 一个把所有候选都跑一遍
 * 再挑最好的选择器当然比 Standard 好。真正的问题是**它离最好的有多远**。
 * regret 大 = 选择器错了；regret 小 = 选择器在正确的候选集里挑对了。
 * 这是本工具唯一真正的产出，contact sheet 是给人复核它用的。
 *
 * ── 候选只跑一次 ──────────────────────────────────────────────────────
 * 每个 (夹具, 候选) 只执行一次，结果 memo 住。oracle 扫描先把 memo 填满，
 * 选择器随后命中 memo —— 于是「跑全部候选」和「跑选择器」不会把成本翻倍。
 * 这也意味着**本工具量不到预览预算早停**：预算的实测数字单独列在报告里。
 *
 * 用法：
 *   node tools/b4-auto-tune.mjs --out <dir>
 *   node tools/b4-auto-tune.mjs --dataset noisy --class K,L,M
 *   node tools/b4-auto-tune.mjs --target 300 --class A,K     # 预览≠目标的那条路径
 *   node tools/b4-auto-tune.mjs --skip-sheets
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";
import { renderGridPng, compositePanels, stackImages, cropGrid, compareGrids, diffGrids } from "./b4-sheet.mjs";
import { buildDataset } from "./b4-routing-audit.mjs";
import { benchPalette, downsampleSource } from "../tests/b4-bench-runner.mjs";
import { deriveGenerationSize } from "../services/generation-size.mjs";
import { runGenerationPipeline, analyzeRoutingEvidence } from "../services/generation-pipeline.mjs";
import { resolveRoutedMode } from "../services/mode-profile.mjs";
import { resolveCandidates, objectiveFor, standardProfileId, resolveCandidateRequest, MODE_OBJECTIVES } from "../services/auto-tune-profiles.mjs";
import {
  AUTO_TUNE_DEFAULTS,
  createAutoTuner,
  checkHardConstraints,
  oracleBest,
  selectProfile,
  computeRegret,
  summarizeRegret,
  classifyTuneFailure,
  previewSizeFor,
  previewMaxColors,
  nullMaskHash,
  fnv1a,
} from "../services/auto-tune.mjs";
import { referenceFor, measureGrid } from "../services/quality-metrics.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_DIR = path.join(ROOT, "tests/fixtures");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const OUT_DIR = path.resolve(value("--out", path.join(ROOT, ".b4-auto-tune-out")));
if (OUT_DIR.startsWith(BASELINE_DIR)) {
  console.error(`拒绝：--out 落在基线目录里（${BASELINE_DIR}）。`);
  process.exit(2);
}
const DATASET = value("--dataset", "all");
const TARGET_LONG_EDGE = Number(value("--target", 104));
const SKIP_SHEETS = flag("--skip-sheets");
/**
 * §7-C 的确定性取证：把每个夹具的 standard 候选**绕开 memo 重跑一次**，逐格哈希必须一致。
 * 生产里不做这件事（那会让生成成本翻倍），所以它只能在这里取证。
 * `--no-verify-determinism` 可以关掉（多花约 1 次生成 / 夹具）。
 */
const VERIFY_DETERMINISM = !flag("--no-verify-determinism");
const ONLY_CLASSES = (value("--class") || "").split(",").map((s) => s.trim()).filter(Boolean);
const SHEET_CELL = Number(value("--sheet-cell", 4));
/**
 * 逐列另存（§24 可复核性）。
 *
 * 四列拼成一条时总宽 = 4 × (格数 × 每格像素)，默认档下一张 104 格的图就有
 * ~1664px，任何看图工具都会缩到看不清 —— 而 §24 要人做的恰恰是逐列比对。
 * `--split-columns` 把每列单独写进 `<out>/columns/<id>--<序>-<列名>.png`。
 * `--split-cell` 控制每格像素（默认 6，104 格 → 624px，正好一眼看清）。
 */
const SPLIT_COLUMNS = flag("--split-columns");
const SPLIT_CELL = Number(value("--split-cell", 6));
/**
 * 差异图（§30-4「关键夹具无视觉退化」的取证手段）。
 *
 * 并排看 Standard 与 Selected 是证明不了任何事的：改档常常只动几十格，
 * 104×104 里 0.2% 的差异肉眼就是「一模一样」。`--diff` 以 Standard 为底、
 * 把不同的格涂成品红，逐格计数一并打进报告 —— 于是「没退化」从一句
 * 主观判断变成「改变 N 格，其中凭空多/少 M 格」的可复核数字。
 */
const DIFF_COLUMNS = flag("--diff");
const PREVIEW_LONG_EDGE = Number(value("--preview", AUTO_TUNE_DEFAULTS.previewLongEdge));

const PALETTE = benchPalette();

/* =========================================================
 * 数据集
 * ======================================================= */

function datasetRows() {
  const rows = buildDataset();
  return rows.filter((row) => {
    if (ONLY_CLASSES.length && !ONLY_CLASSES.includes(row.id)) return false;
    if (DATASET === "all") return true;
    if (DATASET === "bench") return row.group === "bench";
    if (DATASET === "noisy") return row.group === "noisy-photo";
    if (DATASET === "real") return row.group === "real-failure";
    return true;
  });
}

/**
 * 该夹具「应该」落到哪个引擎模式。
 *
 * ⚠️ **A–J 返回 `null`（= 不指定唯一答案）**，这是 §12.1 的结论：
 * 它们全部是 64 逻辑 → 512 的 ×8 最近邻放大，块内逐位恒等，**风格上就是像素画**；
 * 内容却分别是人像 / 动漫 / 插画 / Logo。同一张 E 有「按风格 = pixel」和
 * 「按内容 = logo」两个都成立的答案，拿其中一个去判另一个是错的。
 * 所以 A–J 不参与 routing-error 统计 —— 否则会得到 14 条假路由错误，
 * 把真正要看的那一条（rf-complex）淹掉。
 */
function referenceMode(row) {
  if (row.group === "bench") return null;
  const e = row.expect;
  if (e === "photo-or-general") return "photo";
  if (e === "general") return "auto";
  if (e === "not-pixel") return null;   // 只要求「不是 pixel」，不指定唯一答案
  return e;
}

const gridHash = (grid) => fnv1a(grid.map((r) => r.map((c) => (c ? c.code : "-")).join(",")).join(";"));

/* =========================================================
 * 跑一个夹具
 * ======================================================= */

async function runFixture(row) {
  const source = row.source;
  const ratio = source.height / source.width;
  const target = deriveGenerationSize(TARGET_LONG_EDGE, ratio);
  if (!target) throw new Error(`尺寸派生失败：${row.id}`);

  const evidence = analyzeRoutingEvidence(source);
  const routedMode = resolveRoutedMode("auto", evidence);
  const previewSize = previewSizeFor(target, PREVIEW_LONG_EDGE);
  const previewCap = previewMaxColors(0, previewSize, target);
  const reference = referenceFor(source, previewSize.width, previewSize.height);

  // ── 每个候选只跑一次 ────────────────────────────────────────────────
  const memo = new Map();
  const runCandidate = async ({ size, overrides, labCandidate }) => {
    const key = `${size.width}x${size.height}|${labCandidate ?? "-"}|${JSON.stringify(overrides)}`;
    if (memo.has(key)) return memo.get(key);
    const t0 = process.hrtime.bigint();
    const result = runGenerationPipeline({
      image: source,
      mode: "auto",
      size,
      palette: PALETTE,
      maxColors: previewCap,
      overrides: labCandidate ? { ...overrides, labCandidate } : overrides,
    });
    const timingMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const entry = {
      grid: result.grid,
      width: result.width,
      height: result.height,
      timingMs,
      diagnostics: result.diagnostics,
      pipeline: result.pipeline,
    };
    memo.set(key, entry);
    return entry;
  };

  // ── 1. 全候选扫描（oracle 的依据）──────────────────────────────────
  const candidates = resolveCandidates(routedMode);
  const sweep = [];
  for (const candidate of candidates) {
    const request = resolveCandidateRequest(candidate);
    const result = await runCandidate({
      size: previewSize,
      overrides: request.overrides,
      labCandidate: request.labCandidate,
    });
    const metrics = measureGrid(result.grid, reference);
    sweep.push({
      profileId: candidate.id,
      label: candidate.label,
      metrics,
      runtimeMs: Math.round(result.timingMs),
      nullMaskHash: nullMaskHash(result.grid),
      grid: result.grid,
      gridHash: gridHash(result.grid),
      labId: result.pipeline?.labId ?? null,
    });
  }

  const standardId = standardProfileId(routedMode);
  const standard = sweep.find((e) => e.profileId === standardId) || sweep[0];

  // ── 2. 硬约束（§7）────────────────────────────────────────────────
  // 必须在选 oracle **之前**跑：一个把 maxColors 顶爆、或把细节打掉一半的候选
  // 不可能是「最优输出」。否则 regret 会把「选择器正确地拒绝了违规候选」
  // 记成「选择器选错了」—— 一个方向完全反了的指标。
  const ctx = {
    limits: AUTO_TUNE_DEFAULTS,
    standard,
    effectiveMaxColors: 0,
    determinismVerified: VERIFY_DETERMINISM ? true : null,
  };
  const entries = sweep.map((row) => {
    const entry = {
      profileId: row.profileId,
      label: row.label,
      metrics: row.metrics,
      runtimeMs: row.runtimeMs,
      nullMaskHash: row.nullMaskHash,
      accepted: true,
      rejectReason: null,
      violations: [],
    };
    const check = checkHardConstraints(entry, ctx);
    entry.accepted = check.ok;
    entry.violations = check.violations;
    entry.rejectReason = check.ok ? null : check.violations.map((v) => v.id).join("+");
    return entry;
  });

  // ── 3. 确定性取证（§7-C）──────────────────────────────────────────
  // 生产里不做重复生成（那会让成本翻倍），所以 §13 在这里替它取证：
  // 把赢家候选**绕开 memo 重跑一次**，逐格哈希必须一致。
  let determinism = { verified: null, match: null };
  if (VERIFY_DETERMINISM) {
    const winnerId = standardId;
    const winnerRow = sweep.find((e) => e.profileId === winnerId);
    const rerun = await runGenerationPipeline({
      image: source, mode: "auto", size: previewSize, palette: PALETTE, maxColors: previewCap,
      overrides: resolveCandidateRequest(candidates.find((c) => c.id === winnerId)).overrides,
    });
    determinism = { verified: true, match: gridHash(rerun.grid) === winnerRow.gridHash };
  }

  const oracle = oracleBest(entries, routedMode);
  const unbounded = selectProfile({ entries, routedMode });
  const oracleRegret = computeRegret(oracle, standard, objectiveFor(routedMode));
  const selectedRow = sweep.find((e) => e.profileId === unbounded.selectedProfileId) || standard;
  const selectedEntry = entries.find((e) => e.profileId === unbounded.selectedProfileId) || entries[0];
  const regret = computeRegret(oracle, selectedEntry, objectiveFor(routedMode));

  // ── 4. 走真正的调优器（含生产闸门的那一份）──────────────────────────
  const tuner = createAutoTuner({ runCandidate, limits: { previewLongEdge: PREVIEW_LONG_EDGE } });
  const tuneReport = await tuner.tune({
    source, mode: "auto", size: target, palette: PALETTE, maxColors: 0, requestId: 1,
  });
  const productionTuner = createAutoTuner({
    runCandidate,
    limits: { previewLongEdge: PREVIEW_LONG_EDGE, productionOnly: true },
  });
  const productionReport = await productionTuner.tune({
    source, mode: "auto", size: target, palette: PALETTE, maxColors: 0, requestId: 2,
  });
  const productionRow = sweep.find((e) => e.profileId === productionReport.selectedProfileId) || standard;
  const productionRegret = computeRegret(oracle, productionRow, objectiveFor(routedMode));

  const failureCtx = {
    candidates: entries.map((e) => ({ profileId: e.profileId, rejectReason: e.rejectReason })),
    routedMode,
    expectedMode: referenceMode(row),
    selectedProfileId: unbounded.selectedProfileId,
    oracleProfileId: oracle?.profileId ?? null,
    standardProfileId: standardId,
  };
  const failure = classifyTuneFailure(failureCtx);
  // 选择层面的诊断：把路由那一层摘掉再判一次。路由错了的时候，
  // 只说「routing-error」会掩盖「候选集里的排序对不对」这个独立的问题。
  const selectionFailure = classifyTuneFailure({ ...failureCtx, expectedMode: null, routedMode: "auto" });

  return {
    id: row.id,
    group: row.group,
    label: row.label,
    routedMode,
    expectedMode: referenceMode(row),
    target: { width: target.width, height: target.height },
    preview: { width: previewSize.width, height: previewSize.height },
    previewReused: tuneReport.reusedPreview === true,
    determinism,
    candidates: entries.map((e) => {
      const row2 = sweep.find((s) => s.profileId === e.profileId);
      return {
        profileId: e.profileId,
        label: e.label,
        labId: row2?.labId ?? null,
        runtimeMs: e.runtimeMs,
        metrics: e.metrics,
        accepted: e.accepted,
        rejectReason: e.rejectReason,
        violations: e.violations,
      };
    }),
    standardProfileId: standardId,
    selectedProfileId: unbounded.selectedProfileId,
    selectedReason: unbounded.reason,
    selectedDecision: unbounded.decision,
    oracleProfileId: oracle?.profileId ?? null,
    tunerSelectedProfileId: tuneReport.selectedProfileId,
    tunerDecision: tuneReport.decision,
    productionSelectedProfileId: productionReport.selectedProfileId,
    productionDecision: productionReport.decision,
    productionReason: productionReport.reason,
    productionRegret,
    regret,
    standardVsOracleRegret: oracleRegret,
    failure,
    selectionFailure,
    previewCostMs: sweep.reduce((sum, e) => sum + e.runtimeMs, 0),
    objective: objectiveFor(routedMode).map((c) => c.metric),
    grids: {
      original: downsampleSource(source, previewSize.width, previewSize.height),
      standard: standard.grid,
      selected: selectedRow.grid,
      /**
       * 生产档实际选出来的那一套的输出。
       *
       * 与 `selected` 分开存是必要的：§21 的 `selected` 是**评测口径**
       * （候选集含 lab 候选），`production` 是**上线口径**（只含 ModeProfile）。
       * §30-4 要判的「关键夹具无视觉退化」问的是**上线那一个**，
       * 拿 `selected` 去替它会把「Bean Fit 看着不错」当成「上线改动安全」。
       */
      production: productionRow.grid,
      oracle: oracle ? (sweep.find((s) => s.profileId === oracle.profileId) || {}).grid ?? null : null,
    },
  };
}

/* =========================================================
 * 主流程
 * ======================================================= */

const rows = datasetRows();
fs.mkdirSync(OUT_DIR, { recursive: true });
const sheetDir = path.join(OUT_DIR, "sheet");
if (!SKIP_SHEETS) fs.mkdirSync(sheetDir, { recursive: true });

const results = [];
const sheets = [];
/** 每个夹具「Selected 相对 Standard」的逐格差异（§30-4 的证据）。 */
const diffStats = [];

for (const row of rows) {
  const t0 = Date.now();
  try {
    const result = await runFixture(row);
    results.push(result);
    const elapsed = Date.now() - t0;
    const mark = result.failure.class ? `!${result.failure.class}` : "ok";
    console.log(
      `${row.id.padEnd(22)} route=${String(result.routedMode).padEnd(12)} `
      + `oracle=${String(result.oracleProfileId).padEnd(24)} selected=${String(result.selectedProfileId).padEnd(24)} `
      + `prod=${String(result.productionSelectedProfileId).padEnd(22)} `
      + `regret=${String(result.regret.epsilonUnits).padStart(6)} ${mark.padEnd(16)} ${elapsed}ms`,
    );
    if (!SKIP_SHEETS) {
      const panels = [
        { grid: result.grids.original, label: "original" },
        { grid: result.grids.standard, label: "standard" },
        { grid: result.grids.selected, label: "selected" },
        ...(result.grids.oracle ? [{ grid: result.grids.oracle, label: "oracle" }] : []),
      ];
      const composed = compositePanels(panels.map((p) => ({ grid: p.grid })), SHEET_CELL);
      if (composed) {
        const file = path.join(sheetDir, `${row.id}.png`);
        fs.writeFileSync(file, encodePng(composed));
        sheets.push({ id: row.id, png: renderGridPng(result.grids.selected, 1), width: composed.width, height: composed.height });
      }
      // ── 逐列另存（§24 的可复核性）─────────────────────────────────────
      // 四列拼成一条时总宽是 4 × (格数 × 每格像素)，默认 SHEET_CELL 下
      // 一张 104 格的图就有 4×416 ≈ 1664px —— 任何看图工具都会缩到看不清。
      // 而 §24 要人做的恰恰是「逐列比对」。所以每列单独出一张，
      // 文件名带列序，一眼知道哪张是哪一列。
      if (SPLIT_COLUMNS) {
        const splitDir = path.join(OUT_DIR, "columns");
        fs.mkdirSync(splitDir, { recursive: true });
        // 逐列目录比 §24 的拼图多一列：**生产档**。
        // §24 的 contact sheet 固定四列（原图/Standard/Selected/Oracle），
        // 但「线上到底出哪张图」是 Selected 之外的另一套选择，
        // 复核时缺了它就只能靠 profile 名字想象 —— 那正是最容易看错的地方。
        const splitPanels = result.grids.production
          ? [...panels, { grid: result.grids.production, label: "production" }]
          : panels;
        for (let i = 0; i < splitPanels.length; i += 1) {
          // renderGridPng 返回的**已经是 PNG 字节**（它内部调了 encodePng）。
          // 早先这里又套了一层 encodePng，报的是
          // 「Cannot read properties of undefined (reading 'length')」——
          // 因为 encodePng 拿到 Buffer 后去读 img.data。
          fs.writeFileSync(
            path.join(splitDir, `${row.id}--${i + 1}-${splitPanels[i].label}.png`),
            renderGridPng(splitPanels[i].grid, SPLIT_CELL),
          );
        }
      }
      // ── 差异图（§30-4）───────────────────────────────────────────────
      if (DIFF_COLUMNS) {
        // 两张差异图，因为「与 Standard 不同」有两个口径，混在一起会读错：
        //   · production-vs-standard —— **上线改动**。§30-4 判的就是它。
        //   · selected-vs-standard   —— 评测口径（候选集含 lab 候选），
        //     用来解释「为什么 oracle 命中率是 96% 而线上只改了 1 个夹具」。
        const targets = [
          ["production-vs-standard", result.grids.production],
          ["selected-vs-standard", result.grids.selected],
        ];
        for (const [tag, other] of targets) {
          if (!other) continue;
          const cmp = compareGrids(result.grids.standard, other);
          diffStats.push({ id: row.id, tag, ...cmp, sameAsStandard: cmp.changed === 0 });
          const diffDir = path.join(OUT_DIR, "diff");
          fs.mkdirSync(diffDir, { recursive: true });
          // 逐格一致的夹具也写图（整幅干净 = 视觉上「没有变化」的直接证据）。
          fs.writeFileSync(
            path.join(diffDir, `${row.id}--${tag}.png`),
            renderGridPng(diffGrids(result.grids.standard, other), SPLIT_CELL),
          );
        }
      }
    }
  } catch (error) {
    console.error(`${row.id} 失败：${error?.stack || error}`);
    results.push({ id: row.id, group: row.group, error: String(error?.message || error) });
  }
}

/* ── 汇总 ─────────────────────────────────────────────────────────── */

const usable = results.filter((r) => !r.error);
const byGroup = {};
for (const r of usable) {
  byGroup[r.group] = byGroup[r.group] || { n: 0, oracleHit: 0, standardIsOracle: 0, changedVsStandard: 0, productionChanged: 0, productionHit: 0 };
  const g = byGroup[r.group];
  g.n += 1;
  if (r.selectedProfileId === r.oracleProfileId) g.oracleHit += 1;
  if (r.oracleProfileId === r.standardProfileId) g.standardIsOracle += 1;
  if (r.selectedProfileId !== r.standardProfileId) g.changedVsStandard += 1;
  if (r.productionSelectedProfileId !== r.standardProfileId) g.productionChanged += 1;
  if (r.productionSelectedProfileId === r.oracleProfileId) g.productionHit += 1;
}

const regretAll = summarizeRegret(usable.map((r) => r.regret));
const regretByGroup = Object.fromEntries(
  Object.entries(byGroup).map(([group]) => [
    group,
    summarizeRegret(usable.filter((r) => r.group === group).map((r) => r.regret)),
  ]),
);
const productionRegretAll = summarizeRegret(usable.map((r) => r.productionRegret));
const standardVsOracleAll = summarizeRegret(usable.map((r) => r.standardVsOracleRegret));

const failureCounts = {};
const selectionFailureCounts = {};
for (const r of usable) {
  const key = r.failure.class || "none";
  failureCounts[key] = (failureCounts[key] || 0) + 1;
  const skey = r.selectionFailure.class || "none";
  selectionFailureCounts[skey] = (selectionFailureCounts[skey] || 0) + 1;
}

const previewCosts = usable.map((r) => r.previewCostMs).sort((a, b) => a - b);
const percentile = (arr, p) => (arr.length ? arr[Math.min(arr.length - 1, Math.floor(p * arr.length))] : null);

const determinism = {
  checked: usable.filter((r) => r.determinism?.verified).length,
  match: usable.filter((r) => r.determinism?.match === true).length,
  mismatch: usable.filter((r) => r.determinism?.verified && r.determinism.match === false).map((r) => r.id),
};

const summary = {
  stage: "B4 §13 AUTO TUNE",
  target: TARGET_LONG_EDGE,
  previewLongEdge: PREVIEW_LONG_EDGE,
  paletteSize: PALETTE.length,
  fixtures: usable.length,
  byGroup,
  regret: regretAll,
  regretByGroup,
  productionRegret: productionRegretAll,
  standardVsOracle: standardVsOracleAll,
  failureCounts,
  selectionFailureCounts,
  determinism,
  preview: {
    medianMs: percentile(previewCosts, 0.5),
    p95Ms: percentile(previewCosts, 0.95),
    maxMs: previewCosts[previewCosts.length - 1] ?? null,
    budgetMs: AUTO_TUNE_DEFAULTS.previewBudgetMs,
    overBudget: previewCosts.filter((c) => c > AUTO_TUNE_DEFAULTS.previewBudgetMs).length,
  },
  beanFitSelection: {
    portrait: usable.filter((r) => r.routedMode === "portrait" && /bean-fit/.test(r.selectedProfileId || "")).length,
    photo: usable.filter((r) => r.routedMode === "photo" && /bean-fit/.test(r.selectedProfileId || "")).length,
    illustration: usable.filter((r) => r.routedMode === "illustration" && /bean-fit/.test(r.selectedProfileId || "")).length,
    pixel: usable.filter((r) => r.routedMode === "pixel" && /bean-fit/.test(r.selectedProfileId || "")).length,
    logo: usable.filter((r) => r.routedMode === "logo" && /bean-fit/.test(r.selectedProfileId || "")).length,
  },
  beanFitProduction: usable.filter((r) => /bean-fit/.test(r.productionSelectedProfileId || "")).length,
  production: {
    changedVsStandard: usable.filter((r) => r.productionSelectedProfileId !== r.standardProfileId).length,
    decisions: usable.reduce((acc, r) => {
      acc[r.productionDecision] = (acc[r.productionDecision] || 0) + 1;
      return acc;
    }, {}),
  },
  objectives: MODE_OBJECTIVES,
};

fs.writeFileSync(path.join(OUT_DIR, "metrics.json"), JSON.stringify({
  stage: summary.stage,
  target: TARGET_LONG_EDGE,
  previewLongEdge: PREVIEW_LONG_EDGE,
  paletteHash: PALETTE.length,
  results: results.map((r) => ({ ...r, grids: undefined })),
}, null, 2));
fs.writeFileSync(path.join(OUT_DIR, "summary.json"), JSON.stringify(summary, null, 2));

/* ── §24 contact sheet 索引（带标注）────────────────────────────────
 *
 * 为什么要有这一页：`sheet/<id>.png` 里只有四张图，**没有文字**。
 * §24 要求标注 routedMode / selectedProfile / oracleProfile / reason ——
 * 光看图，「第 3 列是 Selected 还是 Oracle」只能靠记忆，而这两个在
 * 视觉上恰恰常常几乎一样（那正是「选对了」的定义）。
 * 所以标注必须和图片在一起，否则人工复核这一步等于没有。
 *
 * 只用相对路径 `sheet/<id>.png`，整目录可以整体搬走。
 * ------------------------------------------------------------------- */
if (!SKIP_SHEETS && sheets.length) {
  const esc = (v) => String(v ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const num = (v) => (v == null ? "—" : String(v));
  const diffById = new Map(diffStats.map((d) => [`${d.id}|${d.tag}`, d]));
  const diffBlock = (id, tag, otherName, cls) => {
    const d = diffById.get(`${id}|${tag}`);
    if (!d) return "";
    if (d.sameAsStandard) {
      return `\n  <p class="cap same">与 Standard <b>逐格一致</b>（${d.total} 格全同）—— 这一档没有输出变化。</p>`;
    }
    return `\n  <p class="cap ${cls}">${otherName} 与 Standard 差 <b>${d.changed}</b> 格 / 有效 ${d.filled} 格`
      + `（${((d.changed / Math.max(1, d.filled)) * 100).toFixed(2)}%）`
      + ` · 仅 Standard 有豆 <b>${d.baseOnly}</b> · 仅 ${otherName} 有豆 <b>${d.otherOnly}</b>${
        d.baseOnly + d.otherOnly === 0 ? "（纯换色，无结构增减）" : " <em>← 有结构增减，必须看图</em>"}</p>`
      + `\n  <img class="diff" src="diff/${esc(id)}--${esc(tag)}.png" alt="${esc(id)} 的差异图：品红 = 与 Standard 不同的格" />`;
  };
  const rowsHtml = usable.map((r) => {
    const oracleIsStandard = r.oracleProfileId === r.standardProfileId;
    const selectedIsOracle = r.selectedProfileId === r.oracleProfileId;
    const prodChanged = r.productionSelectedProfileId !== r.standardProfileId;
    const cand = (r.candidates || []).map((c) => {
      const m = c.metrics;
      return `<tr><td>${esc(c.profileId)}</td><td>${c.labId ? esc(c.labId) : "—"}</td>`
        + `<td>${c.accepted ? "✓" : "✗"}</td><td>${esc(c.rejectReason || "")}</td>`
        + `<td>${m ? `${num(m.perceptualError)} / ${num(m.edgeRetention)} / ${num(m.fragmentation)}` : "—"}</td>`
        + `<td>${m ? num(m.usedColors) : "—"}</td><td>${num(c.runtimeMs)}</td></tr>`;
    }).join("");
    return `<section class="fx${selectedIsOracle ? "" : " regret"}">
  <h2>${esc(r.id)} <small>${esc(r.group)} · ${esc(r.label || "")}</small></h2>
  <p class="meta">
    <b>routedMode</b> ${esc(r.routedMode)} · <b>selected</b> ${esc(r.selectedProfileId)}
    · <b>oracle</b> ${esc(r.oracleProfileId)}${oracleIsStandard ? "（= Standard，即「不调优」就是最优）" : ""}
    · <b>生产档</b> ${esc(r.productionSelectedProfileId)}${prodChanged ? " <em>（与 Standard 不同）</em>" : ""}
    · <b>regret</b> ${num(r.regret?.epsilonUnits)} epsilon @ ${esc(r.regret?.worstMetric || "—")}
    · <b>失败分类</b> ${esc(r.failure?.class || "none")}
    · <b>预览耗时</b> ${num(r.previewCostMs)}ms
  </p>
  <p class="reason"><b>选择理由</b> ${esc(r.selectedReason || "—")}</p>
  <p class="reason"><b>生产理由</b> ${esc(r.productionReason || "—")}</p>
  <img src="sheet/${esc(r.id)}.png" alt="${esc(r.id)} 的 原图 / Standard / AutoTune Selected / Oracle Best" />
  <p class="cap">列序：① 原图（降采样） ② Standard ③ AutoTune Selected ④ Oracle Best${
    r.grids?.oracle ? "" : "（本图无 oracle，只有三列）"}</p>${diffBlock(r.id, "production-vs-standard", esc(r.productionSelectedProfileId || "生产档"), "changed")}${diffBlock(r.id, "selected-vs-standard", "评测档", "cap")}
  <p class="cap">差异图：品红 = 与 Standard 不同的格，其余原样。凭空多/少豆（视觉退化）看上面两个计数。</p>
  <details><summary>候选明细（${(r.candidates || []).length} 个）</summary>
  <table><thead><tr><th>profile</th><th>lab</th><th>accepted</th><th>rejectReason</th>
  <th>ΔE / edge / frag</th><th>用色</th><th>ms</th></tr></thead><tbody>${cand}</tbody></table></details>
</section>`;
  }).join("\n");

  const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8" />
<title>B4 §13 Auto Tune — §24 Contact Sheet</title>
<style>
  :root { color-scheme: light; }
  body { margin: 0; padding: 28px; background: #f6f7f9; color: #1b1d21;
         font: 14px/1.6 -apple-system, "PingFang SC", "Noto Sans SC", sans-serif; }
  h1 { font-size: 20px; margin: 0 0 6px; }
  .lead { color: #55595f; margin: 0 0 24px; max-width: 900px; }
  .lead code { background: #e9ebef; padding: 1px 5px; border-radius: 4px; }
  .fx { background: #fff; border: 1px solid #e2e5ea; border-radius: 10px;
        padding: 16px 18px; margin: 0 0 18px; }
  .fx.regret { border-left: 4px solid #c0392b; }
  .fx h2 { font-size: 15px; margin: 0 0 8px; }
  .fx h2 small { font-weight: 400; color: #7a7f87; margin-left: 6px; }
  .meta, .reason, .cap { margin: 0 0 6px; font-size: 12.5px; color: #3c4046; }
  .meta b { color: #1b1d21; }
  .reason { color: #5a5f66; }
  .cap { color: #7a7f87; }
  .cap.same { color: #2e7d32; }
  .cap.changed { color: #b00020; }
  .cap.same b, .cap.changed b { color: inherit; }
  img.diff { max-width: 620px; }
  em { color: #c0392b; font-style: normal; font-weight: 600; }
  img { display: block; width: 100%; max-width: 980px; margin: 10px 0 6px;
        image-rendering: pixelated; border: 1px solid #e2e5ea; border-radius: 6px; }
  details { margin-top: 8px; }
  summary { cursor: pointer; font-size: 12.5px; color: #4a5058; }
  table { border-collapse: collapse; font-size: 12px; margin-top: 8px; }
  th, td { border: 1px solid #e2e5ea; padding: 3px 8px; text-align: left; }
  th { background: #f2f4f7; font-weight: 600; }
</style></head><body>
<h1>B4 §13 Auto Tune — §24 Contact Sheet</h1>
<p class="lead">
  每个夹具四列：<b>原图</b> / <b>Standard</b> / <b>AutoTune Selected</b> / <b>Oracle Best</b>，
  标注 routedMode / selectedProfile / oracleProfile / reason。
  目标长边 ${TARGET_LONG_EDGE}，预览长边 ${PREVIEW_LONG_EDGE}。
  左侧有红边的表示 <code>selected ≠ oracle</code>（有 regret），需要人工看一眼是否可接受。<br />
  每个夹具下方另附 <b>差异图</b>：品红 = AutoTune Selected 与 Standard 不同的格。
  §30-4 要判断的「关键夹具无视觉退化」看的是它 —— 并排看两张图是看不出 0.2% 的改动的，
  差异图把「变了几格、变在哪、是换色还是凭空多/少豆」变成可复核的事实。
</p>
${rowsHtml}
</body></html>`;
  fs.writeFileSync(path.join(OUT_DIR, "index.html"), html);
  console.log(`\n§24 contact sheet 索引：${path.join(OUT_DIR, "index.html")}（${usable.length} 个夹具）`);
}

/* ── 打印 ─────────────────────────────────────────────────────────── */

const pct = (v) => (v == null ? "  -  " : `${(v * 100).toFixed(1)}%`);
console.log("\n=== Oracle / Regret ===");
console.log(`夹具数 ${usable.length}`);
console.log(`Oracle 命中率        ${pct(summary.regret.hitRate)}  （质量无损失：regret = 0）`);
console.log(`  其中精确同款       ${pct(usable.length ? usable.filter((r) => r.selectedProfileId === r.oracleProfileId).length / usable.length : null)}`
  + `  (${usable.filter((r) => r.selectedProfileId === r.oracleProfileId).length}/${usable.length})`
  + `  ← 选了另一套 Profile 但质量一样的，不算未命中（§22 量的是质量差，不是名字）`);
console.log(`生产档命中率         ${pct(productionRegretAll.hitRate)}  (lab 候选被生产闸门挡掉后的口径)`);
console.log(`Oracle 就是 Standard ${pct(usable.length ? usable.filter((r) => r.oracleProfileId === r.standardProfileId).length / usable.length : null)}  → 这些图上「不调优」就是最优`);
console.log(`平均 regret          ${summary.regret.meanEpsilonUnits} epsilon`);
console.log(`最差 regret          ${summary.regret.worstEpsilonUnits} epsilon @ ${summary.regret.worstMetric}`);
console.log(`平均差几层           ${summary.regret.meanLevelsApart}`);
console.log(`Standard vs Oracle   平均 ${standardVsOracleAll.meanEpsilonUnits} epsilon / 命中 ${pct(standardVsOracleAll.hitRate)}（不调优离 oracle 有多远）`);
for (const [group, s] of Object.entries(regretByGroup)) {
  console.log(`  ${group.padEnd(14)} n=${String(s.n).padStart(2)} hit=${pct(s.hitRate)} mean=${s.meanEpsilonUnits} worst=${s.worstEpsilonUnits}`);
}
console.log("\n=== 失败分类（§25）===");
console.log("  主分类（含路由）：");
for (const [k, v] of Object.entries(failureCounts)) console.log(`    ${k.padEnd(18)} ${v}`);
console.log("  选择层（摘掉路由）：");
for (const [k, v] of Object.entries(selectionFailureCounts)) console.log(`    ${k.padEnd(18)} ${v}`);
console.log("\n=== 确定性（§7-C）===");
console.log(`  已取证 ${determinism.checked} / 一致 ${determinism.match}${determinism.mismatch.length ? ` / 不一致 ${determinism.mismatch.join(",")}` : ""}`);
console.log("\n=== Bean Fit 被选中次数 ===");
console.log("  全候选（oracle 口径）：");
for (const [k, v] of Object.entries(summary.beanFitSelection)) console.log(`    ${k.padEnd(14)} ${v}`);
console.log(`  生产档（PRODUCTION_LAB_CANDIDATES 过滤后）： ${summary.beanFitProduction}`);
console.log("\n=== 生产档决定 ===");
for (const [k, v] of Object.entries(summary.production.decisions)) console.log(`  ${k.padEnd(28)} ${v}`);
console.log(`  相对 Standard 有变化： ${summary.production.changedVsStandard} / ${usable.length}`);
console.log("\n=== 预览成本（全部候选跑完）===");
console.log(`  median ${summary.preview.medianMs}ms / p95 ${summary.preview.p95Ms}ms / max ${summary.preview.maxMs}ms / 预算 ${summary.preview.budgetMs}ms → 超预算 ${summary.preview.overBudget} 例`);
if (DIFF_COLUMNS && diffStats.length) {
  const TAGS = [
    ["production-vs-standard", "生产档 vs Standard（§30-4 判的是这一张）"],
    ["selected-vs-standard", "评测档 vs Standard（§21 的 AutoTune Selected）"],
  ];
  for (const [tag, title] of TAGS) {
    const list = diffStats.filter((d) => d.tag === tag);
    if (!list.length) continue;
    const moved = list.filter((d) => !d.sameAsStandard);
    console.log(`\n=== ${title} ===`);
    if (!moved.length) {
      console.log("  全部夹具逐格一致 —— 本档没有任何输出变化，不存在退化面。");
      continue;
    }
    for (const d of moved) {
      console.log(`  ${d.id.padEnd(22)} 改变 ${String(d.changed).padStart(6)} 格 / 有效 ${d.filled} 格（${((d.changed / Math.max(1, d.filled)) * 100).toFixed(2)}%）`
        + ` · 仅 Standard 有豆 ${d.baseOnly} · 仅对方有豆 ${d.otherOnly}`);
    }
    const structural = moved.reduce((sum, d) => sum + d.baseOnly + d.otherOnly, 0);
    console.log(`  其余 ${list.length - moved.length} 个夹具逐格一致。`);
    console.log(`  ★ 凭空多/少豆合计 ${structural} 格${structural === 0 ? "（= 0，改动全部是换色，没有结构增减）" : " ← 需要人工看图"}`);
  }
  console.log(`\n  差异图（品红 = 改变格）→ ${path.join(OUT_DIR, "diff")}`);
}
console.log(`\n产物 → ${OUT_DIR}`);
