/**
 * Stage C0 §9 —— 可达性探针的覆盖契约。
 *
 * §9 点名要检查十类：生成 Tab / 8 个模式 / Palette Picker / Usage Strip / Resize /
 * Text / Reference / Diagnostics / Material / Export。
 *
 * 这个文件管两件事：
 *   ① 清单必须真的覆盖这十类（漏一类 = 那一类从来没人验过）；
 *   ② 探针不许用 `element.click()` 当 PASS 判据 ——
 *      `HTMLElement.click()` 会穿透 `display: none`，这正是 §8 要堵的洞。
 *      探针必须走 `elementFromPoint` 的真命中测试。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { REACHABILITY_TARGETS, targetsForPhase } from "../tools/ui-reachability-gate.mjs";

const probe = readFileSync(new URL("../tools/ui-reachability-probe.mjs", import.meta.url), "utf8");
const gate = readFileSync(new URL("../tools/ui-reachability-gate.mjs", import.meta.url), "utf8");

const REQUIRED_GROUPS = [
  "生成 Tab", "生成模式", "Palette Picker", "Usage Strip",
  "Resize", "Text", "Reference", "Diagnostics", "Material", "Export",
  // C0 §18 补的一类：左轨的三个子菜单（形状 / 选择 / 镜像）。
  // 它们原来全部不可达（浮出层被 overflow-x: hidden 裁掉），
  // 不在清单里就没人守得住。
  "左轨工具",
];

test("§9 清单覆盖全部十类目标", () => {
  const groups = new Set(REACHABILITY_TARGETS.map((t) => t.group));
  for (const group of REQUIRED_GROUPS) assert.ok(groups.has(group), `清单缺了「${group}」这一类`);
});

test("§18 左轨三个子菜单的入口一条都不能少（它们曾经全部不可达）", () => {
  const rail = REACHABILITY_TARGETS.filter((t) => t.group === "左轨工具");
  assert.deepEqual(
    rail.map((t) => t.id),
    [
      "rail-line", "rail-rect", "rail-ellipse",
      "rail-region", "rail-wand", "rail-same", "rail-connected",
      "rail-mirror-horizontal", "rail-mirror-vertical",
    ],
    "形状 3 + 选择 4 + 镜像 2 = 9 个入口，少一个就等于那一组没被验过",
  );
  for (const target of rail) {
    assert.ok(target.openRailMenu, `${target.id} 必须先声明要展开哪个子菜单，否则按钮根本不存在`);
    assert.ok(["形状", "选择", "镜像"].includes(target.openRailMenu), `${target.id} 的 openRailMenu 值不认识`);
  }
  // 三个菜单都要有人用；否则那个菜单就是「声明了但从不展开」
  assert.deepEqual([...new Set(rail.map((t) => t.openRailMenu))].sort(), ["形状", "选择", "镜像"]);
});

test("§18 探针真的会展开左轨子菜单（不展开就测等于没测）", () => {
  assert.match(probe, /target\.openRailMenu/, "探针必须处理 openRailMenu");
  assert.match(probe, /d\.open = true/, "必须真的把 <details> 打开");
  assert.match(probe, /子菜单可展开/, "展开失败要单独报一条，别让它伪装成「入口不可达」");
  assert.match(probe, /sl-rail-menu/, "必须按 .sl-rail-menu 定位子菜单");
});

test("§9 八个生成模式一个都不能少", () => {
  const modes = REACHABILITY_TARGETS.filter((t) => t.group === "生成模式").map((t) => t.id);
  assert.deepEqual(modes, [
    "mode-beginner", "mode-auto", "mode-portrait", "mode-anime",
    "mode-illustration", "mode-pixel", "mode-logo", "mode-photo",
  ]);
});

test("清单里的选择器都是具体可寻址的，没有通配或空值", () => {
  for (const target of REACHABILITY_TARGETS) {
    assert.ok(target.id && typeof target.id === "string", "每条目标都要有 id");
    assert.ok(target.selector && typeof target.selector === "string", `${target.id} 缺 selector`);
    assert.ok(target.label, `${target.id} 缺 label`);
    assert.doesNotMatch(target.selector, /\*/, `${target.id} 的选择器不该用通配符`);
  }
  const ids = REACHABILITY_TARGETS.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length, "id 必须唯一");
});

