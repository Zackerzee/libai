"use strict";
/* 金样图回归运行器（零依赖，仅需浏览器 + 本地静态服务器）。
 *
 * 原理：隐藏 iframe 加载真实 ../index.html（同源），跑完 init 后，运行器
 * 直接调用 iframe 里 app.js 的算法函数（经典脚本的顶层函数会挂在
 * contentWindow 上），对 manifest.json 里每个样例执行：
 *   导入图片 -> 设置粒度/模式 -> rasterize(dominant|portrait) -> 统计色号
 * record 模式把统计写入 golden/baseline/<id>.json；check 模式与基线比对。
 *
 * 用法：
 *   golden/golden.html                      # 手动运行（check）
 *   golden/golden.html?mode=record&auto=1   # 重新生成基线
 *   golden/golden.html?mode=check&auto=1    # 全量回归（适合发布前）
 *   golden/golden.html?fixture=portrait-a-52 # 只跑单个样例
 *
 * 注意：需要 http(s)/localhost 打开（同源 iframe + fetch），file:// 不可用。
 * 基线粒度依赖浏览器（人脸框、nsfw 模型可用性），建议同一台机器同款 Chrome 使用；
 * 换机器/浏览器时先 record 再 check。
 */
(() => {
  const params = new URLSearchParams(location.search);
  const MODE = params.get("mode") === "record" ? "record" : "check";
  const AUTO = params.has("auto");
  const ONLY = params.get("fixture");

  const frame = document.getElementById("app-frame");
  const rowsEl = document.getElementById("results");
  const summaryEl = document.getElementById("summary");
  const runBtn = document.getElementById("run");
  const recordBtn = document.getElementById("record");

  const results = [];
  let manifest = null;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  async function loadJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${url}`);
    return res.json();
  }

  function addRow(id, status, detail) {
    const tr = document.createElement("tr");
    const [cellStatus, cellId, cellMode, cellGrid, cellDetail] = ["td", "td", "td", "td", "td"]
      .map((tag) => document.createElement(tag));
    cellStatus.className = status;
    cellStatus.textContent = status === "run" ? "…" : status.toUpperCase();
    cellId.textContent = id;
    cellMode.textContent = detail.mode || "";
    cellGrid.textContent = detail.granularity != null ? detail.granularity : "";
    cellDetail.innerHTML = detail.message || "";
    tr.append(cellStatus, cellId, cellMode, cellGrid, cellDetail);
    rowsEl.append(tr);
    return tr;
  }

  function setRow(tr, status, message) {
    const cell = tr.cells[0];
    cell.className = status;
    cell.textContent = status.toUpperCase();
    const detail = tr.cells[4];
    detail.textContent = message || "";
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(new Error("读取图片失败"));
      reader.readAsDataURL(blob);
    });
  }

  function resolveFixtureUrl(file) {
    // manifest 内的相对路径以 golden/ 目录为基准
    return new URL(file, new URL("./", location.href)).href;
  }

  async function waitForApp(win, timeoutMs = 20000) {
    const startedAt = performance.now();
    const needed = ["rasterizeFaceAwarePortraitImage", "rasterizeImage", "getCurrentPalette",
      "captureSourceAspectRatio", "syncDimensionHeightFromWidth", "getGranularity", "getGridHeight"];
    while (performance.now() - startedAt < timeoutMs) {
      if (needed.every((name) => typeof win[name] === "function")) return;
      await sleep(150);
    }
    throw new Error("iframe 中 app.js 未就绪（请通过 http/localhost 打开本页）");
  }

  function loadImageInApp(win, dataUrl) {
    return new Promise((resolve, reject) => {
      const img = new win.Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("图片解码失败"));
      img.src = dataUrl;
    });
  }

  function summarize(result, grid) {
    const counts = new Map();
    let filled = 0;
    for (const row of grid) {
      for (const cell of row) {
        if (cell && cell.code) {
          counts.set(cell.code, (counts.get(cell.code) || 0) + 1);
          filled += 1;
        }
      }
    }
    const codes = [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([code, count]) => ({ code, count }));
    return {
      width: result.width,
      height: result.height,
      totalCells: result.width * result.height,
      filledCells: filled,
      colorCount: codes.length,
      codes,
      backgroundDecision: result.backgroundDecision || "",
      summary: result.summary || "",
    };
  }

  function compareMetrics(base, current, tolerance) {
    const issues = [];
    if (base.width !== current.width || base.height !== current.height) {
      issues.push(`尺寸 ${base.width}x${base.height} -> ${current.width}x${current.height}`);
    }
    if (Math.abs(base.colorCount - current.colorCount) > tolerance.colorCountDelta) {
      issues.push(`色数 ${base.colorCount} -> ${current.colorCount}（允许 ±${tolerance.colorCountDelta}）`);
    }
    const baseMap = new Map(base.codes.map((c) => [c.code, c.count]));
    const curMap = new Map(current.codes.map((c) => [c.code, c.count]));
    const missing = [...baseMap.keys()].filter((code) => !curMap.has(code));
    const extra = [...curMap.keys()].filter((code) => !baseMap.has(code));
    if (missing.length + extra.length > tolerance.codes) {
      issues.push(`色号集合差异 ${missing.length} 缺失 / ${extra.length} 新增（允许 ≤${tolerance.codes}）`);
    }
    const ratioIssues = [];
    for (const [code, baseCount] of baseMap) {
      const curCount = curMap.get(code);
      if (curCount == null) continue;
      const ratio = Math.abs(baseCount - curCount) / baseCount;
      if (ratio > tolerance.countRatio) {
        ratioIssues.push(`${code} 数量 ${baseCount}->${curCount} (${(ratio * 100).toFixed(0)}%)`);
      }
    }
    if (ratioIssues.length) {
      issues.push(`数量偏差超过 ${tolerance.countRatio * 100}%：${ratioIssues.slice(0, 3).join("、")}${ratioIssues.length > 3 ? "…" : ""}`);
    }
    return issues;
  }

  function downloadBaseline(id, payload) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  async function runFixture(fx) {
    const tr = addRow(fx.id, "run", { mode: fx.mode, granularity: fx.granularity, message: "运行中…" });
    const entry = { id: fx.id, mode: fx.mode, granularity: fx.granularity, status: "run", message: "" };
    try {
      const imageRes = await fetch(resolveFixtureUrl(fx.file));
      if (!imageRes.ok) {
        if (fx.skipIfMissing) {
          entry.status = "skip";
          entry.message = `图片缺失(HTTP ${imageRes.status})，已跳过（skipIfMissing）`;
          setRow(tr, "skip", entry.message);
          return entry;
        }
        throw new Error(`图片 HTTP ${imageRes.status}`);
      }
      const dataUrl = await blobToDataUrl(await imageRes.blob());
      const win = frame.contentWindow;
      await waitForApp(win);

      // 与真实 UI 相同的参数路径；跳过本地审查模型以隔离算法回归。
      win.state.sourceDataUrl = dataUrl;
      win.state.sourceName = fx.id;
      win.state.sourceSafetyChecked = true;
      if (win.els.granularityNumber) win.els.granularityNumber.value = String(fx.granularity);
      if (win.els.modeSelect) win.els.modeSelect.value = fx.mode === "portrait" ? "portrait" : "dominant";

      const image = await loadImageInApp(win, dataUrl);
      if (typeof win.captureSourceAspectRatio === "function") win.captureSourceAspectRatio(image);
      if (typeof win.syncDimensionHeightFromWidth === "function") win.syncDimensionHeightFromWidth(fx.granularity);

      const palette = win.getCurrentPalette();
      const result = fx.mode === "portrait"
        ? await win.rasterizeFaceAwarePortraitImage(image, palette)
        : win.rasterizeImage(image, palette);
      if (!result || !Array.isArray(result.grid) || !result.grid.length) {
        throw new Error("算法返回空结果");
      }
      const metrics = summarize(result, result.grid);
      const tolerance = fx.tolerance || { colorCountDelta: 2, codes: 3, countRatio: 0.2 };
      const baselinePath = new URL(`./baseline/${fx.id}.json`, new URL("./", location.href)).href;

      if (MODE === "record") {
        const payload = {
          id: fx.id,
          mode: fx.mode,
          granularity: fx.granularity,
          recordedAt: new Date().toISOString(),
          metrics,
        };
        downloadBaseline(fx.id, payload);
        entry.status = "record";
        entry.message = `已下载基线：${fx.id}.json（色数 ${metrics.colorCount}）`;
        setRow(tr, "pass", entry.message);
      } else {
        const baseline = await loadJson(baselinePath);
        const issues = compareMetrics(baseline.metrics, metrics, tolerance);
        entry.metrics = metrics;
        entry.issues = issues;
        if (issues.length) {
          entry.status = "fail";
          entry.message = issues.join("；");
          setRow(tr, "fail", entry.message);
        } else {
          entry.status = "pass";
          entry.message = `色数 ${metrics.colorCount}，与基线一致`;
          setRow(tr, "pass", entry.message);
        }
      }
    } catch (error) {
      entry.status = "fail";
      entry.message = error?.message || String(error);
      setRow(tr, "fail", entry.message);
    }
    results.push(entry);
    renderSummary();
    return entry;
  }

  function renderSummary() {
    const counts = { pass: 0, fail: 0, skip: 0, record: 0 };
    for (const entry of results) if (counts[entry.status] != null) counts[entry.status] += 1;
    summaryEl.textContent = `通过 ${counts.pass} · 失败 ${counts.fail} · 跳过 ${counts.skip} · 记录 ${counts.record} / 共 ${results.length}`;
  }

  async function runAll() {
    rowsEl.replaceChildren();
    results.length = 0;
    summaryEl.textContent = "运行中…";
    runBtn.disabled = true;
    recordBtn.disabled = true;
    try {
      manifest = await loadJson(new URL("./manifest.json", new URL("./", location.href)).href);
      const list = manifest.fixtures.filter((fx) => !ONLY || fx.id === ONLY);
      for (const fx of list) await runFixture(fx);
    } catch (error) {
      const tr = addRow("manifest", "fail", { mode: "", granularity: "", message: error?.message || String(error) });
      setRow(tr, "fail", "无法读取 manifest.json");
    } finally {
      runBtn.disabled = false;
      recordBtn.disabled = false;
    }
    renderSummary();
    window.__golden = { mode: MODE, results, manifest };
    console.info(`[golden:${MODE}]`, results.map((r) => `${r.id}:${r.status}`).join(", "));
    return results;
  }

  // 运行按钮按当前 URL 的 mode 执行：check 比对基线，record 重新生成基线。
  runBtn.addEventListener("click", runAll);
  recordBtn.addEventListener("click", () => { location.search = "mode=record"; });

  if (AUTO) runAll();
  window.__golden = { runAll, results };
})();
