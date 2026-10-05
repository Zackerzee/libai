/**
 * Stage C0 §8 / §10 —— 隐藏点击守卫（纯逻辑单测）。
 *
 * 这个文件不需要浏览器：判定逻辑在 `tools/ui-reachability-gate.mjs` 里是纯函数，
 * 测量在浏览器里做。分开的理由很实际 ——
 * 如果判定逻辑只能靠真机探针来验，那么「门本身对不对」这件事就永远只能靠
 * 一次几十秒的 Chrome 运行来回答，而门一旦写错（比如漏了祖先链那一条），
 * 探针会全绿，谁也不会发现。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  COLLECT_SOURCE,
  DECLARATION,
  REACHABILITY_CODES,
  evaluateReachability,
} from "../tools/ui-reachability-gate.mjs";

/** 一个「一切正常」的事实基线，各用例只覆盖自己关心的那一项。 */
const healthy = () => ({
  exists: true,
  selector: "#x",
  display: "block",
  visibility: "visible",
  opacity: 1,
  ancestorHidden: false,
  width: 40,
  height: 30,
  pointerEvents: "auto",
  disabled: false,
  inViewport: true,
  scrolled: false,
  center: [200, 400],
  viewport: [1440, 900],
  centerOutsideViewport: false,
  hitTestSelf: true,
  hitTestTarget: "button#x",
  text: "",
  ariaLabel: "",
});

const codesOf = (verdict) => verdict.failures.map((f) => f.code);

test("基线：一切正常 → PASS", () => {
  const verdict = evaluateReachability(healthy());
  assert.equal(verdict.pass, true);
  assert.equal(verdict.code, null);
  assert.deepEqual(verdict.failures, []);
});

test("§10 元素不存在 → TARGET_MISSING（不是 NOT_USER_REACHABLE，两者含义不同）", () => {
  assert.equal(evaluateReachability(null).code, REACHABILITY_CODES.MISSING);
  assert.equal(evaluateReachability({ exists: false }).code, REACHABILITY_CODES.MISSING);
});

test("§10 自身 display:none → TARGET_NOT_USER_REACHABLE", () => {
  const verdict = evaluateReachability({ ...healthy(), display: "none" });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.code, REACHABILITY_CODES.NOT_USER_REACHABLE);
});

test("§10 0×0 → TARGET_NOT_USER_REACHABLE（宽度与高度各报一条）", () => {
  const verdict = evaluateReachability({ ...healthy(), width: 0, height: 0 });
  assert.equal(verdict.code, REACHABILITY_CODES.NOT_USER_REACHABLE);
  assert.equal(codesOf(verdict).filter((c) => c === REACHABILITY_CODES.NOT_USER_REACHABLE).length, 2);
});

test("§8③ 祖先链上有 display:none → 必须 FAIL（getComputedStyle 不继承 display 的坑）", () => {
  // 这一条是整个门最容易被写漏的判据：藏在 `section[hidden]{display:none}` 里的按钮，
  // 它**自己**的 computed display 仍然是 "block"。只查自身 display 的门会放行，
  // 然后对着一个用户根本看不见的按钮说「入口 PASS」。
  const verdict = evaluateReachability({ ...healthy(), ancestorHidden: true });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.code, REACHABILITY_CODES.NOT_USER_REACHABLE);
  assert.match(verdict.failures[0].detail, /祖先链/);
});

test("§8④ visibility:hidden → TARGET_NOT_USER_REACHABLE", () => {
  assert.equal(evaluateReachability({ ...healthy(), visibility: "hidden" }).code, REACHABILITY_CODES.NOT_USER_REACHABLE);
  assert.equal(evaluateReachability({ ...healthy(), visibility: "collapse" }).code, REACHABILITY_CODES.NOT_USER_REACHABLE);
});

test("§8⑤ 有效 opacity 为 0 → TARGET_NOT_USER_REACHABLE（祖先乘出来的 0 也算）", () => {
  assert.equal(evaluateReachability({ ...healthy(), opacity: 0 }).code, REACHABILITY_CODES.NOT_USER_REACHABLE);
  // 0.5 × 0 = 0：子元素自己是 1，但祖先 opacity 是 0
  assert.equal(evaluateReachability({ ...healthy(), opacity: 0 }).pass, false);
  assert.equal(evaluateReachability({ ...healthy(), opacity: 0.4 }).pass, true, "半透明仍然可达");
});

test("§8⑨ 中心点命中不到自己 → TARGET_HIT_TEST_MISS（被遮挡 / 被裁掉）", () => {
  const verdict = evaluateReachability({ ...healthy(), hitTestSelf: false, hitTestTarget: "div#ws-export-drawer" });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.code, REACHABILITY_CODES.HIT_TEST_MISS);
  assert.match(verdict.failures[0].detail, /ws-export-drawer/);
});

