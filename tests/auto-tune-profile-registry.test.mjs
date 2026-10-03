/**
 * Stage B4 §13.7 —— Auto Tune Profile Registry 契约（§2 / §3 / §4 / §9 / §10）。
 *
 * 这个文件守的是**搜索空间的形状**，不是某个候选的数字：
 *
 *   · §2 每个模式 2–4 个候选（pixel / logo 例外，§9 只允许一个）。
 *   · §3 候选只写**增量**，必须能挂回现有 ModeProfile；不许复制整份配置。
 *   · §4 资格表是硬的：不在表里的候选，分数再高也进不来。
 *   · §6 取景不变量一个都不许调 —— 调了就换了算法，不是「保守一点」。
 *   · §10 目标表是**有序判据**，不是权重表。出现 `weight` 就是走错路了。
 *   · §0 REJECT 的四个算法不许被写回搜索空间。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  GENERATION_MODES,
  MODE_PROFILES,
  MODE_PROFILE_FIELDS,
  MODE_LABELS,
} from "../services/mode-profile.mjs";
import {
  AUTO_TUNE_ELIGIBILITY,
  AUTO_TUNE_LAB_CANDIDATES,
  AUTO_TUNE_PROFILE_BY_ID,
  AUTO_TUNE_PROFILES,
  FRAMING_INVARIANT_FIELDS,
  MODE_OBJECTIVES,
  PRODUCTION_LAB_CANDIDATES,
  TUNEABLE_FIELDS,
  objectiveFor,
  resolveCandidateRequest,
  resolveCandidates,
  standardProfileId,
} from "../services/auto-tune-profiles.mjs";
import { metricKeyProbe } from "./auto-tune-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (...parts) => fs.readFileSync(path.join(ROOT, ...parts), "utf8");

/**
 * §0 明确 REJECT 的算法。它们可以继续在 Lab 跑分器里被**测量**，
 * 但绝不允许出现在 Auto Tune 的搜索空间里。
 */
const REJECTED_ALGORITHMS = ["spatial", "cleanup", "neutral", "dual-mode"];

/* =========================================================
 * §2 / §3 搜索空间的形状
 * ======================================================= */

test("§2 候选表非空，id 唯一，且每个都带模式前缀", () => {
  assert.ok(AUTO_TUNE_PROFILES.length >= 10, `候选太少（${AUTO_TUNE_PROFILES.length}）`);
  const ids = AUTO_TUNE_PROFILES.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length, "候选 id 有重复");
  for (const p of AUTO_TUNE_PROFILES) {
    assert.match(p.id, /^[a-z][a-z-]*-[a-z-]+$/, `${p.id} 看起来没有模式前缀`);
    assert.equal(typeof p.label, "string");
    assert.ok(p.label.length, `${p.id} 没有界面文案`);
    assert.equal(AUTO_TUNE_PROFILE_BY_ID[p.id], p, `${p.id} 没有进索引`);
  }
});

test("§2/§4 每个模式的资格表有序、首项是该模式的 standard、数量 2–4", () => {
  for (const mode of GENERATION_MODES) {
    const ids = AUTO_TUNE_ELIGIBILITY[mode];
    assert.ok(Array.isArray(ids) && ids.length, `${mode} 没有资格表`);
    assert.equal(standardProfileId(mode), ids[0], `${mode} 的 standard 不是首项`);

    // pixel / logo：§9 明确禁止 Auto Tune 改算法 / 扩色，只留一个。
    const expected = mode === "pixel" || mode === "logo" ? 1 : 2;
    if (mode === "pixel" || mode === "logo") {
      assert.equal(ids.length, expected, `${mode} 只该有一个候选（§9）`);
    } else {
      assert.ok(ids.length >= 2 && ids.length <= 4, `${mode} 候选数 ${ids.length} 不在 2–4（§2）`);
    }

    for (const id of ids) {
      assert.ok(AUTO_TUNE_PROFILE_BY_ID[id], `${mode} 引用了不存在的候选 ${id}`);
    }
  }
});

