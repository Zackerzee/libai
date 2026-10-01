/**
 * 状态栏提示位测试（Stage B3 §29 / §30）。
 *
 * 这一组守的是一个**真机上抓到、单测原本全绿**的缺陷：
 *
 *   用户点「取消生成」→ 状态栏先显示「已取消生成」→ 紧接着被 paint() 覆盖成「已生成」。
 *
 * 根因不是取消没生效（取消 29ms 就生效了），而是**提示文案写错了地方**：
 * 直接 `$("#ws-status").textContent = ...`，而 `#ws-status` 的文案由 paint() 统一渲染。
 * 同一轮事件里 setState 触发 paint，用户那一下的结果就被抹掉了。
 *
 * 同类的还有两处：生成阶段进度（只写进了 legacy 状态栏，工作台上看不到）、
 * 「参数已改 · 手动编辑未覆盖」提示。三处一起收进 state。
 *
 * 结论性纪律：**#ws-status 只由 paint() 写，其他任何地方都不许直接写。**
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const read = (relative) => readFile(new URL(relative, import.meta.url), "utf8");

const [WORKSPACE, STORE, PROJECT_STORE, SERVICE, APP] = await Promise.all([
  read("../ui/workspace.js"),
  read("../state/store.js"),
  read("../state/project-store.js"),
  read("../services/generation-service.js"),
  read("../app.js"),
]);

/**
 * 去掉**整行注释**，避免说明性注释把扫描类断言弄红。
 *
 * 试过两种更"聪明"的写法，都在这个文件上翻车，记下来省得再踩：
 *   1. `/\/\*[\s\S]*?\*\//g` —— 文件里只要有一处字符串/正则含 `*/`，
 *      非贪婪匹配就提前收尾，随后一个 `/*` 开启跨几百行的巨大匹配。
 *      实测把 173KB 的 ui/workspace.js 吃成 51KB，「状态栏只写一次」扫出 0 次。
 *   2. 逐行块注释状态机 —— 同样被模板字符串里的 `/*`（内联 CSS/HTML）带偏，
 *      误吞 1442 行。
 *
 * 结论：这个仓库的文件里混着大量内联 CSS/HTML 文本，**任何**基于注释语法的
 * 剥离都不可靠。只按行首特征过滤是最稳的，代价是「行尾注释」会被保留 ——
 * 对这个断言无害（我们要防的是注释里引用旧代码，那种注释通常是整行）。
 */
const codeOf = (source) => source
  .split("\n")
  .filter((line) => {
    const trimmed = line.trim();
    return trimmed && !trimmed.startsWith("//") && !trimmed.startsWith("*") && !trimmed.startsWith("/*");
  })
  .join("\n");

test("状态栏：notice / generationPhase 进 store，默认值在 statusState", () => {
  assert.match(STORE, /notice:\s*""/, "statusState 必须有 notice 默认值");
  assert.match(STORE, /generationPhase:\s*""/, "statusState 必须有 generationPhase 默认值");
});

test("状态栏：两个字段必须能穿过 projectStore.snapshot（否则写了读不回来）", () => {
  // 不穿过 snapshot 的话，workspace 写进去、再读出来是 undefined，
  // 又退化成「直接写 DOM」那条老路。
  assert.match(PROJECT_STORE, /if \(s\.statusState\.notice\) status\.notice = s\.statusState\.notice;/);
  assert.match(PROJECT_STORE, /if \(s\.statusState\.generationPhase\) status\.generationPhase = s\.statusState\.generationPhase;/);
  // 必须是条件展开：默认就带这两个 key 会让默认快照多出 own key，deepStrictEqual 变红。
  assert.doesNotMatch(PROJECT_STORE, /const status = \{[^}]*notice/s, "notice 不能无条件进默认快照");
});

test("状态栏：#ws-status 只由 paint() 写，其他地方一律不许直接写", () => {
  const code = codeOf(WORKSPACE);
  const writes = code.match(/\$\("#ws-status"\)\.textContent\s*=/g) || [];
  assert.equal(writes.length, 1,
    `#ws-status 只允许在 paint() 里写一次，实际 ${writes.length} 处（其余请改用 store.setState({status:{notice}}）)`);
});

