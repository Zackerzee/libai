#!/usr/bin/env node
/**
 * Stage C0 §12 —— 四档视口的可达性复核 + 截图网格。
 *
 * ── 为什么不是一个新探针 ─────────────────────────────────────────────────
 * §12 要的是「生成模式在 Tablet / Mobile 视口下仍然可达」。
 * 这句话的判据和桌面档**是同一套**（九条判据 + 真点击校准），
 * 差别只有 viewport。所以这里不重写探针，而是**把已有的可达性探针按视口跑四遍**，
 * 再汇总成一个浏览页 —— 四个探针各自的结论会漂，一份汇总不会。
 *
 * ── 关键实现点 ───────────────────────────────────────────────────────────
 * 视口**不能只靠 `--window-size`**（headless 下那是窗口尺寸，不是 layout viewport）。
 * `tools/ui-reachability-probe.mjs` 除了 `--window-size`，还会发
 * `Emulation.setDeviceMetricsOverride` 把 layout viewport 钉死 —— 断点
 * （760 / 1180 / 1280）是按 CSS px 判的，差 20px 就会把「刚过断点」的档测错。
 *
 * 用法：
 *   node tools/c0-viewport-qa.mjs
 *   OUT_DIR=<交付目录> node tools/c0-viewport-qa.mjs
 *   LIBMS_VIEWPORTS=1440x900,390x844 node tools/c0-viewport-qa.mjs   # 只跑几档
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT = process.env.OUT_DIR || path.join(ROOT, "outputs", "stage-c0-workspace");
const PROBE = path.join(ROOT, "tools", "ui-reachability-probe.mjs");

/** 四档视口。名字进目录名与汇总表，别改。 */
const VIEWPORTS = (process.env.LIBMS_VIEWPORTS || "1440x900,1280x800,768x1024,390x844")
  .split(",").map((s) => s.trim()).filter(Boolean)
  .map((spec) => {
    const [w, h] = spec.split("x").map(Number);
    const label = w >= 1280 ? `桌面 ${w}` : w > 760 ? `窄桌面 ${w}` : w > 500 ? `平板 ${w}` : `手机 ${w}`;
    return { spec, width: w, height: h, label, dir: path.join(OUT, "viewport-qa", spec) };
  });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const run = (cmd, args, opts) => new Promise((resolve) => {
  const child = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  child.on("close", (code) => resolve({ code, out }));
});

const summary = [];

for (const [index, vp] of VIEWPORTS.entries()) {
  fs.mkdirSync(vp.dir, { recursive: true });
  // 端口按档错开，避免上一档的 Chrome / 服务器还没退干净就撞车。
  const cdpPort = 9500 + index * 2;
  const servePort = 8900 + index * 2;
  console.log(`\n════ ${vp.label}（${vp.spec}）════`);
  // 子进程必须**自己起服务器**：`LIBMS_BASE` 一旦从外层 shell 继承进来，
  // 探针就会去连那个外部地址、把 SERVE_PORT 完全忽略掉 —— 四档就都打在同一个
  // 服务器上，viewport 只剩窗口尺寸在变，这一档的结论是假的。
  const childEnv = { ...process.env };
  delete childEnv.LIBMS_BASE;
  const { code, out } = await run(process.execPath, [PROBE], {
    env: {
      ...childEnv,
      LIBMS_VIEWPORT: vp.spec,
      OUT_DIR: vp.dir,
      CDP_PORT: String(cdpPort),
      SERVE_PORT: String(servePort),
    },
    cwd: ROOT,
  });
  fs.writeFileSync(path.join(vp.dir, "console.log"), out);

  let results = [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(vp.dir, "reachability.json"), "utf8"));
    results = Array.isArray(parsed) ? parsed : (parsed.results || []);
  } catch { /* 没有 JSON 就是这一档没跑到最后 */ }

  const pass = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok);
  console.log(`  ${pass}/${results.length} PASS · ${fail.length} FAIL · exit=${code}`);
  for (const f of fail) console.log(`    ✗ ${f.name}  — ${f.detail}`);
  if (!results.length) console.log("    ⚠️ 没有解析到 reachability.json —— 看这一档的 console.log");

  summary.push({ ...vp, exitCode: code, pass, total: results.length, fail, results });
  await sleep(1500);
}

