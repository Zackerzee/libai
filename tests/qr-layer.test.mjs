/**
 * 拼豆二维码素材层 —— 服务层契约与**可扫性不变量**。
 *
 * ── 这个文件为什么盯「布局数学」比盯「有没有生成」更狠 ──────────────
 * 二维码功能的失效形状是**静默的**：一个模块边界错到半格的豆拼图案，
 * 在图上看起来完全是二维码，只有拿手机扫才发现读不出来。
 * 「生成成功」这个断言对它毫无约束力。
 *
 * 所以这里的主线是三条可执行的不变量：
 *   ① **整数对齐**：每模块恰好 `beadPerModule` 格，原点落在整数格上；
 *   ② **往返投影无损**：把 rasterizeQr 产出的每一格反推回模块，能逐位还原
 *      编码器的模块矩阵 —— 这等价于「解码器采样点能采对」；
 *   ③ **静默区**：码四周 ≥ 4 模块的浅色区，且静默区不参与数据模块判定。
 *
 * 加上一条 golden matrix 哈希，把「编码器换了 / 映射改错了」也钉住。
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

import {
  QR_ECC_LEVELS, DEFAULT_QR_ECC, QR_QUIET_MODULES, QR_MIN_CONTRAST_RATIO, QR_QUIET_MAX,
  createQrLayer, normalizeEcc, buildQrMatrix, qrLayout, cellToModule, qrMaxModules,
  rasterizeQr, rasterizeQrCached, qrContrast, relativeLuminance, parseHexColor,
  qrDiagnostics, composeLockedQrGrid, qrLayerLabel, resolveQrEncoder,
} from "../services/qr-layer-service.js";

/* 与浏览器同一个编码器（vendor/qrcode.js，MIT）。无 package.json → .js 走 CommonJS。 */
const require = createRequire(import.meta.url);
const ENCODER = require("../vendor/qrcode.js");

const fnv1a = (text) => {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
};
const modulesToBits = (matrix) => Array.from(matrix.modules).join("");

/**
 * 「LIBMS」+ M 级 的模块矩阵哈希（version 1，21×21）。
 * 锁的是「同一内容 + 同一 ECC → 同一张矩阵」这条契约：换掉编码器、改错
 * addData 的模式、或动了模块遍历顺序，它都会红。数值由 vendor/qrcode.js 产出。
 */
const GOLDEN_LIBMS_M = "cd80e723";

/** 造一份调色板（色号 + rgb），给合成测试用。 */
const PALETTE = [
  { paletteId: "K01", code: "K01", rgb: [27, 27, 31], hex: "#1b1b1f" },
  { paletteId: "W01", code: "W01", rgb: [255, 255, 255], hex: "#ffffff" },
  { paletteId: "R01", code: "R01", rgb: [215, 71, 35], hex: "#d74723" },
];

/* ══════════════════════════════════════════════════════════════════
 * A. 契约
 * ══════════════════════════════════════════════════════════════════ */

test("A1 createQrLayer：默认值可用（默认内容必须能直接出矩阵）", () => {
  const layer = createQrLayer();
  assert.equal(layer.ecc, DEFAULT_QR_ECC);
  assert.equal(layer.quietModules, QR_QUIET_MODULES);
  assert.equal(layer.lightMode, "bead");
  assert.equal(layer.beadPerModule, 0, "0 = 自动，不是 1");
  assert.equal(layer.locked, false);
  assert.equal(Number.isInteger(layer.x) && Number.isInteger(layer.y), true);
  const matrix = buildQrMatrix({ text: layer.text, ecc: layer.ecc, encoder: ENCODER });
  assert.equal(matrix.error, null, `默认内容必须能出矩阵，实测 ${matrix.error}`);
  assert.ok(matrix.count > 0);
});

test("A2 createQrLayer：id 唯一；overrides 生效", () => {
  const ids = new Set();
  for (let i = 0; i < 20; i += 1) ids.add(createQrLayer().id);
  assert.equal(ids.size, 20, "id 必须唯一");
  const layer = createQrLayer({ text: "hello", ecc: "L", x: 3, y: 4 });
  assert.equal(layer.text, "hello");
  assert.equal(layer.ecc, "L");
  assert.equal(layer.x, 3);
});

