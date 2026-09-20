/**
 * accent-protection.test.mjs — 强调色锚点保护单元测试
 * 运行：node --test smart-preprocessing/accent-protection.test.mjs
 */
import test from "node:test";
import assert from "node:assert/strict";
import { rgbToLab } from "./palette-engine.mjs";
import {
  detectAnchorColors,
  buildAnchorLossWeights,
  applyAnchorProtectionToPlan,
  DEFAULT_ACCENT_CONFIG,
} from "./accent-protection.mjs";

// 构造一个色卡 cell
const C = (code, rgb) => ({ code, name: code, hex: "#000000", rgb: [...rgb] });

// 环形最短色相差
function hueDistance(a, b) {
  let d = Math.abs(a - b) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}
const hueOf = (rgb) => {
  const l = rgbToLab(rgb);
  const c = Math.hypot(l[1], l[2]);
  return c < 1e-6 ? null : Math.atan2(l[2], l[1]);
};

test("中性门槛：最暗整体是高彩度色时，暗锚点落到最近的中性暗色", () => {
  // satVeryDark 比 neutralDark 更暗，但彩度高（非中性）→ 不能当暗锚点
  const grid = [[
    C("satVeryDark", [80, 0, 0]),
    C("neutralDark", [40, 40, 40]),
    C("brightNeutral", [245, 245, 245]),
    C("satBright", [255, 255, 100]),
  ]];
  const { anchors, neutralAnchors, profiles } = detectAnchorColors({ grid });
  assert.equal(neutralAnchors.dark, "neutralDark");
  assert.equal(neutralAnchors.bright, "brightNeutral");
  // 关键：最暗的高彩度色被中性门槛筛掉，不能当「中性暗锚点」（它可另作 vivid 锚点）
  assert.notEqual(neutralAnchors.dark, "satVeryDark");
  assert.notEqual(neutralAnchors.bright, "satVeryDark");
  assert.ok(anchors.has("neutralDark") && anchors.has("brightNeutral"));
  // 暗锚点确实是中性色
  assert.ok(profiles.get("neutralDark").chroma <= DEFAULT_ACCENT_CONFIG.neutralChromaThreshold);
  // 卫生检查：satVeryDark 确实高彩度
  assert.ok(profiles.get("satVeryDark").chroma > DEFAULT_ACCENT_CONFIG.neutralChromaThreshold);
});

test("中性门槛：完全没有中性色时，dark/bright 锚点为 null", () => {
  const grid = [[
    C("satVeryDark", [80, 0, 0]),
    C("satBright", [255, 255, 100]),
  ]];
  const { neutralAnchors } = detectAnchorColors({ grid });
  assert.equal(neutralAnchors.dark, null);
  assert.equal(neutralAnchors.bright, null);
});

test("最亮中性锚点正确（高饱和亮色被排除）", () => {
  const grid = [[
    C("neutralDark", [40, 40, 40]),
    C("brightNeutral", [245, 245, 245]),
    C("satBright", [255, 255, 100]),
  ]];
  const { neutralAnchors } = detectAnchorColors({ grid });
  assert.equal(neutralAnchors.bright, "brightNeutral");
  assert.ok(!neutralAnchors.bright === false || neutralAnchors.bright !== "satBright");
});

test("色相环形间隔：跨 0/2π 接缝的相邻色只能选其一", () => {
  // rA 色相≈0.10，rB 色相≈-0.31（等价 5.97），环形间距 < 0.55
  const grid = [
    [C("rA", [255, 0, 120]), C("rA", [255, 0, 120])],
    [C("rB", [255, 0, 190]), C("rB", [255, 0, 190])],
  ];
  const { chromaticAnchors, profiles } = detectAnchorColors({ grid });
  const hA = profiles.get("rA").hue;
  const hB = profiles.get("rB").hue;
  // 自证：二者环形相邻
  assert.ok(hueDistance(hA, hB) < DEFAULT_ACCENT_CONFIG.hueSeparation);
  assert.equal(chromaticAnchors.length, 1, "相邻色只能选一个锚点");
  assert.ok(!(chromaticAnchors.includes("rA") && chromaticAnchors.includes("rB")));
});

test("色相环形间隔：缩小 hueSeparation 后两个相邻色可同时入选", () => {
  const grid = [
    [C("rA", [255, 0, 120]), C("rA", [255, 0, 120])],
    [C("rB", [255, 0, 190]), C("rB", [255, 0, 190])],
  ];
  // 二者环形间距≈0.415；放宽到 1.0 仍判冲突，缩到 0.3 才都入选
  const { chromaticAnchors } = detectAnchorColors({ grid, options: { hueSeparation: 0.3 } });
  assert.equal(chromaticAnchors.length, 2);
});

