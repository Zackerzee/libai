import { constructionSheetLayout, drawConstructionSheetHeader, drawConstructionSheetRulers, constructionCodeInk } from './construction-sheet-layout.js';

const rgb = value => value.startsWith('rgb(') ? value.match(/[\d.]+/g).map(Number) : value.length===4 ? [...value.slice(1)].map(c=>parseInt(c+c,16)) : [1,3,5].map(i=>parseInt(value.slice(i,i+2),16));

export function pdfConstructionCellSize(grid, options={}, limit=14000) {
  let size=options.cellSize||24;
  for(let attempt=0;attempt<3;attempt++){
    const layout=constructionSheetLayout(grid,size,options),extent=Math.max(layout.width,layout.height);
    if(extent<=limit)return size;
    size*= (limit-1)/extent;
  }
  return size;
}

export function drawPdfConstructionSheet(doc, grid, options={}, cjkFont='SourceHanSansSC') {
  const s=options.cellSize||24,layout=constructionSheetLayout(grid,s,options);
  const ctx={fillStyle:'#fff',font:'600 12px sans-serif',textAlign:'left',
    fillRect(x,y,w,h){doc.setFillColor(...rgb(this.fillStyle));doc.rect(x,y,w,h,'F');},
    fillText(value,x,y,maxWidth){
      const [,weight,size]=this.font.match(/^(\d+) (\d+)px/),cjk=/[^\x20-\x7e]/.test(value);
      doc.setFont(cjk?cjkFont:'helvetica',!cjk&&Number(weight)>=600?'bold':'normal');doc.setFontSize(Number(size));doc.setTextColor(...rgb(this.fillStyle));
      const width=doc.getTextWidth(value);if(maxWidth&&width>maxWidth)doc.setFontSize(Number(size)*maxWidth/width);
      doc.text(String(value),x,y,{align:this.textAlign,baseline:'middle'});
    }
  };
  ctx.fillRect(0,0,layout.width,layout.height);
  drawConstructionSheetHeader(ctx,grid,layout,options);
  for(let y=0;y<grid.length;y++)for(let x=0;x<grid[y].length;x++){
    const c=grid[y][x],px=layout.gridX+x*s,py=layout.gridY+y*s;
    doc.setFillColor(...(c?.rgb||[255,255,255]));doc.rect(px,py,s,s,'F');
    if(options.showCodes!==false&&c?.code){doc.setFont('helvetica','bold');let size=s*.36;doc.setFontSize(size);const width=doc.getTextWidth(String(c.code));if(width>s*.86)doc.setFontSize(size*s*.86/width);doc.setTextColor(...rgb(constructionCodeInk(c.rgb)));doc.text(String(c.code),px+s/2,py+s/2,{align:'center',baseline:'middle'});}
  }
  if(options.showGrid!==false){
    const step=Math.max(3,Math.round(Number(options.majorGridInterval)||5));
    for(let x=0;x<=(grid[0]?.length||0);x++){const major=options.showMajorGrid!==false&&x%step===0;doc.setDrawColor(major?145:185);doc.setLineWidth(major?s/48:s/96);doc.line(layout.gridX+x*s,layout.gridY,layout.gridX+x*s,layout.gridY+grid.length*s);}
    for(let y=0;y<=grid.length;y++){const major=options.showMajorGrid!==false&&y%step===0;doc.setDrawColor(major?145:185);doc.setLineWidth(major?s/48:s/96);doc.line(layout.gridX,layout.gridY+y*s,layout.gridX+(grid[0]?.length||0)*s,layout.gridY+y*s);}
  }
  drawConstructionSheetRulers(ctx,grid,layout,options.majorGridInterval,options);
  return layout;
}
