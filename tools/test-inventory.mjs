import { readdir } from "node:fs/promises";
import { resolve, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

export const TEST_ROOTS = Object.freeze(["smart-preprocessing","tests","src","state"]);
export const REQUIRED_TEST_FILES = Object.freeze([
  "state/store.test.mjs",
  "tests/pixler-import.test.mjs",
  "tests/structural-diagnostics.test.mjs",
  "tests/repair-suggestion.test.mjs",
  "tests/professional-editing.test.mjs",
]);

async function walk(directory, root, output) {
  for (const entry of await readdir(directory,{withFileTypes:true})) {
    if (entry.name === ".git" || entry.name === "deploy") continue;
    const absolute=resolve(directory,entry.name);
    if(entry.isDirectory()) await walk(absolute,root,output);
    else if(entry.name.endsWith(".test.mjs")) output.push(relative(root,absolute).split(sep).join("/"));
  }
}

export async function auditTestInventory(root=process.cwd()) {
  const all=[]; await walk(root,root,all); all.sort();
  const configured=all.filter((file)=>TEST_ROOTS.some((testRoot)=>file===testRoot||file.startsWith(`${testRoot}/`)));
  const omitted=all.filter((file)=>!configured.includes(file));
  const missing=REQUIRED_TEST_FILES.filter((file)=>!all.includes(file));
  return {all,configured,omitted,missing,command:`node --test $(find ${TEST_ROOTS.join(" ")} -name '*.test.mjs' | sort)`};
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const inventory=await auditTestInventory();
  console.log(`Test files: ${inventory.configured.length}`);
  console.log(inventory.command);
  if(inventory.omitted.length||inventory.missing.length){
    if(inventory.omitted.length) console.error(`Outside configured roots: ${inventory.omitted.join(", ")}`);
    if(inventory.missing.length) console.error(`Missing required tests: ${inventory.missing.join(", ")}`);
    process.exitCode=1;
  }
}
