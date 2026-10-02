/**
 * §9 Spatial Refine 契约测试。
 *
 * §9 的三条硬约束：
 *   · 候选**只能**来自：当前色 / 邻居实际色 / 当前色附近 Top-K 色卡色
 *   · 禁止每轮全色板搜索
 *   · 2–4 iterations，early stop
 *
 * 加两条实现自带的硬保护：
 *   · 高保护分的格子冻结
 *   · **空格永远不许被填色**（null 完整性，§16 硬失败项）
 *
 * 色板是刻意设计的：`W` 的三个最近邻是 `N1/N2/N3`，`G` 在 Top-3 之外。
 * 这样「G 是 ΔE 更近的真色、但不是合法候选」这个前提可以被断言出来，
 * 而不是靠人读代码确认。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createSpatialRefine,
  DEFAULT_SPATIAL_REFINE_OPTIONS,
} from "../smart-preprocessing/lab/spatial-refine.mjs";
import { rgbToLab, deltaE2000, paletteLabTable, nearestEntries } from "../smart-preprocessing/lab/buckets.mjs";
import {
  CELL_PALETTE, makeRefineCtx, runEngine, codesOf, gridHash, nullSignature, paintSource,
} from "./b4-candidate-harness.mjs";

const P = Object.freeze([
  { code: "W", rgb: [255, 255, 255] },
  { code: "N1", rgb: [250, 250, 250] },
  { code: "N2", rgb: [245, 245, 245] },
  { code: "N3", rgb: [240, 240, 240] },
  { code: "G", rgb: [128, 128, 128] },
]);
const COL = (code) => ({ ...P.find((c) => c.code === code) });

/** 3×3：中心 `centerCode`，其余 `W`。`centerRgb` 是中心格采样到的源图色。 */
function centreFixture({ centerCode = "W", centerRgb = [255, 255, 255], edge = 0, protection = 0 } = {}) {
  const grid = [];
  for (let y = 0; y < 3; y += 1) {
    const row = [];
    for (let x = 0; x < 3; x += 1) row.push(x === 1 && y === 1 ? COL(centerCode) : COL("W"));
    grid.push(row);
  }
  const sampledRgb = [];
  for (let y = 0; y < 3; y += 1) {
    const row = [];
    for (let x = 0; x < 3; x += 1) row.push(x === 1 && y === 1 ? centerRgb : [255, 255, 255]);
    sampledRgb.push(row);
  }
  const edgeMap = new Float32Array(9);
  edgeMap[4] = edge;
  const protectionMap = new Float32Array(9);
  protectionMap[4] = protection;
  return { grid, sampledRgb, edgeMap, protectionMap };
}

function refine(fixture, options = {}) {
  const report = {};
  const ctx = makeRefineCtx({ ...fixture, palette: P, report });
  createSpatialRefine(options).refineGrid(ctx);
  return { grid: ctx.grid, report: report.spatialRefine };
}

const centreCodeOf = (grid) => (grid[1][1] ? grid[1][1].code : null);

test("前提：G 不在 W 的 Top-K 邻色里（否则下面的用例测不到候选集约束）", () => {
  const table = paletteLabTable(P);
  const near = nearestEntries(rgbToLab([255, 255, 255]), table, DEFAULT_SPATIAL_REFINE_OPTIONS.topK + 1)
    .map((e) => e.code)
    .filter((c) => c !== "W");
  assert.equal(near.length, DEFAULT_SPATIAL_REFINE_OPTIONS.topK);
  assert.ok(!near.includes("G"), `G 必须在 W 的 Top-${DEFAULT_SPATIAL_REFINE_OPTIONS.topK} 之外，实测 ${near.join(",")}`);
});

test("候选集约束：ΔE 更近但非法的候选不许被选中", () => {
  // 中心格源图是灰的 —— 纯保真意义上 G 明显比 W 近得多。
  // 但 G 不是「当前色 / 邻居色 / Top-K 邻色」里的任何一个 → 不许跳过去。
  const src = rgbToLab([130, 130, 130]);
  assert.ok(
    deltaE2000(src, rgbToLab([128, 128, 128])) < deltaE2000(src, rgbToLab([255, 255, 255])),
    "前提：G 确实比 W 更接近中心格源色",
  );
  const { grid, report } = refine(centreFixture({ centerCode: "W", centerRgb: [130, 130, 130] }));
  assert.equal(report.changedCells, 0, "非法候选不该被选中");
  assert.equal(centreCodeOf(grid), "W");
  assert.ok(!codesOf(grid).includes("G"), "整张网格都不该出现 G");
});

test("孤立点：源图不支持的孤色被邻居色抹平", () => {
  const { grid, report } = refine(centreFixture({ centerCode: "G", centerRgb: [255, 255, 255] }));
  assert.equal(centreCodeOf(grid), "W", "源图说这格是白的 ⇨ 孤岛该被抹平");
  assert.ok(report.changedCells >= 1);
});

test("保真项：源图真的不同的孤色不该被抹平", () => {
  // 和上一条**只差源图色**：源图说这格是灰的，那它就不是噪点，是结构。
  // 两条一起看才说明「邻居项」没有盖过「保真项」。
  const { grid } = refine(centreFixture({ centerCode: "G", centerRgb: [128, 128, 128] }));
  assert.equal(centreCodeOf(grid), "G", "源图支持这格是灰的 ⇨ 不该被邻居抹平");
});

