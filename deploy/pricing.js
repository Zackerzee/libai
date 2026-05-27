const STORAGE_KEY = "handmade-pricing-console-v1";

const CHANNEL_FEES = {
  xiaohongshu: 5,
  douyin: 5,
  private: 0,
  offline: 10,
  custom: 5,
};

const FIELD_ALIASES = {
  type: ["类型", "类别", "分类", "主配", "主配类型", "组件类型", "主体配饰"],
  name: ["产品", "产品/款式", "商品", "商品名称", "品名", "款式", "名称", "sku", "货号", "物料", "物料名称"],
  quantity: ["数量", "件数", "采购数量", "下单数量", "qty", "quantity", "pcs"],
  unitCost: ["进价", "采购单价", "单价", "成本", "主材成本", "材料成本", "unitcost", "price"],
  totalCost: ["总价", "金额", "总金额", "采购金额", "合计", "小计", "total"],
  toolCost: ["工具", "工具摊销", "工具成本"],
  shipping: ["快递", "快递费", "物流", "物流费", "运费"],
  packaging: ["包装", "包装费"],
  laborHours: ["制作小时", "工时", "制作时间", "时间"],
  otherCost: ["其他", "其他成本", "损耗", "赠品"],
};

const settingIds = [
  "monthly-income",
  "monthly-hours",
  "default-labor-hours",
  "default-tool-cost",
  "default-shipping",
  "default-packaging",
  "monthly-rent",
  "monthly-utilities",
  "monthly-fixed-other",
  "monthly-output",
  "channel-select",
  "platform-fee",
  "target-margin",
  "target-profit-amount",
  "default-other-cost",
  "round-rule",
];

const els = {
  fileInput: document.querySelector("#file-input"),
  fileZone: document.querySelector("#file-zone"),
  pasteInput: document.querySelector("#paste-input"),
  parsePasteButton: document.querySelector("#parse-paste-button"),
  templateButton: document.querySelector("#template-button"),
  sampleButton: document.querySelector("#sample-button"),
  resetButton: document.querySelector("#reset-button"),
  addRowButton: document.querySelector("#add-row-button"),
  copyResultButton: document.querySelector("#copy-result-button"),
  exportButton: document.querySelector("#export-button"),
  finishedName: document.querySelector("#finished-name"),
  addMainButton: document.querySelector("#add-main-button"),
  addAccessoryButton: document.querySelector("#add-accessory-button"),
  comboList: document.querySelector("#combo-list"),
  planStatus: document.querySelector("#plan-status"),
  planProductName: document.querySelector("#plan-product-name"),
  planSuggestedPrice: document.querySelector("#plan-suggested-price"),
  planBreakEven: document.querySelector("#plan-break-even"),
  planFixedCost: document.querySelector("#plan-fixed-cost"),
  planNetProfit: document.querySelector("#plan-net-profit"),
  planNetMargin: document.querySelector("#plan-net-margin"),
  planBatchProfit: document.querySelector("#plan-batch-profit"),
  planBuildable: document.querySelector("#plan-buildable"),
  planFormulaMode: document.querySelector("#plan-formula-mode"),
  costBreakdown: document.querySelector("#cost-breakdown"),
  planAdvice: document.querySelector("#plan-advice"),
  channelSelect: document.querySelector("#channel-select"),
  platformFee: document.querySelector("#platform-fee"),
  importStatus: document.querySelector("#import-status"),
  tableStatus: document.querySelector("#table-status"),
  pricingBody: document.querySelector("#pricing-body"),
  inputPreviewBody: document.querySelector("#input-preview-body"),
  hourlyRateView: document.querySelector("#hourly-rate-view"),
  skuCount: document.querySelector("#sku-count"),
  totalQty: document.querySelector("#total-qty"),
  purchaseTotal: document.querySelector("#purchase-total"),
  revenueTotal: document.querySelector("#revenue-total"),
  profitTotal: document.querySelector("#profit-total"),
  overheadPerItem: document.querySelector("#overhead-per-item"),
};

let rows = [];
let nextId = 1;
let composition = [];
let nextCompositionId = 1;

const sampleRows = () => [
  { id: nextId++, type: "主体", name: "织带", quantity: 30, unitCost: 18, toolCost: "", shipping: "", packaging: "", laborHours: "", otherCost: "" },
  { id: nextId++, type: "配饰", name: "刺绣贴 A", quantity: 90, unitCost: 4.5, toolCost: "", shipping: "", packaging: "", laborHours: "", otherCost: "" },
  { id: nextId++, type: "配饰", name: "刺绣贴 B", quantity: 60, unitCost: 5.2, toolCost: "", shipping: "", packaging: "", laborHours: "", otherCost: "" },
];

function init() {
  bindEvents();
  loadState();
  renderAll();
}

