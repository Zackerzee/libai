/**
 * §12.4 Bean Fit V2 契约测试。
 *
 * ── 这个文件守的是什么 ────────────────────────────────────────────────
 * §12 对 Bean Fit 的指控是一句话：**「为了降低局部 ΔE，引入了视觉上不存在的新色阶」**。
 * 具体证据是夹具 D —— 原图 6 色，Bean Fit 输出 8 色，多出来的两个色号
 * 是深底与红描边之间被加权和造出来的折中色。
 *
 * 所以这里测的不是「Bean Fit 好不好」，而是三条**结构性质**：
 *   ① 模式策略表是完备的、可查的、原型键打不穿的；
 *   ② `off` 档必须真的什么都不做（逐位等于生产），而不是「做了但没效果」；
 *   ③ 一个「几乎不代表本格任何源色」的候选，不允许在 soft / hard 两档里胜出 ——
 *      并且**纯 §6 口径下它确实会胜出**（否则前两条是假绿灯）。
 *
 * 第 ③ 条的最后半句是刻意的：一条「拒绝折中色」的断言，如果夹具本身
 * 从不产生折中色，它就永远绿。`compromiseCell()` 与 `pureSection6` 那两条
 * 用例合起来才构成完整的反向验证。
 *
 * 效果（哪一类好、好多少）不在这里测 —— 那是 `tools/b4-lab.mjs` + 人工看图的事。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createBeanFit, resolveBeanFitPolicy,
  BEAN_FIT_MODE_POLICY, BEAN_FIT_POLICIES, DEFAULT_BEAN_FIT_OPTIONS,
} from "../smart-preprocessing/lab/bean-fit.mjs";
import {
  buildLabBuckets, topBuckets, sourceSupport, neighbourhoodBuckets, SUPPORT_TAU, rgbToLab,
} from "../smart-preprocessing/lab/buckets.mjs";
import { GENERATION_MODES, resolveRoutedMode } from "../services/mode-profile.mjs";
import { analyzeRoutingEvidence } from "../services/generation-pipeline.mjs";
import { runBenchCase, benchInputs } from "./b4-bench-runner.mjs";
import { B4_BENCH_CLASSES } from "./b4-bench-fixtures.mjs";
import {
  CELL_PALETTE, runEngine, codesOf, gridHash, usedOf, filledCount, paintSource,
} from "./b4-candidate-harness.mjs";

/* =========================================================
 * 夹具
 * ======================================================= */

const NAVY = [30, 30, 40];
const RED = [216, 68, 76];

/**
 * 一个「深底 + 红半边」的格子（50/50）。
 *
 * 为什么是 50/50 而不是「深底 84% + 红点 16%」：折中色之所以能赢，
 * 靠的是**两边都不太远**。一个 84/16 的格子里，纯深底的加权成本
 * （0.84×ΔE(深,深) ≈ 0）压得住任何折中色 —— 实测确实如此（21.80 vs 23.35）。
 * 只有 50/50 才复现 D 的形态。
 */
function splitCellSource(cellPx = 10, gridSize = 1) {
  const size = cellPx * gridSize;
  return paintSource(size, size, (x) => (x % cellPx < cellPx / 2 ? NAVY : RED));
}

/**
 * 色卡：**故意不放**精确的桶色 `(28,28,36)`。
 *
 * 夹具 D 的真实色卡（优肯 C197）里也没有这么近的色，最近的是 `C157(29,37,45)`
 * （到深底桶 ΔE 5.8）。少了这一条，§6 才会真的偏好折中色 `C06`；
 * 放了它，纯 §6 会直接选那个精确色，用例就测不到折中色了。
 * 这不是为了「造一个能过的夹具」——它是把 D 的色卡结构照抄过来。
 */
const SPLIT_PALETTE = [
  { code: "RED", rgb: [255, 88, 93] },   // 生产答案（center 采到红半边）
  { code: "C06", rgb: [186, 12, 47] },   // 折中色：深底与红之间，源图里不存在
  { code: "C69", rgb: [102, 33, 44] },   // 另一个折中色
  { code: "C157", rgb: [29, 37, 45] },   // 深底桶的真邻居
  { code: "PURPLE", rgb: [128, 0, 128] }, // 经典均值色
];
const PALETTE_BY_CODE = new Map(SPLIT_PALETTE.map((c) => [c.code, c]));
/** 生产匹配器的替身：固定返回 RED，对应 `center` 采样采到红半边。 */
const productionPicksRed = { match: () => PALETTE_BY_CODE.get("RED") };

