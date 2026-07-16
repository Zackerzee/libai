if (window.LIBMS_TIMER_FORCE_COMPAT) {
  throw new Error("LIBMS timer compat mode forced.");
}

const { createApp, computed, h, onMounted, onUnmounted, ref } = Vue;

const DESK_STORAGE_KEY = "libms_perler_timer_desks_v3";
const STAT_STORAGE_KEY = "libms_perler_timer_stats_v3";
const LEGACY_DESK_KEYS = ["libms_perler_mentor_timer_desks_v2", "libms_perler_mentor_timer_desks_v1"];
const LEGACY_STAT_KEYS = ["libms_perler_mentor_timer_stats_v2", "libms_perler_mentor_timer_stats_v1"];

const ONE_MIN_MS = 60 * 1000;
const TEN_MIN_MS = 10 * ONE_MIN_MS;
const THIRTY_MIN_MS = 30 * ONE_MIN_MS;
const LIMITED_START_DELAY_MS = 10 * ONE_MIN_MS;
const OVERTIME_GRACE_SECONDS = 10 * 60;
const PRINT_BRIDGE_URL = "http://127.0.0.1:17888/print-label";

const validStatuses = new Set(["empty", "preparing", "normal", "ending", "urgent", "timeout", "infinit"]);
const validSessionTypes = new Set(["morning", "afternoon", "night", "day", "1h", "2h", "infinit", "iron52", "iron78"]);

const regionMeta = [
  { key: "window", label: "🪟 玻璃幕墙", title: "🪟 靠玻璃幕墙", range: "01 - 06" },
  { key: "table1", label: "🪵 长桌①", title: "🪵 长桌区①", range: "07 - 16" },
  { key: "table2", label: "🪵 长桌②", title: "🪵 长桌区②", range: "17 - 30" },
];

const seatMapLayouts = [
  {
    id: "front-table",
    title: "上方横桌",
    subtitle: "01 - 06",
    hint: "从左到右 06 - 01",
    orientation: "horizontal",
    seats: ["06", "05", "04", "03", "02", "01"].map((id) => ({ id, pos: "bottom" })),
  },
  {
    id: "left-table",
    title: "左侧长桌",
    subtitle: "07 - 16",
    hint: "上 07 · 下 12",
    orientation: "vertical",
    seats: [
      { id: "07", pos: "top" },
      { id: "08", pos: "right" },
      { id: "09", pos: "right" },
      { id: "10", pos: "right" },
      { id: "11", pos: "right" },
      { id: "16", pos: "left" },
      { id: "15", pos: "left" },
      { id: "14", pos: "left" },
      { id: "13", pos: "left" },
      { id: "12", pos: "bottom" },
    ],
  },
  {
    id: "right-table",
    title: "右侧大长桌",
    subtitle: "17 - 30",
    hint: "上 17/18 · 下 25/24",
    orientation: "vertical large",
    seats: [
      { id: "17", pos: "top" },
      { id: "18", pos: "top" },
      { id: "30", pos: "left" },
      { id: "29", pos: "left" },
      { id: "28", pos: "left" },
      { id: "27", pos: "left" },
      { id: "26", pos: "left" },
      { id: "19", pos: "right" },
      { id: "20", pos: "right" },
      { id: "21", pos: "right" },
      { id: "22", pos: "right" },
      { id: "23", pos: "right" },
      { id: "25", pos: "bottom" },
      { id: "24", pos: "bottom" },
    ],
  },
];

const sessionPresets = [
  { type: "morning", icon: "🌅", label: "早鸟场（工作日）", desc: "工作日可开，到当天 14:00", mode: "countdown", fixedHour: 14, weekdayOnly: true, baseFee: 0 },
  { type: "afternoon", icon: "☀️", label: "午后休闲（工作日）", desc: "工作日可开，到当天 19:00", mode: "countdown", fixedHour: 19, weekdayOnly: true, baseFee: 0 },
  { type: "night", icon: "🌙", label: "星光夜场（工作日）", desc: "工作日可开，到当天 21:00", mode: "countdown", fixedHour: 21, weekdayOnly: true, baseFee: 0 },
  { type: "day", icon: "🎫", label: "全天畅玩（不限时不限量不限板）", desc: "正计时记录，最终结束时间 21:00", mode: "countup", fixedHour: 21, baseFee: 0 },
  { type: "1h", icon: "⏱", label: "限时 1 小时（52×52 小板熨烫一次）", desc: "开始后倒计时 60 分钟", mode: "countdown", durationMin: 60, baseFee: 0 },
  { type: "2h", icon: "⏱", label: "限时 2 小时（52×52 小板熨烫一次）", desc: "开始后倒计时 120 分钟", mode: "countdown", durationMin: 120, baseFee: 0 },
  { type: "infinit", icon: "♾️", label: "智能板不限时畅玩（不限时不限板不限量）", desc: "正计时记录，最终结束时间 21:00", mode: "countup", fixedHour: 21, baseFee: 0 },
  { type: "iron52", icon: "🧩", label: "52×52 单板熨烫一次", desc: "单次熨烫服务，正计时记录", mode: "countup", baseFee: 0 },
  { type: "iron78", icon: "🧩", label: "78×78 单板熨烫一次", desc: "单次熨烫服务，正计时记录", mode: "countup", baseFee: 0 },
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

function timeInputValue(timestamp) {
  return timeOnly(timestamp || Date.now());
}

function timestampFromTimeInput(value, baseTimestamp = Date.now()) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
  const date = new Date(baseTimestamp);
  if (!match) return baseTimestamp;

  const hours = Math.min(23, Math.max(0, Number(match[1])));
  const minutes = Math.min(59, Math.max(0, Number(match[2])));
  date.setHours(hours, minutes, 0, 0);
  return date.getTime();
}

function shiftTimeInputValue(value, minutes, baseTimestamp = Date.now()) {
  return timeInputValue(timestampFromTimeInput(value, baseTimestamp) + minutes * ONE_MIN_MS);
}

function isWeekend(timestamp) {
  const day = new Date(timestamp).getDay();
  return day === 0 || day === 6;
}

function fullDateTime(timestamp) {
  const weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
  const date = new Date(timestamp);
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日 ${weekDays[date.getDay()]} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
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

function isLimitedSession(sessionType) {
  return sessionByType(sessionType).mode === "countdown";
}

function splitPresetLabel(label) {
  const match = String(label || "").match(/^(.+?)([（(][^）)]*[）)])$/);
  if (!match) return { title: label || "", sub: "" };
  return { title: match[1].trim(), sub: match[2].trim() };
}

function compactSessionLabel(sessionType) {
  return splitPresetLabel(sessionByType(sessionType).label).title;
}

function fixedEndTime(timestamp, hour) {
  const date = new Date(timestamp);
  date.setHours(hour, 0, 0, 0);
  return date.getTime();
}

function computeEndTime(sessionType, startAt) {
  const preset = sessionByType(sessionType);
  if (preset.mode === "countup") return preset.fixedHour ? fixedEndTime(startAt, preset.fixedHour) : 0;
  if (preset.durationMin) return startAt + preset.durationMin * ONE_MIN_MS;
  return fixedEndTime(startAt, preset.fixedHour);
}

