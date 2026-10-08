/**
 * Protection Gate Audit Runner —— 一次性跑完 Phase B.1 审计并写出报告。
 *
 * 用法：
 *   node run-protection-audit.mjs [--out docs/research/HYBRID_V2_PROTECTION_GATE_AUDIT.md] [--force-gen]
 *
 * 默认：若 tests/fixtures/real-failures/ 缺失则自动生成真实缺陷夹具。
 *   --force-gen 强制重新生成夹具（覆盖已存在的 image.png / metadata.json）。
 *
 * ⚠️ 本脚本只产出数字与方向性判定，**不产出 winner、不产出总分、不声称更优**。
 */

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runProtectionGateAudit, renderProtectionGateAuditReport } from "./protection-audit.mjs";
import { generateRealFailureFixtures, REAL_FAILURES_DIR } from "./real-failures.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_OUT = join(__dirname, "..", "..", "..", "..", "docs", "research", "HYBRID_V2_PROTECTION_GATE_AUDIT.md");

function parseArgs(argv) {
  const out = { out: null, forceGen: false };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === "--out") out.out = argv[++i];
    else if (argv[i] === "--force-gen") out.forceGen = true;
  }
  out.out = out.out || DEFAULT_OUT;
  return out;
}

const args = parseArgs(process.argv);

// 1) 确保真实缺陷夹具存在
const created = generateRealFailureFixtures(REAL_FAILURES_DIR, { force: args.forceGen });
console.error(`[audit] real-failure fixtures ready: ${created.length}`);

// 2) 运行审计
const result = runProtectionGateAudit({ rootDir: REAL_FAILURES_DIR });
console.error(
  `[audit] proposals=${result.total.proposalCount} rejectedByProtection=${result.total.rejectedByProtection}`
  + ` fixtures=${result.fixtureCount}`,
);

// 3) 渲染并写报告
const md = renderProtectionGateAuditReport(result);
mkdirSync(dirname(args.out), { recursive: true });
writeFileSync(args.out, md, "utf8");
console.error(`[audit] report written → ${args.out}`);
console.log(md);
