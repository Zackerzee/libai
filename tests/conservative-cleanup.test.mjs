/**
 * §10 Conservative Cleanup 契约测试。
 *
 * §10 的硬约束：
 *   · 每个待清理区域要综合 **六个量**：regionSize / sourceContrast / edgeSupport /
 *     neighborSupport / paletteDistance / replacementErrorDelta
 *   · 只有**同时**满足「低结构价值」**且**「替换后 source error 不明显增加」才允许清理
 *   · 必须保护 1–4 格的眼睛/高光/嘴/文字点/回形纹/金纹/窗格/细建筑线
 *
 * 以及一条实现自带的硬约束：
 *   · **整块一个替换色**（`splitGuard`）。逐格挑最近邻会把一个 3 格块劈成三块 ——
 *     首轮 Lab 在 F 类上就是这么炸的（componentCount 470 → 597）。
 *
 * 每个用例都只**改一条**，并断言失败原因落在对应的 `skipped*` 计数上。
 * 不看计数的话，「没被清理」和「因为别的原因没被清理」长得一模一样。
 *
 * 背景块一律是「一大片 A」，它会命中 `skippedTooBig` 而不参与 ——
 * 这样 `cleanedComponents` 就等于「杂色块有没有被清」，不用在断言里做排除。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createConservativeCleanup,
  DEFAULT_CONSERVATIVE_CLEANUP_OPTIONS as OPTS,
} from "../smart-preprocessing/lab/conservative-cleanup.mjs";
import {
  CELL_PALETTE, makeCleanupCtx, paintSource, runEngine, nullSignature, codesOf, gridHash,
} from "./b4-candidate-harness.mjs";

const A = { code: "A", rgb: [120, 120, 120] };   // 背景主色（深灰）
const B = { code: "B", rgb: [140, 140, 140] };   // 次背景（浅一点的灰，与 A 很近）
const S = { code: "S", rgb: [255, 0, 0] };       // 待清理的杂色

const CELL = 8; // 每格 8×8 源图像素

/**
 * 造网格 + 配套源图。`spec(x, y)` 返回 `{ cell, src }`。
 * 不传就用 `gridRows`（二维数组）兜底。
 */
function fixture(rows, cols, spec) {
  const grid = [];
  const srcMap = [];
  for (let y = 0; y < rows; y += 1) {
    const grow = [];
    const srow = [];
    for (let x = 0; x < cols; x += 1) {
      const s = spec(x, y);
      grow.push(s.cell ? { ...s.cell } : null);
      srow.push(s.src || null);
    }
    grid.push(grow);
    srcMap.push(srow);
  }
  const source = paintSource(cols * CELL, rows * CELL, (px, py) => {
    const cx = Math.min(cols - 1, Math.floor(px / CELL));
    const cy = Math.min(rows - 1, Math.floor(py / CELL));
    const rgb = srcMap[cy][cx];
    return rgb ? [...rgb, 255] : [0, 0, 0, 0];
  });
  return { grid, source, rows, cols };
}

function cleanup(f, options = {}, extra = {}) {
  const report = {};
  const ctx = makeCleanupCtx({
    grid: f.grid,
    size: Math.max(f.rows, f.cols),
    source: f.source,
    report,
    ...extra,
  });
  const out = createConservativeCleanup(options).cleanup(ctx);
  return { grid: ctx.grid, stat: report.conservativeCleanup, records: out.records };
}

/** 5×5：第 1 行中间三格是杂色 S，其余是背景。背景源图色 / 杂色源图色可分别给。 */
function blockFixture(bgSrc = [130, 130, 130], blockSrc = [130, 130, 130]) {
  return fixture(5, 5, (x, y) => {
    const inBlock = y === 1 && x >= 1 && x <= 3;
    return { cell: inBlock ? S : A, src: inBlock ? blockSrc : bgSrc };
  });
}

/**
 * 5×5：背景是 A/B 棋盘，杂色块三格的源图色分别是 120 / 140 / 120。
 * 棋盘是必须的 —— 只铺一种背景色时，逐格决策也只会有一个候选，
 * 那这条用例就证明不了「块级决策」和「逐格决策」有什么区别。
 */
const CHECKER = [
  [A, B, A, B, A],
  [A, S, S, S, A],
  [A, B, A, B, A],
  [A, A, A, A, A],
  [A, A, A, A, A],
];
function checkerFixture() {
  return fixture(5, 5, (x, y) => {
    let src = [130, 130, 130];
    if (y === 1 && x >= 1 && x <= 3) src = [120, 140, 120][x - 1] === 120 ? [120, 120, 120] : [140, 140, 140];
    return { cell: CHECKER[y][x], src };
  });
}

/** 取某个 componentSize 的记录 —— 背景块/散点会混进 records，按 size 筛才准。 */
const recOfSize = (records, size) => records.filter((r) => r.componentSize === size);