function bindEvents() {
  settingIds.forEach((id) => {
    const input = document.querySelector(`#${id}`);
    const update = () => {
      if (id === "channel-select") {
        els.platformFee.value = CHANNEL_FEES[els.channelSelect.value] ?? CHANNEL_FEES.custom;
      }
      renderComputed();
      saveState();
    };
    input?.addEventListener("input", update);
    input?.addEventListener("change", update);
  });

  els.fileInput.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await importFile(file);
  });

  ["dragenter", "dragover"].forEach((name) => {
    els.fileZone.addEventListener(name, (event) => {
      event.preventDefault();
      els.fileZone.classList.add("drag-over");
    });
  });

  ["dragleave", "drop"].forEach((name) => {
    els.fileZone.addEventListener(name, () => els.fileZone.classList.remove("drag-over"));
  });

  els.fileZone.addEventListener("drop", async (event) => {
    event.preventDefault();
    const file = event.dataTransfer?.files?.[0];
    if (file) await importFile(file);
  });

  els.parsePasteButton.addEventListener("click", () => {
    const text = els.pasteInput.value.trim();
    if (!text) {
      setImportStatus("没有粘贴内容");
      return;
    }
    importRows(parseDelimitedText(text), "粘贴内容");
  });

  els.templateButton.addEventListener("click", downloadTemplate);
  els.sampleButton.addEventListener("click", () => {
    rows = sampleRows();
    composition = defaultComposition();
    setImportStatus("已载入样例");
    renderAll();
    saveState();
  });

  els.resetButton.addEventListener("click", () => {
    if (!window.confirm("清空当前定价表和本地保存的数据？")) return;
    rows = [];
    composition = [];
    localStorage.removeItem(STORAGE_KEY);
    setImportStatus("已清空");
    renderAll();
  });

  els.addRowButton.addEventListener("click", () => {
    const row = {
      id: nextId++,
      type: "配饰",
      name: "",
      quantity: 1,
      unitCost: 0,
      toolCost: "",
      shipping: "",
      packaging: "",
      laborHours: "",
      otherCost: "",
    };
    rows.push(row);
    renderTable();
    renderInputPreview();
    renderComboList();
    renderComputed();
    saveState();
  });

  els.finishedName.addEventListener("input", () => {
    renderPlan(readSettings());
    saveState();
  });

  els.addMainButton.addEventListener("click", () => {
    addCompositionItem("主体");
  });

  els.addAccessoryButton.addEventListener("click", () => {
    addCompositionItem("配饰");
  });

  els.comboList.addEventListener("change", (event) => {
    const input = event.target.closest("[data-combo-field]");
    if (!input) return;
    updateCompositionInput(input);
  });

  els.comboList.addEventListener("input", (event) => {
    const input = event.target.closest("[data-combo-field]");
    if (!input) return;
    updateCompositionInput(input);
  });

  els.comboList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-combo-action='delete']");
    if (!button) return;
    composition = composition.filter((item) => item.id !== Number(button.closest("[data-combo-id]")?.dataset.comboId));
    renderAll();
    saveState();
  });

  els.copyResultButton.addEventListener("click", copyResults);
  els.exportButton.addEventListener("click", exportResults);

  els.pricingBody.addEventListener("input", (event) => {
    const input = event.target.closest("[data-field]");
    if (!input) return;
    const row = rows.find((item) => item.id === Number(input.closest("tr")?.dataset.id));
    if (!row) return;
    const field = input.dataset.field;
    row[field] = field === "name" ? input.value : input.value;
    syncSelectedRowClass();
    updateRowOutput(input.closest("tr"), row, readSettings());
    renderInputPreview();
    renderComboList();
    renderSummary();
    renderPlan(readSettings());
    saveState();
  });

  els.pricingBody.addEventListener("click", (event) => {
    const button = event.target.closest("[data-action='delete']");
    const tr = event.target.closest("tr[data-id]");
    if (!tr) return;
    const id = Number(tr.dataset.id);
    if (button) {
      rows = rows.filter((row) => row.id !== id);
      composition = composition.filter((item) => item.componentId !== id);
      renderAll();
      saveState();
      return;
    }
    syncSelectedRowClass();
    renderPlan(readSettings());
    saveState();
  });
}

async function importFile(file) {
  try {
    setImportStatus("读取中");
    const lower = file.name.toLowerCase();
    let tableRows;
    if (lower.endsWith(".xlsx")) {
      tableRows = await parseXlsxFile(file);
    } else {
      tableRows = parseDelimitedText(await file.text());
    }
    importRows(tableRows, file.name);
    els.fileInput.value = "";
  } catch (error) {
    console.error(error);
    setImportStatus("导入失败");
    window.alert(error.message || "导入失败，请检查文件格式。");
  }
}

function importRows(tableRows, sourceName) {
  const records = rowsFromTable(tableRows);
  if (!records.length) {
    setImportStatus("没有识别到数据");
    return;
  }
  rows = records.map((record) => ({ id: nextId++, ...record }));
  composition = defaultComposition();
  setImportStatus(`已导入 ${rows.length} 行`);
  renderAll();
  saveState();
  console.info(`Imported ${rows.length} rows from ${sourceName}`);
}

