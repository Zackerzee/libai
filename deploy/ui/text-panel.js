/**
 * 文字素材面板（右栏「编辑」里的一块）
 *
 * 结构照参考稿：上半是「浮动图层」列表（当前编辑的那个带「编辑中」标记），
 * 下半是「编辑文字素材」表单 —— 文字内容 / 选用字体 / 贴纸颜色 / 加粗倾斜 /
 * 字号缩放 / 旋转方向 / 删除 / 向下合并。
 *
 * 关键约束：**文字内容是个受控输入框，而 paint() 会在每次状态变化时重跑 render()**。
 * 如果每次都重建 DOM，用户每敲一个字光标就丢一次。所以这里分两步：
 *   · build() 只在「图层集合 / 当前图层 / 调色板规模」这类**结构**变化时重建；
 *   · sync() 负责回灌数值，且**跳过正在聚焦的控件**（输入框、滑块），
 *     否则拖滑块时会被自己的回灌顶回去。
 */
import { TEXT_FONTS, TEXT_SCALE_RANGE, layerLabel } from "../services/text-layer-service.js?v=20261013-text-palette-2";
import { paletteIdOf } from "../services/palette-identity.js";
import { colorLabelInk } from './color-label.mjs';

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export function textPaletteChoices(palette, grid) {
  const used = new Set((grid || []).flat().filter(Boolean).map(paletteIdOf));
  return (palette || []).filter(color => used.has(paletteIdOf(color)));
}
const colorHex = color => color.hex || `#${color.rgb.map(value => value.toString(16).padStart(2, '0')).join('')}`;

export function textLayerColorLabel(layer, palette) {
  const color = palette.find(item => layer.paletteId ? paletteIdOf(item) === layer.paletteId : item.code === layer.color);
  const css = color?.hex || (color?.rgb ? `rgb(${color.rgb.join(',')})` : 'transparent');
  return `<span class="ws-inline-color" ${color?`data-ws-color-pick="${esc(paletteIdOf(color))}"`:''} style="background:${esc(css)};color:${colorLabelInk(color)};display:inline-block;padding:2px 5px;border:1px solid #0002;border-radius:3px">${esc(color?.code || layer.color || '未选色')}</span>`;
}

const textLayerMetadata = (layer,palette) => `${esc(layer.fontFamily || layer.font || 'system')} · ${esc(layer.scale || 100)}% · ${Number(layer.rotation)||0}° · ${textLayerColorLabel(layer,palette)} · (${Math.round(layer.x)}, ${Math.round(layer.y)})`;

export class TextPanel {
  constructor({
    root,
    contextHost = null,
    onAdd = () => {},
    onPatch = () => {},
    onSelect = () => {},
    onDelete = () => {},
    onMerge = () => {},
    onUseCurrentColor = () => {},
    onAddCurrentColor = () => {},
    onLoadLocalFont = () => {},
    onColorTarget = () => {},
  }) {
    this.root = typeof root === "string" ? document.querySelector(root) : root;
    if (!this.root) throw new Error("TextPanel: root element not found.");
    this.contextHost = typeof contextHost === "string" ? document.querySelector(contextHost) : contextHost;
    this.onAdd = onAdd;
    this.onPatch = onPatch;
    this.onSelect = onSelect;
    this.onDelete = onDelete;
    this.onMerge = onMerge;
    this.onUseCurrentColor = onUseCurrentColor;
    this.onAddCurrentColor = onAddCurrentColor;
    this.onLoadLocalFont = onLoadLocalFont;
    this.onColorTarget = onColorTarget;
    this._signature = null;
    this.bindEvents();
    if (typeof window !== 'undefined') window.addEventListener('resize', () => this.layoutContextControls());
  }

