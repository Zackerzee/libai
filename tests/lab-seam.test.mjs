/**
 * Algorithm Lab 接缝守卫（Stage B4 §6–§10 前置）。
 *
 * 这个文件不测任何候选算法，只测**接缝本身**。理由：§6–§10 要跑十来个候选，
 * 每个候选都靠 `generateV2` 的 `lab` 参数挂上来。接缝一旦有问题，
 * 症状是「候选看起来没效果」—— 而「候选无效」和「候选根本没接上」
 * 在图上一模一样。本项目已经吃过一次这个亏
 * （`requestBackgroundPreview` 的失败路径只收条不生成，用例名却在说
 * 「静默退回正常生成」）。所以先把接缝本身钉死。
 *
 * 四类断言：
 *   A. 默认路径零行为变化（lab 为 null / 空 lab 都不许动一格）
 *   B. 三个接缝真的生效（各自能被观察到）
 *   C. 顺序不变量（refine 在 budget 之前 —— 否则 maxColors 静默失效）
 *   D. 结构不变量（lab 不进 cfg、不进 Worker 契约）
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";
import { runGenerationPipeline } from "../services/generation-pipeline.mjs";
import { executeGenerationJob } from "../services/generation-job.mjs";
import { createGenerationRequest } from "../services/generation-request.mjs";

/* ── 固定夹具：小尺寸 + 多色板，跑得快且能容纳「撒 8 色」这种实验 ── */

const SIZE = 24;
const SOURCE = 96;

/** 12 色板，颜色彼此拉得开 —— 否则「强制换成 palette[0]」看不出差异。 */
const PALETTE = Array.from({ length: 12 }, (_, i) => {
  const r = Math.round(255 * ((i * 5) % 12) / 11);
  const g = Math.round(255 * ((i * 7) % 12) / 11);
  const b = Math.round(255 * ((i * 11) % 12) / 11);
  return { code: `P${String(i).padStart(2, "0")}`, rgb: [r, g, b] };
});

/** 有结构的合成图：三块色区 + 渐变，避免流水线对纯色图走特殊分支。 */
function makeSource(width = SOURCE, height = SOURCE) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      const band = Math.floor(y / (height / 3));
      data[i] = band === 0 ? 220 : band === 1 ? 40 : Math.round((x / width) * 255);
      data[i + 1] = band === 0 ? 60 : band === 1 ? 200 : 120;
      data[i + 2] = band === 0 ? 40 : band === 1 ? 90 : 200;
      data[i + 3] = 255;
    }
  }
  return { data, width, height };
}

function run(lab, options = {}) {
  return generateV2({
    source: makeSource(),
    width: SIZE,
    height: SIZE,
    palette: PALETTE,
    options,
    lab,
  });
}

const codesOf = (grid) => grid.map((row) => row.map((c) => (c ? c.code : "-")).join(",")).join(";");
const usedOf = (grid) => {
  const set = new Set();
  for (const row of grid) for (const cell of row) if (cell) set.add(cell.code);
  return set;
};
const filledCount = (grid) => {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell) n += 1;
  return n;
};

/* =========================================================
 * A. 默认路径零行为变化
 * ======================================================= */

test("lab 为 null 时 diagnostics.lab 必须是 null（报告要能证明没跑 Lab）", () => {
  const { diagnostics } = run(null);
  assert.equal(diagnostics.lab, null);
  // 相邻字段也一并确认：lab 没有把任何生产字段挤掉
  assert.ok(Array.isArray(diagnostics.cleanupRecords));
  assert.equal(typeof diagnostics.colorsBeforeBudget, "number");
});

test("空 lab（三个接缝都没实现）与生产路径逐格相同", () => {
  const plain = run(null);
  const empty = run({ id: "empty-lab" });
  assert.equal(codesOf(empty.grid), codesOf(plain.grid));
  const lab = empty.diagnostics.lab;
  assert.equal(lab.id, "empty-lab");
  assert.equal(lab.matchCell, false);
  assert.equal(lab.refineGrid, false);
  assert.equal(lab.cleanup, false);
  assert.equal(lab.matchFallbacks, 0, "没实现 matchCell 就不该有退回计数");
});

