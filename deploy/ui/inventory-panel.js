/**
 * 库存面板（挂在工作台右侧「材料」栏的最后一节）。
 *
 * Stage C0 §2/§14：右栏那个 tab 从「库存」改名成「材料」，语义从「只读台账」
 * 扩到「本作品用豆 + 底板 + 采购」。**这个面板的每一项能力都原样保留** ——
 * 改名不是删功能的许可。材料面板里排在它上面的是 `renderMaterial()` 产出的
 * 备料口径用豆清单（总颗数 / 逐色号颗数 / 底板数量与实物厘米数）。
 *
 * 分工：
 * - 这里只管台账本身：概览、按图纸扣料、缺货提醒、用豆流水（可撤销回补）、CSV 导入导出、逐个色号的明细编辑。
 * - 「编一张用豆清单」（OCR 识别外部图纸 / 手工录入）交给 UsageDialog，因为它需要一张表格。
 *
 * 站内生成图纸的那条路径是本模块的重点：它的色号与颗数来自 state.stats，是精确值，
 * 因此「按当前图纸扣料」完全不需要 OCR —— 比参考实现（只有 OCR 一条路）更准也更快。
 */

const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
const number = (value) => Number(value || 0).toLocaleString("zh-CN", { useGrouping: false });
const timeLabel = (iso) => {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
};

