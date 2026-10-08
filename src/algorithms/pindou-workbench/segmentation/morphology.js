/**
 * segmentation/morphology.js
 * ─────────────────────────────────────────────────────────────
 * 上游对应物：`autoCutout` 里**内联的两处**形态学（app.js:129–143 与 190–219）。
 * 上游没有把这些算子抽成函数，所以无法单独复用或单测；本文件把它们分离出来。
 *
 * 上游的「腐蚀」不是标准腐蚀（审计缺陷 S-4）：
 *   ```js
 *   eroded[y * w + x] = sum >= 5 ? 1 : 0;   // 3×3 邻域前景数 >= 5
 *   ```
 * 标准 3×3 腐蚀要求 9 个邻域**全**为前景（min-filter）。上游这个是**多数腐蚀**，
 * 弱得多：一条 1 像素宽的线在标准腐蚀下会整体消失，在多数腐蚀下能存活。
 * 因此本模块把两者都提供，并把上游语义命名为 `majorityErode`，
 * 默认值仍是上游的 `majority`（不改老行为），`improved` 档才切到 `min-filter`。
 *
 * 一个实测澄清（审计时曾被结构直觉误导）：
 *   上游的膨胀写的是 `dilated2[(y + dy) * w + (x + dx)] = 1`，
 *   会**向外写进边框**。虽然腐蚀那一步把边框清成了 0，但紧接着的膨胀会把
 *   边框重新填回。所以**不存在「主体贴边被切掉一圈」的伪影**。
 *   本模块的 `dilate` 因此直接用标准全量遍历（既正确、又与上游等价）。
 *
 * 上游缺的是**连通性分析**（审计缺陷 S-3）：与边框不连通的主体不会被剔除，
 * 孤立噪点岛也不会被剔除。本文件补出 `connectedComponents` 一族。
 */

import { PW_CONFIG, ERODE_MODE } from "../config.js";

export { ERODE_MODE };

/** 8 邻域偏移（含自身）。 */
const NEIGHBORS8 = [
  [-1, -1], [-1, 0], [-1, 1],
  [0, -1], [0, 0], [0, 1],
  [1, -1], [1, 0], [1, 1],
];

/**
 * 膨胀（3×3 全量铺开）。上游 app.js:129–143 与 206–217。
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {{radius?:number, iterations?:number}} [options]
 * @returns {{mask:Uint8Array, radius:number, iterations:number}}
 */
export function dilate(mask, width, height, options = {}) {
  const radius = Math.max(1, options.radius ?? PW_CONFIG.morphology.radius);
  const iterations = Math.max(1, options.iterations ?? 1);
  let current = Uint8Array.from(mask);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (!current[y * width + x]) continue;
        for (let dy = -radius; dy <= radius; dy++) {
          const ny = y + dy;
          if (ny < 0 || ny >= height) continue;
          for (let dx = -radius; dx <= radius; dx++) {
            const nx = x + dx;
            if (nx < 0 || nx >= width) continue;
            next[ny * width + nx] = 1;
          }
        }
      }
    }
    current = next;
  }

  return { mask: current, radius, iterations };
}

/**
 * 标准腐蚀（min-filter）：3×3 邻域**全部**为前景才保留。
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {{radius?:number, iterations?:number}} [options]
 */
export function erode(mask, width, height, options = {}) {
  const radius = Math.max(1, options.radius ?? PW_CONFIG.morphology.radius);
  const iterations = Math.max(1, options.iterations ?? 1);
  let current = Uint8Array.from(mask);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(width * height);
    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        let all = true;
        for (let dy = -radius; dy <= radius && all; dy++) {
          const rowBase = (y + dy) * width;
          for (let dx = -radius; dx <= radius; dx++) {
            if (!current[rowBase + x + dx]) { all = false; break; }
          }
        }
        if (all) next[y * width + x] = 1;
      }
    }
    current = next;
  }

  return { mask: current, radius, iterations, mode: ERODE_MODE.MIN_FILTER };
}

/**
 * 上游的「腐蚀」：3×3 邻域前景数 >= threshold 即保留（默认 5）。
 * 注意与 `erode` 的语义差异 —— 这是**多数腐蚀**，比标准腐蚀弱得多。
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {{threshold?:number, radius?:number, iterations?:number}} [options]
 */
export function majorityErode(mask, width, height, options = {}) {
  const radius = Math.max(1, options.radius ?? PW_CONFIG.morphology.radius);
  const threshold = options.threshold ?? PW_CONFIG.morphology.majorityThreshold;
  const iterations = Math.max(1, options.iterations ?? 1);
  let current = Uint8Array.from(mask);

  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(width * height);
    for (let y = radius; y < height - radius; y++) {
      for (let x = radius; x < width - radius; x++) {
        let sum = 0;
        for (let dy = -radius; dy <= radius; dy++) {
          const rowBase = (y + dy) * width;
          for (let dx = -radius; dx <= radius; dx++) sum += current[rowBase + x + dx];
        }
        next[y * width + x] = sum >= threshold ? 1 : 0;
      }
    }
    current = next;
  }

  return { mask: current, radius, threshold, iterations, mode: ERODE_MODE.MAJORITY };
}

/** 按模式分派腐蚀。 */
export function erodeWith(mode, mask, width, height, options = {}) {
  return mode === ERODE_MODE.MIN_FILTER
    ? erode(mask, width, height, options)
    : majorityErode(mask, width, height, options);
}

