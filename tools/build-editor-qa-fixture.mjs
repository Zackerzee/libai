import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const width=104,height=104;
const rgb=(index)=>[(index*47)%230+12,(index*83)%230+12,(index*131)%230+12];
const hex=(channels)=>`#${channels.map((value)=>value.toString(16).padStart(2,"0")).join("")}`;
const colors=Array.from({length:24},(_,index)=>{
  const channels=index===22?[90,140,190]:index===23?[90,140,190]:rgb(index+1);
  return {code:`QA${String(index+1).padStart(2,"0")}`,name:`QA Color ${index+1}`,rgb:channels,hex:hex(channels)};
});
const grid=Array.from({length:height},(_,y)=>Array.from({length:width},(_,x)=>{
  if(x<3||y<3||x>100||y>100) return null;
  return colors[(Math.floor(x/13)+Math.floor(y/13)*3)%21].code;
}));

// 封闭区域：QA05 边框包围 QA06，供 Flood Fill 验收。
for(let y=18;y<=34;y+=1) for(let x=18;x<=34;x+=1) grid[y][x]=(x===18||x===34||y===18||y===34)?"QA05":"QA06";
// 稳定斜线和小色块。
for(let i=0;i<28;i+=1) grid[45+i][12+i]="QA12";
for(let y=70;y<74;y+=1) for(let x=70;x<74;x+=1) grid[y][x]="QA17";
// 相同 RGB、不同 palette identity 的相邻测试点。
grid[50][80]="QA23"; grid[50][81]="QA24";
// 明确结构诊断候选：单格 QA22 被 QA04 完全包围。
for(let y=84;y<=86;y+=1) for(let x=84;x<=86;x+=1) grid[y][x]="QA04";
grid[85][85]="QA22";

const counts=new Map(); grid.flat().filter(Boolean).forEach((code)=>counts.set(code,(counts.get(code)||0)+1));
const used=colors.filter((color)=>counts.has(color.code));
const project={
  format:"libms-project",version:1,savedAt:"2026-09-29T00:00:00.000Z",projectName:"Editor QA 104x104",
  canvas:{width,height},palette:{key:"qa-fixture",label:"Editor QA",maxColors:0},
  stats:{usedColors:used.length,totalBeads:[...counts.values()].reduce((sum,count)=>sum+count,0)},
  colors:used,grid,
};
const output=fileURLToPath(new URL("../tests/fixtures/editor-104x104.libms-project",import.meta.url));
await writeFile(output,`${JSON.stringify(project,null,2)}\n`);
console.log(output);