function rowsFromTable(tableRows) {
  const cleanRows = tableRows
    .map((row) => row.map((cell) => String(cell ?? "").trim()))
    .filter((row) => row.some(Boolean));

  if (!cleanRows.length) return [];

  const headerIndex = cleanRows.slice(0, 12).findIndex((row) => headerScore(buildHeaderMap(row)) >= 2);
  const headerMap = headerIndex >= 0 ? buildHeaderMap(cleanRows[headerIndex]) : {};
  const hasHeader = headerIndex >= 0;
  const dataRows = hasHeader ? cleanRows.slice(headerIndex + 1) : cleanRows;

  return dataRows
    .map((row, index) => {
      const get = (field) => {
        if (!hasHeader) return "";
        const col = headerMap[field];
        return col >= 0 ? row[col] : "";
      };
      const fallbackName = row[0] || `未命名款式 ${index + 1}`;
      const qty = numberFrom(get("quantity") || row[1]) || 1;
      const explicitUnitCost = numberFrom(get("unitCost") || row[2]);
      const totalCost = numberFrom(get("totalCost"));
      const unitCost = explicitUnitCost || (totalCost > 0 && qty > 0 ? totalCost / qty : 0);

      return {
        type: normalizeType(get("type") || guessComponentType(get("name") || fallbackName, index)),
        name: get("name") || fallbackName,
        quantity: qty,
        unitCost,
        toolCost: get("toolCost") === "" ? "" : numberFrom(get("toolCost")),
        shipping: get("shipping") === "" ? "" : numberFrom(get("shipping")),
        packaging: get("packaging") === "" ? "" : numberFrom(get("packaging")),
        laborHours: get("laborHours") === "" ? "" : numberFrom(get("laborHours")),
        otherCost: get("otherCost") === "" ? "" : numberFrom(get("otherCost")),
      };
    })
    .filter((row) => row.name || row.unitCost || row.quantity);
}

function buildHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalizeHeader);
  return Object.fromEntries(
    Object.entries(FIELD_ALIASES).map(([field, aliases]) => {
      const normalizedAliases = aliases.map(normalizeHeader);
      const index = normalizedHeaders.findIndex((header) =>
        normalizedAliases.some((alias) => header === alias || header.includes(alias) || alias.includes(header)),
      );
      return [field, index];
    }),
  );
}

function headerScore(headerMap) {
  return ["type", "name", "quantity", "unitCost", "totalCost"].filter((field) => headerMap[field] >= 0).length;
}

function normalizeHeader(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[（）()【】\[\]\s_\-/:：,，.。]/g, "");
}

function normalizeType(value) {
  const text = String(value || "").trim();
  if (/主|带|链|底|胚|包|绳/.test(text)) return "主体";
  if (/配|饰|贴|扣|珠|吊坠|挂件|刺绣/.test(text)) return "配饰";
  return text || "配饰";
}

function guessComponentType(name, index) {
  if (/织带|链条|主体|底托|包体|绳|主材/.test(String(name))) return "主体";
  if (/刺绣|贴|配饰|吊坠|珠|扣|挂件/.test(String(name))) return "配饰";
  return index === 0 ? "主体" : "配饰";
}

function readSettings() {
  const monthlyIncome = numberFrom(document.querySelector("#monthly-income").value);
  const monthlyHours = numberFrom(document.querySelector("#monthly-hours").value) || 1;
  const hourlyRate = monthlyIncome / monthlyHours;
  const totalQty = rows.reduce((sum, row) => sum + positive(row.quantity), 0);
  const monthlyFixed =
    numberFrom(document.querySelector("#monthly-rent").value) +
    numberFrom(document.querySelector("#monthly-utilities").value) +
    numberFrom(document.querySelector("#monthly-fixed-other").value);
  const plannedOutput = numberFrom(document.querySelector("#monthly-output").value);
  const overheadBase = plannedOutput > 0 ? plannedOutput : totalQty || 1;

  return {
    hourlyRate,
    defaultLaborHours: numberFrom(document.querySelector("#default-labor-hours").value),
    defaultToolCost: numberFrom(document.querySelector("#default-tool-cost").value),
    defaultShipping: numberFrom(document.querySelector("#default-shipping").value),
    defaultPackaging: numberFrom(document.querySelector("#default-packaging").value),
    defaultOtherCost: numberFrom(document.querySelector("#default-other-cost").value),
    overheadPerItem: monthlyFixed / overheadBase,
    feeRate: numberFrom(document.querySelector("#platform-fee").value) / 100,
    targetMargin: numberFrom(document.querySelector("#target-margin").value) / 100,
    targetProfitAmount: numberFrom(document.querySelector("#target-profit-amount").value),
    roundRule: document.querySelector("#round-rule").value,
  };
}

