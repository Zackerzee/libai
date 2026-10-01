import test from "node:test";
import assert from "node:assert/strict";
import {
  SIZE_AUTHORITY,
  SIZE_AUTHORITY_LABELS,
  SIZE_AUTHORITY_ORDER,
  SIZE_ABSOLUTE_FROM,
  SIZE_DIMENSION_MAX,
  SIZE_DIMENSION_MIN,
  adoptSourceDimensions,
  authorityRank,
  createUnresolvedDimensions,
  describeSourceDimensions,
  isAbsoluteAuthority,
  isResolvedDimensions,
  isSizeAuthority,
  normalizeSourceDimensions,
  resolveSizeFromEvidence,
} from "../services/source-dimensions.mjs";
import { deriveGenerationSize } from "../services/generation-size.mjs";

/* B0.1 §1：尺寸来源优先级
 *   structured project metadata
 *   user-confirmed / manual grid calibration
 *   explicit grid / cell-spacing detection
 *   stable pixel-multiple detection
 *   logical-size heuristic
 *   unresolved
 * 本文件把这条链的顺序与「不得反向覆盖」钉死。
 */

const A = SIZE_AUTHORITY;

test("权威链顺序：从高到低严格递减，且 unresolved 恒为最低", () => {
  assert.deepEqual(SIZE_AUTHORITY_ORDER, [
    A.UNRESOLVED, A.LOGICAL_HEURISTIC, A.PIXEL_MULTIPLE,
    A.GRID_DETECTION, A.MANUAL_CALIBRATION, A.STRUCTURED_PROJECT,
  ]);
  assert.ok(authorityRank(A.STRUCTURED_PROJECT) > authorityRank(A.MANUAL_CALIBRATION));
  assert.ok(authorityRank(A.MANUAL_CALIBRATION) > authorityRank(A.GRID_DETECTION));
  assert.ok(authorityRank(A.GRID_DETECTION) > authorityRank(A.PIXEL_MULTIPLE));
  assert.ok(authorityRank(A.PIXEL_MULTIPLE) > authorityRank(A.LOGICAL_HEURISTIC));
  assert.ok(authorityRank(A.LOGICAL_HEURISTIC) > authorityRank(A.UNRESOLVED));
});

test("绝对权威从 grid-detection 起：前三级直用 W×H，后两级只做推导", () => {
  assert.equal(isAbsoluteAuthority(A.STRUCTURED_PROJECT), true);
  assert.equal(isAbsoluteAuthority(A.MANUAL_CALIBRATION), true);
  assert.equal(isAbsoluteAuthority(A.GRID_DETECTION), true);
  assert.equal(isAbsoluteAuthority(A.PIXEL_MULTIPLE), false);
  assert.equal(isAbsoluteAuthority(A.LOGICAL_HEURISTIC), false);
  assert.equal(isAbsoluteAuthority(A.UNRESOLVED), false);
  assert.equal(SIZE_ABSOLUTE_FROM, A.GRID_DETECTION);
});

test("未知来源不静默升级：rank 按 0 算，isSizeAuthority 为 false", () => {
  assert.equal(isSizeAuthority("pixler"), false);
  assert.equal(isSizeAuthority(""), false);
  assert.equal(isSizeAuthority(undefined), false);
  assert.equal(authorityRank("pixler"), authorityRank(A.UNRESOLVED));
});

test("normalizeSourceDimensions：Pixler 222×295 / OCR 78×104 原样通过", () => {
  const pixler = normalizeSourceDimensions({ width: 222, height: 295, authority: A.STRUCTURED_PROJECT, source: "libms-project" });
  assert.deepEqual({ ...pixler }, { width: 222, height: 295, authority: A.STRUCTURED_PROJECT, source: "libms-project" });
  const ocr = normalizeSourceDimensions({ width: 78, height: 104, authority: A.GRID_DETECTION, source: "cell-spacing:8" });
  assert.deepEqual({ ...ocr }, { width: 78, height: 104, authority: A.GRID_DETECTION, source: "cell-spacing:8" });
  assert.ok(Object.isFrozen(pixler), "必须冻结：尺寸是权威值，不允许被就地改写");
});