function hasValidEndTime(sessionType, startAt) {
  const preset = sessionByType(sessionType);
  return preset.mode === "countup" || computeEndTime(sessionType, startAt) > startAt;
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

function extensionFeeForMinutes(minutes, timestamp) {
  let remaining = Math.ceil(Math.max(0, minutes) / 30) * 30;
  let fee = 0;
  while (remaining > 0) {
    const chunk = remaining >= 60 ? 60 : 30;
    fee += extraFee(chunk, timestamp);
    remaining -= chunk;
  }
  return fee;
}

function timeoutFee(timeoutSeconds, endTime) {
  if (!endTime || timeoutSeconds <= OVERTIME_GRACE_SECONDS) return { fee: 0, chargedMinutes: 0 };
  const timeoutMinutesFromEnd = Math.ceil(timeoutSeconds / 60);
  return {
    fee: extensionFeeForMinutes(timeoutMinutesFromEnd, endTime),
    chargedMinutes: Math.ceil(timeoutMinutesFromEnd / 30) * 30,
  };
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

function requestPrintBridge(payload) {
  if (!window.fetch) {
    return Promise.reject(new Error("当前浏览器不支持本机打印请求"));
  }

  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeoutId = controller ? window.setTimeout(() => controller.abort(), 10000) : 0;

  return window
    .fetch(PRINT_BRIDGE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined,
      mode: "cors",
    })
    .then((response) => {
      if (!response.ok) throw new Error(`print bridge ${response.status}`);
      return response.json().catch(() => ({}));
    })
    .then((data) => {
      if (data && data.ok === false) throw new Error(data.error || "print failed");
      console.info("[LIBMS Timer] 开台标签已发送到本机打印桥", payload);
      return data || { ok: true };
    })
    .finally(() => {
      if (timeoutId) window.clearTimeout(timeoutId);
    });
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
    const openStartUseNow = ref(true);
    const openStartInput = ref(timeInputValue(Date.now()));
    const printStatus = ref("打印桥待命：开桌后会自动发送标签。");
    const lastPrintPayload = ref(null);
    const isAggregatedOnly = ref(false);
    const showRecords = ref(false);
    const checkoutDraft = ref(null);
    const adjustingDesk = ref(null);
    const movingDesk = ref(null);
    const detailDesk = ref(null);
    const moveTargetId = ref("");
    const adjustStartInput = ref(timeInputValue(Date.now()));
    const adjustRemainingInput = ref("30");
    const adjustEndInput = ref(timeInputValue(Date.now()));

    let intervalId = 0;
    let audioContext = null;
    let unlockBellHandler = null;
    const timeoutBellDeskIds = new Set(desks.value.filter((desk) => desk.status === "timeout").map((desk) => desk.id));

    const today = computed(() => dateKey(now.value));
    const todayStat = computed(() => getDailyStat(today.value));
    const activeRegionMeta = computed(() => regionMeta.find((item) => item.key === activeRegion.value) || regionMeta[0]);
    const activeRegionDesks = computed(() => desks.value.filter((desk) => desk.region === activeRegion.value));
    const activeDesks = computed(() => desks.value.filter((desk) => desk.status !== "empty"));
    const displayedDesks = computed(() => (isAggregatedOnly.value ? activeDesks.value : activeRegionDesks.value));
    const topStats = computed(() => {
      const activeToday = desks.value.filter((desk) => desk.status !== "empty" && dateKey(desk.prepareTime || desk.startTime || now.value) === today.value);
      const records = todayStat.value.records;
      const activeFee = activeToday.reduce((sum, desk) => sum + desk.extraTimeFee, 0);
      const closedFee = records.reduce((sum, record) => sum + safeNumber(record.totalFee ?? record.extraFee), 0);
      return {
        total: desks.value.length,
        empty: desks.value.filter((desk) => desk.status === "empty").length,
        preparing: desks.value.filter((desk) => desk.status === "preparing").length,
        using: activeDesks.value.length,
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

    function ensureBellAudio() {
      try {
        const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextCtor) return null;
        if (!audioContext) audioContext = new AudioContextCtor();
        if (audioContext.state === "suspended") {
          audioContext.resume().catch(() => {});
        }
        return audioContext;
      } catch (error) {
        console.warn("[LIBMS Timer] 响铃音频初始化失败，计时操作继续：", error);
        return null;
      }
    }

    function playTimeoutBell(desk) {
      const context = ensureBellAudio();
      if (window.navigator && typeof window.navigator.vibrate === "function") {
        window.navigator.vibrate([180, 80, 180, 80, 260]);
      }
      if (!context) return;

      const startAt = context.currentTime + 0.02;
      [0, 0.22, 0.46].forEach((offset, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.type = "sine";
        oscillator.frequency.setValueAtTime(index === 1 ? 740 : 880, startAt + offset);
        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + offset + 0.025);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.18);
        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + 0.2);
      });

      if (document && document.title) {
        document.title = `⏰ ${desk.id}号桌到时｜拼豆计时器`;
        window.setTimeout(() => {
          document.title = "拼豆计时器｜时里白造物创意手作体验空间";
        }, 8000);
      }
    }

    function ringTimeoutOnce(desk) {
      if (!desk || timeoutBellDeskIds.has(desk.id)) return;
      timeoutBellDeskIds.add(desk.id);
      playTimeoutBell(desk);
    }

    function markDeskNotTimeout(deskId) {
      timeoutBellDeskIds.delete(deskId);
    }

    function applyCountdownStatus(desk, timestamp, options = {}) {
      const previousStatus = desk.status;
      const previousOverTime = desk.overTimeDuration;
      const next = deriveCountdownStatus(desk.endTime, timestamp);
      desk.status = next.status;
      desk.overTimeDuration = next.overTimeDuration;

      if (next.status === "timeout") {
        if (options.ring !== false && previousStatus !== "timeout") ringTimeoutOnce(desk);
      } else {
        markDeskNotTimeout(desk.id);
      }

      return previousStatus !== desk.status || previousOverTime !== desk.overTimeDuration;
    }

    function tick() {
      const timestamp = Date.now();
      now.value = timestamp;
      let dirty = false;

      for (const desk of desks.value) {
        if (desk.status === "empty" || desk.status === "infinit" || desk.isPaused) continue;

        if (desk.status === "preparing") {
          if (desk.startTime && desk.startTime <= timestamp) {
            if (desk.mode === "countup") {
              desk.status = "infinit";
              desk.overTimeDuration = 0;
              markDeskNotTimeout(desk.id);
            } else {
              applyCountdownStatus(desk, timestamp);
            }
            dirty = true;
          }
          continue;
        }

        const beforeStatus = desk.status;
        const beforeOverTime = desk.overTimeDuration;
        applyCountdownStatus(desk, timestamp);
        if (desk.status !== beforeStatus || desk.overTimeDuration !== beforeOverTime) dirty = true;
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
      ensureBellAudio();
      openingDesk.value = desk;
      openStartUseNow.value = true;
      openStartInput.value = timeInputValue(Date.now());
    }

    function closeOpenModal() {
      openingDesk.value = null;
    }

    function openDeskDetail(desk) {
      if (!desk || desk.status === "empty") return;
      ensureBellAudio();
      detailDesk.value = desk;
    }

    function closeDetailModal() {
      detailDesk.value = null;
    }

    function resolveOpenStartAt(sessionType = "", anchor = Date.now()) {
      const baseStartAt = openStartUseNow.value ? anchor : timestampFromTimeInput(openStartInput.value, anchor);
      return sessionType && isLimitedSession(sessionType) ? baseStartAt + LIMITED_START_DELAY_MS : baseStartAt;
    }

    function toggleOpenStartMode(useNow) {
      openStartUseNow.value = useNow;
      if (useNow) openStartInput.value = timeInputValue(Date.now());
    }

    function shiftOpenStart(minutes) {
      if (openStartUseNow.value) openStartInput.value = timeInputValue(Date.now());
      openStartUseNow.value = false;
      openStartInput.value = shiftTimeInputValue(openStartInput.value, minutes, now.value);
    }

    function canPrepare(sessionType, startAt = resolveOpenStartAt(sessionType)) {
      const preset = sessionByType(sessionType);
      if (preset.weekdayOnly && isWeekend(startAt)) return false;
      if (preset.mode === "countup") return preset.fixedHour ? hasValidEndTime(sessionType, startAt) : true;
      if (preset.durationMin) return true;
      return hasValidEndTime(sessionType, startAt);
    }

    function endHint(sessionType, startAt = resolveOpenStartAt(sessionType)) {
      const preset = sessionByType(sessionType);
      if (preset.weekdayOnly && isWeekend(startAt)) return "周六周日不可开";
      if (preset.mode === "countup") {
        const endAt = computeEndTime(sessionType, startAt);
        if (!endAt) return "正计时，不设结束时间";
        if (endAt <= startAt) return "开始时间已超过 21:00";
        return `${timeOnly(startAt)} → ${timeOnly(endAt)} · 正计时`;
      }
      const endAt = computeEndTime(sessionType, startAt);
      if (endAt <= startAt) return "开始时间已超过场次";
      return `${timeOnly(startAt)} → ${timeOnly(endAt)}${endAt <= now.value ? " · 已超时" : ""}`;
    }

    function applyDeskStart(desk, sessionType, startAt, timestamp) {
      const preset = sessionByType(sessionType);
      desk.sessionType = sessionType;
      desk.mode = preset.mode;
      desk.prepareTime = timestamp;
      desk.startTime = startAt;
      desk.overTimeDuration = 0;
      desk.extraTimeCount = 0;
      desk.extraTimeFee = 0;
      desk.isPaused = false;
      desk.pauseStartTime = 0;
      desk.pausedDuration = 0;
      desk.note = "";
      markDeskNotTimeout(desk.id);

      if (preset.mode === "countup") {
        const endAt = computeEndTime(sessionType, startAt);
        if (endAt && endAt <= startAt) return false;
        desk.endTime = endAt;
        desk.status = startAt > timestamp ? "preparing" : "infinit";
        return true;
      }

      const endAt = computeEndTime(sessionType, startAt);
      if (endAt <= startAt) return false;

      desk.endTime = endAt;
      if (startAt > timestamp) {
        desk.status = "preparing";
        return true;
      }

      const next = deriveCountdownStatus(endAt, timestamp);
      desk.status = next.status;
      desk.overTimeDuration = next.overTimeDuration;
      if (next.status === "timeout") timeoutBellDeskIds.add(desk.id);
      return true;
    }

    function buildPrintPayload(desk, noteOverride = "") {
      return {
        deskId: desk.id,
        session: sessionByType(desk.sessionType).label,
        mode: desk.mode,
        startLabel: timeOnly(desk.startTime),
        endLabel: desk.endTime ? timeOnly(desk.endTime) : "",
        note: noteOverride || (desk.mode === "countdown" ? "请按时提醒顾客" : desk.endTime ? "正计时，到 21:00" : "不限时 / 正计时"),
      };
    }

    function formatPrintError(error) {
      if (error && error.name === "AbortError") return "打印桥连接超时，请确认本机打印桥窗口还在运行。";
      const message = error && error.message ? error.message : String(error || "未知错误");
      if (/Failed to fetch|NetworkError|Load failed|ERR_CONNECTION_REFUSED/i.test(message)) {
        return "连接不到本机打印桥，请在这台电脑打开 http://127.0.0.1:17888/health 检查。";
      }
      return message;
    }

    function sendDeskLabel(desk, reason = "开桌", noteOverride = "") {
      const payload = buildPrintPayload(desk, noteOverride);
      lastPrintPayload.value = payload;
      printStatus.value = `${reason}：正在发送 ${desk.id} 号桌标签...`;

      requestPrintBridge(payload)
        .then(() => {
          printStatus.value = `${desk.id} 号桌标签已发送到本机打印桥。`;
        })
        .catch((error) => {
          const message = formatPrintError(error);
          printStatus.value = `${desk.id} 号桌标签未打印：${message}`;
          console.warn("[LIBMS Timer] 标签打印失败，计时已正常开桌：", error);
        });
    }

    function reprintLastLabel() {
      if (!lastPrintPayload.value) {
        window.alert("还没有可补打的标签。请先开桌，或在使用中的桌位点“补打”。");
        return;
      }

      const payload = lastPrintPayload.value;
      printStatus.value = `正在补打 ${payload.deskId} 号桌标签...`;
      requestPrintBridge(payload)
        .then(() => {
          printStatus.value = `${payload.deskId} 号桌标签已重新发送。`;
        })
        .catch((error) => {
          printStatus.value = `${payload.deskId} 号桌补打失败：${formatPrintError(error)}`;
        });
    }

    function reprintDeskLabel(deskId) {
      const desk = findDesk(deskId);
      if (!desk || desk.status === "empty") return;
      sendDeskLabel(desk, "补打");
    }

    function openMoveModal(desk) {
      ensureBellAudio();
      if (!desk || desk.status === "empty") return;
      movingDesk.value = desk;
      moveTargetId.value = "";
    }

    function closeMoveModal() {
      movingDesk.value = null;
      moveTargetId.value = "";
    }

    function moveTargetDesks() {
      const source = movingDesk.value;
      if (!source) return [];
      return desks.value.filter((desk) => desk.status === "empty" && desk.id !== source.id);
    }

    function confirmMoveDesk() {
      const source = movingDesk.value;
      const target = findDesk(moveTargetId.value);
      if (!source || source.status === "empty") return;
      if (!target || target.status !== "empty") {
        window.alert("请选择一个空闲桌位，不能覆盖正在使用的桌位。");
        return;
      }

      const fromId = source.id;
      const toId = target.id;
      const toRegion = target.region;
      const movedNote = `由 ${fromId} 换至 ${toId}`;
      const nextNote = source.note ? `${source.note}；${movedNote}` : movedNote;
      const movedData = {
        ...source,
        id: toId,
        region: toRegion,
        note: nextNote.slice(0, 80),
      };

      Object.assign(target, movedData);
      resetDesk(source);
      markDeskNotTimeout(fromId);
      if (target.status === "timeout") timeoutBellDeskIds.add(toId);
      else markDeskNotTimeout(toId);

      persistDesks();
      sendDeskLabel(target, "换桌成功", `换桌标签 · 原${fromId} → 新${toId}`);
      closeMoveModal();
    }

    function prepareDesk(deskId, sessionType) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      const timestamp = Date.now();
      const startAt = resolveOpenStartAt(sessionType, timestamp);
      if (!desk || desk.status !== "empty") return;
      if (!canPrepare(sessionType, startAt) || !applyDeskStart(desk, sessionType, startAt, timestamp)) {
        window.alert("开始时间不适合该场次：工作日场次周六周日不可开，或开始时间已超过场次结束时间。");
        return;
      }

      persistDesks();
      sendDeskLabel(desk, "开桌成功");
      closeOpenModal();
    }

    function startPreparedDesk(deskId) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "preparing") return;

      const timestamp = Date.now();
      const startAt = desk.startTime && desk.startTime <= timestamp ? desk.startTime : timestamp;
      if (!applyDeskStart(desk, desk.sessionType, startAt, timestamp)) {
        window.alert("当前时间已超过该场次结束时间，请重新选择场次。");
        return;
      }

      persistDesks();
    }

    function cancelPreparing(deskId) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      if (!desk || desk.status !== "preparing") return;
      markDeskNotTimeout(desk.id);
      resetDesk(desk);
      persistDesks();
    }

    function addTime(deskId, minutes) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      if (!desk || desk.isPaused || !["normal", "ending", "urgent", "timeout"].includes(desk.status)) return;

      const timestamp = Date.now();
      const fee = extraFee(minutes, timestamp);
      const baseEndTime = Math.max(desk.endTime, timestamp);
      desk.endTime = baseEndTime + minutes * ONE_MIN_MS;
      desk.extraTimeCount += 1;
      desk.extraTimeFee += fee;

      applyCountdownStatus(desk, timestamp, { ring: false });
      persistDesks();
    }

    function canAdjustTime(desk) {
      return desk && desk.mode === "countdown" && desk.status !== "empty";
    }

    function openAdjustModal(desk) {
      ensureBellAudio();
      if (!canAdjustTime(desk)) return;
      const anchor = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : Date.now();
      const remainingMinutes = Math.max(0, Math.ceil((desk.endTime - anchor) / ONE_MIN_MS));
      adjustingDesk.value = desk;
      adjustStartInput.value = timeInputValue(desk.startTime || anchor);
      adjustRemainingInput.value = String(remainingMinutes || 30);
      adjustEndInput.value = timeInputValue(desk.endTime || anchor + 30 * ONE_MIN_MS);
    }

    function closeAdjustModal() {
      adjustingDesk.value = null;
    }

    function setDeskTiming(desk, startAt, endAt) {
      if (!canAdjustTime(desk)) return;
      const timestamp = Date.now();
      if (!startAt || !endAt || endAt <= startAt) {
        window.alert("结束时间必须晚于开始时间，请重新调整。");
        return;
      }

      desk.startTime = startAt;
      desk.endTime = endAt;
      if (startAt > timestamp) {
        desk.status = "preparing";
        desk.overTimeDuration = 0;
        desk.isPaused = false;
        desk.pauseStartTime = 0;
        markDeskNotTimeout(desk.id);
      } else {
        if (desk.isPaused) desk.pauseStartTime = timestamp;
        const statusAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : timestamp;
        applyCountdownStatus(desk, statusAt, { ring: false });
      }
      if (desk.status !== "timeout") markDeskNotTimeout(desk.id);
      closeAdjustModal();
      persistDesks();
    }

    function updateDraftRemainingFromEnd() {
      const base = Date.now();
      const endAt = timestampFromTimeInput(adjustEndInput.value, base);
      adjustRemainingInput.value = String(Math.max(0, Math.ceil((endAt - base) / ONE_MIN_MS)));
    }

    function applyRemainingToDraftEnd() {
      const raw = Number(adjustRemainingInput.value);
      if (!Number.isFinite(raw) || raw < 0 || raw > 24 * 60) {
        window.alert("请输入 0 到 1440 之间的剩余分钟数。");
        return;
      }
      const anchor = Date.now();
      adjustEndInput.value = timeInputValue(anchor + Math.round(raw) * ONE_MIN_MS);
    }

    function confirmAdjustTiming() {
      const desk = adjustingDesk.value;
      if (!canAdjustTime(desk)) return;
      const timestamp = Date.now();
      const startAt = timestampFromTimeInput(adjustStartInput.value, timestamp);
      const endAt = timestampFromTimeInput(adjustEndInput.value, timestamp);
      setDeskTiming(desk, startAt, endAt);
    }

    function nudgeEndTime(minutes) {
      const currentEnd = timestampFromTimeInput(adjustEndInput.value, Date.now());
      const nextEnd = currentEnd + minutes * ONE_MIN_MS;
      adjustEndInput.value = timeInputValue(nextEnd);
      const anchor = Date.now();
      adjustRemainingInput.value = String(Math.max(0, Math.ceil((nextEnd - anchor) / ONE_MIN_MS)));
    }

    function isPausable(desk) {
      return ["normal", "ending", "urgent", "timeout", "infinit"].includes(desk.status);
    }

    function pauseDesk(deskId) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      if (!desk || !isPausable(desk) || desk.isPaused) return;
      desk.isPaused = true;
      desk.pauseStartTime = Date.now();
      persistDesks();
    }

    function resumeDesk(deskId) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      if (!desk || !desk.isPaused || !desk.pauseStartTime) return;

      const resumedAt = Date.now();
      const pausedMs = Math.max(0, resumedAt - desk.pauseStartTime);
      desk.pausedDuration += pausedMs;

      if (desk.mode === "countdown" && desk.endTime) {
        desk.endTime += pausedMs;
        applyCountdownStatus(desk, resumedAt, { ring: false });
      } else if (desk.mode === "countup") {
        desk.status = "infinit";
        markDeskNotTimeout(desk.id);
      }

      desk.isPaused = false;
      desk.pauseStartTime = 0;
      persistDesks();
    }

    function togglePause(deskId) {
      ensureBellAudio();
      const desk = findDesk(deskId);
      if (!desk) return;
      if (desk.isPaused) resumeDesk(deskId);
      else pauseDesk(deskId);
    }

    function editNote(deskId) {
      ensureBellAudio();
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
      const timeoutCharge = timeoutFee(timeoutSeconds, desk.endTime);

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
        timeoutFee: timeoutCharge.fee,
        timeoutChargedMinutes: timeoutCharge.chargedMinutes,
        totalFee: baseFee + extra + timeoutCharge.fee,
        extraCount: desk.extraTimeCount,
        timeoutSeconds,
        pausedDuration: desk.pausedDuration,
        note: desk.note || "",
        wasPaused: wasPausedBefore,
        autoPaused,
      };
    }

    function askFinish(desk) {
      ensureBellAudio();
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
        timeoutFee: draft.timeoutFee,
        timeoutChargedMinutes: draft.timeoutChargedMinutes,
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
      markDeskNotTimeout(desk.id);
      persistStats();
      persistDesks();
      checkoutDraft.value = null;
    }

    function primaryTimeText(desk) {
      const displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      if (desk.status === "empty") return "开桌";
      if (desk.status === "preparing") {
        if (desk.startTime && desk.startTime > now.value) return `距开始 ${durationClock(desk.startTime - now.value)}`;
        return `准备中 ${durationClock(now.value - desk.prepareTime)}`;
      }
      if (desk.status === "infinit") return countupText(desk, displayAt);
      const diff = desk.endTime - displayAt;
      if (diff <= 0) return `⏱ 已超时 ${Math.floor(Math.abs(diff) / ONE_MIN_MS)} 分钟`;
      return durationClock(diff);
    }

    function timeLabel(desk) {
      if (desk.status === "empty") return "点击开桌";
      if (desk.isPaused) return "已暂停 · 时间冻结";
      if (desk.status === "preparing") return desk.startTime && desk.startTime > now.value ? "预设开始时间" : "等待开始计时";
      if (desk.status === "infinit") return desk.endTime ? `正计时 · 到 ${timeOnly(desk.endTime)}` : "不限时正计时";
      if (desk.status === "timeout") return "超时正计时";
      return "剩余倒计时";
    }

    function mainTimerText(desk) {
      const displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      if (desk.status === "empty") return "空闲";
      if (desk.status === "preparing") {
        if (desk.startTime && desk.startTime > now.value) return `待开始 ${durationClock(desk.startTime - now.value)}`;
        return `准备中 ${durationClock(now.value - desk.prepareTime)}`;
      }
      if (desk.status === "infinit") return `正计时 ${countupText(desk, displayAt)}`;
      const diff = desk.endTime - displayAt;
      if (diff <= 0) return `已超 ${pad(Math.floor(Math.abs(diff) / ONE_MIN_MS))}分`;
      return durationClock(diff);
    }

    function cardTimerParts(desk) {
      const displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      if (desk.status === "empty") return { label: "", time: "空闲" };
      if (desk.status === "preparing") {
        return {
          label: desk.startTime && desk.startTime > now.value ? "待开始" : "准备中",
          time: desk.startTime && desk.startTime > now.value ? durationClock(desk.startTime - now.value) : durationClock(now.value - desk.prepareTime),
        };
      }
      if (desk.status === "infinit") return { label: "正计时", time: countupText(desk, displayAt) };
      const diff = desk.endTime - displayAt;
      if (diff <= 0) return { label: "已超", time: `${pad(Math.floor(Math.abs(diff) / ONE_MIN_MS))}分` };
      return { label: "倒计时", time: durationClock(diff) };
    }

    function seatElapsedText(desk) {
      if (desk.status === "empty") return "—";
      if (desk.status === "preparing") {
        if (desk.startTime && desk.startTime > now.value) return "待开始";
        return durationClock(now.value - desk.prepareTime);
      }
      const displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      return durationClock(elapsedMs(desk, displayAt));
    }

    function timeRangeText(desk) {
      if (desk.status === "empty") return "";
      if (desk.status === "preparing") {
        return desk.startTime ? `准备 ${timeOnly(desk.prepareTime)} · 开 ${timeOnly(desk.startTime)}` : `准备 ${timeOnly(desk.prepareTime)}`;
      }
      if (desk.mode === "countup") {
        return desk.endTime ? `开 ${timeOnly(desk.startTime)} · 到 ${timeOnly(desk.endTime)}` : `开 ${timeOnly(desk.startTime)} · 正计时`;
      }
      return `开 ${timeOnly(desk.startTime)} · 到 ${timeOnly(desk.endTime)}`;
    }

    function currentDetailMetrics(desk) {
      const anchor = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      const timeoutSeconds = desk.mode === "countdown" && desk.startTime ? Math.max(0, Math.floor((anchor - desk.endTime) / 1000)) : 0;
      const overtime = timeoutFee(timeoutSeconds, desk.endTime);
      return {
        elapsed: desk.startTime ? durationHuman(elapsedMs(desk, anchor)) : "未开始",
        timeoutText: timeoutSeconds > 0 ? `${Math.floor(timeoutSeconds / 60)} 分钟` : "无",
        timeoutFee: overtime.fee,
      };
    }

    function deskClass(desk) {
      return `desk-card status-${desk.status} ${desk.isPaused ? "is-paused" : ""}`;
    }

    function renderStat(label, value, variant, options = {}) {
      return h("article", {
        class: `stat-card ${variant} ${options.clickable ? "clickable" : ""} ${options.active ? "active" : ""}`,
        role: options.clickable ? "button" : null,
        tabindex: options.clickable ? "0" : null,
        onClick: options.onClick || null,
        onKeydown: options.onClick
          ? (event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                options.onClick();
              }
            }
          : null,
      }, [
        h("span", label),
        h("strong", value),
        options.hint ? h("em", options.hint) : null,
      ]);
    }

    function renderHeader() {
      return h("header", { class: "app-header" }, [
        h("div", { class: "brand-block" }, [
          h("p", { class: "brand-kicker" }, "LIBMS PERLER TIMER"),
          h("h1", { class: "brand-title" }, "✨ 时里白造物创意手作体验空间 ✨"),
          h("p", { class: "brand-subtitle" }, "拼豆计时管理控制台 · 准备中 / 倒计时 / 不限时 / 结账归档"),
        ]),
        h("div", { class: "header-side" }, [
          h(
            "a",
            {
              class: "download-bridge-link",
              href: "/api/download-windows-bridge",
              target: "_blank",
              rel: "noopener",
            },
            "一键安装 Windows 打印桥"
          ),
          h("div", { class: "clock-card", "aria-live": "polite" }, [
            h("span", "当前时间"),
            h("strong", fullDateTime(now.value)),
          ]),
        ]),
      ]);
    }

    function renderStats() {
      return h("section", { class: "stats-strip", "aria-label": "上帝视角统计" }, [
        renderStat("总桌数", topStats.value.total, "slate"),
        renderStat("空闲", topStats.value.empty, "neutral"),
        renderStat("准备中", topStats.value.preparing, "cyan"),
        renderStat("使用中", topStats.value.using, "emerald", {
          clickable: true,
          active: isAggregatedOnly.value,
          hint: isAggregatedOnly.value ? "聚合中" : "点我聚合",
          onClick: () => {
            isAggregatedOnly.value = !isAggregatedOnly.value;
          },
        }),
        renderStat("已超时", topStats.value.timeout, "rose"),
        renderStat("今日营收", `¥${topStats.value.revenue}`, "amber"),
      ]);
    }

    function renderPrintPanel() {
      const hasLastPrint = !!lastPrintPayload.value;
      return h("section", { class: "print-bridge-panel" }, [
        h("div", { class: "print-bridge-copy" }, [
          h("strong", "开桌标签打印"),
          h("span", printStatus.value),
        ]),
        h("div", { class: "print-bridge-actions" }, [
          h(
            "button",
            {
              type: "button",
              class: "print-bridge-button",
              disabled: !hasLastPrint,
              onClick: reprintLastLabel,
            },
            "补打上一张标签"
          ),
          h(
            "a",
            {
              class: "print-bridge-health",
              href: "http://127.0.0.1:17888/health",
              target: "_blank",
              rel: "noopener",
            },
            "检查本机打印桥"
          ),
        ]),
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
              class: `region-tab ${!isAggregatedOnly.value && activeRegion.value === region.key ? "active" : ""}`,
              onClick: () => {
                isAggregatedOnly.value = false;
                activeRegion.value = region.key;
              },
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
        h(
          "button",
          {
            type: "button",
            class: "open-desk-button",
            "data-open-desk-id": desk.id,
            onClick: (event) => stop(event, () => openDeskModal(desk)),
          },
          "开桌"
        ),
        h("span", "点击选择场次"),
      ]);
    }

    function renderActionButtons(desk) {
      if (desk.status === "empty") return null;

      if (desk.status === "preparing") {
        return h("div", { class: "desk-actions three" }, [
          h("button", { type: "button", class: "action start", onClick: (event) => stop(event, () => startPreparedDesk(desk.id)) }, desk.startTime && desk.startTime > now.value ? "立即开始" : "开始计时"),
          h("button", { type: "button", class: "action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
          h("button", { type: "button", class: "action muted", onClick: (event) => stop(event, () => cancelPreparing(desk.id)) }, "取消"),
        ]);
      }

      if (desk.isPaused) {
        return h("div", { class: "desk-actions three" }, [
          h("button", { type: "button", class: "action resume", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "▶️ 恢复"),
          h("button", { type: "button", class: "action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
          h("button", { type: "button", class: "action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑 结束"),
        ]);
      }

      if (desk.status === "infinit") {
        return h("div", { class: "desk-actions three" }, [
          h("button", { type: "button", class: "action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "⏸️ 暂停"),
          h("button", { type: "button", class: "action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
          h("button", { type: "button", class: "action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑 结束"),
        ]);
      }

      if (desk.status === "timeout") {
        return h("div", { class: "desk-actions five" }, [
          h("button", { type: "button", class: "action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "⏸️"),
          h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 30)) }, "+30"),
          h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 60)) }, "+60"),
          h("button", { type: "button", class: "action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
          h("button", { type: "button", class: "action stop danger", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑"),
        ]);
      }

      return h("div", { class: "desk-actions five" }, [
        h("button", { type: "button", class: "action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, "⏸️"),
        h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 30)) }, "+30"),
        h("button", { type: "button", class: "action plus", onClick: (event) => stop(event, () => addTime(desk.id, 60)) }, "+60"),
        h("button", { type: "button", class: "action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
        h("button", { type: "button", class: "action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "🛑"),
      ]);
    }

    function renderDeskCard(desk) {
      const timerParts = cardTimerParts(desk);
      return h(
        "article",
        {
          key: desk.id,
          class: deskClass(desk),
          "data-open-desk-id": desk.status === "empty" ? desk.id : null,
          onClick: () => (desk.status === "empty" ? openDeskModal(desk) : openDeskDetail(desk)),
        },
        [
          h("div", { class: "desk-head" }, [
            h("strong", { class: "desk-id" }, desk.id),
            h("span", { class: "status-pill" }, desk.isPaused ? "已暂停" : statusText(desk.status)),
          ]),
          desk.status === "empty"
            ? renderEmptyDesk(desk)
            : [
                h("div", { class: "seat-main-time" }, [
                  h("span", { class: "seat-time-label" }, timerParts.label),
                  h("strong", { class: "seat-time-value" }, timerParts.time),
                ]),
                h("div", { class: "seat-subline" }, [
                  h("strong", { class: "seat-session" }, compactSessionLabel(desk.sessionType)),
                  h("span", timeRangeText(desk)),
                ]),
                h("small", { class: "seat-note" }, desk.note || "点击查看详情"),
                renderSeatActions(desk),
              ],
        ]
      );
    }

    function compactTimeText(desk) {
      const displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      if (desk.status === "empty") return "";
      if (desk.status === "preparing") {
        if (desk.startTime && desk.startTime > now.value) return `待 ${durationClock(desk.startTime - now.value)}`;
        return "准备中";
      }
      if (desk.status === "infinit") return countupText(desk, displayAt);

      const diff = desk.endTime - displayAt;
      if (diff <= 0) return `超 ${Math.floor(Math.abs(diff) / ONE_MIN_MS)} 分`;
      return durationClock(diff);
    }

    function renderSeatActions(desk) {
      if (desk.status === "empty") return null;

      if (desk.status === "preparing") {
        return h("div", { class: "seat-actions three" }, [
          h("button", { type: "button", class: "seat-action start", onClick: (event) => stop(event, () => startPreparedDesk(desk.id)) }, "开始"),
          h("button", { type: "button", class: "seat-action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
          h("button", { type: "button", class: "seat-action muted", onClick: (event) => stop(event, () => cancelPreparing(desk.id)) }, "取消"),
        ]);
      }

      if (desk.mode !== "countdown") {
        return h("div", { class: "seat-actions six" }, [
          h("button", { type: "button", class: "seat-action detail", onClick: (event) => stop(event, () => openDeskDetail(desk)) }, "记录"),
          h("button", { type: "button", class: "seat-action note", onClick: (event) => stop(event, () => editNote(desk.id)) }, "备注"),
          h("button", { type: "button", class: "seat-action move", onClick: (event) => stop(event, () => openMoveModal(desk)) }, "换桌"),
          h("button", { type: "button", class: "seat-action print", onClick: (event) => stop(event, () => reprintDeskLabel(desk.id)) }, "补打"),
          h("button", { type: "button", class: desk.isPaused ? "seat-action resume" : "seat-action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, desk.isPaused ? "恢复" : "暂停"),
          h("button", { type: "button", class: "seat-action stop", onClick: (event) => stop(event, () => askFinish(desk)) }, "结账"),
        ]);
      }

      return h("div", { class: "seat-actions six" }, [
        h("button", { type: "button", class: "seat-action plus", disabled: desk.isPaused, onClick: (event) => stop(event, () => addTime(desk.id, 30)) }, "+30"),
        h("button", { type: "button", class: "seat-action plus", disabled: desk.isPaused, onClick: (event) => stop(event, () => addTime(desk.id, 60)) }, "+60"),
        h("button", { type: "button", class: "seat-action adjust", onClick: (event) => stop(event, () => openAdjustModal(desk)) }, "调整"),
        h("button", { type: "button", class: desk.isPaused ? "seat-action resume" : "seat-action pause", onClick: (event) => stop(event, () => togglePause(desk.id)) }, desk.isPaused ? "恢复" : "暂停"),
        h("button", { type: "button", class: "seat-action print", onClick: (event) => stop(event, () => reprintDeskLabel(desk.id)) }, "补打"),
        h("button", { type: "button", class: `seat-action stop ${desk.status === "timeout" ? "danger" : ""}`, onClick: (event) => stop(event, () => askFinish(desk)) }, "结账"),
      ]);
    }

    function renderSeatCard(desk) {
      const timerParts = cardTimerParts(desk);
      return h(
        "article",
        {
          key: desk.id,
          class: `seat-card seat-status-${desk.status} ${desk.isPaused ? "is-paused" : ""}`,
          "data-open-desk-id": desk.status === "empty" ? desk.id : null,
          onClick: () => (desk.status === "empty" ? openDeskModal(desk) : openDeskDetail(desk)),
        },
        [
          h("div", { class: "seat-head" }, [
            h("strong", { class: "seat-id" }, `${desk.id}号桌`),
            h("div", { class: "seat-head-actions" }, [
              h("span", { class: "seat-status" }, desk.isPaused ? "暂停" : statusText(desk.status)),
              desk.status === "empty" ? null : h("button", { type: "button", class: "seat-close", onClick: (event) => stop(event, () => askFinish(desk)) }, "×"),
            ]),
          ]),
          desk.status === "empty"
            ? h("div", { class: "seat-empty" }, [
                h("b", "空闲"),
                h(
                  "button",
                  {
                    type: "button",
                    class: "open-desk-button seat-open-button",
                    "data-open-desk-id": desk.id,
                    onClick: (event) => stop(event, () => openDeskModal(desk)),
                  },
                  "开桌"
                ),
              ])
            : h("div", { class: "seat-body" }, [
                h("div", { class: "seat-main-time" }, [
                  h("span", { class: "seat-time-label" }, timerParts.label),
                  h("strong", { class: "seat-time-value" }, timerParts.time),
                ]),
                h("div", { class: "seat-subline" }, [
                  h("strong", { class: "seat-session" }, compactSessionLabel(desk.sessionType)),
                  h("span", timeRangeText(desk)),
                ]),
                h("small", { class: "seat-note" }, desk.note || "点击查看详情"),
                renderSeatActions(desk),
              ]),
        ]
      );
    }

    function renderSeatById(seat) {
      const desk = findDesk(seat.id);
      return h("div", { key: seat.id, class: `seat-slot seat-${seat.pos}` }, desk ? renderSeatCard(desk) : null);
    }

    function renderTableLayout(layout) {
      const seatsByPosition = (position) => layout.seats.filter((seat) => seat.pos === position);
      return h("article", { key: layout.id, class: `table-zone ${layout.id}` }, [
        h("div", { class: "table-zone-head" }, [
          h("div", [h("h2", layout.title), h("p", `${layout.subtitle} · ${layout.hint}`)]),
          h("span", layout.orientation.includes("large") ? "大桌" : "长桌"),
        ]),
        h("div", { class: `seat-map ${layout.orientation}` }, [
          h("div", { class: "seat-row seat-row-top" }, seatsByPosition("top").map(renderSeatById)),
          h("div", { class: "table-middle" }, [
            h("div", { class: "seat-col seat-col-left" }, seatsByPosition("left").map(renderSeatById)),
            h("div", { class: "table-surface" }, [
              h("strong", layout.title),
              h("span", layout.subtitle),
            ]),
            h("div", { class: "seat-col seat-col-right" }, seatsByPosition("right").map(renderSeatById)),
          ]),
          h("div", { class: "seat-row seat-row-bottom" }, seatsByPosition("bottom").map(renderSeatById)),
        ]),
      ]);
    }

    function renderFloorPlan() {
      if (isAggregatedOnly.value) {
        return h("section", { class: "floor-plan-panel active-only-panel" }, [
          h("div", { class: "floor-plan-head" }, [
            h("div", [
              h("h2", "使用中桌位聚合"),
              h("p", `隐藏空闲座位 · 当前 ${activeDesks.value.length} 位在计时`),
            ]),
            h("button", { type: "button", class: "plan-toggle", onClick: () => (isAggregatedOnly.value = false) }, "返回座位图"),
          ]),
          activeDesks.value.length
            ? h("div", { class: "active-seat-grid" }, activeDesks.value.map(renderSeatCard))
            : h("div", { class: "aggregate-empty" }, "当前没有使用中的桌位。"),
        ]);
      }

      return h("section", { class: "floor-plan-panel" }, [
        h("div", { class: "floor-plan-head" }, [
          h("div", [
            h("h2", "门店座位布置图"),
            h("p", "按现场桌位排布展示，点击座位即可开桌或操作计时。"),
          ]),
          h("div", { class: "status-legend" }, [
            h("span", { class: "legend-dot empty" }, "空闲"),
            h("span", { class: "legend-dot normal" }, "计时"),
            h("span", { class: "legend-dot ending" }, "尾声"),
            h("span", { class: "legend-dot timeout" }, "超时"),
          ]),
        ]),
        h("div", { class: "floor-plan-grid" }, seatMapLayouts.map(renderTableLayout)),
      ]);
    }

    function renderActiveRegion() {
      const region = activeRegionMeta.value;
      const desksToRender = displayedDesks.value;
      return h("section", { class: "region-panel" }, [
        h("div", { class: "region-head" }, [
          h("div", [
            h("h2", isAggregatedOnly.value ? "🔥 使用中桌位聚合" : region.title),
            h("p", isAggregatedOnly.value ? `隐藏空闲桌 · ${desksToRender.length} 桌在座` : `${region.range} · ${desksToRender.length} 桌`),
          ]),
          h("span", isAggregatedOnly.value ? "点区域恢复全量" : "手机端单区展示"),
        ]),
        desksToRender.length
          ? h("div", { class: `desk-grid ${isAggregatedOnly.value ? "aggregated-grid" : ""}` }, desksToRender.map(renderDeskCard))
          : h("div", { class: "aggregate-empty" }, "当前没有使用中的桌位。"),
      ]);
    }

    function renderStartTimeControls() {
      const startAt = openStartUseNow.value ? now.value : timestampFromTimeInput(openStartInput.value, now.value);
      return h("div", { class: "start-time-card" }, [
        h("div", { class: "start-time-head" }, [
          h("strong", "到店/开单时间"),
          h("span", openStartUseNow.value ? "当前时间（限时自动+10）" : `指定 ${timeOnly(startAt)} 开单`),
        ]),
        h("div", { class: "start-mode-row" }, [
          h("button", {
            type: "button",
            class: `start-mode ${openStartUseNow.value ? "active" : ""}`,
            onClick: () => toggleOpenStartMode(true),
          }, "当前时间"),
          h("button", {
            type: "button",
            class: `start-mode ${!openStartUseNow.value ? "active" : ""}`,
            onClick: () => toggleOpenStartMode(false),
          }, "指定时间"),
        ]),
        h("div", { class: "time-input-row" }, [
          h("button", { type: "button", class: "time-nudge", onClick: () => shiftOpenStart(-15) }, "-15"),
          h("input", {
            class: "time-input",
            type: "time",
            value: openStartInput.value,
            disabled: openStartUseNow.value,
            onInput: (event) => {
              openStartUseNow.value = false;
              openStartInput.value = event.target.value;
            },
          }),
          h("button", { type: "button", class: "time-nudge", onClick: () => shiftOpenStart(15) }, "+15"),
        ]),
        h("p", { class: "start-time-tip" }, "可补录历史时间，也可预设未来开始；限时/倒计时场次会自动 +10 分钟开始计时。"),
      ]);
    }

    function renderOpenModal() {
      if (!openingDesk.value) return null;
      return h("div", { class: "modal-backdrop", onClick: (event) => event.target === event.currentTarget && closeOpenModal() }, [
        h("section", { class: "sheet open-sheet" }, [
          h("div", { class: "sheet-handle" }),
          h("div", { class: "sheet-title" }, [
            h("span", `桌号 ${openingDesk.value.id}`),
            h("strong", "选择开桌模式"),
          ]),
          renderStartTimeControls(),
          h(
            "div",
            { class: "preset-list" },
            sessionPresets.map((preset) => {
              const label = splitPresetLabel(preset.label);
              return h(
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
                    h("strong", [
                      h("span", { class: "preset-label-main" }, label.title),
                      label.sub ? h("span", { class: "preset-label-sub" }, label.sub) : null,
                    ]),
                    h("small", preset.desc),
                  ]),
                  h("em", endHint(preset.type)),
                ]
              );
            })
          ),
          h("button", { type: "button", class: "sheet-cancel", onClick: closeOpenModal }, "取消"),
        ]),
      ]);
    }

    function renderDetailModal() {
      const desk = detailDesk.value;
      if (!desk || desk.status === "empty") return null;
      const metrics = currentDetailMetrics(desk);
      const fields = [
        ["项目", sessionByType(desk.sessionType).label],
        ["准备", desk.prepareTime ? timeOnly(desk.prepareTime) : "--"],
        ["开始", desk.startTime ? timeOnly(desk.startTime) : "未开始"],
        ["预计结束", desk.endTime ? timeOnly(desk.endTime) : "正计时"],
        ["已用时", metrics.elapsed],
        ["超时", metrics.timeoutText],
        ["超时费", `¥${metrics.timeoutFee}`],
        ["加时费", `¥${safeNumber(desk.extraTimeFee)}`],
      ];

      return h("div", { class: "modal-backdrop", onClick: (event) => event.target === event.currentTarget && closeDetailModal() }, [
        h("section", { class: "confirm-box detail-box" }, [
          h("div", { class: "detail-head" }, [
            h("div", [
              h("span", "桌位详情"),
              h("h2", `${desk.id}号桌`),
            ]),
            h("button", { type: "button", class: "detail-close", onClick: closeDetailModal }, "关闭"),
          ]),
          h("div", { class: "detail-timer" }, mainTimerText(desk)),
          h(
            "div",
            { class: "detail-grid" },
            fields.map(([label, value]) =>
              h("div", { class: "detail-cell", key: label }, [
                h("span", label),
                h("strong", value),
              ])
            )
          ),
          desk.note ? h("p", { class: "detail-note" }, `备注：${desk.note}`) : null,
          h("div", { class: "detail-actions" }, [
            h("button", {
              type: "button",
              class: "detail-button",
              disabled: !canAdjustTime(desk),
              onClick: (event) =>
                stop(event, () => {
                  closeDetailModal();
                  openAdjustModal(desk);
                }),
            }, "调整时间"),
            h("button", { type: "button", class: "detail-button", onClick: (event) => stop(event, () => reprintDeskLabel(desk.id)) }, "补打标签"),
            h("button", {
              type: "button",
              class: "detail-button",
              disabled: !isPausable(desk) && !desk.isPaused,
              onClick: (event) => stop(event, () => togglePause(desk.id)),
            }, desk.isPaused ? "恢复计时" : "暂停"),
            h("button", {
              type: "button",
              class: "detail-button",
              onClick: (event) =>
                stop(event, () => {
                  closeDetailModal();
                  openMoveModal(desk);
                }),
            }, "换桌"),
            h("button", {
              type: "button",
              class: "detail-button danger",
              onClick: (event) =>
                stop(event, () => {
                  closeDetailModal();
                  askFinish(desk);
                }),
            }, "结账"),
          ]),
        ]),
      ]);
    }

    function renderAdjustModal() {
      if (!adjustingDesk.value) return null;
      const desk = adjustingDesk.value;
      const anchor = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now.value;
      const remainingMinutes = Math.max(0, Math.ceil((desk.endTime - anchor) / ONE_MIN_MS));

      return h("div", { class: "modal-backdrop", onClick: (event) => event.target === event.currentTarget && closeAdjustModal() }, [
        h("section", { class: "sheet adjust-sheet" }, [
          h("div", { class: "sheet-handle" }),
          h("div", { class: "sheet-title" }, [
            h("span", `桌号 ${desk.id}`),
            h("strong", "调整计时时间"),
          ]),
          h("div", { class: "adjust-summary" }, [
            h("div", [h("span", "当前状态"), h("strong", desk.isPaused ? "已暂停" : statusText(desk.status))]),
            h("div", [h("span", "预计结束"), h("strong", timeOnly(desk.endTime))]),
            h("div", [h("span", "剩余"), h("strong", desk.status === "timeout" ? `已超 ${Math.floor((anchor - desk.endTime) / ONE_MIN_MS)} 分` : `${remainingMinutes} 分`)]),
          ]),
          h("div", { class: "adjust-quick-row" }, [
            h("button", { type: "button", class: "time-nudge", onClick: () => nudgeEndTime(-15) }, "-15"),
            h("button", { type: "button", class: "time-nudge", onClick: () => nudgeEndTime(15) }, "+15"),
            h("button", { type: "button", class: "time-nudge", onClick: () => nudgeEndTime(30) }, "+30"),
            h("button", { type: "button", class: "time-nudge", onClick: () => nudgeEndTime(60) }, "+60"),
          ]),
          h("div", { class: "adjust-form" }, [
            h("label", [
              h("span", "调整开始时间"),
              h("input", {
                class: "time-input",
                type: "time",
                value: adjustStartInput.value,
                onInput: (event) => (adjustStartInput.value = event.target.value),
              }),
            ]),
            h("p", { class: "adjust-form-note" }, "用于补录或修正开台时间，会影响实际用时记录。"),
          ]),
          h("div", { class: "adjust-form" }, [
            h("label", [
              h("span", "设置剩余分钟"),
              h("input", {
                class: "time-input",
                type: "number",
                min: "0",
                max: "1440",
                inputmode: "numeric",
                value: adjustRemainingInput.value,
                onInput: (event) => (adjustRemainingInput.value = event.target.value),
              }),
            ]),
            h("button", { type: "button", class: "adjust-submit", onClick: applyRemainingToDraftEnd }, "换算结束时间"),
          ]),
          h("div", { class: "adjust-form" }, [
            h("label", [
              h("span", "设置结束时间"),
              h("input", {
                class: "time-input",
                type: "time",
                value: adjustEndInput.value,
                onInput: (event) => {
                  adjustEndInput.value = event.target.value;
                  updateDraftRemainingFromEnd();
                },
              }),
            ]),
            h("p", { class: "adjust-form-note" }, "例如 16:45 改 16:40，修改这里后点确认调整。"),
          ]),
          h("p", { class: "start-time-tip" }, "这里用于手动修正时间，不计入加时费；需要收费加时仍使用 +30 / +60。"),
          h("div", { class: "confirm-actions" }, [
            h("button", { type: "button", class: "confirm-cancel", onClick: closeAdjustModal }, "取消"),
            h("button", { type: "button", class: "confirm-submit", onClick: confirmAdjustTiming }, "确认调整"),
          ]),
        ]),
      ]);
    }

    function renderMoveModal() {
      if (!movingDesk.value) return null;
      const source = movingDesk.value;
      const targets = moveTargetDesks();
      return h("div", { class: "modal-backdrop", onClick: (event) => event.target === event.currentTarget && closeMoveModal() }, [
        h("section", { class: "confirm-box move-box" }, [
          h("h2", `🔁 ${source.id} 号桌换桌`),
          h("p", `当前场次：${sessionByType(source.sessionType).label}。请选择一个空闲桌位，计时数据会完整迁移。`),
          targets.length
            ? h(
                "div",
                { class: "move-target-grid" },
                targets.map((desk) =>
                  h(
                    "button",
                    {
                      key: desk.id,
                      type: "button",
                      class: `move-target ${moveTargetId.value === desk.id ? "active" : ""}`,
                      onClick: () => {
                        moveTargetId.value = desk.id;
                      },
                    },
                    [
                      h("strong", `${desk.id}号桌`),
                      h("span", regionMeta.find((region) => region.key === desk.region)?.title || "空闲桌位"),
                    ]
                  )
                )
              )
            : h("div", { class: "records-empty" }, "当前没有空闲桌位可换。"),
          h("p", { class: "settlement-tip" }, "换桌后原桌位会释放为空闲，新桌位保留原来的开始时间、结束时间、暂停、加时、超时和备注。"),
          h("div", { class: "confirm-actions" }, [
            h("button", { type: "button", class: "confirm-cancel", onClick: closeMoveModal }, "取消"),
            h("button", { type: "button", class: "confirm-submit", disabled: !moveTargetId.value, onClick: confirmMoveDesk }, "确认换桌"),
          ]),
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
            h("div", [h("span", "超时费"), h("strong", `¥${draft.timeoutFee}`)]),
            h("div", [h("span", "应收合计"), h("strong", `¥${draft.totalFee}`)]),
          ]),
          h("p", { class: "settlement-tip" }, "限时场次默认从到店/开单时间后 10 分钟开始计时；超时 10 分钟内不计费，超过 10 分钟后按原结束时间起算超时费。"),
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
                      h("tr", ["桌号", "场次", "准备", "开始", "结束/完结", "实际用时", "基础费", "加时费", "超时费", "合计", "超时", "备注"].map((label) => h("th", label))),
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
                          h("td", `¥${safeNumber(record.timeoutFee)}`),
                          h("td", `¥${safeNumber(record.totalFee ?? record.extraFee)}`),
                          h("td", { class: record.isTimeout ? "dangerText" : "" }, record.isTimeout ? `${Math.floor(record.timeoutDuration / 60)} 分钟` : "否"),
                          h("td", record.note || ""),
                        ])
                      )
                    ),
                  ])
            )
          : null,
      ]);
    }

    onMounted(() => {
      unlockBellHandler = () => ensureBellAudio();
      window.addEventListener("pointerdown", unlockBellHandler, { once: true, passive: true });
      tick();
      intervalId = window.setInterval(tick, 1000);
    });

    onUnmounted(() => {
      if (intervalId) window.clearInterval(intervalId);
      if (unlockBellHandler) window.removeEventListener("pointerdown", unlockBellHandler);
      if (audioContext && typeof audioContext.close === "function") {
        audioContext.close().catch(() => {});
      }
    });

    return () =>
      h("div", { class: "app-shell" }, [
        renderHeader(),
        renderStats(),
        renderPrintPanel(),
        renderFloorPlan(),
        renderRecords(),
        renderOpenModal(),
        renderDetailModal(),
        renderAdjustModal(),
        renderMoveModal(),
        renderFinishModal(),
      ]);
  },
}).mount("#app");

window.LIBMS_TIMER_APP_READY = true;
