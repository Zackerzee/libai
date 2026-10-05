/**
 * Stage C0 —— ESM 严格语法守卫。
 *
 * ── 为什么需要这个文件 ────────────────────────────────────────────────
 * Stage C0 的右栏 IA 重排里，`ui/generation-panel.js` 的一个模板字面量里嵌了
 * HTML 注释，注释里写了 `` `data-field="maxColors"` `` —— 反引号**提前闭合了
 * 模板**，后面的中文被当成标识符，真浏览器直接 `SyntaxError: Unexpected identifier 'data'`，
 * `document.body.dataset.workspaceState` 落到 `failed`，工作台白屏。
 *
 * 而当时：
 *   · 63 条新增单测**全绿**（它们把源文件当文本读，做正则断言）；
 *   · `node --check ui/generation-panel.js` **也绿**（Node 把 `.js` 当 CommonScript 解析）；
 *   · 抓出它的是**真机探针**（页面挂不上，探针卡在等 `ready`）。
 *
 * 这类错误的代价是「单测全绿 + 线上白屏」，所以必须有一条**用真 ESM 解析器**
 * 的守卫。守卫是 `tools/esm-syntax-check.mjs`（`vm.SourceTextModule`，只解析不执行）。
 *
 * 这个文件守三件事：
 *   ① 全仓 `.js` / `.mjs` 都能被真 ESM 解析器解析；
 *   ② 守卫**不是空转的** —— 喂它一段已知坏形状，它必须报错；
 *   ③ 守卫的扫描范围与实现方式没被偷偷改窄（不跳过 deploy、不用 --check 冒充解析）。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOOL = path.join(ROOT, "tools/esm-syntax-check.mjs");
const NODE = process.execPath;
const toolSource = fs.readFileSync(TOOL, "utf8");

/** 跑一次守卫，拿退出码 + JSON 结果。 */
const runTool = (args = []) => {
  const r = spawnSync(NODE, [TOOL, "--json", ...args], { encoding: "utf8", cwd: ROOT, timeout: 180000 });
  let payload = null;
  try { payload = JSON.parse(r.stdout); } catch { /* 解析失败留给断言去说 */ }
  return { status: r.status, payload, stdout: r.stdout, stderr: r.stderr };
};

test("§8 全仓 .js / .mjs 都能被真 ESM 解析器解析（模板反引号提前闭合这类错误挡在这里）", () => {
  const { status, payload } = runTool();
  assert.ok(payload, "守卫没吐出 JSON —— 工具本身跑不起来");
  assert.ok(payload.scanned > 300, `扫描面太窄了（只扫到 ${payload.scanned} 个文件），守卫形同虚设`);
  assert.equal(
    payload.failed,
    0,
    `有文件过不了真 ESM 解析：\n${(payload.failures || [])
      .map((f) => `  ${f.file}${f.line ? `:${f.line}` : ""}  ${f.message}\n     ${f.lineText || ""}`)
      .join("\n")}`,
  );
  assert.equal(status, 0, "解析失败时必须以非零码退出，否则 CI 拦不住");
});

test("§8 守卫不是空转的：喂它一段「模板里嵌 HTML 注释 + 反引号」必须报错", () => {
  // 这正是 C0 踩到的形状。抄在测试里当活体标本 —— 哪天有人把守卫改成
  // 「只看文件在不在」，这条会立刻红。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "esm-guard-"));
  const bad = path.join(dir, "bad.js");
  fs.writeFileSync(
    bad,
    [
      "export function render() {",
      "  return `",
      "    <!-- 数字框保留为自定义入口，`data-field=\"maxColors\"` 与 0..221 的区间没变 -->",
      "    <div></div>",
      "  `;",
      "}",
      "",
    ].join("\n"),
  );
  const ok = path.join(dir, "ok.js");
  fs.writeFileSync(ok, "export const a = 1;\n");

  const { status, payload } = runTool(["--files", bad, ok]);
  assert.ok(payload, "守卫没吐出 JSON");
  assert.equal(payload.scanned, 2, "显式 --files 模式下应该只扫给的两个文件");
  assert.equal(payload.failed, 1, "坏文件必须被报出来");
  assert.match(payload.failures[0].message, /Unexpected identifier/, "报的必须是真解析错误，不是别的");
  assert.equal(status, 1, "有解析失败必须以非零码退出");

  // 行号也要对 —— 没有行号的语法错误报告等于让人自己翻文件。
  assert.equal(payload.failures[0].line, 3, "出错行号要指向那一行注释");
  assert.match(payload.failures[0].lineText, /data-field/, "要带出出错那一行的原文");

  fs.rmSync(dir, { recursive: true, force: true });
});

