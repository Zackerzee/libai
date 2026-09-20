import { test } from "node:test";
import assert from "node:assert/strict";
import {
  lineCells, rectangleCells, ellipseCells, shapeCells,
  brushOffsets, expandBrush,
  magicWandSelection,
  invertSelection, selectAll, translateSelection, fitSelectionBox,
} from "../../services/shapes-service.js";
import { selectionContains, selectionCells } from "../../services/selection-service.js";

const key = (x, y) => `${x},${y}`;
const setOf = (cells) => new Set(cells.map((c) => key(c.x, c.y)));
const hasNoDup = (cells) => setOf(cells).size === cells.length;

// 构造 grid：fill 为空白或 {code,name,hex,rgb}
function makeGrid(width, height, fill = null) {
  return Array.from({ length: height }, () =>
    Array.from({ length: width }, () => (fill ? { ...fill, rgb: [...fill.rgb] } : null)));
}
const COLOR = (code, rgb) => ({ code, name: code, hex: "#000000", rgb: [...rgb] });

// 8 邻域闭合判定：每个描边格至少有两个 8 邻域内的描边格（即“不断线”）。
function assertClosed(cells) {
  const s = setOf(cells);
  for (const { x, y } of cells) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      if (s.has(key(x + dx, y + dy))) n += 1;
    }
    assert.ok(n >= 2, `闭合性失败：(${x},${y}) 仅有 ${n} 个 8 邻域邻居`);
  }
}

// 关于外接框中心镜像对称：每个格的 (x0+x1-x, y0+y1-y) 也在集合内。
function assertSymmetric(cells) {
  const xs = cells.map((c) => c.x), ys = cells.map((c) => c.y);
  const sx = xs.reduce((a, b) => a + b, 0) / xs.length * 2; // 近似中心，改用边界计算
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const s = setOf(cells);
  for (const { x, y } of cells) {
    assert.ok(s.has(key(x0 + x1 - x, y)), `水平对称失败：(${x},${y})`);
    assert.ok(s.has(key(x, y0 + y1 - y)), `垂直对称失败：(${x},${y})`);
  }
  void sx;
}

// ---------------- 直线 ----------------
test("直线：水平线含两端点且 y 恒定", () => {
  const cells = lineCells(0, 0, 5, 0);
  assert.equal(cells.length, 6);
  assert.ok(cells.every((c) => c.y === 0));
  assert.deepEqual(cells[0], { x: 0, y: 0 });
  assert.deepEqual(cells[5], { x: 5, y: 0 });
});

test("直线：垂直线含两端点且 x 恒定", () => {
  const cells = lineCells(2, 0, 2, 4);
  assert.equal(cells.length, 5);
  assert.ok(cells.every((c) => c.x === 2));
});

test("直线：45° 对角线上 x===y", () => {
  const cells = lineCells(0, 0, 4, 4);
  assert.equal(cells.length, 5);
  assert.ok(cells.every((c) => c.x === c.y));
});

test("直线：陡斜率 (0,0)-(2,6) 与缓斜率 (0,0)-(6,2)", () => {
  const steep = lineCells(0, 0, 2, 6);
  const shallow = lineCells(0, 0, 6, 2);
  assert.equal(steep.length, 7);
  assert.equal(shallow.length, 7);
  // 缓斜率而非水平说明 y 确实有变化
  assert.ok(shallow.some((c) => c.y === 1 || c.y === 2));
});

test("直线：单点（起终点相同）返回 1 格", () => {
  const cells = lineCells(3, 3, 3, 3);
  assert.deepEqual(cells, [{ x: 3, y: 3 }]);
});

test("直线：反方向对称性（集合相等）", () => {
  const a = setOf(lineCells(0, 0, 4, 4));
  const b = setOf(lineCells(4, 4, 0, 0));
  assert.deepEqual(a, b);
});

test("直线：无重复格", () => {
  assert.ok(hasNoDup(lineCells(0, 0, 9, 3)));
  assert.ok(hasNoDup(lineCells(0, 0, 3, 9)));
});

