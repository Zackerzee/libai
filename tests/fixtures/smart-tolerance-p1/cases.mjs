const color = (id, rgb, code = id) => ({paletteId:id, code, rgb});
export function cases() {
  const p = [color('brand:A',[200,180,160]),color('brand:B',[202,182,162]),color('brand:C',[208,188,168]),color('brand:D',[30,32,34]),color('other:A',[200,180,160],'A')];
  const make = (name, indices, palette=p, extra={}) => ({name, input:{baselineGrid:indices.map(row=>row.map(i=>i===null?null:structuredClone(palette[i]))),palette:structuredClone(palette), ...extra}});
  const plain = n => ({protection:{protectionMap:Array(n).fill(0),tierMap:Array(n).fill(0)}});
  const list = [
    make('null-high-contrast-multibrand',[[0,1,null,4],[2,3,0,1]],p,plain(8)),
    make('chain-distance',[[0,1,2,0,1,2]],p,{...plain(6),limits:{minBaselineContrast:100}}),
    make('protected-conflict',[[0,1,2],[0,1,2]],p,{protection:{protectionMap:[1,0,0,0,1,0],tierMap:[0,0,2,0,0,0]},limits:{minBaselineContrast:100}}),
    make('default-protection',[[0,3,0],[1,2,1]]),
    make('all-null',[[null,null],[null,null]],p,plain(4)),
    make('empty',[],p,plain(0)),
    make('zero-width',[[],[]],p,plain(0)),
    make('lightness-hard-limit',[[0,1,2]],p,{...plain(3),limits:{maxDeltaL:0.1}}),
    make('ties',[[0,1,2,3]], [color('tie:C',[100,100,100]),color('tie:A',[101,101,101]),color('tie:B',[99,99,99]),color('tie:D',[102,102,102])],{...plain(4),limits:{minBaselineContrast:100}}),
  ];
  const metadata=make('nested-cell-metadata',[[0,1,2]],p,{...plain(3),limits:{minBaselineContrast:100}});
  metadata.input.baselineGrid[0][0].metadata={tag:'retained',nested:[1,{flag:true}]}; list.push(metadata);
  const sameMetadata=make('same-identity-distinct-cell-metadata',[[0,0,1,2]],p,{...plain(4),limits:{minBaselineContrast:100}});
  sameMetadata.input.baselineGrid[0][0].metadata={cell:0,nested:{values:[1,2]}};
  sameMetadata.input.baselineGrid[0][1].metadata={cell:1,nested:{values:[3,4]}};list.push(sameMetadata);
  list.push(make('protected-null',[[null,0,null],[1,null,2]],p,{protection:{protectionMap:[1,0,1,0,1,0],tierMap:[2,0,2,0,2,0]},limits:{minBaselineContrast:100}}));
  list.push(make('contrast-multiple-edge-order',[[0,1,2,3],[3,2,1,0],[1,0,3,2]],p,{...plain(12),limits:{maxDeltaE:100,maxDeltaL:100,minBaselineContrast:0,maxContrastLoss:0,minContrastRatio:1}}));
  for(const epsilon of [-1e-9,0,1e-9]) list.push(make(`limit-boundary-${epsilon}`,[[0,1,2,0]],p,{...plain(4),limits:{maxDeltaE:2.0+epsilon,maxDeltaL:1.0+epsilon,minBaselineContrast:100}}));
  let seed=0x91371; const next=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed;};
  for(let k=0;k<16;k++) {
    const palette=Array.from({length:5},(_,i)=>color(`random${k}:${i}`,Array.from({length:3},()=>next()%256)));
    const indices=Array.from({length:4},()=>Array.from({length:5},()=>{const n=next()%7;return n===6?null:n%5;}));
    const protectionMap=Array.from({length:20},()=>next()%5===0?1:0);
    list.push(make(`seeded-${k}`,indices,palette,{protection:{protectionMap,tierMap:Array(20).fill(0)},limits:k%2?{maxDeltaE:50,maxDeltaL:30}: {}}));
  }
  for(let k=0;k<10;k++) {
    const palette=Array.from({length:6+k%5},(_,i)=>color(`close${k}:${i}`,[170+next()%18,150+next()%18,130+next()%18]));
    const indices=Array.from({length:3},(_,y)=>Array.from({length:6},(_,x)=>{const n=next();return x===5&&y===2?null:n%palette.length;}));
    indices[0]=palette.slice(0,6).map((_,i)=>i);
    const protectionMap=Array.from({length:18},()=>next()%9===0?1:0);
    list.push(make(`close-seeded-${k}`,indices,palette,{protection:{protectionMap,tierMap:Array(18).fill(0)},limits:k%2?{minBaselineContrast:100}:{minBaselineContrast:1,minContrastRatio:0.65,maxContrastLoss:2}}));
  }
  return list;
}
