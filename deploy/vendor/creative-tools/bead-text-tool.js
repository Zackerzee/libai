/* ============================================================================
 * 文字 → 拼豆图纸（像素字体版）  单文件版
 * 用法：
 *   <script src="bead-text-tool.js"></script>
 *   BeadTextUI.mount('#box', { palette: BeadText.MARD, onConfirm(r){ ... } });
 *   // 只要算法不要 UI：
 *   const r = BeadText.buildText({ text:'HELLO', fontId:'pixel-5x7', widthBeads:40 });
 * ==========================================================================*/
(function (global) {
'use strict';
var __MARD_PALETTE__ = [{"code":"A10","hex":"#F77C31","brand":"mard"},{"code":"A11","hex":"#FFDD99","brand":"mard"},{"code":"A12","hex":"#FE9F72","brand":"mard"},{"code":"A13","hex":"#FFC365","brand":"mard"},{"code":"A14","hex":"#FD543D","brand":"mard"},{"code":"A15","hex":"#FFF365","brand":"mard"},{"code":"A16","hex":"#FFFF9F","brand":"mard"},{"code":"A17","hex":"#FFE36E","brand":"mard"},{"code":"A18","hex":"#FEBE7D","brand":"mard"},{"code":"A19","hex":"#FD7C72","brand":"mard"},{"code":"A20","hex":"#FFD568","brand":"mard"},{"code":"A21","hex":"#FFE395","brand":"mard"},{"code":"A22","hex":"#F4F57D","brand":"mard"},{"code":"A23","hex":"#E6C9B7","brand":"mard"},{"code":"A24","hex":"#F7F8A2","brand":"mard"},{"code":"A25","hex":"#FFD67D","brand":"mard"},{"code":"A26","hex":"#FFC830","brand":"mard"},{"code":"B10","hex":"#95D3C2","brand":"mard"},{"code":"B11","hex":"#5D722A","brand":"mard"},{"code":"B12","hex":"#166F41","brand":"mard"},{"code":"B13","hex":"#CAEB7B","brand":"mard"},{"code":"B14","hex":"#ADE946","brand":"mard"},{"code":"B15","hex":"#2E5132","brand":"mard"},{"code":"B16","hex":"#C5ED9C","brand":"mard"},{"code":"B17","hex":"#9BB13A","brand":"mard"},{"code":"B18","hex":"#E6EE49","brand":"mard"},{"code":"B19","hex":"#24B88C","brand":"mard"},{"code":"B20","hex":"#C2F0CC","brand":"mard"},{"code":"B21","hex":"#156A6B","brand":"mard"},{"code":"B22","hex":"#0B3C43","brand":"mard"},{"code":"B23","hex":"#303A21","brand":"mard"},{"code":"B24","hex":"#EEFCA5","brand":"mard"},{"code":"B25","hex":"#4E846D","brand":"mard"},{"code":"B26","hex":"#8D7A35","brand":"mard"},{"code":"B27","hex":"#CCE1AF","brand":"mard"},{"code":"B28","hex":"#9EE5B9","brand":"mard"},{"code":"B29","hex":"#C5E254","brand":"mard"},{"code":"B30","hex":"#E2FCB1","brand":"mard"},{"code":"B31","hex":"#B0E792","brand":"mard"},{"code":"C10","hex":"#3EBCE2","brand":"mard"},{"code":"C11","hex":"#28DDDE","brand":"mard"},{"code":"C12","hex":"#1C334D","brand":"mard"},{"code":"C13","hex":"#CDE8FF","brand":"mard"},{"code":"C14","hex":"#D5FDFF","brand":"mard"},{"code":"C15","hex":"#22C4C6","brand":"mard"},{"code":"C16","hex":"#1557A8","brand":"mard"},{"code":"C17","hex":"#04D1F6","brand":"mard"},{"code":"C18","hex":"#1D3344","brand":"mard"},{"code":"C19","hex":"#1887A2","brand":"mard"},{"code":"C20","hex":"#176DAF","brand":"mard"},{"code":"C21","hex":"#BEDDFF","brand":"mard"},{"code":"C22","hex":"#67B4BE","brand":"mard"},{"code":"C23","hex":"#C8E2FF","brand":"mard"},{"code":"C24","hex":"#7CC4FF","brand":"mard"},{"code":"C25","hex":"#A9E5E5","brand":"mard"},{"code":"C26","hex":"#3CAED8","brand":"mard"},{"code":"C27","hex":"#D3DFFA","brand":"mard"},{"code":"C28","hex":"#BBCFED","brand":"mard"},{"code":"C29","hex":"#34488E","brand":"mard"},{"code":"D10","hex":"#361851","brand":"mard"},{"code":"D11","hex":"#B9BAE1","brand":"mard"},{"code":"D12","hex":"#DE9AD4","brand":"mard"},{"code":"D13","hex":"#B90095","brand":"mard"},{"code":"D14","hex":"#8B279B","brand":"mard"},{"code":"D15","hex":"#2F1F90","brand":"mard"},{"code":"A02","hex":"#FFFFD5","brand":"mard"},{"code":"D16","hex":"#E3E1EE","brand":"mard"},{"code":"D17","hex":"#C4D4F6","brand":"mard"},{"code":"D18","hex":"#A45EC7","brand":"mard"},{"code":"D19","hex":"#D8C3D7","brand":"mard"},{"code":"D20","hex":"#9C32B2","brand":"mard"},{"code":"D21","hex":"#9A009B","brand":"mard"},{"code":"D22","hex":"#333A95","brand":"mard"},{"code":"D23","hex":"#EBDAFC","brand":"mard"},{"code":"D24","hex":"#7786E5","brand":"mard"},{"code":"D25","hex":"#494FC7","brand":"mard"},{"code":"D26","hex":"#DFC2F8","brand":"mard"},{"code":"E10","hex":"#D33793","brand":"mard"},{"code":"E11","hex":"#FCDDD2","brand":"mard"},{"code":"E12","hex":"#F78FC3","brand":"mard"},{"code":"E13","hex":"#B5006D","brand":"mard"},{"code":"E14","hex":"#FFD1BA","brand":"mard"},{"code":"E15","hex":"#F8C7C9","brand":"mard"},{"code":"E16","hex":"#FFF3EB","brand":"mard"},{"code":"E17","hex":"#FFE2EA","brand":"mard"},{"code":"E18","hex":"#FFC7DB","brand":"mard"},{"code":"E19","hex":"#FEBAD5","brand":"mard"},{"code":"E20","hex":"#D8C7D1","brand":"mard"},{"code":"E21","hex":"#BD9DA1","brand":"mard"},{"code":"E22","hex":"#B785A1","brand":"mard"},{"code":"E23","hex":"#937A8D","brand":"mard"},{"code":"E24","hex":"#E1BCE8","brand":"mard"},{"code":"F10","hex":"#8A4526","brand":"mard"},{"code":"F11","hex":"#5A2121","brand":"mard"},{"code":"F12","hex":"#FD4E6A","brand":"mard"},{"code":"F13","hex":"#F35744","brand":"mard"},{"code":"F14","hex":"#FFA9AD","brand":"mard"},{"code":"F15","hex":"#D30022","brand":"mard"},{"code":"F16","hex":"#FEC2A6","brand":"mard"},{"code":"F17","hex":"#E69C79","brand":"mard"},{"code":"F18","hex":"#D37C46","brand":"mard"},{"code":"F19","hex":"#C1444A","brand":"mard"},{"code":"F20","hex":"#CD9391","brand":"mard"},{"code":"F21","hex":"#F7B4C6","brand":"mard"},{"code":"F22","hex":"#FDC0D0","brand":"mard"},{"code":"F23","hex":"#F67E66","brand":"mard"},{"code":"F24","hex":"#E698AA","brand":"mard"},{"code":"F25","hex":"#E54B4F","brand":"mard"},{"code":"G10","hex":"#D98C39","brand":"mard"},{"code":"G11","hex":"#E0C593","brand":"mard"},{"code":"G12","hex":"#FFC890","brand":"mard"},{"code":"G13","hex":"#B7714A","brand":"mard"},{"code":"G14","hex":"#8D614C","brand":"mard"},{"code":"G15","hex":"#FCF9E0","brand":"mard"},{"code":"G16","hex":"#F2D9BA","brand":"mard"},{"code":"G17","hex":"#78524B","brand":"mard"},{"code":"G18","hex":"#FFE4CC","brand":"mard"},{"code":"G19","hex":"#E07935","brand":"mard"},{"code":"G20","hex":"#A94023","brand":"mard"},{"code":"G21","hex":"#B88558","brand":"mard"},{"code":"H10","hex":"#EEE9EA","brand":"mard"},{"code":"H11","hex":"#CECDD5","brand":"mard"},{"code":"H12","hex":"#FFF5ED","brand":"mard"},{"code":"H13","hex":"#F5ECD2","brand":"mard"},{"code":"H14","hex":"#CFD7D3","brand":"mard"},{"code":"H15","hex":"#98A6A8","brand":"mard"},{"code":"H16","hex":"#1D1414","brand":"mard"},{"code":"H17","hex":"#F1EDED","brand":"mard"},{"code":"H18","hex":"#FFFDF0","brand":"mard"},{"code":"H19","hex":"#F6EFE2","brand":"mard"},{"code":"H20","hex":"#949FA3","brand":"mard"},{"code":"H21","hex":"#FFFBE1","brand":"mard"},{"code":"H22","hex":"#CACAD4","brand":"mard"},{"code":"H23","hex":"#9A9D94","brand":"mard"},{"code":"M10","hex":"#C5B2BC","brand":"mard"},{"code":"M11","hex":"#9F7594","brand":"mard"},{"code":"M12","hex":"#644749","brand":"mard"},{"code":"M13","hex":"#D19066","brand":"mard"},{"code":"M14","hex":"#C77362","brand":"mard"},{"code":"M15","hex":"#757D78","brand":"mard"},{"code":"P10","hex":"#D9C7EA","brand":"mard"},{"code":"P11","hex":"#F3ECC9","brand":"mard"},{"code":"P12","hex":"#E6EEF2","brand":"mard"},{"code":"P13","hex":"#AACBEF","brand":"mard"},{"code":"P14","hex":"#337680","brand":"mard"},{"code":"P15","hex":"#668575","brand":"mard"},{"code":"P16","hex":"#FEBF45","brand":"mard"},{"code":"P17","hex":"#FEA324","brand":"mard"},{"code":"E01","hex":"#FDD3CC","brand":"mard"},{"code":"M08","hex":"#B38281","brand":"mard"},{"code":"P18","hex":"#FEB89F","brand":"mard"},{"code":"P19","hex":"#FFFEEC","brand":"mard"},{"code":"P20","hex":"#FEBECF","brand":"mard"},{"code":"P21","hex":"#ECBEBF","brand":"mard"},{"code":"P22","hex":"#E4A89F","brand":"mard"},{"code":"P23","hex":"#A56268","brand":"mard"},{"code":"ZG1","hex":"#DAABB3","brand":"mard"},{"code":"ZG2","hex":"#D6AA87","brand":"mard"},{"code":"ZG3","hex":"#C1BD8D","brand":"mard"},{"code":"ZG4","hex":"#96869F","brand":"mard"},{"code":"ZG5","hex":"#8490A6","brand":"mard"},{"code":"ZG6","hex":"#94BFE2","brand":"mard"},{"code":"R10","hex":"#FFDB4C","brand":"mard"},{"code":"R11","hex":"#FFEBFB","brand":"mard"},{"code":"R12","hex":"#D8D5CE","brand":"mard"},{"code":"R13","hex":"#55514C","brand":"mard"},{"code":"R14","hex":"#9FE4DF","brand":"mard"},{"code":"R15","hex":"#77CEE9","brand":"mard"},{"code":"R16","hex":"#3ECFCA","brand":"mard"},{"code":"R17","hex":"#4A867A","brand":"mard"},{"code":"R18","hex":"#7FCD9D","brand":"mard"},{"code":"R19","hex":"#CDE85D","brand":"mard"},{"code":"R20","hex":"#E8C7B4","brand":"mard"},{"code":"R21","hex":"#AD6F3C","brand":"mard"},{"code":"R22","hex":"#6C372F","brand":"mard"},{"code":"R23","hex":"#FEB872","brand":"mard"},{"code":"R24","hex":"#F3C1C0","brand":"mard"},{"code":"R25","hex":"#C9675E","brand":"mard"},{"code":"R26","hex":"#D293BE","brand":"mard"},{"code":"R27","hex":"#EA8CB1","brand":"mard"},{"code":"R28","hex":"#9C87D6","brand":"mard"},{"code":"ZG7","hex":"#E2A9D2","brand":"mard"},{"code":"ZG8","hex":"#AB91C0","brand":"mard"},{"code":"A01","hex":"#FAF4C8","brand":"mard"},{"code":"A03","hex":"#FEFF8B","brand":"mard"},{"code":"A04","hex":"#FBED56","brand":"mard"},{"code":"A05","hex":"#F4D738","brand":"mard"},{"code":"A06","hex":"#FEAC4C","brand":"mard"},{"code":"A07","hex":"#FE8B4C","brand":"mard"},{"code":"A08","hex":"#FFDA45","brand":"mard"},{"code":"A09","hex":"#FF995B","brand":"mard"},{"code":"B01","hex":"#E6EE31","brand":"mard"},{"code":"B02","hex":"#63F347","brand":"mard"},{"code":"B03","hex":"#9EF780","brand":"mard"},{"code":"B04","hex":"#5DE035","brand":"mard"},{"code":"B05","hex":"#35E352","brand":"mard"},{"code":"B06","hex":"#65E2A6","brand":"mard"},{"code":"B07","hex":"#3DAF80","brand":"mard"},{"code":"B08","hex":"#1C9C4F","brand":"mard"},{"code":"B09","hex":"#27523A","brand":"mard"},{"code":"C01","hex":"#E8FFE7","brand":"mard"},{"code":"C02","hex":"#A9F9FC","brand":"mard"},{"code":"C03","hex":"#A0E2FB","brand":"mard"},{"code":"C04","hex":"#41CCFF","brand":"mard"},{"code":"C05","hex":"#01ACEB","brand":"mard"},{"code":"C06","hex":"#50AAF0","brand":"mard"},{"code":"C07","hex":"#3677D2","brand":"mard"},{"code":"C08","hex":"#0F54C0","brand":"mard"},{"code":"C09","hex":"#324BCA","brand":"mard"},{"code":"D01","hex":"#AEB4F2","brand":"mard"},{"code":"D02","hex":"#858EDD","brand":"mard"},{"code":"D03","hex":"#2F54AF","brand":"mard"},{"code":"D04","hex":"#182A84","brand":"mard"},{"code":"D05","hex":"#B843C5","brand":"mard"},{"code":"D06","hex":"#AC7BDE","brand":"mard"},{"code":"D07","hex":"#8854B3","brand":"mard"},{"code":"D08","hex":"#E2D3FF","brand":"mard"},{"code":"D09","hex":"#D5B9F8","brand":"mard"},{"code":"E02","hex":"#FEC0DF","brand":"mard"},{"code":"E03","hex":"#FFB7E7","brand":"mard"},{"code":"E04","hex":"#E8649E","brand":"mard"},{"code":"E05","hex":"#F551A2","brand":"mard"},{"code":"E06","hex":"#F13D74","brand":"mard"},{"code":"E07","hex":"#C63478","brand":"mard"},{"code":"E08","hex":"#FFDBE9","brand":"mard"},{"code":"E09","hex":"#E970CC","brand":"mard"},{"code":"F01","hex":"#FD957B","brand":"mard"},{"code":"F02","hex":"#FC3D46","brand":"mard"},{"code":"F03","hex":"#F74941","brand":"mard"},{"code":"F04","hex":"#FC283C","brand":"mard"},{"code":"F05","hex":"#E7002F","brand":"mard"},{"code":"F06","hex":"#943630","brand":"mard"},{"code":"F07","hex":"#971937","brand":"mard"},{"code":"F08","hex":"#BC0028","brand":"mard"},{"code":"F09","hex":"#E2677A","brand":"mard"},{"code":"G01","hex":"#FFE2CE","brand":"mard"},{"code":"G02","hex":"#FFC4AA","brand":"mard"},{"code":"G03","hex":"#F4C3A5","brand":"mard"},{"code":"G04","hex":"#E1B383","brand":"mard"},{"code":"G05","hex":"#EDB045","brand":"mard"},{"code":"G06","hex":"#E99C17","brand":"mard"},{"code":"G07","hex":"#9D5B3E","brand":"mard"},{"code":"G08","hex":"#753832","brand":"mard"},{"code":"G09","hex":"#E6B483","brand":"mard"},{"code":"H01","hex":"#FDFBFF","brand":"mard"},{"code":"H02","hex":"#FEFFFF","brand":"mard"},{"code":"H03","hex":"#B6B1BA","brand":"mard"},{"code":"H04","hex":"#89858C","brand":"mard"},{"code":"H05","hex":"#48464E","brand":"mard"},{"code":"H06","hex":"#2F2B2F","brand":"mard"},{"code":"H07","hex":"#000000","brand":"mard"},{"code":"H08","hex":"#E7D6DB","brand":"mard"},{"code":"H09","hex":"#EDEDED","brand":"mard"},{"code":"M01","hex":"#BCC6B8","brand":"mard"},{"code":"M02","hex":"#8AA386","brand":"mard"},{"code":"M03","hex":"#697D80","brand":"mard"},{"code":"M04","hex":"#E3D2BC","brand":"mard"},{"code":"M05","hex":"#D0CCAA","brand":"mard"},{"code":"M06","hex":"#B0A782","brand":"mard"},{"code":"M07","hex":"#B4A497","brand":"mard"},{"code":"M09","hex":"#A58767","brand":"mard"},{"code":"P01","hex":"#FCF7F8","brand":"mard"},{"code":"P02","hex":"#B0A9AC","brand":"mard"},{"code":"P03","hex":"#AFDCAB","brand":"mard"},{"code":"P04","hex":"#FEA49F","brand":"mard"},{"code":"P05","hex":"#EE8C3E","brand":"mard"},{"code":"P06","hex":"#5FD0A7","brand":"mard"},{"code":"P07","hex":"#EB9270","brand":"mard"},{"code":"P08","hex":"#F0D958","brand":"mard"},{"code":"P09","hex":"#D9D9D9","brand":"mard"},{"code":"Q01","hex":"#F2A5E8","brand":"mard"},{"code":"Q02","hex":"#E9EC91","brand":"mard"},{"code":"Q03","hex":"#FFFF00","brand":"mard"},{"code":"Q04","hex":"#FFEBFA","brand":"mard"},{"code":"Q05","hex":"#76CEDE","brand":"mard"},{"code":"R01","hex":"#D50D21","brand":"mard"},{"code":"R02","hex":"#F92F83","brand":"mard"},{"code":"R03","hex":"#FD8324","brand":"mard"},{"code":"R04","hex":"#F8EC31","brand":"mard"},{"code":"R05","hex":"#35C75B","brand":"mard"},{"code":"R06","hex":"#238891","brand":"mard"},{"code":"R07","hex":"#19779D","brand":"mard"},{"code":"R08","hex":"#1A60C3","brand":"mard"},{"code":"R09","hex":"#9A56B4","brand":"mard"},{"code":"T01","hex":"#FFFFFF","brand":"mard"},{"code":"Y01","hex":"#FD6FB4","brand":"mard"},{"code":"Y02","hex":"#FEB481","brand":"mard"},{"code":"Y03","hex":"#D7FAA0","brand":"mard"},{"code":"Y04","hex":"#8BDBFA","brand":"mard"},{"code":"Y05","hex":"#E987EA","brand":"mard"}];
/* ============================================================================
 * 文字 → 拼豆图纸（像素字体版）
 * 纯 JS、零依赖。字形数据 + 排版 + 色号映射 + 预览/导出。
 *
 * 与 bead-pattern-importer.js 的区别：
 *   那个是「图片 → 图纸」（识别），这个是「文字 → 图纸」（生成）。
 *   输出统一为色号网格（['A10', null, ...]），可直接喂给同一套编辑器。
 *
 * 依赖同作用域内的色卡常量（打包时注入 MARD 290 色），
 * 也可在调用时用 palette 选项覆盖成你自己的色卡。
 * ==========================================================================*/

var BeadText = (function () {
'use strict';

/* ------------------------------------------------------------ 色卡 / 颜色 */
var MARD = __MARD_PALETTE__;

function hexToRgb(hex) {
  var h = String(hex || '').replace('#', '').trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  if (!/^[0-9a-fA-F]{6}$/.test(h)) return null;
  var n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function rgbToHex(r, g, b) {
  var p = function (v) { return Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0'); };
  return '#' + p(r) + p(g) + p(b);
}
function normalizeHex(input, fallback) {
  var c = hexToRgb(input);
  return c ? rgbToHex(c[0], c[1], c[2]).toUpperCase() : (fallback || '#000000');
}

/* sRGB → CIE Lab（D65），用于按感知色差找最近色号 */
function rgbToLab(r, g, b) {
  var f = function (v) {
    v /= 255;
    return v > 0.04045 ? Math.pow((v + 0.055) / 1.055, 2.4) : v / 12.92;
  };
  var R = f(r), G = f(g), B = f(b);
  var X = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  var Y = (R * 0.2126 + G * 0.7152 + B * 0.0722) / 1.00000;
  var Z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  var t = function (v) { return v > 0.008856 ? Math.cbrt(v) : (7.787 * v + 16 / 116); };
  return [116 * t(Y) - 16, 500 * (t(X) - t(Y)), 200 * (t(Y) - t(Z))];
}
function deltaE(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}

/** 预处理色卡：预先算好 Lab，避免逐格重复转换 */
function preparePalette(palette) {
  return palette.map(function (p) {
    var rgb = hexToRgb(p.hex) || [0, 0, 0];
    return { code: p.code, hex: normalizeHex(p.hex), name: p.name || '', rgb: rgb, lab: rgbToLab(rgb[0], rgb[1], rgb[2]) };
  });
}
var _prepared = null;
function prepared() {
  if (!_prepared) _prepared = preparePalette(MARD);
  return _prepared;
}

/** 一个颜色 → 色卡中最近的色号 */
function matchCode(hex, palette) {
  var pal = (palette && palette.length ? palette : MARD);
  var pre = (pal === MARD) ? prepared() : preparePalette(pal);
  var rgb = hexToRgb(hex) || [0, 0, 0];
  var lab = rgbToLab(rgb[0], rgb[1], rgb[2]);
  var best = null, bestD = Infinity;
  for (var i = 0; i < pre.length; i++) {
    var d = deltaE(lab, pre[i].lab);
    if (d < bestD) { bestD = d; best = pre[i]; }
  }
  return best ? best.code : null;
}

/* ------------------------------------------------------------ 渐变配色 */
var GRADIENT_PRESETS = [
  { name: '日落', stops: ['#F97316', '#EF4444'] },
  { name: '海洋', stops: ['#38BDF8', '#4F46E5'] },
  { name: '莓果', stops: ['#F472B6', '#7C3AED'] },
  { name: '抹茶', stops: ['#84CC16', '#059669'] },
  { name: '霓虹', stops: ['#22D3EE', '#A855F7', '#EC4899'] },
  { name: '彩虹', stops: ['#EF4444', '#F59E0B', '#22C55E', '#3B82F6'] },
  { name: '极光', stops: ['#2DD4BF', '#6366F1', '#E879F9'] },
];
var SOLID_SWATCHES = [
  '#111827', '#475569', '#EF4444', '#F97316', '#F59E0B', '#22C55E',
  '#14B8A6', '#0EA5E9', '#3B82F6', '#6366F1', '#8B5CF6', '#EC4899',
];

function mixHex(a, b, t) {
  var ca = hexToRgb(a) || [0, 0, 0], cb = hexToRgb(b) || [255, 255, 255];
  var r = Math.max(0, Math.min(1, t));
  var ch = function (x, y) { return Math.round(x + (y - x) * r).toString(16).padStart(2, '0'); };
  return '#' + ch(ca[0], cb[0]) + ch(ca[1], cb[1]) + ch(ca[2], cb[2]);
}
function gradientColorAt(stops, t) {
  var clean = (stops || []).filter(Boolean).map(function (s) { return normalizeHex(s); });
  if (!clean.length) return '#000000';
  if (clean.length === 1) return clean[0];
  var c = Math.max(0, Math.min(1, t));
  var scaled = c * (clean.length - 1);
  var idx = Math.min(Math.floor(scaled), clean.length - 2);
  return mixHex(clean[idx], clean[idx + 1], scaled - idx).toUpperCase();
}
function gradientProgress(row, col, width, height, direction) {
  if (direction === 'vertical') return height <= 1 ? 0 : row / (height - 1);
  if (direction === 'diagonal') {
    var span = width + height - 2;
    return span <= 0 ? 0 : (row + col) / span;
  }
  return width <= 1 ? 0 : col / (width - 1);
}
/** 依据前景配置取某个格子应使用的颜色 */
function resolveStrokeColor(config, row, col, width, height) {
  if (config && config.mode === 'gradient' && config.stops && config.stops.length) {
    return gradientColorAt(config.stops, gradientProgress(row, col, width, height, config.direction || 'horizontal'));
  }
  return normalizeHex((config && config.foreground) || '#111827', '#111827');
}

/* ============================================================ 点阵字体数据
 * 每个字形 = 若干行等长二进制串，'1' 为点亮。
 * 5×7 / 3×5 是行业标准点阵规格，字形按豆格盖章，边缘天然对齐豆格，
 * 不存在矢量字体缩到豆格就糊边的问题。
 * ==========================================================================*/
function g5(rows) { return rows; }   // rows: ['01110','10001',...]

var FONT_5X7 = {
  id: 'pixel-5x7', label: '像素 5×7', gw: 5, gh: 7, spacing: 1, glyphs: {
    A: g5(['01110','10001','10001','11111','10001','10001','10001']),
    B: g5(['11110','10001','10001','11110','10001','10001','11110']),
    C: g5(['01110','10001','10000','10000','10000','10001','01110']),
    D: g5(['11110','10001','10001','10001','10001','10001','11110']),
    E: g5(['11111','10000','10000','11110','10000','10000','11111']),
    F: g5(['11111','10000','10000','11110','10000','10000','10000']),
    G: g5(['01110','10001','10000','10111','10001','10001','01110']),
    H: g5(['10001','10001','10001','11111','10001','10001','10001']),
    I: g5(['11111','00100','00100','00100','00100','00100','11111']),
    J: g5(['00001','00001','00001','00001','10001','10001','01110']),
    K: g5(['10001','10010','10100','11000','10100','10010','10001']),
    L: g5(['10000','10000','10000','10000','10000','10000','11111']),
    M: g5(['10001','11011','10101','10001','10001','10001','10001']),
    N: g5(['10001','11001','10101','10011','10001','10001','10001']),
    O: g5(['01110','10001','10001','10001','10001','10001','01110']),
    P: g5(['11110','10001','10001','11110','10000','10000','10000']),
    Q: g5(['01110','10001','10001','10001','10101','10010','01101']),
    R: g5(['11110','10001','10001','11110','10100','10010','10001']),
    S: g5(['01111','10000','10000','01110','00001','00001','11110']),
    T: g5(['11111','00100','00100','00100','00100','00100','00100']),
    U: g5(['10001','10001','10001','10001','10001','10001','01110']),
    V: g5(['10001','10001','10001','10001','10001','01010','00100']),
    W: g5(['10001','10001','10001','10101','10101','11011','10001']),
    X: g5(['10001','10001','01010','00100','01010','10001','10001']),
    Y: g5(['10001','10001','01010','00100','00100','00100','00100']),
    Z: g5(['11111','00001','00010','00100','01000','10000','11111']),
    a: g5(['00000','00000','01110','00001','01111','10001','01111']),
    b: g5(['10000','10000','11110','10001','10001','10001','11110']),
    c: g5(['00000','00000','01110','10001','10000','10001','01110']),
    d: g5(['00001','00001','01111','10001','10001','10001','01111']),
    e: g5(['00000','00000','01110','10001','11111','10000','01110']),
    f: g5(['00110','01000','01000','11110','01000','01000','01000']),
    g: g5(['00000','01111','10001','10001','01111','00001','01110']),
    h: g5(['10000','10000','11110','10001','10001','10001','10001']),
    i: g5(['00100','00000','01100','00100','00100','00100','01110']),
    j: g5(['00010','00000','00110','00010','00010','10010','01100']),
    k: g5(['10000','10000','10010','10100','11000','10100','10010']),
    l: g5(['01100','00100','00100','00100','00100','00100','01110']),
    m: g5(['00000','00000','11010','10101','10101','10101','10001']),
    n: g5(['00000','00000','11110','10001','10001','10001','10001']),
    o: g5(['00000','00000','01110','10001','10001','10001','01110']),
    p: g5(['00000','11110','10001','10001','11110','10000','10000']),
    q: g5(['00000','01111','10001','10001','01111','00001','00001']),
    r: g5(['00000','00000','10110','11001','10000','10000','10000']),
    s: g5(['00000','00000','01111','10000','01110','00001','11110']),
    t: g5(['01000','01000','11110','01000','01000','01001','00110']),
    u: g5(['00000','00000','10001','10001','10001','10011','01101']),
    v: g5(['00000','00000','10001','10001','10001','01010','00100']),
    w: g5(['00000','00000','10001','10001','10101','10101','01010']),
    x: g5(['00000','00000','10001','01010','00100','01010','10001']),
    y: g5(['00000','10001','10001','10001','01111','00001','01110']),
    z: g5(['00000','00000','11111','00010','00100','01000','11111']),
    '0': g5(['01110','10001','10011','10101','11001','10001','01110']),
    '1': g5(['00100','01100','00100','00100','00100','00100','01110']),
    '2': g5(['01110','10001','00001','00010','00100','01000','11111']),
    '3': g5(['11111','00010','00100','00010','00001','10001','01110']),
    '4': g5(['00010','00110','01010','10010','11111','00010','00010']),
    '5': g5(['11111','10000','11110','00001','00001','10001','01110']),
    '6': g5(['00110','01000','10000','11110','10001','10001','01110']),
    '7': g5(['11111','00001','00010','00100','01000','01000','01000']),
    '8': g5(['01110','10001','10001','01110','10001','10001','01110']),
    '9': g5(['01110','10001','10001','01111','00001','00010','01100']),
    ' ': g5(['00000','00000','00000','00000','00000','00000','00000']),
    '.': g5(['00000','00000','00000','00000','00000','01100','01100']),
    ',': g5(['00000','00000','00000','00000','01100','01100','01000']),
    '!': g5(['00100','00100','00100','00100','00100','00000','00100']),
    '?': g5(['01110','10001','00001','00010','00100','00000','00100']),
    ':': g5(['00000','01100','01100','00000','01100','01100','00000']),
    ';': g5(['00000','01100','01100','00000','01100','01100','01000']),
    "'": g5(['00100','00100','00000','00000','00000','00000','00000']),
    '"': g5(['01010','01010','00000','00000','00000','00000','00000']),
    '-': g5(['00000','00000','00000','11111','00000','00000','00000']),
    '_': g5(['00000','00000','00000','00000','00000','00000','11111']),
    '+': g5(['00000','00100','00100','11111','00100','00100','00000']),
    '=': g5(['00000','00000','11111','00000','11111','00000','00000']),
    '*': g5(['00000','00100','10101','01110','10101','00100','00000']),
    '/': g5(['00001','00001','00010','00100','01000','10000','10000']),
    '\\': g5(['10000','10000','01000','00100','00010','00001','00001']),
    '(': g5(['00010','00100','01000','01000','01000','00100','00010']),
    ')': g5(['01000','00100','00010','00010','00010','00100','01000']),
    '[': g5(['00111','00100','00100','00100','00100','00100','00111']),
    ']': g5(['11100','00100','00100','00100','00100','00100','11100']),
    '<': g5(['00010','00100','01000','10000','01000','00100','00010']),
    '>': g5(['01000','00100','00010','00001','00010','00100','01000']),
    '#': g5(['01010','01010','11111','01010','11111','01010','01010']),
    '%': g5(['11000','11001','00010','00100','01000','10011','00011']),
    '&': g5(['01100','10010','10010','01100','10101','10010','01101']),
    '@': g5(['01110','10001','10111','10101','10111','10000','01110']),
    '$': g5(['00100','01111','10100','01110','00101','11110','00100']),
    '~': g5(['00000','00000','01101','10010','00000','00000','00000']),
    '^': g5(['00100','01010','10001','00000','00000','00000','00000']),
    '|': g5(['00100','00100','00100','00100','00100','00100','00100']),
  },
};

var FONT_3X5 = {
  id: 'pixel-3x5', label: '像素 3×5', gw: 3, gh: 5, spacing: 1, glyphs: {
    A: g5(['010','101','111','101','101']),
    B: g5(['110','101','110','101','110']),
    C: g5(['011','100','100','100','011']),
    D: g5(['110','101','101','101','110']),
    E: g5(['111','100','110','100','111']),
    F: g5(['111','100','110','100','100']),
    G: g5(['011','100','101','101','011']),
    H: g5(['101','101','111','101','101']),
    I: g5(['111','010','010','010','111']),
    J: g5(['001','001','001','101','010']),
    K: g5(['101','101','110','101','101']),
    L: g5(['100','100','100','100','111']),
    M: g5(['101','111','101','101','101']),
    N: g5(['101','111','111','101','101']),
    O: g5(['010','101','101','101','010']),
    P: g5(['110','101','110','100','100']),
    Q: g5(['010','101','101','111','011']),
    R: g5(['110','101','110','101','101']),
    S: g5(['011','100','010','001','110']),
    T: g5(['111','010','010','010','010']),
    U: g5(['101','101','101','101','111']),
    V: g5(['101','101','101','101','010']),
    W: g5(['101','101','111','111','101']),
    X: g5(['101','101','010','101','101']),
    Y: g5(['101','101','010','010','010']),
    Z: g5(['111','001','010','100','111']),
    '0': g5(['111','101','101','101','111']),
    '1': g5(['010','110','010','010','111']),
    '2': g5(['110','001','010','100','111']),
    '3': g5(['111','001','011','001','111']),
    '4': g5(['101','101','111','001','001']),
    '5': g5(['111','100','110','001','110']),
    '6': g5(['011','100','111','101','111']),
    '7': g5(['111','001','010','100','100']),
    '8': g5(['111','101','111','101','111']),
    '9': g5(['111','101','111','001','110']),
    ' ': g5(['000','000','000','000','000']),
    '.': g5(['000','000','000','000','010']),
    ',': g5(['000','000','000','010','100']),
    '!': g5(['010','010','010','000','010']),
    '?': g5(['110','001','010','000','010']),
    ':': g5(['000','010','000','010','000']),
    '-': g5(['000','000','111','000','000']),
    '+': g5(['000','010','111','010','000']),
    '=': g5(['000','111','000','111','000']),
    '/': g5(['001','001','010','100','100']),
    '(': g5(['001','010','010','010','001']),
    ')': g5(['100','010','010','010','100']),
  },
};

var BITMAP_FONTS = [FONT_5X7, FONT_3X5];
function getBitmapFont(id) {
  for (var i = 0; i < BITMAP_FONTS.length; i++) if (BITMAP_FONTS[i].id === id) return BITMAP_FONTS[i];
  return null;
}

/* canvas 字体（含中文）：按豆格硬阈值切边，中文也能出方正的字 */
var TEXT_FONTS = [
  { id: 'pixel-5x7', label: '像素 5×7', group: '像素字', kind: 'bitmap', bitmapId: 'pixel-5x7' },
  { id: 'pixel-3x5', label: '像素 3×5', group: '像素字', kind: 'bitmap', bitmapId: 'pixel-3x5' },
  { id: 'pixel-sans', label: '中文像素·黑体', group: '像素字', kind: 'canvas', pixelated: true,
    family: '"PingFang SC","Microsoft YaHei","Noto Sans SC","Hiragino Sans GB",system-ui,sans-serif' },
  { id: 'pixel-serif', label: '中文像素·宋体', group: '像素字', kind: 'canvas', pixelated: true,
    family: '"Songti SC","SimSun","Noto Serif SC","Source Han Serif SC",serif' },
  { id: 'sans', label: '黑体（平滑）', group: '系统字体', kind: 'canvas', family: '"PingFang SC","Microsoft YaHei","Noto Sans SC",system-ui,sans-serif' },
  { id: 'serif', label: '宋体（平滑）', group: '系统字体', kind: 'canvas', family: '"Songti SC","SimSun","Noto Serif SC",serif' },
  { id: 'kai', label: '楷体', group: '系统字体', kind: 'canvas', family: '"Kaiti SC",KaiTi,"STKaiti","Noto Serif SC",serif' },
  { id: 'mono', label: '等宽', group: '系统字体', kind: 'canvas', family: '"Menlo","Consolas","Courier New",monospace' },
];
function getTextFont(id) {
  for (var i = 0; i < TEXT_FONTS.length; i++) if (TEXT_FONTS[i].id === id) return TEXT_FONTS[i];
  return TEXT_FONTS[0];
}

/** 取字形；小写缺失时回退到大写 */
function getGlyph(font, ch) {
  if (!font) return null;
  if (font.glyphs[ch]) return font.glyphs[ch];
  var up = font.glyphs[ch.toUpperCase()];
  return up || null;
}
/** 点阵字体不支持的字符（去重、忽略换行）——用于缺字提示 */
function findUnsupportedChars(font, text) {
  var missing = [];
  var seen = {};
  var s = String(text || '').replace(/[\r\n]/g, '');
  for (var i = 0; i < s.length; i++) {
    var ch = s[i];
    if (ch === ' ' || seen[ch]) continue;
    if (!getGlyph(font, ch)) { seen[ch] = 1; missing.push(ch); }
  }
  return missing;
}
/** 单行位图宽度（位图像素） */
function measureGlyphLine(font, line) {
  if (!line.length) return 0;
  return line.length * font.gw + (line.length - 1) * font.spacing;
}

/* ============================================================ 文字 → 网格 */
var EMPTY = '#FFFFFF';

function fail(error) { return { ok: false, error: error }; }

/**
 * @param {object} o
 *   text          文字内容，\n 换行
 *   fontId        见 TEXT_FONTS
 *   bold          仅 canvas 字体有效
 *   widthBeads    目标宽度（豆数），最小 4
 *   lineHeight    行距倍率（1 = 紧凑）
 *   threshold     覆盖度阈值，越高字越细（canvas 字体）
 *   align         left | center | right
 *   foreground    { mode:'solid'|'gradient', foreground, stops[], direction }
 *   background    背景色 HEX，映射为「留空」
 *   palette       色卡（默认内置 MARD）
 *   codeGrid      true = 输出色号网格；false = 输出 HEX 网格
 */
function buildText(o) {
  o = o || {};
  var text = String(o.text == null ? '' : o.text);
  if (!text.trim()) return fail('先输入要生成的文字');

  var font = getTextFont(o.fontId);
  var fg = o.foreground || { mode: 'solid', foreground: '#111827', stops: [], direction: 'horizontal' };
  var background = normalizeHex(o.background, EMPTY);
  var palette = (o.palette && o.palette.length) ? o.palette : MARD;
  var codeGrid = o.codeGrid !== false;
  var align = o.align || 'center';
  var widthBeads = Math.max(4, Math.min(200, Math.round(Number(o.widthBeads) || 40)));
  var lineHeight = Math.max(0.8, Math.min(2.4, Number(o.lineHeight) || 1));
  var threshold = Math.max(0.05, Math.min(0.9, o.threshold == null ? 0.5 : Number(o.threshold)));

  var res = font.kind === 'bitmap'
    ? buildBitmapText(o, text, font, fg, background, palette, codeGrid, align, widthBeads, lineHeight)
    : buildCanvasText(o, text, font, fg, background, palette, codeGrid, align, widthBeads, lineHeight, threshold);

  if (!res.ok) return res;
  res.value.background = background;
  res.value.fontId = font.id;
  res.value.fontLabel = font.label;
  return res;
}

/* ---- 点阵字体：字形按豆格盖章 ---- */
function buildBitmapText(o, text, font, fg, background, palette, codeGrid, align, widthBeads, lineHeight) {
  var lines = String(text).replace(/\r/g, '').split('\n');
  var bf = getBitmapFont(font.bitmapId);
  if (!bf) return fail('像素字体数据缺失');
  var padding = 1;
  var contentWidth = Math.max(1, widthBeads - padding * 2);

  var widest = 1;
  lines.forEach(function (l) { widest = Math.max(widest, measureGlyphLine(bf, l)); });

  // 整体整数倍放大，保证铺满宽度且边缘仍是方块
  var scale = Math.max(1, Math.floor(contentWidth / widest));
  var note;
  if (widest * scale > contentWidth) {
    var need = widest + padding * 2;                 // 一颗豆一个点都放不下 → 自动加宽
    if (need > 200) return fail('文字太长放不下，请减少文字或拆成多行');
    widthBeads = Math.max(widthBeads, need);
    contentWidth = Math.max(1, widthBeads - padding * 2);
    scale = Math.max(1, Math.floor(contentWidth / widest));
    note = '文字较宽，画布已自动加宽到 ' + widthBeads + ' 颗豆';
  }

  var gapPx = Math.round(bf.gh * Math.max(0, lineHeight - 1));
  var blockRows = lines.length * bf.gh + Math.max(0, lines.length - 1) * gapPx;
  var heightBeads = blockRows * scale + padding * 2;

  if (heightBeads > 280 || widthBeads * heightBeads > 60000) {
    return fail('内容太多，请减少文字或调小宽度');
  }

  var missing = findUnsupportedChars(bf, text);
  if (missing.length) {
    return fail('像素字体缺少这些字符：' + missing.join(' ') + '（中文请选「中文像素·黑体/宋体」）');
  }

  var hex = [];
  var i, r, c;
  for (r = 0; r < heightBeads; r++) hex.push(new Array(widthBeads).fill(background));

  var drawn = 0;
  lines.forEach(function (line, li) {
    var lineW = measureGlyphLine(bf, line) * scale;
    var startCol;
    if (align === 'left') startCol = padding;
    else if (align === 'right') startCol = padding + Math.max(0, contentWidth - lineW);
    else startCol = padding + Math.floor((contentWidth - lineW) / 2);
    var startRow = padding + li * (bf.gh + gapPx) * scale;
    var col = startCol;

    for (i = 0; i < line.length; i++) {
      var gl = getGlyph(bf, line[i]);
      if (!gl) { col += (bf.gw + bf.spacing) * scale; continue; }
      drawn++;
      for (var gy = 0; gy < bf.gh; gy++) {
        var rowStr = gl[gy] || '';
        for (var gx = 0; gx < bf.gw; gx++) {
          if (rowStr[gx] !== '1') continue;
          for (var sy = 0; sy < scale; sy++) {
            var rr = startRow + gy * scale + sy;
            if (rr < 0 || rr >= heightBeads) continue;
            for (var sx = 0; sx < scale; sx++) {
              var cc = col + gx * scale + sx;
              if (cc < 0 || cc >= widthBeads) continue;
              hex[rr][cc] = resolveStrokeColor(fg, rr, cc, widthBeads, heightBeads);
            }
          }
        }
      }
      col += (bf.gw + bf.spacing) * scale;
    }
  });

  if (!drawn) return fail('这套像素字体只有英文和数字，中文请选「中文像素·黑体 / 宋体」');
  return finalize(hex, background, font, palette, codeGrid, note, []);
}

/* ---- canvas 字体（含中文）：超采样后按豆格硬阈值切边 ---- */
function buildCanvasText(o, text, font, fg, background, palette, codeGrid, align, widthBeads, lineHeight, threshold) {
  if (typeof document === 'undefined') return fail('当前环境不支持文字绘图（需要浏览器）');
  var lines = String(text).replace(/\r/g, '').split('\n');
  var family = font.family || 'sans-serif';
  var pixelated = !!font.pixelated;
  // 超采样：先高分辨率绘制文字，再按豆格求覆盖度。
  // 像素模式用较低倍率，让每个豆格只落到少数采样点，边缘更方正。
  var supersample = pixelated ? 4 : (widthBeads <= 72 ? 8 : 4);
  var padding = 1;
  var contentWidth = Math.max(1, widthBeads - padding * 2);
  var lineHeightMul = Math.max(0.8, Math.min(2.4, lineHeight));
  // 像素模式要求多数采样点命中，避免抗锯齿灰边把字形糊大
  var coverageCut = pixelated ? Math.max(threshold, 0.5) : threshold;
  var weight = o.bold ? 'bold ' : '';

  var REF = 100;
  var mc = document.createElement('canvas');
  var mx = mc.getContext('2d');
  if (!mx) return fail('当前环境不支持文字绘图');
  mx.font = weight + REF + 'px ' + family;
  var widest = 1;
  lines.forEach(function (l) { widest = Math.max(widest, mx.measureText(l.length ? l : ' ').width); });

  // 字号按目标宽度自适应 —— 文字多时自动缩小，不会被裁掉
  var fontSize = Math.max(4, (REF * contentWidth * supersample) / widest);
  var gap = Math.max(0, fontSize * (lineHeightMul - 1));
  var blockHeight = lines.length * fontSize + Math.max(0, lines.length - 1) * gap;
  var padPx = padding * supersample;
  var heightBeads = Math.max(2, Math.ceil((blockHeight + padPx * 2) / supersample));

  if (heightBeads > 260 || widthBeads * heightBeads > 40000) {
    return fail('内容太多，请减少文字或调小宽度');
  }

  var cv = document.createElement('canvas');
  cv.width = widthBeads * supersample;
  cv.height = heightBeads * supersample;
  var ctx = cv.getContext('2d', { willReadFrequently: true });
  if (!ctx) return fail('当前环境不支持文字绘图');

  ctx.clearRect(0, 0, cv.width, cv.height);
  ctx.font = weight + fontSize + 'px ' + family;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#000000';

  var startY = padPx + Math.max(0, (cv.height - padPx * 2 - blockHeight) / 2) + fontSize / 2;
  lines.forEach(function (line, i) {
    var x = align === 'left' ? padPx + blockHeight / 2 : (align === 'right' ? cv.width - padPx - blockHeight / 2 : cv.width / 2);
    ctx.fillText(line, x, startY + i * (fontSize + gap));
  });

  var px = ctx.getImageData(0, 0, cv.width, cv.height).data;
  var area = supersample * supersample;
  var hex = [];
  var shrinkNote = (fontSize < REF * 0.35) ? '文字较多，字号已自动缩小，可加宽画布或减少文字' : null;

  for (var by = 0; by < heightBeads; by++) {
    var row = [];
    for (var bx = 0; bx < widthBeads; bx++) {
      var alphaSum = 0;
      for (var sy = 0; sy < supersample; sy++) {
        var off = (by * supersample + sy) * cv.width;
        for (var sx = 0; sx < supersample; sx++) {
          alphaSum += px[(off + bx * supersample + sx) * 4 + 3];
        }
      }
      row.push(alphaSum / (area * 255) >= coverageCut
        ? resolveStrokeColor(fg, by, bx, widthBeads, heightBeads)
        : background);
    }
    hex.push(row);
  }
  return finalize(hex, background, font, palette, codeGrid, shrinkNote, []);
}

/* ---- 收尾：HEX 网格 → 色号网格 + 用量统计 ---- */
function finalize(hex, background, font, palette, codeGrid, note, missing) {
  var rows = hex.length, cols = rows ? hex[0].length : 0;
  var codeCache = {};
  var grid = [];
  var usage = {};
  var fgCount = 0;
  var r, c, hexColor, code;

  for (r = 0; r < rows; r++) {
    var line = [];
    for (c = 0; c < cols; c++) {
      hexColor = hex[r][c];
      if (hexColor === background) { line.push(null); continue; }
      if (codeGrid) {
        code = codeCache[hexColor];
        if (code === undefined) { code = matchCode(hexColor, palette); codeCache[hexColor] = code; }
        if (code) { usage[code] = (usage[code] || 0) + 1; fgCount++; }
        line.push(code);
      } else {
        line.push(hexColor);
      }
    }
    grid.push(line);
  }

  var usageList = Object.keys(usage).map(function (k) { return { code: k, count: usage[k] }; });
  usageList.sort(function (a, b) { return b.count - a.count; });
  var pre = (palette === MARD) ? prepared() : preparePalette(palette);
  var meta = {};
  pre.forEach(function (p) { meta[p.code] = p; });
  usageList = usageList.map(function (u) {
    var m = meta[u.code] || {};
    return { code: u.code, count: u.count, hex: m.hex || null, name: m.name || null };
  });

  return {
    ok: true,
    value: {
      grid: grid,
      colors: hex,
      width: cols,
      height: rows,
      usage: usageList,
      foregroundCount: fgCount,
      missing: missing,
      note: note || null,
    },
  };
}

/* ============================================================ 预览 / 导出 */
function renderPreview(canvas, value, opts) {
  opts = opts || {};
  var rows = value.grid.length, cols = rows ? value.grid[0].length : 0;
  if (!rows || !cols) return;
  var box = opts.boxSize || 260;
  var cell = Math.max(1, Math.floor(box / Math.max(rows, cols)));
  var w = cols * cell, h = rows * cell;
  var dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = w + 'px';
  canvas.style.height = h + 'px';
  var ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = value.background || EMPTY;
  ctx.fillRect(0, 0, w, h);
  var paletteMap = null;
  if (opts.palette && opts.palette.length) {
    paletteMap = {};
    opts.palette.forEach(function (p) { paletteMap[p.code] = normalizeHex(p.hex); });
  }
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var v = value.grid[r][c];
      if (v == null) continue;
      var color = paletteMap ? (paletteMap[v] || v) : v;
      ctx.fillStyle = color;
      ctx.fillRect(c * cell, r * cell, cell, cell);
    }
  }
}

/** 导出 PNG（带网格线 + 色号，格子够大时才标字） */
function exportPng(value, fileName, cellSize, opts) {
  cellSize = cellSize || 16;
  opts = opts || {};
  var rows = value.grid.length, cols = rows ? value.grid[0].length : 0;
  if (!rows || !cols) return null;
  var cv = document.createElement('canvas');
  cv.width = cols * cellSize;
  cv.height = rows * cellSize;
  var ctx = cv.getContext('2d');
  if (!ctx) return null;
  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, cv.width, cv.height);

  var paletteMap = null;
  if (opts.palette && opts.palette.length) {
    paletteMap = {};
    opts.palette.forEach(function (p) { paletteMap[p.code] = normalizeHex(p.hex); });
  }
  for (var r = 0; r < rows; r++) {
    for (var c = 0; c < cols; c++) {
      var v = value.grid[r][c];
      if (v == null) continue;
      var color = paletteMap ? (paletteMap[v] || v) : v;
      ctx.fillStyle = color;
      ctx.fillRect(c * cellSize, r * cellSize, cellSize, cellSize);
    }
  }
  if (cellSize >= 10) {
    ctx.strokeStyle = 'rgba(0,0,0,.18)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (var x = 0; x <= cols; x++) { ctx.moveTo(x * cellSize + .5, 0); ctx.lineTo(x * cellSize + .5, cv.height); }
    for (var y = 0; y <= rows; y++) { ctx.moveTo(0, y * cellSize + .5); ctx.lineTo(cv.width, y * cellSize + .5); }
    ctx.stroke();
    if (cellSize >= 14) {
      ctx.font = Math.round(cellSize * 0.34) + 'px -apple-system,system-ui,sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (var r2 = 0; r2 < rows; r2++) {
        for (var c2 = 0; c2 < cols; c2++) {
          var code = value.grid[r2][c2];
          if (code == null) continue;
          var hex = paletteMap ? (paletteMap[code] || code) : code;
          var rgb = hexToRgb(hex) || [255, 255, 255];
          ctx.fillStyle = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 140 ? '#111827' : '#ffffff';
          ctx.fillText(code, c2 * cellSize + cellSize / 2, r2 * cellSize + cellSize / 2, cellSize - 2);
        }
      }
    }
  }
  if (typeof document !== 'undefined') {
    var link = document.createElement('a');
    link.href = cv.toDataURL('image/png');
    link.download = fileName || 'bead-text.png';
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { link.remove(); }, 300);
  }
  return cv;
}

/* ============================================================ 导出 */
return {
  buildText: buildText,
  matchCode: matchCode,
  preparePalette: preparePalette,
  hexToRgb: hexToRgb,
  rgbToHex: rgbToHex,
  normalizeHex: normalizeHex,
  renderPreview: renderPreview,
  exportPng: exportPng,
  findUnsupportedChars: findUnsupportedChars,
  measureGlyphLine: measureGlyphLine,
  getBitmapFont: getBitmapFont,
  getTextFont: getTextFont,
  TEXT_FONTS: TEXT_FONTS,
  BITMAP_FONTS: BITMAP_FONTS,
  GRADIENT_PRESETS: GRADIENT_PRESETS,
  SOLID_SWATCHES: SOLID_SWATCHES,
  MARD: MARD,
  EMPTY: EMPTY,
};
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BeadText;

/* 文字拼豆小工具的 UI 层：输入 / 字体 / 配色 / 预览 / 确认
 * 依赖同作用域的 BeadText（bead-text-core.js）
 * 用法：BeadTextUI.mount(el, { palette, onConfirm(result) })
 */
var BeadTextUI = (function () {
'use strict';

var CSS = [
  '.bt{--ln:#e5e7eb;--tx:#1f2937;--sub:#6b7280;--ac:#f97316;font:14px/1.6 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--tx)}',
  '.bt *{box-sizing:border-box}',
  '.bt-grid{display:flex;gap:16px;align-items:flex-start}',
  '.bt-left{flex:1 1 auto;min-width:0}',
  '.bt-right{flex:0 0 260px;width:260px}',
  '@media(max-width:820px){.bt-grid{flex-direction:column}.bt-right{width:100%;flex:1 1 auto}}',
  '.bt label{display:block;font-size:12px;color:var(--sub);margin:10px 0 4px}',
  '.bt input[type=text],.bt textarea,.bt select,.bt input[type=number]{width:100%;padding:6px 8px;border:1px solid var(--ln);border-radius:7px;font-size:13px;background:#fff;color:var(--tx);font-family:inherit}',
  '.bt textarea{resize:vertical;min-height:64px}',
  '.bt .row{display:flex;gap:8px}.bt .row>*{flex:1}',
  '.bt .chk{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--tx);margin:10px 12px 0 0}',
  '.bt button{padding:6px 12px;border:1px solid var(--ln);border-radius:7px;background:#fff;cursor:pointer;font-size:13px;color:var(--tx)}',
  '.bt button:hover{background:#f3f4f6}',
  '.bt button.pri{background:var(--ac);border-color:var(--ac);color:#fff}',
  '.bt button.pri:hover{filter:brightness(.95)}',
  '.bt .bar{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0 0}',
  '.bt .prev{border:1px solid var(--ln);border-radius:10px;background:#fff;padding:12px;display:flex;align-items:center;justify-content:center;min-height:220px;overflow:auto}',
  '.bt .sw{display:inline-block;width:22px;height:22px;border-radius:5px;border:1px solid rgba(0,0,0,.12);cursor:pointer;vertical-align:middle}',
  '.bt .sw.on{outline:2px solid var(--ac);outline-offset:1px}',
  '.bt .sws{display:flex;flex-wrap:wrap;gap:6px}',
  '.bt .err{background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:10px}',
  '.bt .note{background:#fffbeb;border:1px solid #fde68a;color:#92400e;border-radius:8px;padding:8px 10px;font-size:12px;margin-top:10px}',
  '.bt .kv{display:flex;justify-content:space-between;font-size:12px;padding:3px 0}.bt .kv span:first-child{color:var(--sub)}',
  '.bt .usage{max-height:240px;overflow:auto;margin-top:6px}',
  '.bt .urow{display:flex;align-items:center;gap:8px;font-size:12px;padding:3px 0;border-bottom:1px solid #f1f5f9}',
  '.bt .urow i{width:16px;height:16px;border-radius:4px;border:1px solid rgba(0,0,0,.1);flex:0 0 auto}',
  '.bt .urow b{min-width:46px;font-weight:600}.bt .urow em{margin-left:auto;font-style:normal;color:var(--sub)}',
].join('');

var injected = false;
function ensureStyle() {
  if (injected || typeof document === 'undefined') return;
  var s = document.createElement('style');
  s.setAttribute('data-bt-style', '1');
  s.textContent = CSS;
  document.head.appendChild(s);
  injected = true;
}
function el(tag, attrs, kids) {
  var n = document.createElement(tag);
  if (attrs) for (var k in attrs) {
    var v = attrs[k];
    if (v == null) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
    else n.setAttribute(k, v);
  }
  (kids || []).forEach(function (c) {
    if (c == null) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}

function mount(root, options) {
  ensureStyle();
  if (typeof root === 'string') root = document.querySelector(root);
  if (!root) throw new Error('[BeadTextUI] 挂载节点不存在');
  var opts = Object.assign({
    palette: BeadText.MARD,
    widthBeads: 40,
    onConfirm: null,
    onChange: null,
  }, options || {});
  var palette = opts.palette && opts.palette.length ? opts.palette : BeadText.MARD;

  var state = { fg: { mode: 'solid', foreground: '#111827', stops: ['#F97316', '#EF4444'], direction: 'horizontal' }, result: null };

  /* ---------- 控件 ---------- */
  var ta = el('textarea', { placeholder: '输入文字，回车换行。中文请选「中文像素·黑体 / 宋体」' });
  ta.value = 'HELLO';

  var fontSel = el('select', {}, BeadText.TEXT_FONTS.map(function (f) {
    var g = document.createElement('optgroup');
    g.label = f.group;
    g.appendChild(el('option', { value: f.id, text: f.label }));
    return g;
  }));
  fontSel.value = 'pixel-5x7';

  var widthIn = el('input', { type: 'number', min: '4', max: '200', value: String(opts.widthBeads) });
  var lineIn = el('input', { type: 'number', min: '0.8', max: '2.4', step: '0.1', value: '1' });
  var thIn = el('input', { type: 'number', min: '0.05', max: '0.9', step: '0.05', value: '0.5' });
  var boldCk = el('input', { type: 'checkbox' });

  /* 配色：纯色 / 渐变 */
  var modeSel = el('select', {}, [
    el('option', { value: 'solid', text: '纯色' }),
    el('option', { value: 'gradient', text: '渐变（2-4 色）' }),
  ]);
  modeSel.addEventListener('change', function () {
    state.fg.mode = modeSel.value === 'gradient' ? 'gradient' : 'solid';
    refresh();
  });
  var solidBox = el('div', { class: 'sws' });
  var gradBox = el('div', { class: 'sws' });
  BeadText.SOLID_SWATCHES.forEach(function (hex) {
    solidBox.appendChild(el('span', {
      class: 'sw' + (hex === state.fg.foreground ? ' on' : ''),
      style: 'background:' + hex,
      title: hex,
      onclick: function () {
        state.fg.foreground = hex; state.fg.mode = 'solid'; modeSel.value = 'solid';
        Array.prototype.forEach.call(solidBox.children, function (s) { s.classList.toggle('on', s.title === hex); });
        refresh();
      },
    }));
  });
  BeadText.GRADIENT_PRESETS.forEach(function (p) {
    var bg = 'linear-gradient(135deg,' + p.stops.join(',') + ')';
    gradBox.appendChild(el('span', {
      class: 'sw', style: 'background:' + bg, title: p.stops.join(' '),
      onclick: function () {
        state.fg.mode = 'gradient'; state.fg.stops = p.stops.slice(); modeSel.value = 'gradient';
        Array.prototype.forEach.call(gradBox.children, function (s) { s.classList.toggle('on', s.title === p.stops.join(' ')); });
        refresh();
      },
    }));
  });
  var dirSel = el('select', {}, [
    el('option', { value: 'horizontal', text: '横向' }),
    el('option', { value: 'vertical', text: '纵向' }),
    el('option', { value: 'diagonal', text: '斜向' }),
  ]);
  dirSel.addEventListener('change', function () { state.fg.direction = dirSel.value; refresh(); });

  var btnGen = el('button', { class: 'pri', text: '生成图纸', onclick: refresh });
  var btnPng = el('button', { text: '导出 PNG', onclick: function () { if (state.result) BeadText.exportPng(state.result, 'bead-text-' + state.result.width + 'x' + state.result.height + '.png', 16, { palette: palette }); } });
  var btnOk = el('button', { class: 'pri', text: '填入画布', onclick: confirm_ });

  var canvas = el('canvas');
  var prevBox = el('div', { class: 'prev' }, [canvas]);
  var msg = el('div');
  var info = el('div');
  var usageBox = el('div');

  var left = el('div', { class: 'bt-left' }, [
    el('label', { text: '文字内容' }), ta,
    el('div', { class: 'row' }, [
      el('div', {}, [el('label', { text: '字体' }), fontSel]),
      el('div', {}, [el('label', { text: '画布宽度（颗豆）' }), widthIn]),
    ]),
    el('div', { class: 'row' }, [
      el('div', {}, [el('label', { text: '行距' }), lineIn]),
      el('div', {}, [el('label', { text: '阈值（越高字越细）' }), thIn]),
    ]),
    el('label', { class: 'chk' }, [boldCk, '加粗（仅系统字体有效）']),
    el('label', { text: '配色' }), modeSel,
    el('div', { style: 'margin-top:8px' }, [solidBox]),
    el('div', { style: 'margin-top:8px' }, [el('label', { text: '渐变预设（点击色块选取）' }), gradBox, el('div', { style: 'margin-top:8px' }, [el('label', { text: '渐变方向' }), dirSel])]),
    el('div', { class: 'bar' }, [btnGen, btnPng, btnOk]),
    msg,
  ]);
  var right = el('div', { class: 'bt-right' }, [
    el('label', { text: '预览' }), prevBox,
    el('label', { text: '图纸信息' }), info,
    el('label', { text: '用量统计' }), usageBox,
  ]);
  root.appendChild(el('div', { class: 'bt' }, [el('div', { class: 'bt-grid' }, [left, right])]));

  /* ---------- 生成 ---------- */
  function refresh() {
    var res = BeadText.buildText({
      text: ta.value,
      fontId: fontSel.value,
      bold: boldCk.checked,
      widthBeads: parseInt(widthIn.value, 10) || 40,
      lineHeight: parseFloat(lineIn.value) || 1,
      threshold: parseFloat(thIn.value) || 0.5,
      align: 'center',
      foreground: state.fg,
      background: '#FFFFFF',
      palette: palette,
      codeGrid: true,
    });
    msg.innerHTML = ''; info.innerHTML = ''; usageBox.innerHTML = '';
    if (!res.ok) {
      state.result = null;
      msg.appendChild(el('div', { class: 'err', text: res.error }));
      return;
    }
    state.result = res.value;
    BeadText.renderPreview(canvas, res.value, { boxSize: 250, palette: palette });

    var v = res.value;
    var kv = function (k, val) { info.appendChild(el('div', { class: 'kv' }, [el('span', { text: k }), el('span', { text: val })])); };
    kv('字体', v.fontLabel);
    kv('尺寸', v.width + ' × ' + v.height + ' 颗豆');
    kv('用色', v.usage.length + ' 色');
    kv('豆量', v.foregroundCount + ' 颗');
    if (v.note) msg.appendChild(el('div', { class: 'note', text: v.note }));

    v.usage.forEach(function (u) {
      usageBox.appendChild(el('div', { class: 'urow' }, [
        el('i', { style: 'background:' + (u.hex || '#fff') }),
        el('b', { text: u.code }),
        el('span', { text: u.name || '' }),
        el('em', { text: u.count + ' 颗' }),
      ]));
    });
    if (opts.onChange) opts.onChange(result());
  }

  function result() {
    var v = state.result;
    if (!v) return null;
    return {
      cols: v.width, rows: v.height,
      grid: v.grid.map(function (r) { return r.slice(); }),
      colors: v.colors.map(function (r) { return r.slice(); }),
      usage: v.usage,
      foregroundCount: v.foregroundCount,
      meta: { fontId: v.fontId, fontLabel: v.fontLabel, background: v.background, note: v.note },
    };
  }
  function confirm_() {
    var r = result();
    if (!r) { msg.appendChild(el('div', { class: 'err', text: '先生成图纸' })); return null; }
    if (opts.onConfirm) opts.onConfirm(r);
    return r;
  }

  refresh();

  return {
    refresh: refresh,
    getResult: result,
    confirm: confirm_,
    /** 外部设置文字 */
    setText: function (t) { ta.value = t; refresh(); },
    destroy: function () { root.innerHTML = ''; },
  };
}

return { mount: mount };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = BeadTextUI;

global.BeadText = BeadText;
global.BeadTextUI = BeadTextUI;
if (typeof module !== 'undefined' && module.exports) { module.exports = { BeadText: BeadText, BeadTextUI: BeadTextUI }; }
})(typeof window !== 'undefined' ? window : this);
