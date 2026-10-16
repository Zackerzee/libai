/**
 * 文字素材图层：纯逻辑单测（Node 环境，无浏览器）。
 *
 * 栅格化本身要靠 canvas，Node 里没有。所以这里注入一块**假画布**：
 * 它只记录调用序列、并按测试给定的「哪些像素有墨」返回 alpha 数据。
 * 这样能精确验证真正容易写错的部分——
 *   · 文字中心是不是 translate 到 (x, y)；
 *   · 旋转是不是绕中心、有没有在 translate 之前转；
 *   · 多行的行距与居中偏移算对没有；
 *   · alpha 阈值是不是 128（抗锯齿边缘不能算「有墨」）；
 *   · 返回的豆格顺序是不是行优先。
 * 真实的像素渲染结果交给浏览器端到端脚本验收。
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  TEXT_FONTS, TEXT_SCALE_RANGE, TEXT_ROTATION_RANGE,
  fontFor, createTextLayer, baseFontSize, fontCss,
  rasterizeText, rasterizeTextCached, cellsBox, layerContainsCell, layerLabel,
} from "../services/text-layer-service.js";
import { createEditorService } from "../services/editor-service.js";

// ---------------------------------------------------------------------------
// 假画布
// ---------------------------------------------------------------------------
/** 当前测试的「墨迹」函数：(x, y) => alpha。默认全透明。 */
let INK = () => 0;

function fakeCanvas() {
  const calls = [];
  const ctx = {
    calls,
    setTransform: (...a) => calls.push(["setTransform", ...a]),
    clearRect: (...a) => calls.push(["clearRect", ...a]),
    save: () => calls.push(["save"]),
    restore: () => calls.push(["restore"]),
    translate: (...a) => calls.push(["translate", ...a]),
    rotate: (...a) => calls.push(["rotate", ...a]),
    fillText: (...a) => calls.push(["fillText", ...a]),
    // 每字符宽 6px：让「最宽一行」有确定的期望值，与字号无关。
    measureText: (text) => ({ width: String(text).length * 6 }),
    getImageData: (_x, _y, w, h) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) data[(y * w + x) * 4 + 3] = INK(x, y);
      }
      return { data, width: w, height: h };
    },
  };
  // font / fillStyle / textAlign / textBaseline 是属性赋值而不是方法调用，
  // 用 setter 记下来，才能断言「字号算对了」。
  for (const key of ["font", "fillStyle", "textAlign", "textBaseline"]) {
    Object.defineProperty(ctx, key, { set: (value) => calls.push([key, value]), get: () => "" });
  }
  return { width: 0, height: 0, getContext: () => ctx, calls };
}

const callsOf = (canvas, name) => canvas.calls.filter(([call]) => call === name);
const layer = (overrides = {}) => createTextLayer({ x: 0, y: 0, text: "AB", ...overrides });

