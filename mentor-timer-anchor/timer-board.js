const API_BASE = "/api/timer";
const TEN_MINUTES = 10 * 60;

const state = {
  tables: [],
  previousRemaining: new Map(),
  tenMinuteLocks: new Set(),
};

const grid = document.getElementById("tableGrid");
const statsButton = document.getElementById("statsButton");
const statsModal = document.getElementById("statsModal");
const closeStatsButton = document.getElementById("closeStatsButton");
const statsContent = document.getElementById("statsContent");

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

async function loadTables() {
  const data = await requestJson(`${API_BASE}/tables`);
  state.tables = Array.isArray(data.tables) ? data.tables : [];
  renderGrid();
}

async function sendAction(tableId, action, payload = {}) {
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
