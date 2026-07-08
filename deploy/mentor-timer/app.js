const { createApp, computed, onMounted, onUnmounted, ref } = Vue;

const DESK_STORAGE_KEY = "libms_perler_mentor_timer_desks_v1";
const STAT_STORAGE_KEY = "libms_perler_mentor_timer_stats_v1";
const HALF_HOUR_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

const sessionPresets = [
  { type: "morning", label: "早鸟场", desc: "结束时间固定为当天 14:00。" },
  { type: "afternoon", label: "下午场", desc: "结束时间固定为当天 19:00。" },
  { type: "night", label: "星光夜场", desc: "结束时间固定为当天 21:00。" },
  { type: "day", label: "包天场", desc: "结束时间固定为当天 21:00。" },
  { type: "1h", label: "限时 1h", desc: "当前时间 + 60 分钟。" },
  { type: "2h", label: "限时 2h", desc: "当前时间 + 120 分钟。" },
];

const validStatuses = new Set(["empty", "normal", "ending", "urgent", "timeout"]);
const validSessionTypes = new Set(["morning", "afternoon", "night", "1h", "2h", "day"]);

function createEmptyDesk(idNumber) {
  const id = String(idNumber).padStart(2, "0");
  return {
    id,
    region: getRegionById(idNumber),
    status: "empty",
    sessionType: "1h",
    startTime: 0,
    endTime: 0,
    overTimeDuration: 0,
    extraTimeCount: 0,
    extraTimeFee: 0,
  };
}

function getRegionById(idNumber) {
  if (idNumber <= 6) return "window";
  if (idNumber <= 16) return "table1";
  return "table2";
}

function buildDefaultDesks() {
  return Array.from({ length: 30 }, (_, index) => createEmptyDesk(index + 1));
}

function safeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function readStorage(key) {
  try {
    return window.localStorage.getItem(key) || "";
  } catch (_) {
    return "";
  }
}

function writeStorage(key, value) {
  try {
    window.localStorage.setItem(key, value);
  } catch (_) {
    // localStorage may be blocked in private mode. The in-memory state still works.
  }
}

function normalizeDesk(raw, fallback) {
  if (!raw || typeof raw !== "object") return fallback;
  return {
    id: fallback.id,
    region: fallback.region,
    status: validStatuses.has(raw.status) ? raw.status : fallback.status,
    sessionType: validSessionTypes.has(raw.sessionType) ? raw.sessionType : fallback.sessionType,
    startTime: safeNumber(raw.startTime),
    endTime: safeNumber(raw.endTime),
    overTimeDuration: safeNumber(raw.overTimeDuration),
    extraTimeCount: safeNumber(raw.extraTimeCount),
    extraTimeFee: safeNumber(raw.extraTimeFee),
  };
}

function loadDeskCards() {
  const fallback = buildDefaultDesks();
  const raw = readStorage(DESK_STORAGE_KEY);
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
  const raw = readStorage(STAT_STORAGE_KEY);
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

function getDateKey(timestamp) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function formatTime(timestamp) {
  if (!timestamp) return "--:--";
  const date = new Date(timestamp);
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatDateTime(timestamp) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function formatClock(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds].map((value) => pad(value)).join(":");
}

function formatDuration(ms) {
  const totalMinutes = Math.max(0, Math.floor(ms / ONE_MIN_MS));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours <= 0) return `${minutes} 分钟`;
  return `${hours} 小时 ${minutes} 分钟`;
}

function deriveStatus(endTime, timestamp) {
  const diff = endTime - timestamp;
  if (diff <= 0) {
    return {
      status: "timeout",
      overTimeDuration: Math.floor(Math.abs(diff) / 1000),
    };
  }
  if (diff > HALF_HOUR_MS) return { status: "normal", overTimeDuration: 0 };
  if (diff > TEN_MIN_MS) return { status: "ending", overTimeDuration: 0 };
  return { status: "urgent", overTimeDuration: 0 };
}

function getFixedEndTime(timestamp, hour, minute) {
  const date = new Date(timestamp);
  date.setHours(hour, minute, 0, 0);
  return date.getTime();
}

function getInitialEndTime(sessionType, timestamp) {
  if (sessionType === "1h") return timestamp + 60 * ONE_MIN_MS;
  if (sessionType === "2h") return timestamp + 120 * ONE_MIN_MS;
  if (sessionType === "morning") return getFixedEndTime(timestamp, 14, 0);
  if (sessionType === "afternoon") return getFixedEndTime(timestamp, 19, 0);
  if (sessionType === "night") return getFixedEndTime(timestamp, 21, 0);
  return getFixedEndTime(timestamp, 21, 0);
}

function getExtraTimeFee(mins, timestamp) {
  const hour = new Date(timestamp).getHours();
  if (hour < 21) return mins === 30 ? 10 : 20;
  return mins === 30 ? 30 : 50;
}

