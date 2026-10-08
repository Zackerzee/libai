// Background-only crop: find the largest occupied, non-white rectangle that
// can contain the poster aspect. Never change the foreground or project grid.
export function posterBackgroundCrop(grid, aspect=3/4) {
  const columns=grid[0]?.length||0,heights=Array(columns).fill(0);let best=null;
  for(let y=0;y<grid.length;y++){
    for(let x=0;x<columns;x++){const rgb=grid[y][x]?.rgb;heights[x]=rgb&&!(Math.min(...rgb)>=235&&Math.max(...rgb)-Math.min(...rgb)<=18)?heights[x]+1:0;}
    const stack=[];
    for(let x=0;x<=columns;x++){
      const h=x===columns?0:heights[x];let start=x;
      while(stack.length&&stack.at(-1).h>h){const item=stack.pop(),width=x-item.start,height=item.h;start=item.start;
        const fitWidth=Math.min(width,height*aspect),fitHeight=fitWidth/aspect,area=fitWidth*fitHeight;
        if(area>0&&(!best||area>best.area))best={x:item.start+(width-fitWidth)/2,y:y+1-height+(height-fitHeight)/2,width:fitWidth,height:fitHeight,area};
      }
      if(h>0&&(!stack.length||stack.at(-1).h<h))stack.push({start,h});
    }
  }
  return best;
}

export function drawPostageBacking(ctx,box) {
  const pad=Math.max(10,box.width*.025),tooth=Math.max(6,pad*.55),x=box.x-pad,y=box.y-pad,w=box.width+pad*2,h=box.height+pad*2;
  ctx.save();ctx.fillStyle='#fffbe9';ctx.shadowColor='#00000020';ctx.shadowBlur=18;ctx.fillRect(x,y,w,h);ctx.shadowBlur=0;
  for(let offset=0;offset<w;offset+=tooth*2){const span=Math.min(tooth,w-offset);ctx.fillRect(x+offset,y-tooth,span,tooth);ctx.fillRect(x+offset,y+h,span,tooth);}
  for(let offset=0;offset<h;offset+=tooth*2){const span=Math.min(tooth,h-offset);ctx.fillRect(x-tooth,y+offset,tooth,span);ctx.fillRect(x+w,y+offset,tooth,span);}
  ctx.restore();
}
