import { projectStore } from "../state/project-store.js?v=20260918-usage2";
import { createGenerationService } from "../services/generation-service.js?v=20260918-usage2";
import { createPaletteService } from "../services/palette-service.js";
import { createExportService } from "../services/export-service.js?v=20260917-batchA";
import { createEditorService } from "../services/editor-service.js?v=20260918-usage2";
import { createViewportService } from "../services/viewport-service.js?v=20260924-text";
import { createCanvasRenderer } from "./canvas-renderer.js?v=20260924-text";
import { rectangularSelection, sameColorSelection, connectedSelection, selectionContains, selectionCells } from "../services/selection-service.js?v=20260916-phase35-5";
import { magicWandSelection, fitSelectionBox, invertSelection as invertSelectionMask, selectAll as selectAllCells, translateSelection } from "../services/shapes-service.js?v=20260918-usage2";
import { renderSourceTransform, defaultSourceTransform, cropFromDrag, sourceOutputGeometry } from "../services/source-editor-service.js?v=20260916-phase35-5";
import { GenerationPanel } from "./generation-panel.js?v=20260918-usage2";
import { GridEditorToolbar, SHAPE_TOOLS } from "./grid-editor-toolbar.js?v=20260918-usage2";
import { detectPixelMultiple, loadImageData, logicalSize } from "./pixel-multiple.js?v=20260923-pixelmultiple";
import { ZoomControls } from "./zoom-controls.js?v=20260924-text";
import { TextPanel } from "./text-panel.js?v=20260924-text";
import { createTextLayer, rasterizeTextCached, layerContainsCell } from "../services/text-layer-service.js?v=20260924-text";
import { createInventoryService } from "../services/inventory-service.js?v=20260917-inventory";
import { createOcrService } from "../services/ocr-service.js?v=20260917-inventory";
import { createLegendRecognitionService } from "../services/legend-recognition-service.js?v=20260917-inventory";
import { InventoryPanel } from "./inventory-panel.js?v=20260917-inventory";
import { UsageDialog } from "./usage-dialog.js?v=20260917-inventory";
import { resolveScreenRenderPolicy } from "../smart-preprocessing/render-policy.mjs?v=20260928-v3";

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

const canvasHint = (view) => {
  const policy = resolveScreenRenderPolicy({
    showCodes: view.showCodes,
    zoom: view.zoom,
    baseCell: 20,
    codeThreshold: view.codeVisibilityThreshold,
  });
  return view.showCodes && !policy.showCodes ? "放大以查看色号" : "拖动画布平移 · 滚轮缩放";
};

