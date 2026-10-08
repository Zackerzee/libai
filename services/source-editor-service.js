import { getSrgbContext, readSrgbImageData } from './srgb-canvas.mjs?v=20261007-v3-srgb';
export const defaultSourceTransform = () => ({
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

export function sourceOutputGeometry(width, height, transform = defaultSourceTransform()) {
  const crop = normalizeSourceCrop(transform.crop, width, height), swap = Math.abs(Math.round(transform.rotation / 90)) % 2 === 1;
  const expand = transform.expand || {}, left = clamp(expand.left,0,1000), right = clamp(expand.right,0,1000);
  const top = clamp(expand.top,0,1000), bottom = clamp(expand.bottom,0,1000);
  return { crop, width: (swap ? crop.height : crop.width) + left + right,
    height: (swap ? crop.width : crop.height) + top + bottom, rotatedWidth: swap ? crop.height : crop.width,
    rotatedHeight: swap ? crop.width : crop.height, left, right, top, bottom };
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

function adjustPixels(canvas, transform) {
  const brightness = clamp(transform.brightness,-100,100)*2.55, contrast = 1 + clamp(transform.contrast,-100,100)/100;
  const saturation = 1 + clamp(transform.saturation,-100,100)/100, sharpen = clamp(transform.sharpen,0,100)/100;
  if (!brightness && contrast === 1 && saturation === 1 && !sharpen) return;
  const {context:ctx} = getSrgbContext(canvas,{willReadFrequently:true}), image = readSrgbImageData(ctx,0,0,canvas.width,canvas.height).imageData, pixels = image.data;
  const original = sharpen ? new Uint8ClampedArray(pixels) : null, w = canvas.width, h = canvas.height;
  for (let y=0;y<h;y++) for (let x=0;x<w;x++) {
    const index=(y*w+x)*4; if (!pixels[index+3]) continue;
    let rgb=[pixels[index],pixels[index+1],pixels[index+2]].map((v)=>(v-128)*contrast+128+brightness);
    const gray=rgb[0]*.299+rgb[1]*.587+rgb[2]*.114;
    rgb=rgb.map((v)=>gray+(v-gray)*saturation);
    if (sharpen) {
      for (let channel=0;channel<3;channel++) {
        let total=0,count=0;
        for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
          const nx=x+dx,ny=y+dy; if(nx<0||ny<0||nx>=w||ny>=h)continue;
          total+=original[(ny*w+nx)*4+channel]; count++;
        }
        if (count) rgb[channel]+=(original[index+channel]-total/count)*sharpen*.8;
      }
    }
    for(let c=0;c<3;c++)pixels[index+c]=clamp(Math.round(rgb[c]),0,255);
  }
  ctx.putImageData(image,0,0);
}

export function renderSourceTransform(image, transform = defaultSourceTransform(), maxSide = 2400) {
  const geometry = sourceOutputGeometry(image.naturalWidth || image.width, image.naturalHeight || image.height, transform);
  const scale=Math.min(1, maxSide/Math.max(geometry.width,geometry.height)), sw=Math.max(1,Math.round(geometry.crop.width*scale)), sh=Math.max(1,Math.round(geometry.crop.height*scale));
  const rotated=document.createElement("canvas"), swap=Math.abs(Math.round(transform.rotation/90))%2===1;
  rotated.width=swap?sh:sw; rotated.height=swap?sw:sh;
  const {context:ctx}=getSrgbContext(rotated,{willReadFrequently:true});
  ctx.translate(rotated.width/2,rotated.height/2); ctx.rotate((Number(transform.rotation)||0)*Math.PI/180);
  ctx.scale(transform.flipX?-1:1,transform.flipY?-1:1);
  ctx.drawImage(image,geometry.crop.x,geometry.crop.y,geometry.crop.width,geometry.crop.height,-sw/2,-sh/2,sw,sh);
  ctx.setTransform(1,0,0,1,0,0); adjustPixels(rotated,transform);
  const result=document.createElement("canvas"), left=Math.round(geometry.left*scale), right=Math.round(geometry.right*scale), top=Math.round(geometry.top*scale), bottom=Math.round(geometry.bottom*scale);
  result.width=rotated.width+left+right; result.height=rotated.height+top+bottom;
  const {context:out}=getSrgbContext(result); out.fillStyle=transform.background || "#ffffff"; out.fillRect(0,0,result.width,result.height);
  out.drawImage(rotated,left,top); return result;
}

export const hasSourceTransform = (transform) => Boolean(transform.crop || transform.rotation || transform.flipX || transform.flipY || transform.brightness || transform.contrast || transform.saturation || transform.sharpen || Object.values(transform.expand || {}).some(Boolean) || (transform.background && transform.background !== "#ffffff"));