test("A3 normalizeEcc：非法值回落默认，大小写不敏感", () => {
  assert.equal(normalizeEcc("h"), "H");
  assert.equal(normalizeEcc("Q"), "Q");
  assert.equal(normalizeEcc("X"), DEFAULT_QR_ECC);
  assert.equal(normalizeEcc(null), DEFAULT_QR_ECC);
  assert.equal(QR_ECC_LEVELS.length, 4);
});

test("A4 resolveQrEncoder：注入优先；没有编码器时返回 null 而不是抛", () => {
  assert.equal(resolveQrEncoder({ encoder: ENCODER }), ENCODER);
  // Node 侧没有 globalThis.qrcode（浏览器里由 app.js 注入），所以这里必须容忍 null。
  // 断言的是「不抛」+「要么给出可调用工厂、要么明确 null」，而不是「一定有」。
  const resolved = resolveQrEncoder({});
  assert.ok(resolved === null || typeof resolved === "function", `无编码器时应返回 null 或函数，实测 ${typeof resolved}`);
  // 非函数值（字符串/对象）不能被当成编码器吞下去 —— 那会在 make() 时炸在深层。
  assert.equal(resolveQrEncoder({ encoder: "not-a-function" }) === null || typeof resolveQrEncoder({ encoder: "not-a-function" }) === "function", true);
  assert.equal(resolveQrEncoder({ encoder: {} }), null, "对象不是编码器，必须回落（Node 无全局 → null）");
});

/* ══════════════════════════════════════════════════════════════════
 * B. 内容 → 矩阵
 * ══════════════════════════════════════════════════════════════════ */

test("B1 buildQrMatrix：确定性 —— 同输入两次逐位相同", () => {
  const a = buildQrMatrix({ text: "https://www.libms.net", ecc: "M", encoder: ENCODER });
  const b = buildQrMatrix({ text: "https://www.libms.net", ecc: "M", encoder: ENCODER });
  assert.equal(modulesToBits(a), modulesToBits(b));
  assert.equal(a.count, b.count);
  assert.equal(a.version, b.version);
});

test("B2 buildQrMatrix：自动选版 —— 内容越长版本越大、模块数 = 版本×4+17", () => {
  const short = buildQrMatrix({ text: "A", ecc: "M", encoder: ENCODER });
  const long = buildQrMatrix({ text: "A".repeat(300), ecc: "M", encoder: ENCODER });
  assert.ok(long.version > short.version, `长内容应选更大版本：${short.version} → ${long.version}`);
  for (const matrix of [short, long]) {
    assert.equal(matrix.count, matrix.version * 4 + 17, "模块数必须等于 版本×4+17");
  }
});

test("B3 buildQrMatrix：纠错等级影响矩阵（同内容不同 ECC 结果不同）", () => {
  const l = buildQrMatrix({ text: "https://www.libms.net", ecc: "L", encoder: ENCODER });
  const h = buildQrMatrix({ text: "https://www.libms.net", ecc: "H", encoder: ENCODER });
  assert.notEqual(modulesToBits(l), modulesToBits(h), "不同 ECC 必须产生不同矩阵");
  assert.ok(h.version >= l.version, "H 容错更高，所需版本不应更小");
});

test("B4 buildQrMatrix：中文内容可编码（UTF-8 路径）", () => {
  const matrix = buildQrMatrix({ text: "时里白造物 · 拼豆图纸", ecc: "H", encoder: ENCODER });
  assert.equal(matrix.error, null);
  assert.ok(matrix.count > 0);
  assert.equal(matrix.modules.length, matrix.count * matrix.count);
});

test("B5 内容太长 → 返回 error，**不抛**（它是正常用户输入，不是崩溃）", () => {
  let matrix;
  assert.doesNotThrow(() => { matrix = buildQrMatrix({ text: "x".repeat(5000), ecc: "H", encoder: ENCODER }); });
  assert.ok(matrix.error, "超容量必须给出 error");
  assert.match(matrix.error, /太长|容量/, `错误文案要说清是容量问题，实测「${matrix.error}」`);
  assert.equal(matrix.count, 0);
});

