const API_BASE = "/api/timer";
const TEN_MINUTES = 10 * 60;
const DEFAULT_TABLE_COUNT = 30;
const DEFAULT_TOTAL_SECONDS = 60 * 60;
const PREVIEW_STORAGE_KEY = "libms_timer_anchor_preview_v1";

const state = {
  tables: [],
  previousRemaining: new Map(),
  tenMinuteLocks: new Set(),
  previewMode: false,
};

const grid = document.getElementById("tableGrid");
const statsButton = document.getElementById("statsButton");
const statsModal = document.getElementById("statsModal");
const closeStatsButton = document.getElementById("closeStatsButton");
const statsContent = document.getElementById("statsContent");
const modeHint = document.getElementById("modeHint");

function pad(value) {
  return String(value).padStart(2, "0");
}

function formatClock(totalSeconds) {
  const absSeconds = Math.max(0, Math.floor(Math.abs(totalSeconds)));
  const hours = Math.floor(absSeconds / 3600);
  const minutes = Math.floor((absSeconds % 3600) / 60);
  const seconds = absSeconds % 60;
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function parseEndTimeMs(table) {
  if (!table.end_time) return 0;
  const value = new Date(table.end_time).getTime();
  return Number.isFinite(value) ? value : 0;
}

/**
 * 时间锚点法核心：
 * 后端只给 end_time；前端每帧用 Date.now() 计算剩余秒数。
 * 即使浏览器切后台导致 requestAnimationFrame 暂停，切回来后 Date.now() 会立刻校准到真实剩余时间。
 */
function getLiveSnapshot(table, nowMs = Date.now()) {
  if (table.status === "IDLE") {
    return {
      status: "IDLE",
      remainingSeconds: table.total_seconds,
      label: "空闲",
      className: "idle",
      display: formatClock(table.total_seconds),
    };
  }

  if (table.is_paused) {
    return {
      status: "RUNNING",
      remainingSeconds: table.paused_remaining_seconds,
      label: "已暂停",
      className: "warning",
      display: formatClock(table.paused_remaining_seconds),
    };
  }

  const endTimeMs = parseEndTimeMs(table);
  const remainingSeconds = Math.floor((endTimeMs - nowMs) / 1000);

  if (remainingSeconds <= 0) {
    return {
      status: "OVERTIME",
      remainingSeconds,
      label: "已超时",
      className: "overtime",
      display: `+${formatClock(remainingSeconds)}`,
    };
  }

  if (remainingSeconds <= TEN_MINUTES) {
    return {
      status: "RUNNING",
      remainingSeconds,
      label: "少于10分钟",
      className: "warning",
      display: formatClock(remainingSeconds),
    };
  }

  return {
    status: "RUNNING",
    remainingSeconds,
    label: "计时中",
    className: "running",
    display: formatClock(remainingSeconds),
  };
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || data.error || "请求失败");
  }
  return data;
}

function setModeHint(message, isPreview = false) {
  modeHint.textContent = message;
  modeHint.classList.toggle("preview", isPreview);
}

function defaultPreviewTables() {
  return Array.from({ length: DEFAULT_TABLE_COUNT }, (_, index) => ({
    table_id: index + 1,
    status: "IDLE",
    total_seconds: DEFAULT_TOTAL_SECONDS,
    end_time: null,
    paused_remaining_seconds: 0,
    is_paused: false,
    updated_at: new Date().toISOString(),
  }));
}

function loadPreviewTables() {
  try {
    const raw = localStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return defaultPreviewTables();
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : defaultPreviewTables();
  } catch (_) {
    return defaultPreviewTables();
  }
}

function savePreviewTables() {
  try {
    localStorage.setItem(PREVIEW_STORAGE_KEY, JSON.stringify(state.tables));
  } catch (_) {
    // 预览模式 localStorage 不可写时，只保留当前页面内存状态。
  }
}

function deriveBackendStatus(table, nowMs = Date.now()) {
  if (table.status === "IDLE" || table.is_paused || !table.end_time) return table;
  const next = { ...table };
  next.status = parseEndTimeMs(next) <= nowMs ? "OVERTIME" : "RUNNING";
  return next;
}

function updatePreviewTable(tableId, updater) {
  state.tables = state.tables.map((table) => {
    if (table.table_id !== tableId) return deriveBackendStatus(table);
    const next = updater(deriveBackendStatus({ ...table }));
    next.updated_at = new Date().toISOString();
    return deriveBackendStatus(next);
  });
  savePreviewTables();
}