  bindEvents() {
    for (const eventRoot of [this.root, this.contextHost].filter(Boolean)) {
    eventRoot.addEventListener("click", (event) => {
      const action = event.target.closest("[data-text-action]")?.dataset.textAction;
      if (action === "add") { this.onAdd(); return; }
      const colorTarget = event.target.closest('[data-text-color-target]');
      if (colorTarget) { this.onColorTarget(this._activeId, colorTarget.dataset.textColorTarget, Number(colorTarget.dataset.stopIndex || 0)); return; }
      if (action === 'add-gradient-stop' || action === 'remove-gradient-stop') {
        const stops = this.gradientStops(this._activeLayer);
        if (action === 'add-gradient-stop' && stops.length < 4) {
          const color = this._palette.find(item => !stops.some(stop => stop.paletteId === paletteIdOf(item))) || this._palette[0];
          if (color) stops.push({ paletteId: paletteIdOf(color), code: color.code, hex: colorHex(color) });
        }
        if (action === 'remove-gradient-stop' && stops.length > 2) stops.pop();
        this.onPatch(this._activeId, { gradientStops: stops }); return;
      }
      if (action === "delete-object") { this.onDelete(event.target.closest("[data-text-layer]")?.dataset.textLayer); return; }
      const layerRow = event.target.closest("[data-text-layer]");
      if (layerRow) { this.onSelect(layerRow.dataset.textLayer); return; }
      if (action === "delete") { this.onDelete(this._activeId); return; }
      if (action === "merge") { this.onMerge(this._activeId); return; }
      if (action === "use-current-color") { this.onUseCurrentColor(this._activeId); return; }
      if (action === "add-color") { this.onAddCurrentColor(); return; }
      if (action === "toggle-lock") { this.onPatch(this._activeId, { locked: !Boolean(this._activeLayer?.locked) }); return; }
      const swatch = event.target.closest("[data-text-color]");
      if (swatch) { this.onPatch(this._activeId, { color: swatch.dataset.textColor, paletteId: swatch.dataset.textPaletteId || "" }); return; }
      const toggle = event.target.closest("[data-text-toggle]");
      if (toggle) {
        const key = toggle.dataset.textToggle;
        this.onPatch(this._activeId, { [key]: !toggle.classList.contains("is-on") });
      }
    });
    eventRoot.addEventListener("input", (event) => {
      const target = event.target;
      if (target.id === "ws-text-content") { this.onPatch(this._activeId, { text: target.value }); return; }
      if (target.id === "ws-text-scale" || target.id === "ws-text-scale-number") {
        const value = Number(target.value);
        if (Number.isFinite(value)) this.onPatch(this._activeId, { scale: Math.max(TEXT_SCALE_RANGE.min, Math.min(TEXT_SCALE_RANGE.inputMax, value)) });
        return;
      }
      if (target.id === "ws-text-rotation" || target.id === "ws-text-rotation-number") {
        const value = Number(target.value);
        if (Number.isFinite(value)) this.onPatch(this._activeId, { rotation: Math.max(-360, Math.min(360, value)) });
        return;
      }
      if (target.id === "ws-text-spacing") { this.onPatch(this._activeId, { spacing: Number(target.value) }); return; }
      if (target.id === "ws-text-x") { this.onPatch(this._activeId, { x: Number(target.value) }); return; }
      if (target.id === "ws-text-y") { this.onPatch(this._activeId, { y: Number(target.value) }); return; }
      if (target.id === "ws-text-rotation-number") {
        const value = Number(target.value); if (Number.isFinite(value)) this.onPatch(this._activeId, { rotation: Math.max(-360, Math.min(360, value)) }); return;
      }
      if (target.matches("[data-text-style]") && target.type !== "checkbox") this.onPatch(this._activeId, { [target.dataset.textStyle]: target.type === "range" || target.type === "number" ? Number(target.value) : target.value });
    });
    eventRoot.addEventListener("change", (event) => {
      const target = event.target;
      if (target.matches('[data-text-palette-role]')) {
        const color = this._palette.find(item => paletteIdOf(item) === target.value);
        if (!color) return;
        const role = target.dataset.textPaletteRole;
        this.onPatch(this._activeId, role === 'text'
          ? { color: color.code, paletteId: paletteIdOf(color), textHex: "" }
          : { [`${role}Hex`]: colorHex(color), [`${role}PaletteId`]: paletteIdOf(color) });
        return;
      }
      if (target.id === "ws-text-font") this.onPatch(this._activeId, { font: target.value });
      if (target.id === "ws-text-writing-mode") this.onPatch(this._activeId, { writingMode: target.value });
      if (target.id === "ws-text-color-mode") this.onPatch(this._activeId, { colorMode: target.value });
      if (target.id === "ws-text-gradient-direction") this.onPatch(this._activeId, { gradientDirection: target.value });
      if (target.id === "ws-text-font-family") this.onPatch(this._activeId, { fontFamily: target.value.trim() });
      if (target.matches("[data-text-style][type=checkbox]")) this.onPatch(this._activeId, { [target.dataset.textStyle]: target.checked });
      if (target.id === "ws-text-local-font" && target.files?.[0]) this.onLoadLocalFont(this._activeId, target.files[0]);
    });
    }
  }

