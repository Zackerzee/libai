/* ============================================================================
 * 拼豆图纸导入 —— 单文件版（core + UI + MARD 色卡）
 * 用法：
 *   <script src="bead-pattern-importer.js"></script>
 *   BeadPattern.mount('#box', { palette: BeadPattern.MARD, onConfirm(r){ ... } });
 * ==========================================================================*/
(function (global) {
'use strict';
var MARD_PALETTE = [{"code":"A10","hex":"#F77C31","brand":"mard"},{"code":"A11","hex":"#FFDD99","brand":"mard"},{"code":"A12","hex":"#FE9F72","brand":"mard"},{"code":"A13","hex":"#FFC365","brand":"mard"},{"code":"A14","hex":"#FD543D","brand":"mard"},{"code":"A15","hex":"#FFF365","brand":"mard"},{"code":"A16","hex":"#FFFF9F","brand":"mard"},{"code":"A17","hex":"#FFE36E","brand":"mard"},{"code":"A18","hex":"#FEBE7D","brand":"mard"},{"code":"A19","hex":"#FD7C72","brand":"mard"},{"code":"A20","hex":"#FFD568","brand":"mard"},{"code":"A21","hex":"#FFE395","brand":"mard"},{"code":"A22","hex":"#F4F57D","brand":"mard"},{"code":"A23","hex":"#E6C9B7","brand":"mard"},{"code":"A24","hex":"#F7F8A2","brand":"mard"},{"code":"A25","hex":"#FFD67D","brand":"mard"},{"code":"A26","hex":"#FFC830","brand":"mard"},{"code":"B10","hex":"#95D3C2","brand":"mard"},{"code":"B11","hex":"#5D722A","brand":"mard"},{"code":"B12","hex":"#166F41","brand":"mard"},{"code":"B13","hex":"#CAEB7B","brand":"mard"},{"code":"B14","hex":"#ADE946","brand":"mard"},{"code":"B15","hex":"#2E5132","brand":"mard"},{"code":"B16","hex":"#C5ED9C","brand":"mard"},{"code":"B17","hex":"#9BB13A","brand":"mard"},{"code":"B18","hex":"#E6EE49","brand":"mard"},{"code":"B19","hex":"#24B88C","brand":"mard"},{"code":"B20","hex":"#C2F0CC","brand":"mard"},{"code":"B21","hex":"#156A6B","brand":"mard"},{"code":"B22","hex":"#0B3C43","brand":"mard"},{"code":"B23","hex":"#303A21","brand":"mard"},{"code":"B24","hex":"#EEFCA5","brand":"mard"},{"code":"B25","hex":"#4E846D","brand":"mard"},{"code":"B26","hex":"#8D7A35","brand":"mard"},{"code":"B27","hex":"#CCE1AF","brand":"mard"},{"code":"B28","hex":"#9EE5B9","brand":"mard"},{"code":"B29","hex":"#C5E254","brand":"mard"},{"code":"B30","hex":"#E2FCB1","brand":"mard"},{"code":"B31","hex":"#B0E792","brand":"mard"},{"code":"C10","hex":"#3EBCE2","brand":"mard"},{"code":"C11","hex":"#28DDDE","brand":"mard"},{"code":"C12","hex":"#1C334D","brand":"mard"},{"code":"C13","hex":"#CDE8FF","brand":"mard"},{"code":"C14","hex":"#D5FDFF","brand":"mard"},{"code":"C15","hex":"#22C4C6","brand":"mard"},{"code":"C16","hex":"#1557A8","brand":"mard"},{"code":"C17","hex":"#04D1F6","brand":"mard"},{"code":"C18","hex":"#1D3344","brand":"mard"},{"code":"C19","hex":"#1887A2","brand":"mard"},{"code":"C20","hex":"#176DAF","brand":"mard"},{"code":"C21","hex":"#BEDDFF","brand":"mard"},{"code":"C22","hex":"#67B4BE","brand":"mard"},{"code":"C23","hex":"#C8E2FF","brand":"mard"},{"code":"C24","hex":"#7CC4FF","brand":"mard"},{"code":"C25","hex":"#A9E5E5","brand":"mard"},{"code":"C26","hex":"#3CAED8","brand":"mard"},{"code":"C27","hex":"#D3DFFA","brand":"mard"},{"code":"C28","hex":"#BBCFED","brand":"mard"},{"code":"C29","hex":"#34488E","brand":"mard"},{"code":"D10","hex":"#361851","brand":"mard"},{"code":"D11","hex":"#B9BAE1","brand":"mard"},{"code":"D12","hex":"#DE9AD4","brand":"mard"},{"code":"D13","hex":"#B90095","brand":"mard"},{"code":"D14","hex":"#8B279B","brand":"mard"},{"code":"D15","hex":"#2F1F90","brand":"mard"},{"code":"A02","hex":"#FFFFD5","brand":"mard"},{"code":"D16","hex":"#E3E1EE","brand":"mard"},{"code":"D17","hex":"#C4D4F6","brand":"mard"},{"code":"D18","hex":"#A45EC7","brand":"mard"},{"code":"D19","hex":"#D8C3D7","brand":"mard"},{"code":"D20","hex":"#9C32B2","brand":"mard"},{"code":"D21","hex":"#9A009B","brand":"mard"},{"code":"D22","hex":"#333A95","brand":"mard"},{"code":"D23","hex":"#EBDAFC","brand":"mard"},{"code":"D24","hex":"#7786E5","brand":"mard"},{"code":"D25","hex":"#494FC7","brand":"mard"},{"code":"D26","hex":"#DFC2F8","brand":"mard"},{"code":"E10","hex":"#D33793","brand":"mard"},{"code":"E11","hex":"#FCDDD2","brand":"mard"},{"code":"E12","hex":"#F78FC3","brand":"mard"},{"code":"E13","hex":"#B5006D","brand":"mard"},{"code":"E14","hex":"#FFD1BA","brand":"mard"},{"code":"E15","hex":"#F8C7C9","brand":"mard"},{"code":"E16","hex":"#FFF3EB","brand":"mard"},{"code":"E17","hex":"#FFE2EA","brand":"mard"},{"code":"E18","hex":"#FFC7DB","brand":"mard"},{"code":"E19","hex":"#FEBAD5","brand":"mard"},{"code":"E20","hex":"#D8C7D1","brand":"mard"},{"code":"E21","hex":"#BD9DA1","brand":"mard"},{"code":"E22","hex":"#B785A1","brand":"mard"},{"code":"E23","hex":"#937A8D","brand":"mard"},{"code":"E24","hex":"#E1BCE8","brand":"mard"},{"code":"F10","hex":"#8A4526","brand":"mard"},{"code":"F11","hex":"#5A2121","brand":"mard"},{"code":"F12","hex":"#FD4E6A","brand":"mard"},{"code":"F13","hex":"#F35744","brand":"mard"},{"code":"F14","hex":"#FFA9AD","brand":"mard"},{"code":"F15","hex":"#D30022","brand":"mard"},{"code":"F16","hex":"#FEC2A6","brand":"mard"},{"code":"F17","hex":"#E69C79","brand":"mard"},{"code":"F18","hex":"#D37C46","brand":"mard"},{"code":"F19","hex":"#C1444A","brand":"mard"},{"code":"F20","hex":"#CD9391","brand":"mard"},{"code":"F21","hex":"#F7B4C6","brand":"mard"},{"code":"F22","hex":"#FDC0D0","brand":"mard"},{"code":"F23","hex":"#F67E66","brand":"mard"},{"code":"F24","hex":"#E698AA","brand":"mard"},{"code":"F25","hex":"#E54B4F","brand":"mard"},{"code":"G10","hex":"#D98C39","brand":"mard"},{"code":"G11","hex":"#E0C593","brand":"mard"},{"code":"G12","hex":"#FFC890","brand":"mard"},{"code":"G13","hex":"#B7714A","brand":"mard"},{"code":"G14","hex":"#8D614C","brand":"mard"},{"code":"G15","hex":"#FCF9E0","brand":"mard"},{"code":"G16","hex":"#F2D9BA","brand":"mard"},{"code":"G17","hex":"#78524B","brand":"mard"},{"code":"G18","hex":"#FFE4CC","brand":"mard"},{"code":"G19","hex":"#E07935","brand":"mard"},{"code":"G20","hex":"#A94023","brand":"mard"},{"code":"G21","hex":"#B88558","brand":"mard"},{"code":"H10","hex":"#EEE9EA","brand":"mard"},{"code":"H11","hex":"#CECDD5","brand":"mard"},{"code":"H12","hex":"#FFF5ED","brand":"mard"},{"code":"H13","hex":"#F5ECD2","brand":"mard"},{"code":"H14","hex":"#CFD7D3","brand":"mard"},{"code":"H15","hex":"#98A6A8","brand":"mard"},{"code":"H16","hex":"#1D1414","brand":"mard"},{"code":"H17","hex":"#F1EDED","brand":"mard"},{"code":"H18","hex":"#FFFDF0","brand":"mard"},{"code":"H19","hex":"#F6EFE2","brand":"mard"},{"code":"H20","hex":"#949FA3","brand":"mard"},{"code":"H21","hex":"#FFFBE1","brand":"mard"},{"code":"H22","hex":"#CACAD4","brand":"mard"},{"code":"H23","hex":"#9A9D94","brand":"mard"},{"code":"M10","hex":"#C5B2BC","brand":"mard"},{"code":"M11","hex":"#9F7594","brand":"mard"},{"code":"M12","hex":"#644749","brand":"mard"},{"code":"M13","hex":"#D19066","brand":"mard"},{"code":"M14","hex":"#C77362","brand":"mard"},{"code":"M15","hex":"#757D78","brand":"mard"},{"code":"P10","hex":"#D9C7EA","brand":"mard"},{"code":"P11","hex":"#F3ECC9","brand":"mard"},{"code":"P12","hex":"#E6EEF2","brand":"mard"},{"code":"P13","hex":"#AACBEF","brand":"mard"},{"code":"P14","hex":"#337680","brand":"mard"},{"code":"P15","hex":"#668575","brand":"mard"},{"code":"P16","hex":"#FEBF45","brand":"mard"},{"code":"P17","hex":"#FEA324","brand":"mard"},{"code":"E01","hex":"#FDD3CC","brand":"mard"},{"code":"M08","hex":"#B38281","brand":"mard"},{"code":"P18","hex":"#FEB89F","brand":"mard"},{"code":"P19","hex":"#FFFEEC","brand":"mard"},{"code":"P20","hex":"#FEBECF","brand":"mard"},{"code":"P21","hex":"#ECBEBF","brand":"mard"},{"code":"P22","hex":"#E4A89F","brand":"mard"},{"code":"P23","hex":"#A56268","brand":"mard"},{"code":"ZG1","hex":"#DAABB3","brand":"mard"},{"code":"ZG2","hex":"#D6AA87","brand":"mard"},{"code":"ZG3","hex":"#C1BD8D","brand":"mard"},{"code":"ZG4","hex":"#96869F","brand":"mard"},{"code":"ZG5","hex":"#8490A6","brand":"mard"},{"code":"ZG6","hex":"#94BFE2","brand":"mard"},{"code":"R10","hex":"#FFDB4C","brand":"mard"},{"code":"R11","hex":"#FFEBFB","brand":"mard"},{"code":"R12","hex":"#D8D5CE","brand":"mard"},{"code":"R13","hex":"#55514C","brand":"mard"},{"code":"R14","hex":"#9FE4DF","brand":"mard"},{"code":"R15","hex":"#77CEE9","brand":"mard"},{"code":"R16","hex":"#3ECFCA","brand":"mard"},{"code":"R17","hex":"#4A867A","brand":"mard"},{"code":"R18","hex":"#7FCD9D","brand":"mard"},{"code":"R19","hex":"#CDE85D","brand":"mard"},{"code":"R20","hex":"#E8C7B4","brand":"mard"},{"code":"R21","hex":"#AD6F3C","brand":"mard"},{"code":"R22","hex":"#6C372F","brand":"mard"},{"code":"R23","hex":"#FEB872","brand":"mard"},{"code":"R24","hex":"#F3C1C0","brand":"mard"},{"code":"R25","hex":"#C9675E","brand":"mard"},{"code":"R26","hex":"#D293BE","brand":"mard"},{"code":"R27","hex":"#EA8CB1","brand":"mard"},{"code":"R28","hex":"#9C87D6","brand":"mard"},{"code":"ZG7","hex":"#E2A9D2","brand":"mard"},{"code":"ZG8","hex":"#AB91C0","brand":"mard"},{"code":"A01","hex":"#FAF4C8","brand":"mard"},{"code":"A03","hex":"#FEFF8B","brand":"mard"},{"code":"A04","hex":"#FBED56","brand":"mard"},{"code":"A05","hex":"#F4D738","brand":"mard"},{"code":"A06","hex":"#FEAC4C","brand":"mard"},{"code":"A07","hex":"#FE8B4C","brand":"mard"},{"code":"A08","hex":"#FFDA45","brand":"mard"},{"code":"A09","hex":"#FF995B","brand":"mard"},{"code":"B01","hex":"#E6EE31","brand":"mard"},{"code":"B02","hex":"#63F347","brand":"mard"},{"code":"B03","hex":"#9EF780","brand":"mard"},{"code":"B04","hex":"#5DE035","brand":"mard"},{"code":"B05","hex":"#35E352","brand":"mard"},{"code":"B06","hex":"#65E2A6","brand":"mard"},{"code":"B07","hex":"#3DAF80","brand":"mard"},{"code":"B08","hex":"#1C9C4F","brand":"mard"},{"code":"B09","hex":"#27523A","brand":"mard"},{"code":"C01","hex":"#E8FFE7","brand":"mard"},{"code":"C02","hex":"#A9F9FC","brand":"mard"},{"code":"C03","hex":"#A0E2FB","brand":"mard"},{"code":"C04","hex":"#41CCFF","brand":"mard"},{"code":"C05","hex":"#01ACEB","brand":"mard"},{"code":"C06","hex":"#50AAF0","brand":"mard"},{"code":"C07","hex":"#3677D2","brand":"mard"},{"code":"C08","hex":"#0F54C0","brand":"mard"},{"code":"C09","hex":"#324BCA","brand":"mard"},{"code":"D01","hex":"#AEB4F2","brand":"mard"},{"code":"D02","hex":"#858EDD","brand":"mard"},{"code":"D03","hex":"#2F54AF","brand":"mard"},{"code":"D04","hex":"#182A84","brand":"mard"},{"code":"D05","hex":"#B843C5","brand":"mard"},{"code":"D06","hex":"#AC7BDE","brand":"mard"},{"code":"D07","hex":"#8854B3","brand":"mard"},{"code":"D08","hex":"#E2D3FF","brand":"mard"},{"code":"D09","hex":"#D5B9F8","brand":"mard"},{"code":"E02","hex":"#FEC0DF","brand":"mard"},{"code":"E03","hex":"#FFB7E7","brand":"mard"},{"code":"E04","hex":"#E8649E","brand":"mard"},{"code":"E05","hex":"#F551A2","brand":"mard"},{"code":"E06","hex":"#F13D74","brand":"mard"},{"code":"E07","hex":"#C63478","brand":"mard"},{"code":"E08","hex":"#FFDBE9","brand":"mard"},{"code":"E09","hex":"#E970CC","brand":"mard"},{"code":"F01","hex":"#FD957B","brand":"mard"},{"code":"F02","hex":"#FC3D46","brand":"mard"},{"code":"F03","hex":"#F74941","brand":"mard"},{"code":"F04","hex":"#FC283C","brand":"mard"},{"code":"F05","hex":"#E7002F","brand":"mard"},{"code":"F06","hex":"#943630","brand":"mard"},{"code":"F07","hex":"#971937","brand":"mard"},{"code":"F08","hex":"#BC0028","brand":"mard"},{"code":"F09","hex":"#E2677A","brand":"mard"},{"code":"G01","hex":"#FFE2CE","brand":"mard"},{"code":"G02","hex":"#FFC4AA","brand":"mard"},{"code":"G03","hex":"#F4C3A5","brand":"mard"},{"code":"G04","hex":"#E1B383","brand":"mard"},{"code":"G05","hex":"#EDB045","brand":"mard"},{"code":"G06","hex":"#E99C17","brand":"mard"},{"code":"G07","hex":"#9D5B3E","brand":"mard"},{"code":"G08","hex":"#753832","brand":"mard"},{"code":"G09","hex":"#E6B483","brand":"mard"},{"code":"H01","hex":"#FDFBFF","brand":"mard"},{"code":"H02","hex":"#FEFFFF","brand":"mard"},{"code":"H03","hex":"#B6B1BA","brand":"mard"},{"code":"H04","hex":"#89858C","brand":"mard"},{"code":"H05","hex":"#48464E","brand":"mard"},{"code":"H06","hex":"#2F2B2F","brand":"mard"},{"code":"H07","hex":"#000000","brand":"mard"},{"code":"H08","hex":"#E7D6DB","brand":"mard"},{"code":"H09","hex":"#EDEDED","brand":"mard"},{"code":"M01","hex":"#BCC6B8","brand":"mard"},{"code":"M02","hex":"#8AA386","brand":"mard"},{"code":"M03","hex":"#697D80","brand":"mard"},{"code":"M04","hex":"#E3D2BC","brand":"mard"},{"code":"M05","hex":"#D0CCAA","brand":"mard"},{"code":"M06","hex":"#B0A782","brand":"mard"},{"code":"M07","hex":"#B4A497","brand":"mard"},{"code":"M09","hex":"#A58767","brand":"mard"},{"code":"P01","hex":"#FCF7F8","brand":"mard"},{"code":"P02","hex":"#B0A9AC","brand":"mard"},{"code":"P03","hex":"#AFDCAB","brand":"mard"},{"code":"P04","hex":"#FEA49F","brand":"mard"},{"code":"P05","hex":"#EE8C3E","brand":"mard"},{"code":"P06","hex":"#5FD0A7","brand":"mard"},{"code":"P07","hex":"#EB9270","brand":"mard"},{"code":"P08","hex":"#F0D958","brand":"mard"},{"code":"P09","hex":"#D9D9D9","brand":"mard"},{"code":"Q01","hex":"#F2A5E8","brand":"mard"},{"code":"Q02","hex":"#E9EC91","brand":"mard"},{"code":"Q03","hex":"#FFFF00","brand":"mard"},{"code":"Q04","hex":"#FFEBFA","brand":"mard"},{"code":"Q05","hex":"#76CEDE","brand":"mard"},{"code":"R01","hex":"#D50D21","brand":"mard"},{"code":"R02","hex":"#F92F83","brand":"mard"},{"code":"R03","hex":"#FD8324","brand":"mard"},{"code":"R04","hex":"#F8EC31","brand":"mard"},{"code":"R05","hex":"#35C75B","brand":"mard"},{"code":"R06","hex":"#238891","brand":"mard"},{"code":"R07","hex":"#19779D","brand":"mard"},{"code":"R08","hex":"#1A60C3","brand":"mard"},{"code":"R09","hex":"#9A56B4","brand":"mard"},{"code":"T01","hex":"#FFFFFF","brand":"mard"},{"code":"Y01","hex":"#FD6FB4","brand":"mard"},{"code":"Y02","hex":"#FEB481","brand":"mard"},{"code":"Y03","hex":"#D7FAA0","brand":"mard"},{"code":"Y04","hex":"#8BDBFA","brand":"mard"},{"code":"Y05","hex":"#E987EA","brand":"mard"}];
/**
 * bead-pattern-core.js
 * 拼豆图纸核心算法库 —— 图片转图纸 / 图纸识别
 *
 * 设计目标：
 *   1. 零依赖、零 DOM 访问。输入只接受 Uint8ClampedArray / Uint8Array，
 *      因此微信小程序（Canvas 2D 的 getImageData）和网站 Canvas 可共用同一份代码。
 *   2. 所有函数纯函数，方便丢进 Web Worker / 小程序 Worker 避免卡顿。
 *
 * 算法流程（图片转图纸）：
 *   采样(sampleGrid) -> 背景剔除 -> 色卡匹配(assignPalette) -> 库存约束调剂(全局遗憾值最小)
 *
 * @author 独立实现，算法思路参考拼豆类 App 通用做法
 */

/* ============================================================
 * 一、颜色空间与色差
 * ============================================================ */

/** sRGB -> CIE Lab。用于计算人眼感知一致的色差。 */
function rgbToLab(r, g, b) {
  // sRGB -> 线性
  let R = r / 255, G = g / 255, B = b / 255;
  R = R > 0.04045 ? Math.pow((R + 0.055) / 1.055, 2.4) : R / 12.92;
  G = G > 0.04045 ? Math.pow((G + 0.055) / 1.055, 2.4) : G / 12.92;
  B = B > 0.04045 ? Math.pow((B + 0.055) / 1.055, 2.4) : B / 12.92;

  // 线性 RGB -> XYZ (D65)
  const X = (R * 0.4124564 + G * 0.3575761 + B * 0.1804375) / 0.95047;
  const Y = (R * 0.2126729 + G * 0.7151522 + B * 0.0721750) / 1.00000;
  const Z = (R * 0.0193339 + G * 0.1191920 + B * 0.9503041) / 1.08883;

  const f = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(X), fy = f(Y), fz = f(Z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** 十六进制色值 -> Lab */
function hexToLab(hex) {
  const h = String(hex).replace('#', '').trim();
  const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
  return rgbToLab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

/** CIE76 色差（Delta E）。数值越小越接近。 */
function deltaE(labA, labB) {
  const dl = labA[0] - labB[0], da = labA[1] - labB[1], db = labA[2] - labB[2];
  return Math.sqrt(dl * dl + da * da + db * db);
}

/** 加权欧氏 RGB 距离（人眼对绿更敏感）。作为轻量替代方案。 */
function rgbDistance(r1, g1, b1, r2, g2, b2) {
  const dr = r1 - r2, dg = g1 - g2, db = b1 - b2;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/**
 * 构造色差函数
 * @param {'lab'|'rgb'} mode
 */
function makeDistFn(mode) {
  if (mode === 'rgb') {
    return (r1, g1, b1, c) => rgbDistance(r1, g1, b1, c.r, c.g, c.b);
  }
  return (r1, g1, b1, c) => deltaE(rgbToLab(r1, g1, b1), c.lab);
}

/* ============================================================
 * 二、色卡预处理
 * ============================================================ */

/**
 * 把色卡数组预处理成可快速匹配的结构（预先算 Lab，避免逐像素重复计算）
 * @param {Array<{code:string, hex:string, name?:string}>} palette
 * @returns {Array<{code, hex, name, r, g, b, lab}>}
 */
function preparePalette(palette) {
  return palette.map((p) => {
    const h = String(p.hex).replace('#', '').trim();
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return { code: p.code, hex: p.hex, name: p.name, r, g, b, lab: rgbToLab(r, g, b) };
  });
}

/* ============================================================
 * 三、采样：把原图降采样成 cols × rows 的格子颜色
 * ============================================================ */

/**
 * 单格采样：取该格对应矩形区域的颜色
 * @param {'majority'|'average'|'center'} algo
 *   majority - 区域内出现最多的颜色（量化后投票）→ 保留清晰边缘、抗噪，适合线稿/卡通
 *   average  - 区域算术平均 → 过渡自然，适合照片
 *   center   - 只取中心像素 → 最快，但易产生噪点
 */
function sampleCell(data, srcW, srcH, x0, y0, x1, y1, algo) {
  if (x1 <= x0 || y1 <= y0) return null;

  if (algo === 'center') {
    const cx = Math.floor((x0 + x1) / 2), cy = Math.floor((y0 + y1) / 2);
    const i = (cy * srcW + cx) * 4;
    return [data[i], data[i + 1], data[i + 2], data[i + 3]];
  }

  // ring —— 只取「环带」：跳过中心（色号文字通常印在这里），也裁掉最外圈（网格线/豆子边缘）
  let ringInner = 0, ringOuter = 1, cx0 = 0, cy0 = 0, rx = 1, ry = 1;
  const isRing = algo === 'ring';
  if (isRing) {
    cx0 = (x0 + x1) / 2; cy0 = (y0 + y1) / 2;
    rx = Math.max(1, (x1 - x0) / 2); ry = Math.max(1, (y1 - y0) / 2);
    ringInner = 0.55; ringOuter = 0.95;   // 归一化半径区间（配合 sampleRatio 0.46 使用）
  }

  let sr = 0, sg = 0, sb = 0, sa = 0, n = 0;
  // majority / ring 用投票桶：把 RGB 各压到 5 bit（32 级）后统计
  const buckets = (algo === 'majority' || isRing) ? new Map() : null;

  for (let y = y0; y < y1; y++) {
    const rowOff = y * srcW * 4;
    for (let x = x0; x < x1; x++) {
      if (isRing) {
        const dx = (x + 0.5 - cx0) / rx, dy = (y + 0.5 - cy0) / ry;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < ringInner || d > ringOuter) continue;   // 中心文字 / 外圈网格线，都跳过
      }
      const i = rowOff + x * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2], a = data[i + 3];
      sr += r; sg += g; sb += b; sa += a; n++;
      if (buckets) {
        const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        const e = buckets.get(key);
        if (e) { e.r += r; e.g += g; e.b += b; e.a += a; e.n++; }
        else buckets.set(key, { r, g, b, a, n: 1 });
      }
    }
  }
  if (n === 0) {
    if (!isRing) return null;
    // 格子太小导致环带没有像素：退化成整块平均，避免整格丢失
    for (let y = y0; y < y1; y++) {
      const rowOff = y * srcW * 4;
      for (let x = x0; x < x1; x++) {
        const i = rowOff + x * 4;
        sr += data[i]; sg += data[i + 1]; sb += data[i + 2]; sa += data[i + 3]; n++;
      }
    }
    if (n === 0) return null;
    return [sr / n, sg / n, sb / n, sa / n];
  }

  if (buckets && buckets.size > 0) {
    let best = null;
    for (const e of buckets.values()) if (!best || e.n > best.n) best = e;
    return [best.r / best.n, best.g / best.n, best.b / best.n, best.a / best.n];
  }
  return [sr / n, sg / n, sb / n, sa / n];
}

/**
 * 降采样成网格
 * @param {Uint8ClampedArray|Uint8Array} data RGBA 像素
 * @param {number} srcW, srcH
 * @param {number} cols, rows
 * @param {object} opts
 *   algo        - 'majority' | 'average' | 'center'
 *   startX/startY/cellSize - 指定裁剪区域（局部采样），缺省为整图
 * @returns {Array<Array<[r,g,b,a]>>} rows × cols，元素为 null 表示空
 */
function sampleGrid(data, srcW, srcH, cols, rows, opts = {}) {
  const { algo = 'majority', startX = 0, startY = 0, cellSize = null } = opts;
  const grid = new Array(rows);

  if (cellSize != null && cellSize > 0) {
    // 局部采样：按 cellSize 步长取格（对应原 App 的 sampleGrid 分支）
    for (let r = 0; r < rows; r++) {
      grid[r] = new Array(cols);
      for (let c = 0; c < cols; c++) {
        const x0 = Math.round(startX + c * cellSize), y0 = Math.round(startY + r * cellSize);
        grid[r][c] = sampleCell(data, srcW, srcH, x0, y0, x0 + cellSize, y0 + cellSize, algo);
      }
    }
    return grid;
  }

  // 整图缩放
  const sx = srcW / cols, sy = srcH / rows;
  for (let r = 0; r < rows; r++) {
    grid[r] = new Array(cols);
    const y0 = Math.floor(r * sy), y1 = Math.max(y0 + 1, Math.floor((r + 1) * sy));
    for (let c = 0; c < cols; c++) {
      const x0 = Math.floor(c * sx), x1 = Math.max(x0 + 1, Math.floor((c + 1) * sx));
      grid[r][c] = sampleCell(data, srcW, srcH, x0, Math.min(y0, srcH - 1), x0 === x1 ? x1 + 1 : x1, Math.min(y1, srcH), algo);
    }
  }
  return grid;
}

/* ============================================================
 * 四、背景剔除
 * ============================================================ */

/**
 * 判断一个像素是否应留空（不填豆）
 * @param {object} opts
 *   transparentAsEmpty - alpha 低于阈值视为空（默认 true）
 *   alphaThreshold     - 默认 32
 *   backgroundHex      - 指定背景色（如 '#ffffff'），接近该色则留空
 *   bgTolerance        - 背景色容差（Lab ΔE），默认 12
 */
function isEmptyPixel(rgb, opts = {}) {
  if (!rgb) return true;
  const {
    transparentAsEmpty = true, alphaThreshold = 32,
    backgroundHex = null, bgTolerance = 12,
  } = opts;
  const [r, g, b, a] = rgb;

  if (transparentAsEmpty && (a === undefined || a < alphaThreshold)) return true;
  if (backgroundHex) {
    const bg = hexToLab(backgroundHex);
    if (deltaE(rgbToLab(r, g, b), bg) <= bgTolerance) return true;
  }
  return false;
}

/* ============================================================
 * 五、色卡匹配 + 库存约束调剂
 * ============================================================ */

/**
 * 为一个颜色找色卡中的候选（按色差升序）
 * @returns {Array<{index:number, code:string, dist:number}>}
 */
function rankCandidates(r, g, b, palette, distFn, topN) {
  const out = [];
  for (let i = 0; i < palette.length; i++) {
    out.push({ index: i, code: palette[i].code, dist: distFn(r, g, b, palette[i]) });
  }
  out.sort((p, q) => p.dist - q.dist);
  return topN ? out.slice(0, topN) : out;
}

/**
 * 核心：把采样网格分配成色号网格
 *
 * @param {Array<Array>} grid   sampleGrid 的输出
 * @param {Array} palette       preparePalette 的输出
 * @param {object} opts
 *   distanceMode  - 'lab' | 'rgb'
 *   matchMode     - 'nearest'  直接取最近色
 *                   'distinct' 对已大量使用的色号加惩罚，让配色更分散（避免糊成一片）
 *   excludedCodes - 排除的色号数组
 *   inventory     - { 色号: 库存数量 }；启用后超出库存的格子会被调剂到备选色
 *   ignoreCapacity- true 则忽略库存
 *   emptyOpts     - 传给 isEmptyPixel 的背景剔除参数
 *   distinctWeight- distinct 模式惩罚强度，默认 0.35
 *
 * @returns {{grid, colorCount, beadCount, usage, totalError, assignments}}
 *   grid     - rows × cols，元素为色号字符串或 null（空）
 *   usage    - { 色号: 用量 }
 *   assignments - 每格的详细依据（用于 UI 展示「为什么选这个色」）
 */
/**
 * 单格置信度间隔：top2 距离 - top1 距离。
 * 越大表示「这个格子明显更像某个色号」；越小表示与次优色难以区分
 * （拼豆色卡里存在大量视觉极相近的色号，例如 A01 #FAF4C8 与 A02 #FFFFD5）。
 * 只有一个候选时返回 Infinity。
 */
function cellMargin(cell) {
  if (!cell.cand || cell.cand.length === 0) return 0;
  if (cell.cand.length === 1) return Infinity;
  return cell.cand[1].dist - cell.cand[0].dist;
}

function assignPalette(grid, palette, opts = {}) {
  const {
    distanceMode = 'lab',
    matchMode = 'nearest',
    excludedCodes = [],
    inventory = null,
    ignoreCapacity = false,
    emptyOpts = {},
    distinctWeight = 0.35,
  } = opts;

  const distFn = makeDistFn(distanceMode);
  const excluded = new Set(excludedCodes);
  const rows = grid.length, cols = rows ? grid[0].length : 0;
  const total = rows * cols;

  const active = palette.filter((p) => !excluded.has(p.code));
  if (active.length === 0) throw new Error('色卡为空或全部被排除');

  // ---- 第一遍：为每格计算候选排序 + 判定是否留空 ----
  const cells = [];
  let emptyCount = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const px = grid[r][c];
      if (isEmptyPixel(px, emptyOpts)) { emptyCount++; continue; }
      const [rr, gg, bb] = px;
      cells.push({ r, c, rgb: [rr, gg, bb], cand: rankCandidates(rr, gg, bb, active, distFn, 0) });
    }
  }

  // ---- distinct 模式：统计倾向，对高频色号加惩罚 ----
  if (matchMode === 'distinct') {
    const tally = new Map();
    for (const cell of cells) {
      const code = cell.cand[0].code;
      tally.set(code, (tally.get(code) || 0) + 1);
    }
    for (const cell of cells) {
      for (const cd of cell.cand) {
        const share = (tally.get(cd.code) || 0) / Math.max(1, cells.length);
        // 用量占比越高，惩罚越大 —— 促使相近色分散到不同色号
        cd.dist *= 1 + distinctWeight * share;
      }
      cell.cand.sort((a, b) => a.dist - b.dist);
    }
  }

  // ---- 第二遍：按候选分配，同时受库存约束 ----
  const useCount = new Map();               // 色号 -> 已用量
  const result = Array.from({ length: rows }, () => new Array(cols).fill(null));
  const assignments = [];
  let totalError = 0;

  const hasCapacity = inventory && !ignoreCapacity;

  // 先按「最优色」统计需求
  for (const cell of cells) {
    const want = cell.cand[0].code;
    cell.want = want;
    cell.rank = 0;
  }

  // 贪心分配：优先满足所有格子的最优选择；超出的进调剂队列
  const deferred = [];
  for (const cell of cells) {
    const want = cell.want;
    if (!hasCapacity) {
      useCount.set(want, (useCount.get(want) || 0) + 1);
      result[cell.r][cell.c] = want;
      totalError += cell.cand[0].dist;
      assignments.push({ r: cell.r, c: cell.c, code: want, rank: 0, dist: cell.cand[0].dist, margin: cellMargin(cell), alt: cell.cand[1] ? cell.cand[1].code : null, reason: 'optimal' });
      continue;
    }
    const cap = inventory[want];
    const used = useCount.get(want) || 0;
    if (cap === undefined || cap === null || used < cap) {
      useCount.set(want, (useCount.get(want) || 0) + 1);
      result[cell.r][cell.c] = want;
      totalError += cell.cand[0].dist;
      assignments.push({ r: cell.r, c: cell.c, code: want, rank: 0, dist: cell.cand[0].dist, margin: cellMargin(cell), alt: cell.cand[1] ? cell.cand[1].code : null, reason: 'optimal' });
    } else {
      deferred.push(cell);   // 最优色库存已满，稍后调剂
    }
  }

  // ---- 库存调剂：全局遗憾值最小 ----
  // 遗憾值(regret) = 备选色色差 - 最优色色差，即「被迫退让所增加的误差」。
  // 每次从所有待调剂格子中挑 regret 最小的执行，直到全部落位。
  if (deferred.length > 0) {
    let guard = deferred.length * Math.max(2, active.length) + 1024;
    while (deferred.length > 0 && guard-- > 0) {
      let bestPick = null;
      for (let i = 0; i < deferred.length; i++) {
        const cell = deferred[i];
        const base = cell.cand[0].dist;
        // 找第一个还有库存的备选
        for (let k = 1; k < cell.cand.length; k++) {
          const alt = cell.cand[k];
          const cap = inventory[alt.code];
          const used = useCount.get(alt.code) || 0;
          const unlimited = cap === undefined || cap === null;
          if (!unlimited && used >= cap) continue;
          const regret = alt.dist - base;
          if (!bestPick || regret < bestPick.regret) {
            bestPick = { idx: i, cell, alt, rank: k, regret, dist: alt.dist };
          }
          break; // 只考虑最近的可用备选，保持贪心
        }
      }
      if (!bestPick) {
        // 所有备选都满了：强制使用最近色（并把超用记入 usage 供上层告警）
        const cell = deferred.shift();
        const alt = cell.cand[0];
        useCount.set(alt.code, (useCount.get(alt.code) || 0) + 1);
        result[cell.r][cell.c] = alt.code;
        totalError += alt.dist;
        // 库存溢出被迫取色 / 遗憾值调剂，均非视觉最优 —— margin 记 0，应纳入复核
        assignments.push({ r: cell.r, c: cell.c, code: alt.code, rank: 0, dist: alt.dist, margin: 0, alt: null, reason: 'forced-overflow' });
        continue;
      }
      const { idx, cell, alt, rank, dist } = bestPick;
      deferred.splice(idx, 1);
      useCount.set(alt.code, (useCount.get(alt.code) || 0) + 1);
      result[cell.r][cell.c] = alt.code;
      totalError += dist;
      assignments.push({ r: cell.r, c: cell.c, code: alt.code, rank, dist, margin: 0, alt: null, reason: 'alternative-regret-min' });
    }
  }

  const usage = {};
  for (const [code, n] of useCount) usage[code] = n;

  return {
    grid: result,
    colorCount: useCount.size,
    beadCount: cells.length,
    emptyCount,
    total,
    usage,
    totalError,
    assignments,   // 每格分配依据，可用于「为什么是这个色」的 UI 解释
  };
}

/* ============================================================
 * 六、一站式：图片数据 -> 图纸
 * ============================================================ */

/**
 * 图片转拼豆图纸
 * @param {Uint8ClampedArray|Uint8Array} data RGBA
 * @param {number} srcW, srcH
 * @param {number} cols, rows
 * @param {Array<{code,hex}>} palette 色卡（未预处理也可以，内部会转）
 * @param {object} opts 同 sampleGrid + assignPalette 的选项
 */
function imageToPattern(data, srcW, srcH, cols, rows, palette, opts = {}) {
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);
  const grid = sampleGrid(data, srcW, srcH, cols, rows, {
    algo: opts.algo || 'majority',
    startX: opts.startX, startY: opts.startY, cellSize: opts.cellSize,
  });
  return assignPalette(grid, prepared, opts);
}

/* ============================================================
 * 七、智能尺寸推荐
 * ============================================================ */

/**
 * 遍历候选尺寸，输出各尺寸的质量指标，供 UI 推荐最佳网格大小。
 * 指标含义：
 *   colorCount      - 用到的色号数（越少越省事）
 *   beadCount       - 总豆数（越多越精细、也越费时）
 *   density         - 豆数 / 面积
 *   totalDifference - 总色差 × 密度因子（越低越还原）
 */
function recommendSize(data, srcW, srcH, palette, opts = {}) {
  const { minWidth = 10, maxWidth = 100, step = 1, ...rest } = opts;
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);
  const ratio = srcH / srcW;
  const srcPixels = srcW * srcH;
  const out = [];

  for (let w = minWidth; w <= maxWidth; w += step) {
    const h = Math.max(1, Math.round(w * ratio));
    const grid = sampleGrid(data, srcW, srcH, w, h, { algo: rest.algo || 'majority' });
    const res = assignPalette(grid, prepared, { ...rest, ignoreCapacity: true });
    const densityFactor = srcPixels / (w * h);
    out.push({
      width: w, height: h,
      colorCount: res.colorCount,
      beadCount: res.beadCount,
      density: w > 0 ? res.beadCount / (w * w) : 0,
      totalDifference: res.totalError * densityFactor,
    });
  }
  return out;
}