test("边界项：同一夹具只翻 edgeMap，结论必须翻转", () => {
  // 源图 165 灰：无边界时 W 略优（实测收益约 10.8 ΔE），
  // 加上 wEdge × edge × edgeScale = 20 之后就该保留原色。
  const base = { centerCode: "G", centerRgb: [165, 165, 165] };
  const flat = refine(centreFixture({ ...base, edge: 0 }));
  const edged = refine(centreFixture({ ...base, edge: 1 }));
  assert.equal(centreCodeOf(flat.grid), "W", "边界强度 0 ⇨ 换成邻居色");
  assert.equal(centreCodeOf(edged.grid), "G", "边界强度 1 ⇨ 边界项必须把它按住");
  assert.ok(flat.report.totalGain > 0, "无边界时的收益必须是正的（否则这条测的不是边界项）");
});

test("冻结：protectionMap ≥ freezeProtection 的格子完全不动", () => {
  // 用的正是「会被抹平」的孤岛夹具，只把保护分拉到阈值以上。
  const { grid, report } = refine(centreFixture({
    centerCode: "G", centerRgb: [255, 255, 255], protection: DEFAULT_SPATIAL_REFINE_OPTIONS.freezeProtection,
  }));
  assert.equal(centreCodeOf(grid), "G", "冻结格必须原样保留");
  assert.equal(report.frozen, 1);
  assert.equal(report.changedCells, 0);
});

test("null 完整性：refine 不许往空格里填色", () => {
  const grid = [
    [COL("W"), COL("W"), null],
    [COL("W"), null, COL("G")],
    [null, COL("W"), COL("W")],
  ];
  const sampledRgb = [
    [[255, 255, 255], [255, 255, 255], null],
    [[255, 255, 255], null, [255, 255, 255]],
    [null, [255, 255, 255], [255, 255, 255]],
  ];
  const before = nullSignature(grid);
  const { grid: after } = refine({ grid, sampledRgb });
  assert.equal(nullSignature(after), before, "空格位置必须逐位不变");
  assert.equal(centreCodeOf(after), null);
});

test("迭代：early stop 且永不超过 maxIterations", () => {
  const uniform = refine(centreFixture({ centerCode: "W", centerRgb: [255, 255, 255] }));
  assert.equal(uniform.report.changedCells, 0);
  assert.equal(uniform.report.iterationsRun, 1, "没有变化 ⇨ 一轮就该 early stop");

  const capped = refine(centreFixture({ centerCode: "G", centerRgb: [255, 255, 255] }), { iterations: 2 });
  assert.equal(capped.report.maxIterations, 2);
  assert.ok(capped.report.iterationsRun <= 2, "迭代次数不得超过上限");
  assert.ok(capped.report.iterationsRun >= 1);
});

test("§9 默认参数落在 §9 规定的区间内", () => {
  const o = DEFAULT_SPATIAL_REFINE_OPTIONS;
  assert.ok(o.iterations >= 2 && o.iterations <= 4, "iterations 必须落在 2–4");
  assert.ok(o.wFidelity > 0 && o.wNeighbor > 0 && o.wEdge > 0, "三项能量权重都必须为正");
  assert.ok(o.freezeProtection > 0 && o.freezeProtection < 1);
  assert.ok(o.minImprovement > 0, "没有最小收益门槛会在平局附近抖动");
});

test("确定性：同一 ctx 跑两次逐格相同", () => {
  // 必须各造一份：refine 是**原地**改 grid 的（接缝契约如此），
  // 复用同一个 fixture 会让第二次跑在已被改过的网格上 —— 那测的是幂等性，不是确定性。
  const spec = { centerCode: "G", centerRgb: [200, 200, 200] };
  const a = refine(centreFixture(spec));
  const b = refine(centreFixture(spec));
  assert.equal(gridHash(a.grid), gridHash(b.grid));
  assert.equal(codesOf(a.grid), codesOf(b.grid));
  assert.deepEqual(a.report, b.report);
});

test("引擎端：refine 接缝被调用、色号不越界、空格不动", () => {
  const SIZE = 32;
  // 一半不透明一半透明 —— 空格必须原样留着
  const source = paintSource(SIZE, SIZE, (x, y) => (y < SIZE / 2 ? [200, 190, 180] : [200, 190, 180, 0]));
  const common = { source, width: 6, height: 6, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  const production = runEngine(common);
  const result = runEngine({ ...common, lab: createSpatialRefine() });
  const stat = result.diagnostics.lab.detail.spatialRefine;
  assert.ok(stat, "refine 必须写报告（否则无法判断它是否真的跑了）");
  assert.equal(stat.maxIterations, DEFAULT_SPATIAL_REFINE_OPTIONS.iterations);
  assert.equal(nullSignature(result.grid), nullSignature(production.grid), "refine 不许改变空格分布");
  for (const row of result.grid) for (const cell of row) if (cell) {
    assert.ok(CELL_PALETTE.find((c) => c.code === cell.code), `越界色号 ${cell.code}`);
  }
});