// ---------------------------------------------------------------------------
// 字体表与字号
// ---------------------------------------------------------------------------
test("font table is self-contained: no web font, only system stacks plus the vendored pixel font", () => {
  assert.equal(TEXT_FONTS.length, 7);
  assert.equal(new Set(TEXT_FONTS.map((font) => font.id)).size, TEXT_FONTS.length);
  // 除了站点已随仓库分发的复古像素字体，其余一律走系统字体栈。
  // 引入任何 http(s) 字体都会给这个「不依赖境外 CDN」的站点再加一条静默失效路径。
  for (const font of TEXT_FONTS) {
    assert.equal(typeof font.stack, "string");
    assert.ok(font.stack.length > 0);
    assert.ok(!/https?:|@import|url\(/i.test(font.stack), `${font.id} 不应引用外部字体`);
  }
  assert.match(fontFor("pixel").stack, /Fusion Pixel/);
  // 未知 id 回退到第一项（系统默认），而不是抛错或返回 undefined。
  assert.equal(fontFor("nope").id, TEXT_FONTS[0].id);
  assert.equal(fontFor(undefined).id, TEXT_FONTS[0].id);
});

test("fontCss: italic prefix, bold never below 700, and a font's own base weight wins when heavier", () => {
  assert.equal(fontCss({ font: "system" }, 18), `400 18px ${fontFor("system").stack}`);
  assert.equal(fontCss({ font: "system", italic: true }, 18), `italic 400 18px ${fontFor("system").stack}`);
  assert.equal(fontCss({ font: "system", bold: true }, 18), `700 18px ${fontFor("system").stack}`);
  // 「硬朗粗体」自带 800：加粗不应该把它**变细**成 700。
  assert.equal(fontCss({ font: "bold", bold: true }, 18), `800 18px ${fontFor("bold").stack}`);
  assert.equal(fontCss({ font: "bold" }, 18), `800 18px ${fontFor("bold").stack}`);
});

test("baseFontSize follows the short side so the same text looks the same on any grid", () => {
  assert.equal(baseFontSize(52, 52), 9);      // round(52 * 0.18) = 9
  assert.equal(baseFontSize(104, 104), 19);   // round(18.72)
  assert.equal(baseFontSize(180, 180), 32);   // round(32.4)
  // 非方形取短边：宽 500 高 52 时字号跟 52 走，不会撑出画布。
  assert.equal(baseFontSize(500, 52), 9);
  assert.equal(baseFontSize(0, 0), 8);        // 无图纸时的兜底
  assert.equal(baseFontSize(10, 10), 4);      // 下限 4，避免小图纸上算出 1px 字
});

test("createTextLayer defaults match the reference sheet and overrides win", () => {
  const one = createTextLayer(), two = createTextLayer();
  assert.notEqual(one.id, two.id);
  assert.equal(one.text, "新文字素材");
  assert.equal(one.font, "system");
  assert.equal(one.color, "");
  assert.equal(one.bold, false);
  assert.equal(one.italic, false);
  assert.equal(one.scale, 100);
  assert.equal(one.rotation, 0);
  const custom = createTextLayer({ text: "生日快乐", x: 12.5, scale: 150 });
  assert.equal(custom.text, "生日快乐");
  assert.equal(custom.x, 12.5);
  assert.equal(custom.scale, 150);
});

test("scale and rotation ranges are sane and match the panel sliders", () => {
  assert.deepEqual(TEXT_SCALE_RANGE, { min: 10, max: 500, step: 5, inputMax: 2000 });
  assert.deepEqual(TEXT_ROTATION_RANGE, { min: -180, max: 180, step: 1 });
  assert.equal(TEXT_SCALE_RANGE.min % TEXT_SCALE_RANGE.step, 0);
});

test("custom font family is incorporated into the rasterizer font stack", () => {
  assert.match(fontCss({ font: "system", fontFamily: "My Studio Font" }, 18), /"My Studio Font",/);
  assert.match(fontCss({ font: "pixel", fontFamily: "" }, 18), /Fusion Pixel/);
});

// ---------------------------------------------------------------------------
// 栅格化
// ---------------------------------------------------------------------------
test("empty or whitespace-only text short-circuits without touching the canvas", () => {
  for (const text of ["", "   ", "\n", undefined, null]) {
    const canvas = fakeCanvas();
    const result = rasterizeText({ text, x: 0, y: 0 }, 40, 40, { canvas });
    assert.deepEqual(result, { cells: [], width: 0, height: 0 });
    assert.equal(canvas.calls.length, 0, `text=${JSON.stringify(text)} 不该碰画布`);
  }
});

test("rasterize clears first, then translates to the layer centre, then draws", () => {
  INK = () => 0;
  const canvas = fakeCanvas();
  const target = layer({ x: 12.5, y: 30 });
  rasterizeText(target, 100, 100, { canvas });
  // 顺序错一点就会把上一帧的字叠上去（scratch canvas 是复用的）。
  const order = canvas.calls.map(([call]) => call);
  assert.equal(order[0], "setTransform");
  assert.equal(order[1], "clearRect");
  assert.equal(order[2], "save");
  assert.equal(order[3], "translate");
  assert.equal(order.at(-1), "restore");
  assert.deepEqual(callsOf(canvas, "translate")[0].slice(1), [12.5, 30]);
  // fillText(text, x, y)：x 恒为 0（textAlign=center 让文字以中心对齐），单行时 y 也是 0。
  assert.deepEqual(callsOf(canvas, "fillText")[0].slice(1), ["AB", 0, 0]);
  // 100 格图纸 → baseFontSize 18 → 字号 18px，且用的正是当前图层的字体栈。
  assert.equal(callsOf(canvas, "font")[0][1], fontCss(target, 18));
});

test("rotation is applied about the centre and skipped entirely at 0", () => {
  INK = () => 0;
  const plain = fakeCanvas();
  rasterizeText(layer({ rotation: 0 }), 100, 100, { canvas: plain });
  assert.equal(callsOf(plain, "rotate").length, 0, "0° 不该写 rotate");

  const turned = fakeCanvas();
  rasterizeText(layer({ rotation: 90 }), 100, 100, { canvas: turned });
  assert.equal(callsOf(turned, "rotate").length, 1);
  assert.ok(Math.abs(callsOf(turned, "rotate")[0][1] - Math.PI / 2) < 1e-12);
  // rotate 必须在 translate 之后：否则是绕画布原点转，文字会被甩出画布。
  const order = turned.calls.map(([call]) => call);
  assert.ok(order.indexOf("translate") < order.indexOf("rotate"));
});

test("multi-line text is vertically centred with a 1.18 line height", () => {
  INK = () => 0;
  const canvas = fakeCanvas();
  const result = rasterizeText(layer({ text: "AB\nCD" }), 100, 100, { canvas });
  const drawn = callsOf(canvas, "fillText").map((call) => [call[1], call[3]]);
  // size 18 → lineHeight max(18, round(21.24)) = 21 → 两行偏移 ∓10.5
  assert.deepEqual(drawn, [["AB", -10.5], ["CD", 10.5]]);
  assert.equal(result.height, 42);          // 2 行 × 21
  assert.equal(result.width, 12);           // 最宽一行 "AB" = 2 × 6
});

test("cells are the pixels with alpha >= 128, in row-major order", () => {
  // 一块 3×2 的实心墨迹 + 一圈 alpha 127 的抗锯齿边缘：边缘必须被丢掉，
  // 否则文字会被撑出一圈毛边，落豆数虚高。
  INK = (x, y) => (x >= 4 && x <= 6 && y >= 5 && y <= 6 ? 255 : x >= 3 && x <= 7 && y >= 4 && y <= 7 ? 127 : 0);
  const { cells } = rasterizeText(layer(), 20, 20, { canvas: fakeCanvas() });
  assert.deepEqual(cells, [
    { x: 4, y: 5 }, { x: 5, y: 5 }, { x: 6, y: 5 },
    { x: 4, y: 6 }, { x: 5, y: 6 }, { x: 6, y: 6 },
  ]);
  // 行优先：先 y 后 x。画布叠加层与合并都依赖这个顺序。
  for (let i = 1; i < cells.length; i += 1) {
    const previous = cells[i - 1], current = cells[i];
    assert.ok(current.y > previous.y || (current.y === previous.y && current.x > previous.x));
  }
});

test("alpha exactly 128 counts as ink (boundary is inclusive)", () => {
  INK = (x, y) => (x === 1 && y === 1 ? 128 : x === 2 && y === 2 ? 127 : 0);
  const { cells } = rasterizeText(layer(), 8, 8, { canvas: fakeCanvas() });
  assert.deepEqual(cells, [{ x: 1, y: 1 }]);
});

test("scale multiplies the font size and the returned metrics", () => {
  INK = () => 0;
  const canvas = fakeCanvas();
  const doubled = rasterizeText(layer({ scale: 200 }), 100, 100, { canvas });
  // size = round(18 × 2) = 36 → lineHeight max(36, round(42.48)) = 42
  assert.equal(doubled.height, 42);
  assert.equal(callsOf(canvas, "font")[0][1], fontCss(layer({ scale: 200 }), 36));
  assert.equal(rasterizeText(layer(), 100, 100, { canvas: fakeCanvas() }).height, 21);
});

// ---------------------------------------------------------------------------
// 缓存
// ---------------------------------------------------------------------------
test("rasterizeTextCached reuses one result per parameter set and re-computes when any input changes", () => {
  // 这个缓存是「渲染器每帧 + 面板每次读数 + 合并」三处共用的：同一组参数必须返回
  // **同一个对象**，否则三处各算一遍，还可能因为取整不一致而分叉。
  globalThis.document = { createElement: () => fakeCanvas() };
  try {
    INK = (x, y) => (x >= 2 && x <= 3 && y >= 2 && y <= 3 ? 255 : 0);
    const target = layer({ x: 5, y: 5 });
    const first = rasterizeTextCached(target, 20, 20);
    assert.equal(rasterizeTextCached({ ...target }, 20, 20), first, "参数相同应命中同一对象");
    assert.notEqual(rasterizeTextCached({ ...target, x: 6 }, 20, 20), first, "x 变了必须重算");
    assert.notEqual(rasterizeTextCached({ ...target, text: "CD" }, 20, 20), first, "文字变了必须重算");
    assert.notEqual(rasterizeTextCached({ ...target, bold: true }, 20, 20), first, "加粗变了必须重算");
    assert.notEqual(rasterizeTextCached(target, 21, 20), first, "图纸尺寸变了必须重算");
    assert.equal(first.cells.length, 4);
    // 传 null 不该进缓存，也不该抛错。
    assert.deepEqual(rasterizeTextCached(null, 20, 20), { cells: [], width: 0, height: 0 });
  } finally {
    delete globalThis.document;
  }
});

// ---------------------------------------------------------------------------
// 外接框 / 命中 / 摘要
// ---------------------------------------------------------------------------
test("cellsBox returns null for an empty set and an inclusive box otherwise", () => {
  assert.equal(cellsBox([]), null);
  assert.equal(cellsBox(undefined), null);
  assert.deepEqual(cellsBox([{ x: 3, y: 4 }]), { x0: 3, y0: 4, x1: 3, y1: 4, width: 1, height: 1 });
  assert.deepEqual(
    cellsBox([{ x: 3, y: 4 }, { x: 7, y: 9 }, { x: 5, y: 2 }]),
    { x0: 3, y0: 2, x1: 7, y1: 9, width: 5, height: 8 },
  );
});

test("layerContainsCell hits only inked cells (used to pick/drag an existing layer)", () => {
  globalThis.document = { createElement: () => fakeCanvas() };
  try {
    INK = (x, y) => (x === 4 && y === 6 ? 255 : 0);
    const target = layer({ x: 4, y: 6 });
    assert.equal(layerContainsCell(target, 20, 20, 4, 6), true);
    assert.equal(layerContainsCell(target, 20, 20, 5, 6), false);
  } finally {
    delete globalThis.document;
  }
});

test("layerLabel mirrors the reference sheet and truncates long text", () => {
  assert.equal(layerLabel({ text: "新文字素材" }, 0), '图层 1: "新文字素材"');
  assert.equal(layerLabel({ text: "EVERY DAY" }, 2), '图层 3: "EVERY DAY"');
  // 换行与多余空格压成单空格，否则列表会被撑成多行。
  assert.equal(layerLabel({ text: "  每天\n都更好  " }, 0), '图层 1: "每天 都更好"');
  const long = layerLabel({ text: "一二三四五六七八九十十一十二十三" }, 0);
  assert.equal(long, '图层 1: "一二三四五六七八九十十一…"');
  assert.ok(long.endsWith('…"'));
  assert.equal(layerLabel({ text: "   " }, 0), '图层 1: "（空文字）"');
});

// ---------------------------------------------------------------------------
// 合并：一步历史
// ---------------------------------------------------------------------------
test("merging text cells is exactly one undoable history entry", () => {
  // 这是整个功能的契约：文字在浮动期间不写 grid，所以从放到拖撤销栈都是干净的；
  // 「向下合并」把整块文字一次性写成豆格，只产生一步历史。
  const H07 = { code: "H07", hex: "#111111", rgb: [17, 17, 17] };
  const A03 = { code: "A03", hex: "#eeeeee", rgb: [238, 238, 238] };
  const grid = Array.from({ length: 20 }, () => Array.from({ length: 20 }, () => ({ ...H07 })));
  const bridge = {
    getResult() { return { grid, width: 20, height: 20, colors: [] }; },
    getCell(x, y) { return grid[y]?.[x] || null; },
    getPaletteColors() { return [H07, A03]; },
    applyCellChanges(changes) { let n = 0; for (const { x, y, after } of changes) { if (grid[y][x]?.code !== after?.code) { grid[y][x] = after; n += 1; } } return n; },
  };
  const editor = createEditorService(bridge);

  INK = (x, y) => (x >= 4 && x <= 6 && y >= 5 && y <= 6 ? 255 : 0);
  const { cells } = rasterizeText(layer({ x: 5, y: 5 }), 20, 20, { canvas: fakeCanvas() });
  assert.equal(cells.length, 6);

  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 0 }, "浮动期间不该有任何历史");
  assert.equal(editor.applyCells(cells, "A03", "TEXT_MERGE", "文字合并"), true);
  assert.deepEqual(editor.historyDepth(), { undo: 1, redo: 0 });
  for (const { x, y } of cells) assert.equal(grid[y][x].code, "A03");
  assert.equal(grid[0][0].code, "H07", "没被文字盖到的格子必须原样保留");

  assert.equal(editor.undo(), true);
  for (const { x, y } of cells) assert.equal(grid[y][x].code, "H07");
  assert.equal(editor.redo(), true);
  for (const { x, y } of cells) assert.equal(grid[y][x].code, "A03");
});

test("merging with an unknown colour code writes nothing and adds no history", () => {
  const H07 = { code: "H07", hex: "#111111", rgb: [17, 17, 17] };
  const grid = [[{ ...H07 }]];
  const bridge = {
    getResult() { return { grid, width: 1, height: 1, colors: [] }; },
    getCell(x, y) { return grid[y]?.[x] || null; },
    getPaletteColors() { return [H07]; },
    applyCellChanges() { return 1; },
  };
  const editor = createEditorService(bridge);
  assert.equal(editor.applyCells([{ x: 0, y: 0 }], "NOPE"), false);
  assert.deepEqual(editor.historyDepth(), { undo: 0, redo: 0 });
});
