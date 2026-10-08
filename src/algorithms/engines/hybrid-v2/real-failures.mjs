/**
 * REAL_FAILURE_FIXTURES —— Hybrid V2 Phase B.1 真实缺陷夹具。
 *
 * 关键变化（相对 Phase B 的纯色合成夹具）：
 *   旧夹具是 1 像素=1 豆 的纯色块，最近邻放大后仍是干净块，
 *   不携带 CURRENT 在**真实照片降采样**时才会产生的缺陷。
 *   本模块生成"照片级"原图（渐变 / 抗锯齿 / 平滑噪声），使 CURRENT 在其上
 *   真正产出 edge contamination / flat fragmentation / anti-alias leakage 等缺陷，
 *   从而让 Hybrid V2 的候选检测真正触发、让 Protection Gate 审计有料可查。
 *
 * 文件结构（落盘到 `tests/fixtures/real-failures/<id>/`）：
 *   image.png      —— RGBA 原图（可被人替换为真实 PNG）
 *   metadata.json  —— 生成条件 + knownFailure + expectedBehavior
 *
 * 流程（严遵用户第 9 条）：
 *   REAL ORIGINAL IMAGE → CURRENT → CURRENT BeadMatrix → Hybrid V2 后处理 → HYBRID_V2 Matrix
 * 因此本夹具只提供"原图"，不提供"正确最终矩阵"（除非人工确认 ground truth）。
 *
 * 铁律：不替换 CURRENT、不放松 buildProtectionMap、不声称 Hybrid V2 更优。
 */

import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, decodePng } from "./png-io.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

/** 真实缺陷夹具落盘根目录（相对仓库根）。 */
export const REAL_FAILURES_DIR = join(__dirname, "..", "..", "..", "..", "tests", "fixtures", "real-failures");

/** 复用 Phase B 的 8 色 MARD 色板，保证 CURRENT / HYBRID 能落到同一套色号。 */
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

/** 确定性 RNG（mulberry32），保证夹具可复现。 */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function lerpRgb(a, b, t) {
  return [Math.round(lerp(a[0], b[0], t)), Math.round(lerp(a[1], b[1], t)), Math.round(lerp(a[2], b[2], t))];
}
function addNoise(rgb, amp, r) {
  return [
    Math.max(0, Math.min(255, Math.round(rgb[0] + (r() - 0.5) * 2 * amp))),
    Math.max(0, Math.min(255, Math.round(rgb[1] + (r() - 0.5) * 2 * amp))),
    Math.max(0, Math.min(255, Math.round(rgb[2] + (r() - 0.5) * 2 * amp))),
  ];
}
/** 平滑值噪声（多频正弦叠加），用于模拟照片的连续明暗变化。 */
function smooth(x, y, k) {
  return (
    0.5
    + 0.25 * Math.sin(x * 0.05 + k) * Math.cos(y * 0.04 - k)
    + 0.15 * Math.sin((x + y) * 0.09 + k * 1.7)
    + 0.10 * Math.cos((x - y) * 0.07 - k * 0.6)
  );
}

/** 形状覆盖度（抗锯齿）：返回 [0,1]，>0.5 视为形状内部。 */
function disk(x, y, cx, cy, r) {
  const d = Math.hypot(x - cx, y - cy);
  return Math.max(0, Math.min(1, r - d + 0.5));
}

// ── 八类 painter ─────────────────────────────────────────────
// 每张都"照片级"：渐变 + 抗锯齿 + 平滑噪声，目的是诱发 CURRENT 真实缺陷。

function paintEdgeContamination(size, r) {
  const bg = RGB.W1;
  const subj = RGB.R1;
  return (x, y) => {
    // 主体：居中矩形
    const inX = x > size * 0.28 && x < size * 0.72;
    const inY = y > size * 0.28 && y < size * 0.72;
    const edgeBand = (inX !== (x > size * 0.28 - 3 && x < size * 0.72 + 3))
      || (inY !== (y > size * 0.28 - 3 && y < size * 0.72 + 3));
    let c = bg;
    if (inX && inY) c = subj;
    else if (edgeBand) {
      // 边缘抗锯齿带：在 bg↔subj 之间过渡（中间色）
      const t = smooth(x * 0.1 + y * 0.1, 0, 3) * 0.5;
      c = lerpRgb(bg, subj, 0.3 + t * 0.4);
    }
    // 边缘附近撒轻微噪声 → CURRENT 采样出杂色单豆
    if (Math.abs((inX ? 0 : 1) - (inY ? 0 : 1)) < 1 && r() < 0.04) c = RGB.G1;
    return addNoise(c, 6, r);
  };
}