test("normalizeSourceDimensions：unresolved / 越界 / 未知来源一律返回 null", () => {
  for (const bad of [
    { width: 104, height: 104, authority: A.UNRESOLVED },
    { width: 104, height: 104, authority: "whatever" },
    { width: 0, height: 104, authority: A.GRID_DETECTION },
    { width: 104, height: -1, authority: A.GRID_DETECTION },
    { width: 104, height: SIZE_DIMENSION_MAX + 1, authority: A.GRID_DETECTION },
    { width: SIZE_DIMENSION_MIN - 1, height: 104, authority: A.GRID_DETECTION },
    { width: NaN, height: 104, authority: A.GRID_DETECTION },
    { width: "abc", height: 104, authority: A.GRID_DETECTION },
    { height: 104, authority: A.GRID_DETECTION },
    null,
    undefined,
    "104x104",
  ]) {
    assert.equal(normalizeSourceDimensions(bad), null, `应拒绝：${JSON.stringify(bad)}`);
  }
});

test("§9 multiple 与 heuristic 冲突 → multiple 胜出", () => {
  const heuristic = normalizeSourceDimensions({ width: 200, height: 150, authority: A.LOGICAL_HEURISTIC, source: "natural-size" });
  const multiple = normalizeSourceDimensions({ width: 104, height: 78, authority: A.PIXEL_MULTIPLE, source: "pixel-multiple:10" });
  const adopted = adoptSourceDimensions(heuristic, multiple);
  assert.equal(adopted.applied, true);
  assert.deepEqual({ ...adopted.dimensions }, { width: 104, height: 78, authority: A.PIXEL_MULTIPLE, source: "pixel-multiple:10" });
  // 反向必须被拒
  const rejected = adoptSourceDimensions(multiple, heuristic);
  assert.equal(rejected.applied, false);
  assert.equal(rejected.blockedBy, A.PIXEL_MULTIPLE);
  assert.equal(rejected.dimensions.width, 104, "被拒时必须原样退回现有尺寸");
});

test("§9 manual calibration 与 multiple 冲突 → manual 胜出", () => {
  const multiple = normalizeSourceDimensions({ width: 104, height: 78, authority: A.PIXEL_MULTIPLE });
  const manual = normalizeSourceDimensions({ width: 222, height: 295, authority: A.MANUAL_CALIBRATION, source: "direct-pattern-form" });
  const adopted = adoptSourceDimensions(multiple, manual);
  assert.equal(adopted.applied, true);
  assert.equal(adopted.dimensions.width, 222);
  assert.equal(adopted.dimensions.height, 295);
  assert.equal(adoptSourceDimensions(manual, multiple).applied, false);
});

test("§2 structured project 是最高权威：manual / grid-detection 都覆盖不了它", () => {
  const structured = normalizeSourceDimensions({ width: 222, height: 295, authority: A.STRUCTURED_PROJECT });
  for (const weaker of [A.MANUAL_CALIBRATION, A.GRID_DETECTION, A.PIXEL_MULTIPLE, A.LOGICAL_HEURISTIC]) {
    const next = normalizeSourceDimensions({ width: 104, height: 104, authority: weaker });
    const outcome = adoptSourceDimensions(structured, next);
    assert.equal(outcome.applied, false, `${weaker} 不得覆盖 structured-project`);
    assert.equal(outcome.dimensions.width, 222);
    assert.equal(outcome.dimensions.height, 295);
  }
});

test("同级可以替换：同一来源重新识别出的新结果必须生效", () => {
  const first = normalizeSourceDimensions({ width: 104, height: 78, authority: A.PIXEL_MULTIPLE });
  const second = normalizeSourceDimensions({ width: 200, height: 150, authority: A.PIXEL_MULTIPLE });
  const outcome = adoptSourceDimensions(first, second);
  assert.equal(outcome.applied, true);
  assert.equal(outcome.dimensions.width, 200);
});

