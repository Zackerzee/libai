/**
 * Stage C0 §8 / §9 / §10 —— 入口可达性门。
 *
 * ── 为什么需要它 ──────────────────────────────────────────────────────────
 * 之前的验收大量使用 `document.querySelector(...).click()` 判定「入口 PASS」。
 * `HTMLElement.click()` **能穿透 `display: none`** —— 它不看可见性，直接派发事件。
 * 于是下面这种事可以在全绿的情况下长期存在：
 *
 *   8 张生成模式卡初始全部 `getBoundingClientRect()` = 0×0，
 *   祖先链是 `section.ws-panel[hidden] { display: none !important }`，
 *   而 6 个右栏 tab 里没有一个叫「生成」—— 用户根本找不到入口，
 *   但 `card.click()` 照样触发模式切换，A–Q 场景全部照跑通过。
 *
 * 那些断言关于**生成行为**，它们是对的；「用户找不找得到入口」是另一件事，
 * 而且从来没被验证过。这个门就是补那一件事。
 *
 * ── 门怎么判 ──────────────────────────────────────────────────────────────
 * 一个元素要算「用户可达」，必须**同时**满足 §8 的九条：
 *   ① 存在
 *   ② 自身 computed `display !== "none"`
 *   ③ 祖先链上没有 `display: none` / `visibility: hidden`
 *      —— ⚠️ 这一条必须单独查：`getComputedStyle(child).display` **不会**继承
 *         祖先的 `display:none`，它返回 child 自己声明的值（通常是 `block`）。
 *         只查自身 display 的门会对着一个藏在 `display:none` 面板里的按钮说「可见」。
 *   ④ 自身 `visibility !== hidden / collapse`
 *   ⑤ 有效 opacity > 0（自身 × 所有祖先，逐层相乘）
 *   ⑥ `width > 0`
 *   ⑦ `height > 0`
 *   ⑧ `pointer-events !== "none"`
 *   ⑨ 滚到能看见之后仍在视口内，且**中心点的 `elementFromPoint` 命中它自己**
 *      —— 这是唯一能证明「真鼠标点得中」的判据。被浮层盖住、被 overflow 裁掉、
 *         只剩 0×0 的幻影，前八条都可能过，第九条过不去。
 *      滚动用 `block: "center"`：`nearest` 不知道视口边缘上压着 `position: fixed`
 *      的浮层，会把「只露出 19px、中心被操作条盖住」当成「已经露出来了」。
 *
 * 另外三条独立失败码（它们不是「看不见」，是「看得见但够不到 / 点不动」）：
 *   · `TARGET_OUT_OF_VIEW` —— 滚到位后中心点仍在视口外。**不等于被盖住**：
 *     一个是「还得滚更多」，一个是「那个位置上是别的东西」，修法不同，所以分开报。
 *   · `TARGET_POINTER_EVENTS_NONE`
 *   · `TARGET_DISABLED`
 *
 * ── invoke-handler-only ──────────────────────────────────────────────────
 * §10：0×0 或 `display:none` 时一律 FAIL `TARGET_NOT_USER_REACHABLE`，
 * **除非显式声明 `invoke-handler-only`** —— 意思是「这个元素故意不给用户直接点，
 * 它由另一个控件触发」（例如 `<input type="file" hidden>` 由「添加 / 替换」按钮触发）。
 *
 * 这个声明是**可以反证**的：如果声明成 `invoke-handler-only` 的元素其实是可见可点的，
 * 门会报 `INVOKE_HANDLER_ONLY_BUT_VISIBLE` —— 声明与事实不符。
 * 所以「给所有东西贴个 invoke-handler-only 就全绿」这条捷径不存在。
 * 反证用的判据和主路径一样强（含 `hitTestSelf`）：一个 1×1、`opacity: 0.01`、
 * 被别的层盖住的 `<input type="file">` 是**点不到**的，它该老老实实过门。
 * 声明方还必须给出 `triggeredBy`（触发它的那个选择器 id），
 * 而那个触发者本身要在同一张清单里、并且走完整套可见性门。
 */

