/**
 * background-reliability.test.mjs — Stage B2 §2 §3 §4 §5 §13 §15
 *
 * 验的是「背景检测可靠性门」本身：
 *   · 10 个夹具的结论与预期逐一对上（§13 的 8 类 + 2 个变体）
 *   · 门是**多指标**的 —— 五个指标每一个都能单独把结论打回 uncertain（§3）
 *   · uncertain / none 一律 NO-OP：mask === null、removedCount === 0（§4 §5）
 *   · 不针对样例写特判（§15）
 *   · 确定性、结构化克隆安全（§16 的前半）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BACKGROUND_FIXTURES, materializeFixture } from "./background-fixtures.mjs";
import {
  BACKGROUND_STATUS,
  BACKGROUND_KEEP_MESSAGE,
  DEFAULT_RELIABILITY_CONFIG,
  assessBackgroundReliability,
  formatBackgroundRemovalMessage,
  resolveBackgroundDecision,
} from "../smart-preprocessing/background-reliability.mjs";
import { resolveBackgroundMask } from "../smart-preprocessing/auto-background.mjs";

const decide = (fixtureId, options) => {
  const fixture = BACKGROUND_FIXTURES.find((item) => item.id === fixtureId);
  assert.ok(fixture, `夹具不存在：${fixtureId}`);
  const data = materializeFixture(fixture).data;
  return resolveBackgroundDecision({
    rgbGrid: data.rgbGrid,
    alphaGrid: data.alphaGrid,
    grid: data.grid,
    width: data.width,
    height: data.height,
    options,
  });
};

/* =========================================================
 * §13 数据集
 * ======================================================= */

test("§13：10 个夹具的结论与预期一致（8 类 + 2 变体）", () => {
  const report = [];
  for (const fixture of BACKGROUND_FIXTURES) {
    const data = materializeFixture(fixture).data;
    const decision = resolveBackgroundDecision({
      rgbGrid: data.rgbGrid,
      alphaGrid: data.alphaGrid,
      grid: data.grid,
      width: data.width,
      height: data.height,
    });
    report.push(`${fixture.id}: ${decision.status}${decision.reason ? ` (${decision.reason})` : ""}`);
    assert.equal(
      decision.status,
      fixture.expect,
      `${fixture.className} → 期望 ${fixture.expect}，实得 ${decision.status}（${decision.reason}）`,
    );
  }
  assert.equal(report.length, BACKGROUND_FIXTURES.length);
});

test("§13：数据集本身覆盖了 8 类，且每一类都有明确的预期结论", () => {
  assert.ok(BACKGROUND_FIXTURES.length >= 8, "至少 8 个夹具");
  const ids = new Set(BACKGROUND_FIXTURES.map((f) => f.id));
  assert.equal(ids.size, BACKGROUND_FIXTURES.length, "夹具 id 不能重复");
  for (const fixture of BACKGROUND_FIXTURES) {
    assert.ok(fixture.className, `${fixture.id} 缺少类名`);
    assert.ok(fixture.why, `${fixture.id} 缺少「为什么是这个结论」的说明`);
    assert.ok(
      Object.values(BACKGROUND_STATUS).includes(fixture.expect),
      `${fixture.id} 的 expect 必须是三态之一`,
    );
    assert.equal(typeof fixture.paint, "function");
  }
  // 三态都要被数据集覆盖到，否则门的一侧等于没测
  const expects = new Set(BACKGROUND_FIXTURES.map((f) => f.expect));
  assert.ok(expects.has(BACKGROUND_STATUS.RELIABLE));
  assert.ok(expects.has(BACKGROUND_STATUS.UNCERTAIN));
  assert.ok(expects.has(BACKGROUND_STATUS.NONE));
});

/* =========================================================
 * §3 多指标门
 * ======================================================= */