test("§8⑨ 滚到最近位置仍不在视口内 → TARGET_NOT_USER_REACHABLE", () => {
  const verdict = evaluateReachability({ ...healthy(), inViewport: false, hitTestSelf: false, hitTestTarget: null });
  assert.equal(verdict.pass, false);
  assert.ok(codesOf(verdict).includes(REACHABILITY_CODES.NOT_USER_REACHABLE));
  assert.match(verdict.failures.map((f) => f.detail).join(" "), /视口/);
});

/* ── §8⑨ 的两种「够不到」必须分开报（2026-10-05 四档视口 QA 修）──────────────
 *
 * 起因：390×844 上落地页上传拖放区被判 TARGET_HIT_TEST_MISS，detail 写着
 * 「中心点命中的是 button#mobile-process-button，不是它自己」。
 * 真相是采集器把中心点 **clamp 进了视口**：
 *   const y = Math.min(vh - 1, Math.max(0, rect.top + rect.height / 2));
 * 元素中心 y=1252、视口高 844 → 被夹到 843 → 命中了贴底操作条上的按钮。
 * 那个「命中失败」是探针自己造出来的，产品的问题只是「它在折叠线以下」。
 *
 * 于是：clamp 去掉，新增 centerOutsideViewport + TARGET_OUT_OF_VIEW。
 * 两者修法完全不同 —— 「还得滚更多」vs「那个位置上是别的东西」，
 * 混成一个码会让人去改 CSS 遮挡，而其实只要滚一下。
 */
test("§8⑨ 中心点在视口外 → TARGET_OUT_OF_VIEW，且**不得**冒充 TARGET_HIT_TEST_MISS", () => {
  const verdict = evaluateReachability({
    ...healthy(),
    centerOutsideViewport: true,
    center: [188, 1252],
    viewport: [390, 844],
    hitTestSelf: false,
    hitTestTarget: null,
  });
  assert.equal(verdict.pass, false);
  assert.ok(codesOf(verdict).includes(REACHABILITY_CODES.OUT_OF_VIEW));
  assert.ok(
    !codesOf(verdict).includes(REACHABILITY_CODES.HIT_TEST_MISS),
    "视口外不能被报成命中失败 —— 那是两件事，修法不同",
  );
  // 失败详情要带上坐标，否则看报告的人无法判断「还差多远」。
  const detail = verdict.failures.map((f) => f.detail).join(" ");
  assert.match(detail, /1252/, "要报出中心点 y");
  assert.match(detail, /844/, "要报出视口高");
  assert.match(detail, /未做命中测试/, "要写明没有做命中测试，避免被读成「被盖住」");
});

/**
 * 采集器源码**剥掉注释**后的正文。
 *
 * 必须剥：这些守卫用的是「不许出现某个写法」的判据，而解释「为什么不许」的
 * 注释里**天然会引用那个写法本身**（实测：注释里写了 `Math.min(vh-1, …)`，
 * 守卫当场把自己解释文字当成了违规代码）。
 * 只剥**整行注释**与 `/* … *\/` 块 —— 这个采集器里没有含 `//` 的字符串字面量，
 * 所以不需要更聪明的词法分析；真有的话再升级。
 */