/* ============================================================
 * 八、图纸识别（规则版）：从已有图纸图片反推色号网格
 * ============================================================ */

/**
 * 检测网格步长（格子像素大小）。
 *
 * 方法：列方向亮度投影 -> 自相关。
 * 把整幅图沿 y 方向投影成一维亮度信号，网格线会形成周期性尖峰；
 * 把信号平移 s 后与自身做相关，当 s 恰好等于格子大小时相关性最高。
 * 相比单点采样，投影能抗噪、对网格线对比度要求更低。
 *
 * @returns {number|null} 最可能的 cellSize；检测失败返回 null（此时应让用户输入）
 */
function detectGridStep(data, w, h, opts = {}) {
  const { minStep = 4, maxStep = 64 } = opts;

  // 1. 列方向亮度投影
  const col = new Float64Array(w);
  for (let x = 0; x < w; x++) {
    let s = 0;
    for (let y = 0; y < h; y++) {
      const i = (y * w + x) * 4;
      s += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    }
    col[x] = s / h;
  }

  // 2. 取梯度而非亮度本身：网格线本质是「边缘」，
  //    梯度信号在网格线处形成尖锐脉冲，比亮度信号周期性更强、更抗色块干扰。
  const sig = new Float64Array(w);
  for (let x = 1; x < w; x++) sig[x] = Math.abs(col[x] - col[x - 1]);

  // 3. 去均值（自相关前必须，否则直流分量会淹没周期）
  let mean = 0;
  for (let x = 0; x < w; x++) mean += sig[x];
  mean /= w;
  for (let x = 0; x < w; x++) sig[x] -= mean;

  // 4. 能量
  let energy = 0;
  for (let x = 0; x < w; x++) energy += sig[x] * sig[x];
  if (energy <= 0) return null;

  // 5. 自相关：s 等于真实周期时相关值最大
  const maxS = Math.min(maxStep, Math.floor(w / 3));
  let best = null;
  const scores = [];
  for (let s = minStep; s <= maxS; s++) {
    let num = 0;
    for (let x = 0; x + s < w; x++) num += sig[x] * sig[x + s];
    const corr = num / energy;
    scores.push({ s, corr });
    if (!best || corr > best.corr) best = { s, corr };
  }
  if (!best) return null;

  // 6. 倍周期回退：周期信号在 2T、3T 处同样高相关。
  //    若最优值的整数因子相关性也够高，说明真实周期是更小的那个。
  let result = best.s;
  for (let k = 2; k <= 5; k++) {
    if (best.s % k !== 0) continue;
    const sub = best.s / k;
    if (sub < minStep) continue;
    const sc = scores.find((o) => o.s === sub);
    if (sc && sc.corr > best.corr * 0.55) { result = sub; break; }
  }

  // 7. 相关性过低说明没有可辨识的网格（例如无网格线的纯色块图）
  return best.corr > 0.25 ? result : null;
}

