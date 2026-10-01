import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createProjectStore } from "../state/project-store.js";
import { createGenerationService } from "../services/generation-service.js";

/**
 * B0 §5：Generation Size 与 Editor Canvas Resize 必须分离。
 *
 * 这两条链路共用过同一份 state，直接后果是「回写命名空间被当成入参读」：
 *   工作台挂载 → store.canvas = {104,104}
 *   → 自动生成 → generation-service 把 canvas 当 width/height 传下去
 *   → app.js 显式分支 state.generationLongEdge = max(104,104) = 104
 *   → 顶栏刚按像素倍数算出的 100 被静默丢弃，出图 104×78 而读数 100×75。
 *
 * 本文件同时钉住两侧：适配层不许再发明尺寸，bridge 的显式尺寸必须是一次性的。
 */

const ROOT = new URL("../", import.meta.url);
const read = (rel) => readFileSync(new URL(rel, ROOT), "utf8");

/**
 * 从签名起截到配对花括号，避免匹配到别处的同名调用。
 *
 * 注意：签名本身可能含花括号（`{ width, height } = {}` 这种解构参数），
 * 直接从签名起点数括号会停在参数表结束的位置，所以要跳过 `) {` 再开始数。
 */
function fnBody(source, signature) {
  const start = source.indexOf(signature);
  assert.notEqual(start, -1, `未找到函数：${signature}`);
  const open = source.indexOf(") {", start);
  assert.notEqual(open, -1, `${signature} 未找到函数体起点`);
  const bodyStart = open + 2;
  let depth = 0;
  for (let i = bodyStart; i < source.length; i += 1) {
    if (source[i] === "{") depth += 1;
    else if (source[i] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(bodyStart, i + 1);
    }
  }
  throw new Error(`${signature} 花括号不平衡`);
}

function makeBridge(size = { width: 100, height: 75 }) {
  const calls = [];
  return {
    calls,
    setProductionOptions() {},
    async generate(options) {
      calls.push(options);
      return { width: size.width, height: size.height, usedColors: 1, totalBeads: 1, paletteKey: "mard-221", colors: [] };
    },
    getResult() { return null; },
  };
}

test("canvas 快照不是生成入参：不显式给尺寸就一个 width/height 都不转发", async () => {
  const store = createProjectStore({ canvas: { width: 104, height: 104 }, palette: { maxColors: 38 } });
  const bridge = makeBridge();
  await createGenerationService(bridge, store).generate();
  assert.equal(bridge.calls.length, 1);
  assert.equal("width" in bridge.calls[0], false, "不得把 canvas.width 当生成入参");
  assert.equal("height" in bridge.calls[0], false, "不得把 canvas.height 当生成入参");
  assert.deepEqual(bridge.calls[0], { maxColors: 38, overwriteApproved: false });
});

test("canvas 里放什么值都改变不了转发内容（104×104 / 222×295 结果相同）", async () => {
  const forwarded = [];
  for (const canvas of [{ width: 104, height: 104 }, { width: 222, height: 295 }, { width: 50, height: 50 }]) {
    const store = createProjectStore({ canvas });
    const bridge = makeBridge();
    await createGenerationService(bridge, store).generate();
    forwarded.push(JSON.stringify(bridge.calls[0]));
  }
  assert.equal(new Set(forwarded).size, 1, `canvas 不应影响生成入参，实测：${forwarded.join(" / ")}`);
});

test("调用方显式给尺寸时原样转发（工具 / 测试直调通道保留）", async () => {
  const store = createProjectStore({ canvas: { width: 104, height: 104 } });
  const bridge = makeBridge({ width: 222, height: 295 });
  await createGenerationService(bridge, store).generate({ width: 222, height: 295 });
  assert.deepEqual(bridge.calls[0], { width: 222, height: 295, maxColors: 0, overwriteApproved: false });
});

test("只给一边时只转发那一边，不替另一边编造默认值", async () => {
  const store = createProjectStore({ canvas: { width: 104, height: 104 } });
  const bridge = makeBridge();
  await createGenerationService(bridge, store).generate({ width: 200 });
  assert.deepEqual(bridge.calls[0], { width: 200, maxColors: 0, overwriteApproved: false });
});

test("结果仍然回写 canvas（回写方向不能一起砍掉）", async () => {
  const store = createProjectStore({ canvas: { width: 104, height: 104 } });
  const bridge = makeBridge({ width: 100, height: 75 });
  const result = await createGenerationService(bridge, store).generate();
  assert.equal(result.width, 100);
  assert.equal(store.getState().canvas.width, 100);
  assert.equal(store.getState().canvas.height, 75);
  assert.equal(store.getState().status.hasPattern, true);
});

test("静态：generation-service 不再从 store.canvas 兜底尺寸", () => {
  const source = read("services/generation-service.js");
  assert.equal(source.includes("options.width ?? store.getState().canvas.width"), false);
  assert.equal(source.includes("options.height ?? store.getState().canvas.height"), false);
  assert.equal(/getState\(\)\.canvas\.width\s*[,;)]/.test(source.replace(/\/\/[^\n]*/g, "")), false,
    "canvas.width 只允许出现在回写位置，不得出现在读入参位置");
});

test("静态：bridge.generate 的显式尺寸是一次性覆盖，用完还原", () => {
  const source = read("app.js");
  const body = fnBody(source, "async generate({ width, height, maxColors, overwriteApproved = false } = {}) {");
  assert.ok(body.includes("const previousLongEdge"), "必须记录进入前的长边");
  assert.ok(body.includes("scopedLongEdge = Math.max(explicitWidth, explicitHeight)"), "显式尺寸取 max 当长边");
  assert.ok(body.includes("state.generationLongEdge = scopedLongEdge"), "本次调用内生效");
  assert.ok(body.includes("finally"), "还原必须走 finally，抛错也不能留下脏值");
  assert.ok(body.includes("Number(state.generationLongEdge) === scopedLongEdge"), "还原前要比对，别把用户新选的值倒回去");
  assert.ok(body.includes("state.generationLongEdge = previousLongEdge"), "必须还原");
  assert.equal(body.includes("state.generationLongEdge = Math.max(explicitWidth, explicitHeight)"), false,
    "旧写法会永久污染用户的长边选择");
});

test("静态：generation-service 转发的尺寸键来自 options，不来自 store", () => {
  const source = read("services/generation-service.js");
  const body = fnBody(source, "async generate(options = {}) {");
  assert.ok(body.includes("if (options.width != null) size.width = options.width;"));
  assert.ok(body.includes("if (options.height != null) size.height = options.height;"));
  assert.ok(body.includes("...size,"));
});
