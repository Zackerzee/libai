export function guideInterval(value) { return Math.max(3,Math.min(50,Math.round(Number(value)||5))); }
export function guideIndices(start,end,interval) {
  const step=guideInterval(interval),out=[];
  for(let n=Math.ceil(start/step)*step;n<=end;n+=step)out.push(n);
  return out;
}
export function rulerEntries(start,end,length,cell,interval) {
  const step=guideInterval(interval),out=[];
  for(let index=Math.max(0,start);index<Math.min(length,end);index++){
    const number=index+1,major=number%step===0;
    if(cell>=18||major||number===1||number===length)out.push({index,number,major});
  }
  return out;
}
