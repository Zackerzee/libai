/*
 * 框选之后浮出的操作条要有「移动」。
 *
 * 用户原话：「框选区域后 跳出来的 换色 复制剪切 里面最好增加移动」。
 *
 * 现状：那条浮动条（#ws-selection-actionbar）里有 换色 / 复制 / 剪切 / 粘贴 /
 * 擦除选区 / 清除选择 —— 最顺手的「把这块挪个位置」反而只能去工具条的
 * 二级菜单里翻。这里补一个直达入口。
 *
 * 两个容易做错的点，都由断言钉住：
 *   1. 浮动条里的按钮是**从右栏「选区动作」那一组搬过去的**（append 同一个节点），
 *      所以新按钮必须同时加进那个搬移名单，否则只会在右栏出现、浮动条里没有；
 *   2. 切到 selection-move 时**不能释放选区** —— 移动的前提就是还留着那块掩码。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const WORKSPACE = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");

test("「移动」按钮落在右栏「选区动作」那一组里", () => {
  // 右栏有好几个 .ws-selection-actions 分组（擦除/清除、复制/剪切/粘贴、反选/全选），
  // 要挑出「复制/剪切/粘贴」那一组 —— 用户说的就是「换色 复制剪切 里面」。
  const groups = [...WORKSPACE.matchAll(/<div class="ws-selection-actions">([\s\S]*?)<\/div>/g)].map((m) => m[1]);
  const group = groups.find((g) => g.includes('id="ws-copy-selection"'));
  assert.ok(group, "找不到含复制/剪切的选区动作分组");
  assert.match(group, /id="ws-selection-move"[^>]*>移动</, "分组里必须有「移动」");
  for (const id of ["ws-copy-selection", "ws-cut-selection", "ws-paste-selection"]) {
    assert.match(group, new RegExp(`id="${id}"`));
  }
});

test("「移动」被搬进浮动操作条（搬移名单里有它）", () => {
  assert.match(
    WORKSPACE,
    /\['ws-selection-move','ws-copy-selection','ws-cut-selection','ws-paste-selection','ws-erase-selection','ws-clear-selection'\]\.forEach\(id=>selectionActionBar\.append\(\$\('#'\+id\)\)\)/,
    "漏加进搬移名单 → 按钮只在右栏、浮动条里看不见",
  );
});

test("点「移动」切到 selection-move 工具", () => {
  assert.match(
    WORKSPACE,
    /\$\('#ws-selection-move'\)\.addEventListener\('click',\(\)=>gridToolbar\.setTool\('selection-move'\)\)/,
  );
  // 目标工具本身要是合法工具 id，否则 setTool 会静默不切
  assert.match(WORKSPACE, /toolNames\['selection-move'\]='移动选区';/);
  assert.match(WORKSPACE, /new Option\('移动选区','selection-move'\)/);
});

test("切到移动工具时选区必须留着（否则没有东西可移）", () => {
  const at = WORKSPACE.indexOf("const releaseSelection =");
  assert.ok(at > 0, "找不到 releaseSelection 判定");
  const line = WORKSPACE.slice(at, WORKSPACE.indexOf("\n", at));
  assert.doesNotMatch(line, /selection-move/, "selection-move 进了释放名单就永远移不动");
});
