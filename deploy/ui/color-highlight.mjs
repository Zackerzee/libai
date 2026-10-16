import { paletteIdOf } from '../services/palette-identity.js';

// Outline the silhouette, not internal seams of connected same-color beads.
export function highlightedColorEdges(grid, identity, {x0=0,y0=0,x1=grid[0]?.length||0,y1=grid.length}={}) {
  if(!identity)return [];
  const edges=[],matches=(x,y)=>paletteIdOf(grid[y]?.[x])===identity;
  for(let y=y0;y<y1;y++)for(let x=x0;x<x1;x++)if(matches(x,y)){
    if(!matches(x,y-1))edges.push([x,y,x+1,y]);
    if(!matches(x+1,y))edges.push([x+1,y,x+1,y+1]);
    if(!matches(x,y+1))edges.push([x+1,y+1,x,y+1]);
    if(!matches(x-1,y))edges.push([x,y+1,x,y]);
  }
  return edges;
}
