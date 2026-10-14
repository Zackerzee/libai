const u32=(view,offset,value)=>view.setUint32(offset,value,true);
const bytes=(value)=>new TextEncoder().encode(JSON.stringify(value,null,2));
async function fflate(){if(globalThis.fflate)return globalThis.fflate;const mod=await import("../vendor/fflate.js"),api=globalThis.fflate||mod.default||mod;if(typeof api.zipSync!=="function")throw new Error("ZIP 库加载失败");return api;}

export async function buildPixlerProject(grid,{title="未命名作品",paletteLabel="MARD 221"}={}){
  const height=grid.length,width=grid[0]?.length||0,colors=[],byId=new Map();
  colors.push({paletteId:"__null__",code:null,name:"空白",rgb:[0,0,0],alpha:0});byId.set("__null__",0);
  for(const row of grid)for(const cell of row)if(cell){const id=cell.paletteId||cell.code;if(!byId.has(id)){byId.set(id,colors.length);colors.push({paletteId:id,code:cell.code||id,name:cell.name||cell.code||id,rgb:[...cell.rgb],alpha:255});}}
  const indices=[];for(const row of grid)for(const cell of row)indices.push(cell?byId.get(cell.paletteId||cell.code):0);
  const runs=[];for(const index of indices){const last=runs.at(-1);if(last&&last.index===index)last.count+=1;else runs.push({index,count:1});}
  const indexByteWidth=colors.length<=256?1:colors.length<=65536?2:4,decoded=new Uint8Array(32+colors.length*4+runs.length*(indexByteWidth+4)),view=new DataView(decoded.buffer);
  decoded.set(new TextEncoder().encode("PXLRPTN1"),0);u32(view,8,indexByteWidth);u32(view,12,width);u32(view,16,height);u32(view,20,colors.length);u32(view,24,runs.length);u32(view,28,width*height);
  colors.forEach((c,i)=>decoded.set([...c.rgb,c.alpha],32+i*4));let at=32+colors.length*4;for(const run of runs){for(let b=0;b<indexByteWidth;b++)decoded[at+b]=(run.index>>(b*8))&255;u32(view,at+indexByteWidth,run.count);at+=indexByteWidth+4;}
  const brands=new Set(colors.filter(c=>c.code).map(c=>c.paletteId.includes(":")?c.paletteId.split(":")[0]:"unknown"));
  const api=await fflate(),pattern=api.deflateSync(decoded),algorithm={brandId:brands.size===1?[...brands][0]:brands.size?"mixed":"unknown",seriesId:null};
  const beadMatch={activeRevisionId:"libms-export",revisions:[{revisionId:"libms-export",algorithm,catalog:{label:paletteLabel},matches:colors.flatMap((c,paletteIndex)=>c.code?[{paletteIndex,bead:{paletteId:c.paletteId,code:c.code,name:c.name,rgb:c.rgb,hex:`#${c.rgb.map(v=>v.toString(16).padStart(2,"0")).join("")}`}}]:[])}]};
  const entries={"work.json":bytes({meta:{title}}),"settings.json":bytes({drawingSettings:{gridVisible:true,colorCodeLabelMode:"code"}}),"bead-match.json":bytes(beadMatch),"pattern.bin":pattern};
  const manifest={format:"pixler-project",formatVersion:1,entries:{},pattern:{codecVersion:1,indexEncoding:"little-endian-min-width",runEncoding:"value-count-rle-v1",compression:"deflate-raw",cellCount:width*height,decodedBytes:decoded.length}};for(const [name,data] of Object.entries(entries))manifest.entries[name]={bytes:data.length};entries["manifest.json"]=bytes(manifest);
  return api.zipSync(entries,{level:1});
}
