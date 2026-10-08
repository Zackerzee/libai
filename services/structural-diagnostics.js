import { rgbToLab, deltaE2000 } from "../smart-preprocessing/palette-engine.mjs";
import { paletteIdOf } from "./palette-identity.js";

const FOUR = [[1,0],[-1,0],[0,1],[0,-1]];
const EIGHT = [...FOUR,[1,1],[1,-1],[-1,1],[-1,-1]];
const key = (x, y) => `${x},${y}`;
const directions = (connectivity) => connectivity === 8 ? EIGHT : FOUR;

export function buildColorComponents(grid = [], { connectivity = 4 } = {}) {
  const height = grid.length, width = Math.max(0, ...grid.map((row) => row?.length || 0));
  const visited = new Set(), cellToComponent = new Map(), components = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < (grid[y]?.length || 0); x++) {
    const paletteId = paletteIdOf(grid[y][x]);
    if (!paletteId || visited.has(key(x,y))) continue;
    const cells = [], queue = [{ x, y }]; visited.add(key(x,y));
    while (queue.length) {
      const cell = queue.pop(); cells.push(cell);
      for (const [dx,dy] of directions(connectivity)) {
        const nx = cell.x + dx, ny = cell.y + dy, cellKey = key(nx,ny);
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || visited.has(cellKey)) continue;
        if (paletteIdOf(grid[ny]?.[nx]) !== paletteId) continue;
        visited.add(cellKey); queue.push({ x: nx, y: ny });
      }
    }
    const bounds = cells.reduce((box, cell) => ({ x0: Math.min(box.x0,cell.x), y0: Math.min(box.y0,cell.y), x1: Math.max(box.x1,cell.x), y1: Math.max(box.y1,cell.y) }), { x0:Infinity,y0:Infinity,x1:-Infinity,y1:-Infinity });
    const component = { id: components.length, paletteId, cells, size: cells.length, bounds };
    components.push(component); cells.forEach((cell) => cellToComponent.set(key(cell.x,cell.y), component.id));
  }
  return { components, cellToComponent, width, height, connectivity };
}

