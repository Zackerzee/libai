/**
 * b4-bench-baseline.test.mjs — Stage B4 §4/§5 的基线守卫。
 *
 * ── 为什么必须有这个文件 ────────────────────────────────────────────
 * 「冻结基线」这件事最容易退化成两种假象：
 *   ① 基线文件躺在仓库里，但**已经没人知道它还是不是当前代码跑出来的**；
 *   ② 夹具被改了，探针框还指着老位置，于是「通过」指的是一块已经不存在的内容。
 * 所以这里既守**基线可复现**（重跑必须逐位一致），也守**夹具没被改坏**
 * （`logicalProbeStats` 变了就红）。
 *
 * 只重跑两个类：全量 20 项要十几秒，而 `gridHash` 是逐格哈希，
 * 两个类足以证明「基线不是过期的」。要全量核对用
 * `node tools/b4-bench.mjs --check`。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { B4_BENCH_CLASSES, B4_BENCH_BY_KEY, LOGICAL_SIZE, buildBenchGrid } from "./b4-bench-fixtures.mjs";
import {
  B4_BENCH_PINNED,
  benchPalette,
  benchSize,
  logicalProbeStats,
  runBenchCase,
} from "./b4-bench-runner.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE_FILE = path.join(ROOT, "tests/fixtures/b4-bench/baseline.json");
const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, "utf8"));
const byRun = new Map(baseline.runs.map((r) => [`${r.classId}/${r.mode}`, r]));
const byOriginal = new Map(baseline.originals.map((o) => [o.classId, o]));

/* =========================================================
 * ① 结构
 * ======================================================= */

test("§4：基线结构完整（固定输入 / 色卡 / 原图侧 / 运行项）", () => {
  assert.equal(baseline.stage, "B4 §4/§5");
  assert.ok(baseline.pinned, "缺少 pinned");
  assert.ok(baseline.paletteHash, "缺少 paletteHash —— 色卡换了就没人发现");
  assert.ok(baseline.paletteSize > 0);
  assert.ok(baseline.originals?.length === B4_BENCH_CLASSES.length);
  assert.equal(baseline.runs.length, B4_BENCH_CLASSES.length * B4_BENCH_PINNED.modes.length);
});

test("§4：固定输入没有被偷偷改过", () => {
  // 固定输入是基线的**前提**。它一变，基线里所有数字都不再可比 ——
  // 但如果不写这条断言，`--check` 只会说「差异 20 处」，看不出根因是「口径变了」。
  assert.deepEqual(baseline.pinned, JSON.parse(JSON.stringify(B4_BENCH_PINNED)));
  assert.equal(baseline.pinned.longEdge, 104);
  assert.equal(baseline.pinned.maxColors, 0, "基线必须钉住 maxColors —— §11 会改这个值，届时必须显式更新基线");
  assert.equal(baseline.gridSize.width, benchSize().width);
});

test("§4：色卡内容与基线一致（换色卡必须显式更新基线）", () => {
  const palette = benchPalette();
  assert.equal(palette.length, baseline.paletteSize);
  const codes = palette.map((c) => c.code);
  assert.equal(new Set(codes).size, codes.length, "色卡里有重复色号");
});

/* =========================================================
 * ② 夹具与探针的自洽性
 * ======================================================= */

test("§4：每个探针框都合法（在 0–1 内、非空、id 唯一）", () => {
  for (const cls of B4_BENCH_CLASSES) {
    const ids = new Set();
    for (const probe of cls.probes) {
      assert.ok(!ids.has(probe.id), `${cls.id} 探针 id 重复：${probe.id}`);
      ids.add(probe.id);
      assert.equal(probe.box.length, 4, `${cls.id}/${probe.id} box 必须是 4 个数`);
      const [x0, y0, x1, y1] = probe.box;
      for (const v of probe.box) assert.ok(v >= 0 && v <= 1, `${cls.id}/${probe.id} box 越界：${v}`);
      assert.ok(x1 > x0 && y1 > y0, `${cls.id}/${probe.id} box 是空的`);
      // 框必须至少覆盖 1 个逻辑像素，否则它在任何格网上都可能落到 0 格
      assert.ok((x1 - x0) * LOGICAL_SIZE >= 1, `${cls.id}/${probe.id} 横向不足 1 逻辑像素`);
      assert.ok((y1 - y0) * LOGICAL_SIZE >= 1, `${cls.id}/${probe.id} 纵向不足 1 逻辑像素`);
    }
  }
});

