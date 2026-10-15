import { getSrgbContext, readSrgbImageData } from './srgb-canvas.mjs?v=20261007-v3-srgb';
export const defaultSourceTransform = () => ({
  coordinateSpace: 'oriented-normalized-v1',
  crop: null, cropRatio: "free", rotation: 0, flipX: false, flipY: false,
  brightness: 0, contrast: 0, saturation: 0, sharpen: 0,
  expand: { top: 0, bottom: 0, left: 0, right: 0 }, background: "#ffffff",
});

const clamp = (value, min, max) => Math.min(max, Math.max(min, Number(value) || 0));
export function normalizeSourceCrop(crop, width, height) {
  if (!crop) return { x: 0, y: 0, width, height };
  const x = clamp(Math.round(crop.x), 0, width - 1), y = clamp(Math.round(crop.y), 0, height - 1);
  return { x, y, width: clamp(Math.round(crop.width), 1, width - x), height: clamp(Math.round(crop.height), 1, height - y) };
}

const rotationOf = (value) => ((Math.round((Number(value)||0)/90)*90)%360+360)%360;
export function normalizeOrientedCrop(crop) {
  if (!crop) return null;
  const x=clamp(crop.x,0,1),y=clamp(crop.y,0,1);
  return {x,y,width:clamp(crop.width,0,1-x),height:clamp(crop.height,0,1-y)};
}

// Adapted from Hon-Wong/pindou (ad668369), MIT; see
// vendor/pindou/reference/LICENSE. Existing saved
// transforms used source-pixel crops and source-space flips; migrate once at
// this boundary, without changing the original image or artwork grid.
export function canonicalizeSourceTransform(transform={},width,height) {
  const rotation=rotationOf(transform.rotation),swap=rotation%180!==0;
  const pixelCrop=transform.crop&&Object.values(transform.crop).some(v=>Number(v)>1);
  const legacy=transform.coordinateSpace!=='oriented-normalized-v1'||pixelCrop;
  let flipX=Boolean(transform.flipX),flipY=Boolean(transform.flipY),crop=transform.crop;
  if(legacy){
    if(swap)[flipX,flipY]=[flipY,flipX];
    if(crop){
      const c=normalizeSourceCrop(crop,width,height);
      const points=[[c.x/width,c.y/height],[(c.x+c.width)/width,c.y/height],[c.x/width,(c.y+c.height)/height],[(c.x+c.width)/width,(c.y+c.height)/height]].map(([x,y])=>{
        if(transform.flipX)x=1-x;if(transform.flipY)y=1-y;
        return rotation===90?[1-y,x]:rotation===180?[1-x,1-y]:rotation===270?[y,1-x]:[x,y];
      });
      const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);
      crop={x:Math.min(...xs),y:Math.min(...ys),width:Math.max(...xs)-Math.min(...xs),height:Math.max(...ys)-Math.min(...ys)};
    }
  }
  return {...defaultSourceTransform(),...transform,coordinateSpace:'oriented-normalized-v1',rotation,flipX,flipY,crop:normalizeOrientedCrop(crop),expand:{...(transform.expand||{})}};
}

export function transformSourceOrientation(transform,action,width,height){
  const t=canonicalizeSourceTransform(transform,width,height),c=t.crop;
  if(action==='rotate-right'||action==='rotate-left'){
    const right=action==='rotate-right';
    t.rotation=rotationOf(t.rotation+(right?90:-90));
    [t.flipX,t.flipY]=[t.flipY,t.flipX];
    if(c)t.crop=normalizeOrientedCrop(right?{x:1-c.y-c.height,y:c.x,width:c.height,height:c.width}:{x:c.y,y:1-c.x-c.width,width:c.height,height:c.width});
  }else if(action==='flip-horizontal'){
    t.flipX=!t.flipX;if(c)t.crop=normalizeOrientedCrop({...c,x:1-c.x-c.width});
  }else if(action==='flip-vertical'){
    t.flipY=!t.flipY;if(c)t.crop=normalizeOrientedCrop({...c,y:1-c.y-c.height});
  }else throw new RangeError('Unknown source orientation action');
  return t;
}

