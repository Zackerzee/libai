/**
 * Stage C0 §12/§18 —— 左轨子菜单的**断点隔离**契约。
 *
 * ── 为什么值得单测（这是四档视口 QA 抓出来的真回归）────────────────────
 * C0 §18 把桌面端左轨子菜单从「向右浮出」改成「就地展开」，写成：
 *
 *   body.phase2-workspace .ws-rail .sl-rail-menu .sl-tool-menu {
 *     position: static !important; … }
 *
 * 特异性 **(0,4,1)**。而文件末尾 `@media (max-width: 760px)` 里那条移动端
 * 覆盖是 `.phase2-workspace .sl-rail-menu .sl-tool-menu` = **(0,3,0)**。
 *
 * **两条都带 `!important`，所以谁赢只看特异性，跟源码顺序无关。**
 * 于是桌面的 `static` 压住了移动端的 `fixed` —— 移动端那条成了死代码。
 *
 * 后果（390×844 实测）：子菜单按 static 排进只有 58px 高的贴底横条
 * （`overflow-y: hidden`）里，被裁掉且落到视口外 ——
 * 三个 `.sl-tool-menu` 计算 `position: static`，矩形 y = 897 / 997，
 * 而视口只有 844 高；9 个工具的 `elementFromPoint` 全返回 `null`。
 * 真鼠标点不到，`element.click()` 却照样"能点"。
 *
 * 静态测试量不到几何，但能钉住**导致这件事的结构**：
 *   **同一属性上不许出现两条都能作用于同一宽度的 `!important` 规则。**
 * 所以这里不断言"某条规则长什么样"，而是断言**断点区间不重叠**。
 * 真实几何由 `tools/c0-viewport-qa.mjs`（四档视口）在浏览器里量，两处互补。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS_RAW = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");

/**
 * 把 `/* … *\/` 注释整段换成等长空白（保持所有下标不变）。
 *
 * 必须做这一步：下面那条规则上方的 why-注释里**原样写着**
 * `@media (min-width: 761px)` 和选择器本身，不屏蔽的话切分器会先把注释里的
 * `@media` 当成真媒体查询，把后面整块 CSS 吞进去（实测 3/4 条断言假失败）。
 * 用等长替换而不是删除，是为了让出错时的下标仍能对上原文件。
 */
function maskComments(css) {
  const out = css.split("");
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      const stop = end === -1 ? css.length : end + 2;
      for (let k = i; k < stop; k += 1) out[k] = " ";
      i = stop;
    } else {
      i += 1;
    }
  }
  return out.join("");
}

const CSS = maskComments(CSS_RAW);

/**
 * 把 CSS 切成顶层片段。返回 `{ cond, body }[]`：
 * `cond` 是媒体查询条件（全局作用域为 `null`），`body` 是该片段内部文本。
 * 只用括号配平，不用正则跨块匹配 —— 这个仓库的 CSS 里混着大量内联
 * `@media`/字符串，非贪婪正则会提前收尾（本项目踩过，见 MEMORY.md）。
 */
function topLevelSegments(css) {
  const segments = [];
  let i = 0;
  while (i < css.length) {
    const at = css.indexOf("@media", i);
    if (at === -1) {
      segments.push({ cond: null, body: css.slice(i) });
      break;
    }
    segments.push({ cond: null, body: css.slice(i, at) });
    const open = css.indexOf("{", at);
    const cond = css.slice(at + "@media".length, open).trim();
    let depth = 1;
    let j = open + 1;
    while (j < css.length && depth > 0) {
      if (css[j] === "{") depth += 1;
      else if (css[j] === "}") depth -= 1;
      j += 1;
    }
    segments.push({ cond, body: css.slice(open + 1, j - 1) });
    i = j;
  }
  return segments.filter((s) => s.body.trim());
}

/** 该媒体查询条件是否可能作用于某个宽度。 */
function conditionCovers(cond, width) {
  if (cond === null) return true; // 全局作用域：任何宽度都算
  const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(cond);
  const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(cond);
  if (max && width > Number(max[1])) return false;
  if (min && width < Number(min[1])) return false;
  return true;
}

/**
 * 找出所有「对 `.sl-tool-menu` 强制某个 `position` 且带 `!important`」的规则。
 * 返回 `{ cond, selector, position }[]`。
 */
