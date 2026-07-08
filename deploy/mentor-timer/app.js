const { createApp, computed, h, onMounted, onUnmounted, ref } = Vue;

const DESK_STORAGE_KEY = "libms_perler_timer_desks_v3";
const STAT_STORAGE_KEY = "libms_perler_timer_stats_v3";
const LEGACY_DESK_KEYS = ["libms_perler_mentor_timer_desks_v2", "libms_perler_mentor_timer_desks_v1"];
const LEGACY_STAT_KEYS = ["libms_perler_mentor_timer_stats_v2", "libms_perler_mentor_timer_stats_v1"];

const ONE_MIN_MS = 60 * 1000;
const TEN_MIN_MS = 10 * ONE_MIN_MS;
const THIRTY_MIN_MS = 30 * ONE_MIN_MS;

const validStatuses = new Set(["empty", "preparing", "normal", "ending", "urgent", "timeout", "infinit"]);
const validSessionTypes = new Set(["morning", "afternoon", "night", "day", "1h", "2h", "infinit"]);

const regionMeta = [
  { key: "window", label: "🪟 玻璃幕墙", title: "🪟 靠玻璃幕墙", range: "01 - 06" },
  { key: "table1", label: "🪵 长桌①", title: "🪵 长桌区①", range: "07 - 16" },
  { key: "table2", label: "🪵 长桌②", title: "🪵 长桌区②", range: "17 - 30" },
];

const sessionPresets = [
  { type: "morning", icon: "🌅", label: "早鸟场", desc: "限时倒计时，到当天 14:00", mode: "countdown", fixedHour: 14, baseFee: 0 },
  { type: "afternoon", icon: "☀️", label: "下午场", desc: "限时倒计时，到当天 19:00", mode: "countdown", fixedHour: 19, baseFee: 0 },
  { type: "night", icon: "🌙", label: "星光夜场", desc: "限时倒计时，到当天 21:00", mode: "countdown", fixedHour: 21, baseFee: 0 },
  { type: "day", icon: "🎫", label: "包天场", desc: "限时倒计时，到当天 21:00", mode: "countdown", fixedHour: 21, baseFee: 0 },
  { type: "1h", icon: "⏱", label: "限时 1h", desc: "开始后倒计时 60 分钟", mode: "countdown", durationMin: 60, baseFee: 0 },
  { type: "2h", icon: "⏱", label: "限时 2h", desc: "开始后倒计时 120 分钟", mode: "countdown", durationMin: 120, baseFee: 0 },
  { type: "infinit", icon: "♾️", label: "不限时畅玩", desc: "正计时模式，从 00:00:00 开始", mode: "countup", baseFee: 0 },
];

function regionById(idNumber) {
  if (idNumber <= 6) return "window";
  if (idNumber <= 16) return "table1";
  return "table2";
}

function emptyDesk(idNumber) {
  const id = String(idNumber).padStart(2, "0");
  return {
    id,
    region: regionById(idNumber),
    status: "empty",
    sessionType: "",
    mode: "countdown",
    prepareTime: 0,
    startTime: 0,
    endTime: 0,
    overTimeDuration: 0,
    extraTimeCount: 0,
    extraTimeFee: 0,
    isPaused: false,
    pauseStartTime: 0,
    pausedDuration: 0,
    note: "",
  };
}

function defaultDesks() {
  return Array.from({ length: 30 }, (_, index) => emptyDesk(index + 1));
}

function readStorage(keys) {
  try {
    for (const key of keys) {
      const value = window.localStorage.getItem(key);
      if (value) return value;
    }
  } catch (_) {
    return "";
  }
  return "";
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_) {
    // Private browsing can block localStorage. Runtime state still works.
  }
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function normalizeDesk(raw, fallback) {
  if (!raw || typeof raw !== "object") return fallback;

  const sessionType = validSessionTypes.has(raw.sessionType) ? raw.sessionType : fallback.sessionType;
  const mode = raw.mode === "countup" || sessionType === "infinit" ? "countup" : "countdown";
  const status = validStatuses.has(raw.status) ? raw.status : fallback.status;

  return {
    id: fallback.id,
    region: fallback.region,
    status: sessionType === "infinit" && status !== "empty" && status !== "preparing" ? "infinit" : status,
    sessionType,
    mode,
    prepareTime: safeNumber(raw.prepareTime),
    startTime: safeNumber(raw.startTime),
    endTime: safeNumber(raw.endTime),
    overTimeDuration: safeNumber(raw.overTimeDuration),
    extraTimeCount: safeNumber(raw.extraTimeCount),
    extraTimeFee: safeNumber(raw.extraTimeFee),
    isPaused: raw.isPaused === true,
    pauseStartTime: safeNumber(raw.pauseStartTime),
    pausedDuration: safeNumber(raw.pausedDuration),
    note: typeof raw.note === "string" ? raw.note : "",
  };
}

