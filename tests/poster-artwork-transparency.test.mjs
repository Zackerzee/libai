import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { defaultPosterConfig, renderPosterArtworkCanvas, preparePosterArtwork } from "../services/poster-export-service.js";

test("poster artwork preserves null transparency and real white palette cells",()=>{
  const white={paletteId:"mard:H02",code:"H02",rgb:[255,255,255]};
  const source=[[null,white],[{paletteId:"mard:B12",rgb:[10,80,30]},null]];
  const before=structuredClone(source),draws=[];
  const ctx={fillStyle:"",fillRect(...rect){draws.push({color:this.fillStyle,rect});}};
  const canvas={getContext:()=>ctx};
  assert.equal(renderPosterArtworkCanvas(source,{cellSize:8,createCanvas:()=>canvas}),canvas);
  assert.deepEqual([canvas.width,canvas.height],[16,16]);
  assert.deepEqual(draws,[{color:"rgb(255,255,255)",rect:[8,0,8,8]},{color:"rgb(10,80,30)",rect:[0,8,8,8]}]);
  assert.deepEqual(source,before);
});

test("empty poster artwork paints no white background",()=>{
  let draws=0;const canvas={getContext:()=>({fillRect(){draws++;}})};
  renderPosterArtworkCanvas([[null,null]],{createCanvas:()=>canvas});
  assert.equal(draws,0);
  assert.equal(defaultPosterConfig().backing,"stamp");
});

test("poster uses transparent artwork but retains explicitly selected backing",async()=>{
  const source=await readFile(new URL("../services/export-v2-service.js",import.meta.url),"utf8");
  assert.match(source,/art=renderPosterArtworkCanvas\(prepared.grid\)/);
  assert.match(source,/pad=\['none','stamp'\]\.includes\(cfg\.backing\)\?0/);
  assert.doesNotMatch(source,/const art=renderPatternCanvas/);
});

test("poster removes only exterior white without mutating source or enclosed white",()=>{
  const white={paletteId:"mard:H02",rgb:[255,255,255]},dark={paletteId:"mard:H07",rgb:[0,0,0]};
  const grid=Array.from({length:5},(_,y)=>Array.from({length:5},(_,x)=>x===0||y===0||x===4||y===4?white:dark));
  grid[2][2]=white;const before=structuredClone(grid),result=preparePosterArtwork(grid,{removeBackground:true});
  assert.equal(result.status,"removed");assert.equal(result.grid[0][0],null);assert.equal(result.grid[2][2],white);assert.deepEqual(grid,before);
  assert.equal(preparePosterArtwork(grid,{removeBackground:false}).status,"preserved");
});

test("poster preserves ambiguous, colored and wholly white artwork",()=>{
  for(const rgb of [[255,255,255],[15,80,30]]){
    const cell={paletteId:"mard:solid",rgb},grid=[[cell,cell],[cell,cell]];
    const result=preparePosterArtwork(grid,{removeBackground:true});assert.equal(result.status,"ambiguous");assert.deepEqual(result.grid,grid);
  }
  const green={paletteId:"mard:B12",rgb:[10,80,30]},red={paletteId:"mard:F03",rgb:[240,30,30]};
  const coloredBorder=[[green,green,green],[green,red,green],[green,green,green]];
  assert.deepEqual(preparePosterArtwork(coloredBorder,{removeBackground:true}),{grid:coloredBorder,status:"ambiguous"});
  assert.equal(preparePosterArtwork([[null,{paletteId:"mard:B12",rgb:[10,80,30]}]],{removeBackground:true}).status,"transparent");
});

test("default poster preserves white subject touching background until explicit opt-in",()=>{
  const white={paletteId:"mard:H02",rgb:[255,255,255]},dark={paletteId:"mard:H07",rgb:[0,0,0]};
  const grid=Array.from({length:5},(_,y)=>Array.from({length:5},(_,x)=>x===0||y===0||x===4||y===4?white:dark));
  grid[1][2]=white;grid[2][2]=white;
  assert.equal(defaultPosterConfig().removeBackground,false);
  const result=preparePosterArtwork(grid);
  assert.equal(result.status,"preserved");
  assert.equal(result.grid[1][2],white);assert.equal(result.grid[2][2],white);
});
