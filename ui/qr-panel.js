/**
 * 二维码素材面板（右栏「编辑」里的一块）
 *
 * 结构照 text-panel：上半是「二维码图层」列表（当前编辑的带「编辑中」标记），
 * 下半是「编辑二维码素材」表单 —— 内容 / 纠错等级 / 每模块豆数 / 静默区 /
 * 浅色区落法 / 深色与浅色色号 / 位置 / 可扫性诊断 / 删除 / 锁定并导出。
 *
 * ── 与文字面板的两处刻意不同 ────────────────────────────────────────
 *  1. **不提供「向下合并」。** 文字合并进底版是常见需求（文字要跟图案融为一体）；
 *     二维码一旦烧进底版就再也不能改内容了，而二维码的内容恰恰是最需要改的
 *     （链接换了、活动结束了）。锁定图层本来就会进导出，效果等同合并，
 *     所以少这一个入口，就少一种「改不了又退不回去」的处境。
 *  2. **色号给全色板，不给「图纸已用色」。** 文字面板只列图纸已用的色（保持画面统一），
 *     但二维码要的是**高对比**：图纸已用色里很可能没有合适的深色或浅色，
 *     从那里选会得到「对比度不足」的诊断。所以这里列全色板，让用户能选到真正的黑与白。
 *
 * 关键约束同文字面板：**内容是受控输入，而 paint() 会在每次状态变化时重跑 render()**。
 * 每次都重建 DOM 的话，用户每敲一个字光标就丢一次。所以分两步：
 *   · build() 只在「图层集合 / 当前图层 / 色板规模」这类**结构**变化时重建；
 *   · sync() 负责回灌数值，且**跳过正在聚焦的控件**。
 */
import {
  QR_ECC_LEVELS, QR_QUIET_MODULES, QR_QUIET_MAX, QR_MIN_MODULE_BEADS, qrLayerLabel,
} from "../services/qr-layer-service.js?v=20261015-qr-1";
import { paletteIdOf } from "../services/palette-identity.js";
import { colorLabelInk } from "./color-label.mjs";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

const colorHex = (color) => color?.hex || (color?.rgb ? `#${color.rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}` : "");

/** 深/浅色号的色块标签。找不到色号时按 hex 就近找，都没有就显示「未选色」。 */
function qrColorLabel(roleHex, rolePaletteId, palette) {
  const list = palette || [];
  const color = list.find((item) => rolePaletteId && paletteIdOf(item) === rolePaletteId)
    || list.find((item) => roleHex && colorHex(item).toLowerCase() === String(roleHex).toLowerCase());
  const css = colorHex(color) || roleHex || "transparent";
  const text = color ? color.code : (roleHex || "未选色");
  return `<span class="ws-inline-color" style="background:${esc(css)};color:${colorLabelInk(color)};display:inline-block;padding:2px 5px;border:1px solid #0002;border-radius:3px">${esc(text)}</span>`;
}

const qrLayerMetadata = (layer, palette) => [
  esc(layer.ecc || "H"),
  `${Math.max(0, Math.round(Number(layer.beadPerModule) || 0)) === 0 ? "自动" : `${Math.round(Number(layer.beadPerModule))} 格/模块`}`,
  `深 ${qrColorLabel(layer.darkHex, layer.darkPaletteId, palette)} / 浅 ${qrColorLabel(layer.lightHex, layer.lightPaletteId, palette)}`,
  `(${Math.round(layer.x)}, ${Math.round(layer.y)})`,
].join(" · ");

