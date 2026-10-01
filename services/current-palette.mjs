/**
 * 「当前颜色」的唯一真源（Stage B1 §6 / §7 / §8）。
 *
 * 为什么需要它 —— 这不是洁癖，是一处实测出来的真实缺陷：**同一个槽位被两个编辑器
 * 用两种类型写**。
 *
 * 工作台（ui/workspace.js）与旧编辑器（app.js 的 #editor-modal）读写「当前颜色」时，
 * 走的是两条路，最后落在同一个字段上：
 *
 *   workspace.js  store.setState({ editor: { selectedColor: "H5" } })
 *     → projectStore 适配器 WRITE.editor 把 selectedColor 路由到 paletteState.selectedColor
 *     → 写进去的是**字符串色号**
 *
 *   app.js:6187   state.selectedColor = cloneColor(color)
 *     → compat Proxy 同样路由到 paletteState.selectedColor
 *     → 写进去的是**完整颜色对象** {code,rgb,hex}
 *
 * 实测后果（旧编辑器侧，app.js:6087 / 6199）：
 *   · state.selectedColor 是字符串时，`state.selectedColor.code` === undefined，
 *     于是 syncEditorPalette() 判定「该色不在色板里」→ 打开旧编辑器就把工作台
 *     刚选的色**静默清成 null**；
 *   · updateCurrentSelection() 会把 "undefined" 当色号显示、并给色块刷一个非法颜色。
 *
 * 所以 B1 的做法不是「再多一个镜像」，而是让工作台**不再碰那个槽位**：
 *   · editorState.currentPaletteId —— 工作台自己的真源，存 paletteId 字符串；
 *   · editorState.selectedPaletteId —— 工作台侧的兼容镜像（只读兼容，只由本模块写）；
 *   · paletteState.selectedColor    —— 归还给旧编辑器，工作台一律不写、不读。
 *
 * 关于 paletteId 的形状（重要，别"顺手修好"）：
 *   生产网格的格子是 {code,rgb,hex}，**没有 paletteId 字段**（见
 *   services/generation-result-codec.mjs）。所以 paletteIdOf(cell) 会回落到 cell.code，
 *   于是工作台上的 paletteId 恒等于色号 code。这是既有契约，B1 不改数据模型 ——
 *   改成 `brand:code` 会破坏工程存档、撤销栈与全部既有用例。
 *   本模块只负责「谁说了算」，不负责改身份编码。
 */

import { paletteIdOf } from "./palette-identity.js";

/** 「未选色」的规范表示。§8：擦除沿用 null，不引入 "eraser" 之类的伪色号。 */
export const CURRENT_PALETTE_NONE = null;

/**
 * 读当前 paletteId。优先真源，迁移期兜底读镜像（只读，绝不写）。
 * 返回 null 表示未选色（＝橡皮擦语义）。
 */
export function readCurrentPaletteId(editor) {
  if (!editor || typeof editor !== "object") return CURRENT_PALETTE_NONE;
  for (const field of ["currentPaletteId", "selectedPaletteId"]) {
    const value = editor[field];
    if (value != null && String(value) !== "") return String(value);
  }
  return CURRENT_PALETTE_NONE;
}

/** 当前是否处于「未选色 / 橡皮擦」状态。 */
export function isEraseSelection(editor) {
  return readCurrentPaletteId(editor) === CURRENT_PALETTE_NONE;
}

/**
 * 用 paletteId 在色板里找条目。
 * 找不到返回 null —— **绝不按 RGB 反猜**（§7 明令禁止）。
 */
export function findPaletteColor(colors, paletteId) {
  if (paletteId == null || String(paletteId) === "") return null;
  const key = String(paletteId);
  const list = Array.isArray(colors) ? colors : [];
  return list.find((color) => paletteIdOf(color) === key) || null;
}

/**
 * 把 paletteId 解析成完整身份。
 * `color` 为 null 说明这个 paletteId 不在当前色板里（换品牌后旧选色就会这样）——
 * 调用方应据此提示或清空，而不是拿一个猜出来的颜色顶上。
 */
export function resolvePaletteIdentity(paletteId, colors) {
  const id = paletteId == null || String(paletteId) === "" ? CURRENT_PALETTE_NONE : String(paletteId);
  const color = findPaletteColor(colors, id);
  return { paletteId: id, color, code: color ? String(color.code) : null };
}

/**
 * 构造「设置当前颜色」的 patch。
 *
 * **这是唯一允许写 currentPaletteId / selectedPaletteId 的地方。**
 *
 * 只写工作台自己的两个字段：
 *   currentPaletteId   真源
 *   selectedPaletteId  兼容镜像（工作台侧读它，只读兼容）
 * **故意不写 selectedColor** —— 那是 paletteState 里旧编辑器的对象槽位，
 * 工作台写字符串进去会把它弄坏（见文件头）。
 *
 * 注意：patch 里**不能**顺手带上 `code` —— 它会被适配器写进 editorState，
 * 凭空多出一个谁也看不懂的字段。需要色号请自己调 resolvePaletteIdentity()。
 */
export function buildCurrentPalettePatch(paletteId, colors) {
  const { paletteId: id } = resolvePaletteIdentity(paletteId, colors);
  return { currentPaletteId: id, selectedPaletteId: id };
}

/**
 * 构造「激活一个颜色」的 patch：设当前色 + 同步高亮。
 *
 * 高亮用 paletteId 而不是 code —— 渲染层是
 * `editor.highlightedPaletteId || editor.highlightedColor`（canvas-renderer.js），
 * paletteId 分支优先。同时清掉 highlightedColor，避免两套高亮互相盖。
 */
export function buildActivateColorPatch(paletteId, colors, { highlight = true } = {}) {
  const { paletteId: id } = resolvePaletteIdentity(paletteId, colors);
  return {
    ...buildCurrentPalettePatch(id, colors),
    highlightedPaletteId: highlight && id != null ? id : null,
    highlightedColor: null,
  };
}

/**
 * 「清空当前颜色 + 清空高亮」的 patch。
 *
 * 给项目载入、清空选择、Esc 退出这类**纯归零**场景用。
 * 不查色板（零开销），语义明确：currentPaletteId = null 就是「未选色」，
 * 同时高亮也归零，避免留下指向旧色板的悬空高亮。
 * 同样**不碰 paletteState.selectedColor**（旧编辑器的槽位，归它自己管）。
 */
export function buildClearPalettePatch() {
  return {
    currentPaletteId: null,
    selectedPaletteId: null,
    highlightedPaletteId: null,
    highlightedColor: null,
  };
}

/**
 * 只切换「同色高亮」，不动当前颜色。
 * 对应 #ws-same-color-highlight 复选框：勾上＝高亮当前色，取消＝清空高亮。
 */
export function buildHighlightOnlyPatch(paletteId, { enabled = true } = {}) {
  const id = paletteId == null || String(paletteId) === "" ? null : String(paletteId);
  return {
    highlightedPaletteId: enabled && id != null ? id : null,
    highlightedColor: null,
  };
}
