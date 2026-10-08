export const defaultGuides = () => ({ visible: false, color: "#e09b42", opacity: 65, thickness: 2, boardSize: 52, horizontal: [], vertical: [] });
export function boardGuidePositions(width, height, size) {
  const step = Math.max(1,Math.round(Number(size)||52)), vertical=[],horizontal=[];
  for(let x=step;x<width;x+=step)vertical.push(x);
  for(let y=step;y<height;y+=step)horizontal.push(y);
  return {vertical,horizontal};
}
export function addGuide(guides, axis, position, width, height) {
  if (!["horizontal","vertical"].includes(axis)) return guides;
  const max=axis==="horizontal"?height:width, next=Math.max(0,Math.min(max,Math.round(position)));
  return {...guides,[axis]:[...guides[axis].filter((value)=>value!==next),next].sort((a,b)=>a-b)};
}
export function moveGuide(guides, axis, from, to, width, height) {
  return addGuide({...guides,[axis]:guides[axis].filter((value)=>value!==from)},axis,to,width,height);
}
export function removeGuide(guides, axis, position) {
  if (!["horizontal","vertical"].includes(axis))return guides;
  return {...guides,[axis]:guides[axis].filter((value)=>value!==position)};
}
