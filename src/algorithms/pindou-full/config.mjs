/* Defaults and partial scene patches transcribed from pinned upstream app.js. Grid bounds intentionally extended to 1..1000. */
export const PINDOU_DEFAULTS = Object.freeze( {
    gridW: 64, gridH: 64, lockAspect: true, fitMode: 'cover',
    rotate: 0, flipH: false, flipV: false, crop: null,
    mosaic: 1, sampleMode: 'ssim', blur: 0, sharpen: 0, texture: 100,
    paletteId: 'mard221', algo: 'kmeans', colors: 16,
    dither: 'none', ditherAmt: 70,
    brightness: 0, contrast: 0, saturation: 0, gamma: 100,
    bgRemove: false, bgColor: '#ffffff', bgTol: 12, alphaTh: 128
  });export const PINDOU_SCENES = Object.freeze( {
    photo: { label: '照片',
      sampleMode: 'ssim', algo: 'kmeans', colors: 24, dither: 'fs', ditherAmt: 55,
      mosaic: 1, blur: 0, sharpen: 15, contrast: 6, saturation: 8, gamma: 100 },
    // 动漫/插画：大片平涂 + 细线稿。用众数采样保住平涂区不糊，
    // 关掉抖动免得干净色块被打成噪点，锐化把线条拉回来，饱和度补一点。
    anime: { label: '动漫插画',
      sampleMode: 'dominant', algo: 'kmeans', colors: 20, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 38, contrast: 10, saturation: 18, gamma: 100 },
    pixel: { label: '像素画',
      sampleMode: 'dominant', algo: 'direct', colors: 32, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 0, contrast: 0, saturation: 0, gamma: 100 },
    flat:  { label: '扁平 Logo',
      sampleMode: 'dominant', algo: 'kmeans', colors: 8, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 0, contrast: 0, saturation: 0, gamma: 100 },
    mono:  { label: '单色剪影',
      sampleMode: 'area', algo: 'kmeans', colors: 2, dither: 'none',
      mosaic: 1, blur: 0, sharpen: 20, contrast: 35, saturation: -100, gamma: 100 },
    // 拼豆色卡是离散的，逼近原图只能靠抖动让邻近色在视觉上混合。
    // 实测 3×3 局部平均 ΔE2000：不抖动 5.69 → FS 抖动 2.99。
    fidelity: { label: '最大保真',
      sampleMode: 'ssim', algo: 'kmeans', colors: 48, dither: 'fs', ditherAmt: 85,
      mosaic: 1, blur: 0, sharpen: 8, contrast: 0, saturation: 0, gamma: 100 }
  });export const PINDOU_ENUMS = {
    fitMode: ['cover', 'contain', 'stretch'],
    sampleMode: ['ssim', 'area', 'dpid', 'edge', 'dominant', 'nearest'],
    algo: ['kmeans', 'mediancut', 'direct'],
    dither: ['none', 'fs', 'ordered']
  };
export const PINDOU_RANGES = Object.freeze({gridW:[1,1000],gridH:[1,1000],mosaic:[1,10],blur:[0,5],sharpen:[0,100],colors:[2,64],ditherAmt:[0,100],texture:[0,300],brightness:[-100,100],contrast:[-100,100],saturation:[-100,100],gamma:[50,200],bgTol:[0,100],alphaTh:[0,255]});
export function normalizePindouConfig(input = {}) {
 const out = {...PINDOU_DEFAULTS, ...input};
 for(const [key,[lo,hi]] of Object.entries(PINDOU_RANGES)){const v=parseFloat(out[key]);out[key]=Number.isFinite(v)?Math.max(lo,Math.min(hi,v)):PINDOU_DEFAULTS[key];}
 for(const key of ["gridW","gridH","mosaic","colors"]) out[key]=Math.round(out[key]);
 for(const [key,values] of Object.entries(PINDOU_ENUMS)) if(!values.includes(out[key])) out[key]=PINDOU_DEFAULTS[key];
 for(const key of ["lockAspect","bgRemove","flipH","flipV"]) out[key]=!!out[key];
 out.rotate=[0,90,180,270].includes(+out.rotate)?+out.rotate:0;
 const c=out.crop;out.crop=c&&["x","y","w","h"].every(k=>Number.isFinite(+c[k]))&&c.w>0.01&&c.h>0.01&&c.x>=0&&c.y>=0&&+c.x + +c.w<=1.001&&+c.y + +c.h<=1.001?{x:+c.x,y:+c.y,w:+c.w,h:+c.h}:null;
 if(!/^#[0-9a-f]{6}$/i.test(out.bgColor))out.bgColor=PINDOU_DEFAULTS.bgColor;
 return out;
}
export function applyPindouScene(config, id) {
 const scene=PINDOU_SCENES[id]; if(!scene)throw new RangeError("Unknown Pindou scene: "+id);
 const {label,...partial}=scene;return normalizePindouConfig({...config,...partial});
}

/** Host aspect synchronization; compute() itself consumes explicit grid dimensions. */
export function resolvePindouAspect(config, sourceWidth, sourceHeight) {
 const out=normalizePindouConfig(config);
 if(!out.lockAspect||!(sourceWidth>0&&sourceHeight>0))return out;
 const sideways=out.rotate===90||out.rotate===270;
 const ratio=(sideways?sourceHeight/sourceWidth:sourceWidth/sourceHeight)*(out.crop?out.crop.w/out.crop.h:1);
 let width=out.gridW,height=Math.max(1,Math.round(width/ratio));
 if(height>1000){height=1000;width=Math.max(1,Math.round(height*ratio));}
 return normalizePindouConfig({...out,gridW:width,gridH:height});
}