/**
 * 开运算 = 腐蚀 → 膨胀。上游 app.js:190–219 的形态学「优化」就是这个，
 * 迭代 `morphIter` 次；`erodeMode` 默认 majority（上游语义）。
 */
export function open(mask, width, height, options = {}) {
  const iterations = Math.max(1, options.iterations ?? PW_CONFIG.morphology.iterations);
  const mode = options.erodeMode || PW_CONFIG.morphology.erodeMode;
  const radius = options.radius ?? PW_CONFIG.morphology.radius;

  const eroded = erodeWith(mode, mask, width, height, { radius, iterations, threshold: options.threshold });
  const dilated = dilate(eroded.mask, width, height, { radius, iterations });
  return { mask: dilated.mask, iterations, erodeMode: mode, radius };
}

/** 闭运算 = 膨胀 → 腐蚀。 */
export function close(mask, width, height, options = {}) {
  const iterations = Math.max(1, options.iterations ?? 1);
  const mode = options.erodeMode || ERODE_MODE.MIN_FILTER;
  const radius = options.radius ?? PW_CONFIG.morphology.radius;

  const dilated = dilate(mask, width, height, { radius, iterations });
  const eroded = erodeWith(mode, dilated.mask, width, height, { radius, iterations, threshold: options.threshold });
  return { mask: eroded.mask, iterations, erodeMode: mode, radius };
}

/**
 * 连通域标记（BFS，显式栈，不递归）。
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {{connectivity?:4|8}} [options]
 * @returns {{labels:Int32Array, components:Array, count:number}}
 */
export function connectedComponents(mask, width, height, options = {}) {
  const connectivity = options.connectivity === 8 ? 8 : 4;
  const offsets = connectivity === 8
    ? NEIGHBORS8.filter(([dy, dx]) => dy !== 0 || dx !== 0)
    : [[-1, 0], [1, 0], [0, -1], [0, 1]];

  const labels = new Int32Array(width * height).fill(-1);
  const components = [];
  const stack = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = components.length;
    const pixelList = [];
    let minX = width;
    let maxX = -1;
    let minY = height;
    let maxY = -1;
    let touchesBorder = false;

    labels[start] = id;
    stack.push(start);

    while (stack.length) {
      const index = stack.pop();
      const y = (index / width) | 0;
      const x = index - y * width;
      pixelList.push(index);
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (x === 0 || y === 0 || x === width - 1 || y === height - 1) touchesBorder = true;

      for (const [dy, dx] of offsets) {
        const ny = y + dy;
        const nx = x + dx;
        if (ny < 0 || ny >= height || nx < 0 || nx >= width) continue;
        const next = ny * width + nx;
        if (!mask[next] || labels[next] !== -1) continue;
        labels[next] = id;
        stack.push(next);
      }
    }

    components.push({
      id,
      size: pixelList.length,
      minX,
      maxX,
      minY,
      maxY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      touchesBorder,
      pixels: pixelList,
    });
  }

  return { labels, components, count: components.length };
}

/**
 * 按连通域过滤掩码 —— 上游完全没有这一步（缺陷 S-3）。
 *
 * 两种典型语义：
 *   - `keepBorderContact: true` —— 只保留与画布边框连通的区域（抠「主体」，剔掉背景碎块）。
 *   - `keepBorderContact: false` —— 剔掉与边框连通的区域（抠「主体」，剔掉背景）。
 *   - 再加 `minSize` 去掉小噪点岛。
 *
 * @param {Uint8Array} mask
 * @param {number} width
 * @param {number} height
 * @param {{connectivity?:4|8, minSize?:number, keepBorderContact?:boolean|null}} [options]
 * @returns {{mask:Uint8Array, kept:number, removed:number, components:Array, keptComponents:Array}}
 */
export function filterComponents(mask, width, height, options = {}) {
  const { labels, components } = connectedComponents(mask, width, height, options);
  const minSize = Math.max(1, options.minSize ?? 1);
  const keepBorderContact = options.keepBorderContact === undefined || options.keepBorderContact === null
    ? null
    : options.keepBorderContact === true;

  const kept = [];
  const keptIds = new Set();
  for (const component of components) {
    if (component.size < minSize) continue;
    if (keepBorderContact !== null && component.touchesBorder !== keepBorderContact) continue;
    kept.push(component);
    keptIds.add(component.id);
  }

  const out = new Uint8Array(width * height);
  for (let i = 0; i < labels.length; i++) {
    if (labels[i] >= 0 && keptIds.has(labels[i])) out[i] = 1;
  }

  return {
    mask: out,
    kept: kept.length,
    removed: components.length - kept.length,
    components,
    keptComponents: kept,
  };
}

/** 只统计，不改动（给 diagnostics 用）。 */
export function componentStats(mask, width, height, options = {}) {
  const { components, count } = connectedComponents(mask, width, height, options);
  let smallest = Infinity;
  let largest = 0;
  let borderContact = 0;
  for (const component of components) {
    if (component.size < smallest) smallest = component.size;
    if (component.size > largest) largest = component.size;
    if (component.touchesBorder) borderContact++;
  }
  return {
    count,
    largest: components.length ? largest : 0,
    smallest: components.length ? smallest : 0,
    borderContact,
    totalPixels: components.reduce((sum, c) => sum + c.size, 0),
  };
}

export const DEFAULT_MORPHOLOGY = Object.freeze({
  radius: PW_CONFIG.morphology.radius,
  iterations: PW_CONFIG.morphology.iterations,
  majorityThreshold: PW_CONFIG.morphology.majorityThreshold,
  erodeMode: PW_CONFIG.morphology.erodeMode,
});
