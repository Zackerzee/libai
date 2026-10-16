import { codeTextColor } from './pattern-export-renderer.js';
import { constructionSheetLayout, drawConstructionSheetHeader, drawConstructionSheetRulers, constructionCodeInk } from './construction-sheet-layout.js?v=20261007-all-export-r16';

export const PNG_PATTERN_QUALITY = Object.freeze({standard:24,hd:48,ultra:64});

const physicalCellSize = value => {
  const size = Number(value ?? PNG_PATTERN_QUALITY.hd);
  if (!Number.isSafeInteger(size) || size < 1) throw new RangeError('PNG 单格像素必须是正整数');
  return size;
};

export function pngPatternPixelSize(grid, cellSize = PNG_PATTERN_QUALITY.hd, options = {}) {
  const size = physicalCellSize(cellSize);
  if(options.constructionSheet){const layout=constructionSheetLayout(grid,size,options);return {width:layout.width,height:layout.height,cellSize:size};}
  const margin=options.showCoordinates?size:0;
  return {width:(grid[0]?.length || 0)*size+margin*2,height:grid.length*size+margin*2,cellSize:size};
}

function codeFontSize(ctx, code, cellSize, lineWidth) {
  const availableWidth = cellSize - lineWidth*2 - 4;
  let size = Math.max(1,Math.floor(cellSize*.36));
  while (size>1) {
    ctx.font=`600 ${size}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    if(ctx.measureText(code).width<=availableWidth)break;
    size--;
  }
  return size;
}

// PNG renders canonical cells directly at final physical pixels. It deliberately
// has no screen-canvas snapshot, DPR transform, resampling, or print metadata.
export function renderPngPatternCanvas(grid, options = {}) {
  const size=pngPatternPixelSize(grid,options.cellSize ?? PNG_PATTERN_QUALITY[options.quality || 'hd'] ?? PNG_PATTERN_QUALITY.hd,options);
  const canvas=(options.document || document).createElement('canvas');
  canvas.width=size.width;canvas.height=size.height;
  const ctx=canvas.getContext('2d');
  if(!ctx)throw new Error('无法创建 PNG 绘图画布');
  const cellSize=size.cellSize,sheet=options.constructionSheet?constructionSheetLayout(grid,cellSize,options):null,margin=options.showCoordinates?cellSize:0,gridWidth=(grid[0]?.length||0)*cellSize,gridHeight=grid.length*cellSize,showGrid=options.showGrid!==false,showCodes=options.showCodes!==false;
  const ox=sheet?sheet.gridX:margin,oy=sheet?sheet.gridY:margin;
  if(margin||sheet){ctx.fillStyle='#fff';ctx.fillRect(0,0,size.width,size.height);}
  if(sheet)drawConstructionSheetHeader(ctx,grid,sheet,options);
  const lineWidth=showGrid?(sheet?Math.max(1,Math.round(cellSize/48)):Math.max(1,Math.floor(cellSize/24))):0;
  for(let y=0;y<grid.length;y++)for(let x=0;x<(grid[y]?.length || 0);x++){
    const cell=grid[y][x];
    ctx.fillStyle=cell?`rgb(${(cell.rgb || [255,255,255]).join(',')})`:'#fff';
    ctx.fillRect(ox+x*cellSize,oy+y*cellSize,cellSize,cellSize);
  }
  if(showGrid){
    ctx.fillStyle='#23232355';
    // Integer bands stay wholly inside the image, unlike centered odd strokes.
    for(let x=0;x<=gridWidth;x+=cellSize)ctx.fillRect(ox+Math.min(x,Math.max(0,gridWidth-lineWidth)),oy,lineWidth,gridHeight);
    for(let y=0;y<=gridHeight;y+=cellSize)ctx.fillRect(ox,oy+Math.min(y,Math.max(0,gridHeight-lineWidth)),gridWidth,lineWidth);
    if(sheet&&options.showMajorGrid!==false){const step=Math.max(3,Math.round(Number(options.majorGridInterval)||5)),width=Math.max(1,Math.round(cellSize/24));ctx.fillStyle='#55555580';for(let x=step*cellSize;x<gridWidth;x+=step*cellSize)ctx.fillRect(ox+x,oy,width,gridHeight);for(let y=step*cellSize;y<gridHeight;y+=step*cellSize)ctx.fillRect(ox,oy+y,gridWidth,width);}
  }
  if(showCodes){
    ctx.textAlign='center';ctx.textBaseline='middle';
    for(let y=0;y<grid.length;y++)for(let x=0;x<(grid[y]?.length || 0);x++){
      const cell=grid[y][x];if(!cell?.code)continue;
      const code=String(cell.code),fontSize=codeFontSize(ctx,code,cellSize,lineWidth);
      ctx.font=`600 ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
      ctx.fillStyle=(sheet?constructionCodeInk:codeTextColor)(cell.rgb || [255,255,255]);
      ctx.fillText(code,ox+x*cellSize+Math.floor(cellSize/2),oy+y*cellSize+Math.floor(cellSize/2));
    }
  }
  if(sheet)drawConstructionSheetRulers(ctx,grid,sheet,options.majorGridInterval,options);
  else if(margin){ctx.fillStyle='#555';ctx.font=`500 ${Math.floor(cellSize*.28)}px ui-monospace, monospace`;ctx.textAlign='center';ctx.textBaseline='middle';const stride=Math.max(1,Math.ceil(24/cellSize));for(let x=0;x<(grid[0]?.length||0);x+=stride){ctx.fillText(String(x+1),margin+x*cellSize+Math.floor(cellSize/2),Math.floor(margin/2));ctx.fillText(String(x+1),margin+x*cellSize+Math.floor(cellSize/2),size.height-Math.floor(margin/2));}for(let y=0;y<grid.length;y+=stride){ctx.fillText(String(y+1),Math.floor(margin/2),margin+y*cellSize+Math.floor(cellSize/2));ctx.fillText(String(y+1),size.width-Math.floor(margin/2),margin+y*cellSize+Math.floor(cellSize/2));}}
  return canvas;
}
