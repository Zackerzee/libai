import { selectionCells } from './selection-service.js';

// Select only swept cells, without closing the path or filling its interior.
// Clip before rasterizing to bound captured-pointer excursions outside the grid.
export function lassoSelection(points, width, height, previous = null) {
  const mask = previous?.mask ? new Set(previous.mask) : new Set(selectionCells(previous,width,height).map(({x,y})=>`${x},${y}`));
  const add=(x,y)=>{if(x>=0&&y>=0&&x<width&&y<height)mask.add(`${x},${y}`);};
  const valid=points.filter(p=>Number.isFinite(p.x)&&Number.isFinite(p.y));
  for(let i=0;i<valid.length;i++){
    const a=valid[Math.max(0,i-1)],b=valid[i],dx=b.x-a.x,dy=b.y-a.y;
    let enter=0,exit=1,visible=true;
    for(const [p,q]of [[-dx,a.x],[dx,width-a.x],[-dy,a.y],[dy,height-a.y]]){
      if(p===0){if(q<0)visible=false;continue;}
      const t=q/p;
      if(p<0)enter=Math.max(enter,t);else exit=Math.min(exit,t);
    }
    if(!visible||enter>exit||width<1||height<1)continue;
    const start={x:a.x+enter*dx,y:a.y+enter*dy},end={x:a.x+exit*dx,y:a.y+exit*dy};
    const cuts=[enter,exit];
    if(dx)for(let x=Math.ceil(Math.min(start.x,end.x));x<Math.max(start.x,end.x);x++){const t=(x-a.x)/dx;if(t>enter&&t<exit)cuts.push(t);}
    if(dy)for(let y=Math.ceil(Math.min(start.y,end.y));y<Math.max(start.y,end.y);y++){const t=(y-a.y)/dy;if(t>enter&&t<exit)cuts.push(t);}
    cuts.sort((x,y)=>x-y);
    for(let j=0;j+1<cuts.length;j++){if(cuts[j+1]-cuts[j]<=1e-10)continue;const t=(cuts[j]+cuts[j+1])/2;add(Math.floor(a.x+t*dx),Math.floor(a.y+t*dy));}
    add(Math.floor(b.x),Math.floor(b.y));
  }
  if(!mask.size)return null;
  let x0=width,y0=height,x1=-1,y1=-1;
  for(const key of mask){const [x,y]=key.split(',').map(Number);x0=Math.min(x0,x);y0=Math.min(y0,y);x1=Math.max(x1,x);y1=Math.max(y1,y);}
  return {kind:'lasso',x0,y0,x1,y1,mask};
}