test("matchCell 全返回 undefined → 逐格退回生产匹配器，且退回数 == 非空格数", () => {
  const plain = run(null);
  const delegated = run({ id: "delegating", matchCell: () => undefined });
  assert.equal(codesOf(delegated.grid), codesOf(plain.grid));
  const filled = filledCount(plain.grid);
  assert.ok(filled > 0, "夹具必须产出非空格子，否则这条断言是空的");
  assert.equal(delegated.diagnostics.lab.matchFallbacks, filled);
});

/* =========================================================
 * B. 三个接缝真的生效
 * ======================================================= */

test("matchCell 生效：强制换成 palette[0] → 全图只剩 1 色", () => {
  const plain = run(null);
  assert.ok(usedOf(plain.grid).size > 1, "夹具本身必须是多色的，否则这条断言是空的");
  const forced = run({ id: "force-first", matchCell: () => PALETTE[0] });
  assert.equal(usedOf(forced.grid).size, 1);
  assert.equal([...usedOf(forced.grid)][0], "P00");
  assert.equal(forced.diagnostics.lab.matchFallbacks, 0);
});

test("matchCell 返回 null = 这格留空，是真实意见，不计入退回数", () => {
  const box = (x, y) => x < 4 && y < 4;
  const blanked = run({
    id: "blank-corner",
    matchCell: ({ x, y }) => (box(x, y) ? null : undefined),
  });
  let nulls = 0;
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) {
    assert.equal(blanked.grid[y][x], null, `(${x},${y}) 应为空`);
    nulls += 1;
  }
  assert.equal(blanked.diagnostics.lab.matchFallbacks, filledCount(blanked.grid));
  // 生产路径在这个角上并不是空的 —— 否则「返回 null 生效」无法证明
  const plain = run(null);
  let plainNulls = 0;
  for (let y = 0; y < 4; y += 1) for (let x = 0; x < 4; x += 1) if (!plain.grid[y][x]) plainNulls += 1;
  assert.ok(plainNulls < nulls, "生产路径在该角本来就空的话，这条断言证明不了任何事");
});

test("候选写进 report 的自述出现在 diagnostics.lab.detail", () => {
  const { diagnostics } = run({
    id: "talking-lab",
    matchCell: ({ report }) => { report.buckets = 4; return undefined; },
    refineGrid: ({ report }) => { report.iterations = 2; },
    cleanup: ({ report }) => { report.regions = 0; return { records: [] }; },
  });
  assert.equal(diagnostics.lab.detail.buckets, 4);
  assert.equal(diagnostics.lab.detail.iterations, 2);
  assert.equal(diagnostics.lab.detail.regions, 0);
});

test("cleanup 接缝可替换：返回 undefined 不炸，records 记为空", () => {
  const replaced = run({ id: "no-cleanup", cleanup: () => undefined });
  assert.equal(replaced.diagnostics.lab.cleanup, true);
  assert.equal(replaced.diagnostics.lab.cleanupRecords, 0);
  assert.equal(replaced.diagnostics.cleanupMerges, 0);
  // cleanupMap 必须仍然是全长 Float32Array —— 下游渲染直接索引它
  const map = replaced.diagnostics.cleanupMap;
  assert.equal(map.length, SIZE * SIZE);
});

test("cleanup 返回的 records 真的进 cleanupMap", () => {
  const target = { x: 5, y: 7 };
  const replaced = run({
    id: "one-record",
    cleanup: ({ grid }) => {
      const before = { ...grid[target.y][target.x] };
      grid[target.y][target.x] = { ...PALETTE[3] };
      return {
        records: [{
          ...target,
          before,
          after: grid[target.y][target.x],
          reason: "lab-test",
        }],
      };
    },
  });
  assert.equal(replaced.diagnostics.lab.cleanupRecords, 1);
  assert.equal(replaced.diagnostics.cleanupMerges, 1);
  assert.equal(replaced.diagnostics.cleanupMap[target.y * SIZE + target.x], 1);
  assert.equal(replaced.grid[target.y][target.x].code, "P03");
});

/* =========================================================
 * C. 顺序不变量：refine 必须在 budget 之前
 * ======================================================= */