test("B6 空内容 / 无编码器 → error，不抛", () => {
  assert.ok(buildQrMatrix({ text: "   ", encoder: ENCODER }).error);
  assert.ok(buildQrMatrix({ text: "abc", encoder: null }).error);
  assert.equal(buildQrMatrix({ text: "abc", encoder: null }).count, 0);
});

test("B7 golden matrix：编码器与映射被改动时必须变红", () => {
  // 这个哈希锁的是「同一个内容 + 同一个 ECC → 同一张模块矩阵」。
  // 换掉编码器、改错 addData 的模式、或动了模块遍历顺序，它都会红。
  const matrix = buildQrMatrix({ text: "LIBMS", ecc: "M", encoder: ENCODER });
  assert.equal(matrix.version, 1, "「LIBMS」在 M 级应落在版本 1（21×21）");
  assert.equal(matrix.count, 21);
  assert.equal(fnv1a(modulesToBits(matrix)), GOLDEN_LIBMS_M);
});

/* ══════════════════════════════════════════════════════════════════
 * C. 布局：整数对齐（本功能的核心不变量）
 * ══════════════════════════════════════════════════════════════════ */

test("C1 qrLayout：模块总数 = 模块数 + 2×静默区；占格 = 模块总数 × 每模块豆数", () => {
  const layout = qrLayout({ moduleCount: 21, quietModules: 4, gridWidth: 104, gridHeight: 104, x: 0, y: 0 });
  assert.equal(layout.totalModules, 21 + 8);
  assert.equal(layout.autoBeadPerModule, Math.floor(104 / 29));
  assert.equal(layout.beadPerModule, layout.autoBeadPerModule);
  assert.equal(layout.spanCells, layout.totalModules * layout.beadPerModule);
});

test("C2 qrLayout：beadPerModule 与原点永远是整数（小数会被取整，不会漏出去）", () => {
  const layout = qrLayout({ moduleCount: 25, quietModules: 4, gridWidth: 100, gridHeight: 100, x: 7.4, y: 2.6, beadPerModule: 2.7 });
  assert.equal(Number.isInteger(layout.beadPerModule), true, `beadPerModule 必须是整数，实测 ${layout.beadPerModule}`);
  assert.equal(layout.beadPerModule, 3);
  assert.equal(Number.isInteger(layout.box.x0), true);
  assert.equal(Number.isInteger(layout.box.y0), true);
  assert.equal(layout.box.x0, 7);
  assert.equal(layout.box.y0, 3);
});

test("C3 qrLayout：放不下时 tooSmall，且**不硬凑** beadPerModule=1", () => {
  // 200 个模块 + 静默区塞进 40 格 —— 自动取整会得到 0。
  // 若这里硬凑成 1，就会画出一个超出画布的码，看起来「生成了」实际根本放不下。
  const layout = qrLayout({ moduleCount: 200, quietModules: 4, gridWidth: 40, gridHeight: 40 });
  assert.equal(layout.autoBeadPerModule, 0);
  assert.equal(layout.tooSmall, true);
  assert.equal(layout.fits, false);
});

test("C4 qrLayout：overflow 四向分别判定（不是笼统的「超了」）", () => {
  const base = { moduleCount: 21, quietModules: 4, gridWidth: 104, gridHeight: 104, beadPerModule: 3 };
  assert.equal(qrLayout({ ...base, x: 0, y: 0 }).fullyInside, true);
  assert.equal(qrLayout({ ...base, x: -1, y: 0 }).overflow.left, true);
  assert.equal(qrLayout({ ...base, x: 0, y: -1 }).overflow.top, true);
  assert.equal(qrLayout({ ...base, x: 104 - 87 + 1, y: 0 }).overflow.right, true);
  assert.equal(qrLayout({ ...base, x: 0, y: 104 - 87 + 1 }).overflow.bottom, true);
});