export function sourceOutputGeometry(width, height, transform = defaultSourceTransform()) {
  const t=canonicalizeSourceTransform(transform,width,height),swap=t.rotation%180!==0;
  const orientedWidth=swap?height:width,orientedHeight=swap?width:height;
  const c=t.crop;
  const crop=normalizeSourceCrop(c?{x:c.x*orientedWidth,y:c.y*orientedHeight,width:c.width*orientedWidth,height:c.height*orientedHeight}:null,orientedWidth,orientedHeight);
  const expand = transform.expand || {}, left = clamp(expand.left,0,1000), right = clamp(expand.right,0,1000);
  const top = clamp(expand.top,0,1000), bottom = clamp(expand.bottom,0,1000);
  return { crop, width: crop.width + left + right,
    height: crop.height + top + bottom, rotatedWidth: crop.width,
    rotatedHeight: crop.height, orientedWidth,orientedHeight,left, right, top, bottom };
}

export function cropFromDrag(ax, ay, bx, by, width, height, ratio = "free") {
  let x0 = clamp(Math.min(ax,bx),0,1), y0 = clamp(Math.min(ay,by),0,1);
  let x1 = clamp(Math.max(ax,bx),0,1), y1 = clamp(Math.max(ay,by),0,1);
  if (ratio !== "free") {
    const [rw,rh] = ratio.split(":").map(Number);
    if (rw > 0 && rh > 0) {
      const desired = rw / rh, actual = (x1-x0)*width / Math.max(1,(y1-y0)*height);
      if (actual > desired) x1 = Math.min(1,x0 + (y1-y0)*height*desired/width);
      else y1 = Math.min(1,y0 + (x1-x0)*width/desired/height);
    }
  }
  return normalizeSourceCrop({x:x0*width,y:y0*height,width:Math.max(1,(x1-x0)*width),height:Math.max(1,(y1-y0)*height)},width,height);
}

// Always derive a new buffer from the unchanged input. Sharpen reads the
// completed tonal pass, never partially updated or pre-adjustment neighbours.
export function adjustSourcePixels(input, width, height, transform = {}) {
  if (input.length !== width * height * 4) throw new RangeError('Invalid RGBA dimensions');
  const pixels = new Uint8ClampedArray(input);
  const brightness = clamp(transform.brightness,-100,100)*2.55, contrast = 1 + clamp(transform.contrast,-100,100)/100;
  const saturation = 1 + clamp(transform.saturation,-100,100)/100, sharpen = clamp(transform.sharpen,0,100)/100;
  if (!brightness && contrast === 1 && saturation === 1 && !sharpen) return pixels;
  const w = width, h = height;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const index=(y*w+x)*4; if (!pixels[index+3]) continue;
    let rgb=[pixels[index],pixels[index+1],pixels[index+2]].map((v)=>(v-128)*contrast+128+brightness);
    const gray=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
    rgb=rgb.map((v)=>gray+(v-gray)*saturation);
    for(let c=0;c<3;c++)pixels[index+c]=clamp(Math.round(rgb[c]),0,255);
  }
  if (sharpen) {
    const adjusted = new Uint8ClampedArray(pixels);
    for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
      const index=(y*w+x)*4;
      if (!adjusted[index+3]) continue;
      for (let channel=0;channel<3;channel++) {
        let total=0,weight=0;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=w||ny>=h)continue;
          const neighbour=(ny*w+nx)*4, alpha=adjusted[neighbour+3]/255;
          total+=adjusted[neighbour+channel]*alpha; weight+=alpha;
        }
        if (weight) pixels[index+channel]=clamp(Math.round(adjusted[index+channel]+(adjusted[index+channel]-total/weight)*sharpen*.8),0,255);
      }
    }
  }
  return pixels;
}

function adjustPixels(canvas, transform) {
  if (!transform.brightness && !transform.contrast && !transform.saturation && !transform.sharpen) return;
  const {context:ctx}=getSrgbContext(canvas,{willReadFrequently:true});
  const image=readSrgbImageData(ctx,0,0,canvas.width,canvas.height).imageData;
  image.data.set(adjustSourcePixels(image.data,canvas.width,canvas.height,transform));
  ctx.putImageData(image,0,0);
}

