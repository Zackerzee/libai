/**
 * Stage B4 §0 — 尺寸竞态：用户显式尺寸不得被自动链覆盖。
 *
 * 真实缺陷（真机复现过）：
 *   导入源图 → `ensureMultipleDetection()` 异步识别像素倍数 →
 *   settle 之后 `applyLogicalSize()` 与 `scheduleInitialGeneration()` **无条件**再写一次
 *   草稿并提交 → 用户若在识别落地之前手填 104 并点「应用尺寸」，这一票被静默覆盖。
 *   实测：`gray-gradient` 导入草稿 10 → 用户填 104 → 出图宽仍是自动识别出来的尺寸。
 *
 * 本文件钉两件事，缺一不可：
 *   ① **语义**：`resolveLongEdgeAuthority` 状态机与 `shouldAutoWriteLongEdge` 的判定；
 *   ② **接线**：每一个自动写入点真的过了这道闸，而且过闸的位置是对的。
 * 语义对了但没人调 = 线上照样坏（B0.1 的两个 bug 都是这一类）。
 *
 * 端到端行为由 `tools/b4-size-race-probe.mjs` 在真机上验证。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  LONG_EDGE_AUTHORITY,
  LONG_EDGE_EVENT,
  isLongEdgeAuthority,
  resolveLongEdgeAuthority,
  shouldAutoWriteLongEdge,
} from "../services/source-dimensions.mjs";

const APP = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const WORKSPACE = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");

/** 按签名截出函数体（大括号配平）。找不到 / 不闭合直接炸，不留假绿灯。 */
function fnBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, `找不到函数：${signature}`);
  const open = source.indexOf("{", start + signature.length - 1);
  assert.ok(open !== -1, `找不到函数体起点：${signature}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`函数体不闭合（可能含未配平的字面量）：${signature}`);
}

/**
 * 只按**行首特征**剥注释（`//` / 星号 / 斜杠星号 开头）。
 *
 * 不能用注释语法的正则：本仓库文件里混着大量内联 CSS/HTML 文本，
 * 一个「斜杠星号 + 非贪婪 + 星号斜杠」的正则会被任何含「星号斜杠」的字符串带偏
 * （实测把 173KB 的文件吃成 51KB）。**连这段注释自己都不能写出那两个字面量** ——
 * 第一版写进去了，块注释当场被提前闭合，测试文件直接 SyntaxError。
 *
 * 为什么必须剥：注释里提到一个函数名，就会把位置查找骗到注释上。
 * 本文件第一次跑就踩了 —— 注释写着「下面的 scheduleInitialGeneration() 会用到这个权威值」，
 * 于是「清除必须早于首帧调度」这条断言比到了注释里的那一次，**假红**。
 */
const codeOnly = (source) => source
  .split("\n")
  .filter((line) => {
    const trimmed = line.trim();
    return !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
  })
  .join("\n");

/** 取函数体的「纯代码」版本。所有位置断言都在这上面做。 */
const bodyCode = (source, signature) => codeOnly(fnBody(source, signature));

/* ────────────────────────── ① 语义 ────────────────────────── */

test("常量是稳定的字符串值（会写进 DOM dataset，改动即为破坏性变更）", () => {
  assert.equal(LONG_EDGE_AUTHORITY.AUTO, "auto");
  assert.equal(LONG_EDGE_AUTHORITY.USER_EXPLICIT, "user-explicit");
  assert.equal(LONG_EDGE_EVENT.USER_APPLIED, "user-applied");
  assert.equal(LONG_EDGE_EVENT.SOURCE_REPLACED, "source-replaced");
  assert.equal(LONG_EDGE_EVENT.RESTORE_AUTO, "restore-auto");
  assert.equal(LONG_EDGE_EVENT.AUTO_DETECTED, "auto-detected");
  assert.ok(Object.isFrozen(LONG_EDGE_AUTHORITY), "必须冻结：它不是可变的运行时状态");
});

test("只有 user-applied 会升级到 user-explicit", () => {
  assert.equal(resolveLongEdgeAuthority(LONG_EDGE_AUTHORITY.AUTO, LONG_EDGE_EVENT.USER_APPLIED),
    LONG_EDGE_AUTHORITY.USER_EXPLICIT);
  assert.equal(resolveLongEdgeAuthority(LONG_EDGE_AUTHORITY.USER_EXPLICIT, LONG_EDGE_EVENT.USER_APPLIED),
    LONG_EDGE_AUTHORITY.USER_EXPLICIT, "重复点应用尺寸应当保持，不应翻转");
});

test("auto-detected 是空操作 —— 识别到什么都不改变「谁说了算」", () => {
  assert.equal(resolveLongEdgeAuthority(LONG_EDGE_AUTHORITY.AUTO, LONG_EDGE_EVENT.AUTO_DETECTED),
    LONG_EDGE_AUTHORITY.AUTO);
  // 这条是本次修复的核心：识别结果**不能**把用户权威降级。
  assert.equal(resolveLongEdgeAuthority(LONG_EDGE_AUTHORITY.USER_EXPLICIT, LONG_EDGE_EVENT.AUTO_DETECTED),
    LONG_EDGE_AUTHORITY.USER_EXPLICIT);
});

test("只有 source-replaced / restore-auto 会降回 auto", () => {
  for (const event of [LONG_EDGE_EVENT.SOURCE_REPLACED, LONG_EDGE_EVENT.RESTORE_AUTO]) {
    assert.equal(resolveLongEdgeAuthority(LONG_EDGE_AUTHORITY.USER_EXPLICIT, event),
      LONG_EDGE_AUTHORITY.AUTO, `${event} 应当清除 user-explicit`);
  }
});

test("未知 / 缺失输入一律按 auto 处理，绝不静默升级成 user-explicit", () => {
  for (const junk of [undefined, null, "", "USER-EXPLICIT", "user", 0, {}, []]) {
    assert.equal(resolveLongEdgeAuthority(junk, LONG_EDGE_EVENT.AUTO_DETECTED), LONG_EDGE_AUTHORITY.AUTO);
    assert.equal(resolveLongEdgeAuthority(LONG_EDGE_AUTHORITY.AUTO, junk), LONG_EDGE_AUTHORITY.AUTO);
    assert.equal(isLongEdgeAuthority(junk), false);
  }
});

test("shouldAutoWriteLongEdge 只对 user-explicit 说不", () => {
  assert.equal(shouldAutoWriteLongEdge(LONG_EDGE_AUTHORITY.AUTO), true);
  assert.equal(shouldAutoWriteLongEdge(LONG_EDGE_AUTHORITY.USER_EXPLICIT), false);
  // 未知值必须放行而不是拦截：宁可少保护，也不能把用户锁死在一个他没收过的尺寸上。
  for (const junk of [undefined, null, "", "weird"]) {
    assert.equal(shouldAutoWriteLongEdge(junk), true, `${String(junk)} 应当放行`);
  }
});

/* ────────────────────────── ② 接线 ────────────────────────── */

test("commitSize 先升级权威再提交草稿（顺序反了就白修）", () => {
  const body = bodyCode(WORKSPACE, "function commitSize()");
  const authorityAt = body.indexOf("LONG_EDGE_EVENT.USER_APPLIED");
  const pushAt = body.indexOf("pushDraftToBridge()");
  assert.ok(authorityAt !== -1, "「应用尺寸」必须把长边升级为 user-explicit");
  assert.ok(pushAt !== -1, "仍然要提交草稿");
  assert.ok(authorityAt < pushAt, "必须先升级权威 —— 反过来的话，提交与生成之间有一段无保护窗口");
});

test("applyLogicalSize 的闸在最前面，且早退时绝不碰草稿 / 不提交证据", () => {
  const body = bodyCode(WORKSPACE, "function applyLogicalSize()");
  const guardAt = body.indexOf("shouldAutoWriteLongEdge(longEdgeAuthority)");
  assert.ok(guardAt !== -1, "applyLogicalSize 必须过闸");
  // 闸必须在「读 result / 算 logicalSize / 写 longEdgeDraft / 提交 applySourceDimensions」之前。
  for (const later of ["bridge.getResult()", "recommendAutomaticSize(", "longEdgeDraft =", "bridge.applySourceDimensions("]) {
    const at = body.indexOf(later);
    assert.ok(at !== -1, `函数里应当还有 ${later}`);
    assert.ok(guardAt < at, `闸必须在 ${later} 之前`);
  }
  // 早退分支必须 return，不能只是不写草稿然后继续往下走。
  const guardBlock = body.slice(guardAt, body.indexOf("bridge.getResult()"));
  assert.match(guardBlock, /return null/, "被挡下时必须直接返回");
});

test("scheduleInitialGeneration 的闸写在 .then 里面（写在外面挡不住任何东西）", () => {
  const body = bodyCode(WORKSPACE, "function scheduleInitialGeneration()");
  const thenAt = body.indexOf(".then(");
  const guardAt = body.indexOf("shouldAutoWriteLongEdge(longEdgeAuthority)");
  const pushAt = body.indexOf("pushDraftToBridge()");
  assert.ok(thenAt !== -1, "必须还是异步等识别 settle");
  assert.ok(guardAt !== -1, "首帧自动生成必须过闸");
  assert.ok(thenAt < guardAt,
    "闸必须在 .then 回调内 —— 写在 await 之前等于在用户点击之前就做了决定");
  assert.ok(guardAt < pushAt, "被挡下时不得再提交草稿");
  const guardBlock = body.slice(guardAt, pushAt);
  assert.match(guardBlock, /return/, "被挡下时必须直接返回，不能继续排一次生成");
});

test("换源图清除 user-explicit，且发生在首帧调度之前", () => {
  const body = bodyCode(WORKSPACE, 'window.addEventListener("libms:source-loaded"');
  const clearAt = body.indexOf("LONG_EDGE_EVENT.SOURCE_REPLACED");
  const scheduleAt = body.indexOf("scheduleInitialGeneration()");
  assert.ok(clearAt !== -1, "换源图是第一个清除口，必须实现");
  assert.ok(scheduleAt !== -1, "首帧生成还在");
  assert.ok(clearAt < scheduleAt, "清除必须早于首帧调度，否则新图会被上一张图的 user-explicit 挡住");
});

test("「自动」档是第二个清除口，且先降级再算", () => {
  const at = WORKSPACE.indexOf('chip.dataset.size === "auto"');
  assert.ok(at !== -1, "找不到「自动」档分支");
  // 在纯代码上截窗口：注释里也会出现 RESTORE_AUTO / applyLogicalSize，
  // 不剥注释的话「先降级再算」可能比到注释里的顺序，**假绿**。
  const block = codeOnly(WORKSPACE.slice(at, at + 800));
  const clearAt = block.indexOf("LONG_EDGE_EVENT.RESTORE_AUTO");
  const applyAt = block.indexOf("applyLogicalSize()");
  assert.ok(clearAt !== -1, "「自动」档必须清除 user-explicit");
  assert.ok(applyAt !== -1, "「自动」档仍然要算一次逻辑尺寸");
  assert.ok(clearAt < applyAt, "必须先降级再算 —— 否则会被刚设上的 user-explicit 挡回来，点「自动」没反应");
});

test("拖滑杆 / 滚轮 / 方向键不得升级权威（只有「应用尺寸」能升级）", () => {
  // 这三条都是「只改草稿」的入口。它们改 sizeOrigin 是对的（chip 高亮），
  // 但绝不能顺手把 longEdgeAuthority 也升上去 —— 那会让「点了应用尺寸才算数」这条规则失效。
  const stepBody = bodyCode(WORKSPACE, "function stepLongEdgeDraft(delta)");
  assert.doesNotMatch(stepBody, /setLongEdgeAuthority/,
    "步进只改草稿；升级权威必须留给「应用尺寸」");
  for (const selector of ['$("#ws-size-range")?.addEventListener("input"', '$("#ws-size-number")?.addEventListener("input"']) {
    const at = WORKSPACE.indexOf(selector);
    assert.ok(at !== -1, `找不到 ${selector}`);
    const line = WORKSPACE.slice(at, WORKSPACE.indexOf("\n", at));
    assert.doesNotMatch(line, /setLongEdgeAuthority/, `${selector} 只改草稿，不得升级权威`);
  }
});

test("source-dimensions.mjs 的所有引用点用**逐字相同**的 query string", () => {
  // 同一个文件被两个不同 specifier 引用 = 两个模块实例 = LONG_EDGE_AUTHORITY 是两个不同对象，
  // 「用户点过应用尺寸」这个事实会在一边成立、另一边不成立。
  //
  // 注意归一化：`app.js` 在根目录写 `./services/x.mjs`，`ui/workspace.js` 写 `../services/x.mjs`。
  // 两者解析到同一个 URL，**是同一个实例** —— 所以要比的是 `.mjs` 之后的 query 部分，
  // 不是整条 specifier（第一版这么比，误报 2 个不同 specifier）。
  const queryOf = (specifier) => specifier.slice(specifier.indexOf("source-dimensions.mjs"));
  const specifiers = [...`${APP}\n${WORKSPACE}`.matchAll(/["']([^"']*source-dimensions\.mjs[^"']*)["']/g)]
    .map((m) => m[1])
    .filter((s) => s.startsWith("."))
    .map(queryOf);
  assert.ok(specifiers.length >= 2, `至少要有一个动态 import 与一个静态 import，实得 ${specifiers.length}`);
  const unique = [...new Set(specifiers)];
  assert.equal(unique.length, 1, `query string 必须唯一，实得：${unique.join(" | ")}`);
  assert.match(unique[0], /source-dimensions\.mjs\?v=\d{8}-stage-b4/,
    "缓存串要跟着本轮升到 stage-b4，否则浏览器可能拿旧模块");
});

test("长边权威对真机探针可见（否则验收只能靠猜）", () => {
  const body = bodyCode(WORKSPACE, "function syncSizeUi()");
  assert.match(body, /dataset\.longEdgeAuthority = longEdgeAuthority/);
  assert.match(body, /dataset\.blockedAutoWrites/);
});