export function neighborProfile(grid, x, y) {
  const current = paletteIdOf(grid[y]?.[x]);
  const counts = new Map(); let sameNeighborCount = 0, neighborCount = 0;
  for (const [dx,dy] of EIGHT) {
    const paletteId = paletteIdOf(grid[y + dy]?.[x + dx]);
    if (!paletteId) continue;
    neighborCount += 1;
    if (paletteId === current) sameNeighborCount += 1;
    else counts.set(paletteId, (counts.get(paletteId) || 0) + 1);
  }
  const dominant = [...counts].sort((a,b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || [null,0];
  return { sameNeighborCount, neighborCount, dominantNeighborPaletteId: dominant[0], dominantNeighborCount: dominant[1], dominantNeighborRatio: neighborCount ? dominant[1] / neighborCount : 0 };
}

export function detectIsolatedPixels(grid, componentIndex = buildColorComponents(grid), options = {}) {
  const { maxSameNeighbors = 0, minDominantNeighbors = 6, minDominantRatio = .85, maxComponentSize = 1 } = options;
  const issues = [];
  for (let y = 0; y < grid.length; y++) for (let x = 0; x < (grid[y]?.length || 0); x++) {
    const paletteId = paletteIdOf(grid[y][x]); if (!paletteId) continue;
    const profile = neighborProfile(grid,x,y);
    const component = componentIndex.components[componentIndex.cellToComponent.get(key(x,y))];
    if (profile.sameNeighborCount > maxSameNeighbors || profile.dominantNeighborCount < minDominantNeighbors || profile.dominantNeighborRatio < minDominantRatio || component?.size > maxComponentSize) continue;
    issues.push({ id:`isolated-pixel:${x}:${y}:${paletteId}`, type:"isolated-pixel", paletteId, cells:[{x,y}], severity:profile.dominantNeighborRatio >= .9 ? "high" : "medium", label:`${grid[y][x].code || paletteId} · 1颗`, meta:{ ...profile, componentSize:component?.size || 1, suggestedPaletteId:profile.dominantNeighborPaletteId } });
  }
  return issues;
}

export function detectTinyRegions(grid, componentIndex = buildColorComponents(grid), { maxSize = 3 } = {}) {
  return componentIndex.components.filter((component) => component.size <= maxSize).map((component) => {
    const color = grid[component.cells[0].y]?.[component.cells[0].x];
    return { id:`tiny-region:${component.id}:${component.paletteId}`, type:"tiny-region", paletteId:component.paletteId, cells:component.cells.map((cell)=>({...cell})), severity:component.size === 1 ? "high" : component.size <= 3 ? "medium" : "low", label:`${color?.code || component.paletteId} · ${component.size}颗`, meta:{ componentSize:component.size, bounds:{...component.bounds} } };
  });
}

const paletteDistance = (paletteById, a, b) => {
  const first = paletteById.get(a), second = paletteById.get(b);
  return first?.rgb && second?.rgb ? deltaE2000(rgbToLab(first.rgb), rgbToLab(second.rgb)) : null;
};

export function detectEdgeContamination(grid, componentIndex = buildColorComponents(grid), palette = [], options = {}) {
  const { maxComponentSize = 1, minDominantNeighbors = 6, minDominantRatio = .85 } = options;
  const paletteById = new Map(palette.map((color) => [paletteIdOf(color), color]));
  const issues = [];
  for (const component of componentIndex.components) {
    if (component.size > maxComponentSize) continue;
    const surrounding = new Map(); let total = 0, sameNeighborCount = 0;
    for (const cell of component.cells) for (const [dx,dy] of EIGHT) {
      const nx=cell.x+dx, ny=cell.y+dy, neighborId=paletteIdOf(grid[ny]?.[nx]);
      if (!neighborId) continue;
      if (neighborId === component.paletteId) { sameNeighborCount += 1; continue; }
      total += 1; surrounding.set(neighborId,(surrounding.get(neighborId)||0)+1);
    }
    const [dominantNeighborPaletteId, dominantNeighborCount] = [...surrounding].sort((a,b)=>b[1]-a[1]||a[0].localeCompare(b[0]))[0] || [null,0];
    const dominantNeighborRatio = total ? dominantNeighborCount / total : 0;
    if (sameNeighborCount > 0 || !dominantNeighborPaletteId || dominantNeighborCount < minDominantNeighbors || dominantNeighborRatio < minDominantRatio) continue;
    const distance = paletteDistance(paletteById, component.paletteId, dominantNeighborPaletteId);
    const smallComponentScore = 1 - (component.size - 1) / Math.max(1,maxComponentSize);
    const dominantNeighborScore = dominantNeighborRatio;
    const boundaryScore = Math.min(1, dominantNeighborCount / 6);
    const paletteAnomalyScore = distance == null ? .25 : Math.min(1, distance / 30);
    const score = smallComponentScore + dominantNeighborScore + boundaryScore + paletteAnomalyScore;
    const severity = score >= 3 ? "high" : score >= 2.25 ? "medium" : "low";
    const color = grid[component.cells[0].y]?.[component.cells[0].x];
    issues.push({ id:`edge-contamination:${component.id}:${component.paletteId}`, type:"edge-contamination", paletteId:component.paletteId, cells:component.cells.map((cell)=>({...cell})), severity, label:`${color?.code || component.paletteId} · ${component.size}颗`, meta:{ componentSize:component.size, sameNeighborCount, dominantNeighborPaletteId, dominantNeighborCount, dominantNeighborRatio, colorDistance:distance, score, suggestedPaletteId:dominantNeighborPaletteId } });
  }
  return issues.sort((a,b) => b.meta.score - a.meta.score || a.id.localeCompare(b.id));
}

export function buildStructuralDiagnostics(grid, palette = [], options = {}) {
  const components = buildColorComponents(grid,{connectivity:options.connectivity || 4});
  return { components, isolated:detectIsolatedPixels(grid,components,options.isolated), tiny:detectTinyRegions(grid,components,{maxSize:options.tinyMaxSize ?? 3}), edge:detectEdgeContamination(grid,components,palette,options.edge) };
}
