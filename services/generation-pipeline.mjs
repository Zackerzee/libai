import { generateV2 } from "../smart-preprocessing/generation-engine-v2.mjs";

export const GENERATION_MODES = Object.freeze(["beginner", "auto", "portrait", "anime", "illustration", "pixel", "logo", "photo"]);
export const SAMPLING_STRATEGIES = Object.freeze(["auto", "linear-mean", "center", "dominant", "edge-aware"]);

const base = Object.freeze({
  sampling: "auto", detailProtection: 70, edgeProtection: 70, cleanupStrength: 50,
  preserveEyes: true, preserveHighlights: true, preserveMicroDetails: true,
  subjectCrop: false, autoBackground: false, strokeProtection: false, accentProtection: false,
});

export const GENERATION_MODE_PRESETS = Object.freeze({
  beginner: Object.freeze({ ...base, detailProtection:80, edgeProtection:90, cleanupStrength:45, subjectCrop:true, autoBackground:true, strokeProtection:true, accentProtection:true }),
  auto: Object.freeze({ ...base }),
  portrait: Object.freeze({ ...base, sampling:"edge-aware", detailProtection:90, edgeProtection:75, cleanupStrength:35 }),
  anime: Object.freeze({ ...base, sampling:"dominant", detailProtection:90, edgeProtection:90, cleanupStrength:45 }),
  illustration: Object.freeze({ ...base, sampling:"dominant", detailProtection:70, edgeProtection:85, cleanupStrength:55, preserveEyes:false }),
  pixel: Object.freeze({ ...base, sampling:"center", detailProtection:100, edgeProtection:100, cleanupStrength:10 }),
  logo: Object.freeze({ ...base, sampling:"dominant", detailProtection:35, edgeProtection:95, cleanupStrength:85, preserveEyes:false, preserveHighlights:false, preserveMicroDetails:false }),
  photo: Object.freeze({ ...base, sampling:"linear-mean", detailProtection:70, edgeProtection:70, cleanupStrength:40 }),
});

export const LEGACY_ALGORITHM_OVERRIDES = Object.freeze({
  bgs: "bgs", BCS: "bgs", PW: "pindou-workbench", "pindou-workbench": "pindou-workbench",
  "HYBRID-PW": "hybrid-pw", "hybrid-pw": "hybrid-pw",
});

const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function analyzeGenerationImage(source) {
  if (!source?.data || !source.width || !source.height) return { edgeDensity:0, flatRegionRatio:0, textureScore:0, colorComplexity:0, pixelLikeness:0, portraitLikeness:0 };
  const { data, width, height } = source;
  const step = Math.max(1, Math.floor(Math.sqrt(width * height / 12000)));
  let samples=0, edges=0, flat=0, texture=0; const colors=new Set();
  const lum=(i)=>.2126*data[i]+.7152*data[i+1]+.0722*data[i+2];
  for(let y=0;y<height-step;y+=step) for(let x=0;x<width-step;x+=step){
    const i=(y*width+x)*4, right=(y*width+x+step)*4, down=((y+step)*width+x)*4;
    const delta=Math.max(Math.abs(lum(i)-lum(right)),Math.abs(lum(i)-lum(down)));
    samples++; if(delta>32)edges++; if(delta<8)flat++; texture+=Math.min(1,delta/64);
    colors.add(`${data[i]>>4},${data[i+1]>>4},${data[i+2]>>4}`);
  }
  const edgeDensity=edges/Math.max(1,samples), flatRegionRatio=flat/Math.max(1,samples);
  const colorComplexity=clamp01(colors.size/512), textureScore=texture/Math.max(1,samples);
  const pixelLikeness=clamp01(flatRegionRatio*.65+edgeDensity*.35-colorComplexity*.15);
  return { edgeDensity, flatRegionRatio, textureScore, colorComplexity, pixelLikeness, portraitLikeness:0 };
}

export function resolveGenerationPipeline(mode="auto", imageAnalysis=null, overrides={}) {
  const selectedMode=GENERATION_MODES.includes(mode)?mode:"auto";
  const analysis=imageAnalysis||{};
  let routedMode=selectedMode;
  if(selectedMode==="auto"){
    if((analysis.portraitLikeness||0)>=.65) routedMode="portrait";
    else if((analysis.pixelLikeness||0)>=.62) routedMode="pixel";
    else if((analysis.flatRegionRatio||0)>=.58 && (analysis.edgeDensity||0)>=.12) routedMode="illustration";
    else if((analysis.textureScore||0)>=.42 || (analysis.colorComplexity||0)>=.55) routedMode="photo";
  }
  const preset={...GENERATION_MODE_PRESETS[routedMode],...overrides};
  if(!SAMPLING_STRATEGIES.includes(preset.sampling)) preset.sampling=base.sampling;
  return { mode:selectedMode, routedMode, analysis:{...analysis}, ...preset };
}

// 唯一生产 runner：模式只注入配置，所有模式仍调用同一个 Generation Engine V2。
export function runGenerationPipeline({ image, mode="auto", size, palette, maxColors=0, overrides={}, onPhase=null }) {
  if (typeof onPhase === "function") onPhase("analyze");
  const analysis=analyzeGenerationImage(image);
  const config=resolveGenerationPipeline(mode,analysis,overrides);
  // onPhase 单独传，**不放进 config** —— 它是函数，config 要能结构化克隆。
  const result=generateV2({ source:image, width:size.width, height:size.height, palette, options:{...config,detailProtection:config.detailProtection/100,edgeProtection:config.edgeProtection/100,highlightProtection:config.preserveHighlights?0.8:0,eyeProtection:config.preserveEyes?1:0,microDetailProtection:config.preserveMicroDetails?0.8:0,maxColors,onPhase:onPhase||undefined} });
  return { ...result, pipeline:{ mode:config.mode, routedMode:config.routedMode, sampling:config.sampling, analysis } };
}