test("整块一个替换色：3 格连通块清理后三格必须同色", () => {
  // 三格的源图色是 120 / 140 / 120 —— 逐格挑最近邻会给出 A / B / A，把一个块劈成三块。
  // 块级决策必须给出同一个色。这是 §10 首轮 Lab 实测炸出来的那条。
  const { grid, records } = cleanup(checkerFixture());
  assert.equal(grid[1][1].code, grid[1][2].code, "同一块的三格必须同色");
  assert.equal(grid[1][2].code, grid[1][3].code, "同一块的三格必须同色");
  const block = recOfSize(records, 3);
  assert.equal(block.length, 3, "3 格块应有 3 条记录");
  const colors = new Set(block.map((r) => r.componentColor));
  assert.equal(colors.size, 1, `componentColor 必须唯一，实测 ${[...colors].join(",")}`);
});

test("records 带齐 §10 要求的六个量", () => {
  const { records } = cleanup(checkerFixture());
  assert.ok(records.length >= 1);
  for (const r of records) {
    for (const key of [
      "componentSize", "sourceContrast", "edgeSupport",
      "neighborSupport", "paletteDistance", "replacementErrorDelta",
    ]) {
      assert.ok(Object.prototype.hasOwnProperty.call(r, key), `record 缺少 ${key}`);
      assert.equal(typeof r[key], "number", `${key} 必须是数字`);
      assert.ok(Number.isFinite(r[key]), `${key} 必须是有限数`);
    }
  }
});

test("① 结构值高（源图对比强）⇨ 不清（1–4 格的眼睛/高光走这条路）", () => {
  // 和默认夹具唯一的区别：杂色块的源图色和周围差得远。
  const { grid, stat } = cleanup(blockFixture([130, 130, 130], [250, 250, 250]));
  assert.equal(stat.skippedStructure, 1, `应因结构值被挡，实测 ${JSON.stringify(stat)}`);
  assert.equal(stat.cleanedComponents, 0);
  assert.equal(grid[1][1].code, "S", "高对比的小特征必须保住");
});

test("① 结构值高（edgeSupport 强）⇨ 不清（细线/描边走这条路）", () => {
  // 5 格块：sizeScore 固定为 0.15，edgeScore 满格是 0.40，两者相加刚好越过 0.5。
  // 3 格块做不到（0.09 + 0.40 = 0.49），所以这里必须用 5 格 —— 这不是随意挑的。
  const mk = () => fixture(5, 5, (x, y) => ({ cell: y === 1 ? S : A, src: [130, 130, 130] }));
  const flat = cleanup(mk());
  assert.equal(flat.stat.cleanedComponents, 1, "边界强度 0 ⇨ 应该被清掉");

  const edgeMap = new Float32Array(25);
  for (let x = 0; x < 5; x += 1) edgeMap[1 * 5 + x] = 1.0;
  const edged = cleanup(mk(), {}, { edgeMap });
  assert.equal(edged.stat.skippedStructure, 1, `应因结构值被挡，实测 ${JSON.stringify(edged.stat)}`);
  assert.equal(edged.grid[1][1].code, "S", "有边缘支撑的细线必须保住");
});

test("① tier ≥ protectTier ⇨ 不清（比生产的 tier ≥ 4 更宽）", () => {
  const tierMap = new Uint8Array(25).fill(1);
  for (const x of [1, 2, 3]) tierMap[1 * 5 + x] = OPTS.protectTier;
  const { grid, stat } = cleanup(blockFixture(), {}, { tierMap });
  assert.equal(stat.skippedProtectedTier, 1, `实测 ${JSON.stringify(stat)}`);
  assert.equal(stat.cleanedComponents, 0);
  assert.equal(grid[1][1].code, "S");
  assert.ok(OPTS.protectTier < 4, "必须比生产的 tier ≥ 4 更严格");
});

test("② 替换后源图误差变大 ⇨ 不清", () => {
  // 源图整片都是 100 灰，杂色格当前色恰好就是 100 灰（ΔE=0），
  // 而唯一可换的邻居色 A 离源图有 8 ΔE —— 换过去就是**变差**。
  const f = fixture(3, 3, (x, y) => {
    const isCentre = x === 1 && y === 1;
    return { cell: isCentre ? { code: "S", rgb: [100, 100, 100] } : A, src: [100, 100, 100] };
  });
  const { grid, stat } = cleanup(f);
  assert.equal(stat.skippedErrorDelta, 1, `应因误差预算被挡，实测 ${JSON.stringify(stat)}`);
  assert.equal(stat.cleanedComponents, 0);
  assert.equal(grid[1][1].code, "S");
});

