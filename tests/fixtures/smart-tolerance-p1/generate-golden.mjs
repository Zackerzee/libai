// Explicit checkpoint oracle only; do not regenerate golden from an optimized tree.
import {writeFile,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {cases} from './cases.mjs';
const base='9d46a5c5e5d077c72b948789e6bdba449558da2d';
if(!process.argv[2]) throw Error('Provide an independently archived checkpoint directory');
for(const [file,expected] of Object.entries({'services/smart-color-tolerance.mjs':'5e1040b8d48ff6d3bdc87b75f8ed331d5b056eda163af106cf4ad792d7167826','services/smart-color-tolerance-quality.mjs':'fd3f8659350eda78d73aac2f2e8565ecc6bb5fad09de0aa9dcfdb8526517419f'})) {
  const actual=createHash('sha256').update(await readFile(`${process.argv[2]}/${file}`)).digest('hex');
  if(actual!==expected) throw Error(`Refusing non-checkpoint oracle: ${file}`);
}
const {createSmartColorTolerance}=await import(pathToFileURL(`${process.argv[2]}/services/smart-color-tolerance.mjs`));
const results=cases().map(({name,input})=>{const c=createSmartColorTolerance(input);return {name,hierarchy:c.getHierarchy(),compiled:c.getCompiledHierarchy(),evaluations:Array.from({length:11},(_,i)=>c.evaluate(i*10))};});
await writeFile(new URL('./golden.json',import.meta.url),JSON.stringify({base,results}));