function loadDesks() {
  const fallback = defaultDesks();
  const raw = readStorage([DESK_STORAGE_KEY, ...LEGACY_DESK_KEYS]);
  if (!raw) return fallback;

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const byId = new Map(parsed.map((item) => [String(item && item.id ? item.id : ""), item]));
    return fallback.map((desk) => normalizeDesk(byId.get(desk.id), desk));
  } catch (_) {
    return fallback;
  }
}

function loadStats() {
  const raw = readStorage([STAT_STORAGE_KEY, ...LEGACY_STAT_KEYS]);
  if (!raw) return {};

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (_) {
    return {};
  }
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function dateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeOnly(timestamp) {
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function dateTime(timestamp) {
  if (!timestamp) return "--";
  const date = new Date(timestamp);
  return `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function durationClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map(pad).join(":");
}

function durationHuman(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / ONE_MIN_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  if (minutes === 0) return `${hours} 小时`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function sessionByType(sessionType) {
  return sessionPresets.find((preset) => preset.type === sessionType) || sessionPresets[4];
}

function fixedEndTime(timestamp, hour) {
  const date = new Date(timestamp);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function computeEndTime(sessionType, startAt) {
  const preset = sessionByType(sessionType);
  if (preset.mode === "countup") return 0;
  if (preset.durationMin) return startAt + preset.durationMin * ONE_MIN_MS;
  return fixedEndTime(startAt, preset.fixedHour);
}

function deriveCountdownStatus(endTime, timestamp) {
  const diff = endTime - timestamp;
  if (diff <= 0) return { status: "timeout", overTimeDuration: Math.floor(Math.abs(diff) / 1000) };
  if (diff > THIRTY_MIN_MS) return { status: "normal", overTimeDuration: 0 };
  if (diff > TEN_MIN_MS) return { status: "ending", overTimeDuration: 0 };
  return { status: "urgent", overTimeDuration: 0 };
}

function extraFee(minutes, timestamp) {
  const hour = new Date(timestamp).getHours();
  if (hour < 21) return minutes === 30 ? 10 : 20;
  return minutes === 30 ? 30 : 50;
}

function statusText(status) {
  const map = {
    empty: "空闲",
    preparing: "准备中",
    normal: "正常",
    ending: "尾声",
    urgent: "紧急",
    timeout: "已超时",
    infinit: "不限时",
  };
  return map[status] || "未知";
}

function elapsedMs(desk, timestamp) {
  if (!desk.startTime) return 0;
  return Math.max(0, timestamp - desk.startTime - desk.pausedDuration);
}

function countupText(desk, timestamp) {
  return durationClock(elapsedMs(desk, timestamp));
}

function stop(event, handler) {
  event.stopPropagation();
  handler();
}

createApp({
  setup() {
    const now = ref(Date.now());
    const desks = ref(loadDesks());
    const statsByDate = ref(loadStats());
    const activeRegion = ref("window");
    const openingDesk = ref(null);
    const showRecords = ref(false);
    const checkoutDraft = ref(null);

    let intervalId = 0;

    const today = computed(() => dateKey(now.value));
    const todayStat = computed(() => getDailyStat(today.value));
    const activeRegionMeta = computed(() => regionMeta.find((item) => item.key === activeRegion.value) || regionMeta[0]);
    const activeRegionDesks = computed(() => desks.value.filter((desk) => desk.region === activeRegion.value));
    const topStats = computed(() => {
      const activeToday = desks.value.filter((desk) => desk.status !== "empty" && dateKey(desk.prepareTime || desk.startTime || now.value) === today.value);
      const records = todayStat.value.records;
      const activeFee = activeToday.reduce((sum, desk) => sum + desk.extraTimeFee, 0);
      const closedFee = records.reduce((sum, record) => sum + safeNumber(record.totalFee ?? record.extraFee), 0);
      return {
        total: desks.value.length,
        empty: desks.value.filter((desk) => desk.status === "empty").length,
        preparing: desks.value.filter((desk) => desk.status === "preparing").length,
        using: desks.value.filter((desk) => ["normal", "ending", "urgent", "infinit"].includes(desk.status)).length,
        timeout: desks.value.filter((desk) => desk.status === "timeout").length,
        revenue: activeFee + closedFee,
      };
    });

    function getDailyStat(key) {
      const stat = statsByDate.value[key];
      if (stat && Array.isArray(stat.records)) return stat;
      return { totalDesks: 0, totalRevenue: 0, records: [] };
    }

    function persistDesks() {
      writeStorage(DESK_STORAGE_KEY, JSON.stringify(desks.value));
    }

    function persistStats() {
      writeStorage(STAT_STORAGE_KEY, JSON.stringify(statsByDate.value));
    }

    function tick() {
      const timestamp = Date.now();
      now.value = timestamp;
      let dirty = false;

      for (const desk of desks.value) {
        if (desk.status === "empty" || desk.status === "preparing" || desk.status === "infinit" || desk.isPaused) continue;

        const next = deriveCountdownStatus(desk.endTime, timestamp);
        if (desk.status !== next.status) {
          desk.status = next.status;
          dirty = true;
        }
        if (desk.overTimeDuration !== next.overTimeDuration) {
          desk.overTimeDuration = next.overTimeDuration;
          dirty = true;
        }
      }

      if (dirty) persistDesks();
    }

    function findDesk(id) {
      return desks.value.find((desk) => desk.id === id);
    }

    function resetDesk(desk) {
      Object.assign(desk, emptyDesk(Number(desk.id)));
    }

    function openDeskModal(desk) {
      if (desk.status !== "empty") return;
      openingDesk.value = desk;
    }

    function closeOpenModal() {
      openingDesk.value = null;
    }

    function canPrepare(sessionType) {
      const preset = sessionByType(sessionType);
      if (preset.mode === "countup" || preset.durationMin) return true;
      return computeEndTime(sessionType, now.value) > now.value;
    }

    function endHint(sessionType) {
      const preset = sessionByType(sessionType);
      if (preset.mode === "countup") return "正计时，不设结束时间";
      const endAt = computeEndTime(sessionType, now.value);
      if (endAt <= now.value) return "当前时间已超过该场次";
      return `预计结束 ${timeOnly(endAt)}`;
    }

    function prepareDesk(deskId, sessionType) {
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "empty") return;
      if (!canPrepare(sessionType)) {
        window.alert("当前时间已超过该场次结束时间，请选择其他模式。");
        return;
      }

      desk.status = "preparing";
      desk.sessionType = sessionType;
      desk.mode = sessionByType(sessionType).mode;
      desk.prepareTime = Date.now();
      desk.startTime = 0;
      desk.endTime = 0;
      desk.overTimeDuration = 0;
      desk.extraTimeCount = 0;
      desk.extraTimeFee = 0;
      desk.isPaused = false;
      desk.pauseStartTime = 0;
      desk.pausedDuration = 0;
      desk.note = "";
      persistDesks();
      closeOpenModal();
    }

    function startPreparedDesk(deskId) {
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "preparing") return;

      const startAt = Date.now();
      const preset = sessionByType(desk.sessionType);
      desk.startTime = startAt;
      desk.mode = preset.mode;
      desk.isPaused = false;
      desk.pauseStartTime = 0;
      desk.pausedDuration = 0;

      if (preset.mode === "countup") {
        desk.endTime = 0;
        desk.status = "infinit";
        desk.overTimeDuration = 0;
      } else {
        const endAt = computeEndTime(desk.sessionType, startAt);
        if (endAt <= startAt) {
          window.alert("当前时间已超过该场次结束时间，请重新选择场次。");
          return;
        }
        desk.endTime = endAt;
        const next = deriveCountdownStatus(endAt, startAt);
        desk.status = next.status;
        desk.overTimeDuration = next.overTimeDuration;
      }

      persistDesks();
    }

    function cancelPreparing(deskId) {
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "preparing") return;
      resetDesk(desk);
      persistDesks();
    }

    function addTime(deskId, minutes) {
      const desk = findDesk(deskId);
      if (!desk || desk.isPaused || !["normal", "ending", "urgent", "timeout"].includes(desk.status)) return;

      const timestamp = Date.now();
      const fee = extraFee(minutes, timestamp);
      const baseEndTime = Math.max(desk.endTime, timestamp);
      desk.endTime = baseEndTime + minutes * ONE_MIN_MS;
      desk.extraTimeCount += 1;
      desk.extraTimeFee += fee;

      const next = deriveCountdownStatus(desk.endTime, timestamp);
      desk.status = next.status;
      desk.overTimeDuration = next.overTimeDuration;
      persistDesks();
    }

    function isPausable(desk) {
      return ["normal", "ending", "urgent", "timeout", "infinit"].includes(desk.status);
    }

    function pauseDesk(deskId) {
      const desk = findDesk(deskId);
      if (!desk || !isPausable(desk) || desk.isPaused) return;
      desk.isPaused = true;
      desk.pauseStartTime = Date.now();
      persistDesks();
    }

    function resumeDesk(deskId) {
      const desk = findDesk(deskId);
      if (!desk || !desk.isPaused || !desk.pauseStartTime) return;

      const resumedAt = Date.now();
      const pausedMs = Math.max(0, resumedAt - desk.pauseStartTime);
      desk.pausedDuration += pausedMs;

      if (desk.mode === "countdown" && desk.endTime) {
        desk.endTime += pausedMs;
        const next = deriveCountdownStatus(desk.endTime, resumedAt);
        desk.status = next.status;
        desk.overTimeDuration = next.overTimeDuration;
      } else if (desk.mode === "countup") {
        desk.status = "infinit";
      }

      desk.isPaused = false;
      desk.pauseStartTime = 0;
      persistDesks();
    }

    function togglePause(deskId) {
      const desk = findDesk(deskId);
      if (!desk) return;
      if (desk.isPaused) resumeDesk(deskId);
      else pauseDesk(deskId);
    }

    function editNote(deskId) {
      const desk = findDesk(deskId);
      if (!desk || desk.status === "empty") return;
      const next = window.prompt("备注内容", desk.note || "");
      if (next === null) return;
      desk.note = next.trim().slice(0, 80);
      persistDesks();
    }

    function checkoutTime(desk, timestamp) {
      if (desk.isPaused && desk.pauseStartTime) return desk.pauseStartTime;
      return timestamp;
    }

    function buildCheckoutDraft(desk, timestamp, autoPaused, wasPausedBefore) {
      const closedAt = checkoutTime(desk, timestamp);
      const preset = sessionByType(desk.sessionType);
      const billableMs = desk.startTime ? elapsedMs(desk, closedAt) : 0;
      const billableMinutes = Math.max(0, Math.ceil(billableMs / ONE_MIN_MS));
      const timeoutSeconds = desk.mode === "countdown" && desk.startTime ? Math.max(0, Math.floor((closedAt - desk.endTime) / 1000)) : 0;
      const baseFee = safeNumber(preset.baseFee);
      const extra = safeNumber(desk.extraTimeFee);

      return {
        deskId: desk.id,
        sessionType: desk.sessionType,
        session: preset.label,
        mode: desk.mode,
        prepareTime: desk.prepareTime,
        startTime: desk.startTime,
        endTime: desk.endTime,
        closedAt,
        billableMs,
        billableMinutes,
        baseFee,
        extraFee: extra,
        totalFee: baseFee + extra,
        extraCount: desk.extraTimeCount,
        timeoutSeconds,
        pausedDuration: desk.pausedDuration,
        note: desk.note || "",
        wasPaused: wasPausedBefore,
        autoPaused,
      };
    }

    function askFinish(desk) {
      if (desk.status === "empty") return;
      const timestamp = Date.now();
      const wasPausedBefore = desk.isPaused;
      const autoPaused = isPausable(desk) && !wasPausedBefore;
      if (autoPaused) {
        desk.isPaused = true;
        desk.pauseStartTime = timestamp;
        persistDesks();
      }
      checkoutDraft.value = buildCheckoutDraft(desk, timestamp, autoPaused, wasPausedBefore);
    }

    function closeFinishModal() {
      const draft = checkoutDraft.value;
      if (draft && draft.autoPaused) {
        resumeDesk(draft.deskId);
      }
      checkoutDraft.value = null;
    }

    function finishDesk() {
      const draft = checkoutDraft.value;
      if (!draft) return;
      const desk = findDesk(draft.deskId);
      if (!desk || desk.status === "empty") return;

      const key = dateKey(draft.closedAt);
      const stat = getDailyStat(key);

      const record = {
        recordId: `${key}-${desk.id}-${draft.closedAt}`,
        date: key,
        deskId: draft.deskId,
        session: draft.session,
        mode: draft.mode,
        prepareTime: dateTime(draft.prepareTime),
        startTime: draft.startTime ? dateTime(draft.startTime) : "未开始",
        expectedEndTime: draft.endTime ? dateTime(draft.endTime) : "不限时",
        closedAt: dateTime(draft.closedAt),
        actualDuration: durationHuman(draft.billableMs),
        actualMinutes: draft.billableMinutes,
        baseFee: draft.baseFee,
        extraCount: draft.extraCount,
        extraFee: draft.extraFee,
        totalFee: draft.totalFee,
        isTimeout: draft.timeoutSeconds > 0,
        timeoutDuration: draft.timeoutSeconds,
        pausedDuration: draft.pausedDuration,
        note: draft.note,
      };

      statsByDate.value = {
        ...statsByDate.value,
        [key]: {
          totalDesks: stat.totalDesks + 1,
          totalRevenue: stat.totalRevenue + draft.totalFee,
          records: [...stat.records, record],
        },
      };

      resetDesk(desk);
      persistStats();
      persistDesks();
      checkoutDraft.value = null;
    }

    function primaryTimeText(desk) {
      const displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      if (desk.status === "empty") return "开桌";
      if (desk.status === "preparing") return `准备中 ${durationClock(now.value - desk.prepareTime)}`;
      if (desk.status === "infinit") return countupText(desk, displayAt);
      const diff = desk.endTime - displayAt;
      if (diff <= 0) return `⏱ 已超时 ${Math.floor(Math.abs(diff) / ONE_MIN_MS)} 分钟`;
      return durationClock(diff);
    }

    function timeLabel(desk) {
      if (desk.status === "empty") return "点击开桌";
      if (desk.isPaused) return "已暂停 · 时间冻结";
      if (desk.status === "preparing") return "等待开始计时";
      if (desk.status === "infinit") return "不限时正计时";
      if (desk.status === "timeout") return "超时正计时";
      return "剩余倒计时";
    }

    function deskClass(desk) {
      return `desk-card status-${desk.status} ${desk.isPaused ? "is-paused" : ""}`;
    }

    function renderStat(label, value, variant) {
      return h("article", { class: `stat-card ${variant}` }, [
        h("span", label),
        h("strong", value),
      ]);
    }

    function renderHeader() {
      return h("header", { class: "app-header" }, [
        h("div", [
          h("p", { class: "eyebrow" }, "LIBMS PERLER TIMER"),
          h("h1", "拼豆计时器"),
          h("p", { class: "subtitle" }, "准备中 · 倒计时 · 超时正计时 · 不限时正计时"),
        ]),
        h("button", { type: "button", class: "ghost-button", onClick: () => (showRecords.value = !showRecords.value) }, showRecords.value ? "收起流水" : "今日流水"),
      ]);
    }

    function renderStats() {
      return h("section", { class: "stats-strip", "aria-label": "上帝视角统计" }, [
        renderStat("总桌数", topStats.value.total, "slate"),
        renderStat("空闲", topStats.value.empty, "neutral"),
        renderStat("准备中", topStats.value.preparing, "cyan"),
        renderStat("使用中", topStats.value.using, "emerald"),
        renderStat("已超时", topStats.value.timeout, "rose"),
        renderStat("今日营收", `¥${topStats.value.revenue}`, "amber"),
      ]);
    }

    function renderTabs() {
      return h(
        "nav",
        { class: "region-tabs", "aria-label": "区域切换" },
        regionMeta.map((region) =>
          h(
            "button",
            {
              key: region.key,
              type: "button",
              class: `region-tab ${activeRegion.value === region.key ? "active" : ""}`,
              onClick: () => (activeRegion.value = region.key),
            },
            region.label
          )
        )
      );
    }

    function renderDeskMeta(desk) {
      return h("div", { class: "desk-times" }, [
        h("span", `准：${timeOnly(desk.prepareTime)}`),
        h("span", `开：${timeOnly(desk.startTime)}`),
      ]);
    }

    function renderEmptyDesk(desk) {
      return h("div", { class: "empty-state" }, [
        h("div", { class: "plus-mark" }, "+"),
        h("strong", "开桌"),
        h("span", "点击选择场次"),
      ]);
    }

    function renderActionButtons(desk) {
      if (desk.status === "empty") return null;

      if (desk.status === "preparing") {
        return h("div", { class: "desk-actions two" }, [
          h("button", { type: "button", class: "action start", onClick: (event) => stop(event, () => startPreparedDesk(desk.id)) }, "开始计时"),
          h("button", { type: "button", class: "action muted", onClick: (event) => stop(event, () => cancelPreparing(desk.id)) }, "取消"),
        ]);
      }

      if (desk.isPaused) {
        return h("div", { class: "desk-actions three" }, [
          h("button", { type: "button", class: "action resume", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "▶️ 恢复"),
          h("button", { type: "button", class: "action note", onClick: (event) => stop(event, () => editNote(desk.id)) }, "备注"),
          h("button", { type: "button", class: "action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑 结束"),
        ]);
      }

      if (desk.status === "infinit") {
        return h("div", { class: "desk-actions three" }, [
          h("button", { type: "button", class: "action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "⏸️ 暂停"),
          h("button", { type: "button", class: "action note", onClick: (event) => stop(event, () => editNote(desk.id)) }, "备注"),
          h("button", { type: "button", class: "action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑 结束"),
        ]);
      }

      if (desk.status === "timeout") {
        return h("div", { class: "desk-actions four" }, [
          h("button", { type: "button", class: "action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "⏸️"),
          h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 30)) }, "+30"),
          h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 60)) }, "+60"),
          h("button", { type: "button", class: "action stop danger", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑"),
        ]);
      }

      return h("div", { class: "desk-actions four" }, [
        h("button", { type: "button", class: "action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "⏸️"),
        h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 30)) }, "+30"),
        h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 60)) }, "+60"),
        h("button", { type: "button", class: "action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑"),
      ]);
    }

    function renderDeskCard(desk) {
      return h(
        "article",
        {
          key: desk.id,
          class: deskClass(desk),
          onClick: () => openDeskModal(desk),
        },
        [
          h("div", { class: "desk-head" }, [
            h("strong", { class: "desk-id" }, desk.id),
            h("span", { class: "status-pill" }, desk.isPaused ? "已暂停" : statusText(desk.status)),
          ]),
          desk.status === "empty"
            ? renderEmptyDesk(desk)
            : [
                h("p", { class: "project-name" }, sessionByType(desk.sessionType).label),
                renderDeskMeta(desk),
                h("div", { class: "live-time" }, [
                  h("small", timeLabel(desk)),
                  h("strong", primaryTimeText(desk)),
                ]),
                desk.note ? h("p", { class: "desk-note" }, desk.note) : null,
                renderActionButtons(desk),
              ],
        ]
      );
    }

    function renderActiveRegion() {
      const region = activeRegionMeta.value;
      return h("section", { class: "region-panel" }, [
        h("div", { class: "region-head" }, [
          h("div", [h("h2", region.title), h("p", `${region.range} · ${activeRegionDesks.value.length} 桌`)]),
          h("span", "手机端单区展示"),
        ]),
        h("div", { class: "desk-grid" }, activeRegionDesks.value.map(renderDeskCard)),
      ]);
    }

    function renderOpenModal() {
      if (!openingDesk.value) return null;
      return h("div", { class: "modal-backdrop", onClick: (event) => event.target === event.currentTarget && closeOpenModal() }, [
        h("section", { class: "sheet" }, [
          h("div", { class: "sheet-handle" }),
          h("div", { class: "sheet-title" }, [
            h("span", `桌号 ${openingDesk.value.id}`),
            h("strong", "选择开桌模式"),
          ]),
          h(
            "div",
            { class: "preset-list" },
            sessionPresets.map((preset) =>
              h(
                "button",
                {
                  key: preset.type,
                  type: "button",
                  disabled: !canPrepare(preset.type),
                  class: `preset-button ${canPrepare(preset.type) ? "" : "disabled"}`,
                  onClick: () => prepareDesk(openingDesk.value.id, preset.type),
                },
                [
                  h("span", { class: "preset-icon" }, preset.icon),
                  h("span", { class: "preset-copy" }, [
                    h("strong", preset.label),
                    h("small", preset.desc),
                  ]),
                  h("em", endHint(preset.type)),
                ]
              )
            )
          ),
          h("button", { type: "button", class: "sheet-cancel", onClick: closeOpenModal }, "取消"),
        ]),
      ]);
    }

    function renderFinishModal() {
      if (!checkoutDraft.value) return null;
      const draft = checkoutDraft.value;
      return h("div", { class: "modal-backdrop", onClick: (event) => event.target === event.currentTarget && closeFinishModal() }, [
        h("section", { class: "confirm-box" }, [
          h("h2", `🛑 ${draft.deskId} 号桌结算`),
          h("p", `场次：${draft.session} · 已停表 · ${draft.wasPaused ? "停表前已处于暂停状态" : "停表时已自动暂停"}`),
          h("div", { class: "settlement-grid" }, [
            h("div", [h("span", "实际使用"), h("strong", `${draft.billableMinutes} 分钟`)]),
            h("div", [h("span", "基础费"), h("strong", `¥${draft.baseFee}`)]),
            h("div", [h("span", "加时费"), h("strong", `¥${draft.extraFee}`)]),
            h("div", [h("span", "应收合计"), h("strong", `¥${draft.totalFee}`)]),
          ]),
          h("p", { class: "settlement-tip" }, "基础费当前按门店套餐价配置为 0；如需接入固定套餐价，可直接在场次配置里填写。"),
          h("div", { class: "confirm-actions" }, [
            h("button", { type: "button", class: "confirm-cancel", onClick: closeFinishModal }, "继续计时"),
            h("button", { type: "button", class: "confirm-submit", onClick: finishDesk }, "确认结账"),
          ]),
        ]),
      ]);
    }

    function renderRecords() {
      const records = todayStat.value.records;
      return h("section", { class: `records-drawer ${showRecords.value ? "open" : ""}` }, [
        h("button", { type: "button", class: "records-toggle", onClick: () => (showRecords.value = !showRecords.value) }, [
          h("span", "今日已完结订单明细"),
          h("strong", `${records.length} 条 ${showRecords.value ? "收起" : "展开"}`),
        ]),
        showRecords.value
          ? h(
              "div",
              { class: "records-table-wrap" },
              records.length === 0
                ? h("div", { class: "records-empty" }, "今天还没有完结订单。")
                : h("table", { class: "records-table" }, [
                    h("thead", [
                      h("tr", ["桌号", "场次", "准备", "开始", "结束/完结", "实际用时", "基础费", "加时费", "合计", "超时"].map((label) => h("th", label))),
                    ]),
                    h(
                      "tbody",
                      [...records].reverse().map((record) =>
                        h("tr", { key: record.recordId }, [
                          h("td", record.deskId),
                          h("td", record.session),
                          h("td", record.prepareTime),
                          h("td", record.startTime),
                          h("td", `${record.expectedEndTime} / ${record.closedAt}`),
                          h("td", record.actualDuration),
                          h("td", `¥${safeNumber(record.baseFee)}`),
                          h("td", `¥${record.extraFee}`),
                          h("td", `¥${safeNumber(record.totalFee ?? record.extraFee)}`),
                          h("td", { class: record.isTimeout ? "dangerText" : "" }, record.isTimeout ? `${Math.floor(record.timeoutDuration / 60)} 分钟` : "否"),
                        ])
                      )
                    ),
                  ])
            )
          : null,
      ]);
    }

    onMounted(() => {
      tick();
      intervalId = window.setInterval(tick, 1000);
    });

    onUnmounted(() => {
      if (intervalId) window.clearInterval(intervalId);
    });

    return () =>
      h("div", { class: "app-shell" }, [
        renderHeader(),
        renderStats(),
        renderTabs(),
        renderActiveRegion(),
        renderRecords(),
        renderOpenModal(),
        renderFinishModal(),
      ]);
  },
}).mount("#app");
