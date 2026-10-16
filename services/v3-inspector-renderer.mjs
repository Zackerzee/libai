import {rgbToLab,deltaE2000} from '../smart-preprocessing/palette-engine.mjs';
export function sampledGrid(colors){return colors.map(row=>row.map(c=>c?{rgb:[c.r,c.g,c.b]}:null));}
export function renderInspectorGrid(canvas,grid,{cellSize=8,construction=false}={}){
  const margin=construction?24:0,w=grid[0]?.length||0,h=grid.length;
  canvas.width=w*cellSize+margin*2;canvas.height=h*cellSize+margin*2;
  const ctx=canvas.getContext('2d');
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=grid[y][x];if(!c)continue;ctx.fillStyle=`rgb(${c.rgb.join(',')})`;ctx.fillRect(margin+x*cellSize,margin+y*cellSize,cellSize,cellSize);}
  if(construction){ctx.fillStyle='#30303066';for(let x=0;x<=w;x++)ctx.fillRect(margin+Math.min(x*cellSize,w*cellSize-1),margin,1,h*cellSize);for(let y=0;y<=h;y++)ctx.fillRect(margin,margin+Math.min(y*cellSize,h*cellSize-1),w*cellSize,1);ctx.font=`${Math.max(4,Math.floor(cellSize*.27))}px sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';for(let y=0;y<h;y++)for(let x=0;x<w;x++){const c=grid[y][x];if(c){ctx.fillStyle=rgbToLab(c.rgb)[0]<50?'#fff':'#111';ctx.fillText(c.code||'',margin+(x+.5)*cellSize,margin+(y+.5)*cellSize);}}ctx.fillStyle='#8291a8';ctx.font='10px sans-serif';for(let x=4;x<w;x+=5)ctx.fillText(String(x+1),margin+(x+.5)*cellSize,12);for(let y=4;y<h;y+=5)ctx.fillText(String(y+1),12,margin+(y+.5)*cellSize);}
  return{grid,margin,cellSize};
}
export function inspectorCellDetail(source,stages,diagnostics,x,y){
  const grid=stages.S6.grid,w=grid[0].length,h=grid.length,sourceImage=stages.S1.source||source,sx=Math.min(sourceImage.width-1,Math.floor((x+.5)*sourceImage.width/w)),sy=Math.min(sourceImage.height-1,Math.floor((y+.5)*sourceImage.height/h)),offset=(sy*sourceImage.width+sx)*4;
  const sourceRgb=[...sourceImage.data.slice(offset,offset+3)],sample=stages.S2.colors[y][x],sampleRgb=sample?[sample.r,sample.g,sample.b]:null,base=sampleRgb?rgbToLab(sampleRgb):null;
  const describe=(rgb,code=null)=>rgb?{rgb,Lab:rgbToLab(rgb),code,deltaEFromSample:base?deltaE2000(base,rgbToLab(rgb)):null}:null;
  const result={x,y,sourceCenter:describe(sourceRgb),sample:describe(sampleRgb),fullPalette:describe(stages.S3.grid[y][x]?.rgb,stages.S3.grid[y][x]?.code),budget:describe(stages.S4.grid[y][x]?.rgb,stages.S4.grid[y][x]?.code),final:describe(grid[y][x]?.rgb,grid[y][x]?.code),scores:{}};
  const i=y*w+x;for(const key of ['edgeMap','protectionMap','highlightMap','darkDetailMap','tierMap','protectionReasonMap','samplingConfidenceMap'])if(diagnostics[key])result.scores[key]=diagnostics[key][i];
  result.cleanupRecord=diagnostics.cleanupRecords?.find(c=>c.x===x&&c.y===y)||null;
  return result;
}