const collectCode = COLLECT_SOURCE
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((line) => !/^\s*\/\//.test(line))
  .join("\n");

test("§8⑨ 采集器不得再把命中点 clamp 进视口", () => {
  assert.doesNotMatch(
    collectCode,
    /Math\.min\(\s*vw\s*-\s*1/,
    "采集器又出现了把 x 夹进视口的写法：会为视口外的元素凭空造一个边缘点，" +
      "再拿它去做命中测试，报出一个不存在的「被遮挡」",
  );
  assert.doesNotMatch(
    collectCode,
    /Math\.min\(\s*vh\s*-\s*1/,
    "采集器又出现了把 y 夹进视口的写法（同上）",
  );
  assert.match(collectCode, /centerOutsideViewport/, "采集器必须把「中心点在视口外」单独量出来");
});

test("§8⑨ 滚动必须用 block:center —— nearest 不知道视口边缘压着 fixed 浮层", () => {
  assert.match(
    COLLECT_SOURCE,
    /scrollIntoView\(\s*\{\s*block:\s*"center"/,
    "采集器必须用 block:\"center\"。用 \"nearest\" 时，滚动容器认为「露出来了」就停，" +
      "而视口边缘上的 position:fixed 浮层可能盖掉它绝大部分 —— " +
      "390×844 实测：上传拖放区 118px 高，被贴底操作条盖掉 99px，只剩 19px，中心点命中操作条按钮",
  );
});

test("§8⑧ pointer-events:none → TARGET_POINTER_EVENTS_NONE", () => {
  const verdict = evaluateReachability({ ...healthy(), pointerEvents: "none" });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.code, REACHABILITY_CODES.POINTER_EVENTS_NONE);
});

test("§8⑨ 控件 disabled → TARGET_DISABLED（看得见但点了没反应）", () => {
  const verdict = evaluateReachability({ ...healthy(), disabled: true });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.code, REACHABILITY_CODES.DISABLED);
});

test("§10 invoke-handler-only：真的不可见 → PASS（这是唯一允许的例外）", () => {
  const verdict = evaluateReachability(
    { ...healthy(), display: "none", width: 0, height: 0, inViewport: false, hitTestSelf: false },
    { declaration: DECLARATION.INVOKE_HANDLER_ONLY },
  );
  assert.equal(verdict.pass, true);
  assert.equal(verdict.code, REACHABILITY_CODES.HANDLER_ONLY_OK);
});

test("§10 invoke-handler-only 不能用来给「其实能点」的元素开后门", () => {
  // 反证：如果声明成 invoke-handler-only 的元素是可见可点的，
  // 那这个声明要么是过期的、要么是在绕门。两种都必须 FAIL。
  const verdict = evaluateReachability(healthy(), { declaration: DECLARATION.INVOKE_HANDLER_ONLY });
  assert.equal(verdict.pass, false);
  assert.equal(verdict.code, REACHABILITY_CODES.HANDLER_ONLY_BUT_VISIBLE);
  assert.match(verdict.failures[0].detail, /声明与事实不符/);
});

test("§10 祖先隐藏的 invoke-handler-only 元素也算合规（hidden file input 的真实形态）", () => {
  const verdict = evaluateReachability(
    { ...healthy(), ancestorHidden: true, width: 0, height: 0, inViewport: false, hitTestSelf: false },
    { declaration: DECLARATION.INVOKE_HANDLER_ONLY },
  );
  assert.equal(verdict.pass, true);
});

test("§10 反证判据必须和主路径一样强：1×1 被盖住的 input 该老实过门，不该被误判", () => {
  // 真实形态（落地页 #file-input，实测值）：
  //   class="file-input-hidden"，display:block / visibility:visible /
  //   pointer-events:auto / 1×1 / opacity:0.01，
  //   但中心点 elementFromPoint 命中的是盖在它上面的 section.generator-intro。
  // 它是**点不到**的，所以 invoke-handler-only 声明是对的。
  //
  // 如果反证只查 display / visibility / 尺寸 / pointer-events 四项，
  // 这条会误报 INVOKE_HANDLER_ONLY_BUT_VISIBLE —— 一个正确的声明被判成「声明与事实不符」，
  // 然后下一个人就会去「修」那个本来没坏的声明。
  const landingFileInput = {
    ...healthy(),
    display: "block",
    visibility: "visible",
    opacity: 0.01,
    width: 1,
    height: 1,
    pointerEvents: "auto",
    inViewport: true,
    hitTestSelf: false,
    hitTestTarget: "section.generator-intro.homepage",
  };
  const verdict = evaluateReachability(landingFileInput, { declaration: DECLARATION.INVOKE_HANDLER_ONLY });
  assert.equal(verdict.pass, true, "点不到就是点不到，声明是对的");
  assert.equal(verdict.code, REACHABILITY_CODES.HANDLER_ONLY_OK);

  // 反面：同样这些属性，只要中心点真的命中它自己，声明就过期了，必须 FAIL。
  const actuallyClickable = { ...landingFileInput, hitTestSelf: true, hitTestTarget: "input#file-input.file-input-hidden" };
  const caught = evaluateReachability(actuallyClickable, { declaration: DECLARATION.INVOKE_HANDLER_ONLY });
  assert.equal(caught.pass, false);
  assert.equal(caught.code, REACHABILITY_CODES.HANDLER_ONLY_BUT_VISIBLE);
});

test("失败码是稳定的字符串常量（探针与报告都按码匹配，改名会静默失配）", () => {
  assert.equal(REACHABILITY_CODES.NOT_USER_REACHABLE, "TARGET_NOT_USER_REACHABLE");
  assert.equal(REACHABILITY_CODES.HANDLER_ONLY_BUT_VISIBLE, "INVOKE_HANDLER_ONLY_BUT_VISIBLE");
  assert.equal(DECLARATION.INVOKE_HANDLER_ONLY, "invoke-handler-only");
  assert.equal(DECLARATION.USER, "user");
});
