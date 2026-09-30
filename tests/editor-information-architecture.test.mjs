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
  for (const field of ["layer.font", "layer.scale", "横排", "竖排", "layer.spacing", "layer.color", "layer.x", "layer.y"]) assert.match(textPanel, new RegExp(field.replace(".", "\\.")));
});

test("text object properties use the existing layer state and palette identity", () => {
  for (const id of ["ws-text-content", "ws-text-font", "ws-text-direction", "ws-text-scale", "ws-text-spacing", "ws-text-x", "ws-text-y"]) assert.match(textPanel, new RegExp(id));
  assert.match(textService, /paletteId: ""/);
  assert.match(textService, /spacing: 0/);
  assert.match(textPanel, /paletteIdOf\(color\)/);
});

test("text deletion is one unified undoable editor command", () => {
  assert.match(workspace, /createEditorCommand\(\{kind:"object",type:"TEXT_DELETE"/);
  assert.match(workspace, /undo:\(\)=>\{setTextLayers\(before,beforeActive\)/);
  assert.match(workspace, /redo:\(\)=>\{setTextLayers\(rest,afterActive\)/);
});

test("reference object has add replace visibility delete and adjustment controls", () => {
  for (const id of ["ws-ref-pick", "ws-ref-clear", "ws-ref-visible", "ws-ref-adjust"]) assert.match(workspace, new RegExp(`id="${id}"`));
  assert.match(workspace, /添加 \/ 替换/);
  assert.match(workspace, /store\.setState\(\{ reference: \{ url:"",useSource:false,visible:true,adjusting:false \} \}\)/);
});

test("symmetry has one UI state source, distinct labels and overlay-only axes", () => {
  assert.equal((workspace.match(/id="ws-symmetry-mode"/g) || []).length, 1);
  for (const label of ["关闭", "左右对称", "上下对称", "双向对称"]) assert.match(workspace, new RegExp(label));
  assert.match(workspace, /对称绘制只影响新的画笔与橡皮笔画；镜像是对已有内容执行即时变换/);
  assert.match(renderer, /symmetryGuideVisible/);
  assert.match(renderer, /symmetryAxisX/);
  assert.match(renderer, /symmetryAxisY/);
});