function calculateRow(row, settings) {
  const quantity = positive(row.quantity) || 1;
  const materialCost = numberFrom(row.unitCost);
  const toolCost = row.toolCost === "" ? settings.defaultToolCost : numberFrom(row.toolCost);
  const shipping = row.shipping === "" ? settings.defaultShipping : numberFrom(row.shipping);
  const packaging = row.packaging === "" ? settings.defaultPackaging : numberFrom(row.packaging);
  const laborHours = row.laborHours === "" ? settings.defaultLaborHours : numberFrom(row.laborHours);
  const otherCost = row.otherCost === "" ? settings.defaultOtherCost : numberFrom(row.otherCost);
  const laborCost = laborHours * settings.hourlyRate;
  const fixedCost = materialCost + toolCost + shipping + packaging + laborCost + settings.overheadPerItem + otherCost;
  const breakEven = settings.feeRate >= 1 ? 0 : fixedCost / (1 - settings.feeRate);
  const denominator = 1 - settings.feeRate - settings.targetMargin;
  const usesProfitAmount = settings.targetProfitAmount > 0;
  const rawPrice = usesProfitAmount
    ? (settings.feeRate >= 1 ? 0 : (fixedCost + settings.targetProfitAmount) / (1 - settings.feeRate))
    : denominator <= 0
      ? 0
      : fixedCost / denominator;
  const suggestedPrice = roundPrice(rawPrice, settings.roundRule);
  const platformFee = suggestedPrice * settings.feeRate;
  const netProfit = suggestedPrice - fixedCost - platformFee;
  const netMargin = suggestedPrice > 0 ? netProfit / suggestedPrice : 0;
  const batchProfit = netProfit * quantity;
  const batchRevenue = suggestedPrice * quantity;
  const purchaseTotal = materialCost * quantity;
  const materialShare = fixedCost > 0 ? materialCost / fixedCost : 0;

  let status = "达标";
  let statusType = "ok";
  if (!materialCost) {
    status = "缺进价";
    statusType = "error";
  } else if (!usesProfitAmount && denominator <= 0) {
    status = "扣点过高";
    statusType = "error";
  } else if (suggestedPrice <= 0) {
    status = "待计算";
    statusType = "warn";
  } else if (!usesProfitAmount && netMargin + 0.0001 < settings.targetMargin) {
    status = "利润不足";
    statusType = "warn";
  }

  return {
    quantity,
    materialCost,
    toolCost,
    shipping,
    packaging,
    laborHours,
    laborCost,
    fixedCost,
    breakEven,
    suggestedPrice,
    platformFee,
    netProfit,
    netMargin,
    batchProfit,
    batchRevenue,
    purchaseTotal,
    materialShare,
    rawPrice,
    denominator,
    usesProfitAmount,
    status,
    statusType,
  };
}

function roundPrice(value, rule) {
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (rule === "half") return Math.ceil(value * 2) / 2;
  if (rule === "five") return Math.ceil(value / 5) * 5;
  if (rule === "nine") {
    const base = Math.floor(value);
    const candidate = base + 0.9;
    return Number((candidate >= value ? candidate : base + 1.9).toFixed(2));
  }
  if (rule === "ninetynine") {
    const base = Math.floor(value);
    const candidate = base + 0.99;
    return Number((candidate >= value ? candidate : base + 1.99).toFixed(2));
  }
  return Math.ceil(value);
}

function renderAll() {
  composition = sanitizeComposition(composition);
  renderTable();
  renderInputPreview();
  renderComboList();
  renderComputed();
}

function renderTable() {
  if (!rows.length) {
    els.pricingBody.innerHTML = `<tr class="empty-row"><td colspan="12">导入主体和配饰后开始组合定价</td></tr>`;
    return;
  }

  els.pricingBody.innerHTML = rows
    .map(
      (row) => `
        <tr data-id="${row.id}" class="${composition.some((item) => item.componentId === row.id) ? "selected-row" : ""}">
          <td>
            <select class="cell-input type-input" data-field="type">
              <option value="主体" ${row.type === "主体" ? "selected" : ""}>主体</option>
              <option value="配饰" ${row.type === "配饰" ? "selected" : ""}>配饰</option>
              <option value="其他" ${row.type === "其他" ? "selected" : ""}>其他</option>
            </select>
          </td>
          <td><input class="cell-input name-input" data-field="name" value="${escapeAttr(row.name)}" /></td>
          <td><input class="cell-input" data-field="quantity" type="number" min="0" step="1" value="${escapeAttr(row.quantity)}" /></td>
          <td><input class="cell-input" data-field="unitCost" type="number" min="0" step="0.01" value="${escapeAttr(row.unitCost)}" /></td>
          <td><input class="cell-input" data-field="toolCost" type="number" min="0" step="0.01" value="${escapeAttr(row.toolCost)}" /></td>
          <td><input class="cell-input" data-field="shipping" type="number" min="0" step="0.01" value="${escapeAttr(row.shipping)}" /></td>
          <td><input class="cell-input" data-field="packaging" type="number" min="0" step="0.01" value="${escapeAttr(row.packaging)}" /></td>
          <td><input class="cell-input" data-field="laborHours" type="number" min="0" step="0.1" value="${escapeAttr(row.laborHours)}" /></td>
          <td><input class="cell-input" data-field="otherCost" type="number" min="0" step="0.01" value="${escapeAttr(row.otherCost)}" /></td>
          <td class="computed" data-output="usageQty"></td>
          <td class="computed" data-output="materialSubtotal"></td>
          <td class="computed" data-output="buildable"></td>
          <td><button class="delete-button" data-action="delete" type="button" title="删除">×</button></td>
        </tr>
      `,
    )
    .join("");
}

