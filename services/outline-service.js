const key = (x, y) => `${x},${y}`;
const FOUR = [[1,0],[-1,0],[0,1],[0,-1]];
const EIGHT = [...FOUR,[1,1],[1,-1],[-1,1],[-1,-1]];
const ordered = (cells) => [...cells].sort((a,b)=>a.y-b.y||a.x-b.x);

export function computeExternalEmpty(sourceCells, width, height) {
  const source = new Set(sourceCells.map(({x,y})=>key(x,y))), external = new Set(), queue=[];
  const push=(x,y)=>{const id=key(x,y);if(x<0||y<0||x>=width||y>=height||source.has(id)||external.has(id))return;external.add(id);queue.push({x,y});};
  for(let x=0;x<width;x++){push(x,0);push(x,height-1);} for(let y=0;y<height;y++){push(0,y);push(width-1,y);}
  for(let i=0;i<queue.length;i++) for(const [dx,dy] of FOUR) push(queue[i].x+dx,queue[i].y+dy);
  return external;
}

export function computeOuterOutline(sourceCells, grid, { thickness=1, connectivity=4, includeHoles=false, overwrite=false }={}) {
  const height=grid.length,width=grid[0]?.length||0,source=new Set(sourceCells.map(({x,y})=>key(x,y)));
  // All occupied colors form the silhouette: a hole remains internal even
  // when its boundary contains colors outside the selected component.
  let external=null;
  if(!includeHoles){
    const silhouette=[...sourceCells];
    grid.forEach((row,y)=>row.forEach((color,x)=>{if(color!=null&&!source.has(key(x,y))) silhouette.push({x,y});}));
    external=computeExternalEmpty(silhouette,width,height);
  }
  const offsets=connectivity===8?EIGHT:FOUR;
  let frontier=new Set(source), grown=new Set(source), candidates=new Map();
  for(let layer=0;layer<Math.max(1,Math.min(3,thickness));layer++){
    const next=new Set();
    for(const id of frontier){const [x,y]=id.split(",").map(Number);for(const [dx,dy] of offsets){const nx=x+dx,ny=y+dy,nid=key(nx,ny);if(nx<0||ny<0||nx>=width||ny>=height||grown.has(nid))continue;grown.add(nid);if(grid[ny][nx]!=null){candidates.set(nid,{x:nx,y:ny});if(overwrite)next.add(nid);continue;}if(includeHoles||external.has(nid)){next.add(nid);candidates.set(nid,{x:nx,y:ny});}}}
    frontier=next;
  }
  // 候选位置的归属由 overwrite 决定：
  //   false（默认）—— 已有颜色一律「阻挡」：只报告、不落色，外轮廓绝不覆盖别人。
  //   true        —— 已有颜色也照描（被描边色替换），并且和空格一样继续向外推进，
  //                  于是「厚度」在两种模式下都等于圈数。blockedCells 仍照常记录，
  //                  供 UI 显示「其中覆盖原有 N 颗」。
  // 在作品内部框选一块要描边时，选区四周必然全是别的颜色 —— 这正是需要 overwrite 的场景；
  // 而「整个作品」来源的候选位置只可能是空格，两种取值结果一致。
  const outlineCells=[],blockedCells=[];
  for(const cell of ordered(candidates.values())){
    const occupied=grid[cell.y]?.[cell.x]!=null;
    if(occupied)blockedCells.push(cell);
    if(!occupied||overwrite)outlineCells.push(cell);
  }
  let bounds=null;
  for(const {x,y} of sourceCells){
    if(!bounds) bounds={x0:x,y0:y,x1:x,y1:y};
    else {bounds.x0=Math.min(bounds.x0,x);bounds.y0=Math.min(bounds.y0,y);bounds.x1=Math.max(bounds.x1,x);bounds.y1=Math.max(bounds.y1,y);}
  }
  return {sourceCells:ordered(sourceCells),candidateCells:ordered(candidates.values()),outlineCells,blockedCells,bounds};
}
