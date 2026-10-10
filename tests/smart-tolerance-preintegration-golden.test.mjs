import test from 'node:test';
import assert from 'node:assert/strict';
import { generateV2 } from '../smart-preprocessing/generation-engine-v2.mjs';

// Captured from the untouched pre-integration deploy engine, 2026-10-10.
// Oracle engine SHA256: 34f7d939c6f6cf99f10677f8bf43f0bee1ca4b468eadcdd1a0d34fc64824672b
// Persisted rows avoid comparing two branches of the newly modified engine.
const palette=[{code:'A',rgb:[120,120,120]},{code:'B',rgb:[121,121,121]},{code:'C',rgb:[230,30,30]}];
const fixtures=[
  {width:12,height:12,rows:['.AAAAAAACCCC','AAAAAAA.CCCC','AAAAAAAACCCC','AA.AAAAACCCC','AAAAAAAAC.CC','AAAAAAAACCCC','AAAA.AAACCCC','AAAAAAAACCC.','AAAAAAAACCCC','AAAAAA.ACCCC','AAAAAAAACCCC','A.AAAAAACCCC'],
    budgetRows:['.AAAAAAAAAAA','AAAAAAA.AAAA','AAAAAAAAAAAA','AA.AAAAAAAAA','AAAAAAAAA.AA','AAAAAAAAAAAA','AAAA.AAAAAAA','AAAAAAAAAAA.','AAAAAAAAAAAA','AAAAAA.AAAAA','AAAAAAAAAAAA','A.AAAAAAAAAA']},
  {width:17,height:11,rows:['.AAAAAAAAAAACCCCC','AA.AAAAAAAAACCCCC','AAAA.AAAAAAACCCCC','AAAAAA.AAAAACCCCC','AAAAAAAA.AAACCCCC','AAAAAAAAAA.ACCCCC','AAAAAAAAAAAA.CCCC','AAAAAAAAAAAACC.CC','AAAAAAAAAAAACCCC.','AAAAAAAAAAAACCCCC','A.AAAAAAAAAACCCCC'],
    budgetRows:['.AAAAAAAAAAAAAAAA','AA.AAAAAAAAAAAAAA','AAAA.AAAAAAAAAAAA','AAAAAA.AAAAAAAAAA','AAAAAAAA.AAAAAAAA','AAAAAAAAAA.AAAAAA','AAAAAAAAAAAA.AAAA','AAAAAAAAAAAAAA.AA','AAAAAAAAAAAAAAAA.','AAAAAAAAAAAAAAAAA','A.AAAAAAAAAAAAAAA']},
];
for(const fixture of fixtures) for(const maxColors of [0,1,2]) for(const accentProtection of [false,true]) {
  test(`disabled matches saved pre-integration matrix ${fixture.width}×${fixture.height}, budget=${maxColors}, accent=${accentProtection}`,()=>{
    const {width,height}=fixture, data=new Uint8ClampedArray(width*height*4);
    for(let i=0;i<width*height;i++) data.set([...palette[Math.floor((i%width)*3/width)].rgb,i%19===0?0:255],i*4);
    const expected=(maxColors===1?fixture.budgetRows:fixture.rows).map(row=>[...row].map(code=>code==='.'?null:structuredClone(palette.find(color=>color.code===code))));
    for(const smartColorTolerance of [undefined,{enabled:false,strength:100,policy:'quality-first'}]) {
      const result=generateV2({source:{width,height,data},width,height,palette,options:{sampling:'center',maxColors,accentProtection,smartColorTolerance}});
      assert.deepEqual(result.grid,expected);
    }
  });
}
