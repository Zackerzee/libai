/**
 * Stage C0 §18 —— Dead UI Audit 的分类契约。
 *
 * ── 为什么单独一个文件 ────────────────────────────────────────────────
 * §18 要求把每个入口分类成 reachable / hidden / dead / compat。
 * 分类错了，报告就没意义 —— 而最容易错的一种错法是把
 * **disabled**（看得见、点得动、只是当前没得用）和 **unreachable**（够不到）
 * 混成一句「不可达」。那会让报告里塞满「没有撤销历史时的撤销键」这种噪音，
 * 真正该修的那几条被淹掉。
 *
 * 所以分类逻辑做成纯函数 `classifyDeadUi()` 单独单测；
 * 探针只负责把多个界面状态下的观测喂进去。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEAD_UI_CLASSES,
  INTERACTIVE_SELECTOR,
  classifyDeadUi,
} from "../tools/ui-reachability-gate.mjs";

const audit = readFileSync(new URL("../tools/ui-dead-audit.mjs", import.meta.url), "utf8");

/** 一个「健康」的观测：可见、可点、可用。 */
const healthy = (over = {}) => ({
  exists: true,
  selector: "#x",
  display: "block",
  visibility: "visible",
  opacity: 1,
  ancestorHidden: false,
  width: 100,
  height: 30,
  pointerEvents: "auto",
  disabled: false,
  inViewport: true,
  scrolled: false,
  hitTestSelf: true,
  hitTestTarget: "button#x",
  text: "",
  ariaLabel: "",
  ...over,
});
const obs = (...list) => list.map(([state, facts]) => ({ state, facts }));

test("§18 分类常量是稳定的字符串（报告与文档都按这些值匹配）", () => {
  assert.equal(DEAD_UI_CLASSES.REACHABLE, "reachable");
  assert.equal(DEAD_UI_CLASSES.DISABLED, "disabled");
  assert.equal(DEAD_UI_CLASSES.COVERED, "covered");
  assert.equal(DEAD_UI_CLASSES.HIDDEN, "hidden");
  assert.equal(DEAD_UI_CLASSES.ABSENT, "absent");
  assert.equal(DEAD_UI_CLASSES.HANDLER_ONLY, "invoke-handler-only");
});

test("§18 任何状态下都够不到但某个状态能点 → reachable，并记下是哪个状态", () => {
  const r = classifyDeadUi(obs(
    ["panel:project", healthy({ display: "none", ancestorHidden: true, width: 0, height: 0, hitTestSelf: false })],
    ["panel:edit", healthy()],
  ));
  assert.equal(r.klass, DEAD_UI_CLASSES.REACHABLE);
  assert.equal(r.reachableIn, "panel:edit");
});

test("§18 disabled 必须和「够不到」分开报（撤销键在没历史时就是 disabled，不是死代码）", () => {
  const r = classifyDeadUi(obs(
    ["panel:project", healthy({ disabled: true })],
    ["panel:edit", healthy({ disabled: true })],
  ));
  assert.equal(r.klass, DEAD_UI_CLASSES.DISABLED, "看得见、点得动、只是没得用 —— 这是 disabled");
  assert.equal(r.reachableIn, null);
});

test("§18 有盒子但中心点被别的层占了 → covered（最容易被误判成「死」的一类）", () => {
  const r = classifyDeadUi(obs(
    ["panel:project", healthy({ hitTestSelf: false, hitTestTarget: "div#ws-canvas-well.ws-canvas-well" })],
  ));
  assert.equal(r.klass, DEAD_UI_CLASSES.COVERED);
});

test("§18 display:none / 0×0 / 祖先隐藏 → hidden", () => {
  assert.equal(
    classifyDeadUi(obs(["panel:project", healthy({ display: "none", width: 0, height: 0, hitTestSelf: false })])).klass,
    DEAD_UI_CLASSES.HIDDEN,
  );
  assert.equal(
    classifyDeadUi(obs(["panel:project", healthy({ width: 0, height: 0, hitTestSelf: false })])).klass,
    DEAD_UI_CLASSES.HIDDEN,
  );
  assert.equal(
    classifyDeadUi(obs(["panel:project", healthy({ ancestorHidden: true })])).klass,
    DEAD_UI_CLASSES.HIDDEN,
  );
});

test("§18 任何状态下都不存在 → absent（这才是真死代码）", () => {
  const r = classifyDeadUi(obs(["panel:project", { exists: false }]));
  assert.equal(r.klass, DEAD_UI_CLASSES.ABSENT);
  assert.equal(r.reachableIn, null);
  assert.deepEqual(classifyDeadUi([]).klass, DEAD_UI_CLASSES.ABSENT, "空观测也算 absent，不能崩");
});

