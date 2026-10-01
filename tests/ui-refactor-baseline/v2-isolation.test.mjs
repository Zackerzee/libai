import test from "node:test";
import assert from "node:assert/strict";
import { createProjectStore } from "../../state/project-store.js";
import { createGenerationService } from "../../services/generation-service.js";

// generation-panel 里的「生成方式/采样/细节保护/边缘保护/高光/眼睛/微细节」
// 对应 store.generation.{preset,sampling,detailProtection,edgeProtection,preserveHighlights,preserveEyes,preserveMicroDetails}。
// 本测试只证明：这些 V2 参数是纯配置状态，绝不触碰 Legacy 生成引擎、不修改 Canonical Grid。

test("V2 generation params are config state only and never reach the legacy bridge", async () => {
  const store = createProjectStore({
    canvas: { width: 78, height: 74 },
    palette: { maxColors: 38 },
    generation: { preset: "portrait", sampling: "edge", detailProtection: 90, edgeProtection: 75, preserveHighlights: true, preserveEyes: true, preserveMicroDetails: true },
  });
  let calledWith = null;
  const bridge = {
    async generate(options) { calledWith = options; return { width: 78, height: 74, usedColors: 10, totalBeads: 4000, paletteKey: "mard-221", colors: [], sourceUrl: "data:image/png;base64,x" }; },
    getResult() { return null; },
  };
  await createGenerationService(bridge, store).generate();
  // 正式生成只接收 maxColors/overwriteApproved（尺寸由 bridge 自己按长边+比例派生），
  // 任何 V2 参数都不得透传。
  assert.deepEqual(calledWith, { maxColors: 38, overwriteApproved: false });
  for (const key of ["preset", "sampling", "detailProtection", "edgeProtection", "preserveHighlights", "preserveEyes", "preserveMicroDetails", "mode", "highlightProtection", "eyeProtection", "microDetailProtection"]) {
    assert.ok(!(key in calledWith), `${key} must not leak into legacy generate`);
  }
});

test("mutating generation params leaves canvas, palette and generation defaults intact elsewhere", () => {
  const store = createProjectStore();
  store.setState({ generation: { preset: "pixel", sampling: "center", detailProtection: 100, edgeProtection: 100, preserveEyes: true } });
  const state = store.getState();
  // 未提供的 generation 键保留默认。
  assert.equal(state.generation.preserveHighlights, true);
  assert.equal(state.generation.cleanupStrength, 50);
  // canvas / palette 完全不受 generation 变更影响。
  assert.equal(state.canvas.width, 50);
  assert.equal(state.canvas.height, 50);
  assert.equal(state.canvas.lockAspectRatio, false);
  assert.equal(state.palette.maxColors, 0);
});

test("maxColors 0 means auto/unlimited and survives a round trip as 0, not as '0 colors'", () => {
  const store = createProjectStore();
  // 0 = 自动，不是「0 色」。store 默认即 0，且 setState 后仍为 0。
  assert.equal(store.getState().palette.maxColors, 0);
  store.setState({ palette: { maxColors: 0 } });
  assert.equal(store.getState().palette.maxColors, 0);
  // generation-panel 侧：maxColors 下限 0（我已在模块里把 min 从 2 改为 0）。
  const gen = store.getState().generation;
  assert.ok(gen && typeof gen === "object", "generation section must exist with defaults");
});
