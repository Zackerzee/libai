#!/usr/bin/env node
/**
 * 静默失效审计：找出 catch 块里返回「宽松值」的位置。
 *
 * 形状：
 *   try { ... } catch (e) { console.warn(e); return null; }
 *   调用方：if (!x) return { allowed: true, skipped: true };
 *
 * 后果：外链挂了 → 加载失败 → 被吞 → 功能整体跳过 → 界面一切正常。
 * 2026-09-22 的 nsfwjs 404 就是这个形状，审查功能静默失效了很久。
 *
 * 用法：node tools/audit-silent-failures.mjs [文件...]
 */
import { readFileSync } from "node:fs";
import { relative } from "node:path";

const FILES = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ["app.js", "pricing.js"];

/** 宽松返回值：出现这些就说明失败被当成「没事」处理 */
const PERMISSIVE = /return\s+(null|true|false|\[\]|\{\}|undefined)\s*;/;
const PERMISSIVE_OBJ = /return\s*\{[^}]*\b(allowed|ok|success|skipped)\s*:\s*(true|false)[^}]*\}\s*;/;

let total = 0;
let flagged = 0;
const silent = [];

for (const file of FILES) {
  let src;
  try {
    src = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  const lines = src.split("\n");

  for (let i = 0; i < lines.length; i += 1) {
    if (!/\bcatch\s*(\([^)]*\))?\s*\{/.test(lines[i])) continue;
    total += 1;

    // 取 catch 块的正文（按花括号配平）
    // 注意：catch 行的 `{` 自己不算进深度，否则第一行就配平结束，块体只剩一行。
    let depth = 0;
    let started = false;
    const body = [];
    for (let j = i; j < lines.length; j += 1) {
      let line = lines[j];
      if (j === i) {
        // 丢掉 catch (...) 之前的收尾括号与它自己的开括号
        const at = line.indexOf("{", line.indexOf("catch"));
        line = at >= 0 ? line.slice(at + 1) : "";
        started = true;
        depth = 1;
      }
      for (const ch of line) {
        if (ch === "{") depth += 1;
        else if (ch === "}") depth -= 1;
      }
      body.push(line);
      if (depth <= 0) break;
      if (j - i > 40) break;
    }
    const text = body.join("\n");
    const hit = PERMISSIVE.test(text) || PERMISSIVE_OBJ.test(text);
    if (!hit) continue;

    // 只报「看起来像功能降级」的：附近出现功能相关词，或返回值带 allowed/skipped
    const near = lines.slice(Math.max(0, i - 12), i).join("\n");
    const feature = /load|fetch|import|model|safety|ocr|export|render|parse|decode|worker|nsfw|tesseract|jspdf/i.test(near + text);
    if (!feature) continue;

    // 区分两档：有可见反馈（setStatus / alert / 记录错误状态）vs 真静默
    const FEEDBACK = /setStatus\s*\(|window\.alert\s*\(|\.lastGenerationError\s*=|showToast|notify\s*\(/;
    const hasFeedback = FEEDBACK.test(text);
    if (!hasFeedback) silent.push({ file: relative(process.cwd(), file), line: i + 1, ret: (text.match(/return\s+[^;]+;/) || [""])[0].trim() });
    flagged += 1;
  }
}

if (silent.length) {
  console.log("== 真静默（失败后没有任何用户可见反馈）==");
  for (const s of silent) console.log(`  ${s.file}:${s.line}  ${s.ret}`);
}
console.log(`\ncatch 块总数 ${total}，疑似功能降级 ${flagged} 处，其中真静默 ${silent.length} 处`);
