#!/usr/bin/env node
/**
 * ESM 严格语法检查 —— 用真 ESM 解析器扫全仓 `.js` / `.mjs`。
 *
 * ── 为什么必须有这个工具 ──────────────────────────────────────────────
 * `node --check foo.js` 把 `.js` 当 **CommonScript** 解析。于是下面这类
 * 只在真 ESM 解析器下才炸的错误，`--check` 一声不吭：
 *
 *   · 模板字面量里出现未转义的反引号 —— 例如在模板里写 HTML 注释，
 *     注释里又写了 `` `data-field="x"` ``，反引号会**提前闭合模板**，
 *     后面的文字被当成代码，报 `Unexpected identifier`。
 *   · class 里新增成员方法漏写闭合花括号。
 *   · `export` / `import` 形状写错。
 *
 * 而单测通常把源文件**当文本读**做正则断言 —— 语法炸了也照样绿。
 * 结果是：单测全绿、`--check` 全绿，浏览器一打开就白屏。
 *
 * Stage C0 就踩了这个坑：`ui/generation-panel.js` 的模板字面量里嵌了带反引号的
 * HTML 注释，`workspaceState` 直接落到 `failed`。发现它的是真机探针，
 * 不是任何一条单测。
 *
 * ── 做法 ──────────────────────────────────────────────────────────────
 * 用 `vm.SourceTextModule` 解析（**只解析、不执行**），所以可以安全地扫
 * 有副作用的入口文件。需要 `--experimental-vm-modules`，工具会自己 re-exec。
 *
 * 用法：
 *   node tools/esm-syntax-check.mjs                 # 扫全仓，人读输出
 *   node tools/esm-syntax-check.mjs --json          # 机器读输出
 *   node tools/esm-syntax-check.mjs --root <dir>    # 换扫描根
 *   node tools/esm-syntax-check.mjs --files a.js b.js
 * 退出码：有解析失败 → 1。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const ROOT = path.resolve(path.dirname(SELF), "..");

/* ── 需要 --experimental-vm-modules；没有就 re-exec 自己 ────────────── */
if (!process.execArgv.includes("--experimental-vm-modules")) {
  const r = spawnSync(
    process.execPath,
    ["--experimental-vm-modules", "--no-warnings", SELF, ...process.argv.slice(2)],
    { stdio: "inherit" },
  );
  process.exit(r.status ?? 1);
}

const vm = await import("node:vm");

/* ── 参数 ───────────────────────────────────────────────────────────── */
const argv = process.argv.slice(2);
const asJson = argv.includes("--json");
const rootArg = argv.indexOf("--root");
const scanRoot = rootArg >= 0 ? path.resolve(argv[rootArg + 1]) : ROOT;
const filesArg = argv.indexOf("--files");
const explicitFiles = filesArg >= 0 ? argv.slice(filesArg + 1).filter((a) => !a.startsWith("--")) : [];

/** 不扫的目录：依赖、版本库、内部文档、交付产物、测试素材、第三方 vendor。 */
const SKIP_DIRS = new Set(["node_modules", ".git", "docs", "outputs", "vendor", "fixtures", "coverage", ".probe-run"]);

function collect(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      collect(full, out);
    } else if (entry.isSymbolicLink()) {
      continue;
    } else if (entry.name.endsWith(".js") || entry.name.endsWith(".mjs")) {
      out.push(full);
    }
  }
  return out;
}

const files = explicitFiles.length ? explicitFiles.map((f) => path.resolve(f)) : collect(scanRoot);

/**
 * 精确定位出错行号。
 *
 * `vm.SourceTextModule` 只给一句 `Unexpected identifier 'x'`，**不带行号**
 * （lineNumber / columnNumber 都是 undefined）。所以只在**已经解析失败**之后，
 * 把源码落成一个临时 `.mjs` 再 `node --check` 一次 —— 这时 `.mjs` 扩展名让
 * Node 走真 ESM 解析器，才会打印 `文件:行号` + 原文 + 波浪线。
 *
 * 快路径（全部文件纯解析）不受影响，慢路径只在失败文件上走。
 */
function locateLine(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "esm-locate-"));
  const file = path.join(dir, "probe.mjs");
  try {
    fs.writeFileSync(file, source);
    const r = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    const out = `${r.stdout || ""}${r.stderr || ""}`;
    const line = Number(out.match(/probe\.mjs:(\d+)/)?.[1]) || null;
    if (!line) return { line: null, lineText: "" };
    const text = (source.split("\n")[line - 1] ?? "").trim().slice(0, 140);
    return { line, lineText: text };
  } catch {
    return { line: null, lineText: "" };
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ── 解析 ───────────────────────────────────────────────────────────── */
const failures = [];
for (const file of files) {
  let source;
  try {
    source = fs.readFileSync(file, "utf8");
  } catch (error) {
    failures.push({ file, message: `读不到：${error.message}`, line: null });
    continue;
  }
  try {
    // 只构造、不 link、不 evaluate —— 纯语法检查，无任何副作用。
    new vm.SourceTextModule(source, { identifier: file });
  } catch (error) {
    const { line, lineText } = locateLine(source);
    failures.push({ file: path.relative(scanRoot, file), message: error.message, line, lineText });
  }
}

const payload = { scanned: files.length, failed: failures.length, failures };

if (asJson) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
} else {
  for (const f of failures) {
    console.log(`FAIL ${f.file}${f.line ? `:${f.line}` : ""}`);
    console.log(`     ${f.message}`);
    if (f.lineText) console.log(`     ${f.lineText}`);
  }
  console.log(`扫描 ${payload.scanned} 个文件 · 解析失败 ${payload.failed} 个`);
}

process.exit(failures.length ? 1 : 0);
