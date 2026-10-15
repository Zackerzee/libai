/**
 * 阶段 4 裁定守卫 —— §15 的四条裁定不许被悄悄改写。
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────────────
 * 跑分器（`tools/b4-lab.mjs`）刻意**不写任何决策** —— 决策在报告里。
 * 但「决策在报告里」有一个已知的失效形状：报告是散文，配置是代码。
 * 下一个人想让某个候选跑起来，会去改配置；CI 不会红，因为没有任何
 * 测试知道「这个 id 已经被裁掉了」。
 *
 * B4 已经用 `tests/auto-tune-profile-registry.test.mjs` 的 REJECT 名单
 * 挡住了这条路径。本文件把**阶段 4 的四条裁定**接到同一道防线上：
 *   ① 矩阵里每个非 current 条目都必须有一条裁定；
 *   ② REJECT 的 id 不许出现在 `AUTO_TUNE_LAB_CANDIDATES` / `PRODUCTION_LAB_CANDIDATES`
 *      或任何 Auto Tune Profile 的 `labCandidate` 上；
 *   ③ `STAGE4_PRODUCTION_CANDIDATES` 必须保持空集（本阶段零生产改动）。
 *
 * 另外钉住 `STAGE4_MATRIX` 与裁定的 **id 集合逐字相等** ——
 * 加了实验却没写裁定（或写了裁定却没有实验）都会立刻红。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { STAGE4_MATRIX } from "../smart-preprocessing/lab/stage4-matrix.mjs";
import {
  STAGE4_VERDICTS,
  STAGE4_VERDICT_BY_ID,
  STAGE4_REJECTED,
  STAGE4_PRODUCTION_CANDIDATES,
  STAGE4_MODE_SPECIFIC,
} from "../smart-preprocessing/lab/stage4-verdicts.mjs";
import {
  AUTO_TUNE_LAB_CANDIDATES,
  PRODUCTION_LAB_CANDIDATES,
  AUTO_TUNE_PROFILES,
} from "../services/auto-tune-profiles.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VALID_VERDICTS = ["KEEP", "REJECT", "MODE-SPECIFIC"];

/* ══════════════════════════════════════════════════════════════════
 * ① 裁定表自身的形状
 * ══════════════════════════════════════════════════════════════════ */

test("① 每条裁定都有合法 verdict 与可复核的 evidence（不是形容词）", () => {
  assert.ok(STAGE4_VERDICTS.length >= 4, `裁定太少（${STAGE4_VERDICTS.length}）`);
  for (const entry of STAGE4_VERDICTS) {
    assert.ok(VALID_VERDICTS.includes(entry.verdict), `${entry.id} 的 verdict 非法：${entry.verdict}`);
    assert.equal(typeof entry.label, "string");
    assert.ok(entry.reason && entry.reason.length >= 20, `${entry.id} 的 reason 太短，不像一条结论`);
    assert.ok(entry.evidence && entry.evidence.length >= 10, `${entry.id} 缺少 evidence 锚点`);
    assert.ok(entry.metrics && typeof entry.metrics === "object", `${entry.id} 缺少 metrics`);
  }
});

test("② 裁定 id 集合与 STAGE4_MATRIX 的 id 集合逐字相等（不许有漏裁/多裁）", () => {
  // kit-limit 在矩阵里是 24/48/96 三列，裁定只有一条 —— 这是刻意的：
  // 三档是同一次测量的三个参数点，不是三个候选。所以先把三档折叠成 `kit-limit`
  // 再比对，比对的是「实验」的集合，不是「列」的集合。
  const normalize = (id) => (id.startsWith("kit-limit") ? "kit-limit" : id);
  const matrixExperiments = [...new Set(STAGE4_MATRIX.filter((e) => e.id !== "current").map((e) => normalize(e.id)))];
  const verdictIds = STAGE4_VERDICTS.map((e) => e.id);
  assert.deepEqual(
    [...verdictIds].sort(),
    [...matrixExperiments].sort(),
    "矩阵里的实验与裁定表对不上 —— 加了实验就必须写裁定",
  );
  assert.ok(verdictIds.includes("kit-limit"), "kit-limit 的裁定必须存在（三档共用一条）");
});

test("③ 每条 evidence 指向的文件都真实存在（防止锚点腐烂）", () => {
  for (const entry of STAGE4_VERDICTS) {
    // evidence 里可能有多段，逐段找 `docs/...` 或 `tests/...` 形式的本仓库路径
    const refs = entry.evidence.match(/(?:docs|tests|tools|services|smart-preprocessing)\/[\w./-]+/g) || [];
    assert.ok(refs.length >= 1, `${entry.id} 的 evidence 里没有本仓库路径`);
    for (const ref of refs) {
      assert.ok(fs.existsSync(path.join(ROOT, ref)), `${entry.id} 的 evidence 指向不存在的路径：${ref}`);
    }
  }
});

