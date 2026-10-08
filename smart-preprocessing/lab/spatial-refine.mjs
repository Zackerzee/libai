/**
 * §9 Spatial Refine —— 候选算法（Lab，**不进生产**）。
 *
 * ── 要解决的问题 ──────────────────────────────────────────────────────
 * 逐格独立匹配会产生**孤立的不一致**：一格因为源图里恰好有个噪点或渐变拐点，
 * 匹配到了和四周都不搭的色号。单看那一格「最近」，看整片就是一个脏点。
 *
 * Spatial Refine 迭代地让每一格在三个力之间重新平衡：
 *   · source fidelity      这格离源图色有多远
 *   · neighbor consistency 这格和四周像不像
 *   · edge preservation    这格是不是在边界上（边界上不许乱动）
 *
 * ── 硬约束（§9 原文）─────────────────────────────────────────────────
 *   · 候选**只能**来自：当前色 / 邻居实际色 / 当前色附近 Top-K 色卡色
 *   · 禁止每轮全色板搜索
 *   · 2–4 iterations，early stop
 *
 * 「当前色附近 Top-K」是这三个里最容易被实现成 O(格数 × 色卡数) 的一个。
 * 本实现把「每个色卡色的 Top-K 邻居」**预先算一次**（197 × 197 次 CIE76），
 * 之后每格只是查表。500 格网下这一步省掉的是 1.5 亿次距离计算。
 *
 * ── 两条不在 §9 原文里、但必须有的硬保护 ───────────────────────────────
 *   ① `protectionMap >= freezeProtection` 的格子**完全冻结**。
 *      保护图判为高价值的格子（眼睛/高光/描边）本来就已经匹配对了，
 *      让 refine 去「优化」它们，等于用一个更弱的判据去覆盖一个更强的判据。
 *      冻结之后，refine 的定位是**去噪**，不是**修细节** —— 这是刻意的。
 *   ② 双缓冲：一轮里所有格子都基于**上一轮**的状态计算，最后一起提交。
 *      原地顺序更新会让结果依赖遍历顺序 —— 仍然是确定性的，但「确定」的是
 *      一个没人能解释的东西，出问题无从复现。
 */

import {
  paletteLabTable, nearestEntries, rgbToLab, deltaE2000,
} from "./buckets.mjs";

export const SPATIAL_REFINE_ID = "spatial-refine";

export const DEFAULT_SPATIAL_REFINE_OPTIONS = Object.freeze({
  iterations: 3,
  topK: 3,
  // 能量权重。三项量纲统一在 ΔE 上，所以这三个数可以横向比较 ——
  // 这不是审美问题，是「能不能解释为什么没生效」的问题。
  wFidelity: 1.0,
  wNeighbor: 0.6,
  // 边界项：`wEdge × edgeMap[idx] × edgeScale`（改了才罚）
  wEdge: 1.0,
  edgeScale: 20,
  // 孤立项：候选色既不是当前色、又不在 8 邻里出现 → 罚。
  //
  // 这一项是**实测逼出来的**，不是设计时想到的。首轮 Lab 的逐类数据：
  // A 类 `componentCount` 9 → 22、`tinyRegions` 0 → 13，而 refine 只改了 12 格 ——
  // 也就是说**每改一格就多一个孤立点**。
  // 根因是 §9 允许的「当前色附近 Top-K 色卡色」这个候选来源：
  // 邻居项用的是邻居**均值**，一个不在邻域里、但恰好离均值近一点的色卡色
  // 可以靠邻居项赚回几分、再靠保真项赔几分，净收益刚过 minImprovement 就换 ——
  // 换完这格就成了孤岛。
  // 加一个显式的孤立罚之后，Top-K 候选要翻过 12 ΔE 才可能被选中，
  // 而它本来能赚到的邻居项收益通常只有 1–2 ΔE。
  wIsolation: 1.0,
  isolationScale: 12,
  // 冻结门槛
  freezeProtection: 0.85,
  // 收益不足这个值就不改 —— 防止平局附近的来回抖动
  minImprovement: 0.05,
});

