/**
 * B2 §14 METRICS REPORT
 *
 * 把 §13 的 8 类测试图逐张跑过可靠性门，输出一张可直接贴进 STAGE B2 RESULT 的
 * markdown 表：status / removedCount / removedRatio / 5 项指标 / reason。
 *
 * 用法：
 *   node tools/b2-metrics-report.mjs            # markdown 表
 *   node tools/b2-metrics-report.mjs --json     # 原始 JSON（供脚本消费）
 *
 * 注意：这里用的是与单元测试**完全同一份** fixture 构造代码
 * （tests/background-fixtures.mjs），不是另抄一遍的样例。
 */

import { BACKGROUND_FIXTURES, materializeFixture } from "../tests/background-fixtures.mjs";
import { resolveBackgroundDecision } from "../smart-preprocessing/background-reliability.mjs";

const asJson = process.argv.includes("--json");

const rows = BACKGROUND_FIXTURES.map((fixture) => {
  const f = materializeFixture(fixture);
  const d = resolveBackgroundDecision({
    rgbGrid: f.data.rgbGrid,
    alphaGrid: f.data.alphaGrid,
    grid: f.data.grid,
    width: f.data.width,
    height: f.data.height,
  });
  const m = d.metrics || {};
  return {
    id: fixture.id,
    className: fixture.className,
    expect: fixture.expect,
    status: d.status,
    match: d.status === fixture.expect,
    removedCount: d.removedCount,
    removedRatio: Number(d.removedRatio.toFixed(4)),
    borderConsistency: m.borderConsistency ?? null,
    seedAgreement: m.seedAgreement ?? null,
    foregroundSeparation: m.foregroundSeparation ?? null,
    connectivity: m.connectivity ?? null,
    interiorRisk: m.interiorRisk ?? null,
    reason: d.reason || "",
  };
});

if (asJson) {
  console.log(JSON.stringify(rows, null, 2));
} else {
  const num = (v) => (v === null || v === undefined ? "—" : String(v));
  console.log("| # | 图片 | 期望 | 实际 | removedCount | removedRatio | borderConsistency | foregroundSeparation | interiorRisk | 判定 |");
  console.log("|---|---|---|---|---|---|---|---|---|---|");
  rows.forEach((r, i) => {
    console.log(
      `| ${i + 1} | ${r.className} | ${r.expect} | ${r.status} | ${r.removedCount} | ${r.removedRatio} | ` +
        `${num(r.borderConsistency)} | ${num(r.foregroundSeparation)} | ${num(r.interiorRisk)} | ${r.match ? "PASS" : "FAIL"} |`,
    );
  });
  const pass = rows.filter((r) => r.match).length;
  console.log("");
  console.log(`期望符合：${pass}/${rows.length}`);
  const mismatched = rows.filter((r) => !r.match);
  if (mismatched.length) {
    console.log("");
    for (const r of mismatched) {
      console.log(`- ${r.id}: 期望 ${r.expect}，实得 ${r.status}（${r.reason}）`);
    }
  }
}

process.exit(rows.every((r) => r.match) ? 0 : 1);