/** 失败码。`TARGET_NOT_USER_REACHABLE` 是 §10 指定的主码。 */
export const REACHABILITY_CODES = {
  MISSING: "TARGET_MISSING",
  NOT_USER_REACHABLE: "TARGET_NOT_USER_REACHABLE",
  HIT_TEST_MISS: "TARGET_HIT_TEST_MISS",
  /** 中心点在视口外（滚到位之后仍然如此）—— 「要滚更多」不是「点不中」，两者别混。 */
  OUT_OF_VIEW: "TARGET_OUT_OF_VIEW",
  POINTER_EVENTS_NONE: "TARGET_POINTER_EVENTS_NONE",
  DISABLED: "TARGET_DISABLED",
  HANDLER_ONLY_BUT_VISIBLE: "INVOKE_HANDLER_ONLY_BUT_VISIBLE",
  HANDLER_ONLY_OK: "INVOKE_HANDLER_ONLY",
};

export const DECLARATION = {
  USER: "user",
  INVOKE_HANDLER_ONLY: "invoke-handler-only",
};

/**
 * 纯函数：把「量到的事实」判成 PASS / FAIL。
 *
 * 刻意与测量分离 —— 测量必须在浏览器里做（`getComputedStyle` / `elementFromPoint`
 * 只有真 DOM 有），判定必须能在 Node 里单测。混在一起的话，
 * 门的逻辑就只能靠真机探针来验，而真机探针跑一次要几十秒、还依赖 Chrome。
 *
 * @param {object} facts `collectReachabilityFacts()` 的返回值
 * @param {{declaration?: string}} options
 * @returns {{pass: boolean, code: string|null, failures: Array<{code: string, detail: string}>}}
 */
export function evaluateReachability(facts, { declaration = DECLARATION.USER } = {}) {
  if (!facts || !facts.exists) {
    return {
      pass: false,
      code: REACHABILITY_CODES.MISSING,
      failures: [{ code: REACHABILITY_CODES.MISSING, detail: "选择器没有匹配到元素" }],
    };
  }

  if (declaration === DECLARATION.INVOKE_HANDLER_ONLY) {
    // 声明「只由代码触发」的元素：不要求可见，但**要求它确实不可见**。
    // 一条「声明为隐藏、实际能点」的记录是纯负债：它既绕过门，又误导下一个人。
    //
    // ⚠️ 这里的判据必须和主路径**一样强**，否则会误伤合法的隐藏 input：
    // 落地页的 `<input type="file" class="file-input-hidden">` 是
    // 1×1 + `opacity: 0.01`，`display` / `visibility` / 尺寸 / `pointer-events`
    // 四项全都「看起来正常」，但它被上面的 `section.generator-intro` 盖住 ——
    // 真鼠标点下去命中的是那层，不是它。少了 `hitTestSelf`，
    // 一个**正确**的 invoke-handler-only 声明会被误判成「声明与事实不符」。
    const userClickable = facts.display !== "none"
      && facts.ancestorHidden !== true
      && facts.visibility !== "hidden" && facts.visibility !== "collapse"
      && facts.width > 0 && facts.height > 0
      && facts.pointerEvents !== "none"
      && facts.hitTestSelf === true;
    if (userClickable) {
      return {
        pass: false,
        code: REACHABILITY_CODES.HANDLER_ONLY_BUT_VISIBLE,
        failures: [{
          code: REACHABILITY_CODES.HANDLER_ONLY_BUT_VISIBLE,
          detail: "声明为 invoke-handler-only，但它其实是用户可点的 —— 声明与事实不符，先撤掉声明",
        }],
      };
    }
    return { pass: true, code: REACHABILITY_CODES.HANDLER_ONLY_OK, failures: [] };
  }

  const failures = [];
  const unreachable = (detail) => failures.push({ code: REACHABILITY_CODES.NOT_USER_REACHABLE, detail });

  if (facts.display === "none") unreachable("自身 display: none");
  if (facts.ancestorHidden) unreachable("祖先链上有 display: none / visibility: hidden（getComputedStyle 不继承 display）");
  if (facts.visibility === "hidden" || facts.visibility === "collapse") unreachable(`visibility: ${facts.visibility}`);
  if (!(Number(facts.opacity) > 0)) unreachable(`有效 opacity = ${facts.opacity}（自身 × 祖先）`);
  if (!(Number(facts.width) > 0)) unreachable(`宽度 ${facts.width}px`);
  if (!(Number(facts.height) > 0)) unreachable(`高度 ${facts.height}px`);
  if (!facts.inViewport) unreachable("滚到最近位置后仍不在视口内");
  if (facts.centerOutsideViewport) {
    // 和 HIT_TEST_MISS 分开报：这两件事的修法完全不同。
    // 「视口外」= 还需要滚更多（或者它压根滚不进来）；
    // 「命中失败」= 滚到位了，但那个位置上是别的东西。
    failures.push({
      code: REACHABILITY_CODES.OUT_OF_VIEW,
      detail: `滚到位后中心点仍在视口外（中心 y=${facts.center?.[1]} · 视口高 ${facts.viewport?.[1]}）—— 未做命中测试，别把它当成「被盖住」`,
    });
  } else if (!facts.hitTestSelf) {
    failures.push({
      code: REACHABILITY_CODES.HIT_TEST_MISS,
      detail: `中心点 elementFromPoint 命中的是 ${facts.hitTestTarget || "（视口外，无命中）"}，不是它自己 —— 真鼠标点不中`,
    });
  }
  if (facts.pointerEvents === "none") {
    failures.push({ code: REACHABILITY_CODES.POINTER_EVENTS_NONE, detail: "pointer-events: none" });
  }
  if (facts.disabled) {
    failures.push({ code: REACHABILITY_CODES.DISABLED, detail: "控件处于 disabled（用户点了没反应）" });
  }

  return { pass: failures.length === 0, code: failures[0]?.code ?? null, failures };
}