test("§18 多个状态里挑「最有说服力」的那一次做证据（能点的优先，其次面积大的）", () => {
  const r = classifyDeadUi(obs(
    ["panel:project", healthy({ display: "none", ancestorHidden: true, width: 0, height: 0, hitTestSelf: false })],
    ["panel:edit", healthy({ disabled: true, width: 60, height: 27 })],
  ));
  assert.equal(r.best.state, "panel:edit", "证据要挑那个真的占面积的状态，不能挑 display:none 的那次");
  assert.equal(r.best.facts.width, 60);
});

test("§18 审计只收交互元素，容器/画布/空占位不进表", () => {
  for (const tag of ["button", "input", "select", "textarea"]) {
    assert.ok(INTERACTIVE_SELECTOR.includes(tag), `交互元素 ${tag} 必须被收进来`);
  }
  for (const container of ["div", "span", "p", "section", "canvas", "img", "datalist", "tbody", "form"]) {
    assert.ok(!new RegExp(`(^|[,\\s])${container}([,\\s]|$)`).test(INTERACTIVE_SELECTOR), `容器 ${container} 不该进审计表`);
  }
});

test("§18 审计直接读 legacy 登记表，不自己另立一套 compat 名单", () => {
  // compat 的权威来源是 ui/legacy-ui-policy.js（12 个对话框 + owner 字段）。
  // 审计里再抄一份名单 = 两处会漂移。
  assert.match(audit, /data-legacy-ui/, "必须读 DOM 上的 legacy 标记");
  assert.match(audit, /closest\("\[data-legacy-ui\]"\)/, "必须按祖先判定，因为对话框里的控件才是 compat 本体");
  assert.match(audit, /klass: "compat"/, "落在登记表里的控件直接归 compat");
  assert.doesNotMatch(audit, /LEGACY_DIALOG_IDS/, "别在审计里硬编码对话框 id 清单");
});

test("§18 审计复用门的采集器与分类器，不自己重写一套判定", () => {
  assert.match(audit, /INSTALL_COLLECT_SOURCE/, "必须注入门的采集器");
  assert.match(audit, /classifyDeadUi/, "必须用纯函数分类");
  assert.match(audit, /INTERACTIVE_SELECTOR/, "候选清单必须用统一常量");
  assert.match(audit, /serve-with-headers\.mjs/, "必须走生产 CSP 头");
  assert.match(audit, /--no-proxy-server/, "必须绕开系统代理");
});

test("§18 审计的状态集必须覆盖到「入口可能藏身」的每一类容器", () => {
  // 少扫一个状态 = 那一类入口全被误报成 hidden。
  // 实测第一次只扫了 7 个面板 + 施工 + 抽屉，结果 280 个控件「从未可达」——
  // 全是折叠菜单和对话框里的，噪音把真问题盖住了。
  //
  // 7 个面板是在循环里拼出 `panel:${panel}` 的，所以按面板清单 + 模板断言。
  assert.match(
    audit,
    /\["project", "source", "generation", "color", "edit", "check", "material"\]/,
    "7 个右栏面板必须逐个扫（少一个，那个面板里的入口全被误报）",
  );
  assert.match(audit, /record\(`panel:\$\{panel\}`\)/, "面板状态名要按面板 id 拼出来");

  const required = [
    "mode:build",         // 不在 tab 数组里，只能由左轨按钮激活
    "menu:project",       // 「新建 / 导入」折叠菜单
    "drawer:export",      // 导出抽屉
    "dialog:resize",      // 调整图纸尺寸
    "dialog:blank-board", // 新建空白图纸
    "dialog:usage",       // 用豆清单
  ];
  for (const state of required) {
    assert.ok(audit.includes(`"${state}"`), `状态集缺了「${state}」—— 那一类入口会被误报成 hidden`);
  }
});

test("§18 审计把「需要人看」的三类单独列出来，别的只计数", () => {
  assert.match(audit, /NEEDS_ATTENTION/, "covered / hidden / absent 必须单独列出来看");
  assert.match(audit, /\[DEAD_UI_CLASSES\.COVERED, DEAD_UI_CLASSES\.HIDDEN, DEAD_UI_CLASSES\.ABSENT\]/);
  assert.match(audit, /ui-dead-audit\.json/, "明细要落盘");
});