function applyPreviewAction(tableId, action, payload = {}) {
  const nowMs = Date.now();

  updatePreviewTable(tableId, (table) => {
    if (action === "start") {
      const remaining = table.is_paused ? table.paused_remaining_seconds : table.total_seconds;
      return {
        ...table,
        status: "RUNNING",
        end_time: new Date(nowMs + Math.max(1, remaining) * 1000).toISOString(),
        paused_remaining_seconds: 0,
        is_paused: false,
      };
    }

    if (action === "pause") {
      if (table.status === "IDLE" || table.is_paused) return table;
      const remaining = table.end_time ? Math.max(0, Math.floor((parseEndTimeMs(table) - nowMs) / 1000)) : table.total_seconds;
      return {
        ...table,
        status: "RUNNING",
        end_time: null,
        paused_remaining_seconds: remaining,
        is_paused: true,
      };
    }

    if (action === "reset") {
      return {
        ...table,
        status: "IDLE",
        end_time: null,
        paused_remaining_seconds: 0,
        is_paused: false,
      };
    }

    if (action === "set_total") {
      const totalSeconds = Math.max(60, Number(payload.total_minutes || 60) * 60);
      if (table.status === "IDLE") {
        return { ...table, total_seconds: totalSeconds, end_time: null, paused_remaining_seconds: 0, is_paused: false };
      }
      if (table.is_paused) {
        return { ...table, total_seconds: totalSeconds, paused_remaining_seconds: totalSeconds };
      }
      return { ...table, status: "RUNNING", total_seconds: totalSeconds, end_time: new Date(nowMs + totalSeconds * 1000).toISOString() };
    }

    if (action === "add_time" || action === "sub_time") {
      const deltaSeconds = Number(payload.minutes || 60) * 60 * (action === "add_time" ? 1 : -1);
      if (table.status === "IDLE") {
        return { ...table, total_seconds: Math.max(60, table.total_seconds + deltaSeconds) };
      }
      if (table.is_paused) {
        return { ...table, paused_remaining_seconds: Math.max(0, table.paused_remaining_seconds + deltaSeconds) };
      }
      const endMs = (parseEndTimeMs(table) || nowMs) + deltaSeconds * 1000;
      return { ...table, end_time: new Date(endMs).toISOString(), status: endMs <= nowMs ? "OVERTIME" : "RUNNING" };
    }

    return table;
  });
}

async function loadTables() {
  try {
    const data = await requestJson(`${API_BASE}/tables`);
    state.tables = Array.isArray(data.tables) ? data.tables : [];
    state.previewMode = false;
    setModeHint("已连接后端计时服务，所有桌台状态以后端为准。");
  } catch (error) {
    state.tables = loadPreviewTables();
    state.previewMode = true;
    setModeHint("预览模式：后端尚未接入生产持久化，当前操作只保存在本机浏览器。", true);
  }
  renderGrid();
}

async function sendAction(tableId, action, payload = {}) {
  if (state.previewMode) {
    applyPreviewAction(tableId, action, payload);
    if (["start", "reset", "set_total"].includes(action)) {
      const nextTable = state.tables.find((table) => table.table_id === tableId);
      if (nextTable) state.tenMinuteLocks.delete(lockKey(nextTable));
    }
    renderGrid();
    return;
  }

  const data = await requestJson(`${API_BASE}/tables/${tableId}/actions`, {
    method: "POST",
    body: JSON.stringify({ action, ...payload }),
  });
  const nextTable = data.table;
  state.tables = state.tables.map((table) => (table.table_id === nextTable.table_id ? nextTable : table));
  if (["start", "reset", "set_total"].includes(action)) {
    state.tenMinuteLocks.delete(lockKey(nextTable));
  }
  renderGrid();
}

function lockKey(table) {
  return `${table.table_id}:${table.end_time || "paused"}`;
}

function speak(text) {
  if (!("speechSynthesis" in window)) return;
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = 0.95;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(utterance);
}

function maybeSpeakTenMinute(table, snapshot) {
  if (table.status === "IDLE" || table.is_paused || !table.end_time) return;
  const key = lockKey(table);
  const previous = state.previousRemaining.get(table.table_id);
  state.previousRemaining.set(table.table_id, snapshot.remainingSeconds);

  if (state.tenMinuteLocks.has(key)) return;
  if (snapshot.remainingSeconds <= TEN_MINUTES && snapshot.remainingSeconds > 0 && (previous === undefined || previous > TEN_MINUTES)) {
    state.tenMinuteLocks.add(key);
    speak(`${table.table_id}号桌还剩余10分钟，请注意时间`);
  }
}