// ---------------- 矩形 ----------------
test("矩形：描边 3×3 = 2w+2h-4 = 8 格", () => {
  assert.equal(rectangleCells(0, 0, 2, 2).length, 8);
});

test("矩形：实心 3×3 = w*h = 9 格", () => {
  assert.equal(rectangleCells(0, 0, 2, 2, { filled: true }).length, 9);
});

test("矩形：退化宽 1（单列）返回整列", () => {
  assert.equal(rectangleCells(0, 0, 0, 4).length, 5);
});

test("矩形：退化 1×1 返回 1 格", () => {
  assert.deepEqual(rectangleCells(1, 1, 1, 1), [{ x: 1, y: 1 }]);
});

test("矩形：实心格数公式 w*h（4×5）", () => {
  assert.equal(rectangleCells(0, 0, 3, 4, { filled: true }).length, 20);
});

test("矩形：描边恰好 1 格宽（内部无描边格）", () => {
  const border = rectangleCells(0, 0, 4, 4);
  const s = setOf(border);
  for (const { x, y } of border) {
    const inner = x > 0 && x < 4 && y > 0 && y < 4;
    assert.ok(!inner, `内部格 (${x},${y}) 不应在描边中`);
  }
  void s;
});

// ---------------- 椭圆 ----------------
test("椭圆：1×1 外接框返回 1 格", () => {
  assert.deepEqual(ellipseCells(0, 0, 0, 0), [{ x: 0, y: 0 }]);
});

test("椭圆：2×2 外接框退化为满框 4 格（对称、闭合、实心包含）", () => {
  const stroke = ellipseCells(0, 0, 1, 1);
  assert.equal(stroke.length, 4);
  assertSymmetric(stroke);
  assertClosed(stroke);
  const filled = ellipseCells(0, 0, 1, 1, { filled: true });
  assert.ok(setOf(filled).size >= setOf(stroke).size);
});

test("椭圆：5×5 奇数正方形 — 对称、闭合、实心包含描边", () => {
  const stroke = ellipseCells(0, 0, 4, 4);
  assertSymmetric(stroke);
  assertClosed(stroke);
  const filled = ellipseCells(0, 0, 4, 4, { filled: true });
  const fs = setOf(filled);
  for (const c of stroke) assert.ok(fs.has(key(c.x, c.y)), `实心未包含描边 (${c.x},${c.y})`);
  // 描边不应等于实心（应有内部）
  assert.ok(fs.size > stroke.length);
});

test("椭圆：9×5 长扁形 — 对称、闭合、实心包含描边", () => {
  const stroke = ellipseCells(0, 0, 8, 4);
  assertSymmetric(stroke);
  assertClosed(stroke);
  const filled = ellipseCells(0, 0, 8, 4, { filled: true });
  const fs = setOf(filled);
  for (const c of stroke) assert.ok(fs.has(key(c.x, c.y)), `实心未包含描边 (${c.x},${c.y})`);
  assert.ok(fs.size > stroke.length);
});

// ---------------- 画笔 ----------------
test("画笔：brushOffsets(1) 仅 [0,0]", () => {
  assert.deepEqual(brushOffsets(1, "round"), [[0, 0]]);
  assert.deepEqual(brushOffsets(1, "square"), [[0, 0]]);
});

test("画笔：brushOffsets(2) 视作 3 → 9 个偏移（round）", () => {
  const o = brushOffsets(2, "round");
  assert.equal(o.length, 9);
});

test("画笔：brushOffsets(3,'round') 必为 9 个且满 3×3（含四角）", () => {
  const o = brushOffsets(3, "round");
  assert.equal(o.length, 9);
  assert.ok(o.some(([dx, dy]) => dx === 1 && dy === 1));
  assert.ok(o.some(([dx, dy]) => dx === -1 && dy === -1));
  assert.ok(o.some(([dx, dy]) => dx === 0 && dy === 0));
});

test("画笔：brushOffsets(5,'round') = 21，square = 25", () => {
  assert.equal(brushOffsets(5, "round").length, 21);
  assert.equal(brushOffsets(5, "square").length, 25);
});