/** 把诊断结果写成面板上的读数。全部字段来自 qrDiagnostics，面板只做排版。 */
function diagnosticsHtml(diag) {
  if (!diag) return "—";
  if (diag.error) return `<p class="ws-qr-diagnostic-error">${esc(diag.error)}</p>`;
  const layout = diag.layout;
  const rows = [
    ["二维码", `${diag.moduleCount} × ${diag.moduleCount} 模块（版本 ${diag.version}）· 纠错 ${esc(diag.ecc)}`],
    ["每模块", layout ? `${layout.beadPerModule} 格 · 整码 ${layout.totalModules} × ${layout.totalModules} 格 · 占 ${layout.spanCells} × ${layout.spanCells} 格` : "—"],
    ["落豆", `${diag.darkBeads.toLocaleString("zh-CN")} 深 + ${diag.lightBeads.toLocaleString("zh-CN")} 浅 = <b>${diag.beadCount.toLocaleString("zh-CN")}</b> 颗`],
    ["对比度", diag.contrast.ratio == null ? esc(diag.contrast.reason) : `${diag.contrast.ratio}:1 ${diag.contrast.ok ? "达标" : '<b class="ws-qr-bad">不达标</b>'}`],
    ["图纸容量", `最多 ${diag.capacity} 模块（当前用 ${diag.moduleCount}）`],
  ];
  const warnings = diag.warnings.length
    ? `<ul class="ws-qr-warnings">${diag.warnings.map((item) => `<li>${esc(item)}</li>`).join("")}</ul>`
    : "";
  return `<dl class="ws-qr-readout">${rows.map(([key, value]) => `<div><dt>${esc(key)}</dt><dd>${value}</dd></div>`).join("")}</dl>${warnings}`;
}