const BOUNDS = { x0: 0, y0: 0, x1: 10, y1: 10 };

function makeMatchCtx(report = {}) {
  return {
    source: splitCellSource(),
    bounds: BOUNDS,
    palette: SPLIT_PALETTE,
    paletteEngine: productionPicksRed,
    rgb: { r: RED[0], g: RED[1], b: RED[2] },
    report,
  };
}

const keptOfSplitCell = () => topBuckets(
  buildLabBuckets(splitCellSource(), BOUNDS, { bucketStep: 10 }).buckets, 4, 0.08,
);

/** 色号 → Lab，走的是 `buckets.mjs` 里那一条实现（不另写一份换算）。 */
const labOf = (rgb) => rgbToLab(rgb);
const labOfCode = (code) => labOf(PALETTE_BY_CODE.get(code).rgb);

/* =========================================================
 * ① 模式策略表
 * ======================================================= */

test("§12.4 策略表：8 个公开模式一个不漏，取值都在允许集合里", () => {
  for (const mode of GENERATION_MODES) {
    assert.ok(Object.hasOwn(BEAN_FIT_MODE_POLICY, mode), `模式 ${mode} 没有策略条目`);
    assert.ok(BEAN_FIT_POLICIES.includes(BEAN_FIT_MODE_POLICY[mode]),
      `模式 ${mode} 的策略 ${BEAN_FIT_MODE_POLICY[mode]} 不在 ${BEAN_FIT_POLICIES.join("/")} 里`);
  }
});

test("§12.4 策略表：取值与原文一致（pixel/logo OFF、anime 谨慎、illustration 实验）", () => {
  assert.equal(BEAN_FIT_MODE_POLICY.portrait, "allow");
  assert.equal(BEAN_FIT_MODE_POLICY.photo, "allow");
  assert.equal(BEAN_FIT_MODE_POLICY.illustration, "experimental");
  assert.equal(BEAN_FIT_MODE_POLICY.anime, "cautious");
  assert.equal(BEAN_FIT_MODE_POLICY.pixel, "off");
  assert.equal(BEAN_FIT_MODE_POLICY.logo, "off");
  // `realistic` 是 §12.3 分类器的候选名，经别名映射到 photo。
  // 它必须和 photo 同档 —— 否则「按分类器名字传 mode」和「按引擎模式名传」
  // 会得到两个不同的策略，而调用方无从知道自己在哪一条上。
  assert.equal(BEAN_FIT_MODE_POLICY.realistic, BEAN_FIT_MODE_POLICY.photo);
});

test("§12.4 未知模式 → cautious（不是 allow，也不是静默 OFF）", () => {
  for (const weird of ["", "realistic-v2", "PHOTO", null, undefined, 42, {}]) {
    const resolved = resolveBeanFitPolicy(weird);
    assert.equal(resolved.policy, "cautious", `mode=${String(weird)} 应落到 cautious`);
    assert.equal(resolved.enabled, true, "cautious 是「跑，但收紧」，不是「不跑」");
    assert.equal(resolved.supportMode, "hard");
  }
});

test("§12.4 原型键打不穿策略表：mode='toString' 不能把候选静默关掉", () => {
  // `table[key] ?? default` 这种写法在这里会返回 Object.prototype.toString
  // —— 一个函数。然后 `policy !== "off"` 恒真、`enabled` 却取决于后续读取，
  // 最坏情况是「拼错的模式名把整个候选关掉，且没有任何报错」。
  for (const key of ["toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"]) {
    const resolved = resolveBeanFitPolicy(key);
    assert.equal(resolved.policy, "cautious", `原型键 ${key} 应落到 cautious`);
    assert.equal(typeof resolved.policy, "string");
  }
});

test("§12.4 策略派生：off 不跑、cautious 硬门、allow/experimental 软惩罚", () => {
  assert.deepEqual(
    ["off", "cautious", "allow", "experimental"].map((m) => {
      const mode = Object.keys(BEAN_FIT_MODE_POLICY).find((k) => BEAN_FIT_MODE_POLICY[k] === m);
      const r = resolveBeanFitPolicy(mode);
      return [r.enabled, r.supportMode];
    }),
    [[false, "soft"], [true, "hard"], [true, "soft"], [true, "soft"]],
  );
});

