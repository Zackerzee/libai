/**
 * 生成尺寸模型契约测试（Stage B0 §1 / §4）。
 *
 * 为什么需要它：历史上「生成尺寸」没有「未解析」这个状态，调用方只能拿 width 兜底，
 * 于是任何尚未确定比例的时刻都会生成一张**方图**（首帧 50×50 就是这么来的）。
 * 这里把两条铁律钉死：
 *   1. 比例可用时，宽高必须由「长边 + 比例」派生，**非 1:1 图绝不能退化成方图**；
 *   2. 比例不可用时返回 **null**，而不是 1、也不是 width。
 *
 * 纯计算，无 DOM。
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  GENERATION_LONG_EDGE_MIN,
  GENERATION_LONG_EDGE_MAX,
  GENERATION_SIZE_LARGE_MIN,
  GENERATION_SIZE_XLARGE_MIN,
  ratioFromDimensions,
  normalizeRatio,
  clampLongEdge,
  deriveGenerationSize,
  longEdgeOf,
  sizeWarningTier,
  stepLongEdge,
} from "../services/generation-size.mjs";

const RATIO = { "16:9": 9 / 16, "4:3": 3 / 4, "3:4": 4 / 3, "1:1": 1 };

test("尺寸：长边 + 比例派生宽高（§4 的四个比例逐条对照）", () => {
  // 16:9 横图 → 长边是宽
  assert.deepEqual(deriveGenerationSize(500, RATIO["16:9"]), { longEdge: 500, width: 500, height: 281 });
  // 4:3 横图：题目给的三个样例
  assert.deepEqual(deriveGenerationSize(104, RATIO["4:3"]), { longEdge: 104, width: 104, height: 78 });
  assert.deepEqual(deriveGenerationSize(200, RATIO["4:3"]), { longEdge: 200, width: 200, height: 150 });
  assert.deepEqual(deriveGenerationSize(500, RATIO["4:3"]), { longEdge: 500, width: 500, height: 375 });
  // 3:4 竖图 → 长边是高
  assert.deepEqual(deriveGenerationSize(500, RATIO["3:4"]), { longEdge: 500, width: 375, height: 500 });
  // 方图
  assert.deepEqual(deriveGenerationSize(500, RATIO["1:1"]), { longEdge: 500, width: 500, height: 500 });
});

test("尺寸：500 on 4:3 必须 = 500×375，绝不能是 500×500", () => {
  const size = deriveGenerationSize(500, RATIO["4:3"]);
  assert.equal(size.width, 500);
  assert.equal(size.height, 375);
  assert.notDeepEqual(size, { longEdge: 500, width: 500, height: 500 });
});

test("尺寸：比例不可用时返回 null，而不是静默方图", () => {
  // 这是本模块存在的唯一理由。任何「拿 width 兜底」的写法都会让下面全部变红。
  for (const ratio of [null, undefined, 0, -1, NaN, Infinity, "abc"]) {
    assert.equal(deriveGenerationSize(500, ratio), null, `ratio=${String(ratio)} 时必须 unresolved`);
  }
  // 长边本身不可用也是 unresolved
  for (const edge of [null, undefined, "", NaN, "abc"]) {
    assert.equal(deriveGenerationSize(edge, RATIO["4:3"]), null, `longEdge=${String(edge)} 时必须 unresolved`);
  }
  assert.notDeepEqual(deriveGenerationSize(500, null), { longEdge: 500, width: 500, height: 500 });
});

test("尺寸：ratioFromDimensions 对非正数 / 非有限值一律返回 null", () => {
  assert.equal(ratioFromDimensions(800, 400), 0.5);
  assert.equal(ratioFromDimensions(400, 800), 2);
  for (const [w, h] of [[0, 100], [100, 0], [-1, 100], [100, -1], [NaN, 100], [100, NaN], [undefined, 100], ["", 100]]) {
    assert.equal(ratioFromDimensions(w, h), null, `(${String(w)},${String(h)}) 必须 null`);
  }
});

test("尺寸：normalizeRatio 只接受正有限数", () => {
  assert.equal(normalizeRatio(0.5), 0.5);
  assert.equal(normalizeRatio("0.5"), 0.5);
  for (const value of [null, undefined, 0, -0.5, NaN, Infinity, -Infinity, ""]) {
    assert.equal(normalizeRatio(value), null, `${String(value)} 必须 null`);
  }
});

test("尺寸：clampLongEdge 取整并夹在 10–500，非数字返回 null", () => {
  assert.equal(clampLongEdge(104), 104);
  assert.equal(clampLongEdge(104.6), 105);
  assert.equal(clampLongEdge(1), GENERATION_LONG_EDGE_MIN);
  assert.equal(clampLongEdge(9999), GENERATION_LONG_EDGE_MAX);
  for (const value of [null, undefined, "", NaN, "abc"]) {
    assert.equal(clampLongEdge(value), null, `${String(value)} 必须 null`);
  }
});

test("尺寸：派生结果始终夹在 10–500，不会溢出", () => {
  // 极扁的图：1000:1，长边 500 时短边会小于下限
  const flat = deriveGenerationSize(500, 1 / 1000);
  assert.equal(flat.width, 500);
  assert.equal(flat.height, GENERATION_LONG_EDGE_MIN);
  // 极瘦的图同理
  const thin = deriveGenerationSize(500, 1000);
  assert.equal(thin.height, 500);
  assert.equal(thin.width, GENERATION_LONG_EDGE_MIN);
});

test("尺寸：longEdgeOf 取长边并夹紧", () => {
  assert.equal(longEdgeOf(104, 78), 104);
  assert.equal(longEdgeOf(78, 104), 104);
  assert.equal(longEdgeOf(1, 1), GENERATION_LONG_EDGE_MIN);
  assert.equal(longEdgeOf(900, 900), GENERATION_LONG_EDGE_MAX);
  for (const [w, h] of [[0, 10], [10, 0], [NaN, 10], [10, undefined]]) {
    assert.equal(longEdgeOf(w, h), null, `(${String(w)},${String(h)}) 必须 null`);
  }
});

test("尺寸：分档边界 ≤104 普通 / 105–300 普通 / 301–400 large / >400 xlarge（§8）", () => {
  assert.equal(GENERATION_SIZE_LARGE_MIN, 301);
  assert.equal(GENERATION_SIZE_XLARGE_MIN, 401);
  assert.equal(sizeWarningTier(104), "normal");
  assert.equal(sizeWarningTier(105), "normal");
  assert.equal(sizeWarningTier(300), "normal");
  assert.equal(sizeWarningTier(301), "large");
  assert.equal(sizeWarningTier(400), "large");
  assert.equal(sizeWarningTier(401), "xlarge");
  assert.equal(sizeWarningTier(500), "xlarge");
  assert.equal(sizeWarningTier(null), "normal", "长边缺失不该弹大尺寸警告");
});

test("尺寸：stepLongEdge 步进并夹紧（滚轮 / 方向键共用）", () => {
  assert.equal(stepLongEdge(104, 1), 105);
  assert.equal(stepLongEdge(104, -1), 103);
  assert.equal(stepLongEdge(104, 10), 114);
  assert.equal(stepLongEdge(104, -10), 94);
  assert.equal(stepLongEdge(10, -1), GENERATION_LONG_EDGE_MIN);
  assert.equal(stepLongEdge(500, 1), GENERATION_LONG_EDGE_MAX);
  // 非法步长当 0 处理，不产生 NaN
  assert.equal(stepLongEdge(104, NaN), 104);
  assert.equal(stepLongEdge(104, undefined), 104);
  // 起点不可用时从下限起步（再叠加步长）
  assert.equal(stepLongEdge(null, 0), GENERATION_LONG_EDGE_MIN);
  assert.equal(stepLongEdge(null, 1), GENERATION_LONG_EDGE_MIN + 1);
  assert.equal(stepLongEdge(null, -1), GENERATION_LONG_EDGE_MIN);
});
