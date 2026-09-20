/**
 * 用豆清单对话框：OCR 识别结果的校正表 + 手工录入，共用同一张表格。
 *
 * 为什么共用一个对话框：识别失败、识别错误、完全没有图（只想知道"这批豆怎么扣"）
 * 这三种情况，用户要做的动作其实是同一件事 —— 编一张"色号 + 颗数"的表。分成三个
 * 界面只会让人多找三次入口。
 *
 * 每一行都同时给出三件信息，让人工核对变快：
 * - OCR 读到的编号与原始文本；
 * - 色块采样色匹配到本站色卡的结果（OCR 读错编号时这是最可靠的线索，可一键采纳）；
 * - 扣料后的库存余量（负数即账面缺料，提前暴露而不是扣完才发现）。
 */

import { imageDataFromSource } from "../services/ocr-service.js?v=20260917-inventory";

const STATUS_CLASS = { ok: "is-ok", review: "is-review", failed: "is-failed" };

export class UsageDialog {
  constructor({ inventory, recognition, ocr, getStats, getPaletteCodes, onNotify = () => {}, askConfirmation }) {
    this.inventory = inventory;
    this.recognition = recognition;
    this.ocr = ocr;
    this.getStats = getStats;
    this.getPaletteCodes = getPaletteCodes || (() => new Set());
    this.onNotify = onNotify;
    this.askConfirmation = askConfirmation;
    this.rows = [];
    this.busy = false;
    this.meta = null;
    this.el = this.#build();
  }