test("refineGrid 撒 8 色但 maxColors=3 → 最终用色数仍 ≤ 3", () => {
  // 这条用例的关键是**先把 cleanup 出口压到 2 色**（< maxColors=3）。
  // 不这么做的话，cleanup 出口本来就多于 3 色，预算门无论如何都会开，
  // 于是「门读的是 refine 之前的旧快照」这个缺陷会被掩盖 —— 测试照过。
  // 压到 2 色之后：旧快照(2) ≤ 3 → 门不开 → refine 的 8 色原样留在图上 → 抓得到。
  const sprinkled = run({
    id: "sprinkle-8",
    cleanup: ({ grid }) => {
      const records = [];
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          if (!grid[y][x]) continue;
          const before = { ...grid[y][x] };
          grid[y][x] = { ...PALETTE[(x + y) % 2] };
          records.push({ x, y, before, after: grid[y][x], reason: "lab-flatten" });
        }
      }
      return { records };
    },
    refineGrid: ({ grid, report }) => {
      for (let y = 0; y < grid.length; y += 1) {
        for (let x = 0; x < grid[y].length; x += 1) {
          if (!grid[y][x]) continue;
          grid[y][x] = { ...PALETTE[(x + y) % 8] };
        }
      }
      report.sprinkled = 8;
    },
  }, { maxColors: 3 });

  // 先证明夹具真的把两个数拉开了 —— 否则下面两条断言证明不了顺序问题
  assert.equal(sprinkled.diagnostics.colorsAfterCleanup, 2, "cleanup 出口必须是 2 色");
  assert.equal(sprinkled.diagnostics.colorsBeforeBudget, 8, "预算门必须看到 refine 之后的 8 色");

  const used = usedOf(sprinkled.grid).size;
  assert.ok(used > 0);
  assert.ok(used <= 3, `maxColors 失效：refine 之后用色数 ${used} > 3`);
});

test("maxColors=3 且没有 lab 时，colorsBeforeBudget === colorsAfterCleanup（生产口径不变）", () => {
  const { diagnostics } = run(null, { maxColors: 3 });
  assert.equal(diagnostics.colorsBeforeBudget, diagnostics.colorsAfterCleanup);
});

/* =========================================================
 * D. 结构不变量
 * ======================================================= */

test("lab 不得进入 resolvedConfig（那是要结构化克隆的配置）", () => {
  const { diagnostics } = run({ id: "sealed-lab", matchCell: () => undefined });
  assert.equal("lab" in diagnostics.resolvedConfig, false);
  // 真的克隆一次 —— 字段「存在但不可克隆」比「字段不存在」更难查
  assert.doesNotThrow(() => structuredClone(diagnostics.resolvedConfig));
  assert.doesNotThrow(() => structuredClone(diagnostics.lab.detail));
});

test("runGenerationPipeline 转发 lab，并在 pipeline.labId 上留痕", () => {
  const source = makeSource();
  const common = {
    image: { data: source.data, width: source.width, height: source.height },
    mode: "auto",
    size: { width: SIZE, height: SIZE },
    palette: PALETTE,
  };
  const plain = runGenerationPipeline(common);
  assert.equal(plain.pipeline.labId, null);
  assert.equal(plain.diagnostics.lab, null);

  const withLab = runGenerationPipeline({ ...common, lab: { id: "forwarded", matchCell: () => PALETTE[1] } });
  assert.equal(withLab.pipeline.labId, "forwarded");
  assert.equal(usedOf(withLab.grid).size, 1);
  assert.notEqual(codesOf(withLab.grid), codesOf(plain.grid));
});

test("Worker 路径（executeGenerationJob）没有 lab —— 函数进不了 structuredClone", () => {
  const source = makeSource();
  const request = createGenerationRequest({
    requestId: 1,
    image: { data: source.data, width: source.width, height: source.height },
    size: { width: SIZE, height: SIZE },
    mode: "auto",
    palette: PALETTE,
    maxColors: 0,
    overrides: {},
  });
  assert.doesNotThrow(() => structuredClone(request));
  const result = executeGenerationJob(request);
  assert.equal(result.ok, true);
  assert.equal(result.diagnostics.lab, null, "Worker 路径不该出现候选算法");
  assert.equal(result.pipeline.labId, null);
});