/* =========================================================
 * ② off 档：真的什么都不做
 * ======================================================= */

test("§12.4 off 档：pixel / logo 下 Bean Fit 一格都不表态，输出与生产逐位相同", () => {
  const source = splitCellSource(8, 6);
  const common = { source, width: 6, height: 6, palette: CELL_PALETTE };
  const production = runEngine({ ...common, lab: null });
  for (const mode of ["pixel", "logo"]) {
    const gated = runEngine({ ...common, lab: createBeanFit({ mode }) });
    assert.equal(gridHash(gated.grid), gridHash(production.grid),
      `${mode} 档下 Bean Fit 改变了输出 —— off 必须是逐位不变`);
    assert.equal(gated.diagnostics.lab.id, "bean-fit", "接缝本身仍应挂上（否则测的是「没挂」而不是「off」）");
    assert.equal(gated.diagnostics.lab.matchFallbacks, filledCount(production.grid),
      "每一格都应当退回生产匹配器");
    assert.equal(gated.diagnostics.lab.detail.beanFit, undefined,
      "off 档连诊断都不该产生 —— 一格都没被问过");
  }
});

test("§12.4 policyOverride 能强制放行（跑分器 --policy force-allow 用的就是它）", () => {
  const source = splitCellSource(8, 6);
  const common = { source, width: 6, height: 6, palette: CELL_PALETTE };
  const gated = runEngine({ ...common, lab: createBeanFit({ mode: "pixel", policyOverride: "allow" }) });
  const stat = gated.diagnostics.lab.detail.beanFit;
  assert.ok(stat, "强制放行后必须产生诊断");
  assert.equal(stat.policy, "allow");
  assert.equal(stat.supportMode, "soft");
});

/* =========================================================
 * ③ sourceSupport 算术
 * ======================================================= */

test("§12.4 sourceSupport：50/50 的格子里，支持占比就是那一半的占比", () => {
  const kept = keptOfSplitCell();
  assert.equal(kept.length, 2, `夹具应当切出两个桶，实得 ${kept.length}`);
  assert.deepEqual(kept.map((b) => Number(b.share.toFixed(4))), [0.5, 0.5]);
  // 深底桶的真邻居（ΔE 5.8 ≤ τ）拿满它那一半
  assert.equal(Number(sourceSupport(kept, labOfCode("C157")).toFixed(4)), 0.5);
  // 折中色：到两个桶都超过 τ → 0。**这就是 §12 那句话的可观测形式。**
  assert.equal(sourceSupport(kept, labOfCode("C06")), 0);
  assert.equal(sourceSupport(kept, labOfCode("C69")), 0);
  assert.equal(sourceSupport(kept, labOfCode("PURPLE")), 0);
  assert.ok(sourceSupport(kept, labOfCode("RED")) >= 0.25,
    "生产答案必须被支持，否则「越界」和「正确」就分不开了");
});

test("§12.4 sourceSupport：平色格的精确色拿满 1.0，τ 越大支持不减", () => {
  const source = paintSource(10, 10, () => NAVY);
  const kept = topBuckets(buildLabBuckets(source, BOUNDS, { bucketStep: 10 }).buckets, 4, 0.08);
  const navyLab = labOf(NAVY);
  assert.equal(Number(sourceSupport(kept, navyLab).toFixed(4)), 1);
  const far = labOf([255, 255, 255]);
  const ladder = [0, 2, 5, SUPPORT_TAU, 40, 200].map((tau) => sourceSupport(kept, far, tau));
  for (let i = 1; i < ladder.length; i += 1) {
    assert.ok(ladder[i] >= ladder[i - 1] - 1e-12, `τ 变大时支持不该下降：${ladder.join(" ")}`);
  }
  assert.equal(ladder[0], 0, "τ=0 时只有完全同色才被支持");
});