test("§3：五个指标都是「承重」的 —— 任一项收紧到不可能通过，结论就必须退回非 reliable", () => {
  const baseline = decide("white-logo");
  assert.equal(baseline.status, BACKGROUND_STATUS.RELIABLE, "基线必须先是 reliable，否则这组断言没意义");

  const vetoes = {
    borderConsistency: { borderConsistencyMin: 1.01 },
    seedAgreement: { seedAgreementMax: -1 },
    foregroundSeparation: { foregroundSeparationMin: 1e9 },
    connectivity: { connectivityMin: 1.01 },
    interiorRisk: { interiorRiskMax: -1 },
  };
  for (const [metric, patch] of Object.entries(vetoes)) {
    const decision = decide("white-logo", patch);
    assert.notEqual(
      decision.status,
      BACKGROUND_STATUS.RELIABLE,
      `收紧 ${metric} 之后仍然是 reliable —— 说明这个指标没有真的参与判定`,
    );
    assert.equal(decision.mask, null, `${metric} 被否掉后不得留下掩码`);
  }
});

test("§3：结论不是「单一 ΔE 阈值」—— 配置里五个门槛彼此独立", () => {
  const keys = [
    "borderConsistencyMin",
    "seedAgreementMax",
    "foregroundSeparationMin",
    "connectivityMin",
    "interiorRiskMax",
  ];
  for (const key of keys) assert.equal(typeof DEFAULT_RELIABILITY_CONFIG[key], "number", `${key} 缺失`);
  // 五个门槛各自独立地出现在判定逻辑里（不是「配了但没用」）
  const source = readFileSync(new URL("../smart-preprocessing/background-reliability.mjs", import.meta.url), "utf8");
  for (const key of keys) {
    assert.match(source, new RegExp(`cfg\\.${key}`), `${key} 没有真的参与判定`);
  }
  // 只有 5 个指标，没有第 6 个隐藏判据
  const decision = decide("white-logo");
  assert.deepEqual(
    Object.keys(decision.metrics).sort(),
    ["borderConsistency", "connectivity", "foregroundSeparation", "interiorRisk", "seedAgreement"],
  );
});

test("§3：种子一致性确实会拦住「边框上还有另一种浅色」的图", () => {
  // 白底 + 左上角一小块淡蓝。两种颜色都够亮够中性（都是候选），
  // 但 ΔE 超过 flood 的跨色门槛 → 会形成**两个**背景区、两个不同的种子色。
  // 边框主流色覆盖率仍然很高（淡蓝只占 7/156），所以 A 会放过它 ——
  // 这一条专门验 B 是承重的。
  const size = 40;
  const WHITE_BG = { r: 215, g: 255, b: 255 };
  const PALE_BLUE = { r: 250, g: 215, b: 220 };
  const SUBJECT = { r: 20, g: 20, b: 24 };
  const rgbGrid = [];
  const grid = [];
  for (let y = 0; y < size; y += 1) {
    const rgbRow = [];
    const gridRow = [];
    for (let x = 0; x < size; x += 1) {
      const isSubject = x >= 16 && x <= 23 && y >= 16 && y <= 23;
      const isPatch = x <= 3 && y <= 3;
      const rgb = isSubject ? SUBJECT : (isPatch ? PALE_BLUE : WHITE_BG);
      rgbRow.push(rgb);
      gridRow.push({ code: `R${rgb.r}G${rgb.g}B${rgb.b}`, rgb: [rgb.r, rgb.g, rgb.b] });
    }
    rgbGrid.push(rgbRow);
    grid.push(gridRow);
  }
  const decision = resolveBackgroundDecision({ rgbGrid, grid, width: size, height: size });
  assert.ok(decision.detail.regionCount >= 2, `应该形成至少两个背景区，实得 ${decision.detail.regionCount}`);
  assert.ok(
    decision.metrics.seedAgreement > DEFAULT_RELIABILITY_CONFIG.seedAgreementMax,
    `种子色差异应该超线，实得 ${decision.metrics.seedAgreement}`,
  );
  assert.notEqual(decision.status, BACKGROUND_STATUS.RELIABLE, "两种浅色背景不该被判成可安全移除");
  assert.equal(decision.mask, null);
});