test("最多 3 个鲜艳锚点上限（maxChromaticAnchors=3/2/0）", () => {
  const mk = (code, rgb) => C(code, rgb);
  const A = mk("A", [255, 0, 0]); // 0.698
  const B = mk("B", [255, 255, 0]); // 1.795
  const Cc = mk("C", [0, 255, 0]); // 2.374
  const D = mk("D", [0, 0, 255]); // -0.938
  const grid = [
    [A, A, A, A],
    [B, B, B, B],
    [Cc, Cc, Cc, Cc],
    [D, D, D, D],
  ];
  assert.equal(detectAnchorColors({ grid, options: { maxChromaticAnchors: 3 } }).chromaticAnchors.length, 3);
  assert.equal(detectAnchorColors({ grid, options: { maxChromaticAnchors: 2 } }).chromaticAnchors.length, 2);
  assert.equal(detectAnchorColors({ grid, options: { maxChromaticAnchors: 0 } }).chromaticAnchors.length, 0);
});

test("鲜艳锚点按「颗数×彩度」排序取舍：低分被丢弃", () => {
  const A = C("A", [255, 0, 0]); // 高彩度，count 10
  const B = C("B", [255, 255, 0]);
  const Cc = C("C", [0, 255, 0]);
  const D = C("D", [0, 0, 255]); // 同样高彩度但 count=1 → 垫底
  const row = [];
  for (let i = 0; i < 10; i++) row.push(A, B, Cc);
  row.push(D);
  const grid = [row];
  const { chromaticAnchors } = detectAnchorColors({ grid, options: { maxChromaticAnchors: 3 } });
  assert.ok(chromaticAnchors.includes("A") && chromaticAnchors.includes("B") && chromaticAnchors.includes("C"));
  assert.ok(!chromaticAnchors.includes("D"), "低颗数×彩度的鲜艳色应被丢弃");
});

test("buildAnchorLossWeights：Map 只含锚点，非锚点不出现，值为 40", () => {
  const anchors = new Set(["x", "y"]);
  const weights = buildAnchorLossWeights(anchors);
  assert.equal(weights.size, 2);
  assert.equal(weights.get("x"), 40);
  assert.equal(weights.get("y"), 40);
  assert.ok(!weights.has("nonAnchor"));
});

test("buildAnchorLossWeights：可配置 anchorLossWeight", () => {
  const weights = buildAnchorLossWeights(new Set(["x"]), { anchorLossWeight: 25 });
  assert.equal(weights.get("x"), 25);
});

test("applyAnchorProtectionToPlan：空锚点时原样返回（同引用 + 结构/顺序不变）", () => {
  const plan = [
    { from: "a", to: "b", distance: 5, importance: 1 },
    { from: "c", to: "d", distance: 3, importance: 2 },
  ];
  const result = applyAnchorProtectionToPlan(plan, new Set());
  assert.strictEqual(result, plan, "应返回同一数组引用");
  assert.deepStrictEqual(result, plan, "结构/顺序完全不变");
});

test("applyAnchorProtectionToPlan：锚点条目排到 plan 末尾", () => {
  const plan = [
    { from: "anchor", to: "c", distance: 3, importance: 9 },
    { from: "a", to: "b", distance: 5, importance: 1 },
    { from: "d", to: "e", distance: 4, importance: 2 },
  ];
  const result = applyAnchorProtectionToPlan(plan, new Set(["anchor"]));
  assert.equal(result[result.length - 1].from, "anchor");
  assert.equal(result[0].from, "a");
  assert.equal(result[1].from, "d");
});

test("applyAnchorProtectionToPlan：锚点 cost 被放大、基准 cost ×1", () => {
  const plan = [
    { from: "anchor", to: "c", distance: 3, importance: 9 },
    { from: "a", to: "b", distance: 5, importance: 1 },
  ];
  const result = applyAnchorProtectionToPlan(plan, new Set(["anchor"]), { anchorLossWeight: 40 });
  const anchorEntry = result.find((e) => e.from === "anchor");
  const normalEntry = result.find((e) => e.from === "a");
  assert.equal(anchorEntry.cost, 3 * 40);
  assert.equal(normalEntry.cost, 5);
  assert.equal(anchorEntry.anchorProtected, true);
  assert.equal(normalEntry.anchorProtected, false);
});

test("anchors 集合同时含中性暗/亮与鲜艳锚点", () => {
  const grid = [[
    C("darkN", [30, 30, 30]),
    C("brightN", [245, 245, 245]),
    C("red", [255, 0, 0]),
    C("red2", [255, 0, 0]),
  ]];
  const { anchors } = detectAnchorColors({ grid });
  assert.ok(anchors.has("darkN"));
  assert.ok(anchors.has("brightN"));
  assert.ok(anchors.has("red"));
});

test("profiles.reason 标注正确（dark-neutral / bright-neutral / vivid）", () => {
  const grid = [[
    C("darkN", [30, 30, 30]),
    C("brightN", [245, 245, 245]),
    C("red", [255, 0, 0]),
  ]];
  const { profiles } = detectAnchorColors({ grid });
  assert.equal(profiles.get("darkN").reason, "dark-neutral");
  assert.equal(profiles.get("brightN").reason, "bright-neutral");
  assert.equal(profiles.get("red").reason, "vivid");
});