test("§12.4 邻域分桶：3×3 邻域能看见隔壁格子的颜色", () => {
  // 本格（x 0–9）纯深底，右边第二格起是红。
  // 邻域窗口 = 本格外扩一格 = x −10…20 → 钳到 0…20，正好盖住 x 15–19 的红。
  // 红必须落在这个窗口里：写成 x ≥ 20 就刚好被 `x1` 的开区间排除，
  // 用例会变成「邻域分桶拿不到红」的假阳性（第一版就是这么写的）。
  const size = 30;
  const source = paintSource(size, size, (x) => (x < 15 ? NAVY : RED));
  const near = neighbourhoodBuckets(source, { x0: 0, y0: 0, x1: 10, y1: 10 }, { bucketStep: 10 });
  const own = topBuckets(buildLabBuckets(source, { x0: 0, y0: 0, x1: 10, y1: 10 }, { bucketStep: 10 }).buckets, 4, 0.08);
  assert.equal(own.length, 1, "本格只有深底一个桶");
  assert.ok(near.length >= 1);
  assert.ok(sourceSupport(near, labOf(RED)) > 0, "邻域里应当能看见红");
  assert.equal(sourceSupport(own, labOf(RED)), 0, "本格里看不见红 —— 这正是邻域项存在的理由");
});

/* =========================================================
 * ④ 越界惩罚：折中色不许胜出
 * ======================================================= */

test("§12.4 取证（反向验证）：纯 §6 口径下，折中色 C06 确实会赢", () => {
  // 这一条是**活的证据**：没有它，下面两条「折中色不许赢」的断言
  // 可能只是「夹具里根本没有折中色」的假绿灯。
  const lab = createBeanFit({ id: "pure-6", mode: "portrait", minSupport: 0, supportPenalty: 0 });
  const ctx = makeMatchCtx();
  const got = lab.matchCell(ctx);
  assert.ok(got, "纯 §6 应当给出意见");
  assert.equal(got.code, "C06", `纯 §6 应当选中折中色，实得 ${got.code}`);
  assert.equal(sourceSupport(keptOfSplitCell(), labOf(got.rgb)), 0,
    "这个被选中的色必须真的「源图里没有」—— 否则这条用例证明不了任何事");
});

test("§12.4 soft 档：越界惩罚把折中色压下去，选中的色必须有源色支持", () => {
  const lab = createBeanFit({ id: "soft", mode: "portrait" });
  const ctx = makeMatchCtx();
  const got = lab.matchCell(ctx);
  assert.ok(got);
  assert.notEqual(got.code, "C06", "折中色不该再胜出");
  assert.ok(sourceSupport(keptOfSplitCell(), labOf(got.rgb)) >= DEFAULT_BEAN_FIT_OPTIONS.minSupport,
    `选中的 ${got.code} 必须被源色支持`);
  assert.equal(ctx.report.beanFit.policy, "allow");
  assert.equal(ctx.report.beanFit.supportMode, "soft");
});

test("§12.4 hard 档：候选池被限制在「有源色支持」的那些色里", () => {
  const lab = createBeanFit({ id: "hard", mode: "anime" });
  const ctx = makeMatchCtx();
  const got = lab.matchCell(ctx);
  assert.ok(got);
  assert.ok(sourceSupport(keptOfSplitCell(), labOf(got.rgb)) >= DEFAULT_BEAN_FIT_OPTIONS.minSupport);
  assert.equal(ctx.report.beanFit.supportMode, "hard");
  assert.ok(ctx.report.beanFit.supportRejected > 0, "硬门必须记下被排除的候选数");
});

test("§12.4 hard 档：池子空了就弃权（退回生产），而不是硬挑一个", () => {
  // 色卡里一个色都不在源色桶的 τ 邻域内 → 硬门必须 abstain
  const farPalette = [
    { code: "WHITE", rgb: [255, 255, 255] },
    { code: "CYAN", rgb: [0, 255, 255] },
    { code: "YELLOW", rgb: [255, 255, 0] },
  ];
  const lab = createBeanFit({ id: "hard-empty", mode: "anime" });
  const ctx = {
    source: splitCellSource(),
    bounds: BOUNDS,
    palette: farPalette,
    paletteEngine: { match: () => farPalette[0] },
    rgb: { r: RED[0], g: RED[1], b: RED[2] },
    report: {},
  };
  assert.equal(lab.matchCell(ctx), undefined, "没有可用的源色支持候选时必须弃权");
  assert.equal(ctx.report.beanFit.abstained, 1);
});