function renderInputPreview() {
  if (!rows.length) {
    els.inputPreviewBody.innerHTML = `<tr><td colspan="9">暂无导入输入</td></tr>`;
    return;
  }

  els.inputPreviewBody.innerHTML = rows
    .map(
      (row) => `
        <tr>
          <td>${escapeHtml(row.type || "配饰")}</td>
          <td>${escapeHtml(row.name || "未命名")}</td>
          <td>${formatNumber(positive(row.quantity), 0)}</td>
          <td>${formatMoney(numberFrom(row.unitCost))}</td>
          <td>${displayInputMoney(row.toolCost)}</td>
          <td>${displayInputMoney(row.shipping)}</td>
          <td>${displayInputMoney(row.packaging)}</td>
          <td>${row.laborHours === "" ? "默认" : formatNumber(numberFrom(row.laborHours), 2)}</td>
          <td>${displayInputMoney(row.otherCost)}</td>
        </tr>
      `,
    )
    .join("");
}

function renderComboList() {
  if (!rows.length) {
    els.comboList.innerHTML = `<div class="combo-empty">先导入主体和配饰清单</div>`;
    return;
  }

  composition = sanitizeComposition(composition);
  if (!composition.length) {
    els.comboList.innerHTML = `<div class="combo-empty">添加主体和配饰后生成单品售价</div>`;
    return;
  }

  els.comboList.innerHTML = composition
    .map((item) => {
      const options = rows
        .map(
          (row) =>
            `<option value="${row.id}" ${row.id === item.componentId ? "selected" : ""}>${escapeHtml(row.type || "配饰")} / ${escapeHtml(row.name || "未命名")}</option>`,
        )
        .join("");
      return `
        <div class="combo-row" data-combo-id="${item.id}">
          <select data-combo-field="componentId">${options}</select>
          <input data-combo-field="usageQty" type="number" min="0.01" step="0.01" value="${escapeAttr(item.usageQty)}" />
          <span>${item.role}</span>
          <button class="delete-button" data-combo-action="delete" type="button" title="移除">×</button>
        </div>
      `;
    })
    .join("");
}

function syncSelectedRowClass() {
  document.querySelectorAll("#pricing-body tr[data-id]").forEach((tr) => {
    tr.classList.toggle("selected-row", composition.some((item) => item.componentId === Number(tr.dataset.id)));
  });
}

function defaultComposition() {
  const main = rows.find((row) => row.type === "主体") ?? rows[0];
  const accessory = rows.find((row) => row.type === "配饰" && row.id !== main?.id);
  const items = [];
  if (main) items.push({ id: nextCompositionId++, role: "主体", componentId: main.id, usageQty: 1 });
  if (accessory) items.push({ id: nextCompositionId++, role: "配饰", componentId: accessory.id, usageQty: 1 });
  return items;
}

function sanitizeComposition(items) {
  const validIds = new Set(rows.map((row) => row.id));
  return items
    .filter((item) => validIds.has(item.componentId))
    .map((item) => ({ ...item, usageQty: positive(item.usageQty) || 1 }));
}

function addCompositionItem(role) {
  if (!rows.length) {
    setImportStatus("先导入主体和配饰");
    return;
  }
  const preferred = rows.find((row) => row.type === role && !composition.some((item) => item.componentId === row.id));
  const fallback = rows.find((row) => !composition.some((item) => item.componentId === row.id)) ?? rows[0];
  composition.push({
    id: nextCompositionId++,
    role,
    componentId: (preferred ?? fallback).id,
    usageQty: 1,
  });
  renderAll();
  saveState();
}

function updateCompositionInput(input) {
  const item = composition.find((combo) => combo.id === Number(input.closest("[data-combo-id]")?.dataset.comboId));
  if (!item) return;
  if (input.dataset.comboField === "componentId") item.componentId = Number(input.value);
  if (input.dataset.comboField === "usageQty") item.usageQty = positive(input.value) || 1;
  renderTable();
  renderInputPreview();
  renderPlan(readSettings());
  saveState();
}

function componentUsage(componentId) {
  return composition
    .filter((item) => item.componentId === componentId)
    .reduce((sum, item) => sum + positive(item.usageQty), 0);
}

function buildableForComponent(row) {
  const usage = componentUsage(row.id);
  if (!usage) return "";
  return Math.floor(positive(row.quantity) / usage);
}

function renderComputed() {
  const settings = readSettings();
  els.hourlyRateView.textContent = formatNumber(settings.hourlyRate);
  els.overheadPerItem.textContent = formatMoney(settings.overheadPerItem);
  document.querySelectorAll("#pricing-body tr[data-id]").forEach((tr) => {
    const row = rows.find((item) => item.id === Number(tr.dataset.id));
    if (row) updateRowOutput(tr, row);
  });
  renderSummary();
  renderPlan(settings);
}

function updateRowOutput(tr, row) {
  const usage = componentUsage(row.id);
  setOutput(tr, "usageQty", usage ? formatNumber(usage, 2) : "-");
  setOutput(tr, "materialSubtotal", usage ? formatMoney(usage * numberFrom(row.unitCost)) : "-");
  const buildable = buildableForComponent(row);
  setOutput(tr, "buildable", buildable === "" ? "-" : formatNumber(buildable, 0));
}