test("unresolved 基线接受任何已解析证据", () => {
  const outcome = adoptSourceDimensions(createUnresolvedDimensions("boot"), normalizeSourceDimensions({ width: 104, height: 78, authority: A.LOGICAL_HEURISTIC }));
  assert.equal(outcome.applied, true);
  assert.equal(outcome.dimensions.width, 104);
});

test("§7 无可靠尺寸 → 保持 unresolved，不得退回 104×104", () => {
  const base = createUnresolvedDimensions("no-evidence");
  assert.equal(isResolvedDimensions(base), false);
  assert.equal(base.width, 0);
  assert.equal(base.height, 0);
  const outcome = adoptSourceDimensions(base, normalizeSourceDimensions({ width: 104, height: 104, authority: A.UNRESOLVED }));
  assert.equal(outcome.applied, false);
  assert.equal(outcome.dimensions.width, 0, "unresolved 不得被当成 104×104");
  assert.equal(describeSourceDimensions(base), "正在识别图纸尺寸…");
});

test("adoptSourceDimensions 对畸形 current 不炸，按 unresolved 处理", () => {
  for (const current of [null, undefined, {}, { authority: "weird" }, { width: 104, height: 104, authority: A.UNRESOLVED }]) {
    const outcome = adoptSourceDimensions(current, normalizeSourceDimensions({ width: 78, height: 104, authority: A.GRID_DETECTION }));
    assert.equal(outcome.applied, true, `current=${JSON.stringify(current)} 应可被采纳`);
    assert.equal(outcome.dimensions.width, 78);
  }
});

test("describeSourceDimensions 用中文标签，未知标签回落原值", () => {
  assert.equal(SIZE_AUTHORITY_LABELS[A.STRUCTURED_PROJECT], "工程文件");
  assert.equal(describeSourceDimensions({ width: 222, height: 295, authority: A.STRUCTURED_PROJECT }), "图纸尺寸 222 × 295 · 来自工程文件");
  assert.equal(describeSourceDimensions({ width: 78, height: 104, authority: A.GRID_DETECTION }), "图纸尺寸 78 × 104 · 来自网格识别");
});

test("零 DOM：模块在 Node 下可直接加载", () => {
  assert.equal(typeof document, "undefined");
  assert.equal(typeof window, "undefined");
});

/* ────────────────────────────────────────────────────────────────────────────
 * resolveSizeFromEvidence —— 「谁说了算」的唯一实现
 *
 * 这是 B0.1 的核心不变量，也是 §9 全部验收点的落点。放在这里单测，而不是留给
 * 真机探针：真机探针只能证明「这一次是对的」，这里钉住的是「永远该这样」。
 * ──────────────────────────────────────────────────────────────────────────── */

/** 普通图片的派生实现，与 app.js 里传给 resolveSizeFromEvidence 的完全一致。 */
const derive = (longEdge, ratio) => (longEdge == null ? null : deriveGenerationSize(longEdge, ratio));

test("§9 Pixler 222×295 → 222×295，且**绝不**经过派生", () => {
  const pixler = normalizeSourceDimensions({ width: 222, height: 295, authority: A.STRUCTURED_PROJECT, source: "libms-project" });
  let deriveCalls = 0;
  const spy = (edge, ratio) => { deriveCalls += 1; return derive(edge, ratio); };
  // 故意喂一个会算出 200×150 的长边 + 比例：绝对权威必须无视它们
  const size = resolveSizeFromEvidence(pixler, { longEdge: 200, ratio: 0.75, derive: spy });
  assert.equal(size.width, 222);
  assert.equal(size.height, 295);
  assert.equal(size.absolute, true);
  assert.equal(size.authority, A.STRUCTURED_PROJECT);
  assert.equal(size.longEdge, 295, "长边是 W/H 的较大者，不是用户选的 200");
  assert.equal(deriveCalls, 0, "绝对权威不得调用派生逻辑 —— 调了就是把 222×295 再算一遍");
});

test("§9 OCR 78×104 → 78×104，长边取 104", () => {
  const ocr = normalizeSourceDimensions({ width: 78, height: 104, authority: A.GRID_DETECTION, source: "cell-spacing:8" });
  const size = resolveSizeFromEvidence(ocr, { longEdge: 104, ratio: 0.75, derive });
  assert.deepEqual({ ...size }, { longEdge: 104, width: 78, height: 104, absolute: true, authority: A.GRID_DETECTION });
});