test("§12.4 邻域项是懒计算的：领先候选已达标时一次都不算", () => {
  // 深底 84% / 红 16% 的格子：纯深底色领先且被支持 → 不该付 3×3 的代价
  const size = 10;
  const source = paintSource(size, size, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6 ? RED : NAVY));
  const ctx = {
    source,
    bounds: BOUNDS,
    palette: SPLIT_PALETTE,
    paletteEngine: productionPicksRed,
    rgb: { r: NAVY[0], g: NAVY[1], b: NAVY[2] },
    report: {},
  };
  createBeanFit({ id: "lazy", mode: "portrait" }).matchCell(ctx);
  assert.equal(ctx.report.beanFit.neighbourhoodApplied, 0, "领先候选已达标就不该算邻域");

  // 50/50 且色卡里没有深底的近邻 → 领先候选是折中色（支持 0）→ 必须算邻域
  const ctx2 = makeMatchCtx();
  createBeanFit({ id: "lazy2", mode: "portrait", supportPenalty: 0, minSupport: 0.25 }).matchCell(ctx2);
  assert.equal(ctx2.report.beanFit.neighbourhoodApplied, 1, "领先候选未达标时必须算邻域");
});

test("§12.4 确定性：同一输入两次，逐格相同", () => {
  const source = splitCellSource(8, 6);
  const common = { source, width: 6, height: 6, palette: CELL_PALETTE };
  const a = runEngine({ ...common, lab: createBeanFit({ mode: "portrait" }) });
  const b = runEngine({ ...common, lab: createBeanFit({ mode: "portrait" }) });
  assert.equal(gridHash(a.grid), gridHash(b.grid));
  assert.equal(codesOf(a.grid), codesOf(b.grid));
});

test("§12.4 色卡安全：soft / hard 两档都只可能出色卡里的色号", () => {
  const source = splitCellSource(8, 6);
  const allowed = new Set(CELL_PALETTE.map((c) => c.code));
  for (const mode of ["portrait", "anime", "illustration"]) {
    const result = runEngine({ source, width: 6, height: 6, palette: CELL_PALETTE, lab: createBeanFit({ mode }) });
    for (const code of usedOf(result.grid)) assert.ok(allowed.has(code), `${mode} 档越界色号 ${code}`);
  }
});

/* =========================================================
 * ⑤ 真实夹具 D 的端到端回归
 * ======================================================= */

test("§12.4 真实夹具 D：pixel 策略 OFF ⇒ 不再 6 色变 8 色（逐位等于生产）", () => {
  const cls = B4_BENCH_CLASSES.find((c) => c.id === "D");
  const inputs = benchInputs(cls);
  const routed = resolveRoutedMode("auto", analyzeRoutingEvidence(inputs.source));
  // 先把前提钉住：D 现在路由到 pixel。若哪天路由改了，这条用例要**报错**，
  // 而不是悄悄变成一条「在两个非 pixel 模式之间比较」的无意义断言。
  assert.equal(routed, "pixel", `D 必须路由到 pixel（§12.3 的结论），实得 ${routed}`);

  const production = runBenchCase(cls, "auto", { inputs });
  const gated = runBenchCase(cls, "auto", { inputs, lab: createBeanFit({ mode: routed }) });
  assert.equal(gated.usedColors, production.usedColors, "策略 OFF 下不该改变用色数");
  assert.equal(gated.gridHash, production.gridHash, "策略 OFF 下应当逐位相同");
});

test("§12.4 真实夹具 D 反事实：强制 allow + 越界惩罚，同样不再增色", () => {
  // 这一条回答的是「如果哪天策略放宽了，越界惩罚还挡不挡得住」。
  // 实测：惩罚本身就把 6→8 压回 6，所以策略 OFF 与惩罚是两道独立的闸门。
  const cls = B4_BENCH_CLASSES.find((c) => c.id === "D");
  const inputs = benchInputs(cls);
  const production = runBenchCase(cls, "auto", { inputs });
  const forced = runBenchCase(cls, "auto", { inputs, lab: createBeanFit({ mode: "portrait" }) });
  assert.ok(forced.usedColors <= production.usedColors,
    `强制 allow 后仍不该增色：生产 ${production.usedColors} → 实得 ${forced.usedColors}`);

  // 反向验证：纯 §6 口径下**确实**会增色。没有这一条，上面那句可能恒真。
  const pure = runBenchCase(cls, "auto", {
    inputs,
    lab: createBeanFit({ mode: "portrait", minSupport: 0, supportPenalty: 0 }),
  });
  assert.ok(pure.usedColors > production.usedColors,
    `纯 §6 应当复现 6→8 的越界增色，实得 ${production.usedColors}→${pure.usedColors}；`
    + "若这里不成立，说明夹具或算法已经变了，上面那条断言要重新推导");
});
