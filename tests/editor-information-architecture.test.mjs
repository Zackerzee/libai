import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const textPanel = readFileSync(new URL("../ui/text-panel.js", import.meta.url), "utf8");
const textService = readFileSync(new URL("../services/text-layer-service.js", import.meta.url), "utf8");
const renderer = readFileSync(new URL("../ui/canvas-renderer.js", import.meta.url), "utf8");

test("editor separates tool properties, objects, actions, symmetry and reference object", () => {
  for (const label of ["工具属性", "选中对象", "选区动作", "对称绘制", "参考底图"]) assert.match(workspace, new RegExp(label));
});

test("text objects expose a selectable list and per-object delete", () => {
  assert.match(textPanel, /class="ws-text-layers"/);
  assert.match(textPanel, /data-text-layer=/);
  assert.match(textPanel, /data-text-action="delete-object"/);
  for (const field of ["layer.font", "layer.scale", "layer.rotation", "active.textHex", "active.backplateEnabled", "active.shadowEnabled", "active.glowEnabled", "layer.x", "layer.y"]) assert.match(textPanel, new RegExp(field.replace(".", "\\.")));
  assert.match(textPanel, /ws-text-effect-group/);
  assert.match(textPanel, /toggle-lock/);
});

test("text object properties use the existing layer state and palette identity", () => {
  for (const id of ["ws-text-content", "ws-text-font", "ws-text-font-family", "ws-text-rotation", "ws-text-scale", "ws-text-scale-number", "ws-text-spacing", "ws-text-x", "ws-text-y"]) assert.match(textPanel, new RegExp(id));
  assert.match(textService, /paletteId: ""/);
  assert.match(textService, /spacing: 0/);
  assert.match(textPanel, /paletteIdOf\(color\)/);
});

test("text deletion is one unified undoable editor command", () => {
  assert.match(workspace, /commitTextObjects\("TEXT_DELETE"/);
  assert.match(workspace, /editorService\.executeCommand\(createEditorCommand\(\{kind:"object",type,label/);
  assert.match(workspace, /undo:\(\)=>apply\(previous,beforeActive\)/);
  assert.match(workspace, /redo:\(\)=>apply\(next,afterActive\)/);
});

test("reference object has add replace visibility delete and adjustment controls", () => {
  for (const id of ["ws-ref-pick", "ws-ref-clear", "ws-ref-visible", "ws-ref-adjust"]) assert.match(workspace, new RegExp(`id="${id}"`));
  assert.match(workspace, /添加 \/ 替换/);
  assert.match(workspace, /reader\.onload = \(\) => store\.setState\(\{ reference: \{ url: String\(reader\.result \|\| ""\),useSource:false,visible:true,/);
  // 删除参考图时顺手把 displayMode 复位成 normal —— 否则在「只看参考图」状态下删掉参考图，
  // 画布会卡在 reference-only 的空画面上（参考图没了，作品又被 return 挡住）。
  assert.match(workspace, /reference: \{ url:"",useSource:false,visible:false,adjusting:false,displayMode:"normal" \}/);
});

test("symmetry has one UI state source, distinct labels and overlay-only axes", () => {
  assert.equal((workspace.match(/id="ws-symmetry-mode"/g) || []).length, 1);
  for (const label of ["关闭", "左右对称", "上下对称", "双向对称"]) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /对称绘制只影响新的画笔与橡皮笔画；镜像仅在导出中设置，不改变当前图纸/);
  assert.match(renderer, /symmetryGuideVisible/);
  assert.match(renderer, /symmetryAxisX/);
  assert.match(renderer, /symmetryAxisY/);
});