test("画笔：expandBrush 去重且中心不变", () => {
  const expanded = expandBrush([{ x: 5, y: 5 }], 3, "round");
  assert.equal(expanded.length, 9);
  assert.ok(expanded.some((c) => c.x === 5 && c.y === 5));
  assert.ok(hasNoDup(expanded));
});

test("画笔：expandBrush 在已有集合上膨胀不产生重复", () => {
  const base = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }];
  const out = expandBrush(base, 3, "round");
  assert.ok(hasNoDup(out));
  // 原始中心全部保留
  for (const c of base) assert.ok(out.some((p) => p.x === c.x && p.y === c.y));
});

// ---------------- 魔棒 ----------------
test("魔棒：严格同色连通（tolerance=0）只选中同色块", () => {
  const grid = [
    [COLOR("A", [200, 2, 27]), COLOR("A", [200, 2, 27]), COLOR("B", [74, 144, 217])],
    [COLOR("A", [200, 2, 27]), COLOR("B", [74, 144, 217]), COLOR("B", [74, 144, 217])],
    [COLOR("B", [74, 144, 217]), COLOR("B", [74, 144, 217]), COLOR("B", [74, 144, 217])],
  ];
  const sel = magicWandSelection(grid, 0, 0, { tolerance: 0 });
  assert.ok(sel);
  const cells = selectionCells(sel, 3, 3);
  assert.equal(cells.length, 3); // 仅 A 块 3 格
  assert.ok(cells.every((c) => grid[c.y][c.x].code === "A"));
});

test("魔棒：容差放大后吞掉相邻近似色", () => {
  // A 与 A2 仅在红通道差 30，Lab 距离有限；高容差可桥接。
  const A = COLOR("A", [200, 2, 27]);
  const A2 = COLOR("A2", [230, 2, 27]);
  const B = COLOR("B", [74, 144, 217]);
  const grid = [
    [A, A, B],
    [A2, A2, B],
    [B, B, B],
  ];
  const strict = magicWandSelection(grid, 0, 0, { tolerance: 0 });
  assert.equal(selectionCells(strict, 3, 3).length, 2); // 仅左上 A
  const loose = magicWandSelection(grid, 0, 0, { tolerance: 60 });
  const cells = selectionCells(loose, 3, 3);
  assert.equal(cells.length, 4); // A(2) + A2(2)
});

test("魔棒：contiguous=false 全图模式选中所有相似色", () => {
  const A = COLOR("A", [200, 2, 27]);
  const B = COLOR("B", [74, 144, 217]);
  const grid = [
    [A, B, A],
    [B, B, B],
    [A, B, A],
  ];
  const sel = magicWandSelection(grid, 0, 0, { tolerance: 0, contiguous: false });
  assert.equal(selectionCells(sel, 3, 3).length, 4); // 四角 A
});

test("魔棒：within 限制扩散范围", () => {
  const A = COLOR("A", [200, 2, 27]);
  const B = COLOR("B", [74, 144, 217]);
  const grid = [
    [A, A, B],
    [A, A, B],
    [B, B, B],
  ];
  const within = { kind: "rect", x0: 0, y0: 0, x1: 1, y1: 1 };
  const sel = magicWandSelection(grid, 0, 0, { tolerance: 0, contiguous: false, within });
  assert.equal(selectionCells(sel, 3, 3).length, 4); // 仅左上 2×2 内
});

test("魔棒：空白格连通可选中大片空白", () => {
  const A = COLOR("A", [200, 2, 27]);
  const grid = makeGrid(3, 3, null); // 全空白
  grid[0][0] = A; grid[0][1] = A; grid[0][2] = A;
  const sel = magicWandSelection(grid, 1, 1, { tolerance: 0 });
  // 6 个空白连通
  assert.equal(selectionCells(sel, 3, 3).length, 6);
});