/**
 * 注入页面的采集器源码。
 *
 * 只负责**量事实**，不做判定 —— 判定在 `evaluateReachability` 里，
 * 一份逻辑、一处修改。这里多算出来的每个字段都要在纯函数里有对应的判据。
 *
 * `collect(selector)` 会先 `scrollIntoView({block:"nearest"})` 再测量：
 * 「滚一下能不能露出来」本身就是可达性的一部分，而且必须**真的滚**才知道，
 * 用 `offsetParent` 之类的静态推断会漏掉 `overflow:hidden` 的裁剪容器。
 */
export const COLLECT_SOURCE = String.raw`
window.__libmsReach = {
  collect(selector) {
    const el = document.querySelector(selector);
    if (!el) return { exists: false, selector };

    // 先滚到能看见：能滚出来 = 可达；滚不动（祖先 display:none）= 不可达。
    //
    // ⚠️ 必须用 block:"center"，不能用 block:"nearest"（2026-10-05 四档视口 QA 修）。
    // "nearest" 的语义是「滚到**滚动容器认为**它露出来了就停」，它不知道
    // 视口边缘上还压着一个 position:fixed 的浮层。390×844 实测：
    // 落地页上传拖放区在 y=1193–1311，视口高 844，nearest 滚到 726–844 就停了，
    // 而贴底的 .mobile-tabbar（745–844，z-index 100）盖掉了它 118px 里的 99px，
    // 只剩 19px 露出来 —— 中心点 (188,785) 命中的是操作条上的按钮。
    // 用 "center" 问的才是那个真问题：「用户把它滚进视野之后，点得中吗？」
    let scrolled = false;
    try {
      const before = el.getBoundingClientRect();
      el.scrollIntoView({ block: "center", inline: "nearest" });
      const after = el.getBoundingClientRect();
      scrolled = Math.abs(after.top - before.top) > 0.5 || Math.abs(after.left - before.left) > 0.5;
    } catch (error) { /* 不可滚动的祖先会抛，忽略 */ }

    const rect = el.getBoundingClientRect();
    const style = getComputedStyle(el);

    // 有效 opacity = 自身 × 所有祖先。任何一层是 0 都等于看不见。
    let opacity = Number(style.opacity);
    if (!Number.isFinite(opacity)) opacity = 1;
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const value = Number(getComputedStyle(node).opacity);
      opacity *= Number.isFinite(value) ? value : 1;
    }

    // 祖先链上的 display:none / visibility:hidden。
    // 必须逐层查：getComputedStyle(child).display 不会因为祖先是 none 就返回 none。
    let ancestorHidden = false;
    for (let node = el.parentElement; node && node !== document.documentElement; node = node.parentElement) {
      const s = getComputedStyle(node);
      if (s.display === "none" || s.visibility === "hidden" || s.visibility === "collapse") { ancestorHidden = true; break; }
    }

    const vw = window.innerWidth, vh = window.innerHeight;
    const inViewport = rect.width > 0 && rect.height > 0
      && rect.bottom > 0 && rect.top < vh && rect.right > 0 && rect.left < vw;

    // 命中测试点 = 元素**真实中心点**。这里**不做 clamp**。
    //
    // clamp 会给「视口外的元素」凭空造一个视口边缘的点，然后拿这个点去做命中测试、
    // 报「真鼠标点不中」—— 那是探针自己造出来的假失败，不是产品的问题。
    // 390×844 实测：落地页上传拖放区中心 y=1252、视口高 844，
    // 被 Math.min(vh-1, …) 夹到 843 之后命中了贴底操作条上的按钮，
    // 门于是报 TARGET_HIT_TEST_MISS —— 而真相只是「它在折叠线以下」。
    // 现在：视口外就如实记 centerOutsideViewport，由纯函数给 OUT_OF_VIEW 码，
    // 不把「视口外」冒充成「被盖住」。两者要修的东西完全不同。
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const centerOutsideViewport = centerX < 0 || centerX > vw || centerY < 0 || centerY > vh;

    let hitTestSelf = false;
    let hitTestTarget = null;
    if (rect.width > 0 && rect.height > 0 && !centerOutsideViewport) {
      const hit = document.elementFromPoint(centerX, centerY);
      hitTestTarget = hit ? describe(hit) : null;
      hitTestSelf = Boolean(hit) && (hit === el || el.contains(hit) || hit.contains(el));
    }

    return {
      exists: true,
      selector,
      display: style.display,
      visibility: style.visibility,
      opacity: Number(opacity.toFixed(3)),
      ancestorHidden,
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      pointerEvents: style.pointerEvents,
      disabled: Boolean(el.disabled) || el.getAttribute("aria-disabled") === "true",
      inViewport,
      scrolled,
      center: [Math.round(centerX), Math.round(centerY)],
      viewport: [vw, vh],
      centerOutsideViewport,
      hitTestSelf,
      hitTestTarget,
      text: (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 40),
      ariaLabel: el.getAttribute("aria-label") || "",
    };
  },
};

function describe(node) {
  const tag = node.tagName ? node.tagName.toLowerCase() : "?";
  const id = node.id ? "#" + node.id : "";
  const cls = typeof node.className === "string" && node.className
    ? "." + node.className.trim().split(/\s+/).slice(0, 2).join(".")
    : "";
  return tag + id + cls;
}
`;