test("C5 qrMaxModules：图纸短边能容纳的模块上限（面板的容量提示靠它）", () => {
  assert.equal(qrMaxModules(104, 104, 4), 104 - 8);
  assert.equal(qrMaxModules(60, 200, 4), 60 - 8, "取短边");
  assert.equal(qrMaxModules(0, 100, 4), 0);
});

test("C6 静默区被夹在 [0, QR_QUIET_MAX]，不合法值回落规范默认", () => {
  assert.equal(qrLayout({ moduleCount: 21, quietModules: 999, gridWidth: 200, gridHeight: 200 }).quietModules, QR_QUIET_MAX);
  assert.equal(qrLayout({ moduleCount: 21, quietModules: -5, gridWidth: 200, gridHeight: 200 }).quietModules, 0);
  assert.equal(qrLayout({ moduleCount: 21, quietModules: "abc", gridWidth: 200, gridHeight: 200 }).quietModules, QR_QUIET_MODULES);
});

/* ══════════════════════════════════════════════════════════════════
 * D. 往返投影无损 —— 「解码器采样点能采对」的可执行证明
 * ══════════════════════════════════════════════════════════════════ */

const PROJECTION_CASES = [
  { name: "21 模块 · 3 格/模块", text: "LIBMS", ecc: "M", gridWidth: 104, gridHeight: 104, beadPerModule: 3 },
  { name: "25 模块 · 2 格/模块", text: "https://www.libms.net", ecc: "H", gridWidth: 104, gridHeight: 104, beadPerModule: 2 },
  { name: "中文内容 · 自动", text: "时里白造物", ecc: "H", gridWidth: 200, gridHeight: 200, beadPerModule: 0 },
];

for (const testCase of PROJECTION_CASES) {
  test(`D 往返投影：${testCase.name} —— 每一格都能反推回它来自哪个模块`, () => {
    const layer = createQrLayer({
      text: testCase.text, ecc: testCase.ecc,
      gridWidth: testCase.gridWidth, gridHeight: testCase.gridHeight,
      x: 0, y: 0, beadPerModule: testCase.beadPerModule, quietModules: 4,
    });
    const raster = rasterizeQr(layer, testCase.gridWidth, testCase.gridHeight, { encoder: ENCODER });
    assert.equal(raster.error, null, `不该有错：${raster.error}`);
    const { layout, matrix } = raster;
    assert.ok(layout.beadPerModule >= 1, "必须取到 ≥1 的整数");

    // 逐模块清点：每个模块应恰好收到 bead² 格，且深浅属性与矩阵一致
    const perModule = new Map();
    for (const group of raster.paintLayers) {
      for (const cell of group.cells) {
        const mapped = cellToModule(layout, cell.x, cell.y);
        assert.ok(mapped, `格 (${cell.x},${cell.y}) 必须落在码的范围内`);
        const key = `${mapped.row},${mapped.col}`;
        const entry = perModule.get(key) || { dark: 0, light: 0, quiet: mapped.quiet };
        entry[group.role] += 1;
        perModule.set(key, entry);
      }
    }
    const expected = layout.beadPerModule * layout.beadPerModule;
    let darkModules = 0, lightModules = 0, quietModules = 0;
    for (const [key, entry] of perModule) {
      const [row, col] = key.split(",").map(Number);
      if (entry.quiet) {
        quietModules += 1;
        assert.equal(entry.light, expected, `静默区模块 ${key} 应全是浅色格`);
        continue;
      }
      const isDark = matrix.isDark(row, col);
      if (isDark) { darkModules += 1; assert.equal(entry.dark, expected, `深色模块 ${key} 应恰好 ${expected} 格，实测 ${entry.dark}`); assert.equal(entry.light, 0); }
      else { lightModules += 1; assert.equal(entry.light, expected, `浅色模块 ${key} 应恰好 ${expected} 格，实测 ${entry.light}`); assert.equal(entry.dark, 0); }
    }

    // 每个数据模块都被覆盖到了（没有漏画的模块）
    let matrixDark = 0, matrixLight = 0;
    for (let r = 0; r < matrix.count; r += 1) {
      for (let c = 0; c < matrix.count; c += 1) (matrix.isDark(r, c) ? matrixDark += 1 : matrixLight += 1);
    }
    assert.equal(darkModules, matrixDark, "深色模块数必须与矩阵一致");
    assert.equal(lightModules, matrixLight, "浅色模块数必须与矩阵一致");
    assert.equal(quietModules, layout.totalModules * layout.totalModules - matrix.count * matrix.count, "静默区模块数必须补齐外圈");
  });
}

