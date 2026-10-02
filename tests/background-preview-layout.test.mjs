/**
 * B2 §6 预检条的**布局契约**。
 *
 * 为什么值得单测：预检条是往 `.ws-canvas-area` 里加的**第 4 个 child**，
 * 而那个 grid 原本只声明了 3 行（`minmax(0,1fr) auto 26px`）。
 * 多出来的 child 会掉进**隐式行**，并且会把固定值那一行抢走 ——
 * 实测结果：预检条可见时提示行从 26px 被压到 **17px**，
 * 11px 的文字按默认行高 1.4（15.4px）直接溢出到工具坞下面，
 * 看起来像「两行字叠在一起」。
 *
 * 这类问题静态测试抓不到「重叠」，但能抓住**导致重叠的那条规则**：
 *   1. 行轨数量必须 ≥ 子元素数量（否则一定有人掉进隐式行）；
 *   2. 尾部的行必须是 `auto`（固定值会被隐式行抢走）；
 *   3. 提示行必须自己声明最小高度（不能依赖 grid 行轨保高度）。
 * 真实几何由 `tools/b2-layout-measure.mjs` 在浏览器里量，两处互补。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const CSS = readFileSync(new URL("../styles/workspace.css", import.meta.url), "utf8");
const UI = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");

/** 取某个选择器的规则体（取最后一次声明，CSS 后者覆盖前者）。 */
function ruleBody(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...css.matchAll(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length, `找不到选择器 ${selector} 的规则`);
  return matches.map((m) => m[1]).join(";");
}

/** 按空白切分行轨，但不能在 minmax(...) / fit-content(...) 的括号里切。 */
function splitTracks(value) {
  const tracks = [];
  let depth = 0;
  let current = "";
  for (const ch of value.trim()) {
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (/\s/.test(ch) && depth === 0) {
      if (current) tracks.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) tracks.push(current);
  return tracks;
}

test("画布区的行轨数量足够放下预检条（不会有人掉进隐式行）", () => {
  const body = ruleBody(CSS, ".ws-canvas-area");
  const declared = body.match(/grid-template-rows:\s*([^;]+)/);
  assert.ok(declared, ".ws-canvas-area 必须显式声明 grid-template-rows");
  const tracks = splitTracks(declared[1]);
  // 子元素：画布 / 用量汇总 / 预检条 / 操作提示 —— 4 个。
  assert.equal(tracks.length, 4, `行轨应有 4 条，实得 ${tracks.length}：${tracks.join(" | ")}`);
  assert.equal(tracks[0], "minmax(0,1fr)", "第一行必须是可压缩的画布行");
});

test("尾部行轨必须是 auto —— 固定值会被隐式行抢走", () => {
  const body = ruleBody(CSS, ".ws-canvas-area");
  const tracks = splitTracks(body.match(/grid-template-rows:\s*([^;]+)/)[1]);
  for (const [index, track] of tracks.slice(1).entries()) {
    assert.equal(track, "auto",
      `第 ${index + 2} 行是 ${track}：只要有一行是固定值，多出来的 child 就会抢走它、把别人压扁`);
  }
});

test("预检条整行可塌陷：隐藏时布局与「没有这一行」一致", () => {
  const body = ruleBody(CSS, ".ws-bg-preview[hidden]");
  assert.match(body, /display:\s*none/,
    ".ws-bg-preview[hidden] 必须 display:none，否则关闭开关后仍占一行（行轨不会自己塌）");
});

test("提示行自己保住 26px 高度，不依赖 grid 行轨", () => {
  const body = ruleBody(CSS, ".ws-canvas-hint");
  const minHeight = body.match(/min-height:\s*(\d+)px/);
  assert.ok(minHeight, ".ws-canvas-hint 必须声明 min-height");
  assert.ok(Number(minHeight[1]) >= 26,
    `min-height 至少 26px（原本由 grid 行轨提供），实得 ${minHeight[1]}px`);
  assert.match(body, /box-sizing:\s*border-box/,
    "要用 border-box，26px 才等于含 padding 的总高，与改前视觉高度一致");
});

test("预检条是画布区的直接子元素，且排在提示行之前", () => {
  const canvasHtml = UI.match(/canvas\.innerHTML\s*=\s*`([\s\S]*?)`;\n\s*center\.append/);
  assert.ok(canvasHtml, "找不到画布区的 innerHTML 模板");
  const html = canvasHtml[1];
  const stripTagAt = html.indexOf('<div class="ws-bg-preview"');
  const hintAt = html.indexOf('id="ws-canvas-hint"');
  assert.ok(stripTagAt > 0, "预检条必须写在画布区模板里");
  assert.ok(hintAt > 0, "提示行必须写在画布区模板里");
  assert.ok(stripTagAt < hintAt, "预检条必须排在提示行之前，提示行才是最后一行");
  // 两者都必须是 ws-canvas-area 的直接子元素：预检条开始之前不能有未闭合的容器。
  const before = html.slice(0, stripTagAt);
  const opens = (before.match(/<div\b/g) || []).length;
  const closes = (before.match(/<\/div>/g) || []).length;
  assert.equal(opens, closes,
    "预检条前面有未闭合的 <div>，说明它被包进了别的容器，不再是画布区的直接子元素");
});

test("预检条的行高不写死 —— 窄窗口换行时要能长高", () => {
  const body = ruleBody(CSS, ".ws-bg-preview");
  assert.match(body, /flex-wrap:\s*wrap/,
    "窄窗口下文案与按钮会换行，没有 flex-wrap 就会横向溢出");
  assert.doesNotMatch(body, /height:\s*\d+px/,
    "预检条不能写死 height，否则换行后内容会被裁掉");
});