function downloadText(filename, text, type = "text/csv;charset=utf-8") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export class InventoryPanel {
  constructor({ root, inventory, getStats, getProjectName = () => "", askConfirmation, onNotify = () => {}, onOpenUsage = () => {} }) {
    this.root = root;
    this.inventory = inventory;
    this.getStats = getStats;
    this.getProjectName = getProjectName;
    this.askConfirmation = askConfirmation;
    this.onNotify = onNotify;
    this.onOpenUsage = onOpenUsage;
    this.search = "";
    this.current = null;
    this.el = {};
  }

  mount() {
    this.root.innerHTML = `
      <div class="ws-section-title">库存概览</div>
      <div class="ws-readout" id="inv-overview">台账为空</div>
      <p class="ws-note" id="inv-message"></p>

      <div class="ws-section-title">按当前图纸扣料</div>
      <p class="ws-note">直接用图纸的色号与颗数统计，不经过 OCR，数目精确。</p>
      <div class="ws-readout" id="inv-deduct-preview">尚未生成图纸</div>
      <button type="button" class="ws-button ws-button-primary ws-wide" id="inv-deduct">按当前图纸扣料</button>

      <div class="ws-section-title">其他来源的用豆</div>
      <div class="inv-row">
        <button type="button" class="ws-button" id="inv-usage">识别外部图纸…</button>
        <button type="button" class="ws-button" id="inv-manual">手工录入…</button>
      </div>

      <div class="ws-section-title">台账</div>
      <div class="inv-row">
        <button type="button" class="ws-button" id="inv-export">导出 CSV</button>
        <button type="button" class="ws-button" id="inv-import">导入 CSV</button>
      </div>
      <input type="file" id="inv-import-file" accept=".csv,text/csv,text/plain" hidden>

      <div class="ws-section-title">缺货提醒</div>
      <div class="inv-list" id="inv-replenish"></div>

      <div class="ws-section-title">最近用豆</div>
      <div class="inv-list" id="inv-submissions"></div>

      <div class="ws-section-title">全部库存</div>
      <input type="search" class="inv-search" id="inv-search" placeholder="搜索色号 / 名称 / 位置 / 供应商" aria-label="搜索库存">
      <div class="inv-list" id="inv-items"></div>`;

    const $ = (selector) => this.root.querySelector(selector);
    this.el = {
      overview: $("#inv-overview"),
      message: $("#inv-message"),
      preview: $("#inv-deduct-preview"),
      deduct: $("#inv-deduct"),
      usage: $("#inv-usage"),
      manual: $("#inv-manual"),
      export: $("#inv-export"),
      import: $("#inv-import"),
      importFile: $("#inv-import-file"),
      replenish: $("#inv-replenish"),
      submissions: $("#inv-submissions"),
      search: $("#inv-search"),
      items: $("#inv-items"),
    };

    this.el.deduct.addEventListener("click", () => this.deductFromPattern());
    this.el.usage.addEventListener("click", () => this.onOpenUsage({ mode: "recognize" }));
    this.el.manual.addEventListener("click", () => this.onOpenUsage({ mode: "manual" }));
    this.el.export.addEventListener("click", () => this.exportCsv());
    this.el.import.addEventListener("click", () => this.el.importFile.click());
    this.el.importFile.addEventListener("change", async (event) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (file) await this.importCsv(file);
    });
    this.el.search.addEventListener("input", (event) => { this.search = event.target.value; this.renderItems(); });
    this.#mountDetail();

    this.inventory.subscribe(() => this.render());
    this.render();
  }

  /** 单色号明细编辑：一个对话框覆盖所有字段，列表本身只做浏览。 */
  #mountDetail() {
    const dialog = document.createElement("dialog");
    dialog.className = "ws-inv-dialog";
    dialog.innerHTML = `
      <div class="ws-inv-dialog-head"><strong id="inv-detail-title">色号</strong><button type="button" data-inv-cancel aria-label="关闭">×</button></div>
      <p class="ws-note" id="inv-detail-note"></p>
      <div class="ws-inv-dialog-grid">
        <label class="ws-field">名称<input id="inv-f-name" type="text"></label>
        <label class="ws-field">当前库存<input id="inv-f-stock" type="number" min="0" step="1"></label>
        <label class="ws-field">最低库存<input id="inv-f-min" type="number" min="0" step="1"></label>
        <label class="ws-field">单位<input id="inv-f-unit" type="text"></label>
        <label class="ws-field">位置<input id="inv-f-location" type="text" placeholder="抽屉 / 收纳盒"></label>
        <label class="ws-field">供应商<input id="inv-f-supplier" type="text"></label>
        <label class="ws-field ws-inv-wide">备注<input id="inv-f-note" type="text"></label>
        <label class="ws-field ws-inv-wide">补货（累加到库存）<input id="inv-f-add" type="number" min="0" step="1" placeholder="留空表示不补货"></label>
      </div>
      <div class="ws-inv-dialog-foot">
        <button type="button" class="ws-button inv-danger" id="inv-f-delete">删除色号</button>
        <div>
          <button type="button" class="ws-button" data-inv-cancel>取消</button>
          <button type="button" class="ws-button ws-button-primary" id="inv-f-save">保存</button>
        </div>
      </div>`;
    document.body.append(dialog);
    this.detail = dialog;
    dialog.addEventListener("click", (event) => { if (event.target.closest("[data-inv-cancel]")) dialog.close(); });
    dialog.querySelector("#inv-f-save").addEventListener("click", () => this.#saveDetail());
    dialog.querySelector("#inv-f-delete").addEventListener("click", () => this.#deleteDetail());
  }

  openDetail(code) {
    const item = this.inventory.getItem(code);
    this.current = code;
    const dialog = this.detail;
    dialog.querySelector("#inv-detail-title").textContent = code;
    dialog.querySelector("#inv-detail-note").textContent = item?.consumed
      ? `累计已用 ${number(item.consumed)} 颗 · 已有用豆记录，不能删除`
      : "还没有用豆记录。";
    const set = (id, value) => { dialog.querySelector(id).value = value ?? ""; };
    set("#inv-f-name", item?.name);
    set("#inv-f-stock", item?.stock ?? 0);
    set("#inv-f-min", item?.minStock ?? 0);
    set("#inv-f-unit", item?.unit || "颗");
    set("#inv-f-location", item?.location);
    set("#inv-f-supplier", item?.supplier);
    set("#inv-f-note", item?.note);
    set("#inv-f-add", "");
    dialog.querySelector("#inv-f-delete").disabled = Boolean(item?.consumed);
    if (!dialog.open) dialog.showModal();
  }

  #saveDetail() {
    const dialog = this.detail;
    const value = (id) => dialog.querySelector(id).value.trim();
    const stock = Number(value("#inv-f-stock")) || 0;
    const add = value("#inv-f-add");
    const patch = {
      name: value("#inv-f-name"),
      stock: add === "" ? stock : stock + (Number(add) || 0),
      minStock: Number(value("#inv-f-min")) || 0,
      unit: value("#inv-f-unit") || "颗",
      location: value("#inv-f-location"),
      supplier: value("#inv-f-supplier"),
      note: value("#inv-f-note"),
    };
    try {
      this.inventory.upsertItem(this.current, patch);
      this.onNotify(`${this.current} 已保存${add !== "" ? `（含补货 ${add} 颗）` : ""}。`);
      dialog.close();
    } catch (error) {
      dialog.querySelector("#inv-detail-note").textContent = error.message;
    }
  }

  async #deleteDetail() {
    if (this.askConfirmation && !await this.askConfirmation(`从台账中删除 ${this.current}？库存与安全线都会丢失。`)) return;
    try {
      this.inventory.removeItem(this.current);
      this.onNotify(`${this.current} 已从台账删除。`);
      this.detail.close();
    } catch (error) {
      this.detail.querySelector("#inv-detail-note").textContent = error.message;
    }
  }

  /** 站内图纸扣料：零 OCR，读 state.stats。 */
  async deductFromPattern() {
    const preview = this.inventory.previewFromPattern();
    if (!preview.lines.length) { this.setMessage("当前没有可扣料的图纸。"); return; }
    const parts = [`将按当前图纸扣减 ${preview.lines.length} 色共 ${number(preview.totalBeads)} 颗。`];
    if (preview.shortageCodes.length) parts.push(`其中 ${preview.shortageCodes.length} 个色号扣后为负。`);
    if (preview.missingCodes.length) parts.push(`${preview.missingCodes.length} 个色号台账里还没有，将按 0 库存新建。`);
    parts.push("继续吗？");
    if (this.askConfirmation && !await this.askConfirmation(parts.join(""))) return;
    try {
      const result = this.inventory.consume({
        lines: preview.lines.map((line) => ({ code: line.code, count: line.count, name: line.name, hex: line.hex })),
        source: "pattern",
        label: this.getProjectName() || "当前图纸",
      });
      this.setMessage(`已扣减 ${preview.lines.length} 色共 ${number(preview.totalBeads)} 颗${result.created.length ? `，新建 ${result.created.length} 个色号` : ""}。`);
    } catch (error) {
      this.setMessage(`扣料失败：${error.message}`);
    }
  }

  exportCsv() {
    const rows = this.inventory.listItems();
    if (!rows.length) { this.setMessage("台账是空的，没有可导出的内容。"); return; }
    downloadText(`拼豆库存-${new Date().toISOString().slice(0, 10)}.csv`, this.inventory.exportCsv());
    this.setMessage(`已导出 ${rows.length} 条库存记录。`);
  }

  async importCsv(file) {
    try {
      const result = this.inventory.importCsv(await file.text());
      const details = result.errors.length ? `，${result.errors.length} 行有问题：${result.errors.slice(0, 3).join("；")}${result.errors.length > 3 ? "…" : ""}` : "";
      this.setMessage(`CSV 导入完成：更新 ${result.imported} 条${details}`);
    } catch (error) {
      this.setMessage(`CSV 导入失败：${error.message}`);
    }
  }

  setMessage(message) { this.el.message.textContent = message; }

  render() {
    if (!this.el.overview) return;
    const overview = this.inventory.getOverview();
    this.el.overview.textContent = overview.itemCount
      ? `收录 ${overview.itemCount} 色 · 缺货 ${overview.lowCount} 色 · 总库存 ${number(overview.totalStock)} 颗`
      : "台账为空，导入 CSV 或按图纸扣料即可开始记录";

    const hasPattern = (this.getStats() || []).length > 0;
    this.el.deduct.disabled = !hasPattern;
    if (hasPattern) {
      const preview = this.inventory.previewFromPattern();
      const extra = preview.shortageCodes.length
        ? ` · ${preview.shortageCodes.length} 色不够`
        : preview.missingCodes.length ? ` · ${preview.missingCodes.length} 色未建档` : "";
      this.el.preview.textContent = `本图纸 ${preview.lines.length} 色 / ${number(preview.totalBeads)} 颗${extra}`;
    } else {
      this.el.preview.textContent = "尚未生成图纸";
    }

    this.renderReplenish();
    this.renderSubmissions();
    this.renderItems();
  }

  renderReplenish() {
    const rows = this.inventory.listReplenish();
    this.el.replenish.innerHTML = rows.length
      ? rows.map((item) => `<button type="button" class="inv-row-item" data-inv-open="${esc(item.code)}">
          <span class="ws-swatch" style="background:${esc(item.hex || "#ffffff")}"></span>
          <span class="inv-row-main"><strong>${esc(item.code)}</strong><small>${esc(item.name || "")}</small></span>
          <span class="inv-deficit">缺 ${number(item.deficit)}</span>
        </button>`).join("")
      : '<p class="ws-note">没有低于安全线的色号。</p>';
    this.el.replenish.querySelectorAll("[data-inv-open]").forEach((button) => button.addEventListener("click", () => this.openDetail(button.dataset.invOpen)));
  }

  renderSubmissions() {
    const rows = this.inventory.listSubmissions().slice(0, 6);
    this.el.submissions.innerHTML = rows.length
      ? rows.map((entry) => {
        const total = entry.lines.reduce((sum, line) => sum + line.count, 0);
        return `<div class="inv-submission ${entry.revertedAt ? "is-reverted" : ""}">
          <div><strong>${esc(entry.label || "未命名")}</strong><small>${timeLabel(entry.createdAt)} · ${entry.lines.length} 色 / ${number(total)} 颗${entry.revertedAt ? " · 已撤销" : ""}</small></div>
          <button type="button" class="ws-button" data-inv-revert="${esc(entry.id)}" ${entry.revertedAt ? "disabled" : ""}>撤销回补</button>
        </div>`;
      }).join("")
      : '<p class="ws-note">还没有用豆记录。</p>';
    this.el.submissions.querySelectorAll("[data-inv-revert]").forEach((button) => button.addEventListener("click", () => this.revert(button.dataset.invRevert)));
  }

  async revert(id) {
    if (this.askConfirmation && !await this.askConfirmation("撤销这次用豆会把扣掉的数量加回库存。继续吗？")) return;
    try {
      const entry = this.inventory.revert(id);
      const total = entry.lines.reduce((sum, line) => sum + line.count, 0);
      this.setMessage(`已撤销，回补 ${entry.lines.length} 色共 ${number(total)} 颗。`);
    } catch (error) {
      this.setMessage(`撤销失败：${error.message}`);
    }
  }

  renderItems() {
    const rows = this.inventory.listItems({ search: this.search });
    this.el.items.innerHTML = rows.length
      ? rows.map((item) => `<button type="button" class="inv-row-item" data-inv-open="${esc(item.code)}">
          <span class="ws-swatch" style="background:${esc(item.hex || "#ffffff")}"></span>
          <span class="inv-row-main"><strong>${esc(item.code)}</strong><small>${esc(item.name || "")}${item.location ? ` · ${esc(item.location)}` : ""}</small></span>
          <span class="inv-stock ${item.stock < 0 ? "is-negative" : item.deficit > 0 ? "is-low" : ""}">${number(item.stock)}${item.deficit > 0 ? `<small>缺 ${number(item.deficit)}</small>` : ""}</span>
        </button>`).join("")
      : `<p class="ws-note">${this.search ? "没有匹配的色号。" : "台账为空。"}</p>`;
    this.el.items.querySelectorAll("[data-inv-open]").forEach((button) => button.addEventListener("click", () => this.openDetail(button.dataset.invOpen)));
  }
}
