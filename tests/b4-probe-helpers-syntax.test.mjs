/**
 * 真机探针的 HELPERS 模板字符串必须能解析成合法 JS。
 *
 * ── 为什么值得单独一个测试文件 ────────────────────────────────────────
 * 这些探针把一大坨页内助手代码写在**模板字符串**里：
 *
 *     const HELPERS = `(() => { ... })()`;
 *
 * 后果是注释和字符串里**不能出现反引号**，一出现就提前结束模板字符串。
 * 而报错长这样：
 *
 *     SyntaxError: Unexpected identifier 'waitNewResult'
 *
 * 指向的是**注释里的一个词**，和真正的问题（少了一个闭合反引号）
 * 隔着几百行。2026-10-04 一晚上被这个形状咬了两次，两次都先怀疑生产代码。
 *
 * 更糟的是：这个错误**只在运行探针时**才炸，而探针跑一轮要几分钟 ——
 * 于是「改完注释 → 等两分钟 → 得到一个指错地方的语法错」。
 * `node --check` 本来能立刻发现，但它在 `&&` 链里失败时链就断了，
 * 日志看起来像「什么都没跑」。
 *
 * 所以这里把它变成一条 0.1 秒的单测：解析每个探针的 HELPERS，语法错立刻红。
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

/** 找出所有 `const HELPERS = \`...\`;`（含 `const XXX_HELPERS`）。 */
function extractHelpers(source) {
  const out = [];
  const re = /const\s+([A-Z_]*HELPERS)\s*=\s*`/g;
  let m;
  while ((m = re.exec(source))) {
    const start = m.index + m[0].length;
    let i = start;
    let body = "";
    while (i < source.length) {
      const ch = source[i];
      if (ch === "\\") { body += source[i] + source[i + 1]; i += 2; continue; }
      if (ch === "`") break;
      body += ch;
      i += 1;
    }
    out.push({ name: m[1], body, terminated: source[i] === "`", line: source.slice(0, m.index).split("\n").length });
  }
  return out;
}

/**
 * 模拟模板字符串的转义还原。
 *
 * ⚠️ 2026-10-04 补：这里**必须逐字符按模板字面量的真实语义**还原，不能只挑
 * 三种转义做字符串 replace。踩过的坑：HELPERS 里写
 *
 *     stack: String(err.stack).split("\n")
 *
 * 源文件合法、`node --check` 合法、旧的 unescapeTemplate（只处理 \` 与 \${ 与 \\）
 * 也判它合法 —— 但**真模板**会把 `\n` 变成真换行，页内那行就成了
 * `split(" <换行> ")`，探针一跑就 `SyntaxError: Invalid or unexpected token`，
 * 而报错指向 `freshPage`，和真正的那一行隔着几百行。
 *
 * 所以：单趟从左到右扫描，把模板字面量认识的转义全部还原。
 * 顺序很关键 —— `\\n` 必须是「反斜杠 + n」两个字符，而不是换行。
 */
function applyTemplateEscapes(body) {
  let out = "";
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (ch !== "\\") { out += ch; continue; }
    const next = body[i + 1];
    i += 1;
    switch (next) {
      case "n": out += "\n"; break;
      case "r": out += "\r"; break;
      case "t": out += "\t"; break;
      case "b": out += "\b"; break;
      case "f": out += "\f"; break;
      case "v": out += "\v"; break;
      case "0": out += "\0"; break;
      case "`": out += "`"; break;
      // `\${` 只为了躲开模板插值；还原后 `{` 是下一个普通字符。
      case "$": out += "$"; break;
      case "\\": out += "\\"; break;
      case "u": {
        const hex = body.slice(i + 1, i + 5);
        if (/^[0-9a-fA-F]{4}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 4; }
        else out += "\\u";
        break;
      }
      case "x": {
        const hex = body.slice(i + 1, i + 3);
        if (/^[0-9a-fA-F]{2}$/.test(hex)) { out += String.fromCharCode(parseInt(hex, 16)); i += 2; }
        else out += "\\x";
        break;
      }
      default: out += next; break;
    }
  }
  return out;
}

const PROBES = fs.readdirSync(path.join(ROOT, "tools"))
  .filter((f) => f.endsWith("-probe.mjs"))
  .sort();

test("tools/ 下有探针文件可查（守卫自身不空转）", () => {
  assert.ok(PROBES.length >= 3, `只找到 ${PROBES.length} 个探针，路径大概不对`);
});

for (const file of PROBES) {
  const source = fs.readFileSync(path.join(ROOT, "tools", file), "utf8");
  const helpers = extractHelpers(source);
  if (!helpers.length) continue;

  for (const helper of helpers) {
    test(`${file} 的 ${helper.name} 模板字符串闭合且语法合法`, () => {
      assert.ok(helper.terminated,
        `${file}:${helper.line} 的 ${helper.name} 没有闭合反引号 —— `
        + "多半是注释里写了反引号，会提前结束模板字符串");
      const code = applyTemplateEscapes(helper.body);
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${file}:${helper.name}` }),
        `${file}:${helper.line} 的 ${helper.name} 解析失败（看 vm.Script 的报错行号，`
        + "注意它相对的是模板体，不是源文件）");
    });
  }
}

test("守卫真的能抓到「模板里的 \\n 变成真换行」这类破坏（自身不空转）", () => {
  // 造一段**源文件合法、但页内非法**的 HELPERS：模板里写 split("\n")，
  // 真实模板语义会把它变成 split(" <换行> ")。旧版守卫（只 replace 三种转义）
  // 判它合法 —— 这条测试就是为了让那个缺口永远红着。
  const broken = [
    "const HELPERS = `(() => {",
    '  const parts = "a\\nb".split("\\n");',
    "  return parts.length;",
    "})()`;",
  ].join("\n");
  const [helper] = extractHelpers(broken);
  assert.ok(helper, "没能从伪造样本里切出 HELPERS，extractHelpers 大概变了");
  assert.ok(helper.terminated, "伪造样本没闭合，测试自身写错了");
  const code = applyTemplateEscapes(helper.body);
  assert.throws(() => new vm.Script(code), /Invalid or unexpected token|Unterminated string/,
    "守卫没认出「模板里的 \\n 会变成真换行」—— 它又退化成只挑几种转义了");
});

test("HELPERS 里不许出现裸反引号（转义过的可以）", () => {
  for (const file of PROBES) {
    const source = fs.readFileSync(path.join(ROOT, "tools", file), "utf8");
    for (const helper of extractHelpers(source)) {
      // 模板体是「遇到第一个未转义反引号就结束」切出来的。所以裸反引号的表现
      // 不是「body 里有反引号」，而是 body **被截断**。
      //
      // ⚠️ 2026-10-04 补：原先只断言 body.length > 200，抓不住截断 ——
      // stage-b-master-probe.mjs 在注释里写了两个反引号，body 被腰斩到 3421 字符
      // （正常是两万多），照样过线。真正可靠的结构判据是：HELPERS 一定是一个
      // 完整 IIFE，末尾必然是 `})()`。截断了就不可能是这个形状。
      assert.ok(helper.body.length > 200,
        `${file} 的 ${helper.name} 只切出 ${helper.body.length} 字符，几乎肯定被裸反引号截断了`);
      assert.match(helper.body.trimEnd(), /\}\)\(\)\s*;?$/,
        `${file} 的 ${helper.name} 结尾不是 IIFE 的 \`})()\` —— body 被裸反引号腰斩了`
        + `（切出 ${helper.body.length} 字符）。去注释和字符串里找没转义的反引号。`);
    }
  }
});