/* ══════════════════════════════════════════════════════════════════
 * ② REJECT 名单守卫（接上 B4 那道防线）
 * ══════════════════════════════════════════════════════════════════ */

test("④ REJECT 的候选不许出现在 Auto Tune 搜索空间里", () => {
  assert.ok(STAGE4_REJECTED.length >= 1, "REJECT 名单为空说明裁定表写错了");
  for (const banned of STAGE4_REJECTED) {
    assert.ok(!AUTO_TUNE_LAB_CANDIDATES.includes(banned), `${banned} 被放回 Auto Tune 搜索空间`);
    assert.ok(!PRODUCTION_LAB_CANDIDATES.includes(banned), `${banned} 被放回生产 lab 白名单`);
  }
  for (const p of AUTO_TUNE_PROFILES) {
    for (const banned of STAGE4_REJECTED) {
      assert.notEqual(p.labCandidate, banned, `${p.id} 挂了 REJECT 的 ${banned}`);
      assert.ok(!p.id.includes(banned), `候选 id ${p.id} 里出现了 REJECT 的 ${banned}`);
    }
  }
});

test("⑤ REJECT 名单里不含任何 B4 已裁的四个算法之外的意外项", () => {
  // 反向守卫：如果有人把 `bean-fit` 误写进 REJECT，这条会红 ——
  // bean-fit 是 B4 唯一 KEEP 的候选，它必须留在白名单里。
  assert.ok(!STAGE4_REJECTED.includes("bean-fit"), "bean-fit 是 B4 唯一 KEEP 的候选，不该被阶段 4 裁掉");
  for (const banned of STAGE4_REJECTED) {
    assert.match(banned, /^[a-z][a-z0-9-]*$/, `${banned} 不像一个候选 id`);
  }
});

/* ══════════════════════════════════════════════════════════════════
 * ③ 零生产改动（本阶段的结论）
 * ══════════════════════════════════════════════════════════════════ */

test("⑥ 阶段 4 零生产改动：STAGE4_PRODUCTION_CANDIDATES 必须是空集", () => {
  assert.deepEqual(
    [...STAGE4_PRODUCTION_CANDIDATES], [],
    "阶段 4 四项实验无一过 KEEP 门槛，生产默认路径必须零改动。"
    + "要往这里加 id，必须先有一条 KEEP 裁定 + §14 人工看图背书，并显式改这条断言。",
  );
});

test("⑦ MODE-SPECIFIC 只允许 opt-in：不得出现在生产默认路径", () => {
  for (const id of STAGE4_MODE_SPECIFIC) {
    assert.ok(!STAGE4_PRODUCTION_CANDIDATES.includes(id), `${id} 是 MODE-SPECIFIC，不得进默认路径`);
  }
  // kit-limit 是唯一的 MODE-SPECIFIC —— 它的语义是「用户约束」而不是「默认优化」
  assert.deepEqual([...STAGE4_MODE_SPECIFIC], ["kit-limit"], "MODE-SPECIFIC 集合被改动");
});

test("⑧ 阶段 4 候选全部只存在于 lab/ 目录，没有被 import 进生产服务", () => {
  // 结构性保证：候选算法只能从 `lab/` 里被 `tools/` 与 `tests/` 引用。
  // 一旦某个 `services/` 或 `ui/` 文件 import 了它们，就说明有候选越过了裁定。
  const bannedModules = ["adaptive-v2.mjs", "chroma-prescreen.mjs", "kit-limit.mjs", "stage4-matrix.mjs", "stage4-verdicts.mjs"];
  const prodDirs = ["services", "ui", "state", "smart-preprocessing"];
  const hits = [];
  const walk = (dir) => {
    for (const name of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, name.name);
      if (name.isDirectory()) {
        if (name.name === "lab" || name.name === "node_modules") continue;
        walk(full);
      } else if (/\.(mjs|js)$/.test(name.name)) {
        const text = fs.readFileSync(full, "utf8");
        for (const banned of bannedModules) {
          if (text.includes(banned)) hits.push(`${path.relative(ROOT, full)} → ${banned}`);
        }
      }
    }
  };
  for (const dir of prodDirs) {
    const full = path.join(ROOT, dir);
    if (fs.existsSync(full)) walk(full);
  }
  assert.deepEqual(hits, [], `阶段 4 候选被生产代码引用了：\n${hits.join("\n")}`);
});