/* ────────────────────────── §18 Dead UI Audit 的分类 ────────────────────────── */

/**
 * §18 的分类结果。**注意 `disabled` 和 `unreachable` 是两件事**：
 * 一个 disabled 的按钮是「看得见、点得动、但当前没得用」（例如没有撤销历史时的撤销键），
 * 一个 unreachable 的按钮是「用户根本够不到」。把它们混成一句「不可达」，
 * 报告就会变成一堆噪音，真正该修的那几条会被淹掉。
 */
export const DEAD_UI_CLASSES = {
  REACHABLE: "reachable",
  DISABLED: "disabled",
  COVERED: "covered",
  HIDDEN: "hidden",
  ABSENT: "absent",
  HANDLER_ONLY: "invoke-handler-only",
};

/** 观测的「可见程度」打分：用来在多个状态里挑出最有说服力的那一次。 */
function visibilityScore(facts) {
  if (!facts || !facts.exists) return -1;
  if (facts.display === "none" || facts.ancestorHidden) return 0;
  const area = (facts.width || 0) * (facts.height || 0);
  if (area <= 0) return 1;
  if (facts.hitTestSelf) return 4 + Math.min(area / 10000, 1); // 真的能点，面积大的优先
  return 2 + Math.min(area / 10000, 1);                        // 有盒子但被盖住
}

/**
 * 纯函数：把「同一个控件在多个界面状态下的观测」判成 §18 的一个分类。
 *
 * @param {Array<{state: string, facts: object}>} observations
 * @returns {{klass: string, reachableIn: string|null, best: object|null, codes: string[]}}
 */
