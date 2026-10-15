#!/usr/bin/env node
/**
 * stage4-analyze.mjs —— 阶段 4 跑分结果 → 逐类 Δ 表 + 探针表。
 *
 * 只读 `/tmp/stage4-lab/metrics.json`，不改任何东西。
 * 输出三张表：
 *   ① 逐类 Δ 表（相对 current 列，每类一行 × 每候选一组 Δ 值）
 *   ② 探针表（每类的 expect 探针：current vs 各候选的实测值 + 判对错）
 *   ③ 候选汇总（用色/ΔE/边保留/细保留/碎化/孤点/ms 的类均值）
 */
import fs from "node:fs";

const FILE = process.argv[2] || "/tmp/stage4-lab/metrics.json";
const data = JSON.parse(fs.readFileSync(FILE, "utf8"));
const rows = data.results;

const CANDIDATES = data.candidates.filter((c) => !c.pending).map((c) => c.id);
const METRICS = ["perceptualError", "edgeRetention", "detailRetention", "fragmentation", "isolatedPixels", "usedColors", "runtimeMs"];

const byClass = new Map();
for (const r of rows) {
  if (!byClass.has(r.classId)) byClass.set(r.classId, new Map());
  byClass.get(r.classId).set(r.candidateId, r);
}

const r3 = (v) => (v == null ? "-" : String(Math.round(v * 1000) / 1000));
const r2 = (v) => (v == null ? "-" : String(Math.round(v * 100) / 100));

console.log("═══ ① 逐类 Δ 表（相对 current） ═══\n");
for (const [classId, map] of byClass) {
  const base = map.get("current");
  if (!base) continue;
  console.log(`── ${classId} ${base.classKey}  (路由 ${base.routedMode}) ──`);
  const head = ["候选".padEnd(18), "用色".padStart(6), "ΔΔE".padStart(8), "Δ边".padStart(8), "Δ细".padStart(8), "Δ碎".padStart(8), "Δ孤".padStart(7), "Δms".padStart(7)].join("");
  console.log(head);
  for (const id of CANDIDATES) {
    const r = map.get(id);
    if (!r) { console.log(id.padEnd(18) + "  (无行)"); continue; }
    const d = (k) => (r[k] == null || base[k] == null ? null : r[k] - base[k]);
    const mark = id === "current" ? "  ← 基线" : "";
    console.log(
      id.padEnd(18)
      + String(r.usedColors).padStart(6)
      + r3(d("perceptualError")).padStart(8)
      + r3(d("edgeRetention")).padStart(8)
      + r3(d("detailRetention")).padStart(8)
      + r2(d("fragmentation")).padStart(8)
      + String(r.isolatedPixels - base.isolatedPixels).padStart(7)
      + String(r.runtimeMs - base.runtimeMs).padStart(7)
      + mark,
    );
  }
  console.log("");
}

console.log("\n═══ ② 探针表（current vs 候选） ═══\n");
for (const [classId, map] of byClass) {
  const base = map.get("current");
  if (!base) continue;
  const probeIds = Object.keys(base.probes || {});
  if (!probeIds.length) continue;
  console.log(`── ${classId} ${base.classKey} ──`);
  for (const pid of probeIds) {
    const p0 = base.probes[pid];
    console.log(`  探针 ${pid}  expect=${p0.expect ?? "-"}  current=${JSON.stringify(p0.actual ?? p0.value ?? p0)}`);
    for (const id of CANDIDATES) {
      if (id === "current") continue;
      const r = map.get(id);
      const p = r?.probes?.[pid];
      if (!p) continue;
      const same = JSON.stringify(p.actual ?? p.value ?? p) === JSON.stringify(p0.actual ?? p0.value ?? p0);
      console.log(`      ${id.padEnd(18)} ${same ? "= 同基线" : "≠ 变了 "} ${JSON.stringify(p.actual ?? p.value ?? p)}`);
    }
  }
  console.log("");
}

console.log("\n═══ ③ 候选汇总（类均值） ═══\n");
console.log(["候选".padEnd(20), "行".padStart(4), "ΔE".padStart(8), "边".padStart(7), "细".padStart(7), "碎".padStart(8), "孤".padStart(7), "用色".padStart(7), "ms".padStart(7)].join(""));
for (const id of CANDIDATES) {
  const list = rows.filter((r) => r.candidateId === id && !r.error);
  if (!list.length) { console.log(id.padEnd(20) + "  (无行)"); continue; }
  const avg = (k) => list.reduce((a, b) => a + (b[k] ?? 0), 0) / list.length;
  console.log(
    id.padEnd(20)
    + String(list.length).padStart(4)
    + r3(avg("perceptualError")).padStart(8)
    + r3(avg("edgeRetention")).padStart(7)
    + r3(avg("detailRetention")).padStart(7)
    + r2(avg("fragmentation")).padStart(8)
    + r2(avg("isolatedPixels")).padStart(7)
    + r2(avg("usedColors")).padStart(7)
    + r2(avg("runtimeMs")).padStart(7),
  );
}

console.log("\n═══ ④ 候选自报诊断（各类累计） ═══\n");
for (const id of CANDIDATES) {
  const list = rows.filter((r) => r.candidateId === id && r.labDetail);
  if (!list.length) { console.log(`${id}: 无诊断`); continue; }
  const key = Object.keys(list[0].labDetail)[0];
  const sums = {};
  for (const r of list) {
    const d = r.labDetail[key];
    if (!d) continue;
    for (const [k, v] of Object.entries(d)) if (typeof v === "number") sums[k] = (sums[k] || 0) + v;
  }
  console.log(`${id}  [${key}]  ${JSON.stringify(sums)}`);
}