export function mountWorkspace(bridge) {
  if (!bridge) throw new Error("缺少 Workspace Bridge");
  const store = projectStore, generation = createGenerationService(bridge, store);
  const palettes = createPaletteService(bridge, store), exports = createExportService(bridge, store), editorService = createEditorService(bridge, { onHistoryChange: () => updateHistory() });
  const wrap = document.querySelector(".workspace-wrap"), grid = wrap?.querySelector(".workspace-grid");
  const top = wrap?.querySelector(".main-global-toolbar"), left = grid?.querySelector(".main-left-toolbar");
  const center = grid?.querySelector(".main-center-workspace"), right = grid?.querySelector(".main-right-inspector");
  if (grid?.dataset.workspaceReady) return { mounted: true, reused: true };
  if (grid?.dataset.workspaceMounting) throw new Error("工作台正在挂载");
  const missing = [
    [wrap, ".workspace-wrap"], [grid, ".workspace-grid"], [top, ".main-global-toolbar"],
    [left, ".main-left-toolbar"], [center, ".main-center-workspace"], [right, ".main-right-inspector"],
  ].filter(([node]) => !node).map(([, selector]) => selector);
  if (missing.length) throw new Error("工作台骨架不完整：" + missing.join(", "));
  grid.dataset.workspaceMounting = "true";
  grid.dataset.workspaceShell = "v3";
  bridge.setLockAspectRatio(false);
  bridge.setWidth(104); bridge.setHeight(104);
  store.setState({ canvas: { width: 104, height: 104, lockAspectRatio: false }, generation: { engine: "v2.5", algorithm: "current" } });
  document.body.classList.add("phase2-workspace");

  // 原先「更多现有工具与参数」折叠里装的是旧顶/左/右栏的控件，现已全部迁到工作台上方
  // 的 #ws-top-controls（扩展工具条 + 色号选择 + 生成参数），不再保留这个重复入口。

  // 顶栏收成一条紧凑工具带：作品名 + 状态 + 引擎/算法 + 生成主操作。
  // 原先 8 个平铺药丸按钮按用途重新分配 —— 视图/缩放/勾选下沉到底部工具坞，
  // 「开始拼 / 导出」也下沉到工具坞右侧，顶栏只留「生成」这一个主操作。
  top.className = "ws-topbar";
  top.innerHTML = `<input class="ws-name" id="ws-project-name" aria-label="作品名称" value="未命名作品" maxlength="40">
    <span class="ws-status" id="ws-status">未开始</span>
    <span class="ws-topbar-spacer"></span>
    <label class="ws-engine-label">引擎<select id="ws-engine"><option value="v2.5">智能 V2.5</option><option value="legacy">Legacy</option></select></label>
    <label class="ws-engine-label" title="选择生成算法">算法<select id="ws-algorithm"><option value="current">现有算法</option><option value="bgs">BGS 算法</option><option value="pindou-workbench">PW 算法</option><option value="hybrid-pw">HYBRID-PW 混合</option></select></label>
    <button type="button" class="ws-button" id="ws-source-open">图片调整</button>
    <button type="button" class="ws-button" id="ws-import-again">换图</button>
    <button type="button" class="ws-button ws-button-primary" id="ws-generate" hidden>重新生成</button>
    <button type="button" class="ws-button" id="ws-legacy-retry" hidden>Legacy 重试</button>`;

  // 左轨只留两个模式入口（对齐 Pixler 编辑器 IA）。
  // 原 6 个面板（作品/图片调整/色彩/编辑/检查/库存）移到右栏顶部做 tab。
  left.className = "ws-rail";
  left.setAttribute("aria-label", "工作模式");
  left.innerHTML = `<span class="ws-rail-brand" aria-hidden="true">白</span>
    <button type="button" class="ws-rail-mode" data-ws-mode="edit" aria-label="编辑模式" title="编辑 · 改图、生成、调色">
      <span class="ws-rail-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"><path d="M2.5 13.5l1-3.6 7.6-7.6 2.6 2.6-7.6 7.6-3.6 1z"/></svg></span>
      <small>编辑</small>
    </button>
    <button type="button" class="ws-rail-mode" data-ws-mode="build" aria-label="施工模式" title="施工 · 按区块拼豆，暗色护眼">
      <span class="ws-rail-icon" aria-hidden="true"><svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.2"><rect x="2" y="2" width="12" height="12"/><path d="M6 2v12M10 2v12M2 6h12M2 10h12" stroke-width=".8"/></svg></span>
      <small>施工</small>
    </button>`;

  center.className = "ws-center";
  const oldTabs = center.querySelector(".main-view-tabs"); if (oldTabs) oldTabs.hidden = true;
  const oldPreview = center.querySelector(".preview-column"); if (oldPreview) oldPreview.classList.add("ws-old-preview");
  const importView = document.createElement("section"); importView.className = "ws-import"; importView.id = "ws-import";
  importView.innerHTML = `<div class="ws-import-inner"><p class="ws-eyebrow">创作工作台</p><h1>从一张图片开始</h1><p>图片只在本地浏览器处理。拖入图片，或点击选择。</p><div class="ws-drop-slot"></div><span>PNG · JPG · WEBP</span></div>`;
  const oldUpload = document.querySelector("#upload-zone"); importView.querySelector(".ws-drop-slot").append(oldUpload);
  const canvas = document.createElement("section"); canvas.className = "ws-canvas-area"; canvas.id = "ws-canvas-area";
  canvas.innerHTML = `<div class="ws-canvas-well" id="ws-canvas-well" role="img" aria-label="当前拼豆作品画布"><div class="ws-canvas-layers" id="ws-canvas-layers"></div><canvas id="ws-source-canvas" class="ws-source-canvas" aria-label="原图裁剪画布" hidden></canvas></div><div class="ws-canvas-stats" id="ws-canvas-stats"><span>已使用颜色</span> <strong id="ws-stats-colors">0</strong> <span>种</span> <i aria-hidden="true">/</i> <strong id="ws-stats-beads">0</strong> <span>颗</span></div><p class="ws-canvas-hint" id="ws-canvas-hint"></p>`;
  center.append(importView, canvas);
  // 底部工具坞：左=画布工具，中=视图与缩放，右=主操作。严格单行不换行。
  // 原先浮在画布上方 top:12px 的工具条会盖住画布抢点击，这里改为常驻底栏。
  const dock = document.createElement("nav"); dock.className = "ws-dock"; dock.setAttribute("aria-label", "画布工具坞");
  dock.innerHTML = `<div class="ws-dock-tools" id="ws-dock-tools"></div>
    <div class="ws-dock-view" id="ws-dock-view">
      <div class="ws-view-modes">${[["original","原图"],["blocks","色块"],["beads","拼豆"],["pattern","图纸"]].map(([id,name])=>`<button type="button" data-ws-view="${id}">${name}</button>`).join("")}<button type="button" id="ws-compare" title="按住临时看原图">对照</button></div>
      <div class="ws-view-toggles"><label><input type="checkbox" id="ws-grid">网格</label><label><input type="checkbox" id="ws-codes">色号</label></div>
    </div>
    <div class="ws-dock-actions">
      <button type="button" class="ws-button" id="ws-making" disabled>开始拼</button>
      <button type="button" class="ws-button ws-button-primary" id="ws-export" disabled>导出图纸</button>
    </div>`;
  wrap.append(dock);
  const viewBar = dock.querySelector("#ws-dock-view");

  right.className = "ws-inspector";
  const INSPECTOR_TABS = [["project", "作品"], ["source", "图片"], ["color", "色彩"], ["edit", "编辑"], ["check", "检查"], ["inventory", "库存"]];
  right.innerHTML = `<div class="ws-side-tabs" role="tablist" aria-label="右栏分组">${INSPECTOR_TABS.map(([id, name]) => `<button type="button" role="tab" data-ws-panel="${id}">${name}</button>`).join("")}</div>
    <div class="ws-inspector-head"><strong id="ws-inspector-title">作品</strong><small id="ws-inspector-subtitle">当前设计</small></div>
    <div class="ws-inspector-scroll">
      <section class="ws-panel" data-ws-inspector="build">
        <div class="ws-section-title">分割区块</div>
        <p class="ws-note">把图纸切成若干块，一次只拼一块。</p>
        <div class="ws-stepper"><button type="button" data-ws-block="dec" aria-label="减少区块">−</button><output id="ws-block-count">1</output><button type="button" data-ws-block="inc" aria-label="增加区块">+</button></div>
        <p class="ws-note" id="ws-block-advice">—</p>
        <div class="ws-section-title">区块切换</div>
        <div class="ws-block-map" id="ws-block-map" role="group" aria-label="区块切换"></div>
        <div class="ws-block-arrows"><button type="button" data-ws-block="prev" aria-label="上一区块">←</button><button type="button" data-ws-block="next" aria-label="下一区块">→</button></div>
        <div class="ws-section-title">颜色切换 · 当前区块</div>
        <div class="ws-block-colors" id="ws-block-colors" role="group" aria-label="当前区块颜色"></div>
        <div class="ws-block-arrows"><button type="button" data-ws-color="prev" aria-label="上一颜色">↑</button><button type="button" data-ws-color="next" aria-label="下一颜色">↓</button></div>
        <div class="ws-readout" id="ws-build-focus">—</div>
        <button type="button" class="ws-button ws-wide" id="ws-build-reset">显示全部</button>
      </section>
      <section class="ws-panel" data-ws-inspector="project"><div class="ws-section-title">拼豆规格</div><label class="ws-field">单豆直径<select id="ws-bead-size"><option value="2.6">小豆 · 2.6 mm</option><option value="5">大豆 · 5.0 mm</option></select></label><div class="ws-readout" id="ws-physical-size">—</div><div class="ws-section-title">已有作品</div><div class="ws-project-gallery-slot"></div></section>
      <section class="ws-panel" data-ws-inspector="source"><div class="ws-section-title">非破坏式原图修整</div><p class="ws-note">在中央原图拖动裁剪。原文件不变，应用后重新生成图纸。</p><label class="ws-field">裁剪比例<select id="ws-source-ratio"><option value="free">自由</option><option>1:1</option><option>4:3</option><option>3:4</option><option>16:9</option><option>9:16</option></select></label><div class="ws-source-buttons"><button type="button" data-ws-source-rotate="-90">左转 90°</button><button type="button" data-ws-source-rotate="90">右转 90°</button><button type="button" data-ws-source-flip="flipX">水平翻转</button><button type="button" data-ws-source-flip="flipY">垂直翻转</button><button type="button" id="ws-source-pick-mode">原图取色</button></div><div id="ws-source-sample" class="ws-source-sample"></div><div class="ws-section-title">画面调整</div>${[["brightness","亮度",-100,100],["contrast","对比度",-100,100],["saturation","饱和度",-100,100],["sharpen","锐化",0,100]].map(([key,label,min,max])=>`<label class="ws-source-slider">${label}<span id="ws-source-${key}-value">0</span><input type="range" data-ws-source-adjust="${key}" min="${min}" max="${max}" value="0"></label>`).join("")}<div class="ws-section-title">扩容画布 · 原图像素</div><div class="ws-expand-grid">${["top","bottom","left","right"].map((side)=>`<label>${{top:"上",bottom:"下",left:"左",right:"右"}[side]}<input type="number" data-ws-source-expand="${side}" min="0" max="500" value="0"></label>`).join("")}</div><label class="ws-field">背景色<input id="ws-source-background" type="color" value="#ffffff"></label><div class="ws-section-title">处理后预览</div><canvas id="ws-source-preview" class="ws-source-preview" aria-label="处理后图片预览"></canvas><div id="ws-source-size" class="ws-note"></div><div class="ws-source-buttons"><button type="button" id="ws-source-reset">恢复原图</button><button type="button" class="ws-button-primary" id="ws-source-apply">应用并生成</button></div></section>
      <section class="ws-panel" data-ws-inspector="color">
        <div class="ws-section-title">色卡</div>
        <label class="ws-field">品牌<select id="ws-brand"></select></label>
        <label class="ws-field">色数<select id="ws-palette-size"></select></label>
        <div id="generationPanel"></div>
        <div class="ws-section-title">色号选择</div>
        <input id="ws-color-search" type="search" placeholder="搜索色号 · H7 / H07" aria-label="搜索色号">
        <div id="ws-palette-categories" class="ws-palette-categories"></div>
        <div id="ws-recent-colors" class="ws-recent-colors"></div>
        <div id="ws-bead-picker" class="ws-bead-picker"></div>
        <div class="ws-readout" id="ws-used-colors">尚未生成</div>
        <div class="ws-section-title">实际用豆颜色</div>
        <div class="ws-color-list" id="ws-color-list"></div>
        <div class="ws-section-title">全局换色</div>
        <label class="ws-field">来源色号<input id="ws-replace-from" type="text" placeholder="H07"></label>
        <label class="ws-field">替换为<input id="ws-replace-to" type="text" placeholder="A03"></label>
        <p class="ws-note" id="ws-replace-impact">选择来源色后显示影响颗数。</p>
        <button type="button" class="ws-button ws-wide" id="ws-replace-confirm">确认替换</button>
      </section>
      <section class="ws-panel" data-ws-inspector="edit"><div class="ws-section-title">当前工具</div><div id="ws-tool-details" class="ws-cell-details">选择工具 · 点击查看单豆</div><div class="ws-section-title">选中拼豆 / 区域</div><div id="ws-cell-details" class="ws-cell-details">用选择工具点击画布中的一颗豆。</div><div class="ws-section-title">工具选项</div><label class="ws-source-slider">笔宽<span id="ws-brush-size-value">1</span><input type="range" id="ws-brush-size" min="1" max="9" step="2" value="1" aria-label="画笔大小（格）"></label><label class="ws-switch-row"><input type="checkbox" id="ws-shape-filled"> 形状实心（矩形 / 圆形）</label><label class="ws-source-slider">魔棒容差<span id="ws-wand-tolerance-value">12</span><input type="range" id="ws-wand-tolerance" min="0" max="100" value="12"></label><div class="ws-selection-actions"><button type="button" id="ws-erase-selection">擦除选区</button><button type="button" id="ws-clear-selection">清除选择</button></div><div class="ws-selection-actions"><button type="button" id="ws-copy-selection">复制</button><button type="button" id="ws-cut-selection">剪切</button><button type="button" id="ws-paste-selection">粘贴</button></div><div class="ws-selection-actions"><button type="button" id="ws-invert-selection">反选</button><button type="button" id="ws-select-all">全选</button></div><div class="ws-outline-options"><label><input id="ws-outline-diagonal" type="checkbox">描边包含对角</label><button type="button" id="ws-apply-outline">外描边</button></div><div class="ws-editor-actions"><button type="button" id="ws-undo" disabled>撤销</button><button type="button" id="ws-redo" disabled>重做</button></div><div id="ws-history-label" class="ws-note"></div><div class="ws-section-title">文字素材</div><div id="textPanel" class="ws-text-panel"></div><div class="ws-section-title">参考底图描图</div><p class="ws-note">底图垫在豆格下方，空白处透出，照着描就行。底图只作参考，不会写进图纸。</p><div class="ws-source-buttons"><button type="button" id="ws-ref-pick">选择底图</button><button type="button" id="ws-ref-clear">移除底图</button></div><input type="file" id="ws-ref-file" accept="image/*" hidden><label class="ws-field">贴合方式<select id="ws-ref-fit"><option value="contain">适应 · 保持比例居中</option><option value="stretch">拉伸 · 铺满整块画布</option></select></label><label class="ws-source-slider">透明度<span id="ws-ref-opacity-value">40%</span><input type="range" id="ws-ref-opacity" min="0" max="100" value="40"></label><label class="ws-switch-row"><input type="checkbox" id="ws-ref-visible" checked> 显示底图</label><div class="ws-section-title">旧画板高级工具</div><button type="button" class="ws-button ws-wide" id="ws-open-editor" disabled>打开原画板</button></section>
      <section class="ws-panel" data-ws-inspector="check"><div class="ws-section-title">真实检查结果</div><div id="ws-check-results" class="ws-check-results">生成后显示可验证的尺寸、色数与结构报告。</div></section>
      <section class="ws-panel" data-ws-inspector="inventory"><div id="inventoryPanel"></div></section>
    </div>`;
  const editPanel = right.querySelector('[data-ws-inspector="edit"]');
  const symmetryControls = document.createElement("div");
  symmetryControls.className = "ws-symmetry-controls";
  symmetryControls.innerHTML = '<div class="ws-section-title">对称绘制</div><div class="ws-selection-actions"><label><input id="ws-symmetry-horizontal" type="checkbox"> 左右</label><label><input id="ws-symmetry-vertical" type="checkbox"> 上下</label></div>';
  editPanel?.querySelector("#ws-cell-details")?.previousElementSibling?.before(symmetryControls);
  const gallery = document.querySelector(".gallery-section"); if (gallery) right.querySelector(".ws-project-gallery-slot").append(gallery);

  // 工作台上方的参数条，只保留两件事：
  //   1) 编辑工具与变换（从「更多」菜单拉出来、画笔坞里没有的那批）
  //   2) 图纸尺寸一行 —— 三个常用预设 52 / 78 / 104 加「自动」（按源图比例拟合到 104），
  //      右侧紧邻视图缩放（缩放从底部 viewbar 挪上来，避免两处重复）。
  // 色号选择、生成方式/算法等生成参数一律不进这里，统一收到右栏「色彩」面板。
  const topControls = document.createElement("section");
  topControls.className = "ws-top-controls";
  topControls.id = "ws-top-controls";
  topControls.setAttribute("aria-label", "编辑工具、图纸尺寸与视图缩放");
  topControls.innerHTML = `
    <div class="ws-top-tools" id="ws-top-tools" aria-label="编辑工具与变换"></div>
    <div class="ws-top-size">
      <span class="ws-top-size-label">图纸尺寸</span>
      <div class="ws-size-chips" id="ws-size-chips" role="group" aria-label="图纸尺寸预设">
        <button type="button" class="ws-size-chip ws-size-chip-auto" data-size="auto">自动</button>
        <button type="button" class="ws-size-chip" data-size="52">52</button>
        <button type="button" class="ws-size-chip" data-size="78">78</button>
        <button type="button" class="ws-size-chip" data-size="104">104</button>
      </div>
      <div class="ws-size-stepper" role="group" aria-label="手动调整图纸尺寸">
        <button type="button" data-size-step="-1" aria-label="尺寸减小">−</button>
        <input id="ws-size-input" type="number" min="10" max="500" step="1" value="104" aria-label="图纸尺寸（豆）">
        <button type="button" data-size-step="1" aria-label="尺寸增大">+</button>
      </div>
      <div class="ws-multiple" role="group" aria-label="像素倍数识别">
        <span class="ws-multiple-label" title="倍数识别用于判断原图中每一个像素格由多少个图像像素组成。">倍数</span>
        <div class="ws-multiple-stepper">
          <button type="button" data-multiple-step="-1" aria-label="倍数减小">−</button>
          <output id="ws-multiple-value" title="自动识别结果">1×</output>
          <button type="button" data-multiple-step="1" aria-label="倍数增大">+</button>
        </div>
      </div>
      <div id="zoomControls" class="ws-top-zoom"></div>
    </div>`;
  grid.before(topControls);

  const toolRail = document.createElement("div"); toolRail.className = "ws-grid-toolbar-host"; toolRail.id = "gridEditorToolbar"; toolRail.setAttribute("aria-label", "画布编辑工具");
  dock.querySelector("#ws-dock-tools").append(toolRail);

  const drawer = document.createElement("aside"); drawer.className = "ws-export-drawer"; drawer.id = "ws-export-drawer";
  drawer.setAttribute("aria-label", "导出作品");
  drawer.innerHTML = `<div class="ws-drawer-head"><strong>导出作品</strong><button type="button" id="ws-export-close" aria-label="关闭导出">×</button></div><p class="ws-note">导出设置与屏幕色号开关相互独立。</p><button type="button" class="ws-export-choice" data-ws-export="preview-png"><strong>成品预览 · PNG</strong><small>默认无色号、无网格</small></button><div class="ws-export-options"><strong>图纸内容</strong><label><input type="checkbox" id="ws-export-grid" checked>网格</label><label><input type="checkbox" id="ws-export-codes" checked>色号</label><label><input type="checkbox" id="ws-export-coords" checked>坐标</label></div><button type="button" class="ws-export-choice" data-ws-export="pattern-png"><strong>拼豆图纸 · PNG</strong><small>使用上方独立的图纸设置</small></button><button type="button" class="ws-export-choice" data-ws-export="pattern-jpg"><strong>拼豆图纸 · JPG</strong><small>含表头与色块 / 色号 / 颗数图例，便于分享打印</small></button><button type="button" class="ws-export-choice" data-ws-export="usage-csv"><strong>用豆清单 · CSV</strong><small>色号、名称、HEX、RGB 与颗数，可用 Excel 打开</small></button><button type="button" class="ws-export-choice" data-ws-export="project-json"><strong>工程存档 · JSON</strong><small>保存画布尺寸、色卡与整幅矩阵，可再次载入继续编辑</small></button><button type="button" class="ws-export-choice" data-ws-export="boards-zip" id="ws-boards-choice"><strong>分板图 · ZIP</strong><small>按现有板规格导出各板 PNG</small></button><div class="ws-export-options"><strong>继续编辑</strong><button type="button" id="ws-project-import">载入工程存档 / Pixler…</button><input type="file" id="ws-project-file" accept="application/json,.json,.pixler" hidden></div><p class="ws-note" id="ws-export-message"></p>`;
  wrap.append(drawer);
  const confirmDialog = document.createElement("dialog"); confirmDialog.className = "ws-confirm-dialog";
  confirmDialog.innerHTML = `<p id="ws-confirm-text"></p><div><button type="button" id="ws-confirm-cancel">取消</button><button type="button" id="ws-confirm-ok">确认</button></div>`;
  wrap.append(confirmDialog);
  const askConfirmation = (message) => new Promise((resolve) => {
    confirmDialog.querySelector("#ws-confirm-text").textContent = message;
    const done = (accepted) => { confirmDialog.close(); resolve(accepted); };
    const ok = confirmDialog.querySelector("#ws-confirm-ok"), cancel = confirmDialog.querySelector("#ws-confirm-cancel");
    ok.onclick = () => done(true); cancel.onclick = () => done(false);
    confirmDialog.oncancel = (event) => { event.preventDefault(); done(false); };
    confirmDialog.showModal();
  });

  const $ = (selector) => wrap.querySelector(selector);
  const symmetryOptions = () => ({ symmetry: {
    horizontal: get().editor.symmetryHorizontal,
    vertical: get().editor.symmetryVertical,
  } });
  const get = () => store.getState();
  function updateHistory() {
    store.setState({ editor: { history: { canUndo: editorService.canUndo(), canRedo: editorService.canRedo() } } });
  }
  const syncLegacy = (result = bridge.getResult()) => {
    if (!result) return;
    store.setState({
      project: { name: result.sourceName?.replace(/\.[^.]+$/, "") || get().project.name },
      source: { image: result.sourceUrl || null, width: result.sourceWidth || 0, height: result.sourceHeight || 0 },
      canvas: { width: result.width || Number(document.querySelector("#granularity-input")?.value || 50), height: result.height || get().canvas.height || 50 },
      palette: { id: result.paletteKey, maxColors: result.maxColors, usedColors: result.usedColors },
      stats: { totalBeads: result.totalBeads, usedColors: result.usedColors, colors: result.colors },
      status: { hasSource: Boolean(result.sourceUrl), hasPattern: Boolean(result.grid?.length), generating: false, dirty: Boolean(result.manualEdited), generationError: null },
    });
  };
  // 像素倍数：识别结果 + 手动覆盖值。声明放在最前，保证导入事件先于尺寸逻辑就绪。
  let detectedMultiple = 1;
  let manualMultiple = null;
  // 尺寸是否被手动指定（点了 52/78/104 或用了尺寸步进器）。
  // 为 false 时「自动」chip 高亮，表示尺寸由倍数识别结果推导。
  let manualSize = false;
  // 已经识别过的源图 URL，避免 paint 每次触发都重跑识别。
  let detectedForUrl = null;
  let detecting = false;
  // 自动尺寸流程改过尺寸后，等下一次出图再适配窗口。
  // 不能在改尺寸的当下 fit：那一刻 getSize() 拿到的还是旧网格，会按旧尺寸算缩放。
  let fitOnNextResult = false;
  window.addEventListener("libms:source-loaded", (event) => {
    editorService.clearHistory();
    store.setState({
      source: { image: event.detail.url, width: event.detail.width, height: event.detail.height },
      project: { name: event.detail.name.replace(/\.[^.]+$/, "") },
      stats: { totalBeads: 0, usedColors: 0, colors: [] },
      status: { hasSource: true, hasPattern: false, dirty: false, generationError: null },
      editor: { selectedCell: null, selection: null, hoveredCell: null },
    });
    // 像素倍数识别由 paint() 里的 detectMultipleFor() 统一驱动（覆盖导入与恢复会话两条路径）。
    // 图片导入后直接出一版默认图纸，省掉「再点一次生成」。
    scheduleAutoGenerate(500);
  });
  window.addEventListener("libms:source-transform-changed", () => { store.setState({ status: { dirty: true } }); });
  window.addEventListener("libms:project-result", (event) => { const first = !get().status.hasPattern;
    if (!event.detail.manualEdited) { editorService.clearHistory(); store.setState({ editor: { tool: "select", hoveredCell: null, selectedCell: null, selectedColor: null, highlightedColor: null, selection: null } }); }
    syncLegacy(event.detail); updateHistory();
    // 首次出图、或尺寸刚被自动流程改过 → 适配窗口，保证「导入即可见全貌」。
    if ((first || fitOnNextResult) && event.detail.grid?.length) { fitOnNextResult = false; viewport.fitToViewport(); } });
  window.addEventListener("libms:generation-error", (event) => store.setState({ status: { generating: false, generationError: event.detail } }));
  window.addEventListener("libms:grid-edited", (event) => { syncLegacy(event.detail); updateHistory(); });
  window.addEventListener("libms:legacy-editor-saved", () => { editorService.clearHistory(); store.setState({ editor: { tool: "select", hoveredCell: null, selectedCell: null, selection: null } }); });

  const brandNames = { mard: "MARD", coco: "COCO", manman: "漫漫", panpan: "盼盼", mixiaowo: "咪小窝" };
  // 第三方品牌（异步加载）的中文名由 app.js 写入 window.LibmsBrandLabels，优先于硬编码表。
  const brandLabel = (brand) => window.LibmsBrandLabels?.[brand] || brandNames[brand] || brand;
  const brands = () => [...new Set(palettes.getPalettes().map((key) => key.split("-")[0]))];
  function renderBrandOptions() {
    $("#ws-brand").innerHTML = brands().map((brand) => `<option value="${esc(brand)}">${esc(brandLabel(brand))}</option>`).join("");
  }
  renderBrandOptions();
  function refreshPaletteOptions() {
    const active = palettes.getActivePalette(); const [brand, size] = active.key.split("-");
    $("#ws-brand").value = brand;
    const sizes = palettes.getPalettes().filter((key) => key.startsWith(`${brand}-`)).map((key) => Number(key.split("-")[1])).sort((a,b) => b-a);
    $("#ws-palette-size").innerHTML = sizes.map((count) => `<option value="${count}">${count} 色</option>`).join("");
    $("#ws-palette-size").value = size;
  }
  refreshPaletteOptions();
  // 第三方品牌色板是异步 import 的，可能晚于本初始化；到达后重建下拉并恢复选中项。
  window.addEventListener("libms:brand-palettes-ready", () => {
    renderBrandOptions();
    refreshPaletteOptions();
  });

  right.querySelector(".ws-side-tabs").querySelectorAll("[data-ws-panel]").forEach((button) => button.addEventListener("click", () => store.setState({ ui: { activePanel: button.dataset.wsPanel } })));
  left.querySelectorAll("[data-ws-mode]").forEach((button) => button.addEventListener("click", () => setWorkspaceMode(button.dataset.wsMode)));
  dock.addEventListener("click", (event) => { const button = event.target.closest("[data-ws-view]"); if (button) store.setState({ view: { mode: button.dataset.wsView } }); });
  $("#ws-project-name").addEventListener("input", (event) => store.setState({ project: { name: event.target.value }, status: { dirty: true } }));
  const sourceRatio = () => { const result = bridge.getResult(); return result.sourceWidth && result.sourceHeight ? result.sourceHeight / result.sourceWidth : 1; };

  // ── 全自动生成 ─────────────────────────────────────────────────────────
  // 改参数 / 算法 / 引擎 / 尺寸 / 色卡都直接触发重新生成，不再需要点「生成 / 更新」。
  // · 防抖 320ms：合并连点与滑块拖动，避免每拖一格就重算一次。
  // · 同一时刻只跑一次，期间到来的新请求合并成「下一轮」，不排队堆积。
  // · 有手动编辑时不静默覆盖：改状态栏提示，并放出「重新生成」按钮作为显式出口。
  let autoGenTimer = null, autoGenRunning = false, autoGenQueued = false;
  async function runAutoGenerate() {
    if (!get().status.hasSource) return;
    if (autoGenRunning) { autoGenQueued = true; return; }
    if (bridge.getResult().manualEdited) {
      $("#ws-status").textContent = "参数已改 · 手动编辑未覆盖，点「重新生成」覆盖";
      return;
    }
    autoGenRunning = true;
    try {
      await generation.generate({ overwriteApproved: true });
    } catch (error) {
      $("#ws-status").textContent = error.message;
    } finally {
      autoGenRunning = false;
      if (autoGenQueued) { autoGenQueued = false; scheduleAutoGenerate(60); }
    }
  }
  function scheduleAutoGenerate(delay = 320) {
    if (autoGenTimer) clearTimeout(autoGenTimer);
    autoGenTimer = setTimeout(runAutoGenerate, delay);
  }

  let generationPanel;
  generationPanel = new GenerationPanel({
    root: "#generationPanel",
    initialState: { width: get().canvas.width || 104, height: get().canvas.height || 104, maxColors: get().palette.maxColors || 0 },
    onChange: (settings) => {
      const rawW = clamp(Math.round(Number(settings.width)) || 104, 10, 500);
      const rawH = clamp(Math.round(Number(settings.height)) || 104, 10, 500);
      const lock = Boolean(settings.lockAspectRatio);
      const prev = get().canvas;
      let w = rawW, h = rawH;
      if (lock) {
        if (rawW !== prev.width) { w = rawW; h = clamp(Math.round(rawW * sourceRatio()), 10, 500); }
        else if (rawH !== prev.height) { h = rawH; w = clamp(Math.round(rawH / sourceRatio()), 10, 500); }
      }
      if (w !== prev.width) bridge.setWidth(w);
      if (h !== prev.height) bridge.setHeight(h);
      bridge.setLockAspectRatio(lock);
      if (Number(settings.maxColors) !== get().palette.maxColors) palettes.setMaxColors(Number(settings.maxColors) || 0);
      store.setState({
        canvas: { width: w, height: h, lockAspectRatio: lock },
        generation: { engine: get().generation.engine, algorithm: get().generation.algorithm || "current", preset: settings.preset, sampling: ({ edge: "edge-aware", mean: "linear-mean" })[settings.sampling] || settings.sampling, detailProtection: settings.detailProtection, edgeProtection: settings.edgeProtection, cleanupStrength: settings.cleanupStrength, preserveHighlights: settings.preserveHighlights, preserveEyes: settings.preserveEyes, preserveMicroDetails: settings.preserveMicroDetails, backgroundRemoval: settings.backgroundRemoval, subjectCrop: Boolean(settings.subjectCrop), autoBackground: Boolean(settings.autoBackground), strokeProtection: Boolean(settings.strokeProtection), accentProtection: Boolean(settings.accentProtection), brightness: settings.brightness, contrast: settings.contrast, saturation: settings.saturation },
        status: { dirty: true },
      });
      if (w !== rawW || h !== rawH) generationPanel.setState({ width: w, height: h }, false);
      // 任何生成参数变化都直接重算，不再等用户点按钮。
      scheduleAutoGenerate();
    },
    onGenerate: async () => {
      if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
      try { await generation.generate({ overwriteApproved: true }); } catch (error) { $("#ws-status").textContent = error.message; }
    },
  });
  $("#ws-engine").addEventListener("change", (event) => {
    const engine = event.target.value;
    bridge.setGenerationEngine(engine);
    store.setState({ generation: { engine }, status: { dirty: true } });
    scheduleAutoGenerate(0);
  });
  // 算法引擎：与「引擎」正交。默认 current，选 bgs 才会走新算法模块。
  $("#ws-algorithm").addEventListener("change", (event) => {
    const algorithm = bridge.setAlgorithmEngine(event.target.value);
    store.setState({ generation: { algorithm }, status: { dirty: true } });
    scheduleAutoGenerate(0);
  });
  $("#ws-legacy-retry").addEventListener("click", async () => {
    $("#ws-engine").value = "legacy";
    bridge.setGenerationEngine("legacy");
    store.setState({ generation: { engine: "legacy" }, status: { generationError: null } });
    try { await generation.generate({ engine: "legacy", overwriteApproved: true }); }
    catch (error) { store.setState({ status: { generationError: error.message } }); }
  });
  $("#ws-bead-size").addEventListener("change", (event) => store.setState({ canvas: { beadSize: Number(event.target.value) } }));
  $("#ws-brand").addEventListener("change", (event) => { palettes.setActivePalette(event.target.value); refreshPaletteOptions(); scheduleAutoGenerate(0); });
  $("#ws-palette-size").addEventListener("change", (event) => { palettes.setActivePalette($("#ws-brand").value, Number(event.target.value)); refreshPaletteOptions(); scheduleAutoGenerate(0); });
  // 「重新生成」平时隐藏：只有存在手动编辑、自动生成主动让路时才出现，作为显式覆盖出口。
  $("#ws-generate").addEventListener("click", async () => { if (bridge.getResult().manualEdited && !await askConfirmation("重新生成会覆盖当前手动修改。继续吗？")) return;
    try { await generation.generate({ overwriteApproved: true }); } catch (error) { $("#ws-status").textContent = error.message; } });
  $("#ws-import-again").addEventListener("click", async () => {
    if (bridge.getResult().manualEdited && !await askConfirmation("换图会移除当前手动修改。继续吗？")) return;
    bridge.importImage({ overwriteApproved: true });
  });
  $("#ws-source-open").addEventListener("click", () => store.setState({ ui: { activePanel: "source" } }));
  $("#ws-open-editor").addEventListener("click", () => bridge.openEditor());
  $("#ws-making").addEventListener("click", () => bridge.openMaking());
  $("#ws-export").addEventListener("click", () => store.setState({ ui: { exportDrawerOpen: true } }));
  $("#ws-export-close").addEventListener("click", () => store.setState({ ui: { exportDrawerOpen: false } }));
  drawer.addEventListener("click", async (event) => { const button = event.target.closest("[data-ws-export]"); if (!button) return; try { $("#ws-export-message").textContent = "正在准备导出…"; await exports.export(button.dataset.wsExport); $("#ws-export-message").textContent = "已启动下载"; } catch (error) { $("#ws-export-message").textContent = error.message; } });
  [["#ws-export-grid","showGrid"],["#ws-export-codes","showCodes"],["#ws-export-coords","showCoordinates"]].forEach(([selector, field]) => $(selector).addEventListener("change", (event) => store.setState({ exportSettings: { pattern: { ...get().exportSettings.pattern, [field]: event.target.checked } } })));
  $("#ws-grid").addEventListener("change", (event) => store.setState({ view: { showGrid: event.target.checked } }));
  $("#ws-codes").addEventListener("change", (event) => store.setState({ view: { showCodes: event.target.checked } }));
  viewBar.addEventListener("click", (event) => { const button = event.target.closest("[data-ws-view]"); if (button) store.setState({ view: { mode: button.dataset.wsView } }); });
  const well = $("#ws-canvas-well"), layers = $("#ws-canvas-layers");
  const viewport = createViewportService(store, () => ({ viewportWidth: well.clientWidth, viewportHeight: well.clientHeight,
    gridWidth: bridge.getResult().width || 0, gridHeight: bridge.getResult().height || 0 }));
  const renderer = createCanvasRenderer(layers, viewport, () => bridge.getResult(), () => get().view, () => get().editor, () => get().reference, (code) => editorService.resolveColor(code));
  const sourceCanvas = $("#ws-source-canvas"), sourcePreview = $("#ws-source-preview");
  let sourceImage = null, sourceImageUrl = "", sourceLayout = null, sourceDrawPending = false, sourceDrag = null;
  const requestSourceDraw = () => { if (!sourceDrawPending) { sourceDrawPending = true; requestAnimationFrame(drawSourceEditor); } };
  const loadSourceEditorImage = () => {
    const url = bridge.getResult().sourceOriginalUrl;
    if (!url || url === sourceImageUrl) return;
    sourceImageUrl = url; sourceImage = null;
    const image = new Image(); image.onload = () => { if (sourceImageUrl === url) { sourceImage = image; requestSourceDraw(); } }; image.src = url;
  };
  const drawSourceEditor = () => {
    sourceDrawPending = false; if (get().ui.activePanel !== "source") return;
    loadSourceEditorImage(); if (!sourceImage) return;
    const dpr = Math.min(3,Math.max(1,window.devicePixelRatio||1)), w=well.clientWidth,h=well.clientHeight;
    sourceCanvas.width=Math.round(w*dpr); sourceCanvas.height=Math.round(h*dpr);
    sourceCanvas.style.width=`${w}px`; sourceCanvas.style.height=`${h}px`;
    const context=sourceCanvas.getContext("2d"); context.setTransform(dpr,0,0,dpr,0,0); context.clearRect(0,0,w,h);
    const scale=Math.min(Math.max(1,w-100)/sourceImage.naturalWidth,Math.max(1,h-100)/sourceImage.naturalHeight,1);
    sourceLayout={x:(w-sourceImage.naturalWidth*scale)/2,y:(h-sourceImage.naturalHeight*scale)/2,width:sourceImage.naturalWidth*scale,height:sourceImage.naturalHeight*scale};
    context.drawImage(sourceImage,sourceLayout.x,sourceLayout.y,sourceLayout.width,sourceLayout.height);
    const transform=bridge.getSourceTransform(), crop=transform.crop;
    if (crop) { const x=sourceLayout.x+crop.x*scale,y=sourceLayout.y+crop.y*scale,cw=crop.width*scale,ch=crop.height*scale;
      context.fillStyle="rgba(14,25,34,.45)"; context.fillRect(sourceLayout.x,sourceLayout.y,sourceLayout.width,Math.max(0,y-sourceLayout.y));
      context.fillRect(sourceLayout.x,y,Math.max(0,x-sourceLayout.x),ch); context.fillRect(x+cw,y,Math.max(0,sourceLayout.x+sourceLayout.width-x-cw),ch);
      context.fillRect(sourceLayout.x,y+ch,sourceLayout.width,Math.max(0,sourceLayout.y+sourceLayout.height-y-ch));
      context.strokeStyle="#ffffff";context.lineWidth=2;context.strokeRect(x,y,cw,ch); }
    const preview=renderSourceTransform(sourceImage,transform,660);
    sourcePreview.width=preview.width;sourcePreview.height=preview.height;
    sourcePreview.getContext("2d").drawImage(preview,0,0);
    const geometry=sourceOutputGeometry(sourceImage.naturalWidth,sourceImage.naturalHeight,transform);
    $("#ws-source-size").textContent=`处理后 ${geometry.width} × ${geometry.height} px · 生成时才写入图纸。`;
  };
  const sourceNorm = (event) => { if (!sourceLayout) return null; const p=point(event);
    return {x:clamp((p.x-sourceLayout.x)/sourceLayout.width,0,1),y:clamp((p.y-sourceLayout.y)/sourceLayout.height,0,1)}; };
  const sampleOriginalSource = (norm) => {
    if (!sourceImage || !norm) return;
    const x=Math.min(sourceImage.naturalWidth-1,Math.floor(norm.x*sourceImage.naturalWidth)),y=Math.min(sourceImage.naturalHeight-1,Math.floor(norm.y*sourceImage.naturalHeight));
    const sample=document.createElement("canvas");sample.width=1;sample.height=1;
    const ctx=sample.getContext("2d",{willReadFrequently:true});ctx.drawImage(sourceImage,x,y,1,1,0,0,1,1);
    const rgb=[...ctx.getImageData(0,0,1,1).data].slice(0,3);
    const hex="#"+rgb.map((channel)=>channel.toString(16).padStart(2,"0")).join("").toUpperCase();
    const matched=bridge.getNearestPaletteCandidates(rgb);
    $("#ws-source-sample").innerHTML=`<strong>原图 X${x+1} / Y${y+1} · RGB ${rgb.join(",")} · ${hex}</strong><p>现有色卡最近：${esc(matched.nearest || "—")}</p><div>${matched.candidates.map((color)=>`<button type="button" data-ws-source-candidate="${esc(color.code)}"><span class="ws-swatch" style="background:${esc(color.hex)}"></span>${esc(color.code)} · ΔE ${color.distance.toFixed(1)}</button>`).join("")}</div>`;
  };
  const setSourcePatch = (patch) => { bridge.setSourceTransform(patch); requestSourceDraw(); };
  $("#ws-source-ratio").addEventListener("change", (event) => setSourcePatch({cropRatio:event.target.value}));
  right.querySelectorAll("[data-ws-source-rotate]").forEach((button) => button.addEventListener("click", () => setSourcePatch({rotation:(bridge.getSourceTransform().rotation+Number(button.dataset.wsSourceRotate)+360)%360})));
  right.querySelectorAll("[data-ws-source-flip]").forEach((button) => button.addEventListener("click", () => { const key=button.dataset.wsSourceFlip; setSourcePatch({[key]:!bridge.getSourceTransform()[key]}); }));
  right.querySelectorAll("[data-ws-source-adjust]").forEach((input) => input.addEventListener("input", () => { const key=input.dataset.wsSourceAdjust; $("#ws-source-"+key+"-value").textContent=input.value; setSourcePatch({[key]:Number(input.value)}); }));
  right.querySelectorAll("[data-ws-source-expand]").forEach((input) => input.addEventListener("input", () => { if (input.value === "" || Number(input.value) < 0) return; setSourcePatch({expand:{[input.dataset.wsSourceExpand]:clamp(Number(input.value),0,500)}}); }));
  $("#ws-source-background").addEventListener("input", (event) => setSourcePatch({background:event.target.value}));
  $("#ws-source-pick-mode").addEventListener("click", () => store.setState({editor:{tool:"source-eyedropper"},ui:{activePanel:"source"}}));
  $("#ws-source-sample").addEventListener("click", (event) => { const button=event.target.closest("[data-ws-source-candidate]"); if (button) activateColor(button.dataset.wsSourceCandidate,false); });
  $("#ws-source-reset").addEventListener("click", () => { setSourcePatch(defaultSourceTransform()); $("#ws-source-ratio").value="free"; right.querySelectorAll("[data-ws-source-adjust]").forEach((input)=>{input.value="0"; $("#ws-source-"+input.dataset.wsSourceAdjust+"-value").textContent="0";});right.querySelectorAll("[data-ws-source-expand]").forEach((input)=>{input.value="0";});$("#ws-source-background").value="#ffffff"; });
  $("#ws-source-apply").addEventListener("click", async () => { if (bridge.getResult().manualEdited && !await askConfirmation("重新生成将覆盖当前人工编辑。继续吗？")) return;
    try { await generation.generate({overwriteApproved:true}); store.setState({ui:{activePanel:"project"}}); } catch(error) { $("#ws-source-size").textContent=error.message; } });
  let zoomControls;
  zoomControls = new ZoomControls({
    root: "#zoomControls",
    value: Math.round(get().view.zoom * 100),
    onChange: (value) => viewport.setZoom(value / 100),
    onFit: () => viewport.fitToViewport(),
  });
  const point = (event) => { const rect = well.getBoundingClientRect(); return { x: event.clientX - rect.left, y: event.clientY - rect.top }; };
  well.addEventListener("wheel", (event) => {
    if (!get().status.hasPattern) return;
    event.preventDefault(); viewport.zoomAroundPoint(get().view.zoom * Math.exp(-event.deltaY * 0.0015), point(event));
  }, { passive: false });
  // 右键在画布上用于取色，禁掉浏览器默认右键菜单，否则会和取色手势冲突。
  well.addEventListener("contextmenu", (event) => event.preventDefault());
  let drag = null, spaceDown = false;
  // 文字面板实例在下面（notify 定义之后）才创建：这里先声明，好让画布的指针分支
  // 能在闭包里引用到它 —— 指针回调是运行时才执行的，那时已经赋值。
  let textPanel = null;
  // 用 function 声明（会提升）而不是 const 箭头：画布指针分支注册得比这里早，
  // 虽然回调是运行时执行，但保持「谁先注册都能引用」的写法更不容易踩 TDZ。
  function currentTextLayers() { return get().editor.textLayers || []; }
  function setTextLayers(layers, activeId = null) { store.setState({ editor: { textLayers: layers, activeTextLayerId: activeId } }); }
  // ---- 形状工具：约束与预览 ----
  // Shift 把终点吸附到 8 个方向（直线）或等比外接框（矩形 / 圆形）。
  // 吸附在「格坐标」上完成，所以预览与最终落笔用的是同一组整数，不会出现半格误差。
  const constrainShapeEnd = (kind, start, end, constrain) => {
    if (!constrain) return end;
    const dx = end.x - start.x, dy = end.y - start.y;
    if (kind !== "line") {
      const size = Math.max(Math.abs(dx), Math.abs(dy));
      return { x: start.x + (dx < 0 ? -size : size), y: start.y + (dy < 0 ? -size : size) };
    }
    const length = Math.round(Math.hypot(dx, dy));
    const step = Math.PI / 4;
    const angle = Math.round(Math.atan2(dy, dx) / step) * step;
    return { x: start.x + Math.round(Math.cos(angle) * length), y: start.y + Math.round(Math.sin(angle) * length) };
  };
  const shapeOptions = () => ({ filled: get().editor.shapeFilled, size: get().editor.brushSize, shape: "round" });
  const updateShapePreview = (end, constrain) => {
    if (drag?.type !== "shape") return;
    const target = constrainShapeEnd(drag.kind, drag.start, end, constrain);
    drag.end = target;
    const cells = editorService.previewShape(drag.kind, drag.start, target, { ...shapeOptions(), ...symmetryOptions() });
    const color = get().editor.selectedColor ? editorService.resolveColor(get().editor.selectedColor) : null;
    store.setState({ editor: { shapePreview: { cells, hex: color?.hex || null } } });
  };
  well.addEventListener("pointerdown", (event) => {
    if (get().ui.activePanel === "source") { const norm=sourceNorm(event); if (!norm || !sourceImage || !sourceLayout || event.button !== 0) return;
      if (get().editor.tool === "source-eyedropper") { sampleOriginalSource(norm); return; }
      well.setPointerCapture(event.pointerId); sourceDrag={ start:norm, previous:bridge.getSourceTransform().crop, moved:false }; return; }
    if (!get().status.hasPattern) return;
    const tool = get().editor.tool, p = point(event), cell = viewport.screenToGrid(p.x, p.y);
    // 右键取色：在任意工具下都能从画布取色设为当前色，不切换工具、不改图纸。
    // 与「取色」工具的区别：工具是点一下取完自动切回画笔；右键是纯取色，工具态不动。
    if (event.button === 2 && cell) {
      const picked = editorService.getCell(cell.x, cell.y);
      if (picked) activateColor(picked.code, false);
      return;
    }
    if (tool === "pan" || spaceDown || event.button === 1) {
      well.setPointerCapture(event.pointerId); drag = { type: "pan", x: event.clientX, y: event.clientY, panX: get().view.panX, panY: get().view.panY };
      well.classList.add("is-panning"); return;
    }
    if (event.button !== 0 || get().view.mode === "original") return;
    if (tool === "replace" && cell) {
      const code = editorService.getCell(cell.x, cell.y)?.code || "";
      $("#ws-replace-from").value = code;
      $("#ws-replace-impact").textContent = `影响 ${affectedCount(code).toLocaleString("zh-CN", { useGrouping: false })} 颗`;
      store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "color" } }); return;
    }
    if (tool === "region" && cell) { well.setPointerCapture(event.pointerId); drag = { type: "region", start: cell }; store.setState({ editor: { selection: rectangularSelection(cell.x, cell.y, cell.x, cell.y, bridge.getResult().width, bridge.getResult().height) } }); return; }
    if (tool === "wand" && cell) {
      // 默认「重新圈选」；按住 Shift 在当前选区内叠加，按住 Alt 从当前选区里减掉。
      // 默认就限制在旧选区内会让人点不出新区域，这个交互坑过一次，故改为行业惯用的修饰键语义。
      const current = get().editor.selection;
      let selection;
      if (event.altKey && current?.mask) {
        const hits = magicWandSelection(bridge.getResult().grid, cell.x, cell.y, { tolerance: get().editor.wandTolerance });
        const rest = hits?.mask
          ? [...current.mask].filter((id) => !hits.mask.has(id)).map((id) => { const [x, y] = id.split(",").map(Number); return { x, y }; })
          : [];
        selection = fitSelectionBox(rest, "magic-wand");
      } else {
        selection = magicWandSelection(bridge.getResult().grid, cell.x, cell.y, { tolerance: get().editor.wandTolerance, within: event.shiftKey ? current : null });
      }
      store.setState({ editor: { selection, selectedCell: cell }, ui: { activePanel: "edit" } }); return;
    }
    if (SHAPE_TOOLS[tool] && cell) {
      if (!get().editor.selectedColor) { store.setState({ ui: { activePanel: "edit" } }); return; }
      well.setPointerCapture(event.pointerId);
      drag = { type: "shape", kind: SHAPE_TOOLS[tool], start: cell, end: cell };
      updateShapePreview(cell, event.shiftKey);
      return;
    }
    if (["same","connected"].includes(tool) && cell) { const original = get().editor.selection, selection = tool === "same" ? sameColorSelection(bridge.getResult().grid, cell.x, cell.y, original) : connectedSelection(bridge.getResult().grid, cell.x, cell.y, original); store.setState({ editor: { selection, selectedCell: cell }, ui: { activePanel: "edit" } }); return; }
    if (tool === "fill" && cell) { const selected = get().editor.selectedColor; if (selected) editorService.fillAt(cell.x, cell.y, selected, symmetryOptions()); store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "edit" } }); return; }
    if (["brush","eraser"].includes(tool) && cell) {
      const selected = get().editor.selectedColor;
      if (tool === "brush" && !selected) { store.setState({ ui: { activePanel: "edit" } }); return; }
      well.setPointerCapture(event.pointerId); drag = { type: "stroke" };
      editorService.beginStroke(tool === "brush" ? selected : null, { size: get().editor.brushSize, shape: "round", ...symmetryOptions() });
      editorService.strokeCell(cell.x, cell.y); renderer.requestDraw();
      return;
    }
    if (tool === "eyedropper" && cell) {
      const color = editorService.getCell(cell.x, cell.y); if (color) activateColor(color.code,false);
      store.setState({ editor: { selectedCell: cell, tool: "brush" }, ui: { activePanel: "edit" } }); return;
    }
    if (tool === "bead" && cell) {
      const selected = get().editor.selectedColor;
      if (selected) editorService.setCellColor(cell.x, cell.y, selected, symmetryOptions());
      store.setState({ editor: { selectedCell: cell }, ui: { activePanel: "edit" } }); return;
    }
    // 文字工具：点已有文字 = 选中并拖动；点空白 = 就地新建一个图层。
    // 文字是「浮动图层」，只画在 overlay 层、不写 grid，所以从放到拖全程撤销栈都是干净的，
    // 只有「向下合并」才产生一步历史。
    if (tool === "text") {
      const { w, h } = gridSize();
      // 用连续格坐标（含小数）：拖动取整交给栅格化那一步，手感才连续不跳格。
      const at = viewport.screenToGridFloat(p.x, p.y);
      const hit = [...currentTextLayers()].reverse()
        .find((layer) => layerContainsCell(layer, w, h, Math.floor(at.x), Math.floor(at.y)));
      if (hit) {
        store.setState({ editor: { activeTextLayerId: hit.id } });
        well.setPointerCapture(event.pointerId);
        drag = { type: "text-move", id: hit.id, grabX: at.x - hit.x, grabY: at.y - hit.y, moved: false };
        renderer.requestDraw();
        return;
      }
      const selected = get().editor.selectedColor;
      if (!selected) { store.setState({ ui: { activePanel: "edit" } }); notify("先在「色彩」里选一个色号，再在画布上放文字。"); return; }
      const layer = createTextLayer({ x: Math.round(at.x), y: Math.round(at.y), color: selected });
      setTextLayers([...currentTextLayers(), layer], layer.id);
      store.setState({ ui: { activePanel: "edit" } });
      well.setPointerCapture(event.pointerId);
      drag = { type: "text-move", id: layer.id, grabX: 0, grabY: 0, moved: false };
      renderer.requestDraw();
      return;
    }
    store.setState({ editor: { selectedCell: cell, selection: null }, ui: { activePanel: cell ? "edit" : get().ui.activePanel } });
  });
  well.addEventListener("pointermove", (event) => {
    if (sourceDrag) { const norm=sourceNorm(event); if (!norm || !sourceImage) return;
      if (Math.abs(norm.x-sourceDrag.start.x)*sourceLayout.width+Math.abs(norm.y-sourceDrag.start.y)*sourceLayout.height < 5) return;
      sourceDrag.moved=true; setSourcePatch({crop:cropFromDrag(sourceDrag.start.x,sourceDrag.start.y,norm.x,norm.y,sourceImage.naturalWidth,sourceImage.naturalHeight,$("#ws-source-ratio").value)}); return; }
    if (!get().status.hasPattern) return;
    const p = point(event), cell = viewport.screenToGrid(p.x, p.y);
    if (drag?.type === "pan") { viewport.setPan(drag.panX + event.clientX - drag.x, drag.panY + event.clientY - drag.y); return; }
    if (drag?.type === "region" && cell) { store.setState({ editor: { selection: rectangularSelection(drag.start.x, drag.start.y, cell.x, cell.y, bridge.getResult().width, bridge.getResult().height) } }); return; }
    if (drag?.type === "stroke") { if (cell) { editorService.strokeCell(cell.x, cell.y); renderer.requestDraw(); } return; }
    if (drag?.type === "shape") {
      // 形状用夹取后的坐标：拖出画布边界时端点停在边界格上，继续跟随鼠标。
      updateShapePreview(viewport.screenToGridClamped(p.x, p.y), event.shiftKey);
      return;
    }
    if (drag?.type === "text-move") {
      // 拖动只改浮动图层的 x/y，一格豆都不写：所以拖多远撤销栈都是干净的。
      // 不夹边界 —— 拖出画布时文字继续跟着走，否则会「粘」在边上。
      const at = viewport.screenToGridFloat(p.x, p.y);
      setTextLayers(currentTextLayers().map((layer) => (layer.id === drag.id ? { ...layer, x: at.x - drag.grabX, y: at.y - drag.grabY } : layer)), drag.id);
      return;
    }
    const old = get().editor.hoveredCell;
    if (old?.x !== cell?.x || old?.y !== cell?.y) store.setState({ editor: { hoveredCell: cell } });
  });
  const endDrag = (cancel = false) => { if (sourceDrag) { if (cancel && sourceDrag.moved) setSourcePatch({crop:sourceDrag.previous}); sourceDrag=null; requestSourceDraw(); }
    if (drag?.type === "stroke") cancel ? editorService.cancelStroke() : editorService.endStroke();
    if (drag?.type === "shape") {
      const selected = get().editor.selectedColor;
      // 预览只活在 overlay 层，所以这里才产生唯一的一步历史；取消则直接丢弃预览。
      if (!cancel && selected) editorService.applyShape(drag.kind, drag.start, drag.end || drag.start, selected, { ...shapeOptions(), ...symmetryOptions() });
      store.setState({ editor: { shapePreview: null } });
    }
    drag = null; well.classList.remove("is-panning"); renderer.requestDraw(); };
  well.addEventListener("pointerup", () => endDrag()); well.addEventListener("pointercancel", () => endDrag(true));

  function renderPicker() {
    const query = $("#ws-color-search").value.trim().toUpperCase();
    const normalized = query.replace(/^([A-Z]+)(\d{1,2})$/, (_, series, number) => series + number.padStart(2,"0"));
    const palette = editorService.getPaletteColors(), categories = ["all", ...new Set(palette.map((color) => color.code.match(/^[A-Z]+/)?.[0]).filter(Boolean))];
    $("#ws-palette-categories").innerHTML = categories.map((category) => `<button type="button" data-ws-category="${esc(category)}" class="${get().editor.paletteCategory === category ? "active" : ""}">${category === "all" ? "全部" : esc(category)}</button>`).join("");
    $("#ws-recent-colors").innerHTML = get().editor.recentColors.length ? `最近 · ${get().editor.recentColors.map((code)=>`<button type="button" data-ws-pick="${esc(code)}">${esc(code)}</button>`).join("")}` : "";
    const colors = palette.filter((color) => (get().editor.paletteCategory === "all" || color.code.startsWith(get().editor.paletteCategory)) && (!query || color.code.toUpperCase().includes(query) || color.code.toUpperCase().includes(normalized) || String(color.name || "").toUpperCase().includes(query)));
    $("#ws-bead-picker").innerHTML = colors.map((color) => `<button type="button" data-ws-pick="${esc(color.code)}" title="${esc(color.name || color.code)} · 使用 ${editorService.getColorUsage(color.code)} 颗" class="${get().editor.selectedColor === color.code ? "active" : ""}"><span style="background:${esc(color.hex)}"></span><small>${esc(color.code)}</small></button>`).join("") || '<p class="ws-note">没有匹配的色号。</p>';
  }
  const paint = (state, patch = {}) => {
    // 拖拽过程中的高频更新（悬停格、形状预览）只重绘画布，不走整块面板重建，
    // 否则每移动一格就要重排一次调色板与库存表，手感会拖沓。
    if (patch.editor && Object.keys(patch).length === 1 && Object.keys(patch.editor).every((key) => key === "hoveredCell" || key === "shapePreview")) { renderer.requestDraw(); return; }
    // 文字图层的高频更新（拖动、打字、拖字号滑块）同理：只重绘画布叠加层 + 刷新文字面板，
    // 走整块 paint 的话每动一下都要重排调色板和库存表，拖起来会明显发涩。
    if (patch.editor && Object.keys(patch).length === 1
      && Object.keys(patch.editor).every((key) => key === "textLayers" || key === "activeTextLayerId" || key === "textRecentColors")) {
      renderTextPanel(state); renderer.requestDraw(); return;
    }
    if (patch.view && Object.keys(patch).length === 1 && Object.keys(patch.view).every((key) => ["zoom","panX","panY"].includes(key))) {
      zoomControls.setZoom(Math.round(state.view.zoom * 100), false);
      $("#ws-canvas-hint").textContent = canvasHint(state.view);
      if (buildActive()) updateBuildOverlay();
      renderer.requestDraw(); return;
    }
    const hasSource = state.status.hasSource, hasPattern = state.status.hasPattern;
    // 源图一变（新导入 / 恢复会话）就重新识别像素倍数。挂在 paint 上而不是只挂
    // libms:source-loaded，否则「恢复上次会话」这条路径永远识别不到，倍数会停在 1×。
    detectMultipleFor(state.source.image);
    importView.hidden = hasSource || hasPattern; canvas.hidden = !hasSource && !hasPattern;
    // 「重新生成」平时不显示：只有存在手动编辑、自动生成主动让路时，才作为显式覆盖出口出现。
    const manualEdited = Boolean(bridge.getResult().manualEdited);
    $("#ws-generate").hidden = !(hasSource && manualEdited);
    $("#ws-generate").disabled = !hasSource || state.status.generating;
    $("#ws-engine").value = state.generation.engine || "v2.5";
    $("#ws-algorithm").value = state.generation.algorithm || "current";
    $("#ws-source-open").hidden = !hasSource;
    right.querySelector('.ws-side-tabs [data-ws-panel="source"]').disabled = !hasSource;
    $("#ws-import-again").hidden = !hasSource;
    $("#ws-making").disabled = !hasPattern; $("#ws-export").disabled = !hasPattern; $("#ws-open-editor").disabled = !hasPattern;
    $("#ws-status").textContent = state.status.generationError ? `生成失败：${state.status.generationError}` : state.status.generating ? "正在生成" : bridge.getResult().manualEdited ? "已手动编辑" : state.status.dirty ? "参数待更新" : hasPattern ? "已生成" : hasSource ? "图片已导入" : "未开始";
    $("#ws-legacy-retry").hidden = !state.status.generationError;
    if (document.activeElement !== top.querySelector("#ws-project-name")) top.querySelector("#ws-project-name").value = state.project.name;
    right.querySelector(".ws-side-tabs").querySelectorAll("[data-ws-panel]").forEach((button) => { button.classList.toggle("active", button.dataset.wsPanel === state.ui.activePanel); button.disabled = button.dataset.wsPanel === "source" && !hasSource; });
    right.querySelectorAll("[data-ws-inspector]").forEach((panel) => { panel.hidden = panel.dataset.wsInspector !== state.ui.activePanel; });
    const titles = { project: "作品", source: "图片调整", color: "色彩", edit: "编辑", check: "检查", inventory: "库存", build: "施工" }; $("#ws-inspector-title").textContent = titles[state.ui.activePanel] || "";
    // 施工模式下右栏整体换成施工面板，6 个 tab 收起
    const buildMode = document.body.classList.contains("ws-mode-build");
    right.querySelector(".ws-side-tabs").hidden = buildMode;
    left.querySelectorAll("[data-ws-mode]").forEach((button) => button.classList.toggle("active", button.dataset.wsMode === (buildMode ? "build" : "edit")));
    const sourceActive=state.ui.activePanel === "source" && hasSource;
    sourceCanvas.hidden = !sourceActive; layers.style.visibility = sourceActive ? "hidden" : "visible";
    if (sourceActive) requestSourceDraw();
    $("#ws-bead-size").value = String(state.canvas.beadSize);
    $("#ws-physical-size").textContent = state.status.dirty && !bridge.getResult().manualEdited ? "参数已修改 · 重新生成后显示实际尺寸" : hasPattern ? `${state.canvas.width} × ${state.canvas.height} 豆 · 约 ${(state.canvas.width * state.canvas.beadSize / 10).toFixed(1)} × ${(state.canvas.height * state.canvas.beadSize / 10).toFixed(1)} cm` : "导入后显示实际尺寸";
    $("#ws-used-colors").textContent = hasPattern ? `实际使用 ${state.stats.usedColors} 色 · ${state.stats.totalBeads.toLocaleString("zh-CN", { useGrouping: false })} 颗${state.palette.maxColors > 0 && state.stats.usedColors > state.palette.maxColors ? ` · 手动编辑超过生成限制 ${state.palette.maxColors} 色` : ""}` : "尚未生成";
    // 画布下方的用量汇总条：这里同样只在数值真的变了才写 DOM（paint 每次状态变化都会被调用）。
    const statsBar = $("#ws-canvas-stats");
    if (statsBar) {
      const colorText = (hasPattern ? state.stats.usedColors : 0).toLocaleString("zh-CN", { useGrouping: false });
      const beadText = (hasPattern ? state.stats.totalBeads : 0).toLocaleString("zh-CN", { useGrouping: false });
      const colorNode = $("#ws-stats-colors"), beadNode = $("#ws-stats-beads");
      if (colorNode && colorNode.textContent !== colorText) colorNode.textContent = colorText;
      if (beadNode && beadNode.textContent !== beadText) beadNode.textContent = beadText;
      statsBar.classList.toggle("is-empty", !hasPattern);
    }
    // 施工模式：图纸变了要重算区块与颜色，视图变了要重定位叠加层
    if (buildActive()) { if (patch.stats || patch.status) { renderBlockMap(); renderBlockColors(); } updateBuildOverlay(); }
    if (patch.stats || patch.status || patch.editor?.highlightedColor) $("#ws-color-list").innerHTML = state.stats.colors.map((color) => `<button type="button" data-ws-color="${esc(color.code)}" class="ws-color-row ${state.editor.highlightedColor === color.code ? "active" : ""}"><span class="ws-swatch" style="background:${esc(color.hex)}"></span><span>${esc(color.code)}</span><small>${color.count.toLocaleString("zh-CN", { useGrouping: false })}</small></button>`).join("") || '<p class="ws-note">生成图纸后显示色号与数量。</p>';
    const checks = bridge.getChecks(); $("#ws-check-results").innerHTML = hasPattern ? `<p>尺寸：${state.canvas.width} × ${state.canvas.height}</p><p>颜色：${state.stats.usedColors} 色${checks.validation?.valid === false ? " · 超出当前上限" : " · 已校验"}</p>${checks.structural ? `<p>结构检测：${esc(JSON.stringify(checks.structural))}</p>` : ""}` : "生成后显示可验证的尺寸、色数与结构报告。";
    viewBar.querySelectorAll("[data-ws-view]").forEach((button) => { button.classList.toggle("active", button.dataset.wsView === state.view.mode); button.disabled = button.dataset.wsView === "original" && !hasSource; });
    $("#ws-grid").checked = state.view.showGrid; $("#ws-codes").checked = state.view.showCodes;
    zoomControls.setZoom(Math.round(state.view.zoom * 100), false);
    gridToolbar.setActiveTool(state.editor.tool);
    // 顶栏扩展工具条与底栏画笔工具栏同源同步高亮，避免两边选中态不一致。
    extendedToolbar?.setActiveTool(state.editor.tool);
    // 顶栏图纸尺寸预设高亮跟随当前画布尺寸。
    syncSizeChips();
    // 取色按钮的色块跟随当前色：右键取色 / 调色板选色 / 取色工具点选都会更新这里。
    gridToolbar.setEyedropperColor(state.editor.selectedColor ? (editorService.resolveColor(state.editor.selectedColor)?.hex || null) : null);
    // 只在值真的变了才写 DOM：paint 会在每次状态变化时被调用，无条件赋值会白刷控件。
    if (gridToolbar.brushSize !== state.editor.brushSize) gridToolbar.setBrushSize(state.editor.brushSize);
    gridToolbar.setShapeFilled(state.editor.shapeFilled);
    $("#ws-brush-size").disabled = !hasPattern;
    $("#ws-brush-size").value = String(state.editor.brushSize);
    $("#ws-brush-size-value").textContent = String(state.editor.brushSize);
    $("#ws-shape-filled").disabled = !hasPattern;
    $("#ws-shape-filled").checked = state.editor.shapeFilled;
    $("#ws-symmetry-horizontal").checked = state.editor.symmetryHorizontal;
    $("#ws-symmetry-vertical").checked = state.editor.symmetryVertical;
    $("#ws-symmetry-horizontal").disabled = !hasPattern;
    $("#ws-symmetry-vertical").disabled = !hasPattern;
    $("#ws-wand-tolerance").disabled = !hasPattern;
    $("#ws-wand-tolerance-value").textContent = String(state.editor.wandTolerance);
    const hasSelection = Boolean(state.editor.selection);
    ["#ws-erase-selection", "#ws-clear-selection", "#ws-copy-selection", "#ws-cut-selection"].forEach((selector) => { $(selector).disabled = !hasSelection; });
    // 反选在「没有选区」时等价于全选，所以只要有图纸就可用。
    $("#ws-invert-selection").disabled = !hasPattern;
    $("#ws-paste-selection").disabled = !editorService.hasClipboard() || !hasPattern;
    $("#ws-select-all").disabled = !hasPattern;
    const selected = state.editor.selectedCell;
    const selectedColor = selected ? editorService.getCell(selected.x, selected.y) : null;
    $("#ws-cell-details").innerHTML = state.editor.selection ? `<strong>${esc({rectangle:"矩形", "same-color":"同色",connected:"连通", "magic-wand":"魔棒", inverse:"反选", selection:"区域"}[state.editor.selection.kind] || "区域")}选区 · ${selectionCells(state.editor.selection, state.canvas.width, state.canvas.height).length.toLocaleString("zh-CN", { useGrouping: false })} 豆</strong><p>X ${state.editor.selection.x0 + 1}–${state.editor.selection.x1 + 1} · Y ${state.editor.selection.y0 + 1}–${state.editor.selection.y1 + 1}</p><p>选区换色、擦除与描边仅影响对应豆格。方向键可整体搬移。</p>` : selected ? `<strong>${esc(selectedColor?.code || "空白")}</strong><p>位置 · X ${selected.x + 1} / Y ${selected.y + 1}</p><p>${selectedColor ? `${esc(selectedColor.hex || "")} · RGB ${esc(selectedColor.rgb?.join(",") || "")}` : "真正空豆"}</p><p>使用 · ${selectedColor ? editorService.getColorUsage(selectedColor.code).toLocaleString("zh-CN", { useGrouping: false }) : 0} 颗</p>` : "用选择工具点击画布中的一颗豆。";
    const toolInfo = {select:"选择 · 点击查看豆格",bead:"单豆 · 选中色号后点击豆格",brush:"画笔 · 拖动为一笔历史，笔宽见检查器",eraser:"橡皮 · 拖动擦成真正空豆，笔宽见检查器",fill:"填充 · 四方向连续色块",line:"直线 · 从起点拖到终点，Shift 吸附 45°",rect:"矩形 · 拖出外接框，Shift 约束正方形",ellipse:"圆形 · 拖出外接框，Shift 约束正圆",region:"框选 · 拖出矩形选区",wand:"魔棒 · 按色差容差圈选连续区域，Shift 叠加 / Alt 减掉",same:"同色选择 · 点击任意豆格",connected:"连通选择 · 点击连续色块",eyedropper:"取色 · 点击豆格设置当前色","source-eyedropper":"原图取色 · 点击中央原图",outline:"描边 · 先选择区域再应用",replace:"换色 · 在色彩面板设置色号",pan:"移动 · 拖动画布",text:"文字 · 点画布放一个文字图层，拖动可移动；调好字体/颜色/字号后点「向下合并」写进图纸"};
    $("#ws-tool-details").textContent = `${toolInfo[state.editor.tool] || state.editor.tool}${state.editor.selectedColor ? ` · 当前 ${state.editor.selectedColor}` : ""}`;
    $("#ws-history-label").textContent = editorService.getHistory().at(-1)?.label || "";
    $("#ws-undo").disabled = !state.editor.history.canUndo; $("#ws-redo").disabled = !state.editor.history.canRedo;
    gridToolbar.setHistory(state.editor.history.canUndo, state.editor.history.canRedo);
    // 变换类动作按钮需要图纸（或原图）才可用；底栏画笔坞与顶栏扩展条两处都要同步禁用。
    const setActionDisabled = (action, disabled) => {
      const inDock = toolRail.querySelector(`[data-panel="${action}"]`);
      if (inDock) inDock.disabled = disabled;
      const inTop = extendedToolbar?.root.querySelector(`[data-panel="${action}"]`);
      if (inTop) inTop.disabled = disabled;
    };
    ["mirror", "mirror-vertical", "rotate-cw", "rotate-ccw", "replace", "outline"].forEach((action) => setActionDisabled(action, !hasPattern));
    setActionDisabled("compare", !hasSource);
    syncReferenceUi(state);
    if (patch.editor?.selectedColor || patch.editor?.paletteCategory || patch.stats || patch.ui?.activePanel === "edit") renderPicker();
    // 文字面板：字体/颜色/加粗倾斜/字号/旋转/落豆数都要每次状态变化回灌一次。
    // 面板内部用「结构签名」自己判断该不该重建 DOM，所以这里无条件调用是安全的。
    renderTextPanel(state);
    drawer.classList.toggle("open", state.ui.exportDrawerOpen); const tileSize = bridge.getTileSize() || 52; $("#ws-boards-choice").hidden = !hasPattern || (state.canvas.width <= tileSize && state.canvas.height <= tileSize);
    drawer.querySelectorAll("[data-ws-export]").forEach((button) => { button.disabled = !exports.isAvailable(button.dataset.wsExport); });
    if (patch.view || patch.editor || patch.stats || patch.status || patch.source || patch.reference) renderer.requestDraw();
    // 库存面板只在图纸/项目状态变化时重建；库存自身的变更由它自己订阅，避免每次鼠标移动都重排表格
    if (patch.status || patch.stats) inventoryPanel?.render();
    $("#ws-canvas-hint").textContent = canvasHint(state.view);
  };
  const affectedCount = (code) => {
    const selection = get().editor.selection;
    if (!selection) return editorService.getColorUsage(code);
    let count = 0; bridge.getResult().grid.forEach((row, y) => row.forEach((color, x) => {
      if (color?.code === code && selectionContains(selection, x, y)) count++;
    })); return count;
  };
  $("#ws-color-list").addEventListener("click", (event) => { const row = event.target.closest("[data-ws-color]"); if (!row) return;
    const code = row.dataset.wsColor; $("#ws-replace-from").value = code; $("#ws-replace-impact").textContent = `影响 ${affectedCount(code).toLocaleString("zh-CN", { useGrouping: false })} 颗`;
    store.setState({ editor: { highlightedColor: get().editor.highlightedColor === code ? null : code } }); });
  $("#ws-replace-from").addEventListener("input", (event) => { $("#ws-replace-impact").textContent = `影响 ${affectedCount(event.target.value.trim().toUpperCase()).toLocaleString("zh-CN", { useGrouping: false })} 颗`; });
  $("#ws-replace-confirm").addEventListener("click", () => {
    const from = $("#ws-replace-from").value.trim().toUpperCase(), to = $("#ws-replace-to").value.trim().toUpperCase();
    const count = affectedCount(from);
    if (!count || !editorService.resolveColor(to)) { $("#ws-replace-impact").textContent = "请填写作品中存在的来源色号和当前色卡中的目标色号。"; return; }
    askConfirmation(`将 ${count} 颗 ${from} 替换为 ${to}？`).then((accepted) => { if (accepted) editorService.replaceColor(from, to, get().editor.selection); });
  });
  $("#ws-color-search").addEventListener("input", renderPicker);
  $("#ws-palette-categories").addEventListener("click", (event) => { const button = event.target.closest("[data-ws-category]"); if (button) store.setState({ editor: { paletteCategory: button.dataset.wsCategory } }); });
  const activateColor = (code, applySelected = true) => {
    const color = editorService.resolveColor(code); if (!color) return;
    const selected = get().editor.selectedCell, tool = get().editor.tool;
    store.setState({ editor: { selectedColor: color.code, recentColors: [color.code, ...get().editor.recentColors.filter((item) => item !== color.code)].slice(0,10), tool: tool === "select" && selected ? "bead" : tool } });
    if (applySelected && selected && ["select","bead"].includes(tool)) editorService.setCellColor(selected.x, selected.y, color.code);
  };
  ["#ws-bead-picker","#ws-recent-colors"].forEach((selector) => $(selector).addEventListener("click", (event) => { const button = event.target.closest("[data-ws-pick]"); if (button) activateColor(button.dataset.wsPick); }));
  $("#ws-erase-selection").addEventListener("click", () => editorService.eraseSelection(get().editor.selection));
  $("#ws-clear-selection").addEventListener("click", () => store.setState({ editor: { selection: null, shapePreview: null } }));
  $("#ws-apply-outline").addEventListener("click", () => editorService.outline(get().editor.selection, get().editor.selectedColor, $("#ws-outline-diagonal").checked));
  $("#ws-undo").addEventListener("click", () => editorService.undo()); $("#ws-redo").addEventListener("click", () => editorService.redo());

  const rotateGridAction = async (turns) => {
    if (!get().status.hasPattern) return;
    if (!editorService.canRotate()) { $("#ws-history-label").textContent = "当前页面不支持整幅旋转。"; return; }
    const { width, height } = bridge.getResult();
    // 90°/270° 会交换宽高，按旧宽高记录的豆格级历史坐标不再可信，需要用户知情。
    if (turns % 2 === 1 && width !== height) {
      const accepted = await askConfirmation(`旋转后画布由 ${width} × ${height} 变为 ${height} × ${width}，按旧宽高记录的编辑历史会被清除（旋转本身仍可撤销）。继续吗？`);
      if (!accepted) return;
    }
    if (!editorService.rotate(turns)) $("#ws-history-label").textContent = "旋转未执行。";
  };

  const referenceInput = $("#ws-ref-file");
  const syncReferenceUi = (state = get()) => {
    const hasReference = Boolean(state.reference.url);
    $("#ws-ref-fit").value = state.reference.fit;
    $("#ws-ref-opacity").value = String(state.reference.opacity);
    $("#ws-ref-opacity-value").textContent = `${state.reference.opacity}%`;
    $("#ws-ref-visible").checked = state.reference.visible !== false;
    ["#ws-ref-clear", "#ws-ref-fit", "#ws-ref-opacity", "#ws-ref-visible"].forEach((selector) => { $(selector).disabled = !hasReference; });
  };
  $("#ws-ref-pick").addEventListener("click", () => referenceInput.click());
  referenceInput.addEventListener("change", () => {
    const file = referenceInput.files?.[0];
    referenceInput.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => store.setState({ reference: { url: String(reader.result || ""), visible: true, fit: get().reference.fit } });
    reader.readAsDataURL(file);
  });
  $("#ws-ref-clear").addEventListener("click", () => store.setState({ reference: { url: "", visible: true } }));
  $("#ws-ref-fit").addEventListener("change", (event) => store.setState({ reference: { fit: event.target.value } }));
  $("#ws-ref-opacity").addEventListener("input", (event) => {
    const value = clamp(Math.round(Number(event.target.value) || 0), 0, 100);
    $("#ws-ref-opacity-value").textContent = `${value}%`;
    store.setState({ reference: { opacity: value } });
  });
  $("#ws-ref-visible").addEventListener("change", (event) => store.setState({ reference: { visible: event.target.checked } }));

  // .pixler = ZIP 封装的结构化项目文件。判定不只看后缀：再看 ZIP 签名 PK。
  const isPixlerFile = async (file) => {
    if (/\.pixler$/i.test(file.name || "")) return true;
    try {
      const head = new Uint8Array(await file.slice(0, 4).arrayBuffer());
      return String.fromCharCode(head[0], head[1]) === "PK";
    } catch {
      return false;
    }
  };

  let pixlerNote = "";
  const loadPixlerProject = async (file) => {
    const { importPixlerProject } = await import("../importers/pixler.mjs?v=20260922-pixler1");
    const result = await importPixlerProject(file, { palette: editorService.getPaletteColors?.() || [] });
    const info = result.report;
    window.LibmsPixlerLastReport = info;
    pixlerNote = `已载入 Pixler · ${info.columns}×${info.rows} · ${info.usedColors} 色 / ${info.totalBeads} 颗`;
    if (!info.beadMatchSynced) pixlerNote += " · 文件内色号表与网格不同步，已按 CIEDE2000 重新匹配";
    if (info.unresolvedCells) pixlerNote += ` · ${info.unresolvedCells} 格无匹配色号`;
    if (info.restoredSettings?.gridVisible) bridge.setEditorGridVisible?.(true);
    return JSON.stringify(result.project);
  };

  const projectFileInput = $("#ws-project-file");
  $("#ws-project-import").addEventListener("click", () => projectFileInput.click());
  projectFileInput.addEventListener("change", async () => {
    const file = projectFileInput.files?.[0];
    projectFileInput.value = "";
    if (!file) return;
    if (!await askConfirmation("载入工程存档会替换当前图纸，未保存的手动编辑将丢失。继续吗？")) return;
    try {
      // .pixler 是结构化项目文件：走原生解析，绝不转成图片再识别（避免二次损失）。
      const isPixler = await isPixlerFile(file);
      const payload = isPixler ? await loadPixlerProject(file) : await file.text();
      bridge.loadProjectJson(payload);
      editorService.clearHistory();
      store.setState({
        editor: { tool: "select", selectedCell: null, selection: null, hoveredCell: null, highlightedColor: null },
        ui: { exportDrawerOpen: false },
      });
      viewport.fitToViewport();
      if (pixlerNote) $("#ws-export-message").textContent = pixlerNote;
    } catch (error) {
      $("#ws-export-message").textContent = error.message;
    }
  });
  let compareMode = null;
  const endCompare = () => { if (compareMode) { store.setState({ view: { mode: compareMode } }); compareMode = null; } };
  const toggleCompare = () => { if (!get().status.hasSource) return; if (compareMode) endCompare(); else { compareMode = get().view.mode; store.setState({ view: { mode: "original" } }); } };
  $("#ws-compare").addEventListener("pointerdown", (event) => { if (!get().status.hasSource) return;
    compareMode = get().view.mode; event.currentTarget.setPointerCapture(event.pointerId); store.setState({ view: { mode: "original" } }); });
  $("#ws-compare").addEventListener("pointerup", endCompare); $("#ws-compare").addEventListener("pointercancel", endCompare);
  const gridToolbar = new GridEditorToolbar({
    root: toolRail,
    activeTool: get().editor.tool,
    brushSize: get().editor.brushSize,
    shapeFilled: get().editor.shapeFilled,
    onToolChange: (tool) => store.setState({ editor: { tool }, ui: { activePanel: tool === "source-eyedropper" ? "source" : tool === "replace" ? "color" : "edit" } }),
    onBrushSizeChange: (size) => store.setState({ editor: { brushSize: size } }),
    onShapeFilledChange: (filled) => store.setState({ editor: { shapeFilled: filled } }),
    onPanelAction: (action) => {
      if (action === "undo") { editorService.undo(); return; }
      if (action === "redo") { editorService.redo(); return; }
      if (action === "help") { gridToolbar.openHelp(); return; }
      if (action === "mirror") { editorService.flip("horizontal"); return; }
      if (action === "mirror-vertical") { editorService.flip("vertical"); return; }
      if (action === "rotate-cw") { rotateGridAction(1); return; }
      if (action === "rotate-ccw") { rotateGridAction(3); return; }
      if (action === "replace") { store.setState({ editor: { tool: "replace" }, ui: { activePanel: "color" } }); return; }
      if (action === "outline") { editorService.outline(get().editor.selection, get().editor.selectedColor, $("#ws-outline-diagonal").checked); return; }
      if (action === "guides") { store.setState({ view: { showGrid: !get().view.showGrid } }); return; }
      if (action === "compare") { toggleCompare(); return; }
    },
  });
  // 顶栏扩展工具条：复用同一套 onToolChange / onPanelAction（与底栏画笔工具栏同源），
  // 只把 variant 设为 "extended" 渲染不同的控件集合。键盘快捷键仍由底栏主区实例统一处理，
  // 这里不重复绑定，避免一次按键触发两次。
  const extendedToolbar = new GridEditorToolbar({
    root: "#ws-top-tools",
    variant: "extended",
    activeTool: get().editor.tool,
    onToolChange: gridToolbar.onToolChange,
    onPanelAction: gridToolbar.onPanelAction,
  });
  // ── 图纸尺寸 · 像素倍数 ───────────────────────────────────────────────
  // 倍数 = 原图里一个逻辑像素由多少真实像素组成（导入时自动识别，可手动覆盖）。
  // 「自动」= 用倍数推出逻辑尺寸（源图 ÷ 倍数）；52/78/104 = 方形边长；
  // 尺寸步进器 = 按当前比例手动缩放；倍数步进器 = 覆盖倍数后反推尺寸。
  // 尺寸真正落到 bridge/store 的链路仍由 generationPanel 的 onChange 负责，这里只喂入参。
  const effectiveMultiple = () => (manualMultiple ?? detectedMultiple) || 1;
  // 识别原图的像素倍数：像素画里 1 个逻辑像素由 k×k 个真实像素组成。
  // 识别结果决定「自动」的推荐尺寸；识别失败退化为 1×（即按原图像素）。
  function detectMultipleFor(url) {
    if (!url || url === detectedForUrl || detecting) return;
    detectedForUrl = url;
    detecting = true;
    manualMultiple = null;
    manualSize = false;
    syncMultipleReadout();
    loadImageData(url)
      .then(({ imageData }) => { detectedMultiple = detectPixelMultiple(imageData); syncMultipleReadout(); applyLogicalSize(); })
      .catch(() => { detectedMultiple = 1; syncMultipleReadout(); })
      .finally(() => {
        detecting = false;
        // 识别期间若又换了源图（连着导入两张），这里补跑一次，避免新图被跳过。
        const current = get().source.image;
        if (current && current !== detectedForUrl) detectMultipleFor(current);
      });
  }
  function syncMultipleReadout() {
    const output = $("#ws-multiple-value");
    if (output) output.textContent = `${effectiveMultiple()}×`;
    topControls.querySelector(".ws-multiple")?.classList.toggle("is-manual", manualMultiple !== null);
  }
  function applyLogicalSize() {
    const result = bridge.getResult();
    if (!result.sourceWidth || !result.sourceHeight) { generationPanel.setState({ width: 104, height: 104 }); return; }
    const { width, height } = logicalSize(result.sourceWidth, result.sourceHeight, effectiveMultiple());
    // 倍数识别出的尺寸常常远大于当前视口（180 豆在默认缩放下是 3600px），
    // 出图后必须重新适配，否则用户看到的是一角，还得自己找 Fit。
    fitOnNextResult = true;
    generationPanel.setState({ width, height });
  }
  const applySize = (value) => {
    if (value === "auto") { manualMultiple = null; manualSize = false; syncMultipleReadout(); applyLogicalSize(); return; }
    const size = Number(value);
    manualSize = true;
    generationPanel.setState({ width: size, height: size });
  };
  topControls.querySelectorAll("[data-size]").forEach((chip) => chip.addEventListener("click", () => applySize(chip.dataset.size)));
  // 手动尺寸步进器：以当前比例缩放（输入框显示最长边）。
  const sizeInput = $("#ws-size-input");
  const applyManualSize = (value) => {
    const target = clamp(Math.round(Number(value)) || 104, 10, 500);
    const { width, height } = get().canvas;
    const longest = Math.max(width, height) || target;
    const ratio = target / longest;
    manualSize = true;
    generationPanel.setState({ width: clamp(Math.round(width * ratio), 10, 500), height: clamp(Math.round(height * ratio), 10, 500) });
  };
  topControls.querySelectorAll("[data-size-step]").forEach((button) => button.addEventListener("click", () => {
    applyManualSize((Number(sizeInput.value) || Math.max(get().canvas.width, get().canvas.height) || 104) + Number(button.dataset.sizeStep));
  }));
  sizeInput.addEventListener("change", () => applyManualSize(sizeInput.value));
  // 手动倍数步进器：覆盖识别结果，按新倍数反推逻辑尺寸（尺寸仍由自动流程推导）。
  topControls.querySelectorAll("[data-multiple-step]").forEach((button) => button.addEventListener("click", () => {
    manualMultiple = clamp(Math.round(effectiveMultiple() + Number(button.dataset.multipleStep)), 1, 64);
    manualSize = false;
    syncMultipleReadout();
    applyLogicalSize();
  }));
  // 「自动」chip = 尺寸由倍数识别推导；52/78/104 = 手动指定方形边长。
  // 用函数声明（会提升）而非 const 箭头，避免 paint() 早于定义执行时踩 TDZ。
  function syncSizeChips() {
    const { width, height } = get().canvas;
    topControls.querySelectorAll("[data-size]").forEach((chip) => {
      const value = chip.dataset.size;
      const active = value === "auto"
        ? !manualSize
        : manualSize && width === height && Number(value) === width;
      chip.classList.toggle("is-active", active);
    });
    if (sizeInput && document.activeElement !== sizeInput) sizeInput.value = String(Math.max(width, height));
    syncMultipleReadout();
  }
  // 选区相关的动作统一走这里：按钮、方向键、快捷键三处共用，避免逻辑分叉。
  const selectionActions = {
    copy: () => { if (editorService.copySelection(get().editor.selection)) notifySelection(`已复制 ${editorService.getClipboard().beads} 颗豆（${editorService.getClipboard().width}×${editorService.getClipboard().height}）`); },
    cut: () => { if (editorService.cutSelection(get().editor.selection)) notifySelection(`已剪切 ${editorService.getClipboard().beads} 颗豆`); },
    paste: () => {
      if (!editorService.hasClipboard() || !get().status.hasPattern) return;
      const selection = get().editor.selection, cell = get().editor.selectedCell;
      const target = selection ? { x: selection.x0, y: selection.y0 } : cell || { x: 0, y: 0 };
      editorService.pasteClipboard(target.x, target.y);
      store.setState({ editor: { selection: null } });
    },
    invert: () => { const { width, height } = bridge.getResult(); store.setState({ editor: { selection: invertSelectionMask(get().editor.selection, width, height) } }); },
    selectAll: () => { const { width, height } = bridge.getResult(); store.setState({ editor: { selection: selectAllCells(width, height) } }); },
  };
  const notifySelection = (message) => { $("#ws-history-label").textContent = message; };
  const nudgeSelection = (dx, dy) => {
    const selection = get().editor.selection;
    const { width, height } = bridge.getResult();
    if (!selection || !get().status.hasPattern || (!dx && !dy)) return;
    const hasContent = selectionCells(selection, width, height).some(({ x, y }) => bridge.getCell(x, y));
    // 选区里有豆子就整体搬移；只是空框则移动选框本身，两种预期都要照顾。
    if (hasContent) editorService.moveSelection(selection, dx, dy);
    store.setState({ editor: { selection: translateSelection(selection, dx, dy, width, height) } });
  };
  const attachSelectionActions = () => {
    $("#ws-copy-selection").addEventListener("click", selectionActions.copy);
    $("#ws-cut-selection").addEventListener("click", selectionActions.cut);
    $("#ws-paste-selection").addEventListener("click", selectionActions.paste);
    $("#ws-invert-selection").addEventListener("click", selectionActions.invert);
    $("#ws-select-all").addEventListener("click", selectionActions.selectAll);
    $("#ws-wand-tolerance").addEventListener("input", (event) => {
      const value = clamp(Math.round(Number(event.target.value) || 0), 0, 100);
      $("#ws-wand-tolerance-value").textContent = String(value);
      store.setState({ editor: { wandTolerance: value } });
    });
    $("#ws-brush-size").addEventListener("input", (event) => {
      const value = clamp(Math.round(Number(event.target.value) || 1), 1, 9);
      gridToolbar.setBrushSize(value);
      store.setState({ editor: { brushSize: gridToolbar.brushSize } });
    });
    $("#ws-shape-filled").addEventListener("change", (event) => {
      store.setState({ editor: { shapeFilled: event.target.checked } });
    });
    $("#ws-symmetry-horizontal").addEventListener("change", (event) => store.setState({ editor: { symmetryHorizontal: event.target.checked } }));
    $("#ws-symmetry-vertical").addEventListener("change", (event) => store.setState({ editor: { symmetryVertical: event.target.checked } }));
  };
  attachSelectionActions();
  window.addEventListener("keydown", (event) => {
    if (confirmDialog.open || gridToolbar?.helpDialog?.open || document.querySelector("#editor-modal")?.open || document.querySelector("#assembly-modal")?.open) return;
    const target = event.target;
    if (target instanceof HTMLElement && (target.matches("input,textarea,select") || target.isContentEditable)) return;
    const key = event.key.toLowerCase();
    const withModifier = event.metaKey || event.ctrlKey;
    if (withModifier && key === "z") { event.preventDefault(); event.shiftKey ? editorService.redo() : editorService.undo(); return; }
    if (withModifier && key === "y") { event.preventDefault(); editorService.redo(); return; }
    if (withModifier && ["a", "i", "c", "x", "v", "d"].includes(key)) {
      if (!get().status.hasPattern) return;
      // ⌘D / Esc 是取消选择；其余四个交给统一的选区动作。
      event.preventDefault();
      if (key === "d") { store.setState({ editor: { selection: null } }); return; }
      ({ a: selectionActions.selectAll, i: selectionActions.invert, c: selectionActions.copy, x: selectionActions.cut, v: selectionActions.paste })[key]();
      return;
    }
    if (event.key === " " && !event.repeat) { event.preventDefault(); spaceDown = true; return; }
    if (event.key === "Escape") { store.setState({ editor: { selectedCell: null, selection: null, shapePreview: null } }); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && get().editor.selection && get().status.hasPattern) {
      event.preventDefault(); editorService.eraseSelection(get().editor.selection); return;
    }
    if (event.key === "[" || event.key === "]") { event.preventDefault(); gridToolbar.stepBrushSize(event.key === "[" ? -1 : 1); return; }
    if (event.key.startsWith("Arrow") && get().editor.selection) {
      const step = event.shiftKey ? 5 : 1;
      const delta = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[event.key];
      if (delta) { event.preventDefault(); nudgeSelection(delta[0], delta[1]); }
      return;
    }
    if (key === "0") viewport.fitToViewport(); if (key === "1") viewport.resetZoom();
  });
  window.addEventListener("keyup", (event) => { if (event.key === " ") spaceDown = false; });

  /* ============================ 库存（B 批） ============================ */

  const getUsageStats = () => bridge.getResult().colors || [];
  const inventory = createInventoryService({
    getStats: getUsageStats,
    getPaletteColors: () => bridge.getPaletteColors(),
  });
  // OCR 引擎与 worker 都是惰性创建：不点「识别外部图纸」就一个字节都不下载。
  const ocr = createOcrService();
  const recognition = createLegendRecognitionService({ ocr, matchColor: (rgb) => bridge.getNearestPaletteCandidates(rgb) });

  const toast = document.createElement("div");
  toast.className = "ws-toast";
  toast.hidden = true;
  wrap.append(toast);
  let toastTimer = null;
  const notify = (message) => {
    toast.textContent = message;
    toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toast.hidden = true; }, 6000);
    inventoryPanel?.setMessage(message);
  };

  /* ======================== 文字素材（浮动图层） ======================== */
  // 参考 Pixler 的「添加文字」：文字先作为**浮动图层**摆在画布上（只画在 overlay 层），
  // 调好字体 / 颜色 / 加粗倾斜 / 字号 / 旋转之后点「向下合并」，才一次性写成真实豆格。
  // 三个关键取舍：
  //   · 预览与合并共用 rasterizeText —— 「看到的格子」就是「合下去的格子」，不会差半格；
  //   · 浮动期间一个豆格都不写 grid —— 所以从放到拖全程撤销栈是干净的，合并只产生一步历史；
  //   · 新图层落在当前视口正中 —— 点了「添加文字」立刻就能看到，不用满画布去找。
  function renderTextPanel(state = get()) {
    if (!textPanel) return;
    const layers = state.editor.textLayers || [];
    const active = layers.find((layer) => layer.id === state.editor.activeTextLayerId) || null;
    const { w, h } = gridSize();
    textPanel.render({
      layers,
      activeId: active?.id || null,
      palette: editorService.getPaletteColors(),
      recent: state.editor.textRecentColors || [],
      // 落豆数与画布预览、与合并写进去的格子来自同一次栅格化（带缓存），三处必然一致。
      cells: active ? rasterizeTextCached(active, w, h).cells.length : 0,
    });
  }
  // 新图层的落点 = 当前视口中心对应的格。视口未就绪时退回画布左上角附近。
  function textDropPoint() {
    const { w, h } = gridSize();
    const origin = viewport.origin(), cell = origin.cell || 20;
    const x = (well.clientWidth / 2 - origin.x) / cell;
    const y = (well.clientHeight / 2 - origin.y) / cell;
    return { x: clamp(Math.round(x), 0, Math.max(0, w - 1)), y: clamp(Math.round(y), 0, Math.max(0, h - 1)) };
  }
  textPanel = new TextPanel({
    root: "#textPanel",
    onAdd: () => {
      if (!get().status.hasPattern) { notify("先生成图纸，再添加文字。"); return; }
      const at = textDropPoint();
      const layer = createTextLayer({ x: at.x, y: at.y, color: get().editor.selectedColor || "" });
      setTextLayers([...currentTextLayers(), layer], layer.id);
      store.setState({ editor: { tool: "text" }, ui: { activePanel: "edit" } });
      renderer.requestDraw();
    },
    onPatch: (id, patch) => {
      if (!id) return;
      setTextLayers(currentTextLayers().map((layer) => (layer.id === id ? { ...layer, ...patch } : layer)), id);
      renderer.requestDraw();
    },
    onSelect: (id) => { store.setState({ editor: { activeTextLayerId: id, tool: "text" } }); renderer.requestDraw(); },
    onDelete: (id) => {
      if (!id) return;
      const rest = currentTextLayers().filter((layer) => layer.id !== id);
      setTextLayers(rest, rest.at(-1)?.id || null);
      renderer.requestDraw();
    },
    onMerge: (id) => {
      const layer = currentTextLayers().find((item) => item.id === id);
      if (!layer) return;
      const { w, h } = gridSize();
      const { cells } = rasterizeTextCached(layer, w, h);
      if (!cells.length) { notify("这段文字落在图纸范围内没有豆格：先调小字号，或把它拖回画布内。"); return; }
      const code = layer.color || get().editor.selectedColor;
      const color = code ? editorService.resolveColor(code) : null;
      if (!color) { notify("先给文字选一个色号，再向下合并。"); return; }
      // 合并 = 把整块文字一次性写成豆格。走 applyCells → commit，所以是一步可撤销的历史。
      const applied = editorService.applyCells(cells, color.code, "TEXT_MERGE", `文字合并：${(layer.text || "").trim().slice(0, 12) || "空文字"} · ${cells.length} 豆`);
      // 合并后移除该浮动图层：内容已经在图纸上了，再留一份只会重复。
      const rest = currentTextLayers().filter((item) => item.id !== id);
      setTextLayers(rest, rest.at(-1)?.id || null);
      store.setState({ editor: { selectedColor: color.code } });
      renderer.requestDraw();
      notify(applied ? `已合并 ${cells.length} 颗豆，可撤销` : "文字与图纸现有颜色一致，没有需要写入的豆格。");
    },
    onUseCurrentColor: (id) => {
      const code = get().editor.selectedColor;
      if (!code) { notify("先在「色彩」里选一个色号。"); return; }
      if (!id) return;
      setTextLayers(currentTextLayers().map((layer) => (layer.id === id ? { ...layer, color: code } : layer)), id);
      renderer.requestDraw();
    },
    // 「+」把当前色加进色块行。要与当前显示的候选色**连续**，所以从「已有的最近用色，
    // 没有就用色卡前 4 色」接着往后加，而不是把它整行替换掉。
    onAddCurrentColor: () => {
      const code = get().editor.selectedColor;
      if (!code) { notify("先在「色彩」里选一个色号。"); return; }
      const shown = get().editor.textRecentColors || editorService.getPaletteColors().slice(0, 4).map((color) => color.code);
      store.setState({ editor: { textRecentColors: [code, ...shown.filter((item) => item !== code)].slice(0, 6) } });
    },
  });

  let usageDialog = null;
  const inventoryPanel = new InventoryPanel({
    root: right.querySelector("#inventoryPanel"),
    inventory,
    getStats: getUsageStats,
    getProjectName: () => get().project.name,
    askConfirmation,
    onNotify: notify,
    onOpenUsage: (options) => usageDialog?.open(options),
  });
  inventoryPanel.mount();
  usageDialog = new UsageDialog({
    inventory,
    recognition,
    ocr,
    getStats: getUsageStats,
    getPaletteCodes: () => new Set(bridge.getPaletteColors().map((color) => color.code)),
    askConfirmation,
    onNotify: notify,
  });

  // ===================== 施工模式（参照 Pixler /build） =====================
  // 把图纸切成 cols×rows 个区块，一次只看一块、只放一色。
  // 区块与颜色的选择只作用在「叠加层 + editor.highlightedColor」，不写 state.grid，
  // 所以撤销栈始终干净；「颜色切换」直接复用渲染器已有的 highlightedColor 淡化能力。
  const build = { count: 1, cols: 1, rows: 1, block: 0, color: null, colors: [] };
  // 复用上面已声明的 well / layers，不要重复声明（重复会直接 SyntaxError 导致整个工作台挂不上）
  const buildOverlay = document.createElement("div");
  buildOverlay.className = "ws-build-overlay"; buildOverlay.id = "ws-build-overlay"; buildOverlay.hidden = true;
  buildOverlay.innerHTML = `<div class="ws-build-spot" id="ws-build-spot"></div>`;
  well.append(buildOverlay);
  const rulers = document.createElement("div");
  rulers.className = "ws-rulers"; rulers.id = "ws-rulers"; rulers.hidden = true;
  rulers.innerHTML = ["top", "left", "bottom", "right"].map((side) => `<div class="ws-ruler ws-ruler-${side}" id="ws-ruler-${side}"></div>`).join("");
  well.append(rulers);

  const buildActive = () => document.body.classList.contains("ws-mode-build");
  const gridSize = () => { const r = bridge.getResult(); return { w: r.width || 0, h: r.height || 0, grid: r.grid || [] }; };

  // 按图纸宽高比切块，避免出现极窄的条；块数向上取整到 cols×rows ≥ count。
  function blockLayout() {
    const { w, h } = gridSize();
    const n = Math.max(1, build.count);
    const ratio = w && h ? w / h : 1;
    let cols = Math.max(1, Math.round(Math.sqrt(n * ratio)));
    while (cols * Math.ceil(n / cols) < n) cols += 1;
    const rows = Math.ceil(n / cols);
    build.cols = cols; build.rows = rows;
    build.block = Math.min(build.block, cols * rows - 1);
    return { cols, rows, bw: Math.max(1, Math.ceil(w / cols)), bh: Math.max(1, Math.ceil(h / rows)) };
  }
  function blockRect(index = build.block) {
    const { w, h } = gridSize(); const { cols, bw, bh } = blockLayout();
    const x0 = (index % cols) * bw, y0 = Math.floor(index / cols) * bh;
    return { x0, y0, x1: Math.min(w, x0 + bw), y1: Math.min(h, y0 + bh) };
  }
  function blockColors() {
    const { grid } = gridSize(); const { x0, y0, x1, y1 } = blockRect();
    const seen = new Map();
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      const color = grid[y]?.[x]; if (!color) continue;
      const hit = seen.get(color.code); if (hit) hit.count += 1; else seen.set(color.code, { ...color, count: 1 });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }
  // 建议块数：单块边长不超过 ~30 格时最好拼，据此给一个参考值。
  function advisedBlocks() {
    const { w, h } = gridSize(); if (!w || !h) return 1;
    return Math.max(1, Math.ceil(w / 30) * Math.ceil(h / 30));
  }

  function renderBlockMap() {
    const { cols, rows } = blockLayout();
    const map = $("#ws-block-map"); if (!map) return;
    map.style.setProperty("--ws-block-cols", String(cols));
    map.innerHTML = Array.from({ length: cols * rows }, (_, i) =>
      `<button type="button" data-ws-block-index="${i}" class="${i === build.block ? "active" : ""}" aria-label="区块 ${i + 1}">${i + 1}</button>`).join("");
    const count = $("#ws-block-count"); if (count) count.textContent = String(build.count);
    const advice = $("#ws-block-advice");
    if (advice) advice.textContent = `最佳建议 ${advisedBlocks()} 块 · 当前 ${cols} × ${rows}`;
  }
  function renderBlockColors() {
    build.colors = blockColors();
    const host = $("#ws-block-colors"); if (!host) return;
    host.innerHTML = build.colors.map((color, i) =>
      `<button type="button" data-ws-block-color="${esc(color.code)}" class="${color.code === build.color ? "active" : ""}" title="${esc(color.code)} · ${color.count} 颗"><span style="background:${esc(color.hex)}"></span><small>${esc(color.code)}</small></button>`).join("")
      || '<p class="ws-note">当前区块没有豆子。</p>';
    const focus = $("#ws-build-focus");
    if (focus) {
      const { x0, y0, x1, y1 } = blockRect();
      focus.textContent = build.colors.length
        ? `第 ${build.block + 1} / ${build.cols * build.rows} 块 · 行 ${y0 + 1}–${y1} 列 ${x0 + 1}–${x1} · ${build.colors.length} 色`
        : `第 ${build.block + 1} / ${build.cols * build.rows} 块 · 空`;
    }
  }
  function updateBuildOverlay() {
    const on = buildActive() && gridSize().grid.length;
    buildOverlay.hidden = !on; rulers.hidden = !on;
    if (!on) return;
    const { w, h } = gridSize();
    const o = viewport.origin(), cell = o.cell;
    const { x0, y0, x1, y1 } = blockRect();
    const spot = $("#ws-build-spot");
    spot.style.left = `${o.x + x0 * cell}px`; spot.style.top = `${o.y + y0 * cell}px`;
    spot.style.width = `${(x1 - x0) * cell}px`; spot.style.height = `${(y1 - y0) * cell}px`;
    // 四边标尺：每 5 格一个刻度，10 的倍数用品红强调
    const ticks = (count, horizontal) => Array.from({ length: count }, (_, i) => i + 1)
      .filter((n) => n % 5 === 0)
      .map((n) => {
        const major = n % 10 === 0;
        const pos = o[horizontal ? "x" : "y"] + (n - 1) * cell + cell / 2;
        return pos > -40 && pos < (horizontal ? well.clientWidth : well.clientHeight) + 40
          ? `<span class="${major ? "is-major" : ""}" style="${horizontal ? "left" : "top"}:${pos}px">${n}</span>` : "";
      }).join("");
    $("#ws-ruler-top").innerHTML = ticks(w, true);
    $("#ws-ruler-bottom").innerHTML = ticks(w, true);
    $("#ws-ruler-left").innerHTML = ticks(h, false);
    $("#ws-ruler-right").innerHTML = ticks(h, false);
  }
  function applyBuildColor(code) {
    build.color = code || null;
    // 复用渲染器已有的「高亮色淡化其余」能力，不额外写渲染代码
    store.setState({ editor: { highlightedColor: build.color } });
    renderBlockColors();
  }
  function setWorkspaceMode(mode) {
    const next = mode === "build" ? "build" : "edit";
    document.body.classList.toggle("ws-mode-build", next === "build");
    if (next === "build") {
      build.block = 0; build.color = null;
      renderBlockMap(); applyBuildColor(null);
      store.setState({ ui: { activePanel: "build" } });
    } else {
      store.setState({ ui: { activePanel: "project" }, editor: { highlightedColor: null } });
      build.color = null;
    }
    requestAnimationFrame(() => { updateBuildOverlay(); renderer.requestDraw(); });
  }
  // 施工面板事件
  right.querySelector('[data-ws-inspector="build"]').addEventListener("click", (event) => {
    const step = event.target.closest("[data-ws-block]");
    if (step) {
      const total = build.cols * build.rows;
      const action = step.dataset.wsBlock;
      if (action === "inc") build.count = Math.min(64, build.count + 1);
      else if (action === "dec") build.count = Math.max(1, build.count - 1);
      else if (action === "next") build.block = (build.block + 1) % total;
      else if (action === "prev") build.block = (build.block - 1 + total) % total;
      const next = blockLayout();
      $("#ws-block-count").textContent = String(build.count);
      $("#ws-block-advice").textContent = `最佳建议 ${advisedBlocks()} 块 · 当前 ${next.cols} × ${next.rows}`;
      renderBlockMap(); applyBuildColor(null); updateBuildOverlay(); renderer.requestDraw();
      return;
    }
    const pick = event.target.closest("[data-ws-block-index]");
    if (pick) { build.block = Number(pick.dataset.wsBlockIndex); renderBlockMap(); applyBuildColor(null); updateBuildOverlay(); renderer.requestDraw(); return; }
    const swatch = event.target.closest("[data-ws-block-color]");
    if (swatch) { applyBuildColor(swatch.dataset.wsBlockColor === build.color ? null : swatch.dataset.wsBlockColor); return; }
    const colorStep = event.target.closest("[data-ws-color]");
    if (colorStep && build.colors.length) {
      const at = build.colors.findIndex((color) => color.code === build.color);
      const dir = colorStep.dataset.wsColor === "next" ? 1 : -1;
      const next = at < 0 ? (dir > 0 ? 0 : build.colors.length - 1) : (at + dir + build.colors.length) % build.colors.length;
      applyBuildColor(build.colors[next].code);
      return;
    }
    if (event.target.closest("#ws-build-reset")) { build.count = 1; build.block = 0; $("#ws-block-count").textContent = "1"; blockLayout(); renderBlockMap(); applyBuildColor(null); updateBuildOverlay(); renderer.requestDraw(); }
  });

  store.subscribe(paint);
  syncLegacy(); paint(get(), { status: true, stats: true });
  renderPicker();
  delete grid.dataset.workspaceMounting;
  grid.dataset.workspaceReady = "true";
  return { mounted: true, reused: false };
}