/* ============================================================
 * 八之二、拍照退化修复：白平衡校正 + 质量告警
 *
 * 实测背景（MARD 290 色，16x16 网格）：
 *   干净图纸        -> 规则版识别 100%
 *   高斯噪声 σ=10   -> 93~98%   （规则版天然鲁棒）
 *   模糊 rad=2      -> 88~100%  （规则版天然鲁棒）
 *   白平衡偏色      -> 崩溃至 14~16%  ←★ 唯一真正的短板
 *
 * 为什么偏色致命：颜色整体乘性偏移后，每个格子都会系统性找错近邻色号。
 *
 * 为什么不能用「灰度世界」：该算法假设画面平均色为中性灰，
 * 但拼豆图纸大面积是单一彩色（例如整张浅黄），会把本色当成偏色"校正"掉。
 * 实测：相近色场景从 100% 直接掉到 0%。严禁使用。
 *
 * 正确解法：网格线是中性灰，是天然的灰卡锚点。
 * 实测解出的增益精确命中理论值（偏暖 R×1.15/B×0.85 -> 解出 0.87/1.18，
 * 理论 1/1.15=0.87、1/0.85=1.18）。
 * ============================================================ */

/**
 * 用网格线作为中性灰锚点，反解白平衡增益。
 * 网格线像素原本 R=G=B，退化后三通道比例即色偏量。
 * @returns {{kr:number, kb:number, samples:number}|null} 采样不足返回 null
 */