test("§3 没有孤儿候选：每个 Profile 都被某个模式引用", () => {
  const referenced = new Set(Object.values(AUTO_TUNE_ELIGIBILITY).flat());
  for (const p of AUTO_TUNE_PROFILES) {
    assert.ok(referenced.has(p.id), `${p.id} 定义了但没人用 —— 死配置`);
  }
});

test("§3 每个模式的第一个候选是**无覆盖**的 standard（§23 兜底就是它）", () => {
  for (const mode of GENERATION_MODES) {
    const id = standardProfileId(mode);
    const p = AUTO_TUNE_PROFILE_BY_ID[id];
    assert.deepEqual(p.overrides, {}, `${id} 有覆盖项，那就不是 standard 了`);
    assert.equal(p.labCandidate, null, `${id} 挂了 lab 候选，那就不是 standard 了`);
  }
});

/* =========================================================
 * §3 / §6 覆盖项的形状
 * ======================================================= */

test("§6 取景不变量 ∪ 可调字段 == ModeProfile 全字段，且互不相交", () => {
  const all = Object.keys(MODE_PROFILE_FIELDS).sort();
  const union = [...FRAMING_INVARIANT_FIELDS, ...TUNEABLE_FIELDS].sort();
  assert.deepEqual(union, all, "字段划分漏了 ModeProfile 的某个字段");
  for (const f of FRAMING_INVARIANT_FIELDS) {
    assert.ok(!TUNEABLE_FIELDS.includes(f), `${f} 同时在不变量和可调集合里`);
  }
});

test("§6 候选的覆盖项不许碰取景不变量，也不许写不存在的字段", () => {
  const allowed = new Set(TUNEABLE_FIELDS);
  const invariant = new Set(FRAMING_INVARIANT_FIELDS);
  for (const p of AUTO_TUNE_PROFILES) {
    for (const key of Object.keys(p.overrides)) {
      assert.ok(!invariant.has(key),
        `${p.id} 调了取景不变量 ${key} —— §6 明确禁止（那是换算法，不是调保守度）`);
      assert.ok(allowed.has(key), `${p.id} 调了不存在的字段 ${key}`);
    }
  }
});

test("§3 候选只写增量：没有一个候选把整份 ModeProfile 抄一遍", () => {
  const fieldCount = Object.keys(MODE_PROFILE_FIELDS).length;
  for (const p of AUTO_TUNE_PROFILES) {
    const n = Object.keys(p.overrides).length;
    assert.ok(n < fieldCount,
      `${p.id} 覆盖了 ${n}/${fieldCount} 个字段 —— 这是复制配置，不是增量`);
  }
});

test("§3 覆盖项的数值口径与 ModeProfile 一致（0–100 的整数字段）", () => {
  const numeric100 = ["detailProtection", "edgeProtection", "cleanupStrength",
    "highlightProtection", "eyeProtection", "microDetailProtection"];
  for (const p of AUTO_TUNE_PROFILES) {
    for (const [key, value] of Object.entries(p.overrides)) {
      if (numeric100.includes(key)) {
        assert.equal(typeof value, "number", `${p.id}.${key} 不是数字`);
        assert.ok(value >= 0 && value <= 100, `${p.id}.${key} = ${value} 不在 0–100`);
      }
      if (key === "sampling") {
        assert.equal(typeof value, "string", `${p.id}.sampling 不是字符串`);
      }
    }
  }
});

test("§3 覆盖项能挂回 baseProfile：合并后每个键都是 ModeProfile 的键", () => {
  for (const mode of GENERATION_MODES) {
    for (const candidate of resolveCandidates(mode)) {
      const merged = { ...candidate.baseProfile, ...candidate.overrides };
      for (const key of Object.keys(merged)) {
        assert.ok(key in MODE_PROFILE_FIELDS, `${candidate.id} 合并后出现野字段 ${key}`);
      }
      assert.equal(candidate.baseProfile, MODE_PROFILES[mode],
        `${candidate.id} 没挂到 MODE_PROFILES[${mode}] —— §3 要求引用而不是复制`);
    }
  }
});

