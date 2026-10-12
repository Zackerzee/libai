export function referenceLayout(imageWidth,imageHeight,box,{fit="contain",offsetX=0,offsetY=0,scale=1}={}){
  if(!imageWidth||!imageHeight||!box.width||!box.height)return null;
  const base=fit==="cover"?Math.max(box.width/imageWidth,box.height/imageHeight):Math.min(box.width/imageWidth,box.height/imageHeight);
  const s=base*Math.max(.1,Math.min(4,Number(scale)||1)),width=imageWidth*s,height=imageHeight*s;
  return {x:box.x+(box.width-width)/2+offsetX*box.cell,y:box.y+(box.height-height)/2+offsetY*box.cell,width,height};
}

export function moveReference(reference,dxScreen,dyScreen,cellSize){return {...reference,offsetX:(Number(reference.offsetX)||0)+dxScreen/cellSize,offsetY:(Number(reference.offsetY)||0)+dyScreen/cellSize};}

export function referenceBlend(settings, ready) {
  if (!ready || settings?.visible === false || settings?.displayMode === 'grid-only' || !settings?.url) return { reference: 0, artwork: 1 };
  if (settings.displayMode === 'reference-only') return { reference: 1, artwork: 0 };
  const opacity = Math.min(1, Math.max(0, (Number(settings.opacity) || 0) / 100));
  return { reference: opacity, artwork: 1 - opacity };
}