test("§10 两相清单都有内容，且 landing 相只放落地页的东西", () => {
  const landing = targetsForPhase("landing");
  const workspace = targetsForPhase("workspace");
  assert.ok(landing.length >= 2, "落地相至少要覆盖上传入口与它的 hidden file input");
  assert.ok(workspace.length >= 15, `工作台相目标太少：${workspace.length}`);
  assert.ok(landing.every((t) => t.phase === "landing"));
  assert.ok(workspace.every((t) => !t.phase || t.phase === "workspace"));
});

test("§10 invoke-handler-only 的每一条都必须指名触发它的控件，且那个控件在同清单里", () => {
  const handlerOnly = REACHABILITY_TARGETS.filter((t) => t.declaration === "invoke-handler-only");
  assert.ok(handlerOnly.length >= 2, "至少要覆盖「参考图 file input」与「落地页 file input」两个真实例子");
  for (const target of handlerOnly) {
    assert.ok(target.triggeredBy, `${target.id} 声明了 invoke-handler-only，必须给出 triggeredBy`);
    const trigger = REACHABILITY_TARGETS.find((t) => t.id === target.triggeredBy);
    assert.ok(trigger, `${target.id} 的 triggeredBy=${target.triggeredBy} 不在清单里 —— 触发者本身没被验过`);
    assert.notEqual(trigger.declaration, "invoke-handler-only", "触发者不能自己也是 invoke-handler-only，否则是套娃");
  }
});