/* =========================================================
 * §0 REJECT 名单守卫
 * ======================================================= */

test("§0 REJECT 的算法不许出现在 Auto Tune 搜索空间里", () => {
  assert.deepEqual([...AUTO_TUNE_LAB_CANDIDATES], ["bean-fit"],
    "lab 候选白名单被改了 —— 每加一个都等于重新打开一个已裁掉的算法，必须显式改这条断言");

  for (const banned of REJECTED_ALGORITHMS) {
    assert.ok(!AUTO_TUNE_LAB_CANDIDATES.includes(banned),
      `${banned} 被放回搜索空间（§0 明确 REJECT）`);
  }
  for (const p of AUTO_TUNE_PROFILES) {
    assert.ok(p.labCandidate == null || AUTO_TUNE_LAB_CANDIDATES.includes(p.labCandidate),
      `${p.id} 挂了白名单外的 lab 候选 ${p.labCandidate}`);
    for (const banned of REJECTED_ALGORITHMS) {
      assert.notEqual(p.labCandidate, banned, `${p.id} 挂了 REJECT 的 ${banned}`);
      assert.ok(!p.id.includes(banned), `候选 id ${p.id} 里出现了 REJECT 的 ${banned}`);
    }
  }
});

test("§4/§9 anime 不放 Bean Fit（§12 没有数据支持它在这一档可用）", () => {
  const ids = AUTO_TUNE_ELIGIBILITY.anime;
  const withBean = ids.filter((id) => AUTO_TUNE_PROFILE_BY_ID[id].labCandidate === "bean-fit");
  assert.deepEqual(withBean, [], `anime 里出现了 Bean Fit 候选：${withBean.join(", ")}`);
});

test("§13 生产 lab 白名单是空集：第一阶段生产里一个 lab 候选都不跑", () => {
  assert.deepEqual([...PRODUCTION_LAB_CANDIDATES], [],
    "生产白名单被打开 —— 那是 §13 评测结论决定的事，必须显式改这条断言");
  for (const mode of GENERATION_MODES) {
    const prod = resolveCandidates(mode, { production: true });
    for (const c of prod) {
      assert.equal(c.labCandidate, null, `${mode} 的生产档里出现了 lab 候选 ${c.id}`);
    }
    assert.ok(prod.length >= 1, `${mode} 的生产档是空的 —— 那就没有 standard 可回落了`);
  }
});

/* =========================================================
 * §9 / §10 目标表
 * ======================================================= */

test("§9 每个模式都有非空的字典序目标表，且判据形状正确", () => {
  for (const mode of GENERATION_MODES) {
    const objective = objectiveFor(mode);
    assert.ok(Array.isArray(objective) && objective.length >= 2, `${mode} 目标表太短`);
    for (const c of objective) {
      assert.equal(typeof c.metric, "string", `${mode} 有判据缺 metric`);
      assert.ok(c.direction === "min" || c.direction === "max", `${mode}.${c.metric} 方向非法`);
      assert.ok(c.epsilon === null || typeof c.epsilon === "number", `${mode}.${c.metric} 阈值非法`);
      assert.equal(typeof c.note, "string", `${mode}.${c.metric} 没写为什么排这里`);
    }
  }
});

test("§10 目标表是**有序判据**，不是权重表：任何判据都不许带 weight/score", () => {
  for (const [mode, objective] of Object.entries(MODE_OBJECTIVES)) {
    for (const c of objective) {
      assert.ok(!("weight" in c), `${mode}.${c.metric} 带了 weight —— §10 明确不要加权分数`);
      assert.ok(!("score" in c), `${mode}.${c.metric} 带了 score`);
    }
  }
  // 源码级守卫：整个调优模块里不该出现「权重」这个词。
  const source = read("services", "auto-tune.mjs")
    .split("\n")
    .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//"))
    .join("\n");
  assert.ok(!/\bweight\b/i.test(source), "auto-tune.mjs 里出现了 weight —— §10 禁止加权总分");
});