function statusLabel(status) {
  if (status === "empty") return "空闲";
  if (status === "normal") return "正常";
  if (status === "ending") return "临近";
  if (status === "urgent") return "紧急";
  return "超时";
}

function sessionLabel(sessionType) {
  if (sessionType === "morning") return "早鸟场";
  if (sessionType === "afternoon") return "下午场";
  if (sessionType === "night") return "星光夜场";
  if (sessionType === "1h") return "限时 1h";
  if (sessionType === "2h") return "限时 2h";
  return "包天场";
}

createApp({
  setup() {
    const nowTick = ref(Date.now());
    const desks = ref(loadDeskCards());
    const statsByDate = ref(loadStats());
    const openingDesk = ref(null);
    const finishingDesk = ref(null);

    let tickTimer;
    let audioContext = null;
    let lastBeepAt = 0;

    const todayKey = computed(() => getDateKey(nowTick.value));
    const todayStat = computed(() => getDailyStat(todayKey.value));
    const topStats = computed(() => {
      const dateKey = todayKey.value;
      const activeToday = desks.value.filter((desk) => desk.status !== "empty" && getDateKey(desk.startTime) === dateKey);
      const finishedToday = todayStat.value.records;
      const activeTodayExtraFee = activeToday.reduce((sum, desk) => sum + desk.extraTimeFee, 0);
      const finishedTodayExtraFee = finishedToday.reduce((sum, record) => sum + safeNumber(record.extraFee), 0);

      return {
        todayTotal: activeToday.length + finishedToday.length,
        emptyCount: desks.value.filter((desk) => desk.status === "empty").length,
        usingCount: desks.value.filter((desk) => desk.status !== "empty" && desk.status !== "timeout").length,
        timeoutCount: desks.value.filter((desk) => desk.status === "timeout").length,
        todayRevenue: activeTodayExtraFee + finishedTodayExtraFee,
      };
    });
    const regionSections = computed(() => [
      {
        region: "window",
        title: "🪟 靠玻璃幕墙",
        desc: "01-06",
        desks: desks.value.filter((desk) => desk.region === "window"),
      },
      {
        region: "table1",
        title: "🪵 长桌区①",
        desc: "07-16",
        desks: desks.value.filter((desk) => desk.region === "table1"),
      },
      {
        region: "table2",
        title: "🪵 长桌区②",
        desc: "17-30",
        desks: desks.value.filter((desk) => desk.region === "table2"),
      },
    ]);

    function getDailyStat(dateKey) {
      const existing = statsByDate.value[dateKey];
      if (existing && Array.isArray(existing.records)) return existing;
      return { totalDesks: 0, totalRevenue: 0, records: [] };
    }

    function saveDesks() {
      writeStorage(DESK_STORAGE_KEY, JSON.stringify(desks.value));
    }

    function saveStats() {
      writeStorage(STAT_STORAGE_KEY, JSON.stringify(statsByDate.value));
    }

    function tick() {
      const timestamp = Date.now();
      nowTick.value = timestamp;

      let dirty = false;
      let hasTimeoutDesk = false;

      for (const desk of desks.value) {
        if (desk.status === "empty") continue;
        const next = deriveStatus(desk.endTime, timestamp);
        if (desk.overTimeDuration !== next.overTimeDuration) {
          desk.overTimeDuration = next.overTimeDuration;
          dirty = true;
        }
        if (desk.status !== next.status) {
          desk.status = next.status;
          dirty = true;
        }
        if (next.status === "timeout") hasTimeoutDesk = true;
      }

      if (dirty) saveDesks();
      if (hasTimeoutDesk && timestamp - lastBeepAt >= 5000) {
        lastBeepAt = timestamp;
        playSoftBeep();
      }
    }

    function findDesk(id) {
      return desks.value.find((desk) => desk.id === id);
    }

    function handleDeskTap(desk) {
      if (desk.status !== "empty") return;
      openingDesk.value = desk;
    }

    function closeOpenDialog() {
      openingDesk.value = null;
    }

    function isPresetAvailable(sessionType) {
      return getInitialEndTime(sessionType, nowTick.value) > nowTick.value;
    }

    function presetEndHint(sessionType) {
      const endTime = getInitialEndTime(sessionType, nowTick.value);
      if (endTime <= nowTick.value) return "当前时间已超过该场次";
      return `预计结束：${formatTime(endTime)}`;
    }

    function startDesk(deskId, sessionType) {
      ensureAudioReady();
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "empty") return;

      const timestamp = Date.now();
      const endTime = getInitialEndTime(sessionType, timestamp);
      if (endTime <= timestamp) {
        window.alert("当前时间已超过该场次结束时间，请选择其他场次。");
        return;
      }
      const derived = deriveStatus(endTime, timestamp);

      desk.sessionType = sessionType;
      desk.startTime = timestamp;
      desk.endTime = endTime;
      desk.status = derived.status;
      desk.overTimeDuration = derived.overTimeDuration;
      desk.extraTimeCount = 0;
      desk.extraTimeFee = 0;

      saveDesks();
      closeOpenDialog();
    }

    function addExtraTime(deskId, mins) {
      ensureAudioReady();
      const desk = findDesk(deskId);
      if (!desk || desk.status === "empty") return;

      const timestamp = Date.now();
      const fee = getExtraTimeFee(mins, timestamp);
      const baseEndTime = Math.max(desk.endTime, timestamp);

      desk.endTime = baseEndTime + mins * ONE_MIN_MS;
      desk.extraTimeCount += 1;
      desk.extraTimeFee += fee;

      const derived = deriveStatus(desk.endTime, timestamp);
      desk.status = derived.status;
      desk.overTimeDuration = derived.overTimeDuration;
      saveDesks();
    }

    function openFinishDialog(desk) {
      finishingDesk.value = desk;
    }

    function closeFinishDialog() {
      finishingDesk.value = null;
    }

    function finishDesk(deskId) {
      const desk = findDesk(deskId);
      if (!desk || desk.status === "empty") return;

      const finishAt = Date.now();
      const timeoutSeconds = Math.max(0, Math.floor((finishAt - desk.endTime) / 1000));
      const dateKey = getDateKey(finishAt);
      const current = getDailyStat(dateKey);

      statsByDate.value = {
        ...statsByDate.value,
        [dateKey]: {
          totalDesks: current.totalDesks + 1,
          totalRevenue: current.totalRevenue + desk.extraTimeFee,
          records: [
            ...current.records,
            {
              recordId: `${dateKey}-${desk.id}-${finishAt}`,
              date: dateKey,
              deskId: desk.id,
              session: sessionLabel(desk.sessionType),
              startTime: formatDateTime(desk.startTime),
              expectedEndTime: formatDateTime(desk.endTime),
              closedAt: formatDateTime(finishAt),
              endTime: formatDateTime(finishAt),
              actualDuration: formatDuration(finishAt - desk.startTime),
              extraCount: desk.extraTimeCount,
              extraFee: desk.extraTimeFee,
              isTimeout: timeoutSeconds > 0,
              timeoutDuration: timeoutSeconds,
            },
          ],
        },
      };

      Object.assign(desk, createEmptyDesk(Number(desk.id)));
      saveStats();
      saveDesks();
      closeFinishDialog();
    }

    function ensureAudioReady() {
      if (audioContext) return;
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) return;

      audioContext = new AudioCtor();
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
      }
    }

    function playSoftBeep() {
      if (!audioContext) return;
      if (audioContext.state === "suspended") {
        audioContext.resume().catch(() => {});
        return;
      }

      const start = audioContext.currentTime;
      scheduleTone(start);
      scheduleTone(start + 0.28);
    }

    function scheduleTone(startAt) {
      if (!audioContext) return;
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(620, startAt);
      oscillator.frequency.exponentialRampToValueAtTime(520, startAt + 0.18);
      gain.gain.setValueAtTime(0.0001, startAt);
      gain.gain.exponentialRampToValueAtTime(0.075, startAt + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, startAt + 0.22);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(startAt);
      oscillator.stop(startAt + 0.24);
    }

    function cardClass(desk) {
      if (desk.status === "empty") return "desk-empty";
      if (desk.status === "normal") return "desk-normal";
      if (desk.status === "ending") return "desk-ending";
      if (desk.status === "urgent") return "desk-urgent";
      return "desk-timeout";
    }

    function timeDisplay(desk) {
      const diff = desk.endTime - nowTick.value;
      if (diff <= 0) return `⏱ 已超时 ${Math.floor(Math.abs(diff) / ONE_MIN_MS)} 分钟`;
      return `剩余 ${formatClock(diff)}`;
    }

    onMounted(() => {
      tick();
      tickTimer = window.setInterval(tick, 1000);
    });

    onUnmounted(() => {
      if (tickTimer) window.clearInterval(tickTimer);
      if (audioContext && audioContext.state !== "closed") {
        audioContext.close().catch(() => {});
      }
    });

    return {
      addExtraTime,
      cardClass,
      closeFinishDialog,
      closeOpenDialog,
      finishDesk,
      finishingDesk,
      formatTime,
      handleDeskTap,
      isPresetAvailable,
      openFinishDialog,
      openingDesk,
      presetEndHint,
      regionSections,
      sessionLabel,
      sessionPresets,
      startDesk,
      statusLabel,
      timeDisplay,
      todayKey,
      todayStat,
      topStats,
    };
  },
}).mount("#app");
