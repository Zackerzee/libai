/**
 * Regression Fixtures —— 10 类（用户第 13 条）。
 *
 * 第一版全部是**程序化合成夹具**：无外部图片依赖、可复现、每格断言明确。
 * 每张夹具图的像素数 == 网格数（1 像素 = 1 豆格），这样采样是恒等映射，
 * 回归断言只考验**保护 / 分类 / 拓扑 / 清理 / 规整**这些阶段，不被采样噪声干扰。
 *
 * `fixtures/real/` 目录保留给真实失败案例；接入时同样要给出 invariants。
 */

export const FIXTURE_KIND = Object.freeze({
  EDGE_CONTAMINATION: "EDGE_CONTAMINATION",
  FLAT_COLOR_BLOCK: "FLAT_COLOR_BLOCK",
  PORTRAIT_EYE: "PORTRAIT_EYE",
  ANIME_HIGHLIGHT: "ANIME_HIGHLIGHT",
  THIN_OUTLINE: "THIN_OUTLINE",
  SMALL_SEPARATED_DETAIL: "SMALL_SEPARATED_DETAIL",
  HOLE_OPENING: "HOLE_OPENING",
  BRIDGE: "BRIDGE",
  COMPLEX_SCENE: "COMPLEX_SCENE",
  SIMPLE_CARTOON: "SIMPLE_CARTOON",
});

export const PALETTE = Object.freeze([
  { code: "W1", name: "白", rgb: [255, 255, 255] },
  { code: "K1", name: "黑", rgb: [16, 16, 16] },
  { code: "S1", name: "肤", rgb: [244, 214, 190] },
  { code: "R1", name: "红", rgb: [220, 60, 60] },
  { code: "G1", name: "绿", rgb: [70, 170, 80] },
  { code: "B1", name: "蓝", rgb: [60, 110, 200] },
  { code: "Y1", name: "黄", rgb: [245, 215, 70] },
  { code: "H1", name: "高光", rgb: [255, 255, 240] },
]);

const RGB = Object.fromEntries(PALETTE.map((e) => [e.code, e.rgb]));

/** painter 返回 `null` 表示该像素透明（alpha=0）—— 用来造真正的「留空」孔洞。 */
function makeImage(cols, rows, painter) {
  const data = new Uint8ClampedArray(cols * rows * 4);
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const rgb = painter(x, y);
      const i = (y * cols + x) * 4;
      if (!rgb) { data[i + 3] = 0; continue; }
      data[i] = rgb[0];
      data[i + 1] = rgb[1];
      data[i + 2] = rgb[2];
      data[i + 3] = 255;
    }
  }
  return { width: cols, height: rows, data };
}

const keyOf = (cell) => (cell == null ? null : typeof cell === "string" ? cell : cell.code);
const at = (grid, x, y) => keyOf(grid[y]?.[x]);