function promptMinutes(defaultValue = 60) {
  const raw = window.prompt("请输入分钟数", String(defaultValue));
  if (raw === null) return null;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value <= 0) {
    alert("请输入有效分钟数");
    return null;
  }
  return value;
}

function renderGrid() {
  const now = Date.now();
  grid.innerHTML = state.tables
    .map((table) => {
      const snapshot = getLiveSnapshot(table, now);
      return `
        <article class="card ${snapshot.className}" data-table-id="${table.table_id}">
          <div class="card-head">
            <div class="table-id">${table.table_id}号桌</div>
            <div class="badge">${snapshot.label}</div>
          </div>
          <div class="timer" data-timer>${snapshot.display}</div>
          <div class="meta">
            总时长：${Math.round(table.total_seconds / 60)} 分钟<br />
            ${table.end_time ? `结束锚点：${new Date(table.end_time).toLocaleTimeString("zh-CN", { hour12: false })}` : "暂无结束锚点"}
          </div>
          <div class="actions">
            <button type="button" data-action="start">开始</button>
            <button type="button" data-action="pause">暂停</button>
            <button type="button" data-action="reset">重置</button>
            <button type="button" data-action="set_total">修改时间</button>
            <button type="button" data-action="add_time" data-minutes="60">+1小时</button>
            <button type="button" data-action="sub_time" data-minutes="10">-10分钟</button>
          </div>
        </article>
      `;
    })
    .join("");
}

function updateLiveTimers() {
  const now = Date.now();
  for (const card of grid.querySelectorAll("[data-table-id]")) {
    const tableId = Number(card.dataset.tableId);
    const table = state.tables.find((item) => item.table_id === tableId);
    if (!table) continue;

    const snapshot = getLiveSnapshot(table, now);
    card.className = `card ${snapshot.className}`;
    card.querySelector("[data-timer]").textContent = snapshot.display;
    card.querySelector(".badge").textContent = snapshot.label;
    maybeSpeakTenMinute(table, snapshot);
  }

  requestAnimationFrame(updateLiveTimers);
}

function classifyTables() {
  const groups = {
    idle: [],
    running: [],
    warning: [],
    overtime: [],
  };
  const now = Date.now();

  for (const table of state.tables) {
    const snapshot = getLiveSnapshot(table, now);
    if (snapshot.status === "IDLE") groups.idle.push(table.table_id);
    else if (snapshot.status === "OVERTIME") groups.overtime.push(table.table_id);
    else if (snapshot.remainingSeconds <= TEN_MINUTES && snapshot.remainingSeconds > 0) groups.warning.push(table.table_id);
    else groups.running.push(table.table_id);
  }

  return groups;
}

function renderStats() {
  const groups = classifyTables();
  const formatList = (items) => (items.length ? items.map((id) => `${id}号`).join("、") : "无");
  statsContent.innerHTML = `
    <div class="stats-row"><b>空闲总数：${groups.idle.length}</b><br />${formatList(groups.idle)}</div>
    <div class="stats-row"><b>计时中总数：${groups.running.length}</b><br />${formatList(groups.running)}</div>
    <div class="stats-row"><b>剩余少于10分钟：${groups.warning.length}</b><br />${formatList(groups.warning)}</div>
    <div class="stats-row"><b>已超时：${groups.overtime.length}</b><br />${formatList(groups.overtime)}</div>
  `;
}

grid.addEventListener("click", async (event) => {
  const button = event.target.closest("button[data-action]");
  if (!button) return;

  const card = button.closest("[data-table-id]");
  const tableId = Number(card.dataset.tableId);
  const action = button.dataset.action;

  try {
    if (action === "set_total") {
      const totalMinutes = promptMinutes(60);
      if (!totalMinutes) return;
      await sendAction(tableId, "set_total", { total_minutes: totalMinutes });
    } else if (action === "add_time" || action === "sub_time") {
      await sendAction(tableId, action, { minutes: Number(button.dataset.minutes || 60) });
    } else {
      await sendAction(tableId, action);
    }
  } catch (error) {
    alert(error.message || "操作失败");
  }
});

statsButton.addEventListener("click", () => {
  renderStats();
  statsModal.showModal();
});

closeStatsButton.addEventListener("click", () => statsModal.close());

await loadTables();
requestAnimationFrame(updateLiveTimers);
