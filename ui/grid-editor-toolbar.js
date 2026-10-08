export const GRID_TOOLS = [
  { id: "select", label: "选择", shortcut: "V" },
  { id: "bead", label: "单豆", shortcut: "N" },
  { id: "text", label: "文字", shortcut: "T" },
  { id: "brush", label: "画笔", shortcut: "B" },
  { id: "eraser", label: "擦除", shortcut: "E" },
  { id: "fill", label: "填色", shortcut: "G" },
  { id: "line", label: "直线", shortcut: "L" },
  { id: "rect", label: "矩形", shortcut: "R" },
  { id: "ellipse", label: "圆形", shortcut: "C" },
  { id: "region", label: "框选", shortcut: "M" },
  { id: "lasso", label: "涂选", shortcut: "Q" },
  { id: "wand", label: "魔棒", shortcut: "W" },
  { id: "same", label: "同色", shortcut: "Y" },
  { id: "connected", label: "连通", shortcut: "U" },
  { id: "eyedropper", label: "取色", shortcut: "I" },
  { id: "source-eyedropper", label: "原图取色", shortcut: "" },
  { id: "pan", label: "移动", shortcut: "H" },
];

// 形状工具共用「拖动绘制」交互，画布层据此分流。
export const SHAPE_TOOLS = { line: "line", rect: "rect", ellipse: "ellipse" };
// 工具条主区顺序。取色紧跟画笔：右键画布取色后，左键即可用当前色画笔，
// 把取色放在画笔旁边让「取色 → 画」的来回最短。
export const PRIMARY_ORDER = ["brush", "eyedropper", "eraser", "fill", "line", "rect", "ellipse"];
// 顶栏「扩展」区：编辑/选择类工具（取色已在主区，不放这里避免重复）。
export const EXTENDED_TOOL_IDS = ["select", "bead", "text", "region", "lasso", "wand", "same", "connected", "pan", "source-eyedropper"];
// 笔宽固定为奇数格：偶数笔宽没有对称中心，实际落笔位置会偏移半格。
export const BRUSH_SIZES = [1, 3, 5, 7, 9];

// 功能说明面板的内容。键位必须与 workspace.js 的 keydown 处理器保持一致。
export const SHORTCUT_HELP = [
  { title: "工具", items: GRID_TOOLS.filter((tool) => tool.shortcut).map((tool) => [tool.shortcut, tool.label]) },
  { title: "画笔", items: [["[", "减小笔宽"], ["]", "增大笔宽"], ["Alt + 点击", "临时吸管，原工具保持不变"], ["右键", "吸取当前豆格颜色"]] },
  {
    title: "选区",
    items: [
      ["⌘/Ctrl + A", "全选"],
      ["⌘/Ctrl + I", "反选"],
      ["Delete / ⌫", "删除选区内容"],
      ["Esc", "取消选择"],
      ["方向键", "选区平移 1 格"],
      ["Shift + 方向键", "选区平移 5 格"],
    ],
  },
  { title: "剪贴板", items: [["⌘/Ctrl + C", "复制选区"], ["⌘/Ctrl + X", "剪切选区"], ["⌘/Ctrl + V", "粘贴到选区左上角"]] },
  { title: "形状", items: [["拖动", "从起点拖到终点绘制"], ["Shift", "约束为正方形 / 正圆 / 水平垂直直线"], ["实心开关", "描边与实心互相切换"]] },
  { title: "视图与历史", items: [["⌘/Ctrl + Z", "撤销"], ["⌘/Ctrl + ⇧ + Z", "重做"], ["空格 + 拖动", "平移画布"], ["滚轮", "以光标为中心缩放"], ["0", "适应窗口"], ["1", "实际大小"]] },
];