test("§9 目标表里的指标名必须真实存在（防拼错）", () => {
  const { keys } = metricKeyProbe();
  const known = new Set(keys);
  for (const [mode, objective] of Object.entries(MODE_OBJECTIVES)) {
    for (const c of objective) {
      assert.ok(known.has(c.metric),
        `${mode} 的目标表引用了不存在的指标 ${c.metric}（真实指标：${keys.join(", ")}）`);
    }
  }
});

test("§10 同一个目标表里同一个指标不许出现两次（那会让排序自相矛盾）", () => {
  for (const [mode, objective] of Object.entries(MODE_OBJECTIVES)) {
    const metrics = objective.map((c) => c.metric);
    assert.equal(new Set(metrics).size, metrics.length, `${mode} 目标表里有重复指标`);
  }
});

test("§9 pixel / logo 的目标表只关心「不许退化」（这两个模式不参与排序）", () => {
  assert.ok(MODE_OBJECTIVES.pixel.length >= 1);
  assert.ok(MODE_OBJECTIVES.logo.length >= 1);
  assert.equal(MODE_OBJECTIVES.logo[0].metric, "usedColors", "logo 的第一判据必须是「不许扩色」");
  assert.equal(MODE_OBJECTIVES.logo[0].direction, "min");
});

/* =========================================================
 * 解析层
 * ======================================================= */

test("§3 resolveCandidates 按资格表原序返回，且不改动注册表对象", () => {
  for (const mode of GENERATION_MODES) {
    const before = JSON.stringify(AUTO_TUNE_ELIGIBILITY[mode]);
    const list = resolveCandidates(mode);
    assert.deepEqual(list.map((c) => c.id), AUTO_TUNE_ELIGIBILITY[mode]);
    assert.equal(JSON.stringify(AUTO_TUNE_ELIGIBILITY[mode]), before, `${mode} 资格表被就地改了`);
    for (const c of list) {
      assert.equal(c.mode, mode);
      assert.equal(c.overrides, AUTO_TUNE_PROFILE_BY_ID[c.id].overrides,
        `${c.id} 的 overrides 被复制了 —— 复制出来的那份会漂移`);
    }
  }
});

test("§3 未知路由模式回落到 auto 的资格表，不抛", () => {
  for (const bogus of [null, undefined, "", "realistic", "不存在的模式"]) {
    const list = resolveCandidates(bogus);
    assert.deepEqual(list.map((c) => c.id), AUTO_TUNE_ELIGIBILITY.auto,
      `routedMode = ${String(bogus)} 没有回落到 auto`);
  }
});

test("§15 resolveCandidateRequest 只产出纯数据：labCandidate 是字符串或 null", () => {
  for (const mode of GENERATION_MODES) {
    for (const candidate of resolveCandidates(mode)) {
      const req = resolveCandidateRequest(candidate);
      assert.equal(typeof req.profileId, "string");
      assert.equal(req.mode, mode);
      assert.equal(typeof req.overrides, "object");
      assert.ok(req.labCandidate === null || typeof req.labCandidate === "string",
        `${req.profileId}.labCandidate 不是字符串 —— 函数过不了 structuredClone`);
      // 纯数据必须能过 structuredClone（Worker 契约的硬要求）。
      assert.doesNotThrow(() => structuredClone(req),
        `${req.profileId} 的请求过不了 structuredClone`);
    }
  }
});

test("§16 候选的界面文案不许泄露算法术语", () => {
  const banned = ["Auto Tune", "Profile", "profile", "bean", "Bean", "lab", "Lab", "候选"];
  for (const p of AUTO_TUNE_PROFILES) {
    for (const word of banned) {
      assert.ok(!p.label.includes(word),
        `候选文案「${p.label}」里出现了内部术语「${word}」—— 用户不该看到这个`);
    }
  }
  // 反过来：模式文案本身必须是用户语言。
  for (const mode of GENERATION_MODES) {
    assert.ok(MODE_LABELS[mode], `${mode} 没有界面文案`);
  }
});