test("状态栏：paint() 的文案优先级是 失败 > notice > 生成中(阶段) > 常规", () => {
  const start = WORKSPACE.indexOf('$("#ws-status").textContent = state.status.generationError');
  assert.ok(start > 0, "找不到状态栏渲染行");
  const line = WORKSPACE.slice(start, start + 900);
  const order = [
    line.indexOf("generationError"),
    line.indexOf("state.status.notice"),
    line.indexOf("state.status.generating"),
    line.indexOf("manualEdited"),
  ];
  for (let i = 1; i < order.length; i += 1) {
    assert.ok(order[i - 1] >= 0 && order[i] >= 0, "优先级链不完整");
    assert.ok(order[i - 1] < order[i], "文案优先级顺序不对：失败 > notice > 生成中 > 常规");
  }
  // 生成中必须优先显示真实阶段，而不是干巴巴的「正在生成」。
  assert.match(line, /state\.status\.generationPhase \|\| "正在生成"/);
});

test("状态栏：取消按钮把提示写进 store，而不是直接写 DOM", () => {
  const start = WORKSPACE.indexOf('$("#ws-cancel-generate").addEventListener("click"');
  const body = WORKSPACE.slice(start, start + 900);
  assert.match(body, /notice:\s*cancelled \? "已取消生成" : "当前没有正在进行的生成"/);
  assert.doesNotMatch(codeOf(body), /\$\("#ws-status"\)/, "取消按钮不得直接写状态栏");
});

test("状态栏：「参数已改 · 手动编辑未覆盖」与自动生成异常也走 store", () => {
  const start = WORKSPACE.indexOf("async function runAutoGenerate()");
  const body = WORKSPACE.slice(start, start + 1200);
  assert.match(body, /notice:\s*"参数已改 · 手动编辑未覆盖，点「重新生成」覆盖"/);
  assert.doesNotMatch(codeOf(body), /\$\("#ws-status"\)/, "runAutoGenerate 不得直接写状态栏");
});

test("状态栏：阶段进度经 libms:generation-phase 事件进 store", () => {
  assert.match(APP, /new CustomEvent\("libms:generation-phase", \{ detail: \{ phase, label \} \}\)/);
  assert.match(WORKSPACE, /window\.addEventListener\("libms:generation-phase", \(event\) => \{/);
  const start = WORKSPACE.indexOf('window.addEventListener("libms:generation-phase"');
  const body = WORKSPACE.slice(start, start + 400);
  assert.match(body, /generationPhase:\s*label/);
});

test("状态栏：阶段文案的中文翻译只在 app.js 做一次，UI 不重复翻译", () => {
  assert.match(APP, /const GENERATION_PHASE_LABELS = Object\.freeze\(\{/);
  // 工作台只消费 label，不该自己再建一张阶段名 → 中文的表。
  assert.doesNotMatch(WORKSPACE, /正在匹配真实色号/, "UI 不应重复定义阶段文案");
});

test("状态栏：新一轮生成开始与结束时清掉上一轮的提示", () => {
  // 不清的话「已取消生成」会一直挂着，或者上一轮的阶段文案串到这一轮。
  assert.match(SERVICE, /store\.setState\(\{ status: \{ generating: true, notice: "", generationPhase: "" \} \}\)/);
  assert.match(SERVICE, /generationPhase: "" \}\s*\}\);/, "成功分支必须清 generationPhase");
  assert.match(SERVICE, /store\.setState\(\{ status: \{ generating: false, generationPhase: "" \} \}\)/);
});

test("状态栏：生成失败时清掉提示，避免「失败」被一条旧提示盖住", () => {
  assert.match(WORKSPACE, /window\.addEventListener\("libms:generation-error", \(event\) => store\.setState\(\{ status: \{ generating: false, generationError: event\.detail, notice: "", generationPhase: "" \} \}\)\)/);
});

test("状态栏：取消 / 预期结局不得被写成「生成失败」", () => {
  // 取消走的是 AbortError → 适配层吞掉 → 不写 generationError。
  // 一旦有人把 isExpectedGenerationOutcome 的判断删掉，这条会红。
  assert.match(SERVICE, /if \(bridge\.isExpectedGenerationOutcome\?\.\(error\)\) return null;/);
  assert.doesNotMatch(codeOf(SERVICE), /catch[\s\S]{0,120}generationError/, "适配层不得写 generationError");
});
