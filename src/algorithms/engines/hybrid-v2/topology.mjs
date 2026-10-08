/**
 * Topology —— Hybrid V2 阶段 9（TopologyGuard 的底层算子）。
 *
 * 审计限定（docs/research/TOPOLOGY_AUDIT.md）：
 *   - G 只有「删除某格后同 owner 是否仍 8 连通」（`ownerConnectedWithout`），
 *     **不计算背景孔洞、不核查开口封闭**；F/E/D 更没有。
 *   - 因此本模块的 hole / opening 检测是**本项目实现**，只能**检测并报告**，
 *     不得声称「拓扑守恒」或「自动修复」。
 *   - `ga0my connectivity` 是 UNVERIFIED，不作为任何实现依据。
 */

export const CONNECTIVITY = Object.freeze({ FOUR: 4, EIGHT: 8 });

/** 同色连通域（CURRENT `findConnectedComponents` 同口径：4 邻同色）。 */
export function connectedComponents(grid, getColorKey, connectivity = CONNECTIVITY.FOUR) {
  const rows = grid.length;
  const cols = rows ? Math.max(...grid.map((row) => row.length)) : 0;
  const seen = new Uint8Array(cols * rows);
  const out = [];
  const neighborOffsets = connectivity === CONNECTIVITY.EIGHT
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (seen[i]) continue;
      const cell = grid[y][x];
      const key = cell == null ? null : getColorKey(cell);
      if (key == null) { seen[i] = 1; continue; }
      const stack = [[x, y]];
      seen[i] = 1;
      const pixels = [];
      while (stack.length) {
        const [cx, cy] = stack.pop();
        pixels.push([cx, cy]);
        for (const [dx, dy] of neighborOffsets) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni]) continue;
          const other = grid[ny][nx];
          if (other == null || getColorKey(other) !== key) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      out.push({ key, size: pixels.length, pixels });
    }
  }
  return out;
}

/** G `ownerConnectedWithout` 思路：移除/改掉某格后，该 owner 是否仍连通。 */
export function isConnectedWithout(pixels, removed, connectivity = CONNECTIVITY.EIGHT) {
  const set = new Set(pixels.map(([x, y]) => `${x},${y}`));
  set.delete(`${removed[0]},${removed[1]}`);
  if (set.size <= 1) return true;
  const [start] = [...set];
  const [sx, sy] = start.split(",").map(Number);
  const offsets = connectivity === CONNECTIVITY.EIGHT
    ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]
    : [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const seen = new Set([start]);
  const stack = [[sx, sy]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    for (const [dx, dy] of offsets) {
      const k = `${cx + dx},${cy + dy}`;
      if (!set.has(k) || seen.has(k)) continue;
      seen.add(k);
      stack.push([cx + dx, cy + dy]);
    }
  }
  return seen.size === set.size;
}

/**
 * 背景孔洞：背景格（null）的 4 邻连通域中**不接触画布边界**的那些。
 * 审计：无外仓提供此实现 —— 本项目实现，只检测不保证。
 */
export function backgroundHoles(grid) {
  const rows = grid.length;
  const cols = rows ? Math.max(...grid.map((row) => row.length)) : 0;
  const isBg = (x, y) => grid[y][x] == null;
  const seen = new Uint8Array(cols * rows);
  const holes = [];
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (seen[i] || !isBg(x, y)) { seen[i] = 1; continue; }
      const stack = [[x, y]];
      seen[i] = 1;
      const pixels = [];
      let touchesBorder = false;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        pixels.push([cx, cy]);
        if (cx === 0 || cy === 0 || cx === cols - 1 || cy === rows - 1) touchesBorder = true;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const ni = ny * cols + nx;
          if (seen[ni] || !isBg(nx, ny)) continue;
          seen[ni] = 1;
          stack.push([nx, ny]);
        }
      }
      if (!touchesBorder) holes.push({ size: pixels.length, pixels });
    }
  }
  return holes;
}

/**
 * 开口计数：前景边界上「背景从一个方向接进来」的凹段数量代理。
 * 审计：本项目实现，只检测不保证。用「前景格的 4 邻中有 ≥2 个背景且彼此不相邻」计数。
 */
export function openingCount(grid) {
  const rows = grid.length;
  const cols = rows ? Math.max(...grid.map((row) => row.length)) : 0;
  let count = 0;
  for (let y = 1; y < rows - 1; y++) {
    for (let x = 1; x < cols - 1; x++) {
      if (grid[y][x] != null) continue;
      const up = grid[y - 1][x] != null;
      const down = grid[y + 1][x] != null;
      const left = grid[y][x - 1] != null;
      const right = grid[y][x + 1] != null;
      if ((up && down && !left && !right) || (left && right && !up && !down)) count++;
    }
  }
  return count;
}

