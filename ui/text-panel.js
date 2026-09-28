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
import { TEXT_FONTS, TEXT_SCALE_RANGE, TEXT_ROTATION_RANGE, layerLabel } from "../services/text-layer-service.js?v=20260924-text";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

export class TextPanel {
  constructor({
    root,
    onAdd = () => {},
    onPatch = () => {},
    onSelect = () => {},
    onDelete = () => {},
    onMerge = () => {},
    onUseCurrentColor = () => {},
    onAddCurrentColor = () => {},
  }) {
    this.root = typeof root === "string" ? document.querySelector(root) : root;
    if (!this.root) throw new Error("TextPanel: root element not found.");
    this.onAdd = onAdd;
    this.onPatch = onPatch;
    this.onSelect = onSelect;
    this.onDelete = onDelete;
    this.onMerge = onMerge;
    this.onUseCurrentColor = onUseCurrentColor;
    this.onAddCurrentColor = onAddCurrentColor;
    this._signature = null;
    this.bindEvents();
  }

  bindEvents() {
    this.root.addEventListener("click", (event) => {
      const action = event.target.closest("[data-text-action]")?.dataset.textAction;
      if (action === "add") { this.onAdd(); return; }
      const layerRow = event.target.closest("[data-text-layer]");
      if (layerRow) { this.onSelect(layerRow.dataset.textLayer); return; }
      if (action === "delete") { this.onDelete(this._activeId); return; }
      if (action === "merge") { this.onMerge(this._activeId); return; }
      if (action === "use-current-color") { this.onUseCurrentColor(this._activeId); return; }
      if (action === "add-color") { this.onAddCurrentColor(); return; }
      const swatch = event.target.closest("[data-text-color]");
      if (swatch) { this.onPatch(this._activeId, { color: swatch.dataset.textColor }); return; }
      const toggle = event.target.closest("[data-text-toggle]");
      if (toggle) {
        const key = toggle.dataset.textToggle;
        this.onPatch(this._activeId, { [key]: !toggle.classList.contains("is-on") });
      }
    });
    this.root.addEventListener("input", (event) => {
      const target = event.target;
      if (target.id === "ws-text-content") { this.onPatch(this._activeId, { text: target.value }); return; }
      if (target.id === "ws-text-scale") { this.onPatch(this._activeId, { scale: Number(target.value) }); return; }
      if (target.id === "ws-text-rotation") { this.onPatch(this._activeId, { rotation: Number(target.value) }); return; }
    });
    this.root.addEventListener("change", (event) => {
      const target = event.target;
      if (target.id === "ws-text-font") this.onPatch(this._activeId, { font: target.value });
    });
  }

  render(view) {
    const layers = view.layers || [];
    const activeId = view.activeId || null;
    this._activeId = activeId;
    // 结构签名：图层集合、当前图层、色卡内容、最近用色。任一变化才重建 DOM。
    // 色卡要按「色号序列」而不是「长度」入签名：换品牌后长度常常不变（都是 291 色），
    // 只看长度会让色块停在旧品牌上，点下去却是新品牌的色号。
    const signature = `${layers.map((layer) => layer.id).join(",")}|${activeId}|${(view.palette || []).map((color) => color.code).join(",")}|${(view.recent || []).join(",")}`;
    if (signature !== this._signature) { this._signature = signature; this.build(view); }
    this.sync(view);
  }

