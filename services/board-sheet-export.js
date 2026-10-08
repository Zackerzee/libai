import {renderPngPatternCanvas} from './png-pattern-export-renderer.js';
import {constructionSheetLayout} from './construction-sheet-layout.js';

export function renderBoardOverview(grid,split,options={}) {
  const cellSize=Math.max(6,Math.floor(1600/Math.max(split.width,split.height)));
  const settings={...options,cellSize,constructionSheet:true,showCoordinates:true,showCodes:true,showGrid:true,pageCount:split.total};
  const canvas=renderPngPatternCanvas(grid,settings),layout=constructionSheetLayout(grid,cellSize,settings),ctx=canvas.getContext('2d');
  ctx.strokeStyle='#e34f6f';ctx.lineWidth=Math.max(1,cellSize*.12);
  for(const tile of split.tiles)ctx.strokeRect(layout.gridX+tile.x*cellSize,layout.gridY+tile.y*cellSize,tile.width*cellSize,tile.height*cellSize);
  return canvas;
}

export function renderBoardSheet(tile,split,options={}) {
  return renderPngPatternCanvas(tile.cells,{...options,cellSize:48,constructionSheet:true,showCoordinates:true,pageCount:split.total,artworkColumns:split.width,artworkRows:split.height,coordinateX:tile.x,coordinateY:tile.y,
    title:`${options.title||'未命名作品'} · ${tile.number}/${split.total} · R${tile.row} C${tile.column} · X${tile.x+1}–${tile.x+tile.width} Y${tile.y+1}–${tile.y+tile.height}`});
}
