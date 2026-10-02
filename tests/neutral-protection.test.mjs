/**
 * §8 Neutral Protection 契约测试。
 *
 * §8 的四条硬约束：
 *   ① 源色色度低于阈值才进入
 *   ② ΔE2000 仍是主距离（惩罚有上限）
 *   ③ 不允许惩罚压倒明显更近的真实色（override 预算）
 *   ④ 肤色不能归 neutral（skin guard）
 *
 * 测的是这四个量都看得到 —— 用**只差这一条**的夹具去撞它，避免「夹具同时不满足
 * 多条」导致哪条起作用无从分辨。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createNeutralProtection,
  neutralPenalty,
  shouldApplyNeutral,
  pickWithNeutralPenalty,
  DEFAULT_NEUTRAL_OPTIONS,
} from "../smart-preprocessing/lab/neutral-protection.mjs";
import { rgbToLab, labChroma, deltaE2000 } from "../smart-preprocessing/lab/buckets.mjs";
import { CELL_PALETTE, runEngine, codesOf, gridHash, solidSource } from "./b4-candidate-harness.mjs";

/**
 * 引擎端夹具用的两色板：一个饱和、一个中性，都离浅灰源不远。
 * 用两色而不是 12 色，是为了让「生产侧会选谁」这件事不用猜 ——
 * 12 色板里生产侧可能压根不选饱和色，那 neutral 换了也证明不了什么。
 */
const NEUTRAL_PALETTE = Object.freeze([
  { code: "SAT", rgb: [170, 130, 110] },
  { code: "NEU", rgb: [60, 60, 60] },
]);

test("① shouldApplyNeutral：灰度源色 = true", () => {
  const grey = [150, 150, 150];
  const lab = rgbToLab(grey);
  assert.ok(labChroma(lab) < DEFAULT_NEUTRAL_OPTIONS.chromaThreshold);
  assert.equal(shouldApplyNeutral(grey, lab), true);
});

test("① shouldApplyNeutral：高色度源色 = false", () => {
  const vivid = [220, 30, 30];
  const lab = rgbToLab(vivid);
  assert.ok(labChroma(lab) >= DEFAULT_NEUTRAL_OPTIONS.chromaThreshold);
  assert.equal(shouldApplyNeutral(vivid, lab), false);
});

test("④ 肤色不能归 neutral（明示的硬约束）", () => {
  const skin = [232, 190, 170];
  const lab = rgbToLab(skin);
  assert.equal(shouldApplyNeutral(skin, lab), false, "明显肤色不应进入中性门");
  // 偏肤色（score 0.45-0.5）也被挡：稳在 0.4 阈值之外，宁可放过偏肤色也不要误伤
  const borderline = [200, 170, 155];
  const lab2 = rgbToLab(borderline);
  assert.equal(shouldApplyNeutral(borderline, lab2), false);
});

test("② 中性惩罚有上限（ΔE2000 仍是主距离）", () => {
  // 极饱和的候选，理论上惩罚会很大 —— 必须被 maxPenalty 封顶
  const verySaturated = rgbToLab([255, 0, 0]);
  const capped = neutralPenalty(verySaturated);
  assert.equal(capped, DEFAULT_NEUTRAL_OPTIONS.maxPenalty);
});

test("② 候选色度低于 chromaCap 时无惩罚", () => {
  const close = rgbToLab([150, 150, 150]);
  assert.ok(labChroma(close) <= DEFAULT_NEUTRAL_OPTIONS.chromaCap);
  assert.equal(neutralPenalty(close), 0);
});

/**
 * 下面两个用例共用一对夹具，但**只改中性色远近这一项**，让「守卫」这个量
 * 单独可见。夹具是搜出来的（不是凑出来的）：搜的条件是
 *   dSat < dNeu 且 dSat + penalty(sat) > dNeu
 * 也就是「纯 ΔE 该选 SAT、加了惩罚想选 NEU」，两边都得成立，否则这个用例
 * 测的是别的量。
 *
 * 夹具 A：源 [140,140,140]，SAT [180,120,120]（dE≈19.79），NEU [60,60,60]（dE≈29.72）
 *         → 纯最优 SAT，加罚后 NEU 反超，但代价 9.93 > 预算 5 → 守卫必须挡住。
 * 夹具 B：源 [120,120,120]，SAT [170,130,110]（dE≈17.46），NEU [60,60,60]（dE≈21.45）
 *         → 同样反超，但代价只有 4.00 ≤ 5 → 允许换。
 */
const GUARD_FIXTURE = {
  source: [140, 140, 140],
  sat: { code: "SAT", rgb: [180, 120, 120] },
  neu: { code: "NEU", rgb: [60, 60, 60] },
};
const SWITCH_FIXTURE = {
  source: [120, 120, 120],
  sat: { code: "SAT", rgb: [170, 130, 110] },
  neu: { code: "NEU", rgb: [60, 60, 60] },
};