  build(view) {
    const layers = view.layers || [];
    const active = layers.find((layer) => layer.id === view.activeId) || null;
    const palette = view.palette || [];
    const recent = (view.recent || []).length ? view.recent : palette.slice(0, 4).map((color) => color.code);
    const swatches = recent.map((code) => {
      const color = palette.find((item) => item.code === code);
      const hex = color?.hex || "#cccccc";
      return `<button type="button" class="ws-text-swatch" data-text-color="${esc(code)}" title="${esc(code)}" aria-label="文字颜色 ${esc(code)}"><i style="background:${esc(hex)}"></i><span>${esc(code)}</span></button>`;
    }).join("");

    this.root.innerHTML = `
      <div class="ws-text-layers">
        <div class="ws-text-layers-head">浮动图层 <b>(${layers.length})</b></div>
        ${layers.length
          ? layers.map((layer, index) => `<button type="button" class="ws-text-layer${layer.id === view.activeId ? " is-active" : ""}" data-text-layer="${esc(layer.id)}">
              <span class="ws-text-layer-name">${esc(layerLabel(layer, index))}</span>
              ${layer.id === view.activeId ? '<span class="ws-text-layer-badge">编辑中</span>' : ""}
            </button>`).join("")
          : '<p class="ws-note">还没有文字图层。用顶部「文字」工具在画布上点一下，或点下面的按钮。</p>'}
        <button type="button" class="ws-button ws-wide" data-text-action="add">+ 添加文字</button>
      </div>
      ${active ? `
      <div class="ws-text-editor">
        <div class="ws-section-title">编辑文字素材</div>
        <label class="ws-field">文字内容<input id="ws-text-content" type="text" maxlength="60" value="${esc(active.text)}" placeholder="输入要拼的文字"></label>
        <label class="ws-field">选用字体<select id="ws-text-font">${TEXT_FONTS.map((font) => `<option value="${esc(font.id)}"${font.id === active.font ? " selected" : ""}>${esc(font.label)}</option>`).join("")}</select></label>
        <div class="ws-text-label">贴纸颜色</div>
        <div class="ws-text-colors">
          <button type="button" class="ws-text-swatch ws-text-swatch-pick" data-text-action="use-current-color" title="用当前选中色（画布上右键可取色）" aria-label="用当前选中色">⌾</button>
          ${swatches}
          <button type="button" class="ws-text-swatch ws-text-swatch-add" data-text-action="add-color" title="把当前选中色加进来" aria-label="添加颜色">+</button>
        </div>
        <div class="ws-text-style">
          <button type="button" class="ws-text-toggle" data-text-toggle="bold" aria-label="加粗"><b>B</b></button>
          <button type="button" class="ws-text-toggle" data-text-toggle="italic" aria-label="倾斜"><i>I</i></button>
        </div>
        <label class="ws-source-slider">字号缩放<span id="ws-text-scale-value">${active.scale}%</span><input id="ws-text-scale" type="range" min="${TEXT_SCALE_RANGE.min}" max="${TEXT_SCALE_RANGE.max}" step="${TEXT_SCALE_RANGE.step}" value="${active.scale}"></label>
        <label class="ws-source-slider">旋转方向<span id="ws-text-rotation-value">${active.rotation}°</span><input id="ws-text-rotation" type="range" min="${TEXT_ROTATION_RANGE.min}" max="${TEXT_ROTATION_RANGE.max}" step="${TEXT_ROTATION_RANGE.step}" value="${active.rotation}"></label>
        <div class="ws-readout" id="ws-text-impact">—</div>
        <div class="ws-text-actions">
          <button type="button" class="ws-button ws-text-delete" data-text-action="delete">删除</button>
          <button type="button" class="ws-button ws-button-primary" data-text-action="merge">✓ 向下合并</button>
        </div>
        <p class="ws-note">在画布上拖动图层可移动位置；合并会写成真实豆格，可用撤销回退。</p>
      </div>` : ""}
    `;
  }

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
    });
    if (!active) return;
    const focused = document.activeElement;
    const setValue = (id, value) => {
      const element = this.root.querySelector(`#${id}`);
      if (element && element !== focused) element.value = String(value);
    };
    setValue("ws-text-content", active.text);
    setValue("ws-text-font", active.font);
    setValue("ws-text-scale", active.scale);
    setValue("ws-text-rotation", active.rotation);
    const scaleValue = this.root.querySelector("#ws-text-scale-value");
    if (scaleValue) scaleValue.textContent = `${active.scale}%`;
    const rotationValue = this.root.querySelector("#ws-text-rotation-value");
    if (rotationValue) rotationValue.textContent = `${active.rotation}°`;
    this.root.querySelectorAll("[data-text-toggle]").forEach((button) => {
      button.classList.toggle("is-on", Boolean(active[button.dataset.textToggle]));
    });
    this.root.querySelectorAll("[data-text-color]").forEach((button) => {
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
