#!/usr/bin/env node
/**
 * deploy/ 发布目录同步器。
 *
 * 为什么需要它：
 *   netlify.toml 里 publish = "deploy"，deploy/ 是手工维护的副本。
 *   2026-09-22 出过一次事故 —— deploy/ 缺了 styles/pixler-skin.css 和
 *   vendor/fusion-pixel/（81 个文件），index.html/app.js/ui/workspace.js 也是旧版。
 *   也就是说源码里做好的整套皮肤，一发布就会消失。
 *   靠人记着「改完源码要同步」是不可靠的，所以把收录规则写成清单，
 *   并让 `node --test` 能直接检出漂移。
 *
 * 用法：
 *   node tools/sync-deploy.mjs            # 同步（只增改，不删）
 *   node tools/sync-deploy.mjs --check    # 只报告差异，有漂移则退出码 1
 *   node tools/sync-deploy.mjs --prune    # 同步 + 删除 deploy 里的多余文件
 *
 * 注意：deploy/ 里有一个误 git init 出来的空仓库 deploy/.git，
 *       本脚本永不触碰它（既不复制也不删除）。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync, statSync, rmSync, existsSync } from "node:fs";
import { join, relative, dirname, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEPLOY = join(ROOT, "deploy");

/** 根目录下要发布进去的单文件 */
export const INCLUDE_FILES = [
  ".gitignore",
  ".nojekyll",
  "_headers",
  "netlify.toml",
  "vercel.json",
  "LICENSE",
  "README-独立站部署.md",
  "THIRD_PARTY_NOTICES.md",
  "ALGORITHM_AUDIT.md",
  "index.html",
  "algorithm-lab.html",
  "app.js",
  "styles.css",
  "pricing.html",
  "pricing.css",
  "pricing.js",
  "favicon.svg",
  "libai-logo-pixel.svg",
  "libai-logo.png",
];

/** 要发布进去的目录（递归） */
export const INCLUDE_DIRS = [
  "assets",
  "config",
  "importers",
  "services",
  "smart-preprocessing",
  "src",
  "state",
  "styles",
  "ui",
  "vendor",
];

/**
 * `docs/` 不发布。理由：
 *   - 站点任何页面都不链接它（已核对 index/pricing/algorithm-lab/app.js 零引用）；
 *   - 内容是内部工程文档 —— 算法 A/B 报告、批量验收记录、实施计划、审计，
 *     以及一个 1.2 MB 的 algorithm-ab-report.json；
 *   - 体积 3.7 MB，占发布目录 8.7 MB 的 43%。
 * 想重新发布只需把 "docs" 加回 INCLUDE_DIRS。
 */
export const EXCLUDED_DIRS = ["docs"];

/**
 * 排除规则。发布目录里不该出现测试与夹具：
 * 它们对线上没有任何作用，只会把源码暴露在公开路径下并白增体积。
 * 根目录的 tests/、tools/ 本来就不在 INCLUDE_DIRS 里。
 */
export const EXCLUDE = [
  /(^|\/)\.DS_Store$/,
  /(^|\/)\.git(\/|$)/,
  /\.test\.mjs$/,
  /(^|\/)tests\//,
  /(^|\/)fixtures\//,
  /(^|\/)__snapshots__\//,
  /\.map$/,
];

const excluded = (rel) => EXCLUDE.some((re) => re.test(rel));
const posix = (p) => p.split(sep).join("/");

/** 扫描时只跳过 .git —— 用于 extra 检测，被 EXCLUDE 排除的文件也必须现形 */
const walkAll = (dir, base = dir, filter = () => true) => {
  const out = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = posix(relative(base, abs));
    if (/(^|\/)\.git(\/|$)/.test(rel) || name === ".git") continue;
    if (!filter(rel)) continue;
    if (statSync(abs).isDirectory()) out.push(...walkAll(abs, base, filter));
    else out.push(rel);
  }
  return out;
};

const walk = (dir, base = dir) => walkAll(dir, base, (rel) => !excluded(rel));

/** 清单里「应该存在于 deploy」的全部相对路径 */
export function manifest() {
  const files = new Set();
  for (const f of INCLUDE_FILES) if (existsSync(join(ROOT, f))) files.add(f);
  for (const d of INCLUDE_DIRS) {
    const abs = join(ROOT, d);
    if (!existsSync(abs)) continue;
    for (const rel of walk(abs, ROOT)) files.add(rel);
  }
  return files;
}

const readIf = (p) => (existsSync(p) ? readFileSync(p) : null);
const same = (a, b) => (a === null || b === null ? a === b : a.equals(b));

/** 对比源码与 deploy，返回差异计划 */
export function plan() {
  const want = manifest();
  const added = [];
  const updated = [];
  for (const rel of [...want].sort()) {
    const src = readIf(join(ROOT, rel));
    const dst = readIf(join(DEPLOY, rel));
    if (dst === null) added.push(rel);
    else if (!same(src, dst)) updated.push(rel);
  }
  const extra = [];
  // 注意用 walkAll：被 EXCLUDE 排除的文件（*.test.mjs、tests/）如果已经躺在
  // deploy 里，也必须算作多余，否则 --prune 永远清不掉它们。
  for (const rel of walkAll(DEPLOY, DEPLOY).sort()) {
    if (!want.has(rel)) extra.push(rel);
  }
  return { added, updated, extra, total: want.size };
}

export function sync({ prune = false } = {}) {
  const p = plan();
  for (const rel of [...p.added, ...p.updated]) {
    const dst = join(DEPLOY, rel);
    mkdirSync(dirname(dst), { recursive: true });
    writeFileSync(dst, readFileSync(join(ROOT, rel)));
  }
  const removed = [];
  if (prune) {
    for (const rel of p.extra) {
      rmSync(join(DEPLOY, rel), { force: true });
      removed.push(rel);
    }
    pruneEmptyDirs(DEPLOY);
  }
  return { ...p, removed };
}

function pruneEmptyDirs(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const abs = join(dir, name);
    if (!statSync(abs).isDirectory()) continue;
    pruneEmptyDirs(abs);
    if (readdirSync(abs).length === 0) rmSync(abs, { recursive: true, force: true });
  }
}

function main() {
  const check = process.argv.includes("--check");
  const prune = process.argv.includes("--prune");
  const p = plan();

  const drift = p.added.length + p.updated.length + p.extra.length;
  if (check) {
    if (!drift) {
      console.log(`deploy/ 与源码一致（清单 ${p.total} 个文件）`);
      return 0;
    }
    console.log(`deploy/ 已漂移：缺 ${p.added.length} / 旧 ${p.updated.length} / 多 ${p.extra.length}`);
    for (const rel of p.added) console.log(`  缺   ${rel}`);
    for (const rel of p.updated) console.log(`  旧   ${rel}`);
    for (const rel of p.extra.slice(0, 40)) console.log(`  多   ${rel}`);
    if (p.extra.length > 40) console.log(`  ...还有 ${p.extra.length - 40} 个多余文件`);
    return 1;
  }

  const r = sync({ prune });
  console.log(`新增 ${r.added.length} / 更新 ${r.updated.length} / 删除 ${r.removed.length}（清单 ${r.total} 个文件）`);
  if (!prune && r.extra.length) {
    console.log(`另有 ${r.extra.length} 个多余文件未删除（加 --prune 清理）：`);
    for (const rel of r.extra.slice(0, 20)) console.log(`  ${rel}`);
    if (r.extra.length > 20) console.log(`  ...还有 ${r.extra.length - 20} 个`);
  }
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exit(main());
}