/**
 * 网格线相位检测
 * detectGridStep 只给出周期，不给相位；如果直接按 x % cell === 0 取样，
 * 一旦相位错开一两个像素就会采到色块或白底（实测把白底当灰卡，R 通道完全没校正）。
 * 这里用「投影亮度偏离全局中位数最大」的相位作为网格线所在位置 —— 深线浅线都适用。
 */
/** 列/行方向的亮度投影（axis 'x' 取列投影，'y' 取行投影） */
function gridProjection(data, w, h, axis) {
  const n = axis === 'x' ? w : h;
  const outer = axis === 'x' ? h : w;
  const proj = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = 0; j < outer; j++) {
      const idx = axis === 'x' ? (j * w + i) * 4 : (i * w + j) * 4;
      s += 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
    }
    proj[i] = s / outer;
  }
  return proj;
}

/**
 * 网格线相位候选
 * detectGridStep 只给周期不给相位，直接按 x % cell === 0 取样会整体错位。
 * 这里给两个候选：
 *   dark  —— 投影最暗的相位（绝大多数图纸是深色网格线）
 *   contrast —— 偏离全局中位数最大的相位（兼容浅色/白色网格线，或格子留白间隙）
 * 至于哪个才是真网格线，交给后面的色度一致性检验裁定。
 */
function estimateGridPhase(data, w, h, cell, axis) {
  const proj = gridProjection(data, w, h, axis);
  const n = proj.length;
  if (n < cell) return { dark: 0, contrast: 0 };
  const sorted = Array.prototype.slice.call(proj).sort((a, b) => a - b);
  const M = sorted[n >> 1];
  let darkP = 0, minL = Infinity, devP = 0, maxDev = -1;
  for (let p = 0; p < cell; p++) {
    let s = 0, dev = 0, c = 0;
    for (let i = p; i < n; i += cell) { s += proj[i]; dev += Math.abs(proj[i] - M); c++; }
    if (!c) continue;
    const L = s / c, D = dev / c;
    if (L < minL) { minL = L; darkP = p; }
    if (D > maxDev) { maxDev = D; devP = p; }
  }
  return { dark: darkP, contrast: devP };
}

function medianOf(arr) {
  const a = arr.slice().sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function estimateWhiteBalance(data, w, h, cell, opts = {}) {
  const { maxChromaSpread = 0.035, maxSamples = 20000, saturationGuard = 246 } = opts;
  if (!cell || cell < 2) return null;

  const phX = estimateGridPhase(data, w, h, cell, 'x');
  const phY = estimateGridPhase(data, w, h, cell, 'y');

  // 组合候选：dark / contrast 交叉，去重
  const seen = new Set(); const combos = [];
  const push = (px, py) => {
    const k = px + ':' + py;
    if (seen.has(k)) return; seen.add(k); combos.push([px, py]);
  };
  push(phX.dark, phY.dark);
  push(phX.dark, phY.contrast);
  push(phX.contrast, phY.dark);
  push(phX.contrast, phY.contrast);

  let best = null;
  for (const [px, py] of combos) {
    const est = estimateAtPhase(data, w, h, cell, px, py, { maxSamples, saturationGuard, maxChromaSpread });
    if (!est) continue;
    if (est.rejected) { if (!best || (best.rejected && est.chromaSpread < best.chromaSpread)) best = est; continue; }
    if (!best || best.rejected || est.chromaSpread < best.chromaSpread) best = est;
  }
  return best;
}

/** 按给定相位采网格线像素并估计通道增益 */
function estimateAtPhase(data, w, h, cell, phaseX, phaseY, opts) {
  const { maxChromaSpread = 0.035, maxSamples = 20000, saturationGuard = 246 } = opts;
  const onLine = (x, y) =>
    ((x % cell) + cell) % cell === phaseX || ((y % cell) + cell) % cell === phaseY;

  let total = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (onLine(x, y)) total++;
  if (total < 8) return null;
  const stride = Math.max(1, Math.ceil(total / maxSamples));

  const rs = [], gs = [], bs = [], px = [];
  let k = 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (!onLine(x, y)) continue;
      if (k++ % stride !== 0) continue;
      const i = (y * w + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      // ★ 饱和像素不能当灰卡：通道被截断后比例失真（白底在暖光下 R 先爆掉，
      //   结果 R 增益估成 1，实测整体校正失效）。
      if (r >= saturationGuard || g >= saturationGuard || b >= saturationGuard) continue;
      rs.push(r); gs.push(g); bs.push(b); px.push([r, g, b]);
    }
  }
  const n = px.length;
  if (n < 8) return null;

  const mr = medianOf(rs), mg = medianOf(gs), mb = medianOf(bs);
  if (mr < 1 || mg < 1 || mb < 1) return null; // 近黑网格线，比例不可靠

  // ★ 关键判据：真网格线是「单一灰阶 × 通道增益」，所有像素色度高度一致。
  //    若无网格线，这些位置落在不同颜色的色块上，色度会明显分散。
  //    色度离散度用中位数绝对偏差（MAD），抗模糊污染。
  const crs = [], cbs = [];
  for (const [r, g, b] of px) {
    const s = r + g + b;
    if (s < 1) continue;
    crs.push((r - g) / s); cbs.push((b - g) / s);
  }
  const mcr = medianOf(crs), mcb = medianOf(cbs);
  const mad = (arr, m) => medianOf(arr.map((v) => Math.abs(v - m)));
  const spread = (mad(crs, mcr) + mad(cbs, mcb)) / 2;
  if (spread > maxChromaSpread) {
    return { kr: 1, kb: 1, samples: n, rejected: 'not-neutral-gridline', chromaSpread: spread };
  }
  return { kr: mg / mr, kb: mg / mb, samples: n, chromaSpread: spread, phase: { x: phaseX, y: phaseY } };
}

/**
 * 兜底方案：残差最小化搜索。
 * 当没有可用网格线（无网格线图纸 / 模糊导致网格线被污染）时使用。
 * 原理：偏色是整体乘性偏移，遍历候选增益，取「所有格子到最近色号的色差之和」最小者。
 *
 * @param {Array} cells 采样好的格子颜色 [[r,g,b,a], ...]
 * @param {Array} prepared 已 preparePalette 的色卡
 * @param {object} opts maxCells 参与搜索的格子数（越大越准越慢）
 * @returns {{kr,kb,residual,base}|null}
 */