test("只有中性色时不会产生 vivid 锚点", () => {
  const grid = [[
    C("darkN", [30, 30, 30]),
    C("brightN", [245, 245, 245]),
  ]];
  const { chromaticAnchors } = detectAnchorColors({ grid });
  assert.equal(chromaticAnchors.length, 0);
});

test("neutralChromaThreshold 配置：放宽后近中性亮色可成中性亮锚点", () => {
  // pink 彩度 12.1：默认(12)不算中性；放宽到 14 算中性 → 成为亮锚点
  // pink 彩度 12.12：默认(12)不算中性；放宽到 14 算中性 → 成为（最亮）中性锚点
  const grid = [[
    C("darkN", [30, 30, 30]),
    C("pink", [255, 224, 233]),
  ]];
  assert.equal(detectAnchorColors({ grid }).neutralAnchors.bright, "darkN", "默认门槛下 pink 非中性，最亮中性仍是暗色");
  assert.equal(detectAnchorColors({ grid, options: { neutralChromaThreshold: 14 } }).neutralAnchors.bright, "pink", "放宽门槛后 pink 成最亮中性锚点");
});

test("chromaThreshold 配置：低于门槛的鲜艳色被排除，高于门槛的入选", () => {
  // pink 单独作为唯一鲜艳候选（避免与其它鲜艳色相互色相冲突）
  const gp = [[
    C("darkN", [30, 30, 30]),
    C("brightN", [245, 245, 245]),
    C("pink", [255, 224, 233]), // 彩度 12.1
  ]];
  assert.equal(detectAnchorColors({ grid: gp }).chromaticAnchors.length, 0, "默认门槛(15)下 pink 不是鲜艳锚点");
  assert.ok(detectAnchorColors({ grid: gp, options: { chromaThreshold: 10 } }).chromaticAnchors.includes("pink"), "门槛降到 10 后 pink 入选");

  // mid 单独（彩度 16.8）
  const gm = [[
    C("darkN", [30, 30, 30]),
    C("brightN", [245, 245, 245]),
    C("mid", [255, 210, 210]),
  ]];
  assert.ok(detectAnchorColors({ grid: gm }).chromaticAnchors.includes("mid"), "默认门槛(15)下 mid 入选");
  assert.equal(detectAnchorColors({ grid: gm, options: { chromaThreshold: 20 } }).chromaticAnchors.length, 0, "门槛提到 20 后 mid 落选");
});

test("近中性（彩度极小）的颜色不会成为 vivid 锚点", () => {
  const grid = [[
    C("darkN", [30, 30, 30]),
    C("white", [250, 250, 250]), // 彩度≈0
    C("red", [255, 0, 0]),
  ]];
  const { chromaticAnchors, profiles } = detectAnchorColors({ grid });
  assert.ok(!chromaticAnchors.includes("white"));
  assert.ok(profiles.get("white").chroma < 1e-3, "白色彩度应极小（近中性）");
});

test("空 grid 返回空锚点集合与空画像", () => {
  const r = detectAnchorColors({ grid: [] });
  assert.equal(r.anchors.size, 0);
  assert.equal(r.profiles.size, 0);
  assert.equal(r.diagnostics.totalColors, 0);
});

test("detectAnchorColors 忽略 null 真空豆格", () => {
  const grid = [
    [C("darkN", [30, 30, 30]), null],
    [null, C("brightN", [245, 245, 245])],
  ];
  const { anchors } = detectAnchorColors({ grid });
  assert.ok(anchors.has("darkN") && anchors.has("brightN"));
});

test("maxChromaticAnchors=1 时只选一个鲜艳锚点", () => {
  const grid = [
    [C("A", [255, 0, 0]), C("B", [255, 255, 0]), C("C", [0, 255, 0])],
  ];
  assert.equal(detectAnchorColors({ grid, options: { maxChromaticAnchors: 1 } }).chromaticAnchors.length, 1);
});

test("diagnostics 含中性/鲜艳统计字段", () => {
  const grid = [[
    C("darkN", [30, 30, 30]),
    C("brightN", [245, 245, 245]),
    C("red", [255, 0, 0]),
  ]];
  const { diagnostics } = detectAnchorColors({ grid });
  assert.equal(diagnostics.totalColors, 3);
  assert.equal(diagnostics.neutralCount, 2);
  assert.equal(diagnostics.chromaticCandidates, 1);
  assert.equal(diagnostics.chromaticChosen, 1);
});

test("DEFAULT_ACCENT_CONFIG 冻结且默认值正确", () => {
  assert.ok(Object.isFrozen(DEFAULT_ACCENT_CONFIG));
  assert.equal(DEFAULT_ACCENT_CONFIG.anchorLossWeight, 40);
  assert.equal(DEFAULT_ACCENT_CONFIG.maxChromaticAnchors, 3);
  assert.equal(DEFAULT_ACCENT_CONFIG.hueSeparation, 0.55);
});