function setOutput(tr, name, value) {
  const cell = tr.querySelector(`[data-output="${name}"]`);
  if (cell) cell.textContent = value;
}

function renderSummary() {
  const settings = readSettings();
  const totals = rows.reduce(
    (acc, row) => {
      acc.qty += positive(row.quantity);
      acc.purchase += positive(row.quantity) * numberFrom(row.unitCost);
      return acc;
    },
    { qty: 0, purchase: 0, revenue: 0, profit: 0 },
  );
  const plan = calculateCompositionPlan(settings);
  totals.revenue = plan.suggestedPrice * plan.buildable;
  totals.profit = plan.netProfit * plan.buildable;

  els.skuCount.textContent = String(rows.length);
  els.totalQty.textContent = formatNumber(totals.qty, 0);
  els.purchaseTotal.textContent = formatMoney(totals.purchase);
  els.revenueTotal.textContent = formatMoney(totals.revenue);
  els.profitTotal.textContent = formatMoney(totals.profit);
  els.overheadPerItem.textContent = formatMoney(settings.overheadPerItem);
  els.tableStatus.textContent = `${rows.length} 行`;
}

function calculateCompositionPlan(settings = readSettings()) {
  const items = composition
    .map((item) => {
      const row = rows.find((component) => component.id === item.componentId);
      if (!row) return null;
      const usageQty = positive(item.usageQty) || 1;
      return {
        ...item,
        name: row.name || "未命名组件",
        type: row.type || "配饰",
        usageQty,
        stockQty: positive(row.quantity),
        unitCost: numberFrom(row.unitCost),
        subtotal: usageQty * numberFrom(row.unitCost),
      };
    })
    .filter(Boolean);

  const materialCost = items.reduce((sum, item) => sum + item.subtotal, 0);
  const usageByComponent = new Map();
  items.forEach((item) => {
    const current = usageByComponent.get(item.componentId) ?? { stockQty: item.stockQty, usageQty: 0 };
    current.usageQty += item.usageQty;
    usageByComponent.set(item.componentId, current);
  });
  const buildable = usageByComponent.size
    ? Math.min(...[...usageByComponent.values()].map((item) => (item.usageQty > 0 ? Math.floor(item.stockQty / item.usageQty) : 0)))
    : 0;
  const virtualRow = {
    name: els.finishedName.value.trim() || "组合成品",
    quantity: buildable || 1,
    unitCost: materialCost,
    toolCost: "",
    shipping: "",
    packaging: "",
    laborHours: "",
    otherCost: "",
  };
  const calc = calculateRow(virtualRow, settings);

  return {
    ...calc,
    items,
    materialCost,
    buildable: Number.isFinite(buildable) ? buildable : 0,
  };
}

function renderPlan(settings = readSettings()) {
  const plan = calculateCompositionPlan(settings);
  if (!plan.items.length) {
    els.planStatus.textContent = "待计算";
    els.planProductName.textContent = "未组合产品";
    els.planSuggestedPrice.textContent = "0.00";
    els.planBreakEven.textContent = "0.00";
    els.planFixedCost.textContent = "0.00";
    els.planNetProfit.textContent = "0.00";
    els.planNetMargin.textContent = "0.0%";
    els.planBatchProfit.textContent = "0.00";
    els.planFormulaMode.textContent = "利润率模式";
    els.costBreakdown.innerHTML = "";
    els.planBuildable.textContent = "0";
    els.planAdvice.textContent = "导入主体和配饰后，添加到组合清单即可生成单品方案。";
    return;
  }

  els.planStatus.textContent = plan.status;
  els.planProductName.textContent = els.finishedName.value.trim() || "未命名成品";
  els.planSuggestedPrice.textContent = formatMoney(plan.suggestedPrice);
  els.planBreakEven.textContent = formatMoney(plan.breakEven);
  els.planFixedCost.textContent = formatMoney(plan.fixedCost);
  els.planNetProfit.textContent = formatMoney(plan.netProfit);
  els.planNetMargin.textContent = formatPercent(plan.netMargin);
  els.planBatchProfit.textContent = formatMoney(plan.netProfit * plan.buildable);
  els.planBuildable.textContent = formatNumber(plan.buildable, 0);
  els.planFormulaMode.textContent = plan.usesProfitAmount ? "利润额模式" : "利润率模式";
  els.planStatus.className = `status-pill plan-status-${plan.statusType}`;

  const parts = [
    ...plan.items.map((item) => [`${item.role}：${item.name} x ${formatNumber(item.usageQty, 2)}`, item.subtotal]),
    ["工具摊销", plan.toolCost],
    ["快递费", plan.shipping],
    ["包装费", plan.packaging],
    ["时间成本", plan.laborCost],
    ["房租水电摊销", settings.overheadPerItem],
    ["其他成本", plan.otherCost],
    ["平台扣点", plan.platformFee],
    ["净利润", plan.netProfit],
  ];
  els.costBreakdown.innerHTML = parts
    .map(
      ([label, value]) => `
        <div class="breakdown-row">
          <span>${label}</span>
          <strong>${formatMoney(value)}</strong>
        </div>
      `,
    )
    .join("");

  const modeText = plan.usesProfitAmount
    ? `按目标利润额 ${formatMoney(settings.targetProfitAmount)} 元计算。`
    : `按目标净利率 ${formatPercent(settings.targetMargin)} 计算。`;
  const formulaText = plan.usesProfitAmount
    ? `建议售价 = (固定成本 ${formatMoney(plan.fixedCost)} + 目标利润 ${formatMoney(settings.targetProfitAmount)}) ÷ (1 - 平台扣点 ${formatPercent(settings.feeRate)})`
    : `建议售价 = 固定成本 ${formatMoney(plan.fixedCost)} ÷ (1 - 平台扣点 ${formatPercent(settings.feeRate)} - 目标净利率 ${formatPercent(settings.targetMargin)})`;
  els.planAdvice.textContent = `${modeText} ${formulaText}，取整后建议卖 ${formatMoney(plan.suggestedPrice)} 元；单件净利 ${formatMoney(plan.netProfit)} 元。当前库存约可做 ${formatNumber(plan.buildable, 0)} 件。`;
}