  #build() {
    const dialog = document.createElement("dialog");
    dialog.className = "ws-usage-dialog";
    dialog.id = "ws-usage-dialog";
    dialog.innerHTML = `
      <div class="ws-usage-head">
        <div>
          <strong>用豆清单</strong>
          <small id="ws-usage-subtitle">识别外部图纸，或直接手工录入</small>
        </div>
        <button type="button" class="ws-usage-close" data-usage-close aria-label="关闭">×</button>
      </div>
      <div class="ws-usage-toolbar">
        <button type="button" class="ws-button" id="ws-usage-pick">选择图纸并识别</button>
        <input type="file" id="ws-usage-file" accept="image/*" hidden>
        <button type="button" class="ws-button" id="ws-usage-from-pattern">按当前图纸填入</button>
        <button type="button" class="ws-button" id="ws-usage-add">添加一行</button>
        <button type="button" class="ws-button" id="ws-usage-clear">清空</button>
      </div>
      <p class="ws-note" id="ws-usage-status"></p>
      <div class="ws-usage-table-host">
        <table class="ws-usage-table">
          <thead><tr><th></th><th>编号</th><th>颗数</th><th>提示</th><th></th></tr></thead>
          <tbody id="ws-usage-body"></tbody>
        </table>
      </div>
      <div class="ws-usage-foot">
        <span class="ws-note" id="ws-usage-total"></span>
        <div>
          <button type="button" class="ws-button" data-usage-close>取消</button>
          <button type="button" class="ws-button ws-button-primary" id="ws-usage-confirm">确认扣料</button>
        </div>
      </div>`;
    document.body.append(dialog);

    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-usage-close]")) this.close(); });
    dialog.querySelector("#ws-usage-pick").addEventListener("click", () => dialog.querySelector("#ws-usage-file").click());
    dialog.querySelector("#ws-usage-file").addEventListener("change", (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) this.recognizeFile(file);
    });
    dialog.querySelector("#ws-usage-from-pattern").addEventListener("click", () => this.fillFromPattern());
    dialog.querySelector("#ws-usage-add").addEventListener("click", () => { this.rows.push(this.#blankRow()); this.render(); });
    dialog.querySelector("#ws-usage-clear").addEventListener("click", () => { this.rows = []; this.render(); });
    dialog.querySelector("#ws-usage-confirm").addEventListener("click", () => this.confirm());
    dialog.querySelector("#ws-usage-body").addEventListener("input", (event) => this.#onEdit(event));
    dialog.querySelector("#ws-usage-body").addEventListener("click", (event) => this.#onTableClick(event));
    return dialog;
  }

  #blankRow() {
    return { code: "", count: null, text: "", rgb: null, hex: "", match: null, agreed: null, status: "review", statusLabel: "手工录入", warnings: [], confidence: 0 };
  }

  #onEdit(event) {
    const input = event.target.closest("[data-usage-field]");
    if (!input) return;
    const index = Number(input.dataset.index);
    const row = this.rows[index];
    if (!row) return;
    if (input.dataset.usageField === "code") row.code = input.value.trim().toUpperCase();
    else row.count = input.value === "" ? null : Math.max(0, Math.round(Number(input.value) || 0));
    this.#renderFooter();
  }

  #onTableClick(event) {
    const remove = event.target.closest("[data-usage-remove]");
    if (remove) {
      this.rows.splice(Number(remove.dataset.usageRemove), 1);
      this.render();
      return;
    }
    const adopt = event.target.closest("[data-usage-adopt]");
    if (adopt) {
      const row = this.rows[Number(adopt.dataset.usageAdopt)];
      if (row?.match) {
        row.code = row.match.code;
        row.agreed = true;
        row.warnings = [];
        row.status = row.count ? "ok" : "review";
        row.statusLabel = row.count ? "已识别" : "需核对";
        this.render();
      }
    }
  }

  open({ mode = "recognize" } = {}) {
    this.rows = [];
    this.meta = null;
    this.setStatus(mode === "manual" ? "手工录入：填好编号与颗数后确认扣料。" : "选择一张外部图纸，或直接手工录入。");
    this.el.querySelector("#ws-usage-subtitle").textContent = mode === "manual" ? "手工录入" : "识别外部图纸，或直接手工录入";
    this.render();
    if (!this.el.open) this.el.showModal();
  }

  close() { if (this.el.open) this.el.close(); }

  setStatus(message) { this.el.querySelector("#ws-usage-status").textContent = message; }

  /** 用当前图纸的精确统计填表 —— 站内图纸那条零 OCR 路径。 */
  fillFromPattern() {
    const stats = this.getStats() || [];
    if (!stats.length) { this.setStatus("当前还没有生成图纸，无法填入。"); return; }
    this.rows = stats.map((color) => ({
      code: String(color.code || "").toUpperCase(),
      count: color.count,
      text: "来自当前图纸统计",
      rgb: color.rgb || null,
      hex: color.hex || "",
      match: null,
      agreed: true,
      status: "ok",
      statusLabel: "图纸统计",
      warnings: [],
      confidence: 100,
    }));
    this.meta = { source: "pattern", label: "当前图纸" };
    this.setStatus(`已按当前图纸填入 ${this.rows.length} 个色号，颗数来自图纸统计，无需 OCR。`);
    this.render();
  }

  async recognizeFile(file) {
    if (this.busy) return;
    this.busy = true;
    this.setStatus(`正在读取 ${file.name}…`);
    try {
      const { imageData } = await imageDataFromSource(file);
      this.setStatus("正在准备 OCR 引擎（首次约 10 MB，之后走缓存）…");
      const result = await this.recognition.recognize(imageData, {
        onProgress: (entry) => this.setStatus(entry.message),
      });
      this.rows = result.rows.map((row) => ({ ...row }));
      this.meta = { source: "ocr", label: file.name, image: result.image, warnings: result.warnings };
      const { total, ok, review, failed } = result.counts;
      if (!total) {
        this.setStatus("没有在这张图里找到图例色块。可以改用「按当前图纸填入」或手工添加行。");
      } else {
        this.setStatus(`识别到 ${total} 条：${ok} 条可直接用，${review} 条需核对，${failed} 条未识别。请检查后再扣料。`);
      }
      this.render();
    } catch (error) {
      this.setStatus(`识别失败：${error.message}。仍可手工录入或改用「按当前图纸填入」。`);
    } finally {
      this.busy = false;
    }
  }

  render() {
    const body = this.el.querySelector("#ws-usage-body");
    body.innerHTML = this.rows.map((row, index) => {
      const swatch = row.hex ? `<span class="ws-swatch" style="background:${row.hex}" title="色块采样色 ${row.hex}"></span>` : '<span class="ws-swatch ws-swatch-empty" title="没有采样到颜色"></span>';
      const mismatch = row.match && row.agreed === false
        ? `<button type="button" class="ws-usage-adopt" data-usage-adopt="${index}">用 ${row.match.code}</button>` : "";
      const hints = [
        ...(row.statusLabel ? [`<span class="ws-usage-badge ${STATUS_CLASS[row.status] || ""}">${row.statusLabel}</span>`] : []),
        row.text && row.text !== "空" ? `<span class="ws-usage-text">${esc(row.text)}</span>` : "",
        ...row.warnings.map((warning) => `<span class="ws-usage-warn">${esc(warning)}</span>`),
        mismatch,
      ].filter(Boolean).join(" ");
      return `<tr>
        <td>${swatch}</td>
        <td><input class="ws-usage-code" data-usage-field="code" data-index="${index}" value="${esc(row.code)}" placeholder="如 H07" aria-label="第 ${index + 1} 行编号"></td>
        <td><input class="ws-usage-count" data-usage-field="count" data-index="${index}" type="number" min="0" step="1" value="${row.count ?? ""}" aria-label="第 ${index + 1} 行颗数"></td>
        <td class="ws-usage-hint">${hints}</td>
        <td><button type="button" class="ws-usage-remove" data-usage-remove="${index}" aria-label="删除第 ${index + 1} 行">×</button></td>
      </tr>`;
    }).join("") || `<tr><td colspan="5" class="ws-usage-empty">还没有条目。选择一张图纸识别、按当前图纸填入，或手工添加一行。</td></tr>`;
    this.#renderFooter();
  }

  #renderFooter() {
    const lines = this.#lines();
    const total = lines.reduce((sum, line) => sum + line.count, 0);
    const unknown = lines.filter((line) => !this.getPaletteCodes().has(line.code));
    const parts = [`共 ${lines.length} 色 · ${total.toLocaleString("zh-CN", { useGrouping: false })} 颗`];
    if (unknown.length) parts.push(`${unknown.length} 个编号不在当前色卡`);
    this.el.querySelector("#ws-usage-total").textContent = parts.join(" · ");
    this.el.querySelector("#ws-usage-confirm").disabled = !lines.length || this.busy;
  }

  #lines() {
    const merged = new Map();
    for (const row of this.rows) {
      const code = String(row.code || "").trim().toUpperCase();
      const count = Math.max(0, Math.round(Number(row.count) || 0));
      if (!code || count <= 0) continue;
      merged.set(code, (merged.get(code) || 0) + count);
    }
    return [...merged.entries()].map(([code, count]) => ({ code, count }));
  }

  async confirm() {
    const lines = this.#lines();
    if (!lines.length) return;
    const total = lines.reduce((sum, line) => sum + line.count, 0);
    const shortages = lines.map((line) => {
      const item = this.inventory.getItem(line.code);
      const after = (item?.stock ?? 0) - line.count;
      return after < 0 ? `${line.code} 扣后 ${after}` : null;
    }).filter(Boolean);
    const message = shortages.length
      ? `将扣减 ${lines.length} 色共 ${total.toLocaleString("zh-CN", { useGrouping: false })} 颗，其中 ${shortages.length} 个色号扣后为负（${shortages.slice(0, 4).join("、")}${shortages.length > 4 ? "…" : ""}）。继续吗？`
      : `将扣减 ${lines.length} 色共 ${total.toLocaleString("zh-CN", { useGrouping: false })} 颗。继续吗？`;
    if (this.askConfirmation && !await this.askConfirmation(message)) return;
    try {
      const result = this.inventory.consume({
        lines: lines.map((line) => ({ ...line, name: "" })),
        source: this.meta?.source || "manual",
        label: this.meta?.label || "手工录入",
      });
      const created = result.created.length ? `，其中 ${result.created.length} 个色号是新建的（原库存按 0 计）` : "";
      this.onNotify(`已扣减 ${lines.length} 色共 ${total.toLocaleString("zh-CN", { useGrouping: false })} 颗${created}。`);
      this.close();
    } catch (error) {
      this.setStatus(`扣料失败：${error.message}`);
    }
  }
}

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
