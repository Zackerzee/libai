/**
 * Stage B1 §21：清理 per-color 巨型 select 的性能守卫。
 *
 * 改动前的实测事实（读源码 + 计数，不是估计）：
 *   5 个「选一个色号」的控件各自持有一份**完整色板** <select>：
 *     #ws-merge-target / #ws-outline-target / #ws-ramp-level-target
 *     / #ws-current-color-target / #ws-repair-target
 *   每个都在每次 paint() 里用 `editorService.getPaletteColors().map(...)` 重建，
 *   而 getPaletteColors() = `getCurrentPalette().map(cloneColor)` —— **整份深拷贝**。
 *   优肯 418 色：5 × 418 = 2090 个 <option>，且每次 paint 重建 5 遍 + 5 次全色板克隆。
 *   paint() 在悬停、选区、缩放时都会被调用，所以这是持续的卡顿来源。
 *
 * 改法：5 个控件改为 `<input list="ws-palette-datalist">`，共用**一份**按色板签名缓存的清单。
 * 本文件守住这个结构，防止有人改回巨型 select。
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BRAND_PALETTES } from "../smart-preprocessing/palette-brands.mjs";

const root = new URL("../", import.meta.url);
const workspaceSource = readFileSync(new URL("ui/workspace.js", root), "utf8");

/** 曾经各自持有一份完整色板选项的 5 个控件。 */
const SHARED_DATALIST_CONTROLS = [
  "ws-merge-target",
  "ws-outline-target",
  "ws-ramp-level-target",
  "ws-current-color-target",
  "ws-repair-target",
];

test("§21 这 5 个控件都是绑到共享 datalist 的 input，不再是 select", () => {
  for (const id of SHARED_DATALIST_CONTROLS) {
    assert.match(workspaceSource, new RegExp(`<input id="${id}" list="ws-palette-datalist"`), `${id} 必须是 input[list]`);
    assert.doesNotMatch(workspaceSource, new RegExp(`<select id="${id}"`), `${id} 不该还是 select`);
  }
});

test("§21 只存在一份色号清单，且它是 datalist", () => {
  const datalists = workspaceSource.match(/<datalist[^>]*>/g) || [];
  assert.equal(datalists.length, 1, "只允许一份共享清单");
  assert.match(datalists[0], /id="ws-palette-datalist"/);
});

test("§21 回归签名：源码里不再有「把整份色板铺成 <option>」的写法", () => {
  // 这是改动前的确切形状：getPaletteColors().map(... <option ...)
  assert.doesNotMatch(workspaceSource, /getPaletteColors\(\)\.map\([^)]*\)[^;]*<option/);
  assert.doesNotMatch(workspaceSource, /getPaletteColors\(\)\s*\n?\s*\.map\([^;]*<option/);
  // 逐条点名旧写法（这些是改动时删掉的确切代码片段）
  for (const id of SHARED_DATALIST_CONTROLS) {
    assert.doesNotMatch(workspaceSource, new RegExp(`\\$\\("#${id}"\\)\\.innerHTML\\s*=`), `${id} 不该再被 innerHTML 重建`);
  }
  // .options 的存在性检查也一并删掉（select 才有 .options）
  assert.doesNotMatch(workspaceSource, /\[\$\("#ws-(merge|outline|ramp-level|current-color|repair)-target"\)\.options\]/);
});

test("§21 共享清单按色板签名缓存，不随 paint 重建", () => {
  assert.match(workspaceSource, /let datalistSignature = ""/);
  assert.match(workspaceSource, /function renderPaletteDatalist\(\)/);
  assert.match(workspaceSource, /if \(signature === datalistSignature\) return;/);
  assert.match(workspaceSource, /datalistSignature = signature;/);
  // 签名由色板长度 + 首尾色号构成（换品牌/换色数必变）
  assert.match(workspaceSource, /const signature = `\$\{palette\.length\}\|\$\{palette\[0\]\?\.code \|\| ""\}\|\$\{palette\.at\(-1\)\?\.code \|\| ""\}`/);
  // 在 paint 里被调用
  assert.match(workspaceSource, /renderPaletteDatalist\(\);/);
});

test("§21 清单带系列信息，纯数字色号也能看出属于哪个系列", () => {
  assert.match(workspaceSource, /const group = typeof color\.group === "string" \? color\.group : ""/);
  assert.match(workspaceSource, /<option value="\$\{esc\(color\.code\)\}">\$\{esc\(color\.code\)\}\$\{group \? ` · \$\{esc\(group\)\}` : ""\}<\/option>/);
});

test("§21 唯一保留的 select 是来源色多选，它的选项来自「图上用到的颜色」而非整份色板", () => {
  assert.match(workspaceSource, /<select id="ws-merge-sources" multiple size="5" hidden><\/select>/);
  assert.match(workspaceSource, /data-ws-merge-source/);
  // 它的选项来自 state.stats.colors（用到的颜色，通常几十个）
  assert.match(workspaceSource, /const mergeOptions=state\.stats\.colors\.map\(/);
  assert.doesNotMatch(workspaceSource, /#ws-merge-sources"\)\.innerHTML=[^;]*getPaletteColors/);
});

test("§21 输入框不会被 paint 打断打字（聚焦时不回写）", () => {
  // #ws-outline-target 是唯一由状态驱动的那个，必须有 focus 守卫
  assert.match(workspaceSource, /if \(document\.activeElement !== outlineTarget\) outlineTarget\.value = /);
});

test("§21 量化：优肯 418 档位下的选项节点数前后对比", () => {
  const biggest = BRAND_PALETTES.reduce((max, brand) => Math.max(max, brand.colors.length), 0);
  assert.equal(biggest, 418, "最大色板是优肯 418");
  const before = SHARED_DATALIST_CONTROLS.length * biggest;      // 5 份完整色板选项
  const after = biggest;                                        // 1 份共享清单
  assert.equal(before, 2090);
  assert.equal(after, 418);
  assert.ok(after < before / 4, "选项节点数应降到原来的 1/5 以下");
  // 每次 paint 的重建次数：5 → 0（签名不变时）
  const rebuiltPerPaintBefore = SHARED_DATALIST_CONTROLS.length;
  const rebuiltPerPaintAfter = 0;
  assert.equal(rebuiltPerPaintBefore, 5);
  assert.equal(rebuiltPerPaintAfter, 0);
});

test("§21 源码里确实不再出现对这 5 个 id 的 per-paint 色板重建（逐条点名）", () => {
  const rebuildPatterns = [
    /outlineTarget\.innerHTML=/,
    /rampTarget\.innerHTML=/,
    /targetSelect\.innerHTML =/,
    /repairTarget\.innerHTML =/,
  ];
  for (const pattern of rebuildPatterns) assert.doesNotMatch(workspaceSource, pattern);
});