test("D2 往返投影可以逐位重建矩阵（等价于「解码器能采对每个模块」）", () => {
  const layer = createQrLayer({ text: "https://www.libms.net", ecc: "Q", x: 3, y: 5, beadPerModule: 2, quietModules: 4 });
  const raster = rasterizeQr(layer, 104, 104, { encoder: ENCODER });
  const { layout, matrix } = raster;
  const rebuilt = new Uint8Array(matrix.count * matrix.count).fill(255);
  for (const group of raster.paintLayers) {
    for (const cell of group.cells) {
      const mapped = cellToModule(layout, cell.x, cell.y);
      if (!mapped || mapped.quiet) continue;
      const index = mapped.row * matrix.count + mapped.col;
      const value = group.role === "dark" ? 1 : 0;
      if (rebuilt[index] === 255) rebuilt[index] = value;
      else assert.equal(rebuilt[index], value, `模块 ${mapped.row},${mapped.col} 收到矛盾的值`);
    }
  }
  assert.equal(Array.from(rebuilt).some((value) => value === 255), false, "有模块没被覆盖");
  assert.equal(fnv1a(Array.from(rebuilt).join("")), fnv1a(Array.from(matrix.modules).join("")), "重建的矩阵必须与编码器逐位相同");
});

test("D3 cellToModule：范围外的格返回 null", () => {
  const layout = qrLayout({ moduleCount: 21, quietModules: 4, gridWidth: 104, gridHeight: 104, x: 10, y: 10, beadPerModule: 3 });
  assert.equal(cellToModule(layout, 9, 10), null, "左边一格之外");
  assert.equal(cellToModule(layout, 10, 10).quiet, true, "左上角是静默区");
  assert.equal(cellToModule(layout, 10 + 87, 10), null, "右下角之外");
  assert.equal(cellToModule(null, 0, 0), null);
});

/* ══════════════════════════════════════════════════════════════════
 * E. 静默区 / 浅色模式
 * ══════════════════════════════════════════════════════════════════ */

test("E1 静默区默认 4 模块，四角都是浅色（不是深色）", () => {
  const layer = createQrLayer({ text: "LIBMS", ecc: "M", beadPerModule: 2 });
  const raster = rasterizeQr(layer, 104, 104, { encoder: ENCODER });
  const { layout } = raster;
  const darkSet = new Set(raster.paintLayers.find((g) => g.role === "dark").cells.map((c) => `${c.x},${c.y}`));
  const bead = layout.beadPerModule;
  for (const [cx, cy] of [[0, 0], [layout.totalModules - 1, 0], [0, layout.totalModules - 1], [layout.totalModules - 1, layout.totalModules - 1]]) {
    for (let dy = 0; dy < bead; dy += 1) for (let dx = 0; dx < bead; dx += 1) {
      const key = `${layout.box.x0 + cx * bead + dx},${layout.box.y0 + cy * bead + dy}`;
      assert.equal(darkSet.has(key), false, `角模块 (${cx},${cy}) 不该有深色格`);
    }
  }
});

test("E2 lightMode=empty：只落深色豆，浅色区与静默区都不落", () => {
  const beaded = rasterizeQr(createQrLayer({ text: "LIBMS", ecc: "M", beadPerModule: 2 }), 104, 104, { encoder: ENCODER });
  const empty = rasterizeQr(createQrLayer({ text: "LIBMS", ecc: "M", beadPerModule: 2, lightMode: "empty" }), 104, 104, { encoder: ENCODER });
  assert.equal(empty.paintLayers.length, 1, "empty 模式只有深色一层");
  assert.equal(empty.paintLayers[0].role, "dark");
  assert.equal(empty.cells.length, beaded.paintLayers.find((g) => g.role === "dark").cells.length, "深色豆数必须一致");
  assert.ok(empty.cells.length < beaded.cells.length, "empty 模式总豆数必须更少");
});

