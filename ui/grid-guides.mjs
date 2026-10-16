export function guideInterval(value) { return Math.max(3,Math.min(50,Math.round(Number(value)||5))); }
export function guideIndices(start,end,interval) {
  const step=guideInterval(interval),out=[];
  for(let n=Math.ceil(start/step)*step;n<=end;n+=step)out.push(n);
  return out;
}
export function rulerEntries(start,end,length,cell,interval) {
  const step=guideInterval(interval),out=[];
  if(cell<4)return out;
  if(cell<10){
    const stride=Math.max(step,Math.ceil(26/(cell*step))*step);
    for(let index=Math.max(0,start);index<Math.min(length,end);index++){
      const number=index+1;
      if(number===1||number%stride===0)out.push({index,number,major:true});
    }
    if(length-1>=start&&length-1<end){
      while(out.length&&length-out.at(-1).number<26/cell)out.pop();
      out.push({index:length-1,number:length,major:true});
    }
    return out;
  }
  for(let index=Math.max(0,start);index<Math.min(length,end);index++){
    const number=index+1,major=number%step===0;
    out.push({index,number,major});
  }
  return out;
}
export function gridGuideInk(color,background=[245,245,248],major=false) {
  const hex=color?.hex||'',rgb=color?.rgb||( /^#[\da-f]{6}$/i.test(hex)?[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)):background);
  const brightness=(rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722)/255;
  return brightness<.48?`rgba(230,235,245,${major?.42:.25})`:`rgba(25,42,57,${major?.28:.12})`;
}