function importantPositionRules(css) {
  const found = [];
  for (const seg of topLevelSegments(css)) {
    // 逐条 `选择器 { 声明 }` 拆开
    for (const m of seg.body.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
      const selector = m[1].trim().replace(/\s+/g, " ");
      const decls = m[2];
      if (!/\.sl-tool-menu\b/.test(selector)) continue;
      const pos = /position:\s*([a-z-]+)\s*!important/.exec(decls);
      if (!pos) continue;
      found.push({ cond: seg.cond, selector, position: pos[1] });
    }
  }
  return found;
}

test("左轨子菜单：桌面「就地展开」与移动端「浮起」不得同时作用于 ≤760px", () => {
  const rules = importantPositionRules(CSS);
  assert.ok(rules.length >= 2, `期望至少两条 !important 的 position 规则，实际 ${rules.length} 条`);

  // ≤760px 上真正生效的规则必须**只有一条** —— 否则就是靠特异性决胜，
  // 而特异性决胜在这里已经错过一次（桌面 static 压掉移动端 fixed）。
  const atMobile = rules.filter((r) => conditionCovers(r.cond, 390));
  assert.equal(
    atMobile.length, 1,
    `≤760px 上有 ${atMobile.length} 条 !important 的 position 规则同时生效：` +
      atMobile.map((r) => `\n  - position:${r.position}  ← ${r.selector}  (cond: ${r.cond})`).join("") +
      "\n两条都带 !important 时只有特异性说了算，跟源码顺序无关。" +
      "\n请用媒体查询把桌面规则切到 `min-width: 761px`，不要靠调特异性。",
  );
  assert.equal(
    atMobile[0].position, "fixed",
    `≤760px 生效的那条必须是 fixed（子菜单要脱离 58px 横条的裁剪），实际是 ${atMobile[0].position}`,
  );

  // 桌面档（390 之外随便取一个）也必须只有一条，且不是 fixed。
  const atDesktop = rules.filter((r) => conditionCovers(r.cond, 1440));
  assert.equal(atDesktop.length, 1, `桌面档上有 ${atDesktop.length} 条同时生效，应该只有 1 条`);
  assert.equal(atDesktop[0].position, "static", `桌面档生效的应该是 static（就地展开），实际是 ${atDesktop[0].position}`);
});

test("≤760px 的贴底横条仍然存在（否则上面的断言会失去意义）", () => {
  // 注意：这个文件里有**两个** `@media (max-width: 760px)` 块
  // （一个管顶栏堆叠、一个管左轨贴底）。`.find` 只会拿到第一个，
  // 所以这里要把所有同条件的块合起来看。
  const segs = topLevelSegments(CSS).filter((s) => s.cond && /max-width:\s*760px/.test(s.cond));
  assert.ok(segs.length >= 1, "找不到 `@media (max-width: 760px)` 块");
  const body = segs.map((s) => s.body).join("\n");
  assert.match(body, /\.ws-rail\s*\{[^}]*position:\s*fixed/, "左轨在 ≤760px 必须是 fixed 贴底横条");
  assert.match(body, /overflow-y:\s*hidden/, "贴底横条的 overflow-y 必须是 hidden —— 这正是子菜单必须浮起的原因");
});

test("两个断点是互补的：760 / 761，不留缝也不重叠", () => {
  const conds = topLevelSegments(CSS).map((s) => s.cond).filter(Boolean);
  const max760 = conds.filter((c) => /max-width:\s*760px/.test(c));
  const min761 = conds.filter((c) => /min-width:\s*761px/.test(c));
  assert.ok(max760.length >= 1, "缺 `max-width: 760px`");
  assert.ok(min761.length >= 1, "缺 `min-width: 761px`（桌面左轨子菜单的就地展开必须被它包住）");
  // 整数宽度下两者正好互补；检查没有把 760 写成 min-width（会与 max-width 重叠）。
  assert.ok(
    !conds.some((c) => /min-width:\s*760px/.test(c)),
    "`min-width: 760px` 会与 `max-width: 760px` 在 760px 上重叠 —— 用 761",
  );
});

test("回归取证：桌面那条规则确实被 min-width 包住，不是裸写在全局", () => {
  const seg = topLevelSegments(CSS).find((s) => s.body.includes("body.phase2-workspace .ws-rail .sl-rail-menu .sl-tool-menu"));
  assert.ok(seg, "找不到桌面「就地展开」规则");
  assert.ok(
    seg.cond && /min-width:\s*761px/.test(seg.cond),
    `桌面「就地展开」规则必须被 \`@media (min-width: 761px)\` 包住，实际 cond=${seg.cond}。` +
      "\n裸写进全局会让它（0,4,1 + !important）压掉移动端的 fixed 覆盖（0,3,0 + !important）。",
  );
});