test("E3 静默区数量可调，且不影响数据模块的落格", () => {
  const layer = createQrLayer({ text: "LIBMS", ecc: "M", beadPerModule: 2, quietModules: 0 });
  const raster = rasterizeQr(layer, 104, 104, { encoder: ENCODER });
  assert.equal(raster.layout.totalModules, raster.layout.moduleCount, "静默区 0 时总数 = 模块数");
  const withQuiet = rasterizeQr(createQrLayer({ text: "LIBMS", ecc: "M", beadPerModule: 2, quietModules: 4 }), 104, 104, { encoder: ENCODER });
  const dark = (r) => r.paintLayers.find((g) => g.role === "dark").cells.length;
  assert.equal(dark(raster), dark(withQuiet), "静默区只影响浅色区，深色豆数不变");
});

/* ══════════════════════════════════════════════════════════════════
 * F. 对比度
 * ══════════════════════════════════════════════════════════════════ */

test("F1 qrContrast：黑白达标；灰白不达标；反色被单独指出", () => {
  assert.equal(qrContrast("#000000", "#ffffff").ok, true);
  const low = qrContrast("#9a9a9a", "#ffffff");
  assert.equal(low.ok, false, `灰白对比度 ${low.ratio}:1 应不达标`);
  assert.ok(low.ratio < QR_MIN_CONTRAST_RATIO);
  const inverted = qrContrast("#ffffff", "#000000");
  assert.equal(inverted.inverted, true, "深色模块比浅色还亮必须被识别成反色");
  assert.equal(inverted.ok, false);
});

test("F2 relativeLuminance / parseHexColor：边界与非法输入", () => {
  assert.equal(parseHexColor("#ffffff").join(","), "255,255,255");
  assert.equal(parseHexColor("000000").join(","), "0,0,0");
  assert.equal(parseHexColor("xyz"), null);
  assert.equal(relativeLuminance("#ffffff"), 1);
  assert.equal(relativeLuminance("#000000"), 0);
  assert.equal(relativeLuminance("nope"), null);
});

/* ══════════════════════════════════════════════════════════════════
 * G. 面板读数 / 缓存
 * ══════════════════════════════════════════════════════════════════ */

test("G1 qrDiagnostics：给出落豆数、容量、对比度与警告", () => {
  const layer = createQrLayer({ text: "https://www.libms.net", ecc: "H", quietModules: 2 });
  const diag = qrDiagnostics(layer, 104, 104, { encoder: ENCODER });
  assert.equal(diag.error, null);
  assert.ok(diag.beadCount > 0);
  assert.equal(diag.beadCount, diag.darkBeads + diag.lightBeads);
  assert.equal(diag.capacity, qrMaxModules(104, 104, 2));
  assert.ok(diag.warnings.some((w) => /静默区/.test(w)), "静默区低于规范必须给警告");
  assert.equal(diag.contrast.ok, true);
});

test("G2 qrDiagnostics：empty 模式与超出图纸都有明确警告", () => {
  const diag = qrDiagnostics(createQrLayer({ text: "LIBMS", lightMode: "empty", x: 90, y: 0, beadPerModule: 3 }), 104, 104, { encoder: ENCODER });
  assert.ok(diag.warnings.some((w) => /留空/.test(w)));
  assert.ok(diag.warnings.some((w) => /超出图纸/.test(w)));
});

test("G3 qrDiagnostics：内容为空时报 error 而不是崩", () => {
  const diag = qrDiagnostics(createQrLayer({ text: "" }), 104, 104, { encoder: ENCODER });
  assert.ok(diag.error);
  assert.equal(diag.beadCount, 0);
});

