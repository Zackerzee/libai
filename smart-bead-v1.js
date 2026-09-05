(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (root) root.SmartBeadV1 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  const PRESETS = Object.freeze({
    standard: Object.freeze({
      skinBrightening: 0,
      shadowCompression: 0,
      outlineStrength: 20,
      blockCleanup: 15,
      highlightStrength: 10,
      colorRichness: 50,
      detailPreservation: 60,
    }),
    portrait: Object.freeze({
      skinBrightening: 20,
      shadowCompression: 28,
      outlineStrength: 65,
      blockCleanup: 55,
      highlightStrength: 35,
      colorRichness: 65,
      detailPreservation: 75,
    }),
    chibi: Object.freeze({
      skinBrightening: 10,
      shadowCompression: 45,
      outlineStrength: 80,
      blockCleanup: 80,
      highlightStrength: 20,
      colorRichness: 35,
      detailPreservation: 50,
    }),
  });

  const clamp = (value, min = 0, max = 100) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.min(max, Math.max(min, number)) : min;
  };

  function getSizeProfile(width, height) {
    const cells = Math.max(0, Number(width) || 0) * Math.max(0, Number(height) || 0);
    if (cells <= 52 * 52) return "small";
    if (cells <= 78 * 78) return "medium";
    return "large";
  }

  function resolveOptions(raw = {}, width = 0, height = 0) {
    const preset = PRESETS[raw.preset] ? raw.preset : "standard";
    const defaults = PRESETS[preset];
    const values = {};
    for (const key of Object.keys(defaults)) {
      values[key] = clamp(raw[key] ?? defaults[key]);
    }
    const sizeProfile = getSizeProfile(width, height);
    if (sizeProfile === "small") {
      values.outlineStrength = clamp(values.outlineStrength + 10);
      values.blockCleanup = clamp(values.blockCleanup + 10);
      values.colorRichness = clamp(values.colorRichness - 10);
      values.detailPreservation = clamp(values.detailPreservation - 10);
    } else if (sizeProfile === "large") {
      values.colorRichness = clamp(values.colorRichness + 10);
      values.detailPreservation = clamp(values.detailPreservation + 10);
      values.blockCleanup = clamp(values.blockCleanup - 5);
    }
    return { ...values, enabled: raw.enabled !== false, preset, sizeProfile };
  }

  function cellCode(cell) {
    return typeof cell === "string" ? cell : String(cell?.code || "");
  }

  function cellRgb(cell) {
    if (typeof cell === "string") return [0, 0, 0];
    return Array.isArray(cell?.rgb) ? cell.rgb.slice(0, 3).map((value) => Number(value) || 0) : [0, 0, 0];
  }

  function cloneCell(cell) {
    return typeof cell === "string" ? cell : { ...cell, rgb: cellRgb(cell) };
  }

  function sameRgb(a, b) {
    return a[0] === b[0] && a[1] === b[1] && a[2] === b[2];
  }

  function colorDistance(a, b) {
    return Math.sqrt(
      ((a[0] - b[0]) ** 2) + ((a[1] - b[1]) ** 2) + ((a[2] - b[2]) ** 2),
    );
  }

  function nearestPaletteCell(rgb, palette) {
    const colors = Array.isArray(palette) ? palette : palette?.colors;
    if (!Array.isArray(colors) || colors.length === 0) return null;
    let best = colors[0];
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const color of colors) {
      const candidate = cellRgb(color);
      const distance = colorDistance(rgb, candidate);
      if (distance < bestDistance) {
        best = color;
        bestDistance = distance;
      }
    }
    return cloneCell(best);
  }

  function skinScore(rgb) {
    const [r, g, b] = rgb;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const warmth = r - b;
    const redLead = r - g;
    const brightness = (r + g + b) / 3;
    if (brightness < 45 || brightness > 250) return 0;
    if (warmth < 12 || redLead < 4) return 0;
    const saturation = max === 0 ? 0 : (max - min) / max;
    if (saturation < 0.08 || saturation > 0.72) return 0;
    const warmFit = Math.min(1, Math.max(0, warmth / 115));
    const redFit = Math.min(1, Math.max(0, redLead / 75));
    const satFit = 1 - Math.abs(saturation - 0.36) / 0.36;
    return Math.max(0, Math.min(1, warmFit * 0.4 + redFit * 0.35 + Math.max(0, satFit) * 0.25));
  }

  function buildEdgeImportance(grid, width, height) {
    const importance = new Float32Array(Math.max(0, width * height));
    const index = (x, y) => y * width + x;
    let maximum = 1;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const current = cellRgb(grid[index(x, y)]);
        let total = 0;
        let count = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          total += colorDistance(current, cellRgb(grid[index(nx, ny)]));
          count += 1;
        }
        importance[index(x, y)] = count ? total / count : 0;
        maximum = Math.max(maximum, importance[index(x, y)]);
      }
    }
    for (let i = 0; i < importance.length; i += 1) importance[i] = Math.min(1, importance[i] / maximum);
    return importance;
  }

  function adjustSkinTone(grid, width, height, palette, options) {
    if (options.preset !== "portrait" || options.skinBrightening <= 0) return 0;
    let changed = 0;
    for (let i = 0; i < grid.length; i += 1) {
      const rgb = cellRgb(grid[i]);
      const score = skinScore(rgb);
      if (score < 0.42) continue;
      const highlightLift = ((rgb[0] + rgb[1] + rgb[2]) / 3 > 150)
        ? (options.highlightStrength / 100) * score * 8
        : 0;
      const lift = (options.skinBrightening / 100) * score * 24 + highlightLift;
      const adjusted = [
        Math.min(255, rgb[0] + lift),
        Math.min(255, rgb[1] + lift * 0.78),
        Math.min(255, rgb[2] + lift * 0.62),
      ];
      const replacement = nearestPaletteCell(adjusted, palette);
      if (replacement && !sameRgb(rgb, cellRgb(replacement))) {
        grid[i] = replacement;
        changed += 1;
      }
    }
    return changed;
  }

  function compressLowContrastShadows(grid, width, height, palette, options, edgeImportance) {
    if (options.preset !== "portrait" || options.shadowCompression <= 0) return 0;
    const index = (x, y) => y * width + x;
    const edgeLimit = 0.42 + (options.outlineStrength / 100) * 0.24;
    const strength = (options.shadowCompression / 100) * 0.35;
    let changed = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const currentIndex = index(x, y);
        const rgb = cellRgb(grid[currentIndex]);
        const luminance = (rgb[0] * 0.299) + (rgb[1] * 0.587) + (rgb[2] * 0.114);
        if (luminance < 24 || luminance > 125 || (edgeImportance[currentIndex] || 0) > edgeLimit) continue;
        const neighbors = [];
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          neighbors.push(cellRgb(grid[index(nx, ny)]));
        }
        if (neighbors.length < 2) continue;
        const average = neighbors.reduce((sum, value) => sum + ((value[0] * 0.299) + (value[1] * 0.587) + (value[2] * 0.114)), 0) / neighbors.length;
        if (average - luminance < 10) continue;
        const adjusted = rgb.map((value, channel) => value + ((neighbors.reduce((sum, item) => sum + item[channel], 0) / neighbors.length) - value) * strength);
        const replacement = nearestPaletteCell(adjusted, palette);
        if (replacement && !sameRgb(rgb, cellRgb(replacement))) {
          grid[currentIndex] = replacement;
          changed += 1;
        }
      }
    }
    return changed;
  }

  function cleanupSmallRegions(grid, width, height, options, edgeImportance) {
    if (options.blockCleanup <= 0 || !width || !height) return 0;
    const visited = new Uint8Array(grid.length);
    const richnessPenalty = Math.round((100 - options.colorRichness) / 25);
    const maxSize = options.preset === "chibi"
      ? Math.max(2, Math.round(1 + options.blockCleanup / 12 + richnessPenalty))
      : Math.max(1, Math.round(options.blockCleanup / 35 + richnessPenalty));
    const index = (x, y) => y * width + x;
    let changed = 0;
    for (let start = 0; start < grid.length; start += 1) {
      if (visited[start]) continue;
      const target = cellCode(grid[start]);
      const queue = [start];
      const component = [];
      visited[start] = 1;
      for (let head = 0; head < queue.length; head += 1) {
        const current = queue[head];
        component.push(current);
        const x = current % width;
        const y = Math.floor(current / width);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = index(nx, ny);
          if (!visited[next] && cellCode(grid[next]) === target) {
            visited[next] = 1;
            queue.push(next);
          }
        }
      }
      if (component.length > maxSize) continue;
      const averageEdge = component.reduce((sum, cellIndex) => sum + (edgeImportance[cellIndex] || 0), 0) / component.length;
      const protection = options.detailPreservation / 100;
      const outlineProtection = (options.outlineStrength / 100) * 0.12;
      if (averageEdge > 0.52 + protection * 0.28 + outlineProtection) continue;
      const neighbors = new Map();
      for (const current of component) {
        const x = current % width;
        const y = Math.floor(current / width);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || nx >= width || ny < 0 || ny >= height) continue;
          const next = index(nx, ny);
          if (component.includes(next)) continue;
          const neighbor = grid[next];
          const code = cellCode(neighbor);
          if (!code || code === target) continue;
          neighbors.set(code, (neighbors.get(code) || 0) + 1);
        }
      }
      let replacementCode = "";
      let replacementCount = 0;
      for (const [code, count] of neighbors) {
        if (count > replacementCount) {
          replacementCode = code;
          replacementCount = count;
        }
      }
      if (!replacementCode) continue;
      const replacement = [...grid].find((cell) => cellCode(cell) === replacementCode);
      if (!replacement) continue;
      for (const current of component) {
        grid[current] = cloneCell(replacement);
        changed += 1;
      }
    }
    return changed;
  }

  function applyToResult(result, palette, rawOptions = {}) {
    if (!result || !Array.isArray(result.grid)) return result;
    const width = Number(result.width) || 0;
    const height = Number(result.height) || 0;
    const options = resolveOptions(rawOptions, width, height);
    if (!options.enabled) return result;
    const grid = result.grid.map(cloneCell);
    const edgeImportance = buildEdgeImportance(grid, width, height);
    const shadowChanges = compressLowContrastShadows(grid, width, height, palette, options, edgeImportance);
    const skinChanges = adjustSkinTone(grid, width, height, palette, options);
    const cleanupChanges = cleanupSmallRegions(grid, width, height, options, edgeImportance);
    const summary = `规则V1 ${options.preset} · 阴影调整${shadowChanges}格 · 肤色调整${skinChanges}格 · 净化${cleanupChanges}格`;
    return { ...result, grid, summary };
  }

  return { PRESETS, clamp, getSizeProfile, resolveOptions, buildEdgeImportance, applyToResult };
});
