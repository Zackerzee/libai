/*
 * 画笔尺寸与擦除尺寸**必须互相独立**。
 *
 * 用户报的问题：两者共用同一个「笔宽」控件（#ws-brush-size）+ 同一个字段
 * （editor.brushSize）—— 把画笔调到 5 去画粗线，再切橡皮时橡皮也被带成 5。
 * 擦除通常要更细、更可控，所以这是两件事，不是一件事。
 *
 * 这一轮拆成：
 *   · editor.brushSize  ← #ws-brush-size（data-tools="brush"）
 *   · editor.eraserSize ← #ws-eraser-size（data-tools="eraser"）
 * 两个控件各自只在自己那个工具下露面（同一时刻只会出现一个）。
 *
 * 为什么要有单测：这两条值一旦被合并回去，界面上完全看不出来 ——
 * 两个控件都还在、都能拖，只是拖一个另一个跟着动。只有断言能钉住。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import storeApi from "../state/store.js";

const WORKSPACE = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const RENDERER = readFileSync(new URL("../ui/canvas-renderer.js", import.meta.url), "utf8");

test("store 的 editorState 同时有 brushSize 与 eraserSize，且互不牵连", () => {
  const store = storeApi.createStore();
  assert.equal(store.get("editorState", "brushSize"), 1, "画笔笔宽默认 1");
  assert.equal(store.get("editorState", "eraserSize"), 1, "擦除宽度默认 1");

  store.patchState("editorState", { brushSize: 5 });
  assert.equal(store.get("editorState", "eraserSize"), 1, "改画笔不该动擦除");

  store.patchState("editorState", { eraserSize: 3 });
  assert.equal(store.get("editorState", "brushSize"), 5, "改擦除不该动画笔");
});

test("两个控件各归各的工具：data-tools 不是共用的 brush eraser", () => {
  assert.match(
    WORKSPACE,
    /moveToolControls\("brush",\[\$\("#ws-brush-size"\)\.closest\("label"\)\]\)/,
    "画笔笔宽必须只挂在 brush 下",
  );
  assert.match(
    WORKSPACE,
    /moveToolControls\("eraser",\[\$\("#ws-eraser-size"\)\.closest\("label"\)\]\)/,
    "擦除宽度必须只挂在 eraser 下",
  );
  assert.doesNotMatch(
    WORKSPACE,
    /moveToolControls\("brush eraser",\[\$\("#ws-brush-size"\)/,
    "两者共用同一个控件是这一轮要消灭的形态",
  );
  // 擦除宽度的控件与读数都要真的存在（只写 data-tools 不建节点是空接）
  assert.match(WORKSPACE, /id="ws-eraser-size"/);
  assert.match(WORKSPACE, /id="ws-eraser-size-value"/);
});

test("擦除宽度的输入只写 eraserSize，不顺手改 brushSize", () => {
  const at = WORKSPACE.indexOf('$("#ws-eraser-size").addEventListener("input"');
  assert.ok(at > 0, "找不到擦除宽度的 input 监听");
  const body = WORKSPACE.slice(at, WORKSPACE.indexOf("});", at));
  assert.match(body, /eraserSize: value/, "必须落到 eraserSize");
  assert.doesNotMatch(body, /brushSize/, "擦除控件不许碰画笔的字段");
});

test("落笔与悬停预览都按当前工具取宽度（画的和预览的是同一个数）", () => {
  assert.match(
    WORKSPACE,
    /const strokeSize = tool === "eraser" \? \(Number\(editor\.eraserSize\) \|\| 1\) : editor\.brushSize;/,
    "落笔宽度必须按工具分流",
  );
  assert.match(WORKSPACE, /size:strokeSize/, "beginStroke 必须用分流后的宽度");
  assert.match(
    RENDERER,
    /const hoverSize = editor\.tool === "eraser" \? \(Number\(editor\.eraserSize\) \|\| 1\) : editor\.brushSize;/,
    "画布悬停预览必须按工具分流，否则预览框和实际擦除范围对不上",
  );
});

test("快捷键 [ / ] 改的是当前工具那一个值", () => {
  // 工具条内部的 brushSize 只是 [ / ] 的基准；写回 store 时必须按当前工具分派。
  assert.match(
    WORKSPACE,
    /onBrushSizeChange: \(size\) => store\.setState\(\{ editor: get\(\)\.editor\.tool === "eraser" \? \{ eraserSize: size \} : \{ brushSize: size \} \}\)/,
    "在橡皮下按 ] 不该改到画笔的笔宽",
  );
  // 工具条基准要跟随当前工具，否则按一下 ] 会从另一个工具的值起步。
  assert.match(
    WORKSPACE,
    /const activeSize = state\.editor\.tool === "eraser" \? eraserSize : state\.editor\.brushSize;/,
  );
});

test("两个滑杆各自回显自己的值，且老存档读不到 eraserSize 时回落 1", () => {
  assert.match(WORKSPACE, /const eraserSize = Number\(state\.editor\.eraserSize\) \|\| 1;/);
  assert.match(WORKSPACE, /\$\("#ws-brush-size"\)\.value = String\(state\.editor\.brushSize\);/);
  assert.match(WORKSPACE, /\$\("#ws-eraser-size"\)\.value = String\(eraserSize\);/);
});