const svg = (body) => `<svg viewBox="0 0 32 32" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const icons = {
  select: svg('<path d="m6 4 17 13-10 2-4 9-3-24Z"/>'),
  bead: svg('<rect x="7" y="7" width="18" height="18" rx="3"/><circle cx="16" cy="16" r="3"/>'),
  region: svg('<path d="M5 11V5h6m10 0h6v6m0 10v6h-6m-10 0H5v-6M5 15v2m22-2v2M15 5h2m-2 22h2"/>'),
  lasso: svg('<path d="M9 23C2 20 3 8 12 5c9-3 17 3 16 10-1 7-10 11-17 8"/><ellipse cx="9" cy="23" rx="4" ry="2.5"/><path d="M9 25v4"/>'),
  same: svg('<circle cx="9" cy="10" r="4"/><circle cx="23" cy="10" r="4"/><circle cx="9" cy="24" r="4"/><circle cx="23" cy="24" r="4"/>'),
  connected: svg('<rect x="4" y="4" width="8" height="8" rx="2"/><rect x="20" y="20" width="8" height="8" rx="2"/><path d="M8 12v12h12M12 8h12v12"/>'),
  eyedropper: svg('<path d="m20 4 8 8-4 4-2-2L9 27H5v-4l13-13-2-2 4-4Z"/><path d="m13 15 4 4"/>'),
  "source-eyedropper": svg('<path d="m20 4 8 8-4 4-2-2L9 27H5v-4l13-13-2-2 4-4Z"/><circle cx="7" cy="7" r="3"/>'),
  pan: svg('<path d="M16 3v26M3 16h26M16 3l-4 4m4-4 4 4M16 29l-4-4m4 4 4-4M3 16l4-4m-4 4 4 4m22-4-4-4m4 4-4 4"/>'),
  brush: svg('<path d="m5 22 15-15 5 5-15 15H5v-5Z"/><path d="m18 9 5 5M5 27l5-5"/>'),
  eraser: svg('<path d="m4 20 14-14 10 10-11 11H9L4 22v-2Z"/><path d="m11 13 10 10M17 27h11"/>'),
  fill: svg('<path d="m7 13 9-9 11 11-10 10L7 15v-2Z"/><path d="M4 15h24M8 26h18"/>'),
  line: svg('<path d="M6 26 26 6"/><circle cx="6" cy="26" r="2.4" fill="currentColor" stroke="none"/><circle cx="26" cy="6" r="2.4" fill="currentColor" stroke="none"/>'),
  rect: svg('<rect x="4.5" y="7.5" width="23" height="17" rx="1"/>'),
  ellipse: svg('<ellipse cx="16" cy="16" rx="12" ry="9.5"/>'),
  wand: svg('<path d="m5 27 13-13"/><path d="m16.5 15.5 4 4"/><path d="M23 5.5l1.1 3.2 3.2 1.1-3.2 1.1L23 14.1l-1.1-3.2-3.2-1.1 3.2-1.1z"/>'),
  text: svg('<path d="M6 7h20"/><path d="M16 7v18"/><path d="M11 25h10"/>'),
  mirror: svg('<path d="M16 3v26" stroke-dasharray="3 3"/><path d="M12 8 4 12v9l8 4V8Zm8 0 8 4v9l-8 4V8Z"/>'),
  more: svg('<circle cx="6" cy="16" r="1.7" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.7" fill="currentColor" stroke="none"/><circle cx="26" cy="16" r="1.7" fill="currentColor" stroke="none"/>'),
  undo: svg('<path d="M13 8 5 15l8 7"/><path d="M5 15h13c7 0 10 4 10 10"/>'),
  redo: svg('<path d="m19 8 8 7-8 7"/><path d="M27 15H14C7 15 4 19 4 25"/>'),
  help: svg('<circle cx="16" cy="16" r="12"/><path d="M12.5 12.6a3.6 3.6 0 1 1 4.4 3.5c-.9.3-1.4 1-1.4 1.9v.6"/><circle cx="15.5" cy="23" r="1.3" fill="currentColor" stroke="none"/>'),
};
const primaryIds = PRIMARY_ORDER;
const smallGlyph = { select: "↖", bead: "□", region: "▧", same: "≋", connected: "⌘", eyedropper: "⌾", "source-eyedropper": "◉", text: "T" };

export class GridEditorToolbar {
  constructor({ root, variant = "primary", activeTool = "select", brushSize = 1, shapeFilled = false, onToolChange = () => {}, onPanelAction = () => {}, onBrushSizeChange = () => {}, onShapeFilledChange = () => {} }) {
    this.root = typeof root === "string" ? document.querySelector(root) : root;
    this.variant = variant;
    this.activeTool = activeTool;
    this.brushSize = brushSize;
    this.shapeFilled = shapeFilled;
    this.onToolChange = onToolChange;
    this.onPanelAction = onPanelAction;
    this.onBrushSizeChange = onBrushSizeChange;
    this.onShapeFilledChange = onShapeFilledChange;
    this.render(); this.bindEvents();
    // 键盘快捷键只绑定在主区实例：GRID_TOOLS 里所有工具的快捷键（含选择/框选/魔棒/同色/连通/移动）
    // 都经主区这一处处理，处理后走 store → paint → 两个实例一起同步高亮。扩展区再绑一份只会重复触发。
    // 帮助对话框同理只在主区实例里建（扩展区没有独立的帮助节点，点帮助走 onPanelAction → 主区 openHelp）。
    if (this.variant !== "extended") { this.bindShortcuts(); this.bindHelp(); }
    if (this.variant === "rail") this.bindRailPopovers();
  }
  toolButton(tool, secondary = false) {
    // The eyedropper itself carries the sampled color, without a corner badge.
    const swatch = "";
    return `<button type="button" class="sl-tool-button${secondary ? " sl-tool-button-secondary" : ""}${tool.id === "eyedropper" ? " sl-tool-button-eyedrop" : ""}" data-tool="${tool.id}" title="${tool.label}${tool.shortcut ? ` (${tool.shortcut})` : ""}" aria-label="${tool.label}">${swatch}<span class="sl-tool-icon">${icons[tool.id] || `<span class="sl-tool-glyph">${smallGlyph[tool.id]}</span>`}</span><span class="sl-tool-label">${tool.label}</span></button>`;
  }
  render() {
    // 底栏主区：画笔类主工具 + 镜像菜单 + 历史。镜像统一收在一个入口，
    // 避免左右、上下两个方向分别占据工具栏位置。
    if (this.variant === "extended") { this.renderExtended(); return; }
    if (this.variant === "rail") { this.renderRail(); return; }
    const primary = PRIMARY_ORDER.map((id) => GRID_TOOLS.find((tool) => tool.id === id)).filter(Boolean);
    this.root.innerHTML = `<div class="sl-grid-toolbar" role="toolbar" aria-label="画布工具"><div class="sl-toolbar-primary">
      ${primary.map((tool) => this.toolButton(tool)).join("")}
    </div><div class="sl-toolbar-history" aria-label="编辑历史">
      <button type="button" class="sl-history-button" data-panel="help" aria-label="功能说明与快捷键" title="功能说明与快捷键">${icons.help}</button>
      <button type="button" class="sl-history-button" data-panel="undo" aria-label="撤销" title="撤销" disabled>${icons.undo}</button>
      <button type="button" class="sl-history-button" data-panel="redo" aria-label="重做" title="重做" disabled>${icons.redo}</button>
    </div></div>`;
    this.sync();
  }
  renderRail() {
    const direct = ["brush", "eyedropper", "eraser", "fill", "pan", "text"]
      .map((id) => GRID_TOOLS.find((tool) => tool.id === id)).filter(Boolean);
    const menu = (label, icon, tools) => `<details class="sl-rail-menu"><summary class="sl-tool-button" title="${label}" aria-label="${label}"><span class="sl-tool-icon">${icon}</span><span class="sl-tool-label">${label}</span></summary><div class="sl-tool-menu" role="menu" aria-label="${label}">${tools.map((id) => this.toolButton(GRID_TOOLS.find((tool) => tool.id === id), true)).join("")}</div></details>`;
    this.root.innerHTML = `<div class="sl-grid-toolbar sl-grid-toolbar-rail" role="toolbar" aria-label="专业编辑工具">
      ${this.toolButton(GRID_TOOLS.find(tool=>tool.id==='select'))}
      ${direct.slice(0,4).map((tool) => this.toolButton(tool)).join("")}
      <button type="button" class="sl-tool-button" data-tool="rect" title="形状 · 上方选择直线、矩形或圆形" aria-label="形状"><span class="sl-tool-icon">${icons.rect}</span><span class="sl-tool-label">形状</span></button>
      ${direct.slice(4).map((tool) => this.toolButton(tool)).join("")}
      <button type="button" class="sl-history-button sl-rail-help" data-panel="help" aria-label="功能说明与快捷键" title="功能说明与快捷键">${icons.help}</button>
    </div>`;
    this.sync();
  }
  // 顶栏扩展区只保留选择类工具与帮助。换色、描边、镜像、辅助线和原图对照
  // 都由各自唯一的编辑/视图入口负责，不在这里重复暴露状态或动作。
  renderExtended() {
    const tools = EXTENDED_TOOL_IDS.map((id) => GRID_TOOLS.find((tool) => tool.id === id)).filter(Boolean);
    this.root.innerHTML = `<div class="sl-grid-toolbar sl-grid-toolbar-extended" role="toolbar" aria-label="选择工具"><div class="sl-toolbar-primary">
      ${tools.map((tool) => this.toolButton(tool)).join("")}
    </div><div class="sl-toolbar-help"><button type="button" class="sl-history-button" data-panel="help" title="功能说明与快捷键" aria-label="功能说明与快捷键">${icons.help}</button></div></div>`;
    this.sync();
  }
  bindEvents() {
    this.handleToolbarClick = (event) => {
      const tool = event.target.closest("[data-tool]");
      if (tool) { this.setTool(tool.dataset.tool); this.closeMore(); return; }
      const panel = event.target.closest("[data-panel]");
      if (panel && !panel.disabled) { this.onPanelAction(panel.dataset.panel); this.closeMore(); }
    };
    this.root.addEventListener("click", this.handleToolbarClick);
  }
  bindRailPopovers() {
    const close = () => {
      const current = this.railPopover;
      if (!current) return;
      this.railPopover = null;
      if (current.menu.matches(":popover-open")) current.menu.hidePopover();
      current.owner.append(current.menu);
      current.menu.removeAttribute("popover");
      current.menu.classList.remove("sl-rail-popover");
      current.menu.removeAttribute("style");
      current.owner.open = false;
      current.owner.querySelector("summary").setAttribute("aria-expanded", "false");
    };
    this.closeRailPopover = close;
    const position = () => {
      const current = this.railPopover;
      if (!current) return;
      const anchor = current.owner.querySelector("summary").getBoundingClientRect();
      const mobile = innerWidth <= 768;
      const width = Math.min(240, innerWidth - 24);
      const height = Math.min(current.menu.scrollHeight, innerHeight * .65);
      const x = mobile ? Math.max(12, Math.min(innerWidth - width - 12, anchor.left)) : Math.min(innerWidth - width - 12, anchor.right + 10);
      const y = mobile ? Math.max(12, anchor.top - height - 12) : Math.max(12, Math.min(innerHeight - height - 12, anchor.top));
      Object.assign(current.menu.style,{width:`${width}px`,left:`${x}px`,top:`${y}px`});
    };
    this.root.querySelectorAll(".sl-rail-menu").forEach(owner => {
      const menu = owner.querySelector(".sl-tool-menu");
      owner.querySelector("summary").setAttribute("aria-expanded", "false");
      menu.addEventListener("click", event => { if (!this.root.contains(menu)) this.handleToolbarClick(event); });
      owner.addEventListener("toggle", () => {
        if (!owner.open) { if(this.railPopover?.owner===owner) close(); return; }
        if (this.railPopover?.owner === owner) return;
        close();
        this.root.querySelectorAll(".sl-rail-menu[open]").forEach(other=>{if(other!==owner)other.open=false;});
        owner.open=true;
        menu.classList.add("sl-rail-popover");
        menu.setAttribute("popover","manual");
        document.body.append(menu);
        this.railPopover={owner,menu};
        owner.querySelector("summary").setAttribute("aria-expanded","true");
        if(typeof menu.showPopover==="function")menu.showPopover();
        position();
      });
    });
    document.addEventListener("pointerdown",event=>{const current=this.railPopover;if(current&&!current.menu.contains(event.target)&&!current.owner.contains(event.target))close();},true);
    document.addEventListener("keydown",event=>{if(event.key==="Escape"&&this.railPopover){event.preventDefault();event.stopPropagation();const summary=this.railPopover.owner.querySelector("summary");close();summary.focus();}},true);
    window.addEventListener("resize",position);
    document.addEventListener("scroll",position,true);
  }
  bindShortcuts() {
    window.addEventListener("keydown", (event) => {
      const target = event.target;
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target?.isContentEditable || event.metaKey || event.ctrlKey || event.altKey) return;
      // 任何模态对话框打开时都不切换工具：否则在「功能说明」面板里按 B 会偷偷换掉工具，
      // 在确认弹窗上按键也会改状态。原先缺这条守卫，是真实出现过的行为。
      if (document.querySelector("dialog[open]")) return;
      const tool = GRID_TOOLS.find((item) => item.shortcut && item.shortcut === event.key.toUpperCase());
      if (!tool) return;
      this.setTool(tool.id);
      // 工具键同时把焦点从输入控件上摘掉，否则后续 ⌘Z 之类会被浏览器抢走。
      if (target instanceof HTMLElement) target.blur();
    });
  }
  bindHelp() {
    const dialog = document.createElement("dialog");
    dialog.className = "ws-help-dialog";
    dialog.innerHTML = `<div class="ws-help-head"><strong>功能说明与快捷键</strong><button type="button" class="ws-help-close" aria-label="关闭">×</button></div>
      <div class="ws-help-body" id="sl-help-body"></div>`;
    // 面板内容按需渲染，避免每次挂载都构建一大段 HTML。
    const body = dialog.querySelector("#sl-help-body");
    body.innerHTML = SHORTCUT_HELP.map((group) => `<section><h4>${group.title}</h4><dl>${group.items.map(([key, label]) => `<div><dt><kbd>${key}</kbd></dt><dd>${label}</dd></div>`).join("")}</dl></section>`).join("")
      + `<section><h4>工具说明</h4><dl>${[
        ["选择", "点击查看单格；拖动圈选矩形。上方可切换全部同色、连续同色或魔棒，不修改图纸"],
        ["单豆", "用当前色号点一颗豆"],
        ["画笔 / 擦除", "按住拖动为一笔，笔宽由上方滑块决定"],
        ["填色", "四方向连续同色区域一次填满"],
        ["直线 / 矩形 / 圆形", "从起点拖到终点；圆形按外接框绘制"],
        ["框选 / 魔棒", "框选为矩形区域；魔棒按色差容差自动圈选连续区域，Shift 叠加、Alt 减掉"],
        ["涂选 · Q", "按住鼠标扫过豆格立即选中，可多次叠加；只选扫过的格子，不填满圈内；Esc 取消本次涂选"],
        ["同色 / 连通", "同色 = 全图同色号；连通 = 只选相邻的同色块"],
        ["取色 / 原图取色", "取色取自当前图纸；原图取色取自中央原图"],
        ["文字", "点击「添加文字」创建对象；在画布上点击已有文字可选中和拖动。上方调整内容与样式，点「向下合并」才写进图纸；添加、修改和删除均可撤销"],
        ["移动", "拖动画布视图，不改图纸"],
      ].map(([key, label]) => `<div><dt>${key}</dt><dd>${label}</dd></div>`).join("")}</dl></section>`;
    dialog.querySelector(".ws-help-close").addEventListener("click", () => dialog.close());
    dialog.addEventListener("click", (event) => { if (event.target === dialog) dialog.close(); });
    this.root.append(dialog);
    this.helpDialog = dialog;
  }
  openHelp() { this.helpDialog?.showModal(); }
  closeMore() { this.closeRailPopover?.(); this.root.querySelectorAll("details[open]").forEach((details) => details.removeAttribute("open")); }
  setTool(tool) {
    // 再次点击文字工具可重新打开对象属性，但不隐式创建文字。
    if (tool === this.activeTool) { this.onToolChange(tool); return; }
    this.activeTool = tool; this.sync(); this.onToolChange(tool);
  }
  setActiveTool(tool) { this.activeTool = tool; this.sync(); }
  setToolDisabled(tool, disabled) {
    const button = this.root.querySelector(`[data-tool="${tool}"]`);
    if (button) button.disabled = Boolean(disabled);
  }
  // 取色按钮上的色块：传 hex 字符串（或 null 表示尚未取色）。只在值真变了才写 DOM，
  // paint 每次状态变化都会调它，无条件赋值会白刷。
  setEyedropperColor(hex) {
    const next = hex || null;
    if (this._eyedropperHex === next) return;
    this._eyedropperHex = next;
    const button = this.root.querySelector('[data-tool="eyedropper"]');
    if (button) { button.style.setProperty('--picked-color',next || 'none'); }
  }
  // 可见的笔宽控件在画布上方的当前工具属性栏，这里只保留状态。
  // notify 必须显式区分：从 store 回灌时绝不能回调，否则 setState → paint → setBrushSize → setState 会绕成死循环；
  // 而用户改控件时又必须无条件回调 —— 曾经只在「值被夹取」时才回调，导致显示 3 而实际落笔仍按旧值。
  setBrushSize(size, notify = false) {
    const index = BRUSH_SIZES.indexOf(Number(size));
    const value = index >= 0 ? BRUSH_SIZES[index] : BRUSH_SIZES.reduce((best, candidate) => (Math.abs(candidate - size) < Math.abs(best - size) ? candidate : best), 1);
    this.brushSize = value;
    if (notify) this.onBrushSizeChange(value);
  }
  stepBrushSize(direction) {
    const index = BRUSH_SIZES.indexOf(this.brushSize);
    const next = BRUSH_SIZES[Math.min(BRUSH_SIZES.length - 1, Math.max(0, index + direction))];
    // 即便值没变也照样通知：万一 store 与控件曾经不同步，这一步会自动纠正回来。
    this.setBrushSize(next, true);
    return next;
  }
  setShapeFilled(filled) { this.shapeFilled = Boolean(filled); }
  setHistory(canUndo, canRedo) {
    const undo = this.root.querySelector('[data-panel="undo"]'), redo = this.root.querySelector('[data-panel="redo"]');
    if (undo) undo.disabled = !canUndo;
    if (redo) redo.disabled = !canRedo;
  }
  sync() {
    this.root.querySelectorAll("[data-tool]").forEach((button) => {
      const selected=button.dataset.tool===this.activeTool||(this.variant==='rail'&&button.dataset.tool==='rect'&&Object.hasOwn(SHAPE_TOOLS,this.activeTool))||(this.variant==='rail'&&button.dataset.tool==='select'&&['select','region','lasso','same','connected','wand'].includes(this.activeTool));
      button.classList.toggle('is-active',selected);button.setAttribute('aria-pressed',String(selected));
    });
    this.root.querySelector(".sl-tool-more > summary")?.classList.toggle("is-active", !primaryIds.includes(this.activeTool));
  }
}
