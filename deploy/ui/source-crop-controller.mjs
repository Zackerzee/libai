// Crop handle/move math adapted from Hon-Wong/pindou (MIT), commit
// ad668369; see vendor/pindou/reference/LICENSE. Cancel restores rather than commits.
// One normalized crop model for mouse, pen and touch. The controller owns only
// an in-flight gesture; committed image state remains in sourceTransform.
const clamp = (n, low, high) => Math.max(low, Math.min(high, n));
export const CROP_HANDLES = ['nw','n','ne','e','se','s','sw','w'];
export function cropHandlePoints(crop) {
  const {x,y,width:w,height:h}=crop;
  return {nw:[x,y],n:[x+w/2,y],ne:[x+w,y],e:[x+w,y+h/2],se:[x+w,y+h],s:[x+w/2,y+h],sw:[x,y+h],w:[x,y+h/2]};
}
export function hitCrop(crop, p, layout, radius=12) {
  if (!crop) return 'new';
  for (const [name,[x,y]] of Object.entries(cropHandlePoints(crop)))
    if (Math.abs(p.x-x)*layout.width<=radius && Math.abs(p.y-y)*layout.height<=radius) return name;
  return p.x>=crop.x && p.x<=crop.x+crop.width && p.y>=crop.y && p.y<=crop.y+crop.height?'move':'new';
}
export function updateCropGesture(gesture, p, {width=1,height=1,ratio='free'}={}) {
  const minX=Math.min(1,1/width),minY=Math.min(1,1/height),o=gesture.crop,dx=p.x-gesture.start.x,dy=p.y-gesture.start.y;
  if (gesture.mode==='move') return {...o,x:clamp(o.x+dx,0,1-o.width),y:clamp(o.y+dy,0,1-o.height)};
  let x=o?.x??gesture.start.x,y=o?.y??gesture.start.y,r=o?o.x+o.width:x,b=o?o.y+o.height:y;
  if(gesture.mode==='new'){x=Math.min(gesture.start.x,p.x);y=Math.min(gesture.start.y,p.y);r=Math.max(gesture.start.x,p.x);b=Math.max(gesture.start.y,p.y);}
  else {if(gesture.mode.includes('w'))x=clamp(o.x+dx,0,r-minX);if(gesture.mode.includes('e'))r=clamp(o.x+o.width+dx,x+minX,1);if(gesture.mode.includes('n'))y=clamp(o.y+dy,0,b-minY);if(gesture.mode.includes('s'))b=clamp(o.y+o.height+dy,y+minY,1);}
  if(gesture.mode==='new'&&ratio!=='free') {const [rw,rh]=ratio.split(':').map(Number),target=rw/rh*height/width;if(target>0){if((r-x)/(b-y||minY)>target)r=x+(b-y)*target;else b=y+(r-x)/target;}}
  x=clamp(x,0,1-minX);y=clamp(y,0,1-minY);
  return {x,y,width:clamp(r-x,minX,1-x),height:clamp(b-y,minY,1-y)};
}
export function createSourceCropController({getCrop,getLayout,getDimensions,getRatio=()=> 'free',setCrop}) {
  let gesture=null;
  return {
    begin(p,pointerId){if(gesture)return false;const previous=getCrop(),full={x:0,y:0,width:1,height:1};let mode=hitCrop(previous||full,p,getLayout());if(!previous&&mode==='move')mode='new';gesture={start:p,previous:previous?{...previous}:null,crop:previous?{...previous}:mode==='new'?null:full,mode,pointerId};return true;},
    move(p,pointerId){if(!gesture||gesture.pointerId!==pointerId)return false;setCrop(updateCropGesture(gesture,p,{...getDimensions(),ratio:getRatio()}));return true;},
    end(cancel=false,pointerId){if(!gesture||(pointerId!==undefined&&gesture.pointerId!==pointerId))return false;const previous=gesture.previous;gesture=null;if(cancel)setCrop(previous);return true;},
    get active(){return !!gesture;},
  };
}