function setImportStatus(text) {
  els.importStatus.textContent = text;
}

function parseDelimitedText(text) {
  const cleanText = text.replace(/^\uFEFF/, "").trim();
  if (!cleanText) return [];
  const delimiter = detectDelimiter(cleanText);
  const rowsOut = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < cleanText.length; i += 1) {
    const char = cleanText[i];
    const next = cleanText[i + 1];

    if (char === '"') {
      if (quoted && next === '"') {
        cell += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
      continue;
    }

    if (!quoted && char === delimiter) {
      row.push(cell);
      cell = "";
      continue;
    }

    if (!quoted && (char === "\n" || char === "\r")) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rowsOut.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  row.push(cell);
  rowsOut.push(row);
  return rowsOut;
}

function detectDelimiter(text) {
  const firstLine = text.split(/\r?\n/)[0] || "";
  const options = ["\t", ",", ";"];
  return options
    .map((delimiter) => ({ delimiter, count: firstLine.split(delimiter).length }))
    .sort((a, b) => b.count - a.count)[0].delimiter;
}

async function parseXlsxFile(file) {
  const entries = readZipEntries(await file.arrayBuffer());
  const sheetName = entries.has("xl/worksheets/sheet1.xml")
    ? "xl/worksheets/sheet1.xml"
    : [...entries.keys()].find((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name));
  if (!sheetName) throw new Error("没有找到 Excel 工作表。");

  const sharedStrings = entries.has("xl/sharedStrings.xml")
    ? parseSharedStrings(await unzipText(entries.get("xl/sharedStrings.xml")))
    : [];
  const sheetXml = await unzipText(entries.get(sheetName));
  return parseSheetRows(sheetXml, sharedStrings);
}

function readZipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  let eocdOffset = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 66000); i -= 1) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset < 0) throw new Error("无法读取 XLSX 文件结构。");

  const entryCount = view.getUint16(eocdOffset + 10, true);
  let offset = view.getUint32(eocdOffset + 16, true);
  const entries = new Map();

  for (let i = 0; i < entryCount; i += 1) {
    if (view.getUint32(offset, true) !== 0x02014b50) break;
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const fileNameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localHeaderOffset = view.getUint32(offset + 42, true);
    const name = decodeUtf8(bytes.slice(offset + 46, offset + 46 + fileNameLength));

    const nameLengthLocal = view.getUint16(localHeaderOffset + 26, true);
    const extraLengthLocal = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + nameLengthLocal + extraLengthLocal;
    entries.set(name, {
      method,
      data: bytes.slice(dataStart, dataStart + compressedSize),
    });

    offset += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

async function unzipText(entry) {
  if (!entry) return "";
  let data = entry.data;
  if (entry.method === 8) {
    if (!("DecompressionStream" in window)) {
      throw new Error("当前浏览器不支持直接读取 XLSX，请改用 CSV 或粘贴表格。");
    }
    try {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    } catch {
      const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate"));
      data = new Uint8Array(await new Response(stream).arrayBuffer());
    }
  } else if (entry.method !== 0) {
    throw new Error("暂不支持这个 XLSX 压缩格式。");
  }
  return decodeUtf8(data);
}

function parseSharedStrings(xmlText) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return [...doc.getElementsByTagName("si")].map((si) =>
    [...si.getElementsByTagName("t")].map((node) => node.textContent || "").join(""),
  );
}

function parseSheetRows(xmlText, sharedStrings) {
  const doc = new DOMParser().parseFromString(xmlText, "application/xml");
  return [...doc.getElementsByTagName("row")].map((rowNode) => {
    const row = [];
    [...rowNode.getElementsByTagName("c")].forEach((cellNode) => {
      const ref = cellNode.getAttribute("r") || "";
      const col = columnIndex(ref.match(/[A-Z]+/)?.[0] || "A");
      const type = cellNode.getAttribute("t");
      const valueNode = cellNode.getElementsByTagName("v")[0];
      const inlineText = [...cellNode.getElementsByTagName("t")].map((node) => node.textContent || "").join("");
      let value = valueNode?.textContent || inlineText || "";
      if (type === "s") value = sharedStrings[Number(value)] ?? "";
      row[col] = value;
    });
    return row.map((cell) => cell ?? "");
  });
}