  render(view) {
    this._palette = view.palette || [];
    const layers = view.layers || [];
    const activeId = view.activeId || null;
    this._activeId = activeId;
    this._activeLayer = layers.find((layer) => layer.id === activeId) || null;
    // 结构签名：图层集合、当前图层、色卡内容、最近用色。任一变化才重建 DOM。
    // 色卡要按「色号序列」而不是「长度」入签名：换品牌后长度常常不变（都是 291 色），
    // 只看长度会让色块停在旧品牌上，点下去却是新品牌的色号。
    const signature = `${layers.map((layer) => `${layer.id}:${Boolean(layer.locked)}:${Boolean(layer.rasterGrid)}`).join(",")}|${activeId}|${this._activeLayer?.colorMode || 'solid'}:${this._activeLayer?.gradientStops?.length || 2}|${(view.palette || []).map(paletteIdOf).join(",")}`;
    if (signature !== this._signature) { this._signature = signature; this.build(view); }
    this.sync(view);
  }

  build(view) {
    this.contextHost?.querySelectorAll("[data-text-context-control]").forEach(control => control.remove());
    const layers = view.layers || [];
    const active = layers.find((layer) => layer.id === view.activeId) || null;
    const palette = view.palette || [];
    const picker = (role, label, stopIndex) => `<button type="button" class="ws-button ws-text-color-target" data-text-color-target="${role}"${stopIndex === undefined ? '' : ` data-stop-index="${stopIndex}"`} title="${label}：点击后在左侧色卡选色" aria-label="${label}：在左侧色卡选色">${label}</button>`;

    this.root.innerHTML = `
      <div class="ws-text-layers">
        <div class="ws-text-layers-head">浮动图层 <b>(${layers.length})</b></div>
        ${layers.length
          ? layers.map((layer, index) => `<div class="ws-text-layer${layer.id === view.activeId ? " is-active" : ""}" data-text-layer="${esc(layer.id)}" role="button" tabindex="0">
              <span class="ws-text-layer-name">${esc(layerLabel(layer, index))}</span>
              <button type="button" class="ws-text-object-delete" data-text-action="delete-object" aria-label="删除文字 ${esc(layerLabel(layer,index))}" title="删除文字">×</button>
              <small class="ws-text-layer-metadata">${textLayerMetadata(layer,palette)}</small>
              ${layer.id === view.activeId ? '<span class="ws-text-layer-badge">编辑中</span>' : ""}
            </div>`).join("")
          : '<p class="ws-note">还没有文字对象。点击「添加文字」创建；画布上点击已有文字可选中并拖动。</p>'}
        <button type="button" class="ws-button ws-wide" data-text-action="add">+ 添加文字</button>
      </div>
      ${active ? `
      <div class="ws-text-editor">
        <div class="ws-section-title">创意工具</div>
        <label class="ws-field">文字内容<textarea id="ws-text-content" maxlength="240" rows="3" placeholder="支持换行，输入多行文字">${esc(active.text)}</textarea></label>
        <div class="ws-text-font-row"><label class="ws-field">字体<select id="ws-text-font">${[...TEXT_FONTS, {id:'pixel-5x7',label:'像素字 5×7'}, {id:'pixel-3x5',label:'像素字 3×5'}].filter((font,index,fonts) => fonts.findIndex(item => item.id === font.id) === index).map((font) => `<option value="${esc(font.id)}"${font.id === active.font ? " selected" : ""}>${esc(font.label)}</option>`).join("")}</select></label><label class="ws-button ws-text-font-load">读取本地字体<input id="ws-text-local-font" type="file" accept=".ttf,.otf,.woff,.woff2,font/ttf,font/otf,font/woff,font/woff2" aria-label="读取本地字体"></label></div>
        <label class="ws-field">自定义字体<input id="ws-text-font-family" type="text" value="${esc(active.fontFamily || "")}" placeholder="填写字体名称，或读取本地字体"></label>
        <label class="ws-field">排列方向<select id="ws-text-writing-mode"><option value="horizontal">横排</option><option value="vertical">竖排</option></select></label>
        <label class="ws-field">行间距<input type="number" data-text-style="lineHeight" min="0.5" max="4" step="0.1" value="${active.lineHeight ?? 1.2}" aria-label="文字行间距"></label>
        <label class="ws-field">文字配色<select id="ws-text-color-mode"><option value="solid">纯色</option><option value="gradient">渐变</option></select></label>
        ${active.colorMode === 'gradient' ? `<fieldset class="ws-text-effect-group"><legend>渐变色点 · 点击后在左侧选色</legend>${this.gradientStops(active).map((_, index) => picker('gradient', `色点 ${index + 1}`, index)).join('')}<button type="button" class="ws-button" data-text-action="add-gradient-stop"${this.gradientStops(active).length >= 4 ? ' disabled' : ''}>增加色点</button><button type="button" class="ws-button" data-text-action="remove-gradient-stop"${this.gradientStops(active).length <= 2 ? ' disabled' : ''}>减少色点</button><select id="ws-text-gradient-direction" aria-label="渐变方向"><option value="horizontal">横向渐变</option><option value="vertical">纵向渐变</option><option value="diagonal">斜向渐变</option></select></fieldset>` : ''}
        <div class="ws-text-style">
          <button type="button" class="ws-text-toggle" data-text-toggle="bold" aria-label="加粗"><b>B</b></button>
          <button type="button" class="ws-text-toggle" data-text-toggle="italic" aria-label="倾斜"><i>I</i></button>
          <label>文字色${picker('text', '文字颜色')}</label>
          <label>字号<input type="number" id="ws-text-scale-number" min="${TEXT_SCALE_RANGE.min}" max="${TEXT_SCALE_RANGE.inputMax}" step="1" value="${active.scale}" aria-label="文字字号缩放百分比"></label>
          <label><input type="checkbox" data-text-style="shadowEnabled"${active.shadowEnabled ? " checked" : ""}>字阴影</label>${picker('shadow', '阴影颜色')}
        </div>
        <label class="ws-field">旋转角度<input id="ws-text-rotation-number" type="number" min="-360" max="360" step="1" value="${Number(active.rotation) || 0}" aria-label="文字旋转角度"></label>
<fieldset class="ws-text-effect-group"><legend>底板填充</legend><label><input type="checkbox" data-text-style="backplateEnabled"${active.backplateEnabled ? " checked" : ""}>开启</label>${picker('backplate', '底板颜色')}<input type="range" data-text-style="backplateOpacity" min="0" max="100" value="${active.backplateOpacity ?? 100}" aria-label="底板透明度"><output>${active.backplateOpacity ?? 100}%</output></fieldset>
<fieldset class="ws-text-effect-group"><legend>底板边框</legend><select data-text-style="borderStyle"><option value="none"${active.borderStyle === "none" ? " selected" : ""}>无框</option><option value="solid"${active.borderStyle === "solid" ? " selected" : ""}>实线</option><option value="dashed"${active.borderStyle === "dashed" ? " selected" : ""}>虚线</option></select><input type="number" data-text-style="borderWidth" min="1" max="4" value="${active.borderWidth || 1}" aria-label="边框宽度">${picker('border', '边框颜色')}<input type="range" data-text-style="borderOpacity" min="0" max="100" value="${active.borderOpacity ?? 100}" aria-label="边框透明度"><output>${active.borderOpacity ?? 100}%</output></fieldset>
        <fieldset class="ws-text-effect-group"><legend>底板发光</legend><label><input type="checkbox" data-text-style="glowEnabled"${active.glowEnabled ? " checked" : ""}>开启</label>${picker('glow', '发光颜色')}<input type="range" data-text-style="glowStrength" min="1" max="4" value="${active.glowStrength || 1}" aria-label="发光强度"><output>${active.glowStrength || 1}</output></fieldset>
        <label class="ws-source-slider">字间距<span id="ws-text-spacing-value">${active.spacing || 0}</span><input id="ws-text-spacing" type="range" min="-2" max="8" step="1" value="${active.spacing || 0}"></label>
        <div class="ws-selection-actions"><label>位置 X<input id="ws-text-x" type="number" step="0.5" value="${active.x}"></label><label>位置 Y<input id="ws-text-y" type="number" step="0.5" value="${active.y}"></label></div>
        <div class="ws-readout" id="ws-text-impact">—</div>
        <div class="ws-text-actions">
          <button type="button" class="ws-button ws-text-delete" data-text-action="delete">删除图层</button>
          <button type="button" class="ws-button ws-button-primary" data-text-action="toggle-lock">${active.locked ? "🔒 已锁定 · 点击解锁" : "🔓 锁定并导出为豆格"}</button>
        </div>
        <p class="ws-note">文字保持独立图层。锁定后作为豆格叠加到导出，不改底版；解锁后可继续改字、字体和样式。支持多行与多个文字图层。</p>
      </div>` : ""}
    `;
    if (active?.locked) {
      this.root.querySelectorAll(".ws-text-editor input,.ws-text-editor textarea,.ws-text-editor select,.ws-text-editor button").forEach((control) => {
        if (control.dataset.textAction !== "toggle-lock" && control.dataset.textAction !== "delete") control.disabled = true;
      });
    }
    if (active?.rasterGrid) {
      this.root.querySelectorAll('#ws-text-content,#ws-text-font,#ws-text-local-font,#ws-text-font-family,#ws-text-spacing,#ws-text-writing-mode,#ws-text-color-mode,[data-text-style],[data-text-toggle],[data-text-color-target],#ws-text-gradient-direction,[data-text-action="add-gradient-stop"],[data-text-action="remove-gradient-stop"]').forEach(control => { control.disabled = true; });
    }
    this.layoutContextControls();
  }

