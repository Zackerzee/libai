import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workspace = readFileSync(new URL('../ui/workspace.js', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../ui/workspace-bootstrap.js', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = readFileSync(new URL('../styles/workspace.css', import.meta.url), 'utf8');
const panel = readFileSync(new URL('../ui/pattern-import-panel.js', import.meta.url), 'utf8');
const core = readFileSync(new URL('../vendor/bead-pattern/bead-pattern-core.js', import.meta.url), 'utf8');

/* ── 一、接线：入口落在「新建 / 导入」里，且走新实现 ───────────────────── */

test('「导入现成图纸」仍是「新建 / 导入」菜单的一项，文案改成带色号图纸', () => {
  assert.match(workspace, /id="ws-import-pattern" role="menuitem">导入现成图纸<small>识别带色号的图纸图片<\/small>/);
  // 菜单本身的关闭纪律不能被破坏（capture 阶段 + 外部 pointerdown）。
  assert.match(workspace, /closest\('\[role="menuitem"\]'\)\) projectMenu\.open = false/);
});

test('菜单点击走新的图纸识别面板，不再走 legacy 的 #direct-pattern-file-input', () => {
  assert.match(workspace, /let patternImportPanel = null;/);
  assert.match(workspace, /\$\("#ws-import-pattern"\)\.addEventListener\("click", \(\) => patternImportPanel\?\.open\(\)\);/);
  // 落地页「智能工具 → 直接导入图纸」那条旧链路必须原样保留（扫描函数还在）。
  assert.match(workspace, /scanReadyMadePattern|directPatternFileInput|direct-pattern-file-input/);
});

test('面板在文件后段构造，注入 bridge / 色卡 / notify / askConfirmation / afterImport', () => {
  assert.match(workspace, /import \{ createPatternImportPanel \} from "\.\/pattern-import-panel\.js\?v=/);
  assert.match(workspace, /patternImportPanel = createPatternImportPanel\(\{/);
  assert.match(workspace, /bridge,\s*\n\s*getPaletteColors: \(\) => editorService\.getPaletteColors\(\),/);
  assert.match(workspace, /notify,\s*\n\s*askConfirmation,\s*\n\s*\/\/ 灌入成功后的工作台收尾/);
});

test('灌入后的收尾与「打开工程」同一套口径（清历史 / 清源图与图层 / 适配视口）', () => {
  assert.match(workspace, /afterImport: \(\) => \{[\s\S]*?editorService\.clearHistory\(\)/);
  assert.match(workspace, /afterImport: \(\) => \{[\s\S]*?view: \{ mode: "pattern" \}/);
  assert.match(workspace, /afterImport: \(\) => \{[\s\S]*?syncResizeInputs\(\);\s*\n\s*viewport\.fitToViewport\(\);/);
});

/* ── 二、算法来源：vendor 里的核心库提供了面板用到的全部函数 ─────────── */

test('vendor 核心库导出面板依赖的四个函数', () => {
  for (const name of ['recognizePattern', 'detectGridStep', 'preparePalette', 'topCandidates']) {
    assert.match(core, new RegExp(`export function ${name}\\(`), `缺少 export function ${name}`);
  }
  assert.match(panel, /from "\.\.\/vendor\/bead-pattern\/bead-pattern-core\.js\?v=/);
});

test('识别参数守住交接说明的两条硬要求：ring 采样 + 白平衡自动', () => {
  assert.match(panel, /sampleAlgo: "ring"/);
  assert.match(panel, /whiteBalance: "auto"/);
  // 交接说明第 3 条：严禁加图像预降噪（3×3 中值会把准确率打到 31.9%）。
  assert.doesNotMatch(panel, /medianFilter|gaussianBlur|blur\(|median\(/);
});

/* ── 三、灌入：色号 → 当前色卡颜色对象 → replaceGridStructure ───────── */

test('确认导入走 bridge.replaceGridStructure，并用当前色卡解析色号', () => {
  assert.match(panel, /bridge\.replaceGridStructure\(\{ grid, width, height \}\)/);
  assert.match(panel, /byCode\.set\(String\(color\.code\)\.toUpperCase\(\), color\)/);
  // 认不出的色号必须落成空格并计数，不能静默丢弃。
  assert.match(panel, /unresolved\+\+; return null;/);
  assert.match(panel, /\$\{unresolved\} 格色号不在当前色卡中，已留空/);
});

test('替换前会确认覆盖（当前作品有手动编辑时）', () => {
  assert.match(panel, /if \(current\.manualEdited\) \{[\s\S]*?askConfirmation\("导入图纸会替换当前作品/);
});

/* ── 四、缓存戳：改到的文件必须同跳版本号 ───────────────────────────── */

test('workspace.js 与 workspace.css 的缓存戳同步到本轮', () => {
  assert.match(bootstrap, /\.\/workspace\.js\?v=20261016-pattern-import-1/);
  assert.match(html, /\.\/styles\/workspace\.css\?v=20261016-panel-position-1/);
  assert.match(workspace, /pattern-import-panel\.js\?v=20261016-pattern-import-1/);
});

/* ── 五、样式：走设计令牌，不新造颜色 ───────────────────────────────── */

test('面板样式挂在 .ws-help-dialog 上（暗色由既有规则统一翻面）', () => {
  assert.match(css, /\.phase2-workspace \.ws-help-dialog\.ws-pattern-import\{position:fixed;top:50%;left:50%;transform:translate\(-50%,-50%\);margin:0;width:min\(1080px,94vw\)/);
  // 面板本体必须复用 .ws-help-dialog，否则暗色主题那条规则覆盖不到。
  assert.match(panel, /className = "ws-help-dialog ws-pattern-import"/);
});

test('面板定位显式钉死居中，不依赖 <dialog> 的 UA 居中，且不设 bottom/right', () => {
  // 用户实测「导入带色号的图纸压住了工具栏」：Chrome 的 dialog:modal UA 样式
  // 是 margin:auto 垂直居中，但 Safari 等浏览器会把模态对话框摆在 top:0
  // —— 标题行与顶栏同行、说明文字与工具栏图标行重叠。修复必须自己钉死
  // position:fixed + top/left 50% + translate(-50%,-50%) + margin:0。
  assert.match(css, /\.phase2-workspace \.ws-help-dialog\.ws-pattern-import\{position:fixed;top:50%;left:50%;transform:translate\(-50%,-50%\);margin:0/);
  // 不设 bottom/right —— 否则浏览器把高度拉满（如 Safari 的 dialog 拉伸行为）
  // 时面板会被纵向/横向拉变形， justify-content:flex-start 也钉住内部分配。
  const rule = css.match(/\.phase2-workspace \.ws-help-dialog\.ws-pattern-import\{[^}]+\}/)?.[0] || '';
  assert.doesNotMatch(rule, /bottom:/, '面板不应设置 bottom（防拉伸）');
  assert.doesNotMatch(rule, /right:/, '面板不应设置 right（防拉伸）');
});

test('面板未打开时必须真的隐藏 —— 作者 display:flex 会压过 UA 的 dialog:not([open])', () => {
  // 真机取证踩过的坑：给 .ws-pattern-import 写了 display:flex 之后，
  // 没打开的对话框一直挂在画布上（作者样式优先级永远高于 UA 样式）。
  assert.match(css, /\.phase2-workspace \.ws-help-dialog\.ws-pattern-import:not\(\[open\]\)\{display:none\}/);
});

test('面板外观全部走 --ds-* / --ws-* 令牌，warn 用 danger 而不是自造警告色', () => {
  const block = css.slice(css.indexOf('.phase2-workspace .ws-pattern-import'));
  assert.match(block, /ws-pi-status\[data-tone="warn"\]\{color:var\(--ds-color-danger\)\}/);
  // 连画布底色也不许硬编码 —— 图纸是作品数据，但底色必须跟随主题（暗色下不能留一块白）。
  const hardcoded = block.match(/#[0-9a-fA-F]{3,8}/g) || [];
  assert.deepEqual(hardcoded, [], '面板样式里不应出现任何硬编码十六进制色');
});

/* ── 六、自动裁剪：合成图上的真值断言 ───────────────────────────────── */

/** 造一张 RGBA 图：painter(x,y) 返回 [r,g,b]。 */
function makeImage(w, h, painter) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b] = painter(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b; data[i + 3] = 255;
    }
  }
  return { data, w, h };
}

const BEADS = [
  [230, 60, 60], [60, 180, 90], [70, 110, 230], [245, 200, 60],
  [240, 130, 200], [90, 220, 220], [250, 250, 250], [120, 70, 180],
];

/** 图纸 10×8 格、每格 20px，四周白边，右边贴一个 7px 小格的「色号统计」块。 */
function gridWithClutter() {
  const W = 400, H = 300, CELL = 20, COLS = 10, ROWS = 8;
  const GX = 60, GY = 40;
  const LEG_X = 280, LEG_Y = 40, LEG_W = 60, LEG_H = 90, LEG_CELL = 7;
  const LINE = [40, 40, 40];
  return makeImage(W, H, (x, y) => {
    if (x >= GX && x < GX + COLS * CELL && y >= GY && y < GY + ROWS * CELL) {
      if ((x - GX) % CELL === 0 || (y - GY) % CELL === 0) return LINE;
      const c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
      return BEADS[(r * COLS + c) % BEADS.length];
    }
    if (x >= LEG_X && x < LEG_X + LEG_W && y >= LEG_Y && y < LEG_Y + LEG_H) {
      if ((x - LEG_X) % LEG_CELL === 0 || (y - LEG_Y) % LEG_CELL === 0) return LINE;
      return [200, 60, 60];
    }
    return [255, 255, 255];
  });
}

test('自动裁剪：白边 + 紧贴的图例块，只保留真正的豆格区', async () => {
  const { cropToGrid } = await import('../ui/pattern-import-panel.js?v=20261016-pattern-import-1');
  const { data, w, h } = gridWithClutter();
  const crop = cropToGrid(data, w, h);
  assert.ok(crop, '应当裁出结果');
  assert.equal(crop.cell, 20, '格子像素');
  assert.equal(crop.x0, 60, '左边白边被裁掉');
  assert.equal(crop.y0, 40, '上边白边被裁掉');
  assert.equal(crop.x1, 260, '右边只留到图纸末尾，图例那一格被修掉');
  assert.equal(crop.y1, 200, '下边白边被裁掉');
  assert.deepEqual(crop.cells, { cols: 10, rows: 8 }, '格数与真值一致');
  assert.deepEqual(crop.removed, { left: 60, top: 40, right: 140, bottom: 100 });
});

test('自动裁剪：没有网格的图一律不裁（保守失败，绝不把好图裁坏）', async () => {
  const { cropToGrid } = await import('../ui/pattern-import-panel.js?v=20261016-pattern-import-1');
  // 纯白：没有任何周期性结构。
  const white = makeImage(300, 200, () => [255, 255, 255]);
  assert.equal(cropToGrid(white.data, white.w, white.h), null, '纯白图不裁');
  // 随机噪点：梯度无周期。
  const noise = makeImage(300, 200, (x, y) => [((x * 37 + y * 91) % 255), ((x * 53 + y * 17) % 255), 128]);
  assert.equal(cropToGrid(noise.data, noise.w, noise.h), null, '无网格噪点不裁');
});

test('自动裁剪：图里本来就没有多余内容时不裁（避免无意义改写）', async () => {
  const { cropToGrid } = await import('../ui/pattern-import-panel.js?v=20261016-pattern-import-1');
  const CELL = 20, COLS = 6, ROWS = 5;
  const W = COLS * CELL, H = ROWS * CELL;
  const only = makeImage(W, H, (x, y) => {
    if (x % CELL === 0 || y % CELL === 0) return [40, 40, 40];
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    return BEADS[(r * COLS + c) % BEADS.length];
  });
  assert.equal(cropToGrid(only.data, only.w, only.h), null, '铺满的图纸不裁');
});

test('自动裁剪：整幅铺满、且被一种豆色占满时不裁（众数是豆色，不是纸边）', async () => {
  const { cropToGrid } = await import('../ui/pattern-import-panel.js?v=20261016-pattern-import-1');
  // 全幅铺满（四角都是豆）、九成格子是同一种红，右下角一小块绿。
  // 众数会落在红色上，但红色列被格线切成长度只有 cell-1 的碎片，凑不出纸边带。
  const CELL = 20, COLS = 10, ROWS = 8;
  const W = COLS * CELL, H = ROWS * CELL;
  const dom = makeImage(W, H, (x, y) => {
    if (x % CELL === 0 || y % CELL === 0) return [40, 40, 40];
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    if (c >= 8 && r >= 6) return [60, 180, 90];
    return [230, 60, 60];
  });
  assert.equal(cropToGrid(dom.data, dom.w, dom.h), null, '铺满且单色主导的图纸不裁');
});

test('自动裁剪：图纸中间被同色块围住的空白格不把图纸劈成两半（补洞）', async () => {
  const { cropToGrid } = await import('../ui/pattern-import-panel.js?v=20261016-pattern-import-1');
  const CELL = 20, COLS = 10, ROWS = 8;
  const W = 400, H = 300, GX = 60, GY = 40;
  const LINE = [40, 40, 40];
  const holed = makeImage(W, H, (x, y) => {
    // 中间 2×2 格是纯白、连格线都不画 —— 模拟图纸里一块真的空白。
    if (x >= 160 && x < 200 && y >= 100 && y < 140) return [255, 255, 255];
    if (x >= GX && x < GX + COLS * CELL && y >= GY && y < GY + ROWS * CELL) {
      if ((x - GX) % CELL === 0 || (y - GY) % CELL === 0) return LINE;
      const c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
      return BEADS[(r * COLS + c) % BEADS.length];
    }
    return [255, 255, 255];
  });
  const crop = cropToGrid(holed.data, holed.w, holed.h);
  assert.ok(crop, '应当裁出结果');
  assert.equal(crop.x0, 60, '左边白边被裁掉');
  assert.equal(crop.y0, 40, '上边白边被裁掉');
  assert.equal(crop.x1, 260, '中间的空白格被补回内容，右边不多裁');
  assert.equal(crop.y1, 200, '下边白边被裁掉');
  assert.deepEqual(crop.cells, { cols: 10, rows: 8 }, '整张图纸都在，没有被劈成两半');
});

test('自动裁剪：色号统计表比图纸宽时仍取图纸（最大矩形，不是逐轴取最长）', async () => {
  const { cropToGrid } = await import('../ui/pattern-import-panel.js?v=20261016-pattern-import-1');
  // 图纸 8×6，下方压一条 12×3 的宽表 —— 逐轴取最长会拼出 12×6 的假矩形。
  const CELL = 20, GX = 40, GY = 60, COLS = 8, ROWS = 6;
  const LX = 100, LY = 200, LCOLS = 12, LROWS = 3;
  const LINE = [40, 40, 40];
  const W = 400, H = 300;
  const wide = makeImage(W, H, (x, y) => {
    if (x >= GX && x < GX + COLS * CELL && y >= GY && y < GY + ROWS * CELL) {
      if ((x - GX) % CELL === 0 || (y - GY) % CELL === 0) return LINE;
      const c = Math.floor((x - GX) / CELL), r = Math.floor((y - GY) / CELL);
      return BEADS[(r * COLS + c) % BEADS.length];
    }
    if (x >= LX && x < LX + LCOLS * CELL && y >= LY && y < LY + LROWS * CELL) {
      if ((x - LX) % CELL === 0 || (y - LY) % CELL === 0) return LINE;
      return [200, 60, 60];
    }
    return [255, 255, 255];
  });
  const crop = cropToGrid(wide.data, wide.w, wide.h);
  assert.ok(crop, '应当裁出结果');
  assert.equal(crop.x0, 40, '左边白边被裁掉');
  assert.equal(crop.y0, 60, '上边白边被裁掉');
  assert.equal(crop.x1, 200, '右边只留到图纸末尾');
  assert.equal(crop.y1, 180, '下边那条宽表被整块丢掉');
  assert.deepEqual(crop.cells, { cols: 8, rows: 6 }, '取的是面积最大的豆格区');
});