export function classifyDeadUi(observations = []) {
  const present = observations.filter((o) => o?.facts?.exists);
  if (!present.length) {
    return { klass: DEAD_UI_CLASSES.ABSENT, reachableIn: null, best: null, codes: [] };
  }

  const codes = [];
  let reachableIn = null;
  let best = null;
  let bestScore = -1;

  for (const o of present) {
    const verdict = evaluateReachability(o.facts);
    codes.push(verdict.code);
    if (verdict.pass) {
      reachableIn = reachableIn ?? o.state;
    }
    const score = visibilityScore(o.facts);
    if (score > bestScore) { bestScore = score; best = o; }
  }
  if (reachableIn) return { klass: DEAD_UI_CLASSES.REACHABLE, reachableIn, best, codes };

  const f = best.facts;
  // 有盒子、也滚得到，只是中心点被别的层占了 → 被遮挡（最容易被误判成「死」的一类）
  if (f.display !== "none" && !f.ancestorHidden && f.width > 0 && f.height > 0 && !f.hitTestSelf) {
    return { klass: DEAD_UI_CLASSES.COVERED, reachableIn: null, best, codes };
  }
  // 看得见、命中自己，唯独不可用 → disabled，不是死代码
  if (f.display !== "none" && !f.ancestorHidden && f.visibility === "visible"
      && f.width > 0 && f.height > 0 && f.pointerEvents !== "none" && f.disabled) {
    return { klass: DEAD_UI_CLASSES.DISABLED, reachableIn: null, best, codes };
  }
  return { klass: DEAD_UI_CLASSES.HIDDEN, reachableIn: null, best, codes };
}

/** 只有这些标签/角色算「控件」。容器、画布、空占位不该进审计表。 */
export const INTERACTIVE_SELECTOR = [
  "button", "input", "select", "textarea", "a[href]", "summary",
  "[role=button]", "[role=menuitem]", "[role=tab]", "[role=switch]", "[role=checkbox]",
].join(",");

/** 在页面里把采集器装上（幂等，可重复调用）。 */
export const INSTALL_COLLECT_SOURCE = `${COLLECT_SOURCE}\n"reach-installed"`;

/**
 * 可达性清单。
 *
 * 分两相：
 *   · `phase: "landing"`   —— 落地页（还没进工作台）
 *   · `phase: "workspace"` —— 工作台（已上传源图并生成过图纸，默认）
 *
 * `panel` 表示「测这一条之前必须先切到右栏这个 Tab」。
 * `openDrawer` 表示「先点开导出中心」（抽屉是 visibility/opacity 切换，
 * 不点开的话里面的按钮第九条判据过不去 —— 这正是我们要抓的东西）。
 * `openRailMenu` 表示「先展开左轨这个子菜单」（子菜单是 `<details>`，
 * 不展开的话里面的按钮根本不存在 —— 不展开就测等于没测）。
 */