  layoutContextControls() {
    if (!this.contextHost) return;
    const editor = this.root.querySelector('.ws-text-editor');
    if (!editor) return;
    const narrow = typeof window !== 'undefined' && window.innerWidth <= 760;
    for (const id of ['ws-text-content','ws-text-font','ws-text-local-font','ws-text-font-family','ws-text-spacing']) {
      const field = this.find(`#${id}`)?.closest('.ws-field,.ws-source-slider');
      if (!field) continue;
      if (!narrow || id === 'ws-text-content') {
        field.dataset.textContextControl = '';
        this.contextHost.append(field);
      } else {
        delete field.dataset.textContextControl;
        editor.insertBefore(field, editor.querySelector('.ws-text-label'));
      }
    }
  }

  find(selector) { return this.root.querySelector(selector) || this.contextHost?.querySelector(selector); }
  gradientStops(layer) {
    if (Array.isArray(layer?.gradientStops) && layer.gradientStops.length >= 2) return layer.gradientStops.slice(0, 4).map(stop => ({ ...stop }));
    const colors = (this._palette || []).slice(0, 2);
    if (colors.length === 1) colors.push(colors[0]);
    return colors.map(color => ({ paletteId: paletteIdOf(color), code: color.code, hex: colorHex(color) }));
  }
  findAll(selector) { return [...this.root.querySelectorAll(selector), ...(this.contextHost?.querySelectorAll(selector) || [])]; }