test("魔棒：越界起点返回 null", () => {
  const grid = makeGrid(3, 3, COLOR("A", [200, 2, 27]));
  assert.equal(magicWandSelection(grid, -1, 0), null);
  assert.equal(magicWandSelection(grid, 0, 9), null);
  assert.equal(magicWandSelection(grid, 3, 0), null);
});

test("魔棒：diagonal=true 启用 8 邻域扩散", () => {
  const A = COLOR("A", [200, 2, 27]);
  const B = COLOR("B", [74, 144, 217]);
  // 对角相接的两个 A，4 邻域不连通、8 邻域连通
  const grid = [
    [A, B],
    [B, A],
  ];
  const four = magicWandSelection(grid, 0, 0, { tolerance: 0, diagonal: false });
  assert.equal(selectionCells(four, 2, 2).length, 1);
  const eight = magicWandSelection(grid, 0, 0, { tolerance: 0, diagonal: true });
  assert.equal(selectionCells(eight, 2, 2).length, 2);
});

// ---------------- 选区 ----------------
test("选区：invertSelection 与 selectAll 互补（cell 数之和 = w*h）", () => {
  const w = 5, h = 4;
  const all = selectAll(w, h);
  const invAll = invertSelection(all, w, h);
  assert.equal(selectionCells(invAll, w, h).length + selectionCells(all, w, h).length, w * h);
});

test("选区：invertSelection 作用于局部选区仍互补", () => {
  const w = 6, h = 6;
  const partial = { kind: "rect", x0: 1, y0: 1, x1: 3, y1: 3 };
  const inv = invertSelection(partial, w, h);
  assert.equal(
    selectionCells(inv, w, h).length + selectionCells(partial, w, h).length,
    w * h,
  );
});

test("选区：空选区反选 = 全选", () => {
  const w = 4, h = 4;
  const inv = invertSelection(null, w, h);
  assert.equal(selectionCells(inv, w, h).length, w * h);
});

test("选区：translateSelection 平移后裁剪到画布内", () => {
  const w = 5, h = 5;
  const sel = { kind: "rect", x0: 3, y0: 3, x1: 4, y1: 4 };
  const moved = translateSelection(sel, 2, 2, w, h);
  for (const c of selectionCells(moved, w, h)) {
    assert.ok(c.x < w && c.y < h && c.x >= 0 && c.y >= 0);
  }
  // 越界部分被裁掉：原 (4,4)+ (2,2)=(6,6) 已出界
  assert.ok(!selectionCells(moved, w, h).some((c) => c.x >= w || c.y >= h));
});

test("选区：fitSelectionBox 空输入返回 null", () => {
  assert.equal(fitSelectionBox([], "x"), null);
  assert.equal(fitSelectionBox(null, "x"), null);
});

test("选区：shapeCells 分发三种形状", () => {
  assert.deepEqual(shapeCells("line", { x: 0, y: 0 }, { x: 2, y: 0 }), lineCells(0, 0, 2, 0));
  assert.equal(shapeCells("rect", { x: 0, y: 0 }, { x: 2, y: 2 }).length, 8);
  assert.ok(shapeCells("ellipse", { x: 0, y: 0 }, { x: 4, y: 4 }).length > 0);
});

// ---------------- 回归：偶数跨度椭圆不得退化成矩形 ----------------
// 曾经的缺陷：隐函数直接在整数坐标上采样，包围盒跨度为偶数时几何中心落在半整数上，
// 每行跨度不再收缩，10×6 的「椭圆」整块退化成矩形。既有用例（5×5、9×5）恰好中心为整数，
// 因此侥幸全绿。这里专门用「跨度为偶数 → 中心为半整数」的包围盒把该缺陷锁死。
const EVEN_SPAN_BOXES = [[9, 5], [10, 6], [14, 9], [19, 19], [7, 3], [5, 9]];

test("回归：偶数跨度椭圆描边不与矩形描边重合", () => {
  for (const [a, b] of EVEN_SPAN_BOXES) {
    const stroke = setOf(ellipseCells(0, 0, a, b));
    const rect = setOf(rectangleCells(0, 0, a, b));
    assert.notEqual(stroke.size, rect.size, `包围盒 ${a}×${b} 的椭圆描边与矩形描边格数相同`);
    assert.notDeepEqual([...stroke].sort(), [...rect].sort(), `包围盒 ${a}×${b} 的椭圆描边就是矩形描边`);
  }
});