function estimateWhiteBalanceSearch(cells, prepared, opts = {}) {
  const { maxCells = 300, lo = 0.75, hi = 1.32 } = opts;
  const pool = cells.filter((c) => c && c[3] !== 0);
  if (pool.length < 8) return null;

  // 均匀抽样控制开销（150x150 图纸有 2 万+ 格子，全部参与会非常慢）
  const stride = Math.max(1, Math.ceil(pool.length / maxCells));
  const sample = pool.filter((_, i) => i % stride === 0);

  const residual = (kr, kb) => {
    let sum = 0;
    for (const c of sample) {
      const lab = rgbToLab(
        Math.max(0, Math.min(255, c[0] * kr)),
        Math.max(0, Math.min(255, c[1])),
        Math.max(0, Math.min(255, c[2] * kb))
      );
      let best = Infinity;
      for (let i = 0; i < prepared.length; i++) {
        const d = deltaE(lab, prepared[i].lab);
        if (d < best) best = d;
      }
      sum += best;
    }
    return sum;
  };

  const grid = (a, b, step) => {
    let best = null;
    for (let kr = a; kr <= b + 1e-9; kr += step) {
      for (let kb = a; kb <= b + 1e-9; kb += step) {
        const v = residual(kr, kb);
        if (!best || v < best.v) best = { kr, kb, v };
      }
    }
    return best;
  };

  const base = residual(1, 1);
  const c1 = grid(lo, hi, 0.08);                                    // 粗搜
  const c2 = grid(Math.max(lo, c1.kr - 0.08), Math.min(hi, c1.kr + 0.08), 0.02); // 细搜
  const best = c2.v < c1.v ? c2 : c1;
  if (Math.abs(best.kr - 1) < 0.03 && Math.abs(best.kb - 1) < 0.03) return null; // 本就中性
  return { kr: best.kr, kb: best.kb, residual: best.v, base, method: 'search' };
}

/** 应用白平衡增益，返回新的 RGBA 数组（不修改入参） */
function applyWhiteBalance(data, kr, kb) {
  const out = new Uint8ClampedArray(data);
  if (kr === 1 && kb === 1) return out;
  for (let i = 0; i < data.length; i += 4) {
    out[i] = data[i] * kr;
    out[i + 2] = data[i + 2] * kb;
  }
  return out;
}

/**
 * 检测通道饱和比例 —— 饱和意味着信息永久丢失，不可恢复。
 * 实测：浅黄 #FFFFD5 在 R×1.15 下 R 通道溢出到 255，
 * 反向还原后误差仍达 33，任何算法（含 ML）都无法恢复。
 * @returns {{ratio:number, clipped:number, total:number}}
 */
function detectSaturation(data, threshold = 252) {
  let clipped = 0, total = 0;
  for (let i = 0; i < data.length; i += 4) {
    total++;
    if (data[i] >= threshold || data[i + 1] >= threshold || data[i + 2] >= threshold) clipped++;
  }
  return { ratio: total ? clipped / total : 0, clipped, total };
}

/**
 * 从图纸图片识别色号网格（规则版，无 ML 依赖）
 * @param {Uint8ClampedArray} data RGBA
 * @param {number} w, h
 * @param {Array<{code,hex}>} palette
 * @param {object} opts
 *   cellSize - 已知格子像素大小则直接传入（跳过自动检测）
 *   autoTrim - 自动裁掉四周空白（默认 true）
 *   whiteBalance - 'auto' 用网格线锚点校正（默认）| 'off' 关闭
 *   distanceMode, emptyOpts
 * @returns 额外含 whiteBalance（增益与告警）、quality（饱和检测）
 */
function recognizePattern(data, w, h, palette, opts = {}) {
  const {
    cellSize: forcedSize = null, autoTrim = true,
    distanceMode = 'lab', emptyOpts = {}, whiteBalance = 'auto',
    // 采样策略：average 纯色块 / ring 带色号文字（避开中心）/ majority 实拍抗噪
    sampleAlgo = 'average',
    sampleRatio = sampleAlgo === 'ring' ? 0.46 : 0.3,
  } = opts;
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);

  let step = forcedSize || detectGridStep(data, w, h, opts);
  if (!step) throw new Error('未能自动检测网格步长，请手动传入 cellSize');

  // —— 白平衡增益估计（网格线锚点法）——
  // 注意：这里只估计增益，不直接改图。是否采用由后面的「自适应择优」决定。
  let est = null;
  let wbInfo = { applied: false };
  if (whiteBalance === 'auto') {
    est = estimateWhiteBalance(data, w, h, step, opts.whiteBalanceOpts);
    if (est) {
      const kr = Math.max(0.6, Math.min(1.7, est.kr));
      const kb = Math.max(0.6, Math.min(1.7, est.kb));
      const plausible = kr > 0.7 && kr < 1.45 && kb > 0.7 && kb < 1.45;
      if (est.rejected || !plausible || (Math.abs(kr - 1) <= 0.02 && Math.abs(kb - 1) <= 0.02)) {
        wbInfo = {
          applied: false, kr: est.rejected ? 1 : kr, kb: est.rejected ? 1 : kb,
          samples: est.samples,
          skipped: est.rejected || (!plausible ? 'out-of-range' : 'already-neutral'),
        };
        est = null; // 不可用
      } else {
        est = { kr, kb, samples: est.samples, chromaSpread: est.chromaSpread };
      }
    }
  }
  const quality = detectSaturation(data);

  // 自动裁剪：统计非背景像素的包围盒（用原图，白底判定最稳定）
  let x0 = 0, y0 = 0, x1 = w, y1 = h;
  if (autoTrim) {
    const colHas = new Array(w).fill(false), rowHas = new Array(h).fill(false);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (!isEmptyPixel([data[i], data[i + 1], data[i + 2], data[i + 3]], emptyOpts)) {
          colHas[x] = true; rowHas[y] = true;
        }
      }
    }
    while (x0 < w && !colHas[x0]) x0++;
    while (x1 > x0 && !colHas[x1 - 1]) x1--;
    while (y0 < h && !rowHas[y0]) y0++;
    while (y1 > y0 && !rowHas[y1 - 1]) y1--;
  }

  const cols = Math.max(1, Math.round((x1 - x0) / step));
  const rows = Math.max(1, Math.round((y1 - y0) / step));

  // 逐格取中心区域平均色（避开网格线）—— 只采样一次
  const gridRaw = [];
  for (let r = 0; r < rows; r++) {
    const row = [];
    for (let c = 0; c < cols; c++) {
      const cx = x0 + Math.round((c + 0.5) * step);
      const cy = y0 + Math.round((r + 0.5) * step);
      const half = Math.max(1, Math.floor(step * sampleRatio));
      row.push(sampleCell(data, w, h, cx - half, cy - half, cx + half, cy + half, sampleAlgo));
    }
    gridRaw.push(row);
  }

  // 网格线法不可用（无网格线 / 模糊污染）时，回退到残差搜索法
  let wbMethod = est ? 'gridline' : null;
  if (!est && whiteBalance === 'auto') {
    const s = estimateWhiteBalanceSearch(gridRaw.flat(), prepared, opts.whiteBalanceOpts);
    if (s) {
      est = { kr: s.kr, kb: s.kb, samples: 0 };
      wbMethod = 'search';
      wbInfo = { applied: false, samples: 0 };
    }
  }

  // —— 自适应择优 ——
  // ★ 关键：校正并不总是有益。实测浅黄系在偏暖下，通道饱和已造成不可逆损失，
  //   强行校正反而把颜色推到更错的位置（35.5% -> 4.3%）。
  //   因此两个版本都算一遍，取总色差（totalError）更小的那个。
  const assignOpts = { distanceMode, ignoreCapacity: true, emptyOpts };
  const resRaw = assignPalette(gridRaw, prepared, assignOpts);

  let res = resRaw;
  let gridUsed = gridRaw;          // 最终参与匹配的采样色（供 UI 展示「原色 vs 匹配色」）
  if (est) {
    const { kr, kb } = est;
    const gridWB = gridRaw.map((row) =>
      row.map((c) => (c ? [c[0] * kr, c[1], c[2] * kb, c[3]] : c))
    );
    const resWB = assignPalette(gridWB, prepared, assignOpts);
    if (resWB.totalError < resRaw.totalError) {
      res = resWB;
      gridUsed = gridWB;
      wbInfo = {
        applied: true, kr, kb, samples: est.samples, method: wbMethod,
        chromaSpread: est.chromaSpread,
        errorGain: resRaw.totalError - resWB.totalError,
      };
      // 仅在确实校正且饱和严重时提示：这类损失不可恢复，建议重拍
      if (quality.ratio > 0.3) quality.warning = 'saturation_loss';
    } else {
      wbInfo = {
        applied: false, kr, kb, samples: est.samples, method: wbMethod,
        skipped: 'no-improvement',
        errorDelta: resWB.totalError - resRaw.totalError,
      };
    }
  } else {
    quality.warning = undefined;
  }

  // —— 不确定格子清单：交给模型复核 / 或让用户在 UI 上确认 ——
  // 判据：top1 与 top2 的色差间隔过小（色卡内存在大量视觉极相近色号），
  // 或因库存约束被调剂（margin=0）。
  const { marginThreshold = 3 } = opts;
  const uncertain = [];
  for (const a of res.assignments || []) {
    if (a.margin === 0 || a.margin < marginThreshold) {
      uncertain.push({
        r: a.r, c: a.c, code: a.code, alt: a.alt,
        margin: a.margin === Infinity ? null : a.margin,
        dist: a.dist, reason: a.reason,
      });
    }
  }

  return {
    ...res,
    colors: gridToHexGrid(gridUsed),   // rows×cols，每格实际参与匹配的采样色 '#rrggbb'（留空为 null）
    detectedCellSize: step,
    sampleAlgo,
    offset: { x: x0, y: y0 },
    whiteBalance: wbInfo,
    quality,
    uncertain,
    uncertainRatio: res.assignments && res.assignments.length
      ? uncertain.length / res.assignments.length : 0,
  };
}

/* ============================================================
 * 九、导出工具
 * ============================================================ */