/**
 * pool 里的条目是 `{index, color, lab}` —— 色号在 `.color.code` 上。
 * 抽个函数出来是为了避免写 `.chosen.code`（那是 undefined，`undefined === undefined`
 * 会让断言**永远通过**，看上去在测确定性其实什么都没测。这个坑踩过一次）。
 */
const codeOf = (entry) => entry?.color?.code;

/** 把上面那对夹具变成 pool，并断言它确实「两边都成立」（否则用例在测别的量）。 */
function neutralPool({ source, sat, neu }, expectGuard) {
  const sourceLab = rgbToLab(source);
  const pool = [
    { index: 0, color: { code: sat.code, rgb: sat.rgb }, lab: rgbToLab(sat.rgb) },
    { index: 1, color: { code: neu.code, rgb: neu.rgb }, lab: rgbToLab(neu.rgb) },
  ];
  const dSat = deltaE2000(sourceLab, pool[0].lab);
  const dNeu = deltaE2000(sourceLab, pool[1].lab);
  const penalty = neutralPenalty(pool[0].lab);
  assert.ok(labChroma(sourceLab) < DEFAULT_NEUTRAL_OPTIONS.chromaThreshold, "源色必须近中性，否则门根本不开");
  assert.ok(dSat < dNeu, `纯 ΔE 必须 SAT 更近（实测 ${dSat.toFixed(2)} vs ${dNeu.toFixed(2)}）`);
  assert.ok(dSat + penalty > dNeu, `加罚后必须 NEU 反超（实测 ${(dSat + penalty).toFixed(2)} vs ${dNeu.toFixed(2)}）`);
  const gap = dNeu - dSat;
  if (expectGuard) assert.ok(gap > DEFAULT_NEUTRAL_OPTIONS.overrideBudget, `代价必须超预算（实测 ${gap.toFixed(2)}）`);
  else assert.ok(gap <= DEFAULT_NEUTRAL_OPTIONS.overrideBudget, `代价必须在预算内（实测 ${gap.toFixed(2)}）`);
  return { pool, sourceLab, dSat, dNeu, gap };
}

test("③ override 预算：代价超预算时守卫挡住，保留明显更近的真实色", () => {
  const { pool, sourceLab } = neutralPool(GUARD_FIXTURE, true);
  const picked = pickWithNeutralPenalty(pool, sourceLab, {});
  assert.ok(picked, "必须有结果");
  assert.equal(codeOf(picked.pureBest), "SAT", "纯 ΔE 的最优是 SAT");
  assert.equal(codeOf(picked.penalizedBest), "NEU", "加罚后 NEU 反超（证明惩罚路径被走过）");
  assert.equal(picked.guardFired, true, "代价大于 overrideBudget ⇨ 守卫必须触发");
  assert.equal(codeOf(picked.chosen), "SAT", "守卫触发 ⇨ 保留 ΔE 最近的真实色");
});

test("③ override 预算：代价在预算内时允许惩罚生效", () => {
  const { pool, sourceLab } = neutralPool(SWITCH_FIXTURE, false);
  const picked = pickWithNeutralPenalty(pool, sourceLab, {});
  assert.ok(picked, "必须有结果");
  assert.equal(codeOf(picked.pureBest), "SAT", "纯 ΔE 的最优是 SAT");
  assert.equal(codeOf(picked.penalizedBest), "NEU", "加罚后 NEU 反超");
  assert.equal(picked.guardFired, false, "代价在预算内 ⇨ 守卫不该触发");
  assert.equal(picked.switched, true, "惩罚生效 ⇨ 确实换了色");
  assert.equal(codeOf(picked.chosen), "NEU");
});

test("③ override 预算是可调的：把预算压到代价以下，同一个夹具也会触发守卫", () => {
  // 这条是上面两条的交叉验证：夹具不动，只动预算，结论必须翻转。
  // 没有它的话，「守卫触发」可能只是因为夹具本身不满足换色条件。
  const { pool, sourceLab, gap } = neutralPool(SWITCH_FIXTURE, false);
  const tight = pickWithNeutralPenalty(pool, sourceLab, { overrideBudget: gap / 2 });
  assert.equal(tight.guardFired, true, `预算压到 ${(gap / 2).toFixed(2)} < 代价 ${gap.toFixed(2)} ⇨ 应触发`);
  assert.equal(codeOf(tight.chosen), "SAT");
});