test("§8 守卫用真解析器（vm.SourceTextModule），不是拿 node --check 冒充", () => {
  // 这条断言是在钉「守卫的原理」而不是「守卫的措辞」：
  // 一旦有人把主路径换成 execFileSync("node", ["--check", file])，
  // 它就会静默退化回 CommonScript 解析，C0 那个 bug 会原样复活。
  assert.match(toolSource, /new vm\.SourceTextModule\(/, "必须用 SourceTextModule 解析");
  assert.match(toolSource, /--experimental-vm-modules/, "缺这个 flag 会拿不到 SourceTextModule，要自己 re-exec");
  // 只解析、不执行：不能出现 evaluate / link。
  assert.doesNotMatch(toolSource, /\.evaluate\(/, "守卫必须只解析不执行");
  assert.doesNotMatch(toolSource, /\.link\(/, "守卫必须只解析不链接（链接会去解析依赖图，慢且会误报）");

  // `--check` 只允许出现在「已经解析失败之后、用来定位行号」的位置。
  // SourceTextModule 的错误不带行号，所以这个兜底是必要的 ——
  // 但它绝不能变成主判据。
  assert.match(toolSource, /catch[\s\S]{0,400}locateLine\(source\)/, "`--check` 兜底必须发生在解析失败之后");
  // locateLine 只能有「定义 + 一处调用」：调用点一多，早晚会有人把它挪到快路径上。
  assert.equal(
    (toolSource.match(/locateLine/g) || []).length,
    2,
    "locateLine 只该被定义一次、调用一次（就在 catch 里）",
  );
});

test("§8 守卫的扫描范围必须覆盖 deploy/（发布产物白屏比源码白屏更致命）", () => {
  // deploy/ 是手工维护的发布镜像。C0 那次事故里，源码修好之后
  // deploy/ 里那份**旧副本**仍然是坏的 —— 而探针打的正是 deploy/。
  // 所以守卫不能跳过 deploy。
  const skipBlock = toolSource.slice(toolSource.indexOf("const SKIP_DIRS"));
  const skipLine = skipBlock.slice(0, skipBlock.indexOf(";"));
  assert.doesNotMatch(skipLine, /deploy/, "deploy/ 必须在扫描范围内");
  assert.doesNotMatch(skipLine, /"src"|"ui"|"state"|"services"|"algorithms"/, "别把源码目录排除掉");

  // 用真文件验一次：deploy 下的入口文件必须能过。
  const r = spawnSync(NODE, [TOOL, "--json", "--files", path.join(ROOT, "deploy/ui/workspace-bootstrap.js")], {
    encoding: "utf8",
    cwd: ROOT,
    timeout: 60000,
  });
  const payload = JSON.parse(r.stdout);
  assert.equal(payload.failed, 0, "deploy/ui/workspace-bootstrap.js 解析不过 —— 发布产物是坏的");
});

test("§8 已知的那份坏文件修好之后，工作台引导链路上的每个模块都解析得过", () => {
  // 直接钉住 C0 事故的现场：工作台挂载链路。
  const chain = [
    "ui/workspace-bootstrap.js",
    "ui/workspace.js",
    "ui/generation-panel.js",
    "ui/inventory-panel.js",
    "ui/text-panel.js",
    "app.js",
  ];
  const args = chain.map((f) => path.join(ROOT, f));
  const { status, payload } = runTool(["--files", ...args]);
  assert.ok(payload, "守卫没吐出 JSON");
  assert.equal(payload.scanned, chain.length);
  assert.equal(payload.failed, 0, `挂载链路里有文件解析不过：${JSON.stringify(payload.failures, null, 2)}`);
  assert.equal(status, 0);
});

test("§8 守卫能跑：退出码语义稳定（0 = 干净，非 0 = 有问题）", () => {
  // 防止「工具崩了也返回 0」这种最恶心的失效形状。
  const r = execFileSync(NODE, [TOOL, "--json"], { encoding: "utf8", cwd: ROOT, timeout: 180000 });
  const payload = JSON.parse(r);
  assert.equal(typeof payload.scanned, "number");
  assert.equal(typeof payload.failed, "number");
  assert.ok(Array.isArray(payload.failures));
});
