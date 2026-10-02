/**
 * build-background-fixtures.mjs — Stage B2 §13 §19
 *
 * 把 tests/background-fixtures.mjs 里的绘制函数编码成真实 PNG，
 * 给真机验收（tools/b2-background-probe.mjs）上传用。
 *
 * 为什么必须共用同一份绘制函数：如果单测用 A 图、验收用 B 图，
 * 「单测全绿」就证明不了线上那张图的行为。这里的 `paint` 直接来自夹具模块，
 * `rasterizeSource` 也是同一个 —— 两侧是**同一张图的两种表示**。
 *
 * 用法：node tools/build-background-fixtures.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng } from "../src/algorithms/engines/hybrid-v2/png-io.mjs";
import { BACKGROUND_FIXTURES, FIXTURE_SIZE, buildFixtureData, rasterizeSource } from "../tests/background-fixtures.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "tests/fixtures/background");
const SCALE = 4;

mkdirSync(OUT_DIR, { recursive: true });

const manifest = [];
for (const fixture of BACKGROUND_FIXTURES) {
  const data = buildFixtureData(FIXTURE_SIZE, FIXTURE_SIZE, fixture.paint);
  const source = rasterizeSource(data, SCALE);
  const file = path.join(OUT_DIR, `${fixture.id}.png`);
  writeFileSync(file, encodePng(source));
  manifest.push({
    id: fixture.id,
    className: fixture.className,
    expect: fixture.expect,
    why: fixture.why,
    file: `${fixture.id}.png`,
    width: source.width,
    height: source.height,
  });
  console.log(`${fixture.id.padEnd(24)} ${source.width}×${source.height}  expect=${fixture.expect}`);
}

writeFileSync(path.join(OUT_DIR, "manifest.json"), `${JSON.stringify({ scale: SCALE, fixtures: manifest }, null, 2)}\n`);
console.log(`\n${manifest.length} 张夹具 → ${path.relative(ROOT, OUT_DIR)}`);