export class QrPanel {
  constructor({ root, onAdd = () => {}, onPatch = () => {}, onSelect = () => {}, onDelete = () => {} }) {
    this.root = typeof root === "string" ? document.querySelector(root) : root;
    if (!this.root) throw new Error("QrPanel: root element not found.");
    this.onAdd = onAdd;
    this.onPatch = onPatch;
    this.onSelect = onSelect;
    this.onDelete = onDelete;
    this._signature = null;
    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-qr-action]")?.dataset.qrAction;
      if (action === "add") { this.onAdd(); return; }
      if (action === "delete-object") { this.onDelete(event.target.closest("[data-qr-layer]")?.dataset.qrLayer); return; }
      if (action === "delete") { this.onDelete(this._activeId); return; }
      if (action === "toggle-lock") { this.onPatch(this._activeId, { locked: !Boolean(this._activeLayer?.locked) }); return; }
      const row = event.target.closest("[data-qr-layer]");
      if (row) { this.onSelect(row.dataset.qrLayer); return; }
    });
    this.root.addEventListener("input", (event) => {
      const target = event.target;
      if (target.id === "ws-qr-content") { this.onPatch(this._activeId, { text: target.value }); return; }
      if (target.id === "ws-qr-bead-per-module") {
        const value = Number(target.value);
        if (Number.isFinite(value)) this.onPatch(this._activeId, { beadPerModule: Math.max(0, Math.min(40, Math.round(value))) });
        return;
      }
      if (target.id === "ws-qr-quiet") {
        const value = Number(target.value);
        if (Number.isFinite(value)) this.onPatch(this._activeId, { quietModules: Math.max(0, Math.min(QR_QUIET_MAX, Math.round(value))) });
        return;
      }
      // 位置必须是整数格：小数位置会让模块边界错到半格，二维码就扫不出来了。
      // 这里不"容忍"小数，输入即取整 —— 硬约束写在输入层，而不是等栅格化那步兜底。
      if (target.id === "ws-qr-x" || target.id === "ws-qr-y") {
        const value = Number(target.value);
        if (Number.isFinite(value)) this.onPatch(this._activeId, { [target.id === "ws-qr-x" ? "x" : "y"]: Math.round(value) });
        return;
      }
    });
    this.root.addEventListener("change", (event) => {
      const target = event.target;
      if (target.id === "ws-qr-ecc") { this.onPatch(this._activeId, { ecc: target.value }); return; }
      if (target.id === "ws-qr-light-mode") { this.onPatch(this._activeId, { lightMode: target.value }); return; }
      if (target.matches("[data-qr-palette-role]")) {
        const color = this._palette.find((item) => paletteIdOf(item) === target.value);
        if (!color) { this.onPatch(this._activeId, target.dataset.qrPaletteRole === "dark"
          ? { darkPaletteId: "", darkHex: "" }
          : { lightPaletteId: "", lightHex: "" }); return; }
        const role = target.dataset.qrPaletteRole;
        this.onPatch(this._activeId, role === "dark"
          ? { darkPaletteId: paletteIdOf(color), darkHex: colorHex(color) }
          : { lightPaletteId: paletteIdOf(color), lightHex: colorHex(color) });
      }
    });
  }

  render(view) {
    this._palette = view.palette || [];
    const layers = view.layers || [];
    const activeId = view.activeId || null;
    this._activeId = activeId;
    this._activeLayer = layers.find((layer) => layer.id === activeId) || null;
    // 结构签名：图层集合、当前图层、色板内容。任一变化才重建 DOM。
    // 色板按「色号序列」入签名（不是长度）：换品牌后长度常常不变，只看长度会让
    // 色块停在旧品牌上，点下去却是新品牌的色号。
    const signature = `${layers.map((layer) => `${layer.id}:${Boolean(layer.locked)}`).join(",")}|${activeId}|${(view.palette || []).map(paletteIdOf).join(",")}`;
    if (signature !== this._signature) { this._signature = signature; this.build(view); }
    this.sync(view);
  }

  build(view) {
    const layers = view.layers || [];
    const active = layers.find((layer) => layer.id === view.activeId) || null;
    const palette = view.palette || [];
    const picker = (role, label) => `<select id="ws-qr-${role}-color" data-qr-palette-role="${role}" aria-label="${label}"><option value="">选择色号</option>${palette.map((color) => `<option value="${esc(paletteIdOf(color))}">${esc(color.code)}</option>`).join("")}</select>`;

    this.root.innerHTML = `
      <div class="ws-qr-layers">
        <div class="ws-qr-layers-head">二维码图层 <b>(${layers.length})</b></div>
        ${layers.length
          ? layers.map((layer, index) => `<div class="ws-qr-layer${layer.id === view.activeId ? " is-active" : ""}" data-qr-layer="${esc(layer.id)}" role="button" tabindex="0">
              <span class="ws-qr-layer-name">${esc(qrLayerLabel(layer, index))}</span>
              <button type="button" class="ws-qr-object-delete" data-qr-action="delete-object" aria-label="删除二维码 ${esc(qrLayerLabel(layer, index))}" title="删除二维码">×</button>
              <small class="ws-qr-layer-metadata">${qrLayerMetadata(layer, palette)}</small>
              ${layer.id === view.activeId ? '<span class="ws-qr-layer-badge">编辑中</span>' : ""}
            </div>`).join("")
          : '<p class="ws-note">还没有二维码。点击「添加二维码」创建；画布上点击已有二维码可选中并拖动。</p>'}
        <button type="button" class="ws-button ws-wide" data-qr-action="add">+ 添加二维码</button>
      </div>
      ${active ? `
      <div class="ws-qr-editor">
        <div class="ws-section-title">编辑二维码素材</div>
        <label class="ws-field">二维码内容<textarea id="ws-qr-content" rows="3" maxlength="1200" placeholder="链接、文本或数字，扫码即得">${esc(active.text)}</textarea></label>
        <div class="ws-qr-pair">
          <label class="ws-field">纠错等级<select id="ws-qr-ecc">${QR_ECC_LEVELS.map((level) => `<option value="${esc(level.id)}"${level.id === active.ecc ? " selected" : ""}>${esc(level.label)}</option>`).join("")}</select></label>
          <label class="ws-field">每模块豆数<input id="ws-qr-bead-per-module" type="number" min="0" max="40" step="1" value="${Math.max(0, Math.round(Number(active.beadPerModule) || 0))}" aria-label="每个模块占几颗豆，0 为自动"></label>
        </div>
        <div class="ws-qr-pair">
          <label class="ws-field">静默区（模块）<input id="ws-qr-quiet" type="number" min="0" max="${QR_QUIET_MAX}" step="1" value="${Math.max(0, Math.min(QR_QUIET_MAX, Math.round(Number(active.quietModules) || 0)))}" aria-label="二维码四周留白宽度，规范要求 ${QR_QUIET_MODULES} 模块"></label>
          <label class="ws-field">浅色区<select id="ws-qr-light-mode"><option value="bead"${active.lightMode !== "empty" ? " selected" : ""}>铺浅色豆</option><option value="empty"${active.lightMode === "empty" ? " selected" : ""}>留空</option></select></label>
        </div>
        <div class="ws-qr-pair">
          <label class="ws-field">深色模块${picker("dark", "深色模块色号")}</label>
          <label class="ws-field">浅色模块${picker("light", "浅色模块色号")}</label>
        </div>
        <div class="ws-selection-actions">
          <label>位置 X<input id="ws-qr-x" type="number" step="1" value="${Math.round(Number(active.x) || 0)}"></label>
          <label>位置 Y<input id="ws-qr-y" type="number" step="1" value="${Math.round(Number(active.y) || 0)}"></label>
        </div>
        <div class="ws-readout" id="ws-qr-diagnostics">—</div>
        <div class="ws-qr-actions">
          <button type="button" class="ws-button ws-qr-delete" data-qr-action="delete">删除图层</button>
          <button type="button" class="ws-button ws-button-primary" data-qr-action="toggle-lock">${active.locked ? "🔒 已锁定 · 点击解锁" : "🔓 锁定并导出为豆格"}</button>
        </div>
        <p class="ws-note">二维码保持独立图层。锁定后作为豆格叠加到导出，不改底版；解锁后可继续改内容、纠错等级和配色。位置按整数格吸附 —— 模块边界必须落在格边界上，否则扫不出来。</p>
      </div>` : ""}
    `;
    if (active?.locked) {
      this.root.querySelectorAll(".ws-qr-editor input,.ws-qr-editor textarea,.ws-qr-editor select,.ws-qr-editor button").forEach((control) => {
        if (control.dataset.qrAction !== "toggle-lock" && control.dataset.qrAction !== "delete") control.disabled = true;
      });
    }
  }

  find(selector) { return this.root.querySelector(selector); }
  findAll(selector) { return [...this.root.querySelectorAll(selector)]; }

  sync(view) {
    const layers = view.layers || [];
    const active = layers.find((layer) => layer.id === view.activeId) || null;
    // 图层标题随输入实时变（但不重建 DOM，否则光标会丢）。
    this.root.querySelectorAll("[data-qr-layer]").forEach((row, index) => {
      const layer = layers[index];
      if (!layer) return;
      const name = row.querySelector(".ws-qr-layer-name");
      const label = qrLayerLabel(layer, index);
      if (name && name.textContent !== label) name.textContent = label;
      const metadata = row.querySelector(".ws-qr-layer-metadata");
      if (metadata) metadata.innerHTML = qrLayerMetadata(layer, view.palette || []);
    });
    if (!active) return;
    const focused = document.activeElement;
    const setValue = (id, value) => {
      const element = this.find(`#${id}`);
      if (element && element !== focused) element.value = String(value);
    };
    setValue("ws-qr-content", active.text);
    setValue("ws-qr-ecc", active.ecc);
    setValue("ws-qr-bead-per-module", Math.max(0, Math.round(Number(active.beadPerModule) || 0)));
    setValue("ws-qr-quiet", Math.max(0, Math.min(QR_QUIET_MAX, Math.round(Number(active.quietModules) || 0))));
    setValue("ws-qr-light-mode", active.lightMode === "empty" ? "empty" : "bead");
    setValue("ws-qr-x", Math.round(Number(active.x) || 0));
    setValue("ws-qr-y", Math.round(Number(active.y) || 0));
    const palette = view.palette || [];
    this.findAll("[data-qr-palette-role]").forEach((control) => {
      if (control === focused) return;
      const role = control.dataset.qrPaletteRole;
      const identity = role === "dark" ? active.darkPaletteId : active.lightPaletteId;
      const hex = role === "dark" ? active.darkHex : active.lightHex;
      const color = palette.find((item) => identity && paletteIdOf(item) === identity)
        || palette.find((item) => hex && colorHex(item).toLowerCase() === String(hex).toLowerCase());
      control.value = color ? paletteIdOf(color) : "";
    });
    const readout = this.find("#ws-qr-diagnostics");
    if (readout) readout.innerHTML = diagnosticsHtml(view.diagnostics);
  }
}