test("G4 rasterizeQrCached：同参数命中缓存，返回同一对象；参数变则重算", () => {
  const layer = createQrLayer({ text: "LIBMS", ecc: "M", beadPerModule: 2 });
  const a = rasterizeQrCached(layer, 104, 104, { encoder: ENCODER });
  const b = rasterizeQrCached(layer, 104, 104, { encoder: ENCODER });
  assert.equal(a, b, "同参数必须命中同一对象");
  const c = rasterizeQrCached({ ...layer, text: "OTHER" }, 104, 104, { encoder: ENCODER });
  assert.notEqual(a, c);
});

/* ══════════════════════════════════════════════════════════════════
 * H. 导出合成
 * ══════════════════════════════════════════════════════════════════ */

const makeGrid = (size) => Array.from({ length: size }, () => new Array(size).fill(null));

test("H1 composeLockedQrGrid：只并**已锁定**的层", () => {
  const grid = makeGrid(60);
  const unlocked = createQrLayer({ text: "LIBMS", beadPerModule: 1, x: 2, y: 2, locked: false });
  assert.equal(composeLockedQrGrid(grid, [unlocked], PALETTE, { encoder: ENCODER }), grid, "没有锁定层时应原样返回同一个网格");
  const locked = createQrLayer({ text: "LIBMS", beadPerModule: 1, x: 2, y: 2, locked: true, darkPaletteId: "K01", lightPaletteId: "W01" });
  const out = composeLockedQrGrid(grid, [locked], PALETTE, { encoder: ENCODER });
  assert.notEqual(out, grid);
  assert.ok(out.flat().filter(Boolean).length > 0, "锁定后应写入豆格");
});

test("H2 composeLockedQrGrid：不改底版（原网格逐格不变）", () => {
  const grid = makeGrid(60);
  grid[0][0] = PALETTE[2];
  const before = JSON.stringify(grid);
  composeLockedQrGrid(grid, [createQrLayer({ text: "LIBMS", beadPerModule: 1, x: 5, y: 5, locked: true })], PALETTE, { encoder: ENCODER });
  assert.equal(JSON.stringify(grid), before, "底版必须逐格不变");
});

test("H3 composeLockedQrGrid：越界部分被裁剪，不写越界索引", () => {
  const grid = makeGrid(40);
  const out = composeLockedQrGrid(grid, [createQrLayer({ text: "LIBMS", beadPerModule: 3, x: -5, y: -5, locked: true })], PALETTE, { encoder: ENCODER });
  assert.equal(out.length, 40);
  for (const row of out) assert.equal(row.length, 40);
});

test("H4 composeLockedQrGrid：按 paletteId 精确取色；无 paletteId 时按 hex 就近取", () => {
  const grid = makeGrid(40);
  const out = composeLockedQrGrid(grid, [createQrLayer({
    text: "LIBMS", beadPerModule: 1, x: 0, y: 0, locked: true,
    darkPaletteId: "R01", lightPaletteId: "W01",
  })], PALETTE, { encoder: ENCODER });
  const used = new Set(out.flat().filter(Boolean).map((color) => color.paletteId));
  assert.equal(used.has("R01"), true, "深色模块应取到 R01");
  assert.equal(used.has("W01"), true, "浅色模块应取到 W01");

  const byHex = composeLockedQrGrid(makeGrid(40), [createQrLayer({
    text: "LIBMS", beadPerModule: 1, x: 0, y: 0, locked: true, darkHex: "#d74723", lightHex: "#ffffff",
  })], PALETTE, { encoder: ENCODER });
  const hexUsed = new Set(byHex.flat().filter(Boolean).map((color) => color.paletteId));
  assert.equal(hexUsed.has("R01"), true, "深色 hex 应就近映射到 R01");
});

test("H5 qrLayerLabel：列表摘要文案", () => {
  assert.match(qrLayerLabel({ text: "https://www.libms.net" }, 0), /^二维码 1: "/);
  assert.match(qrLayerLabel({ text: "   " }, 1), /空内容/);
  assert.match(qrLayerLabel({ text: "a".repeat(40) }, 0), /…/);
});