/** [r,g,b] -> '#rrggbb' */
function rgbToHex(r, g, b) {
  const h = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/** 采样网格 -> HEX 二维（留空为 null） */
function gridToHexGrid(grid) {
  return grid.map((row) => row.map((px) => {
    if (!px) return null;
    const a = px[3];
    if (a !== undefined && a < 8) return null;
    return rgbToHex(px[0], px[1], px[2]);
  }));
}

/**
 * 列出某一格的候选色号（UI 里点格子改色用）
 * @param {[number,number,number]|string} color RGB 数组或 '#rrggbb'
 * @param {Array} palette 原始色卡或 preparePalette 结果
 * @param {number} k 取前 k 个
 * @param {'lab'|'rgb'} distanceMode
 * @returns {Array<{code, hex, name, dist}>}
 */
function topCandidates(color, palette, k = 5, distanceMode = 'lab') {
  const prepared = palette.length && palette[0].lab ? palette : preparePalette(palette);
  let r, g, b;
  if (typeof color === 'string') {
    const h = String(color).replace('#', '').trim();
    const n = parseInt(h.length === 3 ? h.split('').map((c) => c + c).join('') : h, 16);
    r = (n >> 16) & 255; g = (n >> 8) & 255; b = n & 255;
  } else {
    [r, g, b] = color;
  }
  const distFn = makeDistFn(distanceMode);
  return rankCandidates(r, g, b, prepared, distFn, k)
    .map((it) => ({ code: it.code, hex: prepared[it.index].hex, name: prepared[it.index].name, dist: it.dist }));
}

/** 统计用量并排序（色号升序 / 用量降序） */
function summarize(usage, palette, sortBy = 'count') {
  const meta = new Map(palette.map((p) => [p.code, p]));
  const list = Object.entries(usage).map(([code, count]) => ({
    code, count, hex: meta.get(code)?.hex || null, name: meta.get(code)?.name || null,
  }));
  if (sortBy === 'count') list.sort((a, b) => b.count - a.count);
  else list.sort((a, b) => String(a.code).localeCompare(String(b.code)));
  return list;
}

/** 网格 -> 纯二维色号数组（便于 JSON 存储/传输） */
function gridToCodes(grid) { return grid.map((row) => row.map((v) => v)); }

const __CORE__ = {
  rgbToLab, hexToLab, deltaE, rgbDistance,
  preparePalette, sampleGrid, isEmptyPixel, assignPalette,
  imageToPattern, recommendSize, detectGridStep, recognizePattern,
  summarize, gridToCodes, rgbToHex, gridToHexGrid, topCandidates,
};

/* ============================================================================
 * 拼豆图纸导入 UI 组件 —— 原生 JS + Canvas，零第三方依赖
 *
 * 依赖同作用域内的 core 函数（bead-pattern-core.js）：
 *   recognizePattern / preparePalette / topCandidates / summarize / detectGridStep
 *
 * 用法（打好的 bundle 里已包含 core）：
 *   const api = BeadPattern.mount(document.querySelector('#import-box'), {
 *     palette: [{ code:'A10', hex:'#F77C31', name:'橙' }, ...],
 *     onConfirm(result) { ... }
 *   });
 *
 * result 结构：
 *   {
 *     brand, cols, rows,
 *     grid:   [[ 'A10' | null, ... ]],   // 最终色号网格，null = 留空
 *     colors: [['#f77c31' | null, ...]], // 每格采样到的原色（用于溯源/复核）
 *     usage:  [{ code, hex, name, count }],
 *     meta:   { cellSize, offset, sampleAlgo, whiteBalance, quality, uncertainRatio }
 *   }
 * ==========================================================================*/

/* ---------------------------------------------------------------- 样式注入 */
const BP_CSS = [
  '.bp-wrap{--bp-line:#e5e7eb;--bp-text:#1f2937;--bp-sub:#6b7280;--bp-accent:#f97316;--bp-ok:#16a34a;',
  'display:flex;gap:16px;align-items:flex-start;font:14px/1.5 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif;color:var(--bp-text)}',
  '.bp-main{flex:1 1 auto;min-width:0}',
  '.bp-side{flex:0 0 300px;width:300px;display:flex;flex-direction:column;gap:12px}',
  '@media(max-width:900px){.bp-wrap{flex-direction:column}.bp-side{flex:1 1 auto;width:100%}}',
  '.bp-card{border:1px solid var(--bp-line);border-radius:10px;background:#fff;padding:12px}',
  '.bp-card h4{margin:0 0 8px;font-size:13px;font-weight:600;color:var(--bp-sub);letter-spacing:.3px}',
  '.bp-drop{border:2px dashed #cbd5e1;border-radius:12px;background:#f8fafc;padding:36px 16px;text-align:center;color:var(--bp-sub);cursor:pointer;transition:.15s}',
  '.bp-drop:hover,.bp-drop.over{border-color:var(--bp-accent);background:#fff7ed;color:#9a3412}',
  '.bp-drop b{display:block;font-size:15px;color:var(--bp-text);margin-bottom:4px}',
  '.bp-canvas-box{position:relative;border:1px solid var(--bp-line);border-radius:10px;background:#fff;overflow:auto;max-height:600px}',
  '.bp-canvas-box canvas{display:block;margin:0 auto}',
  '.bp-bar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin:10px 0}',
  '.bp-bar label{display:inline-flex;align-items:center;gap:5px;font-size:13px;color:var(--bp-sub)}',
  '.bp-bar input[type=number]{width:64px;padding:4px 6px;border:1px solid var(--bp-line);border-radius:6px;font-size:13px}',
  '.bp-bar select{padding:4px 6px;border:1px solid var(--bp-line);border-radius:6px;font-size:13px;background:#fff}',
  '.bp-btn{padding:6px 12px;border:1px solid var(--bp-line);border-radius:7px;background:#fff;cursor:pointer;font-size:13px;color:var(--bp-text)}',
  '.bp-btn:hover{background:#f3f4f6}',
  '.bp-btn.primary{background:var(--bp-accent);border-color:var(--bp-accent);color:#fff}',
  '.bp-btn.primary:hover{filter:brightness(.95)}',
  '.bp-btn:disabled{opacity:.45;cursor:not-allowed}',
  '.bp-kv{display:flex;justify-content:space-between;font-size:13px;padding:3px 0}',
  '.bp-kv span:first-child{color:var(--bp-sub)}',
  '.bp-usage{max-height:320px;overflow:auto}',
  '.bp-usage-row{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:13px;border-bottom:1px solid #f1f5f9}',
  '.bp-sw{width:18px;height:18px;border-radius:4px;border:1px solid rgba(0,0,0,.12);flex:0 0 auto}',
  '.bp-code{font-weight:600;min-width:52px}',
  '.bp-cnt{margin-left:auto;color:var(--bp-sub);font-variant-numeric:tabular-nums}',
  '.bp-edit{position:sticky;top:0;background:#fff;border:1px solid var(--bp-accent);border-radius:10px;padding:10px}',
  '.bp-cands{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:8px}',
  '.bp-cand{border:1px solid var(--bp-line);border-radius:7px;padding:5px 4px;text-align:center;cursor:pointer;font-size:11px;background:#fff}',
  '.bp-cand:hover{border-color:var(--bp-accent)}',
  '.bp-cand.on{border-color:var(--bp-accent);box-shadow:0 0 0 2px rgba(249,115,22,.22)}',
  '.bp-cand i{display:block;height:22px;border-radius:4px;margin-bottom:3px;border:1px solid rgba(0,0,0,.1)}',
  '.bp-tip{position:absolute;pointer-events:none;background:rgba(17,24,39,.92);color:#fff;font-size:12px;padding:5px 8px;border-radius:6px;white-space:nowrap;z-index:9;opacity:0;transition:opacity .1s}',
  '.bp-warn{background:#fef3c7;border:1px solid #fcd34d;color:#92400e;border-radius:8px;padding:8px 10px;font-size:12px}',
  '.bp-steps{display:flex;gap:6px;list-style:none;margin:0 0 12px;padding:0;font-size:12px;color:var(--bp-sub)}',
  '.bp-steps li{padding:3px 10px;border-radius:20px;background:#f1f5f9}',
  '.bp-steps li.on{background:var(--bp-accent);color:#fff}',
  '.bp-mask{position:absolute;inset:0;background:rgba(255,255,255,.78);display:flex;align-items:center;justify-content:center;font-size:13px;color:var(--bp-sub);z-index:8}',
].join('');

let bpStyleInjected = false;
function bpEnsureStyle() {
  if (bpStyleInjected || typeof document === 'undefined') return;
  const s = document.createElement('style');
  s.setAttribute('data-bp-style', '1');
  s.textContent = BP_CSS;
  document.head.appendChild(s);
  bpStyleInjected = true;
}

/* ---------------------------------------------------------------- DOM 工具 */
function bpEl(tag, attrs, children) {
  const n = document.createElement(tag);
  if (attrs) {
    for (const k in attrs) {
      const v = attrs[k];
      if (v === null || v === undefined) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.slice(0, 2) === 'on') n.addEventListener(k.slice(2).toLowerCase(), v);
      else n.setAttribute(k, v);
    }
  }
  (children || []).forEach((c) => {
    if (c === null || c === undefined) return;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  });
  return n;
}

