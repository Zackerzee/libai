#!/usr/bin/env node
/**
 * b4-bench.mjs — Stage B4 §4/§5：固定 benchmark 数据集 + baseline 冻结。
 *
 * ── 它解决什么问题 ──────────────────────────────────────────────────
 * §6–§10 要往管线里塞五个候选算法。**没有基线就没法判断它们到底改好了还是改坏了** ——
 * 「看着更好」不是结论，是一句无法反驳也无法验证的话。
 * 所以先把 CURRENT 在**固定输入**上的行为钉下来，之后每一次算法改动都拿它对比。
 *
 * ── 为什么跑在 Node 而不是浏览器 ────────────────────────────────────
 * `runGenerationPipeline` 是**无 DOM 的纯函数**（Worker 里跑的就是它）。
 * 基线要的是**可复现**，不是「像线上」——线上那一份由 §21 的真机 QA 负责。
 * Node 侧没有解码、没有渲染、没有 CSP，跑 20 次只要十几秒，且逐位可复现。
 * 需要真实耗时/内存/取消延迟的，去 §18 的真机 benchmark，那是另一件事。
 *
 * ── 冻结的是什么、不冻结什么 ────────────────────────────────────────
 * 冻结（漂移即红）：夹具内容（`logicalProbeStats`）、色卡内容、尺寸、
 *   `maxColors`、`gridHash` / `usedColors` / `nullCells` / 取景稳定性。
 * 不冻结（只记录）：耗时。它随机器、随负载变化，拿它当门禁只会制造假红灯。
 *
 * 测量逻辑全部在 `tests/b4-bench-runner.mjs` —— 本文件只负责编排、渲染和落盘，
 * 这样「写基线的工具」和「守基线的测试」用的是**同一套测量**。
 *
 * 用法：
 *   node tools/b4-bench.mjs --out <dir>          # 跑并写出结果（PNG + JSON）
 *   node tools/b4-bench.mjs --check --out <dir>  # 只比对，不写基线
 *   node tools/b4-bench.mjs --update-baseline    # 明确更新基线，并打印逐项 diff
 *   node tools/b4-bench.mjs --class A,F --mode auto
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";
import { B4_BENCH_CLASSES, buildBenchGrid } from "../tests/b4-bench-fixtures.mjs";
import {
  B4_BENCH_PINNED as PINNED,
  benchInputs,
  benchPalette,
  benchSize,
  downsampleSource,
  logicalProbeStats,
  measureProbe,
  paletteHash,
  runBenchCase,
} from "../tests/b4-bench-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, "tests/fixtures/b4-bench/baseline.json");

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name, fallback = null) => {
  const i = argv.indexOf(name);
  return i === -1 ? fallback : argv[i + 1];
};

const OUT_DIR = value("--out", path.join(ROOT, ".b4-bench-out"));
const CHECK = flag("--check");
const UPDATE = flag("--update-baseline");
const onlyClasses = (value("--class") || "").split(",").map((s) => s.trim()).filter(Boolean);
const onlyModes = (value("--mode") || "").split(",").map((s) => s.trim()).filter(Boolean);

const PALETTE = benchPalette();
const PALETTE_HASH = paletteHash(PALETTE);
const size = benchSize();

/* ── 渲染 ─────────────────────────────────────────────────────────── */
function renderGridPng(grid, cell = 6) {
  const h = grid.length;
  const w = grid[0]?.length ?? 0;
  const W = w * cell;
  const H = h * cell;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y += 1) {
    for (let x = 0; x < W; x += 1) {
      const gx = Math.floor(x / cell);
      const gy = Math.floor(y / cell);
      const i = (y * W + x) * 4;
      const c = grid[gy]?.[gx];
      if (!c) {
        // 空豆画成浅棋盘 —— 比透明更清楚，肉眼一眼能看出「这里被清掉了」
        const check = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
        const v = check ? 236 : 248;
        data[i] = v; data[i + 1] = v; data[i + 2] = v; data[i + 3] = 255;
        continue;
      }
      data[i] = c.rgb[0]; data[i + 1] = c.rgb[1]; data[i + 2] = c.rgb[2]; data[i + 3] = 255;
    }
  }
  return encodePng({ data, width: W, height: H });
}

/** 把若干张等大的网格横向拼起来（contact sheet 用）。 */
function compositePanels(panels, cell, gap = 6, bg = [252, 252, 252]) {
  if (!panels.length) return null;
  const h = panels[0].grid.length;
  const w = panels[0].grid[0].length;
  const cols = panels.length;
  const W = cols * w * cell + (cols + 1) * gap;
  const H = h * cell + gap * 2;
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i += 1) {
    data[i * 4] = bg[0]; data[i * 4 + 1] = bg[1]; data[i * 4 + 2] = bg[2]; data[i * 4 + 3] = 255;
  }
  panels.forEach((panel, index) => {
    const ox = gap + index * (w * cell + gap);
    for (let y = 0; y < h * cell; y += 1) {
      for (let x = 0; x < w * cell; x += 1) {
        const c = panel.grid[Math.floor(y / cell)]?.[Math.floor(x / cell)];
        const i = ((gap + y) * W + (ox + x)) * 4;
        if (!c) {
          const check = (Math.floor(x / 4) + Math.floor(y / 4)) % 2;
          const v = check ? 232 : 246;
          data[i] = v; data[i + 1] = v; data[i + 2] = v;
          continue;
        }
        data[i] = c.rgb[0]; data[i + 1] = c.rgb[1]; data[i + 2] = c.rgb[2];
      }
    }
  });
  return { data, width: W, height: H };
}