test("§9 manual-calibration 222×295 同样绝对，优先级高于 grid-detection 的 78×104", () => {
  const manual = normalizeSourceDimensions({ width: 222, height: 295, authority: A.MANUAL_CALIBRATION, source: "direct-pattern-form" });
  const size = resolveSizeFromEvidence(manual, { longEdge: 500, ratio: 1, derive });
  assert.equal(size.width, 222);
  assert.equal(size.height, 295);
  assert.equal(size.absolute, true);
});

test("§9 普通 4:3 图片 longEdge=200 → 200×150（非绝对，走派生）", () => {
  const heuristic = normalizeSourceDimensions({ width: 104, height: 78, authority: A.LOGICAL_HEURISTIC, source: "natural-size" });
  const size = resolveSizeFromEvidence(heuristic, { longEdge: 200, ratio: 0.75, derive });
  assert.equal(size.width, 200);
  assert.equal(size.height, 150);
  assert.equal(size.absolute, false, "启发式只是建议值，必须可被用户改");
  assert.equal(size.authority, A.LOGICAL_HEURISTIC, "派生时保留来源标签，便于诊断");
});

test("§9 无可靠尺寸 → null（defer），**不得** 104×104", () => {
  const unresolved = createUnresolvedDimensions("no-evidence");
  // ① 没有可用比例 —— 这是 defer 的唯一触发条件
  assert.equal(resolveSizeFromEvidence(unresolved, { longEdge: 104, ratio: null, derive }), null);
  assert.equal(resolveSizeFromEvidence(unresolved, { longEdge: 104, ratio: 0, derive }), null, "ratio=0 与 null 同义");
  assert.equal(resolveSizeFromEvidence(unresolved, { longEdge: 104, ratio: -1, derive }), null);
  // ② 有比例但没长边
  assert.equal(resolveSizeFromEvidence(unresolved, { longEdge: null, ratio: 0.75, derive }), null);
  // ③ 缺 derive 实现（运行时模块还没加载完）
  assert.equal(resolveSizeFromEvidence(unresolved, { longEdge: 104, ratio: 0.75, derive: null }), null);
});

test("§7 畸形 dimensions 不得被静默升级成绝对权威", () => {
  for (const bad of [null, undefined, {}, { authority: "weird", width: 104, height: 104 }, { width: 0, height: 0, authority: A.GRID_DETECTION }]) {
    const tag = JSON.stringify(bad);
    // 没有比例 → 必须 defer，而不是拿 104 硬凑成方图
    assert.equal(resolveSizeFromEvidence(bad, { longEdge: 104, ratio: null, derive }), null, `应 defer：${tag}`);
    // 有比例 → 走普通派生，且**不能**标成 absolute
    const size = resolveSizeFromEvidence(bad, { longEdge: 104, ratio: 0.75, derive });
    assert.equal(size.absolute, false, `不得标成绝对权威：${tag}`);
    assert.deepEqual([size.width, size.height], [104, 78], `应走普通派生：${tag}`);
  }
});

test("§9 pixel-multiple 尺寸本身不绝对，但仍能派生：104×78 只作建议长边", () => {
  const multiple = normalizeSourceDimensions({ width: 104, height: 78, authority: A.PIXEL_MULTIPLE, source: "pixel-multiple:10" });
  // 用户把长边改到 300 → 按 4:3 出 300×225，而不是被 104×78 钉死
  const size = resolveSizeFromEvidence(multiple, { longEdge: 300, ratio: 0.75, derive });
  assert.equal(size.width, 300);
  assert.equal(size.height, 225);
  assert.equal(size.absolute, false);
});

test("unresolved 与未知 authority 在派生结果里都回落为 unresolved 标签", () => {
  const size = resolveSizeFromEvidence(createUnresolvedDimensions(), { longEdge: 104, ratio: 1, derive });
  assert.equal(size.authority, A.UNRESOLVED);
  assert.equal(size.absolute, false);
});