/* =========================================================
 * §4 / §5 SAFE DEFAULT
 * ======================================================= */

test("§4：uncertain / none 一律 NO-OP —— mask 必须是 null、removedCount 必须是 0", () => {
  for (const fixture of BACKGROUND_FIXTURES) {
    const data = materializeFixture(fixture).data;
    const decision = resolveBackgroundDecision({
      rgbGrid: data.rgbGrid,
      alphaGrid: data.alphaGrid,
      grid: data.grid,
      width: data.width,
      height: data.height,
    });
    if (decision.status === BACKGROUND_STATUS.RELIABLE) continue;
    assert.equal(decision.mask, null, `${fixture.id}：非 reliable 却给出了掩码 —— 这就是「半抠」的入口`);
    assert.equal(decision.removedCount, 0, `${fixture.id}：非 reliable 却报了移除格数`);
    assert.equal(decision.removedRatio, 0);
    assert.ok(decision.reason, `${fixture.id}：非 reliable 必须给出可读原因`);
  }
});

test("§4：reliable 时才给出掩码，且掩码尺寸与网格一致（不存在 partial mask）", () => {
  for (const fixture of BACKGROUND_FIXTURES) {
    const data = materializeFixture(fixture).data;
    const decision = resolveBackgroundDecision({
      rgbGrid: data.rgbGrid,
      alphaGrid: data.alphaGrid,
      grid: data.grid,
      width: data.width,
      height: data.height,
    });
    if (decision.mask) {
      assert.equal(decision.status, BACKGROUND_STATUS.RELIABLE);
      assert.equal(decision.mask.length, data.width * data.height);
      assert.ok(decision.removedCount > 0, "reliable 却一格都不移除 —— 应该在 removedRatio 门槛处降级");
    }
    // 原始掩码始终带出来，只给诊断用
    assert.equal(decision.backgroundMask.length, data.width * data.height);
  }
});

test("§5：none 与 uncertain 是两件事，文案也不同", () => {
  assert.equal(decide("blue-logo-saturated").status, BACKGROUND_STATUS.NONE);
  assert.equal(decide("transparent-png").status, BACKGROUND_STATUS.NONE);
  assert.equal(decide("white-shirt-faint").status, BACKGROUND_STATUS.UNCERTAIN);
  assert.equal(decide("gray-gradient").status, BACKGROUND_STATUS.UNCERTAIN);
  // none 的原因是「本来就没有」，不是「算不出来」
  assert.match(decide("blue-logo-saturated").reason, /没有纯色背景/);
});

test("§7：保持原图的文案固定，且不含「失败 / 错误」这类词", () => {
  assert.equal(BACKGROUND_KEEP_MESSAGE, "这张图没有检测到可以安全分离的纯色背景，已保持原图。");
  assert.doesNotMatch(BACKGROUND_KEEP_MESSAGE, /失败|错误/);
  assert.equal(formatBackgroundRemovalMessage(120, 0.15), "检测到可安全移除背景 · 预计移除 120 格 · 15%");
  assert.equal(formatBackgroundRemovalMessage(3, 0.0031), "检测到可安全移除背景 · 预计移除 3 格 · 0.3%");
});

/* =========================================================
 * §15 / §16 纪律
 * ======================================================= */