function paintFlatFragmentation(size, r) {
  // 大块"几乎纯色"区域（绿），但散布稀疏的近色/白噪点 → CURRENT 降采样后
  // 在平坦绿场里产出零散异色小珠 = flat region fragmentation 典型案例。
  const base = RGB.G1;
  const speckle = RGB.W1;
  return (x, y) => {
    // 极缓渐变，让区域"视觉上平"
    const t = (Math.sin(x * 0.012) + Math.cos(y * 0.012)) * 0.5 * 0.5 + 0.5;
    let c = lerpRgb(base, [110, 195, 120], t * 0.25);
    // 稀疏 speckle：确定性棋盘 + 噪声
    const s = (Math.sin(x * 0.7) * Math.cos(y * 0.7) * 1000) % 1;
    if (s < 0.012) c = speckle;
    else if (s < 0.02) c = lerpRgb(base, [120, 200, 130], 0.6);
    c = addNoise(c, 4, r);
    return c;
  };
}

function paintAntiAliasLeakage(size, r) {
  const bg = RGB.W1;
  const line = RGB.K1;
  return (x, y) => {
    // 一组细对角斜线（1px 宽，含抗锯齿中间色）
    let minD = 1e9;
    for (let k = -size; k < size; k += 22) {
      const d = Math.abs((x - y) - k) / Math.SQRT2;
      minD = Math.min(minD, d);
    }
    let c = bg;
    if (minD < 0.5) c = line;
    else if (minD < 1.6) {
      const t = 1 - (minD - 0.5) / 1.1; // 抗锯齿过渡
      c = lerpRgb(bg, line, t);
    }
    return addNoise(c, 3, r);
  };
}

function paintPortraitEye(size, r) {
  const bg = RGB.S1; // 肤色背景（脸）
  const eyeWhite = RGB.W1;
  const pupil = RGB.K1;
  const highlight = RGB.H1;
  return (x, y) => {
    const cx = size * 0.5, cy = size * 0.5;
    const dEye = disk(x, y, cx, cy, size * 0.18);
    const dPupil = disk(x, y, cx + size * 0.02, cy, size * 0.08);
    const dHi = disk(x, y, cx - size * 0.02, cy - size * 0.02, size * 0.02);
    let c = bg;
    if (dEye > 0.5) c = eyeWhite;
    if (dPupil > 0.5) c = pupil;
    // 高光：小亮点在瞳孔上
    if (dHi > 0.5) c = highlight;
    // 边缘抗锯齿
    if (dEye > 0.2 && dEye < 0.6) c = lerpRgb(c, eyeWhite, dEye);
    if (dPupil > 0.2 && dPupil < 0.6) c = lerpRgb(c, pupil, dPupil);
    return addNoise(c, 4, r);
  };
}

function paintAnimeHighlight(size, r) {
  const bg = RGB.W1;
  const iris = RGB.B1;
  const accent = RGB.Y1;
  const highlight = RGB.H1;
  return (x, y) => {
    const cx = size * 0.5, cy = size * 0.5;
    const dIris = disk(x, y, cx, cy, size * 0.22);
    const dAcc = disk(x, y, cx, cy - size * 0.05, size * 0.1);
    const dHi = disk(x, y, cx - size * 0.06, cy - size * 0.07, size * 0.05);
    let c = bg;
    if (dIris > 0.5) c = iris;
    if (dAcc > 0.5) c = accent;
    if (dHi > 0.5) c = highlight;
    if (dHi > 0.2 && dHi < 0.6) c = lerpRgb(c, highlight, dHi);
    if (dAcc > 0.2 && dAcc < 0.6) c = lerpRgb(c, accent, dAcc);
    return addNoise(c, 4, r);
  };
}