test("§8 探针不得用 element.click() 当 PASS 判据", () => {
  // 唯一允许出现 .click() 的地方是**导航**（切 tab / 开抽屉 / 切面板），
  // 那些动作本身的按钮由门单独验。判定入口是否可达的那段代码里不许有 click。
  const measureStart = probe.indexOf("const measure = async (target) => {");
  const measureEnd = probe.indexOf("};", probe.indexOf("return { target, facts, verdict };"));
  assert.ok(measureStart > 0 && measureEnd > measureStart, "找不到 measure 函数");
  const measureBody = probe.slice(measureStart, measureEnd);
  assert.match(measureBody, /evaluateReachability\(/, "判定必须走门");
  assert.doesNotMatch(measureBody, /\.click\(/, "measure 里不许用 element.click() 判定");
});

test("§8 探针真的做了命中测试，且做了「真点击校准」与「反向验证」", () => {
  // 采集器必须在页面里跑 elementFromPoint（等价于真鼠标的命中测试）
  assert.match(gate, /document\.elementFromPoint\(/, "采集器必须用 elementFromPoint 做命中测试");
  assert.match(gate, /scrollIntoView\(/, "「滚一下能不能露出来」必须真的滚，不能静态推断");
  // 真 CDP 鼠标点击做校准
  assert.match(probe, /Input\.dispatchMouseEvent/, "必须有真鼠标点击做校准");
  assert.match(probe, /校准：真鼠标点「生成」Tab 真的切换了面板/);
  // 反向验证：门必须能抓出真的不可达
  assert.match(probe, /反向验证：面板切走后模式卡被判为不可达/);
  assert.match(probe, /反向验证：同一个隐藏元素 element\.click\(\) 照样生效/);
});

test("§8 采集器把「祖先隐藏」单独量出来（只查自身 display 是错的）", () => {
  assert.match(gate, /ancestorHidden/, "采集器必须逐层查祖先的 display/visibility");
  assert.match(gate, /for \(let node = el\.parentElement;/, "祖先链必须逐层走，不能只看一层");
  assert.match(gate, /有效 opacity = 自身 × 所有祖先/, "opacity 必须逐层相乘");
});

test("§8 探针不得在 CSS 过渡的第 0 帧量（抽屉滑入竞态会伪造成「不可达」）", () => {
  // 实测事故：导出抽屉是 `transform: translateX(101%)` + `visibility: hidden`，
  // `.open` 一挂上就进入 240ms 过渡。探针原来只等 `classList.contains("open")`，
  // 于是可能在第 0 帧就量：此时 `visibility` 还是 `hidden`（继承给里面的按钮），
  // transform 还没走完、按钮 rect 落在视口右侧外面（x≈1444 @ 1440 宽）。
  // 门如实报 TARGET_NOT_USER_REACHABLE —— 但那是探针的竞态，不是产品缺陷。
  //
  // 所以「等抽屉打开」必须等到它**真的滑到位**。
  const openDrawerBlock = probe.slice(
    probe.indexOf("if (target.openDrawer && !drawerOpen)"),
    probe.indexOf("await measure(target);", probe.indexOf("if (target.openDrawer && !drawerOpen)")),
  );
  assert.match(openDrawerBlock, /classList\.contains\("open"\)/, "至少要等 .open 挂上");
  assert.match(openDrawerBlock, /getComputedStyle\(d\)/, "必须读抽屉的 computed style，不能只看类名");
  assert.match(openDrawerBlock, /visibility !== "visible"/, "必须等 visibility 真的变成 visible");
  assert.match(openDrawerBlock, /r\.right <= window\.innerWidth/, "必须等它完全滑进视口，不能只看 rect 非零");
  assert.match(openDrawerBlock, /滑入动画结束/, "等待条件要写明为什么，否则下一个人会「简化」掉它");
});

test("§8 校准必须在「没有浮层遮挡」的前提下做（抽屉开着时点不到 tab 是正确行为）", () => {
  // 导出抽屉 z-index:30 贴在右侧，开着的时候正好盖住右栏 tab 条。
  // 拿那个状态去校准「真鼠标点生成 Tab」，只会得到一个假的 FAIL。
  const calibrateAt = probe.indexOf("校准：真鼠标点「生成」Tab 真的切换了面板");
  const before = probe.slice(0, calibrateAt);
  assert.match(before, /#ws-export-close/, "校准前必须先把导出抽屉关掉");
  assert.match(before, /导出中心关闭/, "关闭也要等它真的关掉（同样是过渡）");
  // 点之前先滚到 tab：tab 条是 overflow-x:auto，前面几轮切换可能把它滚偏了。
  const clickBlock = probe.slice(calibrateAt - 1400, calibrateAt);
  assert.match(clickBlock, /el\.scrollIntoView\(\{ block: "nearest", inline: "nearest" \}\)/, "算中心点之前要先滚到 tab");
});

test("§8 失败记录必须带原始事实（只有一句 detail 是定不了性的）", () => {
  // 「产品真的不可达」和「探针量早了」在 detail 上可能长得一模一样，
  // 区分它们要靠 rect / hitTestTarget / ancestorHidden 这些原始值。
  assert.match(probe, /facts, code: verdict\.code, failures: verdict\.failures/, "measure 要把 facts 一起落盘");
  assert.match(probe, /gateFacts: genFacts/, "校准失败也要带上门当时量到的事实");
});

test("探针只走生产 CSP 头（不带头的本地服务会掩盖只在线上出现的故障）", () => {
  assert.match(probe, /serve-with-headers\.mjs/, "探针必须用带生产头的服务器");
  assert.match(probe, /--no-proxy-server/, "必须绕开本机系统代理，否则页面落在 chrome-error 上");
});

test("探针把结果落盘，失败时以非零码退出（CI 才拦得住）", () => {
  assert.match(probe, /reachability\.json/);
  assert.match(probe, /process\.exit\(failed\.length \? 1 : 0\)/);
});
