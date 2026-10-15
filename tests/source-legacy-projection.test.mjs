/**
 * syncLegacy 的源图投影契约（图片预处理移植 · 防回归）。
 *
 * 真机取证抓到过的失效形状：「完成并生成」之后 sourceOriginalUrl 变了。
 * 链路：generation.generate() 出图 → libms:project-result → syncLegacy 把
 * result.sourceUrl（旋转/翻转/裁切**烘烤后**的图）写回 sourceState.dataUrl ——
 * 而那一格同时是 app 侧的原图指针（loadOriginalSourceImage /
 * bridge.getResult().sourceOriginalUrl 都读它）。原图槽位被顶掉后：
 * 再进「图片预处理」看到的就不是原图，取消/重置也回不去，
 * 与面板承诺「原始图片始终保留」正好相反。
 *
 * 修法：投影始终写原图（sourceOriginalUrl 优先），与上传路径
 * （libms:source-loaded 里写的 detail.url = prepared.dataUrl = 原图）一致。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app.js", import.meta.url), "utf8");
const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const projectStore = readFileSync(new URL("../state/project-store.js", import.meta.url), "utf8");

/** 按签名截出函数体（大括号配平）。找不到 / 不闭合直接炸，不留假绿灯。 */
function fnBody(source, signature) {
  const start = source.indexOf(signature);
  assert.ok(start !== -1, `找不到函数：${signature}`);
  const open = source.indexOf("{", start + signature.length - 1);
  assert.ok(open !== -1, `找不到函数体起点：${signature}`);
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error(`函数体不闭合（可能含未配平的字面量）：${signature}`);
}

test("原图指针与投影是同一格：getResult().sourceOriginalUrl 读 state.sourceDataUrl", () => {
  assert.match(app, /sourceOriginalUrl: state\.sourceDataUrl,/, "app 侧原图指针");
  assert.match(projectStore, /image: s\.sourceState\.dataUrl,/, "project-store 读投影：source.image ← sourceState.dataUrl");
});

test("syncLegacy 投影始终写原图，不得被烘烤图顶掉", () => {
  const sync = fnBody(workspace, "const syncLegacy = (result = bridge.getResult()) => {");
  assert.match(sync, /image: result\.sourceOriginalUrl \|\| result\.sourceUrl \|\| null/, "原图优先；只有原图为空才退到 sourceUrl");
  assert.doesNotMatch(sync, /image: result\.sourceUrl \|\| null/, "直接写 sourceUrl = 烘烤图顶掉原图槽位");
});

test("上传路径写进投影的也是原图（与 syncLegacy 同一语义）", () => {
  assert.match(app, /url: prepared\.dataUrl,/, "libms:source-loaded 的 detail.url 是上传原图");
  const loaded = fnBody(workspace, 'window.addEventListener("libms:source-loaded"');
  assert.match(loaded, /image: event\.detail\.url,/, "上传即写原图进投影");
});