// Object identity prevents a previous upload's cached pixels being reused.
// Each live image retains only two orientation sizes and four final results.
const sourceRenderCache=new WeakMap();
function canvasOf(width,height){const c=document.createElement('canvas');c.width=width;c.height=height;return c;}
function copyCanvas(source){const c=canvasOf(source.width,source.height);getSrgbContext(c).context.drawImage(source,0,0);return c;}
function remember(map,key,value,limit){map.set(key,value);while(map.size>limit)map.delete(map.keys().next().value);return value;}
function imageCache(image){let entry=sourceRenderCache.get(image);if(!entry){entry={orientation:new Map(),result:new Map()};sourceRenderCache.set(image,entry);}return entry;}
function orientedCanvas(image,t,maxSide){
  const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height,swap=t.rotation%180!==0;
  const scale=Math.min(1,maxSide/Math.max(iw,ih)),sw=Math.max(1,Math.round(iw*scale)),sh=Math.max(1,Math.round(ih*scale));
  const key=JSON.stringify([iw,ih,t.rotation,t.flipX,t.flipY,sw,sh]),cache=imageCache(image).orientation;
  if(cache.has(key))return cache.get(key);
  const cv=canvasOf(swap?sh:sw,swap?sw:sh),ctx=getSrgbContext(cv).context;
  ctx.translate(cv.width/2,cv.height/2);ctx.scale(t.flipX?-1:1,t.flipY?-1:1);ctx.rotate(t.rotation*Math.PI/180);
  ctx.drawImage(image,-sw/2,-sh/2,sw,sh);
  return remember(cache,key,cv,2);
}
export function renderSourceOrientation(image,transform=defaultSourceTransform(),maxSide=2400){
  const t=canonicalizeSourceTransform(transform,image.naturalWidth||image.width,image.naturalHeight||image.height);
  return copyCanvas(orientedCanvas(image,t,maxSide));
}
export function renderSourceTransform(image, transform = defaultSourceTransform(), maxSide = 2400) {
  const iw=image.naturalWidth||image.width,ih=image.naturalHeight||image.height;
  const t=canonicalizeSourceTransform(transform,iw,ih),geometry=sourceOutputGeometry(iw,ih,t);
  const cache=imageCache(image).result,key=JSON.stringify([iw,ih,t,maxSide]);
  if(cache.has(key))return copyCanvas(cache.get(key));
  const scale=Math.min(1,maxSide/Math.max(geometry.width,geometry.height));
  const sw=Math.max(1,Math.round(geometry.crop.width*scale)),sh=Math.max(1,Math.round(geometry.crop.height*scale));
  const rotated=canvasOf(sw,sh),ctx=getSrgbContext(rotated,{willReadFrequently:true}).context;
  // Clip directly into the output-size canvas instead of allocating a second
  // full-resolution canvas for a large upload. This is the same oriented-image
  // coordinate system as the cached preview, without losing small-crop detail.
  ctx.scale(sw/geometry.crop.width,sh/geometry.crop.height);
  ctx.translate(-geometry.crop.x,-geometry.crop.y);
  ctx.translate(geometry.orientedWidth/2,geometry.orientedHeight/2);
  ctx.scale(t.flipX?-1:1,t.flipY?-1:1);ctx.rotate(t.rotation*Math.PI/180);
  ctx.drawImage(image,-iw/2,-ih/2,iw,ih);ctx.setTransform(1,0,0,1,0,0);
  adjustPixels(rotated,t);
  const result=document.createElement("canvas"), left=Math.round(geometry.left*scale), right=Math.round(geometry.right*scale), top=Math.round(geometry.top*scale), bottom=Math.round(geometry.bottom*scale);
  result.width=rotated.width+left+right; result.height=rotated.height+top+bottom;
  const {context:out}=getSrgbContext(result);
  // Background belongs to the newly expanded margins, not underneath the
  // source image. Filling the whole result destroyed PNG alpha even for an
  // automatic crop, rotation or brightness-only adjustment.
  out.fillStyle=transform.background || "#ffffff";
  if (top) out.fillRect(0,0,result.width,top);
  if (bottom) out.fillRect(0,top+rotated.height,result.width,bottom);
  if (left) out.fillRect(0,top,left,rotated.height);
  if (right) out.fillRect(left+rotated.width,top,right,rotated.height);
  out.drawImage(rotated,left,top);remember(cache,key,result,4);return copyCanvas(result);
}

export const hasSourceTransform = (transform) => Boolean(transform.crop || transform.rotation || transform.flipX || transform.flipY || transform.brightness || transform.contrast || transform.saturation || transform.sharpen || Object.values(transform.expand || {}).some(Boolean) || (transform.background && transform.background !== "#ffffff"));