function paintThinStructure(size, r) {
  const bg = RGB.W1;
  const ink = RGB.K1;
  return (x, y) => {
    // 细框 + 几根细发丝
    const frame = (Math.abs(x - size * 0.5) < 1 || Math.abs(y - size * 0.5) < 1);
    const hair = Math.abs(Math.sin(x * 0.08) * 30 + size * 0.3 - y) < 0.8;
    const hair2 = Math.abs(Math.cos(x * 0.05) * 24 + size * 0.6 - y) < 0.8;
    let c = bg;
    if (frame || hair || hair2) c = ink;
    return addNoise(c, 3, r);
  };
}

function paintSmallSeparated(size, r) {
  const bg = RGB.W1;
  const body = RGB.R1;
  const earring = RGB.Y1;
  return (x, y) => {
    const dBody = disk(x, y, size * 0.4, size * 0.5, size * 0.22);
    const dEar = disk(x, y, size * 0.78, size * 0.72, size * 0.03); // 小分离部件
    let c = bg;
    if (dBody > 0.5) c = body;
    if (dEar > 0.5) c = earring;
    if (dBody > 0.2 && dBody < 0.6) c = lerpRgb(c, body, dBody);
    if (dEar > 0.2 && dEar < 0.6) c = lerpRgb(c, earring, dEar);
    return addNoise(c, 4, r);
  };
}

function paintComplexScene(size, r) {
  const sky = RGB.B1, water = lerpRgb(RGB.B1, [40, 80, 160], 0.4), grass = RGB.G1, building = RGB.S1, roof = RGB.R1;
  return (x, y) => {
    const t = y / size;
    let c;
    if (t < 0.45) {
      // 天空：带渐变
      c = lerpRgb(sky, [200, 220, 245], t / 0.45);
    } else if (t < 0.6) {
      // 建筑带
      const band = Math.sin(x * 0.06) > 0.3;
      c = band ? building : roof;
    } else if (t < 0.75) {
      c = grass;
    } else {
      c = lerpRgb(water, [30, 70, 140], (t - 0.75) / 0.25);
    }
    c = addNoise(c, 7, r); // 平滑噪声，模拟真实照片纹理
    return c;
  };
}

const SPECS = Object.freeze([
  {
    id: "rf-edge-contam", category: "EDGE_CONTAMINATION", seed: 101,
    knownFailure: "边缘本应统一颜色，CURRENT 输出出现 G1/B1 等非结构性边缘杂色。",
    expectedBehavior: { removeNoise: true, preserveStructure: true },
    painter: paintEdgeContamination,
  },
  {
    id: "rf-flat-frag", category: "FLAT_REGION_FRAGMENTATION", seed: 202,
    knownFailure: "原图是缓变平色区，CURRENT 限色后碎片成多个相近色号。",
    expectedBehavior: { removeNoise: true, preserveStructure: true },
    painter: paintFlatFragmentation,
  },
  {
    id: "rf-aa-leak", category: "ANTI_ALIAS_LEAKAGE", seed: 303,
    knownFailure: "细线抗锯齿中间色被 CURRENT 放大成独立豆色。",
    expectedBehavior: { removeNoise: true, preserveStructure: true },
    painter: paintAntiAliasLeakage,
  },
  {
    id: "rf-portrait-eye", category: "PORTRAIT_EYE_DETAIL", seed: 404,
    knownFailure: "人物瞳孔高光（小亮豆）被 CURRENT 合并/丢失。",
    expectedBehavior: { removeNoise: true, preserveStructure: true, preserveHighlight: true },
    painter: paintPortraitEye,
  },
  {
    id: "rf-anime-hl", category: "ANIME_HIGHLIGHT", seed: 505,
    knownFailure: "动漫眼睛高光与强调色被 CURRENT 抹平。",
    expectedBehavior: { removeNoise: true, preserveStructure: true, preserveHighlight: true },
    painter: paintAnimeHighlight,
  },
  {
    id: "rf-thin-struct", category: "THIN_STRUCTURE", seed: 606,
    knownFailure: "发丝/镜框/衣领等细结构被 CURRENT 断裂或并入背景。",
    expectedBehavior: { removeNoise: true, preserveStructure: true },
    painter: paintThinStructure,
  },
  {
    id: "rf-small-sep", category: "SMALL_SEPARATED_COMPONENT", seed: 707,
    knownFailure: "耳环等小分离部件被 CURRENT 删除或并入主体。",
    expectedBehavior: { removeNoise: true, preserveStructure: true, preserveSeparated: true },
    painter: paintSmallSeparated,
  },
  {
    id: "rf-complex", category: "COMPLEX_SCENE", seed: 808,
    knownFailure: "建筑/树木/水面/山体等多结构场景下，CURRENT 产生边缘杂色与结构损失。",
    expectedBehavior: { removeNoise: true, preserveStructure: true },
    painter: paintComplexScene,
  },
]);