function buildFixtures() {
  const out = [];

  /* ① EDGE_CONTAMINATION：平坦背景 + 沿边散布的杂色单豆 */
  {
    const cols = 24;
    const rows = 24;
    const noise = new Set(["3,3", "5,7", "9,4", "12,9", "17,6", "20,11", "7,18", "14,20"]);
    const imageData = makeImage(cols, rows, (x, y) => {
      if (noise.has(`${x},${y}`)) return RGB.R1;
      return x >= 6 && x < 18 && y >= 6 && y < 18 ? RGB.S1 : RGB.W1;
    });
    out.push({
      kind: FIXTURE_KIND.EDGE_CONTAMINATION,
      name: "平坦区边沿散布 8 颗红色杂豆",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "edgeContamination 不增加",
          check: (result) => {
            const first = result.stageMetrics[0];
            const last = result.stageMetrics[result.stageMetrics.length - 1];
            return { pass: last.after.edgeContaminationCount <= first.before.edgeContaminationCount,
              detail: `${first.before.edgeContaminationCount} → ${last.after.edgeContaminationCount}` };
          },
        },
      ],
    });
  }

  /* ② FLAT_COLOR_BLOCK：大平色块里 2 颗异色碎片 */
  {
    const cols = 20;
    const rows = 20;
    const specks = new Set(["8,8", "11,12"]);
    const imageData = makeImage(cols, rows, (x, y) => (specks.has(`${x},${y}`) ? RGB.K1 : RGB.G1));
    out.push({
      kind: FIXTURE_KIND.FLAT_COLOR_BLOCK,
      name: "绿色平块里 2 颗黑色碎片",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "平块碎片被规整（孤立单豆下降）",
          check: (result) => {
            const last = result.stageMetrics[result.stageMetrics.length - 1];
            return { pass: last.after.isolatedCellCount <= last.before.isolatedCellCount,
              detail: `iso ${last.before.isolatedCellCount} → ${last.after.isolatedCellCount}` };
          },
        },
      ],
    });
  }

  /* ③ PORTRAIT_EYE：肤色脸上的深色瞳孔（2×2） */
  {
    const cols = 20;
    const rows = 20;
    const pupils = [[7, 9], [8, 9], [7, 10], [8, 10], [12, 9], [13, 9], [12, 10], [13, 10]];
    const pupilSet = new Set(pupils.map(([x, y]) => `${x},${y}`));
    const imageData = makeImage(cols, rows, (x, y) => (pupilSet.has(`${x},${y}`) ? RGB.K1 : RGB.S1));
    out.push({
      kind: FIXTURE_KIND.PORTRAIT_EYE,
      name: "双眼瞳孔（各 2×2 深格）",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "瞳孔格一个都不能被改色",
          check: (result) => {
            const kept = pupils.filter(([x, y]) => at(result.matrix, x, y) === "K1").length;
            return { pass: kept === pupils.length, detail: `${kept}/${pupils.length}` };
          },
        },
      ],
    });
  }

  /* ④ ANIME_HIGHLIGHT：深色头发里的高光点 */
  {
    const cols = 20;
    const rows = 20;
    const hl = new Set(["5,5", "6,5", "5,6", "14,4", "15,4"]);
    const imageData = makeImage(cols, rows, (x, y) => (hl.has(`${x},${y}`) ? RGB.H1 : RGB.K1));
    out.push({
      kind: FIXTURE_KIND.ANIME_HIGHLIGHT,
      name: "深色头发中的 5 格高光",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "高光格保留",
          check: (result) => {
            const kept = [...hl].filter((k) => {
              const [x, y] = k.split(",").map(Number);
              return at(result.matrix, x, y) === "H1";
            }).length;
            return { pass: kept === hl.size, detail: `${kept}/${hl.size}` };
          },
        },
      ],
    });
  }

  /* ⑤ THIN_OUTLINE：1 格宽的细线（含直角） */
  {
    const cols = 24;
    const rows = 24;
    const line = new Set();
    for (let x = 4; x <= 19; x++) line.add(`${x},6`);
    for (let y = 6; y <= 17; y++) line.add(`19,${y}`);
    const imageData = makeImage(cols, rows, (x, y) => (line.has(`${x},${y}`) ? RGB.K1 : RGB.W1));
    out.push({
      kind: FIXTURE_KIND.THIN_OUTLINE,
      name: "1 格宽折线轮廓",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "细线不断（线格保留率 ≥ 90%）",
          check: (result) => {
            const kept = [...line].filter((k) => {
              const [x, y] = k.split(",").map(Number);
              return at(result.matrix, x, y) === "K1";
            }).length;
            return { pass: kept / line.size >= 0.9, detail: `${kept}/${line.size}` };
          },
        },
        {
          name: "线仍是一个连通域（桥未被删）",
          check: (result) => {
            const last = result.stageMetrics[result.stageMetrics.length - 1];
            return { pass: last.after.componentCount <= 3, detail: `components=${last.after.componentCount}` };
          },
        },
      ],
    });
  }

  /* ⑥ SMALL_SEPARATED_DETAIL：区域内的孤立小部件 */
  {
    const cols = 20;
    const rows = 20;
    const dot = new Set(["10,10"]);
    const imageData = makeImage(cols, rows, (x, y) => (dot.has(`${x},${y}`) ? RGB.Y1 : RGB.B1));
    out.push({
      kind: FIXTURE_KIND.SMALL_SEPARATED_DETAIL,
      name: "蓝色区域内 1 格黄色独立细节",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "独立细节不得被当噪点删除",
          check: (result) => ({ pass: at(result.matrix, 10, 10) === "Y1", detail: `got ${at(result.matrix, 10, 10)}` }),
        },
      ],
    });
  }

  /* ⑦ HOLE_OPENING：圆环（中心一个孔） */
  {
    const cols = 20;
    const rows = 20;
    const imageData = makeImage(cols, rows, (x, y) => {
      const dx = x - 9.5;
      const dy = y - 9.5;
      const r = Math.hypot(dx, dy);
      if (r <= 2.5) return null;        // 孔：透明 → 留空
      if (r <= 7) return RGB.R1;        // 环
      return null;                      // 环外也留空
    });
    out.push({
      kind: FIXTURE_KIND.HOLE_OPENING,
      name: "圆环：中心必须留孔",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "孔洞未被填平",
          check: (result) => {
            const last = result.stageMetrics[result.stageMetrics.length - 1];
            return { pass: last.after.holeCount >= 1, detail: `holeCount=${last.after.holeCount}` };
          },
        },
      ],
    });
  }

  /* ⑧ BRIDGE：两块区域由 1 格桥连接 */
  {
    const cols = 24;
    const rows = 16;
    const imageData = makeImage(cols, rows, (x, y) => {
      if (x < 8 && y >= 4 && y < 12) return RGB.G1;
      if (x > 15 && y >= 4 && y < 12) return RGB.G1;
      if (x >= 8 && x <= 15 && y === 7) return RGB.G1; // 桥
      return RGB.W1;
    });
    out.push({
      kind: FIXTURE_KIND.BRIDGE,
      name: "两块绿色区域由 1 格桥连接",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "桥格保留（两块仍连通 → 组件数不增加）",
          check: (result) => {
            const last = result.stageMetrics[result.stageMetrics.length - 1];
            return { pass: last.after.componentCount <= last.before.componentCount,
              detail: `${last.before.componentCount} → ${last.after.componentCount}` };
          },
        },
      ],
    });
  }

  /* ⑨ COMPLEX_SCENE：多色复杂场景 */
  {
    const cols = 32;
    const rows = 32;
    const imageData = makeImage(cols, rows, (x, y) => {
      const band = Math.floor((x + y) / 4) % 7;
      return [RGB.R1, RGB.G1, RGB.B1, RGB.Y1, RGB.S1, RGB.K1, RGB.W1][band];
    });
    out.push({
      kind: FIXTURE_KIND.COMPLEX_SCENE,
      name: "七色斜带复杂场景，maxColors=5",
      imageData, palette: PALETTE, cols, rows, maxColors: 5,
      invariants: [
        {
          name: "maxColors 上限被尊重",
          check: (result) => ({ pass: result.usedColors.length <= 5, detail: `used=${result.usedColors.length}` }),
        },
      ],
    });
  }

  /* ⑩ SIMPLE_CARTOON：三色平涂 */
  {
    const cols = 24;
    const rows = 24;
    const imageData = makeImage(cols, rows, (x, y) => {
      if (y < 8) return RGB.W1;
      if (y < 16) return RGB.S1;
      return RGB.B1;
    });
    out.push({
      kind: FIXTURE_KIND.SIMPLE_CARTOON,
      name: "三色平涂，不应引入碎片",
      imageData, palette: PALETTE, cols, rows, maxColors: 0,
      invariants: [
        {
          name: "仍是 3 个连通域（不碎片化）",
          check: (result) => {
            const last = result.stageMetrics[result.stageMetrics.length - 1];
            return { pass: last.after.componentCount <= 3, detail: `components=${last.after.componentCount}` };
          },
        },
        {
          name: "用色数不超过 3",
          check: (result) => ({ pass: result.usedColors.length <= 3, detail: `used=${result.usedColors.length}` }),
        },
      ],
    });
  }

  return out;
}

export const FIXTURES = Object.freeze(buildFixtures());

/** 跑全部夹具的不变量。只报 pass/fail，**不判优劣**。 */
export function runFixtureSuite(runner, fixtures = FIXTURES) {
  const results = [];
  for (const fixture of fixtures) {
    const result = runner(fixture);
    const checks = fixture.invariants.map((inv) => {
      try {
        const r = inv.check(result);
        return { name: inv.name, pass: Boolean(r.pass), detail: r.detail ?? "" };
      } catch (error) {
        return { name: inv.name, pass: false, detail: `error: ${error.message}` };
      }
    });
    results.push({
      kind: fixture.kind,
      name: fixture.name,
      pass: checks.every((c) => c.pass),
      checks,
    });
  }
  return results;
}