/* ── 跑 ───────────────────────────────────────────────────────────── */
const classes = B4_BENCH_CLASSES.filter((c) => !onlyClasses.length || onlyClasses.includes(c.id));
const modes = PINNED.modes.filter((m) => !onlyModes.length || onlyModes.includes(m));

console.log(`夹具：${classes.length} 类 · 模式：${modes.join(" / ")} · 长边 ${PINNED.longEdge}`);
console.log(`色卡：${PINNED.paletteLabel}（${PINNED.paletteId}，${PALETTE.length} 色，hash ${PALETTE_HASH}）`);
console.log(`格网：${size.width}×${size.height} · maxColors=${PINNED.maxColors}\n`);

const runs = [];
const originals = [];
const sheetRows = [];
const currentDir = path.join(OUT_DIR, "current");
const originalDir = path.join(OUT_DIR, "original");
const sheetDir = path.join(OUT_DIR, "sheet");
for (const dir of [currentDir, originalDir, sheetDir]) fs.mkdirSync(dir, { recursive: true });

for (const cls of classes) {
  const inputs = benchInputs(cls);
  const originalGrid = downsampleSource(inputs.source, size.width, size.height);
  fs.writeFileSync(path.join(originalDir, `${cls.id}-${cls.key}.png`), renderGridPng(originalGrid));

  // 原图也要量一遍探针 —— 没有它，「算法把这一块改坏了」就没有参照物。
  const originalProbes = {};
  const logicalStats = {};
  for (const probe of cls.probes) {
    originalProbes[probe.id] = measureProbe(originalGrid, probe);
    logicalStats[probe.id] = logicalProbeStats(cls, probe);
  }
  // 用**逻辑网格**的用色数，不是降采样后的。
  // 降采样是盒式平均，512→104 会混出上百个中间色（实测 A 类 42 → 172），
  // 那个数字反映的是「重采样」，不是「夹具本身有几种颜色」。
  // 夹具守卫要的是后者，两边口径必须一致，否则守卫永远在报假红。
  const originalUsed = new Set();
  for (const row of inputs.logical.rgbGrid) for (const cell of row) originalUsed.add(cell.rgb.join(","));
  originals.push({
    classId: cls.id,
    classKey: cls.key,
    usedColors: originalUsed.size,
    logicalProbeStats: logicalStats,
  });

  const panels = [{ grid: originalGrid }];

  for (const mode of modes) {
    const run = runBenchCase(cls, mode, { inputs, palette: PALETTE, size });
    const probes = {};
    for (const probe of cls.probes) {
      probes[probe.id] = { original: originalProbes[probe.id], output: measureProbe(run.grid, probe) };
    }
    runs.push({ classId: cls.id, classKey: cls.key, mode, probes, ...run, grid: undefined, source: undefined });
    fs.writeFileSync(path.join(currentDir, `${cls.id}-${cls.key}-${mode}.png`), renderGridPng(run.grid));
    panels.push({ grid: run.grid });
    console.log(
      `${cls.id} ${mode.padEnd(9)} ${run.size.width}×${run.size.height}  `
      + `${String(run.usedColors).padStart(3)} 色  ${String(run.nullCells).padStart(4)} 空  `
      + `${run.timingMs}ms  ${run.gridHash}`
      + `${run.framingStable ? "" : "  [取景已变，探针不可比]"}`,
    );
  }

  // 每类一张 sheet：列 = 原图 / 各模式。整张 10 行的大图会被缩到看不清 1 格，
  // 所以**逐类一张**才是能真正拿来肉眼验收的东西。
  const perClass = compositePanels(panels, Number(value("--sheet-cell", 4)));
  if (perClass) fs.writeFileSync(path.join(sheetDir, `${cls.id}-${cls.key}.png`), encodePng(perClass));
  sheetRows.push({ classId: cls.id, panels });
}

/* ── 总览 sheet ───────────────────────────────────────────────────── */
const SHEET_CELL = Number(value("--overview-cell", 3));
const rowImages = sheetRows.map((row) => compositePanels(row.panels, SHEET_CELL));
if (rowImages.length) {
  const rowW = rowImages[0].width;
  const rowH = rowImages[0].height;
  const gap = 10;
  const sheetH = rowImages.length * rowH + (rowImages.length - 1) * gap;
  const sheet = new Uint8ClampedArray(rowW * sheetH * 4);
  for (let i = 0; i < sheet.length; i += 4) {
    sheet[i] = 250; sheet[i + 1] = 250; sheet[i + 2] = 250; sheet[i + 3] = 255;
  }
  rowImages.forEach((img, index) => {
    const oy = index * (rowH + gap);
    for (let y = 0; y < img.height; y += 1) {
      for (let x = 0; x < img.width; x += 1) {
        const src = (y * img.width + x) * 4;
        const dst = ((oy + y) * rowW + x) * 4;
        sheet[dst] = img.data[src]; sheet[dst + 1] = img.data[src + 1];
        sheet[dst + 2] = img.data[src + 2]; sheet[dst + 3] = 255;
      }
    }
  });
  const sheetFile = path.join(OUT_DIR, "contact-sheet-current.png");
  fs.writeFileSync(sheetFile, encodePng({ data: sheet, width: rowW, height: sheetH }));
  console.log(`\n总览 sheet（列：原图 / ${modes.join(" / ")}）→ ${sheetFile}`);
  console.log(`  逐类 sheet（能看清 1 格）→ ${sheetDir}`);
}