test("§15：算法模块里没有任何针对样例的特判", () => {
  const source = readFileSync(new URL("../smart-preprocessing/background-reliability.mjs", import.meta.url), "utf8");
  // 只扫代码行：注释里解释「为什么不能这么写」时会自然出现样例名，
  // 把注释算进来会让这道守卫变成「谁解释谁违规」。
  const codeOnly = source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
  for (const fixture of BACKGROUND_FIXTURES) {
    assert.doesNotMatch(codeOnly, new RegExp(fixture.id), `模块里出现了夹具 id「${fixture.id}」`);
  }
  for (const name of ["white-shirt", "blue-logo", "gray-gradient", "corner-touch"]) {
    assert.doesNotMatch(codeOnly, new RegExp(name), `模块里出现了样例名「${name}」`);
  }
  // 变异自检：守卫真的能抓到东西（否则「全绿」可能只是正则写错了）
  assert.match(`${codeOnly}\nconst x = "gray-gradient";`, /gray-gradient/, "守卫正则本身必须有效");
});

test("§16：同一输入必得同一输出（确定性）", () => {
  for (const fixture of BACKGROUND_FIXTURES) {
    const data = materializeFixture(fixture).data;
    const args = { rgbGrid: data.rgbGrid, alphaGrid: data.alphaGrid, grid: data.grid, width: data.width, height: data.height };
    const a = resolveBackgroundDecision(args);
    const b = resolveBackgroundDecision(args);
    assert.equal(a.status, b.status, `${fixture.id} 结论不稳定`);
    assert.deepEqual(a.metrics, b.metrics, `${fixture.id} 指标不稳定`);
    assert.equal(a.removedCount, b.removedCount);
  }
});

test("§16：结论是结构化克隆安全的（能原样穿过 Worker 边界）", () => {
  const decision = decide("white-logo");
  const cloned = structuredClone({
    status: decision.status,
    removedCount: decision.removedCount,
    removedRatio: decision.removedRatio,
    metrics: decision.metrics,
    reason: decision.reason,
    detail: decision.detail,
    mask: decision.mask,
  });
  assert.equal(cloned.status, decision.status);
  assert.deepEqual(cloned.metrics, decision.metrics);
  assert.ok(cloned.mask instanceof Uint8Array);
});

test("§16：算法模块不碰 DOM / window / 应用 state", () => {
  const source = readFileSync(new URL("../smart-preprocessing/background-reliability.mjs", import.meta.url), "utf8");
  const codeOnly = source
    .split("\n")
    .filter((line) => {
      const t = line.trim();
      return !(t.startsWith("//") || t.startsWith("*") || t.startsWith("/*"));
    })
    .join("\n");
  for (const banned of ["document.", "window.", "localStorage", "libmsStore", "requestAnimationFrame"]) {
    assert.ok(!codeOnly.includes(banned), `算法模块里出现了 ${banned}`);
  }
});

test("空输入 / 退化输入不崩，且结论是 none", () => {
  const empty = resolveBackgroundDecision({ rgbGrid: [], width: 0, height: 0 });
  assert.equal(empty.status, BACKGROUND_STATUS.NONE);
  assert.equal(empty.mask, null);
  const single = resolveBackgroundDecision({
    rgbGrid: [[{ r: 250, g: 250, b: 250 }]],
    width: 1,
    height: 1,
  });
  assert.ok(Object.values(BACKGROUND_STATUS).includes(single.status));
});

test("assessBackgroundReliability 与 resolveBackgroundDecision 结论一致（同一个门）", () => {
  const fixture = BACKGROUND_FIXTURES.find((f) => f.id === "white-logo");
  const data = materializeFixture(fixture).data;
  const maskResult = resolveBackgroundMask({
    rgbGrid: data.rgbGrid, width: data.width, height: data.height, alphaGrid: data.alphaGrid,
  });
  const assess = assessBackgroundReliability({
    rgbGrid: data.rgbGrid,
    alphaGrid: data.alphaGrid,
    width: data.width,
    height: data.height,
    backgroundMask: maskResult.backgroundMask,
    regionSeeds: maskResult.regionSeeds,
    regionCount: maskResult.regionCount,
    diagnostics: maskResult.diagnostics,
  });
  assert.equal(assess.status, decide("white-logo").status);
  assert.deepEqual(assess.metrics, decide("white-logo").metrics);
});