function columnIndex(letters) {
  return [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

function decodeUtf8(bytes) {
  return new TextDecoder("utf-8").decode(bytes);
}

function numberFrom(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const clean = String(value ?? "")
    .trim()
    .replace(/[%￥¥,\s]/g, "");
  if (!clean) return 0;
  const match = clean.match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : 0;
}

function positive(value) {
  return Math.max(0, numberFrom(value));
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatNumber(value, digits = 2) {
  return Number(value || 0).toLocaleString("zh-CN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

function formatPercent(value) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

function escapeAttr(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function displayInputMoney(value) {
  return value === "" ? "默认" : formatMoney(numberFrom(value));
}

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function resultRows() {
  const record = selectedPlanRecord();
  if (!record) return [];
  return [record];
}

function toCsv(records) {
  if (!records.length) return "";
  const headers = Object.keys(records[0]);
  const lines = [headers.join(",")];
  records.forEach((record) => {
    lines.push(headers.map((header) => csvEscape(record[header])).join(","));
  });
  return `\uFEFF${lines.join("\n")}`;
}

function exportResults() {
  if (!composition.length) {
    setImportStatus("没有可导出的结果");
    return;
  }
  downloadText("单品组合定价方案.csv", toCsv(resultRows()), "text/csv;charset=utf-8");
}

async function copyResults() {
  if (!rows.length) {
    setImportStatus("没有可复制的结果");
    return;
  }
  const selectedRecord = selectedPlanRecord();
  if (!selectedRecord) {
    setImportStatus("没有选中的产品");
    return;
  }
  const records = [selectedRecord];
  const headers = Object.keys(records[0]);
  const text = [headers.join("\t"), ...records.map((row) => headers.map((header) => row[header]).join("\t"))].join("\n");
  try {
    await navigator.clipboard.writeText(text);
    setImportStatus("单品方案已复制");
  } catch {
    els.pasteInput.value = text;
    setImportStatus("结果已放入粘贴框");
  }
}

function selectedPlanRecord() {
  const settings = readSettings();
  const plan = calculateCompositionPlan(settings);
  if (!plan.items.length) return null;
  return {
    成品名称: els.finishedName.value.trim() || "组合成品",
    组合明细: plan.items.map((item) => `${item.role}:${item.name}x${item.usageQty}`).join(" + "),
    可做件数: plan.buildable,
    材料成本: plan.materialCost,
    工具摊销: plan.toolCost,
    快递费: plan.shipping,
    包装费: plan.packaging,
    制作小时: plan.laborHours,
    时间成本: plan.laborCost,
    其他成本: plan.otherCost,
    "房租水电/件": settings.overheadPerItem,
    固定成本: plan.fixedCost,
    保本价: plan.breakEven,
    建议售价: plan.suggestedPrice,
    平台扣点金额: plan.platformFee,
    单件净利: plan.netProfit,
    净利率: plan.netMargin,
    本款总利润: plan.netProfit * plan.buildable,
    状态: plan.status,
  };
}

function downloadTemplate() {
  const template = toCsv([
    { 类型: "主体", "产品/款式": "织带", 数量: 30, 进价: 18, 工具摊销: "", 快递费: "", 包装费: "", 制作小时: "", 其他成本: "" },
    { 类型: "配饰", "产品/款式": "刺绣贴 A", 数量: 90, 进价: 4.5, 工具摊销: "", 快递费: "", 包装费: "", 制作小时: "", 其他成本: "" },
    { 类型: "配饰", "产品/款式": "刺绣贴 B", 数量: 60, 进价: 5.2, 工具摊销: "", 快递费: "", 包装费: "", 制作小时: "", 其他成本: "" },
  ]);
  downloadText("进货清单导入模板.csv", template, "text/csv;charset=utf-8");
}

function downloadText(filename, text, type) {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function saveState() {
  const settings = Object.fromEntries(settingIds.map((id) => [id, document.querySelector(`#${id}`)?.value ?? ""]));
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({ settings, rows, composition, finishedName: els.finishedName.value }),
  );
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (saved?.settings) {
      Object.entries(saved.settings).forEach(([id, value]) => {
        const input = document.querySelector(`#${id}`);
        if (input) input.value = value;
      });
    }
    if (saved?.finishedName) els.finishedName.value = saved.finishedName;
    if (Array.isArray(saved?.rows) && saved.rows.length) {
      rows = saved.rows.map((row, index) => ({
        ...row,
        type: normalizeType(row.type || guessComponentType(row.name, index)),
        id: nextId++,
      }));
      const oldToNew = new Map(saved.rows.map((row, index) => [row.id, rows[index].id]));
      composition = Array.isArray(saved.composition)
        ? saved.composition
            .map((item) => ({
              ...item,
              id: nextCompositionId++,
              componentId: oldToNew.get(item.componentId),
            }))
            .filter((item) => item.componentId)
        : defaultComposition();
      setImportStatus("已恢复上次数据");
      return;
    }
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
  rows = sampleRows();
  composition = defaultComposition();
  setImportStatus("已载入样例");
}

init();