export const REACHABILITY_TARGETS = [
  /* ── §9.1 生成 Tab ───────────────────────────────────────────────── */
  { id: "tab-generation", group: "生成 Tab", selector: '[data-ws-panel="generation"]', label: "右栏「生成」Tab" },

  /* ── §9.2 八个生成模式 ───────────────────────────────────────────── */
  ...[
    ["beginner", "小白一键"], ["auto", "智能"], ["portrait", "人像"], ["anime", "动漫"],
    ["illustration", "插画"], ["pixel", "像素"], ["logo", "Logo"], ["photo", "写实"],
  ].map(([preset, label]) => ({
    id: `mode-${preset}`,
    group: "生成模式",
    panel: "generation",
    selector: `[data-preset="${preset}"]`,
    label: `模式卡 · ${label}`,
  })),

  /* ── §9.11 左轨工具（含三个子菜单）──────────────────────────────────
     C0 §18 实测发现：这三组入口原来全部不可达 —— 子菜单是向右浮出的绝对定位层，
     被 `.ws-rail { overflow-x: hidden }` 整块裁掉（按钮有 37×38 的盒子但
     `elementFromPoint` 命中不到）。改成就地展开后必须由门守住，
     否则下次有人「顺手」把它改回浮出，又是一次全绿的白屏。 */
  ...[
    ["形状", ["line", "rect", "ellipse"]],
    ["选择", ["region", "wand", "same", "connected"]],
    ["镜像", ["mirror-horizontal", "mirror-vertical"]],
  ].flatMap(([menu, entries]) => entries.map((entry) => ({
    id: `rail-${entry}`,
    group: "左轨工具",
    openRailMenu: menu,
    selector: `[data-tool="${entry}"], [data-panel="${entry}"]`,
    label: `左轨「${menu}」· ${entry}`,
  }))),

  /* ── §9.3 Palette Picker ─────────────────────────────────────────── */
  { id: "palette-search", group: "Palette Picker", panel: "color", selector: "#ws-color-search", label: "色号搜索框" },
  { id: "palette-cell", group: "Palette Picker", panel: "color", selector: "#ws-bead-picker [data-ws-pick]", label: "色格墙第一个色格" },

  /* ── §9.4 Usage Strip ────────────────────────────────────────────── */
  { id: "usage-sort", group: "Usage Strip", panel: "color", selector: '[data-ws-usage-sort="count-desc"]', label: "用色统计 · 数量↓" },
  { id: "usage-card", group: "Usage Strip", panel: "color", selector: "#ws-usage-strip [data-ws-usage]", label: "用色统计第一张卡" },

  /* ── §9.5 Resize（图纸尺寸） ─────────────────────────────────────── */
  { id: "resize-open", group: "Resize", panel: "project", selector: "#ws-resize-open", label: "「调整尺寸」按钮" },

  /* ── §9.6 Text ───────────────────────────────────────────────────── */
  // 文字工具没有工具条按钮（`EXTENDED_TOOL_IDS` 里的那个实例从未被实例化），
  // 用户真正的入口是「编辑」面板里的「+ 添加文字」，以及 T 快捷键。这里验前者。
  { id: "text-add", group: "Text", panel: "edit", selector: '[data-text-action="add"]', label: "「+ 添加文字」按钮" },

  /* ── §9.7 Reference（参考底图） ──────────────────────────────────── */
  { id: "ref-pick", group: "Reference", panel: "edit", selector: "#ws-ref-pick", label: "「添加 / 替换」参考底图" },

  /* ── §9.8 Diagnostics ────────────────────────────────────────────── */
  { id: "diag-category", group: "Diagnostics", panel: "edit", selector: "#ws-diagnostic-category", label: "问题分类下拉" },
  { id: "diag-cleanup", group: "Diagnostics", panel: "color", selector: "#ws-color-cleanup", label: "「清理杂点」按钮" },

  /* ── §9.9 Material（材料） ───────────────────────────────────────── */
  { id: "tab-material", group: "Material", selector: '[data-ws-panel="material"]', label: "右栏「材料」Tab" },
  { id: "material-total", group: "Material", panel: "material", selector: "#ws-material-total", label: "「本作品用豆」读数" },
  { id: "inventory-section", group: "Material", panel: "material", selector: "#inventoryPanel .ws-section-title", label: "库存台账首节标题" },

  /* ── §9.10 Export ────────────────────────────────────────────────── */
  { id: "export-open", group: "Export", selector: "#ws-export", label: "工具坞「导出」按钮" },
  { id: "export-png", group: "Export", openDrawer: true, selector: '[data-export-v2="png"]', label: "导出中心 · PNG 图纸" },
  { id: "export-pdf", group: "Export", openDrawer: true, selector: '[data-export-v2="pdf"]', label: "导出中心 · PDF 图纸" },

  /* ── §10 invoke-handler-only：故意不可见，由别的控件触发 ─────────── */
  {
    id: "ref-file",
    group: "Reference",
    declaration: DECLARATION.INVOKE_HANDLER_ONLY,
    selector: "#ws-ref-file",
    triggeredBy: "ref-pick",
    label: "参考图 <input type=file hidden>（由「添加 / 替换」触发）",
  },
  {
    id: "landing-file-input",
    group: "Palette Picker",
    phase: "landing",
    declaration: DECLARATION.INVOKE_HANDLER_ONLY,
    selector: "#file-input",
    triggeredBy: "upload-zone",
    label: "落地页 <input type=file>（由拖放区触发）",
  },
  {
    id: "upload-zone",
    group: "Palette Picker",
    phase: "landing",
    selector: "#upload-zone",
    label: "落地页上传拖放区",
  },
];

/** 取某一相的清单。 */
export function targetsForPhase(phase) {
  return REACHABILITY_TARGETS.filter((target) => (target.phase || "workspace") === phase);
}