const EIGHT_OFFSETS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** 每个色卡色的 Top-K 邻居，按 palette 数组缓存。 */
const NEIGHBOR_TABLES = new WeakMap();

function paletteNeighborTable(palette, table, topK) {
  const cached = NEIGHBOR_TABLES.get(palette);
  if (cached && cached.topK === topK && cached.size === table.length) return cached.map;
  const map = new Map();
  for (const entry of table) {
    // 多取一个再滤掉自己：`nearestEntries` 的第一名永远是自己（距离 0）。
    const near = nearestEntries(entry.lab, table, topK + 1).filter((e) => e !== entry).slice(0, topK);
    map.set(entry.code, near);
  }
  NEIGHBOR_TABLES.set(palette, { topK, size: table.length, map });
  return map;
}

/**
 * @param {object} [options]
 * @returns {{id:string, refineGrid:(ctx:object)=>void}}
 */
export function createSpatialRefine(options = {}) {
  const opts = { ...DEFAULT_SPATIAL_REFINE_OPTIONS, ...options };
  const id = options.id || SPATIAL_REFINE_ID;
  return {
    id,
    refineGrid(ctx) {
      const { grid, width, height, source, palette, protection, sampled, getColorKey, report } = ctx;
      const table = paletteLabTable(palette);
      if (!table.length || !sampled?.colors) return;

      const labByCode = new Map();
      for (const entry of table) labByCode.set(entry.code, entry.lab);
      const colorByCode = new Map();
      for (const entry of table) colorByCode.set(entry.code, entry.color);
      const neighbors = paletteNeighborTable(palette, table, opts.topK);

      // 源图色（采样出口）的 Lab。null 表示该格没有不透明像素 —— 全程不参与。
      const sourceLab = new Array(width * height).fill(null);
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const rgb = sampled.colors[y]?.[x];
          if (!rgb) continue;
          sourceLab[y * width + x] = rgbToLab([rgb.r, rgb.g, rgb.b]);
        }
      }

      const protectionMap = protection?.protectionMap || null;
      const edgeMap = protection?.edgeMap || null;

      let current = grid.map((row) => row.slice());
      let totalChanges = 0;
      let totalGain = 0;
      let iterationsRun = 0;

      for (let iter = 0; iter < opts.iterations; iter += 1) {
        iterationsRun += 1;
        const next = current.map((row) => row.slice());
        let changed = 0;

        for (let y = 0; y < height; y += 1) {
          for (let x = 0; x < width; x += 1) {
            const idx = y * width + x;
            const cell = current[y][x];
            // **null 完整性**：空格永远是空格，refine 不许往里填色。
            if (!cell) continue;
            const srcLab = sourceLab[idx];
            if (!srcLab) continue;
            if (protectionMap && protectionMap[idx] >= opts.freezeProtection) continue;

            const ownCode = getColorKey(cell);
            const ownLab = labByCode.get(ownCode) || rgbToLab(cell.rgb);

            // 邻居直方图：一轮算一次，候选评估里复用。
            // 不这么做的后果是每个候选都重扫 8 邻 —— 8 倍开销，而 500 格网下
            // 那就是几百万次多余比较。
            const histogram = new Map();
            let filledNeighbors = 0;
            for (const [dx, dy] of EIGHT_OFFSETS) {
              const nx = x + dx, ny = y + dy;
              if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
              const ncell = current[ny][nx];
              if (!ncell) continue;
              const ncode = getColorKey(ncell);
              filledNeighbors += 1;
              histogram.set(ncode, (histogram.get(ncode) || 0) + 1);
            }

            // 候选集：当前色 → 邻居实际色（固定偏移顺序）→ 当前色附近 Top-K。
            const candidates = [ownCode];
            for (const [code] of histogram) if (!candidates.includes(code)) candidates.push(code);
            for (const entry of neighbors.get(ownCode) || []) {
              if (!candidates.includes(entry.code)) candidates.push(entry.code);
            }

            // 邻居项用**邻居均值 Lab 的距离**，不用「1 − 同色占比」。
            //
            // 这不是偏好问题。用占比的写法是 `w × (1 − share) × scale`，
            // 在一整片同色区里：当前色的项是 0，任何替代色的项是 `scale`。
            // 那是一个**固定高度的悬崖**（scale 默认 25 → 25 ΔE），
            // 而源图保真项的差距通常只有几个 ΔE —— 于是没有任何替代色翻得过去，
            // 算法在结构上就是惰性的。首次实测正是如此：A/D/G 三类 10816 格里
            // `changedCells` 全是 0，而且一轮就 early stop。
            //
            // 换成「候选色 vs 邻居均值的 ΔE」之后，三项都是 ΔE 量纲、
            // 都是连续量，谁在起作用可以逐项读出来。
            let neighborMeanLab = null;
            if (filledNeighbors > 0) {
              let nl = 0, na = 0, nb = 0;
              for (const [code, count] of histogram) {
                const lab = labByCode.get(code);
                if (!lab) continue;
                nl += lab[0] * count; na += lab[1] * count; nb += lab[2] * count;
              }
              neighborMeanLab = [nl / filledNeighbors, na / filledNeighbors, nb / filledNeighbors];
            }

            const edge = edgeMap ? edgeMap[idx] : 0;
            const energy = (code, lab) => {
              let value = opts.wFidelity * deltaE2000(srcLab, lab);
              if (neighborMeanLab) value += opts.wNeighbor * deltaE2000(lab, neighborMeanLab);
              if (code !== ownCode) {
                value += opts.wEdge * edge * opts.edgeScale;
                // 候选色不在邻域里 → 这一格会变成孤岛。见 DEFAULT 里 `wIsolation` 的注释。
                if (!histogram.has(code)) value += opts.wIsolation * opts.isolationScale;
              }
              return value;
            };

            let bestCode = ownCode;
            let bestLab = ownLab;
            const ownEnergy = energy(ownCode, ownLab);
            let bestEnergy = ownEnergy;
            for (let i = 1; i < candidates.length; i += 1) {
              const code = candidates[i];
              const lab = labByCode.get(code);
              if (!lab) continue;
              const value = energy(code, lab);
              // 收益必须**明确**超过 minImprovement 才接受；平局保留原样。
              if (value < bestEnergy - opts.minImprovement) { bestEnergy = value; bestCode = code; bestLab = lab; }
            }
            if (bestCode !== ownCode) {
              totalGain += ownEnergy - bestEnergy;
              next[y][x] = { ...(colorByCode.get(bestCode) || cell) };
              changed += 1;
            }
            void bestLab;
          }
        }

        current = next;
        totalChanges += changed;
        if (changed === 0) break; // early stop
      }

      // 原地写回：接缝契约是「改 grid 或返回新数组」，这里选原地改，
      // 因为引擎里 grid 的引用还被 diagnostics 的闭包握着。
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) grid[y][x] = current[y][x];
      }

      report.spatialRefine = {
        iterationsRun,
        maxIterations: opts.iterations,
        changedCells: totalChanges,
        // 累计能量下降。**和 changedCells 一起看**：改了 5000 格但总收益 0.3，
        // 说明它在做无意义的抖动；改了 12 格但收益 90，说明它抓到的是真不一致。
        totalGain: Math.round(totalGain * 100) / 100,
        topK: opts.topK,
        frozen: protectionMap ? countFrozen(protectionMap, opts.freezeProtection) : 0,
      };
      void source;
    },
  };
}

function countFrozen(protectionMap, threshold) {
  let n = 0;
  for (let i = 0; i < protectionMap.length; i += 1) if (protectionMap[i] >= threshold) n += 1;
  return n;
}

export default { createSpatialRefine, SPATIAL_REFINE_ID, DEFAULT_SPATIAL_REFINE_OPTIONS };
