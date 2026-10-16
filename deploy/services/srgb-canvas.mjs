// Request the browser's sRGB Canvas boundary; this does not parse JPEG ICC
// profiles or prove how an upstream decoder handled them. Report unknowns.
export function getSrgbContext(canvas,{willReadFrequently=false}={}) {
  let context,contextFallback=false;
  try { context=canvas.getContext('2d',{colorSpace:'srgb',willReadFrequently}); }
  catch(error) {
    if(error?.name==='SecurityError')throw error;
    contextFallback=true;
    context=canvas.getContext('2d',{willReadFrequently});
  }
  if(!context)throw new Error('Canvas 2D context unavailable');
  let attrs;
  try { attrs=context.getContextAttributes?.(); } catch { /* Older implementations cannot report their color space. */ }
  return {context,diagnostics:{requestedColorSpace:'srgb',canvasColorSpace:attrs?.colorSpace||'unreported',contextFallback}};
}

export function readSrgbImageData(context,x,y,width,height) {
  let imageData,readFallback=false;
  try { imageData=context.getImageData(x,y,width,height,{colorSpace:'srgb'}); }
  catch(error) {
    // Invalid geometry and tainted Canvas are real failures, not evidence that
    // the optional colorSpace setting is unsupported. Never hide these errors.
    if(error?.name!=='TypeError'&&error?.name!=='NotSupportedError')throw error;
    readFallback=true;
    imageData=context.getImageData(x,y,width,height);
  }
  return {imageData,diagnostics:{requestedColorSpace:'srgb',imageDataColorSpace:imageData?.colorSpace||'unreported',readFallback}};
}