test("§4：声明 flat 的探针框在逻辑网格上确实是单色", () => {
  // 这条防的是「框横跨了块边界」：那种情况下「块内单色」这个判据永远量不到
  // 单色，指标会稳定地偏高一点点，而没人知道为什么。
  const flatProbes = B4_BENCH_CLASSES.flatMap((cls) =>
    cls.probes.filter((p) => p.flat === true).map((p) => [cls, p]));
  assert.ok(flatProbes.length > 0, "至少应有一个 flat 探针，否则这条断言是空跑");
  for (const [cls, probe] of flatProbes) {
    const stats = logicalProbeStats(cls, probe);
    assert.equal(stats.colors, 1,
      `${cls.id}/${probe.id} 声明了 flat，但框里有 ${stats.colors} 种逻辑颜色 —— 框跨到别的块上了`);
  }
});

test("§4：声明 flat 的探针框在 104 格网上同样是单色（原图侧）", () => {
  // 逻辑侧单色 ≠ 格网侧单色：逻辑 64 → 格网 104 是 1.625×，一条 1 逻辑像素厚的
  // 带子在格网上会被劈成两格、混出过渡色。所以 flat 探针必须**两侧都验**，
  // 否则「块内单色」这条判据在格网侧根本不成立，指标会一直偏高一点点。
  // 这里用基线里已经冻结的 `original.distinctColors`，不额外跑生成。
  const flatProbes = B4_BENCH_CLASSES.flatMap((cls) =>
    cls.probes.filter((p) => p.flat === true).map((p) => [cls, p]));
  for (const [cls, probe] of flatProbes) {
    const run = byRun.get(`${cls.id}/${B4_BENCH_PINNED.modes[0]}`);
    const measured = run.probes[probe.id].original;
    assert.equal(measured.distinctColors, 1,
      `${cls.id}/${probe.id} 在原图格网侧有 ${measured.distinctColors} 色 —— 框跨到别的块上了`);
  }
});

test("§4：夹具没被改坏（原图用色数与逻辑探针统计与基线一致）", () => {
  for (const cls of B4_BENCH_CLASSES) {
    const frozen = byOriginal.get(cls.id);
    assert.ok(frozen, `${cls.id} 不在基线里`);
    for (const probe of cls.probes) {
      const now = logicalProbeStats(cls, probe);
      assert.deepEqual(now, frozen.logicalProbeStats[probe.id],
        `${cls.id}/${probe.id} 逻辑探针统计变了 —— 改了 paint 却没改 probes？`);
    }
    const used = new Set();
    for (const row of buildBenchGrid(cls).rgbGrid) for (const cell of row) used.add(cell.rgb.join(","));
    assert.equal(used.size, frozen.usedColors, `${cls.id} 原图用色数变了`);
  }
});

/* =========================================================
 * ③ 基线可复现（真正的门禁）
 * ======================================================= */

test("§5：重跑两个类，逐格哈希必须与冻结基线一致", () => {
  // 这是整个文件的重点：基线文件「存在」毫无意义，**能复现**才有意义。
  const palette = benchPalette();
  const size = benchSize();
  for (const id of ["D", "H"]) {
    const cls = B4_BENCH_BY_KEY[B4_BENCH_CLASSES.find((c) => c.id === id).key];
    const frozen = byRun.get(`${id}/auto`);
    assert.ok(frozen, `${id}/auto 不在基线里`);
    const run = runBenchCase(cls, "auto", { palette, size });
    assert.equal(run.gridHash, frozen.gridHash,
      `${id}/auto 的 gridHash 变了：基线 ${frozen.gridHash} → 实得 ${run.gridHash}`);
    assert.equal(run.usedColors, frozen.usedColors, `${id}/auto 用色数变了`);
    assert.equal(run.nullCells, frozen.nullCells, `${id}/auto 空豆数变了`);
  }
});

