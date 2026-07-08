const { createApp, computed, onMounted, onUnmounted, ref } = Vue;

const DESK_STORAGE_KEY = "libms_perler_mentor_timer_desks_v1";
const STAT_STORAGE_KEY = "libms_perler_mentor_timer_stats_v1";
const HALF_HOUR_MS = 30 * 60 * 1000;
const TEN_MIN_MS = 10 * 60 * 1000;
const ONE_MIN_MS = 60 * 1000;

const sessionPresets = [
  { type: "morning", label: "早鸟场", desc: "默认到今日 12:00；若已过点，顺延 3 小时。" },
  { type: "afternoon", label: "下午场", desc: "默认到今日 18:00；若已过点，顺延 4 小时。" },
  { type: "night", label: "星光夜场", desc: "默认到今日 22:30；若已过点，顺延 2 小时。" },
  { type: "1h", label: "限时 1h", desc: "从开桌时间起计 60 分钟。" },
  { type: "2h", label: "限时 2h", desc: "从开桌时间起计 120 分钟。" },
  { type: "day", label: "包天", desc: "默认到今日 22:30；若已过点，顺延 8 小时。" },
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

function getFixedEndOrFallback(timestamp, hour, minute, fallbackHours) {
  const date = new Date(timestamp);
  date.setHours(hour, minute, 0, 0);
  const fixed = date.getTime();
  return fixed > timestamp ? fixed : timestamp + fallbackHours * 60 * ONE_MIN_MS;
}

function getInitialEndTime(sessionType, timestamp) {
  if (sessionType === "1h") return timestamp + 60 * ONE_MIN_MS;
  if (sessionType === "2h") return timestamp + 120 * ONE_MIN_MS;
  if (sessionType === "morning") return getFixedEndOrFallback(timestamp, 12, 0, 3);
  if (sessionType === "afternoon") return getFixedEndOrFallback(timestamp, 18, 0, 4);
  if (sessionType === "night") return getFixedEndOrFallback(timestamp, 22, 30, 2);
  return getFixedEndOrFallback(timestamp, 22, 30, 8);
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
  return "包天";
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
    const activeDeskCount = computed(() => desks.value.filter((desk) => desk.status !== "empty").length);
    const endingDeskCount = computed(() => desks.value.filter((desk) => desk.status === "ending" || desk.status === "urgent").length);
    const timeoutDeskCount = computed(() => desks.value.filter((desk) => desk.status === "timeout").length);
    const activeExtraFee = computed(() => desks.value.reduce((sum, desk) => sum + (desk.status === "empty" ? 0 : desk.extraTimeFee), 0));
    const regionSections = computed(() => [
      {
        region: "window",
        title: "靠玻璃幕墙",
        desc: "01-06",
        desks: desks.value.filter((desk) => desk.region === "window"),
      },
      {
        region: "table1",
        title: "长桌区 ①",
        desc: "07-16",
        desks: desks.value.filter((desk) => desk.region === "table1"),
      },
      {
        region: "table2",
        title: "长桌区 ②",
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

      let statusChanged = false;
      let hasTimeoutDesk = false;

      for (const desk of desks.value) {
        if (desk.status === "empty") continue;
        const next = deriveStatus(desk.endTime, timestamp);
        desk.overTimeDuration = next.overTimeDuration;
        if (desk.status !== next.status) {
          desk.status = next.status;
          statusChanged = true;
        }
        if (next.status === "timeout") hasTimeoutDesk = true;
      }

      if (statusChanged) saveDesks();
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

    function startDesk(deskId, sessionType) {
      ensureAudioReady();
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "empty") return;

      const timestamp = Date.now();
      const endTime = getInitialEndTime(sessionType, timestamp);
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
              date: dateKey,
              deskId: desk.id,
              session: sessionLabel(desk.sessionType),
              startTime: formatDateTime(desk.startTime),
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
      activeDeskCount,
      activeExtraFee,
      addExtraTime,
      cardClass,
      closeFinishDialog,
      closeOpenDialog,
      endingDeskCount,
      finishDesk,
      finishingDesk,
      formatTime,
      handleDeskTap,
      openFinishDialog,
      openingDesk,
      regionSections,
      sessionLabel,
      sessionPresets,
      startDesk,
      statusLabel,
      timeDisplay,
      timeoutDeskCount,
      todayKey,
      todayStat,
    };
  },
}).mount("#app");
