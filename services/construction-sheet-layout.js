import { relativeLuminance, usageFromGrid } from './pattern-export-renderer.js';
export const constructionCodeInk = rgb => relativeLuminance(rgb)>.179?'#000000':'#ffffff';

export function constructionSheetLayout(grid, cellSize, options = {}) {
  const columns=grid[0]?.length||0, rows=grid.length, usage=usageFromGrid(grid);
  const padding=cellSize, ruler=options.showCoordinates===false?0:cellSize;
  const width=Math.max(20*cellSize,columns*cellSize+ruler*2+padding*2);
  const legendColumns=Math.max(1,Math.floor((width-padding*3)/(cellSize*5)));
  const legendRows=Math.ceil(usage.length/legendColumns);
  const headerHeight=Math.ceil(cellSize*(5+legendRows*1.35));
  const gridX=Math.floor((width-columns*cellSize)/2),gridY=headerHeight+ruler;
  return {width,height:gridY+rows*cellSize+ruler+padding,cellSize,padding,ruler,headerHeight,gridX,gridY,legendColumns,usage};
}

export function drawConstructionSheetHeader(ctx, grid, layout, options = {}) {
  const s=layout.cellSize,p=layout.padding,w=layout.width;
  const text=(value,x,y,size=s*.4,weight=600,color='#222',align='left',maxWidth)=>{
    ctx.font=`${weight} ${Math.round(size)}px system-ui, "PingFang SC", sans-serif`;ctx.fillStyle=color;ctx.textAlign=align;ctx.textBaseline='middle';
    if(maxWidth)ctx.fillText(String(value),x,y,maxWidth);else ctx.fillText(String(value),x,y);
  };
  text(options.title||'未命名作品',p,s*1.15,s*.9,700,'#171717','left',w-p*4);
  // Original four-ring brand mark, drawn directly at final export resolution.
  const colors=['#ef1d24','#f5b700','#2cad4f','#0968ee'],r=s*.36,cx=w-p-s*.4,cy=s*.75;
  for(let i=0;i<4;i++){
    const x=cx+(i%2)*s*.76-s*.76,y=cy+Math.floor(i/2)*s*.76;
    ctx.fillStyle=colors[i];
    // Integer pixel annuli avoid an external image dependency or resampling.
    for(let dy=-Math.ceil(r);dy<=r;dy++)for(let dx=-Math.ceil(r);dx<=r;dx++){
      const d=dx*dx+dy*dy;if(d<=r*r&&d>=r*r*.18)ctx.fillRect(Math.round(x+dx),Math.round(y+dy),1,1);
    }
  }
  const top=s*2.2,bottom=layout.headerHeight-s*.6,line=Math.max(1,Math.round(s/48));
  ctx.fillStyle='#6c6c6c';ctx.fillRect(p,top,w-p*2,line);ctx.fillRect(p,bottom,w-p*2,line);ctx.fillRect(p,top,line,bottom-top);ctx.fillRect(w-p-line,top,line,bottom-top);
  const values=[`${options.artworkColumns??grid[0]?.length??0}×${options.artworkRows??grid.length}`,layout.usage.reduce((sum,c)=>sum+c.count,0),layout.usage.length,options.paletteLabel||'—',String(options.pageCount||1)];
  const labels=['作品尺寸','拼豆数量','颜色数量','豆色品牌','图纸页数'];
  values.forEach((value,i)=>{const x=p+(w-p*2)*(i+.5)/5;text(value,x,top+s*.65,s*.55,700,'#222','center',(w-p*2)/5-s*.2);text(labels[i],x,top+s*1.18,s*.27,500,'#777','center');});
  layout.usage.forEach((item,i)=>{
    const x=p+s*.45+(i%layout.legendColumns)*s*5,y=top+s*1.75+Math.floor(i/layout.legendColumns)*s*1.35;
    ctx.fillStyle=`rgb(${item.rgb.join(',')})`;ctx.fillRect(Math.round(x),Math.round(y),s*.9,s*.9);
    text(item.code,x+s*.45,y+s*.45,s*.28,700,constructionCodeInk(item.rgb),'center',s*.82);
    text(`×${item.count}`,x+s*1.15,y+s*.45,s*.36,600);
  });
}

export function drawConstructionSheetRulers(ctx, grid, layout, interval = 5, offsets = {}) {
  if(!layout.ruler)return;
  const {cellSize:s,gridX:x,gridY:y}=layout,columns=grid[0]?.length||0,rows=grid.length;
  const step=Math.max(3,Math.round(Number(interval)||5));
  const cell=(number,left,top)=>{
    const major=number%step===0;ctx.fillStyle=major?'#ececec':'#fff';ctx.fillRect(left,top,s,s);
    ctx.fillStyle='#d0d0d0';ctx.fillRect(left,top,s,1);ctx.fillRect(left,top,1,s);ctx.fillRect(left+s-1,top,1,s);ctx.fillRect(left,top+s-1,s,1);
    ctx.fillStyle='#222';ctx.font=`${major?700:500} ${Math.round(s*(major?.57:.38))}px system-ui, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText(String(number),left+s/2,top+s/2,s*.9);
  };
  for(let col=0;col<columns;col++){cell(col+1+(offsets.coordinateX||0),x+col*s,y-s);cell(col+1+(offsets.coordinateX||0),x+col*s,y+rows*s);}
  for(let row=0;row<rows;row++){cell(row+1+(offsets.coordinateY||0),x-s,y+row*s);cell(row+1+(offsets.coordinateY||0),x+columns*s,y+row*s);}
}