/* =========================================================
 * ④ provenance：报告里那句话能不能自证
 * ======================================================= */

test("§4：每个运行项都带完整的生效配置（四个智能辅助开关必须在）", () => {
  const required = ["sampling", "detailProtection", "edgeProtection", "cleanupProtectionThreshold",
    "maxColors", "subjectCrop", "autoBackground", "strokeProtection", "accentProtection"];
  for (const run of baseline.runs) {
    assert.ok(run.resolvedConfig, `${run.classId}/${run.mode} 缺少 resolvedConfig`);
    for (const key of required) {
      assert.ok(key in run.resolvedConfig,
        `${run.classId}/${run.mode} 的 resolvedConfig 缺 ${key} —— 报告里「这一列是用什么配置跑的」就无法自证`);
    }
    assert.equal(run.resolvedConfig.maxColors, 0);
  }
});

test("§4：取景稳定性判据基于「真的裁了」，不是「开关开着」", () => {
  // 首次实测：A/B/C/D/E/H/I/J 的 beginner 真的裁了（探针不可比），
  // 而 F/G 的 beginner 开关同样开着、却没裁 —— 两者必须区分开。
  const unstable = baseline.runs.filter((r) => r.framingStable === false);
  const stableButSwitchOn = baseline.runs.filter(
    (r) => r.framingStable === true && r.resolvedConfig.subjectCrop === true);
  assert.ok(unstable.length > 0, "至少应有一项取景已变，否则这条断言是空跑");
  assert.ok(stableButSwitchOn.length > 0,
    "应存在「开关开着但没真的裁」的项 —— 若没有，说明判据退回了看开关值");
  for (const run of baseline.runs) {
    assert.equal(run.framingStable, !run.subjectCropApplied,
      `${run.classId}/${run.mode} framingStable 与 subjectCropApplied 不自洽`);
  }
});

test("§4：数据集覆盖 §17 点名要肉眼确认的每一项特征", () => {
  // 「看着还行」不是结论。每个特征必须能在某个类的 probes 里找到落点，
  // 否则 §16/§17 的 contact sheet 就没有对应的判据。
  const text = B4_BENCH_CLASSES.map((c) => `${c.label} ${c.why} ${c.probes.map((p) => p.label).join(" ")}`).join(" ");
  for (const feature of ["高光", "肤色", "回形纹", "金纹", "窗格", "白衣", "灰阶", "笔画", "描边"]) {
    assert.ok(text.includes(feature), `§17 要求看的「${feature}」在数据集里没有落点`);
  }
});

test("§4：跑一次默认命令**不得**改写冻结基线（只有 --update-baseline 能写）", () => {
  // 这条守的是一个真实踩过的坑：原先写盘是无条件的，于是「只是想看一眼」
  // 的一次 `node tools/b4-bench.mjs` 会把 9 处路由差异静默吞进基线 ——
  // 一份会自己更新的「冻结基线」不是基线。
  // 只跑一个类（~1s），因为要验的是**写盘闸门**，不是基线内容。
  const before = fs.readFileSync(BASELINE_FILE);
  execFileSync(process.execPath,
    [path.join(ROOT, "tools/b4-bench.mjs"), "--class", "A", "--mode", "auto", "--out", path.join(ROOT, ".b4-bench-gate-probe")],
    { cwd: ROOT, stdio: "pipe" });
  const after = fs.readFileSync(BASELINE_FILE);
  assert.ok(before.equals(after),
    "默认运行改写了冻结基线 —— 写盘闸门失效了，请检查 tools/b4-bench.mjs 里 !UPDATE 分支");
});