// 退化成矩形时描边每行等宽、实心每行等宽，下面两条断言会立刻抓住。
const rowWidths = (cells) => {
  const rows = new Map();
  for (const { x, y } of cells) rows.set(y, (rows.get(y) || 0) + 1);
  return [...rows.entries()].sort((p, q) => p[0] - q[0]).map(([, w]) => w);
};

test("回归：偶数跨度实心椭圆逐行宽度呈橄榄形单峰", () => {
  // 这是本组最关键的判据：旧写法在跨度为偶数时实心区退化为等宽矩形
  // （10×6 → 8,8,8,8；8×4 → 6,6；6×10 → 4,4,4,4,4,4,4,4），单峰断言会立刻失败。
  for (const [a, b] of EVEN_SPAN_BOXES) {
    const widths = rowWidths(ellipseCells(0, 0, a, b, { filled: true }));
    const widest = Math.max(...widths);
    assert.ok(widths[0] < widest, `包围盒 ${a}×${b} 实心顶行未收窄（疑退化为矩形）：${widths.join(",")}`);
    assert.ok(widths[widths.length - 1] < widest, `包围盒 ${a}×${b} 实心底行未收窄（疑退化为矩形）：${widths.join(",")}`);
    const peak = widths.indexOf(widest);
    for (let i = 1; i <= peak; i += 1) assert.ok(widths[i] >= widths[i - 1], `包围盒 ${a}×${b} 上半段非递增：${widths.join(",")}`);
    for (let i = peak + 1; i < widths.length; i += 1) assert.ok(widths[i] <= widths[i - 1], `包围盒 ${a}×${b} 下半段非递减：${widths.join(",")}`);
  }
});

test("回归：偶数跨度椭圆铺满外接框且无整行空缺", () => {
  for (const [a, b] of EVEN_SPAN_BOXES) {
    const stroke = ellipseCells(0, 0, a, b);
    const xs = stroke.map((c) => c.x);
    const ys = stroke.map((c) => c.y);
    assert.equal(Math.min(...xs), 0, `包围盒 ${a}×${b} 左边界未铺满`);
    assert.equal(Math.max(...xs), a, `包围盒 ${a}×${b} 右边界未铺满`);
    assert.equal(Math.min(...ys), 0, `包围盒 ${a}×${b} 上边界未铺满`);
    assert.equal(Math.max(...ys), b, `包围盒 ${a}×${b} 下边界未铺满`);
    // 每一行都必须有描边格，否则会出现“半截”椭圆
    assert.equal(new Set(ys).size, b + 1, `包围盒 ${a}×${b} 存在整行空缺`);
    assertClosed(stroke);
    assertSymmetric(stroke);
  }
});

test("回归：偶数跨度实心椭圆面积严格小于满框且随外接框单调不减", () => {
  const area = (a, b) => ellipseCells(0, 0, a, b, { filled: true }).length;
  for (const [a, b] of EVEN_SPAN_BOXES) {
    assert.ok(area(a, b) < (a + 1) * (b + 1), `包围盒 ${a}×${b} 实心椭圆填满了整个包围盒`);
    assert.ok(area(a, b) > 0);
  }
  assert.ok(area(9, 5) < area(19, 11), "同心同比例放大时实心面积应单调增");
  assert.ok(area(7, 3) < area(9, 5));
});

// ---------------- 性能 ----------------
test("性能：400×400 魔棒全图扫描 < 3000ms", () => {
  const w = 400, h = 400;
  const grid = makeGrid(w, h, COLOR("A", [200, 2, 27]));
  const start = Date.now();
  const sel = magicWandSelection(grid, 0, 0, { tolerance: 0 });
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 3000, `耗时 ${elapsed}ms 超过上限`);
  assert.equal(selectionCells(sel, w, h).length, w * h);
});
