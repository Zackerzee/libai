export const CJK_FONT_URL="./vendor/source-han-sans/SourceHanSansSC-VF.ttf";
export const CJK_FONT_NAME="SourceHanSansSC";
export const CJK_FONT_LICENSE="SIL Open Font License 1.1";
export const containsCjk=(text)=>/[\u3400-\u9fff\uf900-\ufaff]/u.test(String(text||""));
let fontPromise=null;
export function resetPdfFontCache(){fontPromise=null;}
export async function resolvePdfFont(text,{fetchFn=fetch}={}){
  if(!containsCjk(text))return{fontId:"Helvetica",fontData:null,supportsCJK:false};
  if(!fontPromise)fontPromise=fetchFn(CJK_FONT_URL).then(async(response)=>{if(!response.ok)throw new Error(`PDF 中文字体加载失败（${response.status}）`);return new Uint8Array(await response.arrayBuffer());}).catch(error=>{fontPromise=null;throw error;});
  return{fontId:CJK_FONT_NAME,fontData:await fontPromise,supportsCJK:true};
}
export function bytesToBinary(bytes){let out="";for(let i=0;i<bytes.length;i+=0x8000)out+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return out;}