/* ── 基线比对 / 写入 ──────────────────────────────────────────────── */
const nextBaseline = {
  stage: "B4 §4/§5",
  pinned: PINNED,
  paletteHash: PALETTE_HASH,
  paletteSize: PALETTE.length,
  gridSize: { width: size.width, height: size.height },
  // 原图侧单独冻结：它是「算法改坏了没有」的参照物，也是「夹具被人动过」的哨兵
  // （`logicalProbeStats` 变了 = paint 改了但 probes 没跟着改）。
  originals: originals.map((o) => ({
    classId: o.classId, classKey: o.classKey, usedColors: o.usedColors,
    logicalProbeStats: o.logicalProbeStats,
  })),
  runs: runs.map((r) => ({
    classId: r.classId, classKey: r.classKey, mode: r.mode,
    framingStable: r.framingStable, subjectCropApplied: r.subjectCropApplied,
    size: r.size, usedColors: r.usedColors, nullCells: r.nullCells, totalCells: r.totalCells,
    gridHash: r.gridHash, pipeline: r.pipeline, resolvedConfig: r.resolvedConfig,
    probes: r.probes,
  })),
};

const FROZEN_FIELDS = ["usedColors", "nullCells", "gridHash"];

if (CHECK || UPDATE) {
  if (!fs.existsSync(BASELINE_FILE)) {
    console.log(`\n基线不存在：${path.relative(ROOT, BASELINE_FILE)}`);
    process.exit(1);
  }
  const frozen = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
  const index = new Map(frozen.runs.map((r) => [`${r.classId}/${r.mode}`, r]));
  const diffs = [];
  if (frozen.paletteHash !== PALETTE_HASH) diffs.push(`色卡内容变了：${frozen.paletteHash} → ${PALETTE_HASH}`);
  if (JSON.stringify(frozen.pinned) !== JSON.stringify(PINNED)) {
    diffs.push(`固定输入变了：${JSON.stringify(frozen.pinned)} → ${JSON.stringify(PINNED)}`);
  }
  for (const run of nextBaseline.runs) {
    const before = index.get(`${run.classId}/${run.mode}`);
    if (!before) { diffs.push(`新增运行项：${run.classId}/${run.mode}`); continue; }
    for (const field of FROZEN_FIELDS) {
      if (before[field] !== run[field]) {
        diffs.push(`${run.classId}/${run.mode} ${field}：${before[field]} → ${run[field]}`);
      }
    }
    if (before.framingStable !== run.framingStable) {
      diffs.push(`${run.classId}/${run.mode} 取景稳定性：${before.framingStable} → ${run.framingStable}`);
    }
    if (before.subjectCropApplied !== run.subjectCropApplied) {
      diffs.push(`${run.classId}/${run.mode} 主体裁剪是否生效：${before.subjectCropApplied} → ${run.subjectCropApplied}`);
    }
  }
  const beforeOriginals = new Map((frozen.originals || []).map((o) => [o.classId, o]));
  for (const o of nextBaseline.originals) {
    const before = beforeOriginals.get(o.classId);
    if (!before) { diffs.push(`新增原图项：${o.classId}`); continue; }
    if (JSON.stringify(before.logicalProbeStats) !== JSON.stringify(o.logicalProbeStats)) {
      diffs.push(`${o.classId} 逻辑探针统计变了 —— 改了 paint 却没改 probes？`);
    }
    if (before.usedColors !== o.usedColors) {
      diffs.push(`${o.classId} 原图用色数：${before.usedColors} → ${o.usedColors}`);
    }
  }
  if (diffs.length) {
    console.log(`\n与冻结基线有 ${diffs.length} 处差异：`);
    for (const line of diffs) console.log(`  · ${line}`);
  } else {
    console.log("\n与冻结基线完全一致。");
  }
  if (CHECK) process.exit(diffs.length ? 1 : 0);
  console.log("\n--update-baseline：写入新基线。**上面的差异列表就是变更记录**，不要让它空着。");
}

fs.mkdirSync(path.dirname(BASELINE_FILE), { recursive: true });
fs.writeFileSync(BASELINE_FILE, `${JSON.stringify(nextBaseline, null, 2)}\n`);
console.log(`\n基线 → ${path.relative(ROOT, BASELINE_FILE)}（${nextBaseline.runs.length} 项）`);
console.log(`产物 → ${OUT_DIR}`);
