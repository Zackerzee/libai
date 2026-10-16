import test from "node:test";
import assert from "node:assert/strict";
import { BRAND_PRESETS } from "../services/poster-export-service.js";
import { renderPosterCanvas } from "../services/export-v2-service.js";

test("poster brand presets use transparent logo and requested signatures",()=>{
  assert.equal(BRAND_PRESETS.libms.signature,"LIBMS Studio");
  assert.equal(BRAND_PRESETS.keqila.signature,"氪憩鞡丨时里白");
  for(const brand of Object.values(BRAND_PRESETS))assert.equal(brand.logo,"./assets/libms-logo.png");
});

test("artwork background is blurred behind clean foreground and centered upper logo",async()=>{
  const previousDocument=globalThis.document,previousImage=globalThis.Image,canvases=[];
  globalThis.document={createElement(){
    const draws=[],texts=[],fills=[],stack=[],ctx={filter:"none",globalAlpha:1,imageSmoothingEnabled:true,scale(){},setTransform(){},
      createRadialGradient:()=>({addColorStop(){}}),fillRect(){fills.push(this.fillStyle);},
      save(){stack.push({filter:this.filter,globalAlpha:this.globalAlpha,imageSmoothingEnabled:this.imageSmoothingEnabled});},
      restore(){Object.assign(this,stack.pop());},
      drawImage(image,...rect){draws.push({image,rect,filter:this.filter,alpha:this.globalAlpha,smoothing:this.imageSmoothingEnabled,quality:this.imageSmoothingQuality});},
      fillText(text){texts.push(text);},
    },canvas={dataset:{},draws,texts,fills,getContext:()=>ctx};canvases.push(canvas);return canvas;
  }};
  globalThis.Image=class{naturalWidth=1254;naturalHeight=1254;set src(value){this.url=value;queueMicrotask(()=>this.onload());}};
  try{
    const grid=[[{rgb:[12,80,30],code:"B12"},null]];
    const canvas=await renderPosterCanvas(grid,{background:"artwork",brand:"keqila"},{},{width:1500});
    assert.deepEqual([canvas.width,canvas.height],[1500,2000]);
    assert.equal(canvas.draws.length,2);
    const [background,logo]=canvas.draws;
    assert.ok(canvas.fills.includes("rgb(12,80,30)"));
    assert.equal(background.filter,"blur(65px)");
    assert.equal(background.alpha,1);
    assert.ok(!canvas.fills.includes("#F3F0EA"));
    assert.equal(background.smoothing,true);
    assert.ok(background.rect.at(-2)>1500&&background.rect.at(-1)>2000);
    assert.equal(logo.image.url,"./assets/libms-logo.png");
    assert.deepEqual(logo.rect,[698,120,104,104]);
    assert.equal(logo.smoothing,true);
    assert.equal(logo.quality,"high");
    assert.deepEqual(canvas.texts,["氪憩鞡丨时里白"]);
    assert.deepEqual(canvases[1].texts,[]);
    const preview=await renderPosterCanvas(grid,{background:"artwork",brand:"keqila"},{},{width:300});
    assert.deepEqual([preview.width,preview.height],[300,400]);
    assert.equal(preview.draws[0].filter,"blur(13px)");
    assert.equal(preview.draws[1].filter,"none");
  }finally{
    if(previousDocument===undefined)delete globalThis.document;else globalThis.document=previousDocument;
    if(previousImage===undefined)delete globalThis.Image;else globalThis.Image=previousImage;
  }
});