/** 一次快照：供 BEFORE/AFTER 比较。 */
export function topologySnapshot(grid, getColorKey) {
  const components = connectedComponents(grid, getColorKey, CONNECTIVITY.FOUR);
  return {
    componentCount: components.length,
    components,
    holeCount: backgroundHoles(grid).length,
    openingCount: openingCount(grid),
    beadCount: countBeads(grid),
  };
}

export function countBeads(grid) {
  let n = 0;
  for (const row of grid) for (const cell of row) if (cell != null) n++;
  return n;
}

/* ────────────────────────────────────────────────────────────
 * TopologyGuard —— proposal → ALLOW / REJECT
 * ──────────────────────────────────────────────────────────── */

/**
 * 每次改格提案都要过 Guard。只判 ALLOW / REJECT，**不做修复**。
 *
 * 检测项：component count change / bridge removal / hole change /
 *         opening closure / separated component loss / connectivity break / identity
 */
export class TopologyGuard {
  constructor(grid, getColorKey, options = {}) {
    this.grid = grid;
    this.getKey = getColorKey;
    this.options = options;
    this.rejects = [];
    this.allowCount = 0;
    this.snapshot = topologySnapshot(grid, getColorKey);
  }

  /**
   * @param {{x:number,y:number,from:*,to:*}} proposal
   * @returns {{verdict:'ALLOW'|'REJECT', checks:object, reasons:string[]}}
   */
  check(proposal) {
    const { x, y, to } = proposal;
    const grid = this.grid;
    const rows = grid.length;
    const cols = rows ? grid[0].length : 0;
    if (y < 0 || y >= rows || x < 0 || x >= cols) {
      return this.#reject(["out-of-bounds"]);
    }
    const before = grid[y][x];
    const beforeKey = before == null ? null : this.getKey(before);
    const toKey = to == null ? null : this.getKey(to);
    if (beforeKey === toKey) {
      return { verdict: "ALLOW", checks: { noop: true }, reasons: ["no-change"] };
    }

    // 先在副本上试算
    const copy = grid.map((row) => row.slice());
    copy[y][x] = to;
    const after = topologySnapshot(copy, this.getKey);

    const checks = {
      componentCountChange: after.componentCount - this.snapshot.componentCount,
      holeChange: after.holeCount - this.snapshot.holeCount,
      openingChange: after.openingCount - this.snapshot.openingCount,
      beadCountChange: after.beadCount - this.snapshot.beadCount,
    };

    const reasons = [];

    // ① 孔洞变化 —— 审计明确无外仓守恒实现，默认一律 REJECT
    if (checks.holeChange !== 0) {
      reasons.push(`hole-change:${checks.holeChange > 0 ? "+" : ""}${checks.holeChange}`);
      if (!this.options.allowHoleChange) return this.#reject(reasons, checks);
    }
    // ② 开口封闭
    if (checks.openingChange !== 0) {
      reasons.push(`opening-change:${checks.openingChange > 0 ? "+" : ""}${checks.openingChange}`);
      if (!this.options.allowOpeningClosure) return this.#reject(reasons, checks);
    }
    // ③ 桥接 / 连通性断裂：改掉某格后，原所属同色组件是否分裂
    if (beforeKey != null) {
      const source = this.snapshot.components.find((c) => c.key === beforeKey
        && c.pixels.some(([px, py]) => px === x && py === y));
      if (source && source.size > 1) {
        const sameKeyNeighbors = source.pixels.filter(([px, py]) => !(px === x && py === y));
        const connected = isConnectedWithout(sameKeyNeighbors, [x, y], this.options.ownerConnectivity ?? CONNECTIVITY.EIGHT);
        checks.bridgeRemoval = !connected;
        if (!connected) {
          reasons.push("bridge-removal:component-splits-without-this-cell");
          return this.#reject(reasons, checks);
        }
      }
      // ④ separated component loss：该格是原组件的最后一格且被改掉
      if (source && source.size === 1 && toKey == null) {
        checks.separatedComponentLoss = true;
        reasons.push("separated-component-loss:last-cell-of-owner");
        if (!this.options.allowSeparatedComponentLoss) return this.#reject(reasons, checks);
      }
    }
    // ⑤ 组件数变化（记录，不单独拒绝 —— 合并本来就会减少组件）
    if (checks.componentCountChange !== 0) reasons.push(`component-count-change:${checks.componentCountChange}`);

    this.allowCount++;
    return { verdict: "ALLOW", checks, reasons: reasons.length ? reasons : ["within-tolerance"] };
  }

  #reject(reasons, checks = {}) {
    this.rejects.push({ reasons, checks });
    return { verdict: "REJECT", checks, reasons };
  }

  get report() {
    return {
      allowCount: this.allowCount,
      rejectCount: this.rejects.length,
      rejects: this.rejects,
      baseline: {
        componentCount: this.snapshot.componentCount,
        holeCount: this.snapshot.holeCount,
        openingCount: this.snapshot.openingCount,
      },
    };
  }
}