test("③ 邻域支持不足 ⇨ 不清（不许换出一个新的孤岛）", () => {
  // 角上的孤立格在 3×3 里有 3 个接触（不是 1 个）—— 所以把门槛抬到 4，
  // 而不是去造一个「只有 1 个接触」的畸形网格。抬门槛改的是参数，
  // 造畸形网格改的是被测对象，前者才叫「只改一项」。
  const f = fixture(3, 3, (x, y) => {
    const isCorner = x === 0 && y === 0;
    return { cell: isCorner ? S : A, src: [130, 130, 130] };
  });
  const { grid, stat } = cleanup(f, { minNeighborSupport: 4 });
  assert.equal(stat.skippedNeighborSupport, 1, `应因邻域支持被挡，实测 ${JSON.stringify(stat)}`);
  assert.equal(grid[0][0].code, "S");
});

test("④ 块超过 maxComponentSize ⇨ 不清", () => {
  const f = fixture(5, 5, (x, y) => ({ cell: (y === 1 || y === 2) ? S : A, src: [130, 130, 130] }));
  const { grid, stat } = cleanup(f, { maxComponentSize: 5 });
  assert.ok(stat.skippedTooBig >= 1, "10 格的块超过了 maxComponentSize=5");
  assert.equal(stat.cleanedComponents, 0, "超过上限的块一个都不许动");
  assert.equal(grid[1][1].code, "S");
});

test("⑤ source evidence 高 ⇨ 不清（与生产同一个门）", () => {
  const { stat } = cleanup(blockFixture(), {}, { sourceEvidence: 0.9 });
  assert.equal(stat.skippedEvidence, 1, `实测 ${JSON.stringify(stat)}`);
  assert.equal(stat.cleanedComponents, 0);
});

test("⑥ 1–2 格的块用更严的误差预算", () => {
  assert.ok(OPTS.tinyErrorBudget < OPTS.errorBudget, "越小的块越可能是特征，预算必须更严");
  const one = fixture(3, 3, (x, y) => ({
    cell: x === 1 && y === 1 ? S : A, src: [130, 130, 130],
  }));
  assert.equal(cleanup(one).records[0].errorBudget, OPTS.tinyErrorBudget, "1 格块走 tiny 预算");
  const block = recOfSize(cleanup(checkerFixture()).records, 3);
  assert.equal(block[0].errorBudget, OPTS.errorBudget, "3 格块走普通预算");
});

test("确定性：同一夹具跑两次逐格相同", () => {
  const a = cleanup(checkerFixture());
  const b = cleanup(checkerFixture());
  assert.equal(gridHash(a.grid), gridHash(b.grid));
  assert.equal(codesOf(a.grid), codesOf(b.grid));
  assert.deepEqual(a.stat, b.stat);
});

test("接缝契约：ctx.cellBounds 两参调用必须给出有限边界", () => {
  // 这条是**实测炸出来**的回归守卫。
  // 引擎一度把 `sampling-engine-v2` 的六参原件直接塞进 ctx，而 §10 只给 (x, y) ——
  // NaN 边界不会报错，只是让像素循环一次都不跑、格子源色恒为 null，
  // 于是每个连通块都走 skippedStructure 分支，整条 §10 变成空操作。
  // 指标上看不出来「算法没跑」，只能看出「碎片变多了」，非常容易被误读成调参问题。
  let finite = null;
  const probe = {
    id: "cellbounds-probe",
    cleanup(ctx) {
      const b = ctx.cellBounds(1, 1);
      finite = Number.isFinite(b.x0) && Number.isFinite(b.x1) && Number.isFinite(b.y0) && Number.isFinite(b.y1);
      return { records: [] };
    },
  };
  const source = paintSource(32, 32, () => [130, 130, 130]);
  runEngine({ source, width: 4, height: 4, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: probe });
  assert.equal(finite, true, "cellBounds(1,1) 必须返回有限边界 —— NaN 会让整条 §10 静默失效");
});

test("引擎端：null 完整性 + 色号不越界", () => {
  const SIZE = 32;
  const source = paintSource(SIZE, SIZE, (x, y) => (y < SIZE / 2 ? [200, 190, 180] : [200, 190, 180, 0]));
  const common = { source, width: 6, height: 6, palette: CELL_PALETTE, options: { sampling: "linear-mean" } };
  const production = runEngine(common);
  const result = runEngine({ ...common, lab: createConservativeCleanup() });
  assert.equal(nullSignature(result.grid), nullSignature(production.grid), "cleanup 不许改变空格分布");
  const stat = result.diagnostics.lab.detail.conservativeCleanup;
  assert.ok(stat, "cleanup 必须写报告");
  assert.equal(stat.splitGuard, true);
  for (const row of result.grid) for (const cell of row) if (cell) {
    assert.ok(CELL_PALETTE.find((c) => c.code === cell.code), `越界色号 ${cell.code}`);
  }
});
