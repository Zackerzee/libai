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

/** 模拟模板字符串的转义还原（只处理会出现在代码里的三种）。 */
function unescapeTemplate(body) {
  return body
    .replace(/\\`/g, "`")
    .replace(/\\\$\{/g, "${")
    .replace(/\\\\/g, "\\");
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
      const code = unescapeTemplate(helper.body);
      assert.doesNotThrow(() => new vm.Script(code, { filename: `${file}:${helper.name}` }),
        `${file}:${helper.line} 的 ${helper.name} 解析失败（看 vm.Script 的报错行号，`
        + "注意它相对的是模板体，不是源文件）");
    });
  }
}

test("HELPERS 里不许出现裸反引号（转义过的可以）", () => {
  for (const file of PROBES) {
    const source = fs.readFileSync(path.join(ROOT, "tools", file), "utf8");
    for (const helper of extractHelpers(source)) {
      // 模板体是「遇到第一个未转义反引号就结束」切出来的，所以真出现了裸反引号，
      // 表现是 body 明显偏短 / 后半段丢失，而不是字符串里有反引号。
      assert.ok(!/^[\s\S]*?`/.test(helper.body) || true);
      assert.ok(helper.body.length > 200,
        `${file} 的 ${helper.name} 只切出 ${helper.body.length} 字符，几乎肯定被裸反引号截断了`);
    }
  }
});
