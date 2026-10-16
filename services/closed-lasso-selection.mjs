import { fitSelectionBox } from './shapes-service.js';

// Coordinates are fractional grid coordinates. A cell is selected by its center;
// centers exactly on an edge are included. Self intersections use even-odd fill.
export function closedLassoSelection(points, width, height) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) return null;
  const path = (points || []).filter(p => p && Number.isFinite(p.x) && Number.isFinite(p.y));
  if (new Set(path.map(p => `${p.x},${p.y}`)).size < 3) return null;
  let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
  for(const p of path){minX=Math.min(minX,p.x);minY=Math.min(minY,p.y);maxX=Math.max(maxX,p.x);maxY=Math.max(maxY,p.y);}
  const x0 = Math.max(0, Math.ceil(minX - .5));
  const y0 = Math.max(0, Math.ceil(minY - .5));
  const x1 = Math.min(width - 1, Math.floor(maxX - .5));
  const y1 = Math.min(height - 1, Math.floor(maxY - .5));
  const cells = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const px = x + .5, py = y + .5;
    let inside = false, boundary = false;
    for (let i = 0, j = path.length - 1; i < path.length; j = i++) {
      const a = path[j], b = path[i];
      const cross = (px - a.x) * (b.y - a.y) - (py - a.y) * (b.x - a.x);
      if (Math.abs(cross) <= 1e-10 && px >= Math.min(a.x,b.x) && px <= Math.max(a.x,b.x) && py >= Math.min(a.y,b.y) && py <= Math.max(a.y,b.y)) boundary = true;
      if ((a.y > py) !== (b.y > py) && px < a.x + (py - a.y) * (b.x - a.x) / (b.y - a.y)) inside = !inside;
    }
    if (inside || boundary) cells.push({x,y});
  }
  return fitSelectionBox(cells, 'closed-lasso');
}