function bpDownload(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

/** #rrggbb -> 感知亮度，决定叠加文字用黑还是白 */
function bpLuminance(hex) {
  const h = String(hex || '').replace('#', '');
  if (h.length !== 6) return 255;
  const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/* ================================================================= 主入口 */
function mountPatternImporter(root, options) {
  bpEnsureStyle();
  if (typeof root === 'string') root = document.querySelector(root);
  if (!root) throw new Error('[PatternImport] 挂载节点不存在');

  const opts = Object.assign({
    palette: [],
    brand: 'mard',
    maxSide: 1600,
    // ring = 避开格子中心采样。实测：带色号文字的图纸用 average 会直接归零（0% → 100%），
    // 而在纯色块 / 实拍场景上 ring 与 average 持平，所以默认就用它。
    sampleAlgo: 'ring',
    marginThreshold: 3,
    hideDrop: false,           // true = 不显示内置上传区，由你自己的入口调 api.loadFile(file)
    refine: null,          // 可选：async (cells) => [{r,c,code,prob}]
    onChange: null,
    onConfirm: null,
    onError: null,
  }, options || {});

  if (!opts.palette || !opts.palette.length) throw new Error('[PatternImport] 缺少色卡 palette');
  const prepared = opts.palette[0] && opts.palette[0].lab ? opts.palette : preparePalette(opts.palette);
  const hexOf = new Map(prepared.map((p) => [p.code, p.hex]));
  const nameOf = new Map(prepared.map((p) => [p.code, p.name || '']));
  // LIBMS adapter: dispose global listeners and ignore late decode/recognition.
  let destroyed = false;

  const state = {
    stage: 'upload',
    img: null, work: null, data: null, w: 0, h: 0, scale: 1,
    cellSize: null, autoTrim: true, cropX: 0, cropY: 0,
    wb: true, bgWhite: true, sampleAlgo: opts.sampleAlgo,
    rec: null, grid: null, colors: null,
    edits: new Map(),                 // 'r,c' -> code | null
    showLines: true, showCode: true, showUncertain: true,
    sel: null, cellPx: 14, hover: null,
  };

  /* ------------------------------------------------------------ 骨架 DOM */
  const steps = bpEl('ul', { class: 'bp-steps' }, [
    bpEl('li', { text: '1 上传图纸', class: 'on' }),
    bpEl('li', { text: '2 校准网格' }),
    bpEl('li', { text: '3 复核 / 导出' }),
  ]);

  const canvasBox = bpEl('div', { class: 'bp-canvas-box' });
  const canvas = bpEl('canvas');
  const tip = bpEl('div', { class: 'bp-tip' });
  const mask = bpEl('div', { class: 'bp-mask', text: '识别中…' });
  mask.style.display = 'none';
  canvasBox.appendChild(canvas); canvasBox.appendChild(tip); canvasBox.appendChild(mask);
  const ctx = canvas.getContext('2d');

  const drop = bpEl('div', {
    class: 'bp-drop',
    html: '<b>点击或拖拽上传图纸</b>支持 JPG / PNG / WebP，也可直接 Ctrl+V 粘贴',
    onclick: () => fileInput.click(),
  });
  const fileInput = bpEl('input', { type: 'file', accept: 'image/*' });
  fileInput.style.display = 'none';
  fileInput.addEventListener('change', () => { if (fileInput.files[0]) loadFile(fileInput.files[0]); });

  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.add('over');
  }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => {
    e.preventDefault(); drop.classList.remove('over');
  }));
  drop.addEventListener('drop', (e) => {
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f && /^image\//.test(f.type)) loadFile(f);
  });
  const handlePaste = (e) => {
    const items = (e.clipboardData && e.clipboardData.items) || [];
    for (let i = 0; i < items.length; i++) {
      if (items[i].type && items[i].type.indexOf('image') === 0) {
        const f = items[i].getAsFile();
        if (f) { loadFile(f); e.preventDefault(); }
      }
    }
  };
  root.addEventListener('paste', handlePaste);

  /* 工具栏 */
  const inpCell = bpEl('input', { type: 'number', min: '3', max: '200', value: '' });
  const selType = bpEl('select', {}, [
    bpEl('option', { value: 'average', text: '色块图纸（无文字）' }),
    bpEl('option', { value: 'ring', text: '带色号文字' }),
    bpEl('option', { value: 'majority', text: '实拍 / 有噪点' }),
  ]);
  selType.value = state.sampleAlgo;
  selType.addEventListener('change', () => { state.sampleAlgo = selType.value; if (state.stage !== 'upload') detect(true); });

  const ckTrim = bpEl('input', { type: 'checkbox' }); ckTrim.checked = true;
  const ckWB = bpEl('input', { type: 'checkbox' }); ckWB.checked = true;
  const ckBg = bpEl('input', { type: 'checkbox' }); ckBg.checked = true;

  const btnDetect = bpEl('button', { class: 'bp-btn', text: '重新检测格子', onclick: () => detect(true) });
  const btnRun = bpEl('button', { class: 'bp-btn primary', text: '开始识别', onclick: () => run() });
  const btnBack = bpEl('button', { class: 'bp-btn', text: '重新上传', onclick: () => reset() });

  const barCal = bpEl('div', { class: 'bp-bar' }, [
    bpEl('label', {}, ['格子像素', inpCell]),
    bpEl('label', {}, ['类型', selType]),
    bpEl('label', {}, [ckTrim, '自动裁边']),
    bpEl('label', {}, [ckWB, '白平衡']),
    bpEl('label', {}, [ckBg, '白底留空']),
    btnDetect, btnRun, btnBack,
  ]);
  inpCell.addEventListener('change', () => {
    state.cellSize = Math.max(3, parseInt(inpCell.value, 10) || 0) || null;
    if (state.stage === 'calibrate') drawCalibrate();
  });

  const ckLines = bpEl('input', { type: 'checkbox' }); ckLines.checked = true;
  const ckCode = bpEl('input', { type: 'checkbox' }); ckCode.checked = true;
  const ckUnc = bpEl('input', { type: 'checkbox' }); ckUnc.checked = true;
  [ckLines, ckCode, ckUnc].forEach((ck) => ck.addEventListener('change', () => {
    state.showLines = ckLines.checked; state.showCode = ckCode.checked; state.showUncertain = ckUnc.checked;
    if (state.stage === 'review') drawReview();
  }));

  const btnApplyAlt = bpEl('button', { class: 'bp-btn', text: '待确认 → 全部用次优色', onclick: () => applyAllAlt() });
  const btnRefine = bpEl('button', { class: 'bp-btn', text: '云端复核', onclick: () => refineUncertain() });
  if (!opts.refine) btnRefine.style.display = 'none';
  const btnJson = bpEl('button', { class: 'bp-btn', text: '导出 JSON', onclick: () => exportJson() });
  const btnCsv = bpEl('button', { class: 'bp-btn', text: '用量 CSV', onclick: () => exportCsv() });
  const btnPng = bpEl('button', { class: 'bp-btn', text: '导出图纸 PNG', onclick: () => exportPng() });
  const btnOk = bpEl('button', { class: 'bp-btn primary', text: '确认导入', onclick: () => confirm_() });

  const barRev = bpEl('div', { class: 'bp-bar' }, [
    bpEl('label', {}, [ckLines, '网格线']),
    bpEl('label', {}, [ckCode, '色号']),
    bpEl('label', {}, [ckUnc, '高亮待确认']),
    btnApplyAlt, btnRefine, btnJson, btnCsv, btnPng, btnOk,
  ]);
  barRev.style.display = 'none'; barCal.style.display = 'none';

  /* 右侧 */
  const infoBox = bpEl('div', { class: 'bp-card' });
  const editBox = bpEl('div', { class: 'bp-card' });
  editBox.style.display = 'none';
  const usageBox = bpEl('div', { class: 'bp-card' }, [bpEl('h4', { text: '用量统计' })]);
  const usageList = bpEl('div', { class: 'bp-usage' });
  usageBox.appendChild(usageList);
  usageBox.style.display = 'none';

  const main = bpEl('div', { class: 'bp-main' }, [drop, canvasBox, barCal, barRev]);
  const side = bpEl('div', { class: 'bp-side' }, [editBox, infoBox, usageBox]);
  const wrap = bpEl('div', { class: 'bp-wrap' }, [main, side]);
  root.appendChild(bpEl('div', {}, [steps, wrap]));
  canvasBox.style.display = 'none';
  if (opts.hideDrop) drop.style.display = 'none';

  /* ------------------------------------------------------------ 图片加载 */
  function loadFile(file) {
    if (destroyed) return;
    const fr = new FileReader();
    fr.onload = () => {
      if (destroyed) return;
      const img = new Image();
      img.onload = () => { if (!destroyed) { state.img = img; prepare(img); } };
      img.onerror = () => fail('图片解码失败');
      img.src = fr.result;
    };
    fr.onerror = () => fail('文件读取失败');
    fr.readAsDataURL(file);
  }

  function prepare(img) {
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.min(1, opts.maxSide / Math.max(iw, ih));
    const w = Math.max(1, Math.round(iw * s)), h = Math.max(1, Math.round(ih * s));
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const c2 = cv.getContext('2d');
    c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high';
    c2.drawImage(img, 0, 0, w, h);
    state.work = cv; state.w = w; state.h = h; state.scale = s;
    state.data = c2.getImageData(0, 0, w, h).data;
    state.rec = null; state.grid = null; state.colors = null; state.edits.clear();
    state.stage = 'calibrate';
    drop.style.display = 'none';
    canvasBox.style.display = '';
    barCal.style.display = ''; barRev.style.display = 'none';
    usageBox.style.display = 'none'; editBox.style.display = 'none';
    setStep(1);
    detect(true);
  }

  function reset() {
    state.stage = 'upload'; state.img = null; state.rec = null; state.grid = null;
    state.edits.clear(); state.sel = null;
    drop.style.display = opts.hideDrop ? 'none' : '';
    canvasBox.style.display = 'none';
    barCal.style.display = 'none'; barRev.style.display = 'none';
    usageBox.style.display = 'none'; editBox.style.display = 'none';
    setStep(0);
  }

  function setStep(i) {
    Array.prototype.forEach.call(steps.children, (li, k) => li.classList.toggle('on', k === i));
  }

  function fail(msg) { if (opts.onError) opts.onError(new Error(msg)); else console.error('[PatternImport]', msg); }

  /* ------------------------------------------------------------ 网格校准 */
  function detect(silent) {
    if (!state.data) return;
    const st = detectGridStep(state.data, state.w, state.h, {});
    state.cellSize = st || null;
    inpCell.value = st || '';
    if (!st && !silent) fail('没检测到网格，请手动填格子像素');
    drawCalibrate();
  }

  function fitCanvas(cw, ch) {
    const availW = Math.max(240, (canvasBox.clientWidth || 600) - 2);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = Math.min(availW, cw);
    const scale = cw > availW ? availW / cw : 1;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(ch * scale * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = Math.round(ch * scale) + 'px';
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    return { cssW, scale };
  }

  function drawCalibrate() {
    const { w, h } = state;
    fitCanvas(w, h);
    ctx.clearRect(0, 0, w, h);
    ctx.drawImage(state.work, 0, 0, w, h);
    const step = state.cellSize;
    if (step) {
      ctx.save();
      ctx.strokeStyle = 'rgba(249,115,22,.55)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let x = 0; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
      for (let y = 0; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
      ctx.stroke();
      ctx.restore();
    }
    renderInfo();
  }

  /* ------------------------------------------------------------ 识别 */
  function run() {
    if (destroyed || !state.data) return;
    mask.style.display = 'flex';
    setTimeout(() => {
      if (destroyed) return;
      try {
        const emptyOpts = ckBg.checked ? { backgroundHex: '#FFFFFF', bgTolerance: 12 } : {};
        const rec = recognizePattern(state.data, state.w, state.h, prepared, {
          cellSize: state.cellSize || null,
          autoTrim: ckTrim.checked,
          whiteBalance: ckWB.checked ? 'auto' : 'off',
          sampleAlgo: state.sampleAlgo,
          marginThreshold: opts.marginThreshold,
          emptyOpts,
        });
        state.rec = rec;
        state.grid = rec.grid.map((row) => row.slice());
        state.colors = rec.colors;
        state.edits.clear(); state.sel = null;
        state.stage = 'review';
        barCal.style.display = 'none'; barRev.style.display = '';
        usageBox.style.display = '';
        setStep(2);
        drawReview();
        renderUsage();
        emit();
      } catch (e) { fail(e.message || String(e)); }
      finally { mask.style.display = 'none'; }
    }, 30);
  }

  /* ------------------------------------------------------------ 复核绘制 */
  function drawReview() {
    const rec = state.rec; if (!rec) return;
    const rows = state.grid.length, cols = state.grid[0].length;
    const availW = Math.max(240, (canvasBox.clientWidth || 600) - 2);
    const px = Math.max(3, Math.min(48, Math.floor(availW / cols)));
    state.cellPx = px;
    const cw = cols * px, chh = rows * px;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(Math.min(availW, cw) * dpr);
    canvas.height = Math.round(chh * dpr);
    canvas.style.width = Math.min(availW, cw) + 'px';
    canvas.style.height = chh + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cw, chh);

    const unc = state.showUncertain ? new Set((rec.uncertain || []).map((u) => u.r + ',' + u.c)) : null;
    const showTxt = state.showCode && px >= 16 && rows * cols <= 6000;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const code = state.grid[r][c];
        const x = c * px, y = r * px;
        if (!code) {
          ctx.fillStyle = '#fafafa'; ctx.fillRect(x, y, px, px);
          if (px >= 10) {
            ctx.strokeStyle = '#e2e8f0'; ctx.lineWidth = 1;
            ctx.beginPath(); ctx.moveTo(x + 2, y + px - 2); ctx.lineTo(x + px - 2, y + 2); ctx.stroke();
          }
        } else {
          ctx.fillStyle = hexOf.get(code) || '#ccc';
          ctx.fillRect(x, y, px, px);
        }
      }
    }

    if (state.showLines && px >= 8) {
      ctx.strokeStyle = 'rgba(0,0,0,.16)'; ctx.lineWidth = 1;
      ctx.beginPath();
      for (let c = 0; c <= cols; c++) { ctx.moveTo(c * px + .5, 0); ctx.lineTo(c * px + .5, chh); }
      for (let r = 0; r <= rows; r++) { ctx.moveTo(0, r * px + .5); ctx.lineTo(cw, r * px + .5); }
      ctx.stroke();
    }

    if (showTxt) {
      ctx.font = Math.round(px * 0.34) + 'px -apple-system,system-ui,sans-serif';
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const code = state.grid[r][c]; if (!code) continue;
          const hex = hexOf.get(code) || '#ffffff';
          ctx.fillStyle = bpLuminance(hex) > 140 ? '#111827' : '#ffffff';
          ctx.fillText(code, c * px + px / 2, r * px + px / 2, px - 2);
        }
      }
    }

    if (unc && unc.size) {
      ctx.strokeStyle = '#f97316'; ctx.lineWidth = Math.max(1, px * 0.14);
      ctx.strokeRect(0, 0, cw, chh);
      ctx.save();
      for (const key of unc) {
        const [r, c] = key.split(',').map(Number);
        if (state.edits.has(key)) continue;
        ctx.strokeStyle = '#f97316';
        ctx.lineWidth = px >= 10 ? 2 : 1;
        ctx.strokeRect(c * px + 1, r * px + 1, px - 2, px - 2);
      }
      ctx.restore();
    }

    // 手工改过的格子：蓝色角标
    if (state.edits.size) {
      ctx.fillStyle = '#2563eb';
      for (const key of state.edits.keys()) {
        const [r, c] = key.split(',').map(Number);
        const s = Math.max(3, Math.floor(px * 0.28));
        ctx.fillRect(c * px + px - s, r * px, s, s);
      }
    }
    renderInfo();
  }

  /* ------------------------------------------------------------ 交互 */
  function cellAt(e) {
    const rect = canvas.getBoundingClientRect();
    const px = state.cellPx;
    const c = Math.floor((e.clientX - rect.left) / (rect.width / (state.grid[0].length)));
    const r = Math.floor((e.clientY - rect.top) / (rect.height / state.grid.length));
    if (r < 0 || c < 0 || r >= state.grid.length || c >= state.grid[0].length) return null;
    return { r, c };
  }

  canvas.addEventListener('mousemove', (e) => {
    if (state.stage !== 'review') return;
    const p = cellAt(e); if (!p) { tip.style.opacity = 0; return; }
    const code = state.grid[p.r][p.c];
    const a = (state.rec.assignments || []).find((x) => x.r === p.r && x.c === p.c);
    const lines = [];
    lines.push('第 ' + (p.r + 1) + ' 行 / 第 ' + (p.c + 1) + ' 列');
    lines.push(code ? ('色号 ' + code + '  ' + (hexOf.get(code) || '')) : '留空');
    if (state.colors && state.colors[p.r][p.c]) lines.push('采样色 ' + state.colors[p.r][p.c]);
    if (a && a.alt) lines.push('次优 ' + a.alt + '  margin ' + (a.margin === Infinity ? '∞' : a.margin.toFixed(2)));
    tip.innerHTML = lines.map((s) => '<div>' + s + '</div>').join('');
    tip.style.opacity = 1;
    const boxRect = canvasBox.getBoundingClientRect();
    tip.style.left = Math.min(boxRect.width - 160, e.clientX - boxRect.left + 12) + 'px';
    tip.style.top = (e.clientY - boxRect.top + 16) + 'px';
  });
  canvas.addEventListener('mouseleave', () => { tip.style.opacity = 0; });
  canvas.addEventListener('click', (e) => {
    if (state.stage !== 'review') return;
    const p = cellAt(e); if (!p) return;
    state.sel = p; renderEditor();
  });

  /* ------------------------------------------------------------ 编辑卡片 */
  function setCell(r, c, code, batch) {
    const key = r + ',' + c;
    const hex = state.colors ? state.colors[r][c] : null;
    if (batch && hex) {
      for (let rr = 0; rr < state.grid.length; rr++) {
        for (let cc = 0; cc < state.grid[0].length; cc++) {
          if (state.colors[rr][cc] === hex) {
            state.grid[rr][cc] = code;
            state.edits.set(rr + ',' + cc, code);
          }
        }
      }
    } else {
      state.grid[r][c] = code;
      state.edits.set(key, code);
    }
    drawReview(); renderUsage(); renderEditor(); emit();
  }

  function applyAllAlt() {
    const list = (state.rec.uncertain || []).filter((u) => u.alt && !state.edits.has(u.r + ',' + u.c));
    if (!list.length) return;
    list.forEach((u) => { state.grid[u.r][u.c] = u.alt; state.edits.set(u.r + ',' + u.c, u.alt); });
    drawReview(); renderUsage(); emit();
  }

  function renderEditor() {
    const p = state.sel;
    if (!p) { editBox.style.display = 'none'; return; }
    editBox.style.display = '';
    editBox.innerHTML = '';
    const code = state.grid[p.r][p.c];
    const hex = state.colors ? state.colors[p.r][p.c] : null;
    editBox.appendChild(bpEl('h4', { text: '编辑格子 · 第 ' + (p.r + 1) + ' 行 第 ' + (p.c + 1) + ' 列' }));

    const row = bpEl('div', { style: 'display:flex;gap:10px;align-items:center;font-size:12px;color:#6b7280' }, [
      bpEl('div', {}, [bpEl('div', { class: 'bp-sw', style: 'background:' + (hex || '#fff') }), bpEl('div', { text: '采样' })]),
      bpEl('div', { text: '→' }),
      bpEl('div', {}, [bpEl('div', { class: 'bp-sw', style: 'background:' + (code ? hexOf.get(code) : '#fff') }), bpEl('div', { text: code || '留空' })]),
    ]);
    editBox.appendChild(row);

    const cands = hex ? topCandidates(hex, prepared, 8, 'lab') : [];
    const gridBox = bpEl('div', { class: 'bp-cands' });
    cands.forEach((cd) => {
      const b = bpEl('button', { class: 'bp-cand' + (cd.code === code ? ' on' : ''), onclick: (ev) => setCell(p.r, p.c, cd.code, ev.shiftKey) }, [
        bpEl('i', { style: 'background:' + cd.hex }),
        bpEl('div', { text: cd.code }),
        bpEl('div', { text: cd.dist.toFixed(1), style: 'color:#9ca3af' }),
      ]);
      gridBox.appendChild(b);
    });
    editBox.appendChild(gridBox);
    editBox.appendChild(bpEl('div', { style: 'margin-top:6px;font-size:11px;color:#9ca3af', text: 'Shift + 点击 = 同色格子批量替换' }));

    const ops = bpEl('div', { class: 'bp-bar', style: 'margin:8px 0 0' }, [
      bpEl('button', { class: 'bp-btn', text: '设为留空', onclick: () => setCell(p.r, p.c, null, false) }),
      bpEl('button', { class: 'bp-btn', text: '恢复自动', onclick: () => {
        const auto = state.rec.grid[p.r][p.c];
        state.grid[p.r][p.c] = auto; state.edits.delete(p.r + ',' + p.c);
        drawReview(); renderUsage(); renderEditor(); emit();
      } }),
    ]);
    editBox.appendChild(ops);
  }

  /* ------------------------------------------------------------ 信息 / 用量 */
  function renderInfo() {
    infoBox.innerHTML = '';
    infoBox.appendChild(bpEl('h4', { text: '图纸信息' }));
    const kv = (k, v) => infoBox.appendChild(bpEl('div', { class: 'bp-kv' }, [bpEl('span', { text: k }), bpEl('span', { text: v })]));

    if (state.stage === 'upload') { kv('状态', '等待上传'); return; }

    kv('原图', state.w + ' × ' + state.h + ' px');
    kv('格子大小', (state.cellSize || '-') + ' px');
    if (state.rec) {
      const rows = state.grid.length, cols = state.grid[0].length;
      kv('网格', cols + ' × ' + rows + ' （' + (rows * cols) + ' 格）');
      kv('用色数', state.rec.colorCount + ' 色');
      kv('有效豆', state.rec.beadCount + ' 颗');
      const u = (state.rec.uncertain || []).filter((x) => !state.edits.has(x.r + ',' + x.c)).length;
      kv('待确认', u + ' 格（' + (state.rec.uncertainRatio * 100).toFixed(1) + '%）');
      kv('白平衡', state.rec.whiteBalance && state.rec.whiteBalance.applied
        ? ('已校正 kr=' + state.rec.whiteBalance.kr.toFixed(2) + ' kb=' + state.rec.whiteBalance.kb.toFixed(2))
        : '未校正');
      kv('手工修改', state.edits.size + ' 格');
      if (state.rec.quality && state.rec.quality.ratio > 0.3) {
        infoBox.appendChild(bpEl('div', {
          class: 'bp-warn',
          text: '画面过曝/饱和像素 ' + (state.rec.quality.ratio * 100).toFixed(0) + '%，这部分颜色已不可恢复，建议换一张更清晰的图。',
        }));
      }
      if (state.rec.uncertainRatio > 0.35) {
        infoBox.appendChild(bpEl('div', {
          class: 'bp-warn',
          text: '待确认格子偏多，通常是图片偏色或分辨率太低。可先调「白平衡」再识别一次。',
        }));
      }
    }
  }

  function usageNow() {
    const m = {};
    for (let r = 0; r < state.grid.length; r++) {
      for (let c = 0; c < state.grid[0].length; c++) {
        const code = state.grid[r][c];
        if (code) m[code] = (m[code] || 0) + 1;
      }
    }
    return summarize(m, prepared, 'count');
  }

  function renderUsage() {
    const list = usageNow();
    usageList.innerHTML = '';
    list.forEach((it) => {
      usageList.appendChild(bpEl('div', { class: 'bp-usage-row' }, [
        bpEl('div', { class: 'bp-sw', style: 'background:' + (it.hex || '#fff') }),
        bpEl('div', { class: 'bp-code', text: it.code }),
        bpEl('div', { text: it.name || '', style: 'color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap' }),
        bpEl('div', { class: 'bp-cnt', text: it.count + ' 颗' }),
      ]));
    });
    usageBox.querySelector('h4').textContent = '用量统计 · ' + list.length + ' 色 / ' +
      list.reduce((s, x) => s + x.count, 0) + ' 颗';
  }

  /* ------------------------------------------------------------ 结果 */
  function result() {
    const rec = state.rec;
    return {
      brand: opts.brand,
      cols: state.grid[0].length,
      rows: state.grid.length,
      grid: state.grid.map((row) => row.slice()),
      colors: state.colors ? state.colors.map((row) => row.slice()) : null,
      usage: usageNow(),
      meta: {
        cellSize: rec ? rec.detectedCellSize : null,
        offset: rec ? rec.offset : null,
        sampleAlgo: rec ? rec.sampleAlgo : null,
        whiteBalance: rec ? rec.whiteBalance : null,
        quality: rec ? rec.quality : null,
        uncertainRatio: rec ? rec.uncertainRatio : 0,
        edited: state.edits.size,
      },
    };
  }
  function emit() { if (opts.onChange) opts.onChange(result()); }

  function confirm_() {
    const r = result();
    if (opts.onConfirm) opts.onConfirm(r);
    return r;
  }

  /* ------------------------------------------------------------ 导出 */
  function exportJson() {
    const r = result();
    bpDownload('pattern-' + r.cols + 'x' + r.rows + '.json',
      new Blob([JSON.stringify(r, null, 2)], { type: 'application/json' }));
  }
  function exportCsv() {
    const r = result();
    const lines = ['code,hex,name,count'];
    r.usage.forEach((u) => lines.push([u.code, u.hex, u.name || '', u.count].join(',')));
    bpDownload('pattern-usage.csv', new Blob(['\ufeff' + lines.join('\n')], { type: 'text/csv;charset=utf-8' }));
  }
  function exportPng() {
    const r = result();
    const px = 28, pad = 12;
    const cv = document.createElement('canvas');
    cv.width = r.cols * px + pad * 2; cv.height = r.rows * px + pad * 2;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#fff'; c2.fillRect(0, 0, cv.width, cv.height);
    c2.font = Math.round(px * 0.32) + 'px -apple-system,system-ui,sans-serif';
    c2.textAlign = 'center'; c2.textBaseline = 'middle';
    for (let y = 0; y < r.rows; y++) {
      for (let x = 0; x < r.cols; x++) {
        const code = r.grid[y][x];
        const X = pad + x * px, Y = pad + y * px;
        if (!code) { c2.fillStyle = '#fafafa'; c2.fillRect(X, Y, px, px); continue; }
        const hex = hexOf.get(code) || '#fff';
        c2.fillStyle = hex; c2.fillRect(X, Y, px, px);
        c2.fillStyle = bpLuminance(hex) > 140 ? '#111827' : '#fff';
        c2.fillText(code, X + px / 2, Y + px / 2, px - 2);
      }
    }
    c2.strokeStyle = '#cbd5e1'; c2.lineWidth = 1;
    c2.strokeRect(pad + .5, pad + .5, r.cols * px - 1, r.rows * px - 1);
    cv.toBlob((b) => bpDownload('pattern-' + r.cols + 'x' + r.rows + '.png', b));
  }

  /* ------------------------------------------------------------ 云端复核 */
  function cropCell(r, c, size) {
    const step = state.rec.detectedCellSize, off = state.rec.offset;
    const cv = document.createElement('canvas');
    cv.width = size; cv.height = size;
    const c2 = cv.getContext('2d');
    c2.fillStyle = '#FFFFFF'; c2.fillRect(0, 0, size, size);
    c2.imageSmoothingEnabled = true; c2.imageSmoothingQuality = 'high';
    c2.drawImage(state.work, off.x + c * step, off.y + r * step, step, step, 0, 0, size, size);
    return c2.getImageData(0, 0, size, size).data;
  }

  async function refineUncertain() {
    if (!opts.refine || !state.rec) return;
    const list = (state.rec.uncertain || []).filter((u) => !state.edits.has(u.r + ',' + u.c)).slice(0, 600);
    if (!list.length) return;
    const old = btnRefine.textContent;
    btnRefine.disabled = true; btnRefine.textContent = '复核中…';
    try {
      const cells = list.map((u) => ({ r: u.r, c: u.c, rgba: cropCell(u.r, u.c, 80) }));
      const out = await opts.refine(cells);
      (out || []).forEach((it) => {
        if (!it || !it.code) return;
        state.grid[it.r][it.c] = it.code;
        state.edits.set(it.r + ',' + it.c, it.code);
      });
      drawReview(); renderUsage(); emit();
    } catch (e) { fail('云端复核失败：' + (e.message || e)); }
    finally { btnRefine.disabled = false; btnRefine.textContent = old; }
  }

  /* ------------------------------------------------------------ 尺寸自适应 */
  let rt = null;
  const handleResize = () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (destroyed) return;
      if (state.stage === 'calibrate') drawCalibrate();
      else if (state.stage === 'review') drawReview();
    }, 150);
  };
  window.addEventListener('resize', handleResize);

  renderInfo();

  return {
    /** 外部触发加载文件 */
    loadFile,
    /** 拿当前结果 */
    getResult: result,
    /** 直接灌入一张图（HTMLImageElement / URL） */
    loadImage(src) {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => { if (!destroyed) { state.img = img; prepare(img); } };
      img.onerror = () => fail('图片加载失败');
      img.src = src;
    },
    /** 识别完成后由外部触发（等价于点确认） */
    confirm: confirm_,
    /** 程序化触发识别（跳过手工点按钮，适合「传完图就自动识别」的场景） */
    recognize: run,
    /** 当前阶段 */
    getStage: () => state.stage,
    destroy() {
      destroyed = true;
      clearTimeout(rt);
      window.removeEventListener('resize', handleResize);
      root.removeEventListener('paste', handlePaste);
      root.innerHTML = '';
    },
  };
}

var API = Object.assign({}, __CORE__, {
  mount: mountPatternImporter,
  mountPatternImporter: mountPatternImporter,
  topCandidates: topCandidates,
  preparePalette: preparePalette,
  recognizePattern: recognizePattern,
  detectGridStep: detectGridStep,
  estimateWhiteBalance: estimateWhiteBalance,
  estimateGridPhase: estimateGridPhase,
  MARD: MARD_PALETTE,
});
global.BeadPattern = API;
global.MARD_PALETTE = MARD_PALETTE;
if (typeof module !== 'undefined' && module.exports) { module.exports = API; }
})(typeof window !== 'undefined' ? window : this);
