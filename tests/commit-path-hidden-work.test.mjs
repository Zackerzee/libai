/**
 * Stage C0 §16 —— 「不为看不见的面板付按格数计费的钱」。
 *
 * ── 这条不变量为什么值得一个测试文件 ─────────────────────────────────────
 * §12 的提交路径 profile 里，`eventDispatch` 是 `libms:project-result` 的
 * **同步监听者**耗时（`ui/workspace.js` 的 handler → `store.setState` → `paint`）。
 * 这条路径上有若干处「重算」，它们的代价**按格数走**，而不是按面板数走。
 *
 * 最容易踩的形状是：`export-v2-service.js` 的 `grid()` 是**整幅深拷贝**
 *   getGrid().map(row => row.map(cell => cell ? {...cell, rgb:[...cell.rgb]} : null))
 * 而 `estimate()` 与 `split()` 内部都会调它。于是「读一个尺寸」「算一次分板」
 * 这种看起来是常数时间的操作，在 500×500（25 万格）上要克隆 25 万个对象。
 *
 * `paint()` 在一次提交里会被叫醒**多次**（store 订阅 + 若干次 setState），
 * 所以「每次都算」的写法会把这笔钱乘上倍数，而用户根本没在看那两个面板。
 *
 * 这个文件守三件事：
 *   ① `grid()` 确实是深拷贝（守卫的理由还在；哪天它变便宜了，这里会提示可以放宽）
 *   ② 导出抽屉关着时不算 estimate / split；开着时按 gridRevision 缓存
 *   ③ 材料面板不是当前 Tab 时提前返回，且**不写签名**（否则切回来是空面板）
 */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const workspace = readFileSync(new URL("../ui/workspace.js", import.meta.url), "utf8");
const exportV2 = readFileSync(new URL("../services/export-v2-service.js", import.meta.url), "utf8");

test("① exportV2 的 grid() 是整幅深拷贝 —— 这是两处守卫存在的理由", () => {
  // 逐字钉住那行；它一旦被改成「返回原引用」，下面的守卫就可以放宽，
  // 那时这个断言会红，提示来改的人「理由变了，去重新量一遍」。
  assert.match(
    exportV2,
    /const grid=\(\)=>getGrid\(\)\.map\(row=>row\.map\(cell=>cell\?\{\.\.\.cell,rgb:\[\.\.\.cell\.rgb\]\}:null\)\);/,
    "exportV2.grid() 的深拷贝形状变了 —— §16 的守卫理由需要重新评估",
  );
  // estimate 和 split 都必须经过它（否则上面的结论不成立）
  assert.match(exportV2, /estimate\(quality="ultra"\)\{const g=grid\(\)/);
  assert.match(exportV2, /split:\(\)=>splitPatternGrid\(grid\(\),104,104\)/);
});

test("② 导出抽屉关着时，estimate / split 一个都不算", () => {
  const at = workspace.indexOf("if (hasPattern && state.ui.exportDrawerOpen) {");
  assert.ok(at >= 0, "分板摘要必须在 `hasPattern && state.ui.exportDrawerOpen` 双条件下才算");
  // 取这一段到 `else if (!hasPattern)` 为止
  const end = workspace.indexOf("} else if (!hasPattern) {", at);
  assert.ok(end > at, "必须保留 !hasPattern 分支（清空读数）");
  const block = workspace.slice(at, end);
  assert.match(block, /exportV2\.estimate\(/, "estimate 必须在守卫内");
  assert.match(block, /exportV2\.split\(\)/, "split 必须在守卫内");
  // 反面：不许再出现「只要 hasPattern 就算」的老形状
  assert.doesNotMatch(
    workspace,
    /if \(hasPattern\) \{\s*\n\s*const estimate = exportV2\.estimate/,
    "老形状（`if (hasPattern)` 下无条件算 estimate/split）已经回来了",
  );
});

test("② 抽屉开着时按 gridRevision 缓存，不是每次 paint 都重算", () => {
  const at = workspace.indexOf("if (hasPattern && state.ui.exportDrawerOpen) {");
  const block = workspace.slice(at, workspace.indexOf("} else if (!hasPattern) {", at));
  assert.match(block, /const splitSignature = `\$\{gridRevision\}\|\$\{state\.canvas\.width\}x\$\{state\.canvas\.height\}`/);
  assert.match(block, /if \(splitSignature !== boardSplitSignature\) \{/);
  assert.match(block, /boardSplitCache = exportV2\.split\(\);/);
  assert.match(block, /const split = boardSplitCache;/);
  // 缓存变量必须在 paint 定义之前声明 —— 否则 paint 首跑会踩 `let` 的 TDZ。
  const declAt = workspace.indexOf("let boardSplitSignature = \"\";");
  const paintAt = workspace.indexOf("const paint = (state, patch = {}) => {");
  assert.ok(declAt >= 0, "找不到 boardSplitSignature 声明");
  assert.ok(paintAt > declAt, "boardSplitSignature 必须声明在 paint 定义之前（TDZ）");
});

test("③ 材料面板不是当前 Tab 时提前返回", () => {
  const fn = workspace.slice(
    workspace.indexOf("function renderMaterial(state) {"),
    workspace.indexOf("function renderPaletteDatalist()"),
  );
  assert.ok(fn.length > 200, "找不到 renderMaterial");
  assert.match(fn, /if \(state\.ui\.activePanel !== "material"\) return;/, "隐藏时必须提前返回");
  assert.match(fn, /exportV2\.split\(\)/, "分板口径仍然必须复用 exportV2.split()");
});

test("③ 可见性判断排在签名判断之前，且提前返回时不写签名", () => {
  const fn = workspace.slice(
    workspace.indexOf("function renderMaterial(state) {"),
    workspace.indexOf("function renderPaletteDatalist()"),
  );
  const guardAt = fn.indexOf('if (state.ui.activePanel !== "material") return;');
  const sigAt = fn.indexOf("if (signature === materialSignature) return;");
  assert.ok(guardAt >= 0, "找不到可见性守卫");
  assert.ok(sigAt > guardAt, "可见性判断必须排在签名判断之前");
  // 顺序反了会怎样：先判签名再判可见性 → 切 Tab 时签名已匹配，面板永远是空的。
  // 而如果在提前返回之前写 materialSignature，效果完全一样 —— 所以这里也要挡。
  assert.doesNotMatch(
    fn.slice(guardAt, sigAt),
    /materialSignature\s*=/,
    "提前返回之前不许写 materialSignature —— 那等于把「没算过」记成「算过了」",
  );
});

test("③ 反证：workspace 里 exportV2.split() 的真实调用点只有这两处，且都在守卫内", () => {
  // 必须先把注释剥掉再数 —— 上面几段 why 注释里就写着 `exportV2.split()`，
  // 拿整份源文件做正则会把注释里的名字当成调用点（这个文件自己踩过）。
  const code = workspace
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
  const hits = [...code.matchAll(/exportV2\.split\(\)/g)];
  assert.equal(hits.length, 2, `exportV2.split() 调用点数变了（${hits.length} 处）—— 新的调用点也必须问「用户看得见吗」`);
  for (const hit of hits) {
    // 往前找 2000 字符，必须能看见某个「看得见才做」的守卫
    const before = code.slice(Math.max(0, hit.index - 2000), hit.index);
    assert.match(
      before,
      /state\.ui\.exportDrawerOpen|state\.ui\.activePanel !== "material"/,
      "有一个 exportV2.split() 调用点不在可见性守卫内 —— 它会按格数计费地跑在提交路径上",
    );
  }
});