export const REAL_FAILURE_SPECS = SPECS;

const DEFAULT_TARGET = { cols: 104, rows: 104 };
const DEFAULT_MAX_COLORS = 24;
const NATIVE_SIZE = 256;

/** 生成所有真实缺陷夹具到磁盘（image.png + metadata.json）。 */
export function generateRealFailureFixtures(rootDir = REAL_FAILURES_DIR, opts = {}) {
  const force = opts.force ?? false;
  const created = [];
  for (const spec of SPECS) {
    const dir = join(rootDir, spec.id);
    const pngPath = join(dir, "image.png");
    const metaPath = join(dir, "metadata.json");
    if (!force && existsSync(pngPath) && existsSync(metaPath)) {
      created.push(spec.id);
      continue;
    }
    mkdirSync(dir, { recursive: true });
    const r = rng(spec.seed);
    const data = new Uint8ClampedArray(NATIVE_SIZE * NATIVE_SIZE * 4);
    for (let y = 0; y < NATIVE_SIZE; y++) {
      for (let x = 0; x < NATIVE_SIZE; x++) {
        const rgb = spec.painter(NATIVE_SIZE, r)(x, y);
        const i = (y * NATIVE_SIZE + x) * 4;
        data[i] = rgb[0]; data[i + 1] = rgb[1]; data[i + 2] = rgb[2]; data[i + 3] = 255;
      }
    }
    const imageData = { width: NATIVE_SIZE, height: NATIVE_SIZE, data };
    writeFileSync(pngPath, encodePng(imageData));
    const metadata = {
      id: spec.id,
      category: spec.category,
      source: "generated-photographic",
      nativeSize: NATIVE_SIZE,
      target: DEFAULT_TARGET,
      maxColors: DEFAULT_MAX_COLORS,
      paletteSize: PALETTE.length,
      knownFailure: spec.knownFailure,
      protectedRegions: [],
      expectedBehavior: spec.expectedBehavior,
      generatedSeed: spec.seed,
      note: "程序生成的照片级原图，用于诱发 CURRENT 真实缺陷。可用真实 PNG 替换 image.png（保留 metadata.json）。",
    };
    writeFileSync(metaPath, JSON.stringify(metadata, null, 2));
    created.push(spec.id);
  }
  return created;
}

/**
 * 加载真实缺陷夹具。扫描 rootDir 下每个子目录：读 metadata.json + image.png。
 * 若子目录只有 image.png 没有 metadata.json（用户放入真实图），则合成默认 metadata。
 * @returns {Array<{id,category,metadata,imageData}>}
 */
export function loadRealFailureFixtures(rootDir = REAL_FAILURES_DIR) {
  if (!existsSync(rootDir)) return [];
  const out = [];
  for (const name of readdirSync(rootDir)) {
    const dir = join(rootDir, name);
    if (!statSync(dir).isDirectory()) continue;
    const pngPath = join(dir, "image.png");
    if (!existsSync(pngPath)) continue;
    let metadata;
    const metaPath = join(dir, "metadata.json");
    if (existsSync(metaPath)) {
      metadata = JSON.parse(readFileSync(metaPath, "utf8"));
    } else {
      metadata = {
        id: name, category: "UNKNOWN", source: "user-provided",
        target: DEFAULT_TARGET, maxColors: DEFAULT_MAX_COLORS,
        knownFailure: "", protectedRegions: [], expectedBehavior: {},
        note: "用户放入的真实原图，缺少 metadata.json —— 已合成默认元数据。",
      };
    }
    const imageData = decodePng(readFileSync(pngPath));
    out.push({ id: metadata.id || name, category: metadata.category, metadata, imageData });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}