  sync(view) {
    const layers = view.layers || [];
    const active = layers.find((layer) => layer.id === view.activeId) || null;
    // 图层标题要随输入实时变（但不重建 DOM，否则光标会丢）。
    this.root.querySelectorAll("[data-text-layer]").forEach((row, index) => {
      const layer = layers[index];
      if (!layer) return;
      const name = row.querySelector(".ws-text-layer-name");
      const label = layerLabel(layer, index);
      if (name && name.textContent !== label) name.textContent = label;
      const metadata = row.querySelector('.ws-text-layer-metadata');
      if (metadata) metadata.innerHTML = textLayerMetadata(layer,view.palette || []);
    });
    if (!active) return;
    const focused = document.activeElement;
    const setValue = (id, value) => {
      const element = this.find(`#${id}`);
      if (element && element !== focused) element.value = String(value);
    };
    setValue("ws-text-content", active.text);
    setValue("ws-text-font", active.font);
    setValue("ws-text-writing-mode", active.writingMode || 'horizontal');
    setValue("ws-text-color-mode", active.colorMode || 'solid');
    setValue("ws-text-gradient-direction", active.gradientDirection || 'horizontal');
    setValue("ws-text-scale", active.scale);
    setValue("ws-text-scale-number", active.scale);
    setValue("ws-text-rotation", active.rotation || 0);
    setValue("ws-text-rotation-number", active.rotation || 0);
    setValue("ws-text-spacing", active.spacing || 0);
    setValue("ws-text-x", active.x);
    setValue("ws-text-y", active.y);
    setValue("ws-text-font-family", active.fontFamily || "");
    setValue("ws-text-scale-number", active.scale);
    const scaleValue = this.find("#ws-text-scale-value");
    if (scaleValue) scaleValue.textContent = `${active.scale}%`;
    const rotationValue = this.find("#ws-text-rotation-value");
    if (rotationValue) rotationValue.textContent = `${Number(active.rotation) || 0}°`;
    const spacingValue = this.find("#ws-text-spacing-value");
    if (spacingValue) spacingValue.textContent = String(active.spacing || 0);
    this.findAll("[data-text-toggle]").forEach((button) => {
      button.classList.toggle("is-on", Boolean(active[button.dataset.textToggle]));
      button.disabled = Boolean(active.locked || active.rasterGrid || ['pixel-5x7','pixel-3x5'].includes(active.font));
      button.title = ['pixel-5x7','pixel-3x5'].includes(active.font) ? '点阵字形固定，不支持加粗或倾斜' : '';
    });
    this.findAll("[data-text-style]").forEach((control) => {
      const value = active[control.dataset.textStyle];
      if (control.type === "checkbox") control.checked = Boolean(value);
      else if (control !== focused && value !== undefined) control.value = String(value);
    });
    this.findAll('[data-text-color-target]').forEach(control => {
      const role = control.dataset.textColorTarget;
      const stop = role === 'gradient' ? this.gradientStops(active)[Number(control.dataset.stopIndex)] : null;
      const identity = stop?.paletteId || (role === 'text' ? active.paletteId : active[`${role}PaletteId`]);
      const code = stop?.code || (role === 'text' ? active.color : '');
      const color = this._palette.find(item => paletteIdOf(item) === identity) || this._palette.find(item => item.code === code);
      const hex = color ? colorHex(color) : stop?.hex || active[`${role}Hex`] || 'transparent';
      control.innerHTML = `<span aria-hidden="true" style="display:inline-block;width:14px;height:14px;border:1px solid currentColor;background:${esc(hex)}"></span> ${esc(color?.code || code || '选色')}`;
    });
    this.findAll('[data-text-palette-role]').forEach(control => {
      if (control === focused) return;
      const role = control.dataset.textPaletteRole;
      const identity = role === 'text' ? active.paletteId : active[`${role}PaletteId`];
      const color = this._palette.find(item => paletteIdOf(item) === identity)
        || this._palette.find(item => role === 'text' ? item.code === active.color : colorHex(item).toLowerCase() === String(active[`${role}Hex`] || '').toLowerCase());
      control.value = color ? paletteIdOf(color) : '';
    });
    this.findAll("[data-text-color]").forEach((button) => {
      button.classList.toggle("is-on", button.dataset.textColor === active.color);
    });
    const impact = this.root.querySelector("#ws-text-impact");
    if (impact) {
      const count = Number(view.cells || 0);
      impact.textContent = count
        ? `当前文字将落 ${count.toLocaleString("zh-CN", { useGrouping: false })} 颗豆`
        : "当前文字落在图纸范围内没有豆格（试着缩小字号或拖回画布内）";
    }
  }
}