test("确定性：pickWithNeutralPenalty 在相同 pool 下结果一致", () => {
  const sourceLab = rgbToLab([150, 150, 150]);
  const pool = [
    { index: 0, color: { code: "A" }, lab: rgbToLab([150, 148, 152]) },
    { index: 1, color: { code: "B" }, lab: rgbToLab([220, 40, 40]) },
    { index: 2, color: { code: "C" }, lab: rgbToLab([60, 70, 80]) },
  ];
  const a = pickWithNeutralPenalty(pool, sourceLab, {});
  const b = pickWithNeutralPenalty(pool, sourceLab, {});
  assert.equal(codeOf(a.chosen), codeOf(b.chosen));
  assert.equal(codeOf(a.pureBest), codeOf(b.pureBest));
  assert.ok(codeOf(a.chosen), "断言必须有实际值 —— undefined === undefined 会让这条永远通过");
});

test("引擎端：近中性源色在两色板上真的换色，且只换出调色板内的色", () => {
  // 源 = 纯浅灰（chroma ≈ 0，门必开），两色板里生产侧会选 SAT（ΔE 更近）。
  // §8 若生效，格子应变成 NEU。这样「换了」就直接对上了 §8 的语义，
  // 不用靠 gatedOut/skinGated 这类「反正走过某条路」的弱断言。
  const source = solidSource(32, 32, SWITCH_FIXTURE.source);
  const common = { source, width: 4, height: 4, palette: NEUTRAL_PALETTE, options: { sampling: "linear-mean" } };

  const production = runEngine(common);
  assert.equal(codesOf(production.grid), "SAT,SAT,SAT,SAT;SAT,SAT,SAT,SAT;SAT,SAT,SAT,SAT;SAT,SAT,SAT,SAT",
    "前提：没有 §8 时生产侧选的是饱和色（否则这个用例测不到 §8）");

  const result = runEngine({ ...common, lab: createNeutralProtection() });
  const stat = result.diagnostics.lab.detail.neutralProtection;
  assert.equal(stat.cells, 16, "每个格子都应被问过");
  assert.equal(stat.gatedOut, 0, "纯灰源色不该被门挡在门外");
  assert.ok(stat.switched >= 1, "中性保护应至少换掉一格");
  assert.equal(codesOf(result.grid), "NEU,NEU,NEU,NEU;NEU,NEU,NEU,NEU;NEU,NEU,NEU,NEU;NEU,NEU,NEU,NEU");

  for (const row of result.grid) for (const cell of row) if (cell) {
    assert.ok(NEUTRAL_PALETTE.find((c) => c.code === cell.code), `越界色号 ${cell.code}`);
  }
});

test("引擎端：高色度源色门不开（§8 不得越界干预）", () => {
  // 源 = 明显有颜色的红。chroma 远高于阈值 → 门必须关，结果必须与生产一致。
  const source = solidSource(32, 32, [190, 60, 60]);
  const common = { source, width: 4, height: 4, palette: NEUTRAL_PALETTE, options: { sampling: "linear-mean" } };
  const production = runEngine(common);
  const result = runEngine({ ...common, lab: createNeutralProtection() });
  const stat = result.diagnostics.lab.detail.neutralProtection;
  assert.equal(stat.switched, 0, "高色度源色不该被中性保护碰");
  assert.equal(stat.gatedOut, 16, "每个格子都该被挡在门外");
  assert.equal(codesOf(result.grid), codesOf(production.grid), "门关着 ⇨ 必须与生产完全一致");
});

test("确定性：引擎跑两次，逐格相同", () => {
  const SIZE = 32;
  const source = {
    data: (() => {
      const d = new Uint8ClampedArray(SIZE * SIZE * 4);
      for (let i = 0; i < SIZE * SIZE; i += 1) {
        d[i * 4] = 150 + ((i * 7) % 5) - 2;
        d[i * 4 + 1] = 150 + ((i * 11) % 5) - 2;
        d[i * 4 + 2] = 150 + ((i * 13) % 5) - 2;
        d[i * 4 + 3] = 255;
      }
      return d;
    })(),
    width: SIZE, height: SIZE,
  };
  const common = { source, width: 4, height: 4, palette: CELL_PALETTE, options: { sampling: "linear-mean" }, lab: createNeutralProtection() };
  const a = runEngine(common);
  const b = runEngine(common);
  assert.equal(gridHash(a.grid), gridHash(b.grid));
  assert.equal(codesOf(a.grid), codesOf(b.grid));
});

test("默认参数下 chromaThreshold / skinGuard 都不为 0", () => {
  assert.ok(DEFAULT_NEUTRAL_OPTIONS.chromaThreshold > 0);
  assert.ok(DEFAULT_NEUTRAL_OPTIONS.skinGuard > 0);
  assert.ok(DEFAULT_NEUTRAL_OPTIONS.maxPenalty > 0);
  assert.ok(DEFAULT_NEUTRAL_OPTIONS.overrideBudget > 0);
});