/* ── 汇总页 ─────────────────────────────────────────────────────────── */
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const shots = ["01-landing", "02-workspace", "03-generation-panel-via-real-click"];

const rowsHtml = summary.map((s) => `
  <tr>
    <td>${esc(s.label)}<br><small>${esc(s.spec)}</small></td>
    <td class="${s.fail.length ? "bad" : "good"}">${s.pass} / ${s.total}</td>
    <td>${s.fail.length ? s.fail.map((f) => `<code>${esc(f.name)}</code><br><small>${esc(f.detail)}</small>`).join("<hr>") : "—"}</td>
  </tr>`).join("");

const gridHtml = summary.map((s) => `
  <section>
    <h3>${esc(s.label)} · ${esc(s.spec)} <small>${s.pass}/${s.total} PASS</small></h3>
    <div class="row">
      ${shots.map((name) => {
        const file = path.join(s.dir, `${name}.png`);
        return fs.existsSync(file)
          ? `<figure><img src="${esc(path.relative(OUT, file))}" alt="${esc(name)}"><figcaption>${esc(name)}</figcaption></figure>`
          : `<figure class="missing"><figcaption>${esc(name)}（缺）</figcaption></figure>`;
      }).join("")}
    </div>
  </section>`).join("");

const html = `<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<title>STAGE C0 · 四档视口可达性 QA</title>
<style>
  :root { color-scheme: light; }
  body { margin:0; padding:28px 32px 60px; background:#f7f7f5; color:#1d1d1b;
         font:14px/1.6 -apple-system,"PingFang SC","Microsoft YaHei",sans-serif; }
  h1 { font-size:22px; margin:0 0 6px; }
  h3 { font-size:15px; margin:26px 0 10px; }
  h3 small { color:#6b6b66; font-weight:400; }
  .lead { color:#55554f; margin:0 0 22px; }
  table { border-collapse:collapse; background:#fff; width:100%; max-width:1100px;
          box-shadow:0 1px 3px #0000000f; border-radius:6px; overflow:hidden; }
  th,td { text-align:left; padding:10px 14px; border-bottom:1px solid #e7e7e2; vertical-align:top; }
  th { background:#fafaf8; font-weight:600; }
  td.good { color:#127a3a; font-weight:600; }
  td.bad  { color:#b3261e; font-weight:600; }
  code { background:#f2f2ee; padding:1px 5px; border-radius:3px; font-size:12px; }
  hr { border:0; border-top:1px dashed #dcdcd6; margin:8px 0; }
  .row { display:flex; gap:14px; overflow-x:auto; padding-bottom:6px; }
  figure { margin:0; flex:0 0 auto; background:#fff; border:1px solid #e7e7e2; border-radius:6px; padding:8px; }
  figure img { display:block; max-height:520px; width:auto; }
  figure.missing { min-width:220px; min-height:120px; display:flex; align-items:center; justify-content:center; color:#b3261e; }
  figcaption { margin-top:6px; font-size:12px; color:#6b6b66; }
</style></head>
<body>
  <h1>STAGE C0 · 四档视口可达性 QA</h1>
  <p class="lead">每档跑一遍 <code>tools/ui-reachability-probe.mjs</code>（九条判据 + 真点击校准），
     视口用 <code>Emulation.setDeviceMetricsOverride</code> 钉死，不靠 <code>--window-size</code>。
     断点：<code>≤760px</code> 左轨变贴底横向条、右栏变贴右浮层。</p>
  <table>
    <thead><tr><th>视口</th><th>可达性</th><th>FAIL</th></tr></thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  ${gridHtml}
</body></html>`;

fs.mkdirSync(OUT, { recursive: true });
const htmlPath = path.join(OUT, "visual-qa.html");
fs.writeFileSync(htmlPath, html);

console.log("\n════════ 四档汇总 ════════");
for (const s of summary) console.log(`${s.label.padEnd(10)} ${s.spec.padEnd(9)} ${s.pass}/${s.total} PASS · ${s.fail.length} FAIL`);
console.log(`\n浏览页：${htmlPath}`);
