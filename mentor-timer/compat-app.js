(function () {
  var DESK_STORAGE_KEY = "libms_perler_timer_desks_v3";
  var STAT_STORAGE_KEY = "libms_perler_timer_stats_v3";
  var ONE_MIN_MS = 60 * 1000;
  var TEN_MIN_MS = 10 * ONE_MIN_MS;
  var THIRTY_MIN_MS = 30 * ONE_MIN_MS;
  var PRINT_BRIDGE_URL = "http://127.0.0.1:17888/print-label";

  var booted = false;
  var intervalId = 0;
  var now = Date.now ? Date.now() : new Date().getTime();
  var desks = [];
  var statsByDate = {};
  var activeRegion = "window";
  var openingDeskId = "";
  var openStartUseNow = true;
  var openStartInput = "";
  var isAggregatedOnly = false;
  var checkoutDraft = null;
  var showRecords = false;

  var regionMeta = [
    { key: "window", label: "🪟 玻璃幕墙", title: "🪟 靠玻璃幕墙", range: "01 - 06" },
    { key: "table1", label: "🪵 长桌①", title: "🪵 长桌区①", range: "07 - 16" },
    { key: "table2", label: "🪵 长桌②", title: "🪵 长桌区②", range: "17 - 30" },
  ];

  var sessionPresets = [
    { type: "morning", icon: "🌅", label: "早鸟场", desc: "限时倒计时，到当天 14:00", mode: "countdown", fixedHour: 14, baseFee: 0 },
    { type: "afternoon", icon: "☀️", label: "下午场", desc: "限时倒计时，到当天 19:00", mode: "countdown", fixedHour: 19, baseFee: 0 },
    { type: "night", icon: "🌙", label: "星光夜场", desc: "限时倒计时，到当天 21:00", mode: "countdown", fixedHour: 21, baseFee: 0 },
    { type: "day", icon: "🎫", label: "包天场", desc: "限时倒计时，到当天 21:00", mode: "countdown", fixedHour: 21, baseFee: 0 },
    { type: "1h", icon: "⏱", label: "限时 1h", desc: "开始后倒计时 60 分钟", mode: "countdown", durationMin: 60, baseFee: 0 },
    { type: "2h", icon: "⏱", label: "限时 2h", desc: "开始后倒计时 120 分钟", mode: "countdown", durationMin: 120, baseFee: 0 },
    { type: "infinit", icon: "♾️", label: "不限时畅玩", desc: "正计时模式，从 00:00:00 开始", mode: "countup", baseFee: 0 },
  ];

  function nowMs() {
    return Date.now ? Date.now() : new Date().getTime();
  }

  function pad(value) {
    value = String(value);
    return value.length < 2 ? "0" + value : value;
  }

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function dateKey(timestamp) {
    var date = new Date(timestamp);
    return date.getFullYear() + "-" + pad(date.getMonth() + 1) + "-" + pad(date.getDate());
  }

  function timeOnly(timestamp) {
    if (!timestamp) return "--:--";
    var date = new Date(timestamp);
    return pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function timeInputValue(timestamp) {
    return timeOnly(timestamp || nowMs());
  }

  function timestampFromTimeInput(value, baseTimestamp) {
    var match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ""));
    var date = new Date(baseTimestamp || nowMs());
    var hours;
    var minutes;
    if (!match) return baseTimestamp || nowMs();
    hours = Math.min(23, Math.max(0, Number(match[1])));
    minutes = Math.min(59, Math.max(0, Number(match[2])));
    date.setHours(hours, minutes, 0, 0);
    return date.getTime();
  }

  function shiftTimeInputValue(value, minutes, baseTimestamp) {
    return timeInputValue(timestampFromTimeInput(value, baseTimestamp || nowMs()) + minutes * ONE_MIN_MS);
  }

  function dateTime(timestamp) {
    if (!timestamp) return "--";
    var date = new Date(timestamp);
    return pad(date.getMonth() + 1) + "-" + pad(date.getDate()) + " " + pad(date.getHours()) + ":" + pad(date.getMinutes());
  }

  function fullDateTime(timestamp) {
    var weekDays = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];
    var date = new Date(timestamp);
    return (
      date.getFullYear() +
      "年" +
      (date.getMonth() + 1) +
      "月" +
      date.getDate() +
      "日 " +
      weekDays[date.getDay()] +
      " " +
      pad(date.getHours()) +
      ":" +
      pad(date.getMinutes()) +
      ":" +
      pad(date.getSeconds())
    );
  }

  function durationClock(ms) {
    var totalSeconds = Math.max(0, Math.floor(ms / 1000));
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = totalSeconds % 60;
    return pad(hours) + ":" + pad(minutes) + ":" + pad(seconds);
  }

  function durationHuman(ms) {
    var totalMinutes = Math.max(0, Math.floor(ms / ONE_MIN_MS));
    var hours = Math.floor(totalMinutes / 60);
    var minutes = totalMinutes % 60;
    if (hours <= 0) return minutes + " 分钟";
    if (minutes === 0) return hours + " 小时";
    return hours + " 小时 " + minutes + " 分钟";
  }

  function safeNumber(value) {
    return typeof value === "number" && isFinite(value) ? value : 0;
  }

  function readStorage(key) {
    try {
      return window.localStorage.getItem(key) || "";
    } catch (err) {
      return "";
    }
  }

  function writeStorage(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch (err) {}
  }

  function regionById(idNumber) {
    if (idNumber <= 6) return "window";
    if (idNumber <= 16) return "table1";
    return "table2";
  }

  function emptyDesk(idNumber) {
    var id = pad(idNumber);
    return {
      id: id,
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

  function sessionByType(sessionType) {
    var i;
    for (i = 0; i < sessionPresets.length; i += 1) {
      if (sessionPresets[i].type === sessionType) return sessionPresets[i];
    }
    return sessionPresets[4];
  }

  function fixedEndTime(timestamp, hour) {
    var date = new Date(timestamp);
    date.setHours(hour, 0, 0, 0);
    return date.getTime();
  }

  function computeEndTime(sessionType, startAt) {
    var preset = sessionByType(sessionType);
    if (preset.mode === "countup") return 0;
    if (preset.durationMin) return startAt + preset.durationMin * ONE_MIN_MS;
    return fixedEndTime(startAt, preset.fixedHour);
  }

  function hasValidEndTime(sessionType, startAt) {
    var preset = sessionByType(sessionType);
    return preset.mode === "countup" || computeEndTime(sessionType, startAt) > startAt;
  }

  function deriveCountdownStatus(endTime, timestamp) {
    var diff = endTime - timestamp;
    if (diff <= 0) return { status: "timeout", overTimeDuration: Math.floor(Math.abs(diff) / 1000) };
    if (diff > THIRTY_MIN_MS) return { status: "normal", overTimeDuration: 0 };
    if (diff > TEN_MIN_MS) return { status: "ending", overTimeDuration: 0 };
    return { status: "urgent", overTimeDuration: 0 };
  }

  function extraFee(minutes, timestamp) {
    var hour = new Date(timestamp).getHours();
    if (hour < 21) return minutes === 30 ? 10 : 20;
    return minutes === 30 ? 30 : 50;
  }

  function statusText(status) {
    var map = {
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
    return Math.max(0, timestamp - desk.startTime - safeNumber(desk.pausedDuration));
  }

  function primaryTimeText(desk) {
    var displayAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : now;
    var diff;
    if (desk.status === "empty") return "开桌";
    if (desk.status === "preparing") {
      if (desk.startTime && desk.startTime > now) return "距开始 " + durationClock(desk.startTime - now);
      return "准备中 " + durationClock(now - desk.prepareTime);
    }
    if (desk.status === "infinit") return durationClock(elapsedMs(desk, displayAt));
    diff = desk.endTime - displayAt;
    if (diff <= 0) return "⏱ 已超时 " + Math.floor(Math.abs(diff) / ONE_MIN_MS) + " 分钟";
    return durationClock(diff);
  }

  function timeLabel(desk) {
    if (desk.status === "empty") return "点击开桌";
    if (desk.isPaused) return "已暂停 · 时间冻结";
    if (desk.status === "preparing") return desk.startTime && desk.startTime > now ? "预设开始时间" : "等待开始计时";
    if (desk.status === "infinit") return "不限时正计时";
    if (desk.status === "timeout") return "超时正计时";
    return "剩余倒计时";
  }

  function normalizeDesk(raw, fallback) {
    var sessionType = raw && typeof raw.sessionType === "string" ? raw.sessionType : fallback.sessionType;
    var mode = raw && (raw.mode === "countup" || sessionType === "infinit") ? "countup" : "countdown";
    var status = raw && typeof raw.status === "string" ? raw.status : fallback.status;
    if (status !== "empty" && status !== "preparing" && status !== "normal" && status !== "ending" && status !== "urgent" && status !== "timeout" && status !== "infinit") {
      status = fallback.status;
    }
    if (sessionType === "infinit" && status !== "empty" && status !== "preparing") status = "infinit";
    return {
      id: fallback.id,
      region: fallback.region,
      status: status,
      sessionType: sessionType,
      mode: mode,
      prepareTime: raw ? safeNumber(raw.prepareTime) : 0,
      startTime: raw ? safeNumber(raw.startTime) : 0,
      endTime: raw ? safeNumber(raw.endTime) : 0,
      overTimeDuration: raw ? safeNumber(raw.overTimeDuration) : 0,
      extraTimeCount: raw ? safeNumber(raw.extraTimeCount) : 0,
      extraTimeFee: raw ? safeNumber(raw.extraTimeFee) : 0,
      isPaused: raw && raw.isPaused === true,
      pauseStartTime: raw ? safeNumber(raw.pauseStartTime) : 0,
      pausedDuration: raw ? safeNumber(raw.pausedDuration) : 0,
      note: raw && typeof raw.note === "string" ? raw.note : "",
    };
  }

  function defaultDesks() {
    var list = [];
    var i;
    for (i = 1; i <= 30; i += 1) list.push(emptyDesk(i));
    return list;
  }

  function loadDesks() {
    var fallback = defaultDesks();
    var raw = readStorage(DESK_STORAGE_KEY);
    var parsed;
    var byId = {};
    var i;
    if (!raw) return fallback;
    try {
      parsed = JSON.parse(raw);
      if (!parsed || typeof parsed.length !== "number") return fallback;
      for (i = 0; i < parsed.length; i += 1) {
        if (parsed[i] && parsed[i].id) byId[String(parsed[i].id)] = parsed[i];
      }
      for (i = 0; i < fallback.length; i += 1) {
        fallback[i] = normalizeDesk(byId[fallback[i].id], fallback[i]);
      }
      return fallback;
    } catch (err) {
      return fallback;
    }
  }

  function loadStats() {
    var raw = readStorage(STAT_STORAGE_KEY);
    if (!raw) return {};
    try {
      return JSON.parse(raw) || {};
    } catch (err) {
      return {};
    }
  }

  function persistDesks() {
    writeStorage(DESK_STORAGE_KEY, JSON.stringify(desks));
  }

  function persistStats() {
    writeStorage(STAT_STORAGE_KEY, JSON.stringify(statsByDate));
  }

  function getDailyStat(key) {
    var stat = statsByDate[key];
    if (stat && stat.records && typeof stat.records.length === "number") return stat;
    return { totalDesks: 0, totalRevenue: 0, records: [] };
  }

  function findDesk(id) {
    var i;
    for (i = 0; i < desks.length; i += 1) {
      if (desks[i].id === id) return desks[i];
    }
    return null;
  }

  function resetDesk(desk) {
    var replacement = emptyDesk(parseInt(desk.id, 10));
    var key;
    for (key in replacement) {
      if (replacement.hasOwnProperty(key)) desk[key] = replacement[key];
    }
  }

  function resolveOpenStartAt() {
    return openStartUseNow ? nowMs() : timestampFromTimeInput(openStartInput, now);
  }

  function canPrepare(sessionType, startAt) {
    var preset = sessionByType(sessionType);
    startAt = startAt || resolveOpenStartAt();
    if (preset.mode === "countup" || preset.durationMin) return true;
    return hasValidEndTime(sessionType, startAt);
  }

  function endHint(sessionType, startAt) {
    var preset = sessionByType(sessionType);
    var endAt;
    startAt = startAt || resolveOpenStartAt();
    if (preset.mode === "countup") return "正计时";
    endAt = computeEndTime(sessionType, startAt);
    if (endAt <= startAt) return "开始时间已过场次";
    return timeOnly(startAt) + " → " + timeOnly(endAt) + (endAt <= now ? " · 已超时" : "");
  }

  function applyDeskStart(desk, sessionType, startAt, timestamp) {
    var preset = sessionByType(sessionType);
    var endAt;
    var next;
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
    if (preset.mode === "countup") {
      desk.endTime = 0;
      desk.status = startAt > timestamp ? "preparing" : "infinit";
      return true;
    }
    endAt = computeEndTime(sessionType, startAt);
    if (endAt <= startAt) return false;
    desk.endTime = endAt;
    if (startAt > timestamp) {
      desk.status = "preparing";
      return true;
    }
    next = deriveCountdownStatus(endAt, timestamp);
    desk.status = next.status;
    desk.overTimeDuration = next.overTimeDuration;
    return true;
  }

  function requestPrintBridge(payload) {
    if (!window.fetch) return;

    window
      .fetch(PRINT_BRIDGE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        mode: "cors",
      })
      .then(function (response) {
        if (!response.ok) throw new Error("print bridge " + response.status);
        return response.json ? response.json().catch(function () { return {}; }) : {};
      })
      .then(function (data) {
        if (data && data.ok === false) throw new Error(data.error || "print failed");
        if (window.console && console.info) {
          console.info("[LIBMS Timer Compat] 开台标签已发送到本机打印桥", payload);
        }
      })
      .catch(function (error) {
        if (window.console && console.warn) {
          console.warn("[LIBMS Timer Compat] 本机打印桥未完成打印，开台不受影响：", error);
        }
      });
  }

  function prepareDesk(deskId, sessionType) {
    var desk = findDesk(deskId);
    var timestamp = nowMs();
    var startAt = openStartUseNow ? timestamp : timestampFromTimeInput(openStartInput, timestamp);
    if (!desk || desk.status !== "empty") return;
    if (!canPrepare(sessionType, startAt) || !applyDeskStart(desk, sessionType, startAt, timestamp)) {
      window.alert("开始时间不适合该场次，请调整开始时间或选择其他模式。");
      return;
    }
    openingDeskId = "";
    persistDesks();
    requestPrintBridge({
      deskId: desk.id,
      session: sessionByType(desk.sessionType).label,
      mode: desk.mode,
      startLabel: timeOnly(desk.startTime),
      endLabel: desk.mode === "countdown" ? timeOnly(desk.endTime) : "",
      note: desk.mode === "countdown" ? "请按时提醒顾客" : "不限时 / 正计时",
    });
    render();
  }

  function startPreparedDesk(deskId) {
    var desk = findDesk(deskId);
    var timestamp = nowMs();
    var startAt;
    if (!desk || desk.status !== "preparing") return;
    startAt = desk.startTime && desk.startTime <= timestamp ? desk.startTime : timestamp;
    if (!applyDeskStart(desk, desk.sessionType, startAt, timestamp)) {
      window.alert("当前时间已超过该场次结束时间，请重新选择场次。");
      return;
    }
    persistDesks();
    render();
  }

  function cancelPreparing(deskId) {
    var desk = findDesk(deskId);
    if (!desk || desk.status !== "preparing") return;
    resetDesk(desk);
    persistDesks();
    render();
  }

  function isPausable(desk) {
    return desk && (desk.status === "normal" || desk.status === "ending" || desk.status === "urgent" || desk.status === "timeout" || desk.status === "infinit");
  }

  function addTime(deskId, minutes) {
    var desk = findDesk(deskId);
    var timestamp = nowMs();
    var baseEndTime;
    var next;
    if (!desk || desk.isPaused || (desk.status !== "normal" && desk.status !== "ending" && desk.status !== "urgent" && desk.status !== "timeout")) return;
    baseEndTime = Math.max(desk.endTime, timestamp);
    desk.endTime = baseEndTime + minutes * ONE_MIN_MS;
    desk.extraTimeCount += 1;
    desk.extraTimeFee += extraFee(minutes, timestamp);
    next = deriveCountdownStatus(desk.endTime, timestamp);
    desk.status = next.status;
    desk.overTimeDuration = next.overTimeDuration;
    persistDesks();
    render();
  }

  function pauseDesk(deskId) {
    var desk = findDesk(deskId);
    if (!isPausable(desk) || desk.isPaused) return;
    desk.isPaused = true;
    desk.pauseStartTime = nowMs();
    persistDesks();
    render();
  }

  function resumeDesk(deskId) {
    var desk = findDesk(deskId);
    var resumedAt;
    var pausedMs;
    var next;
    if (!desk || !desk.isPaused || !desk.pauseStartTime) return;
    resumedAt = nowMs();
    pausedMs = Math.max(0, resumedAt - desk.pauseStartTime);
    desk.pausedDuration += pausedMs;
    if (desk.mode === "countdown" && desk.endTime) {
      desk.endTime += pausedMs;
      next = deriveCountdownStatus(desk.endTime, resumedAt);
      desk.status = next.status;
      desk.overTimeDuration = next.overTimeDuration;
    } else if (desk.mode === "countup") {
      desk.status = "infinit";
    }
    desk.isPaused = false;
    desk.pauseStartTime = 0;
    persistDesks();
    render();
  }

  function editNote(deskId) {
    var desk = findDesk(deskId);
    var next;
    if (!desk || desk.status === "empty") return;
    next = window.prompt("备注内容", desk.note || "");
    if (next === null) return;
    desk.note = String(next).replace(/^\s+|\s+$/g, "").slice(0, 80);
    persistDesks();
    render();
  }

  function buildCheckoutDraft(desk, timestamp, autoPaused, wasPausedBefore) {
    var closedAt = desk.isPaused && desk.pauseStartTime ? desk.pauseStartTime : timestamp;
    var preset = sessionByType(desk.sessionType);
    var billableMs = desk.startTime ? elapsedMs(desk, closedAt) : 0;
    var billableMinutes = Math.max(0, Math.ceil(billableMs / ONE_MIN_MS));
    var timeoutSeconds = desk.mode === "countdown" && desk.startTime ? Math.max(0, Math.floor((closedAt - desk.endTime) / 1000)) : 0;
    var baseFee = safeNumber(preset.baseFee);
    var extra = safeNumber(desk.extraTimeFee);
    return {
      deskId: desk.id,
      sessionType: desk.sessionType,
      session: preset.label,
      mode: desk.mode,
      prepareTime: desk.prepareTime,
      startTime: desk.startTime,
      endTime: desk.endTime,
      closedAt: closedAt,
      billableMs: billableMs,
      billableMinutes: billableMinutes,
      baseFee: baseFee,
      extraFee: extra,
      totalFee: baseFee + extra,
      extraCount: desk.extraTimeCount,
      timeoutSeconds: timeoutSeconds,
      pausedDuration: desk.pausedDuration,
      note: desk.note || "",
      wasPaused: wasPausedBefore,
      autoPaused: autoPaused,
    };
  }

  function askFinish(deskId) {
    var desk = findDesk(deskId);
    var timestamp = nowMs();
    var wasPausedBefore;
    var autoPaused;
    if (!desk || desk.status === "empty") return;
    wasPausedBefore = desk.isPaused;
    autoPaused = isPausable(desk) && !wasPausedBefore;
    if (autoPaused) {
      desk.isPaused = true;
      desk.pauseStartTime = timestamp;
      persistDesks();
    }
    checkoutDraft = buildCheckoutDraft(desk, timestamp, autoPaused, wasPausedBefore);
    render();
  }

  function closeFinishModal() {
    var draft = checkoutDraft;
    checkoutDraft = null;
    if (draft && draft.autoPaused) resumeDesk(draft.deskId);
    else render();
  }

  function finishDesk() {
    var draft = checkoutDraft;
    var desk;
    var key;
    var stat;
    var records;
    var record;
    if (!draft) return;
    desk = findDesk(draft.deskId);
    if (!desk || desk.status === "empty") return;
    key = dateKey(draft.closedAt);
    stat = getDailyStat(key);
    records = stat.records ? stat.records.slice(0) : [];
    record = {
      recordId: key + "-" + desk.id + "-" + draft.closedAt,
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
    records.push(record);
    statsByDate[key] = {
      totalDesks: safeNumber(stat.totalDesks) + 1,
      totalRevenue: safeNumber(stat.totalRevenue) + draft.totalFee,
      records: records,
    };
    resetDesk(desk);
    checkoutDraft = null;
    persistStats();
    persistDesks();
    render();
  }

  function tick() {
    var timestamp = nowMs();
    var dirty = false;
    var i;
    var desk;
    var next;
    now = timestamp;
    for (i = 0; i < desks.length; i += 1) {
      desk = desks[i];
      if (desk.status === "empty" || desk.status === "infinit" || desk.isPaused) continue;
      if (desk.status === "preparing") {
        if (desk.startTime && desk.startTime <= timestamp) {
          if (desk.mode === "countup") {
            desk.status = "infinit";
            desk.overTimeDuration = 0;
          } else {
            next = deriveCountdownStatus(desk.endTime, timestamp);
            desk.status = next.status;
            desk.overTimeDuration = next.overTimeDuration;
          }
          dirty = true;
        }
        continue;
      }
      next = deriveCountdownStatus(desk.endTime, timestamp);
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
    render();
  }

  function activeRegionMeta() {
    var i;
    for (i = 0; i < regionMeta.length; i += 1) {
      if (regionMeta[i].key === activeRegion) return regionMeta[i];
    }
    return regionMeta[0];
  }

  function activeRegionDesks() {
    var list = [];
    var i;
    for (i = 0; i < desks.length; i += 1) {
      if (desks[i].region === activeRegion) list.push(desks[i]);
    }
    return list;
  }

  function activeDesks() {
    var list = [];
    var i;
    for (i = 0; i < desks.length; i += 1) {
      if (desks[i].status !== "empty") list.push(desks[i]);
    }
    return list;
  }

  function displayedDesks() {
    return isAggregatedOnly ? activeDesks() : activeRegionDesks();
  }

  function getTopStats() {
    var today = dateKey(now);
    var stat = getDailyStat(today);
    var records = stat.records || [];
    var total = desks.length;
    var empty = 0;
    var preparing = 0;
    var using = 0;
    var timeout = 0;
    var activeFee = 0;
    var closedFee = 0;
    var i;
    var desk;
    var record;
    for (i = 0; i < desks.length; i += 1) {
      desk = desks[i];
      if (desk.status === "empty") empty += 1;
      if (desk.status === "preparing") preparing += 1;
      if (desk.status !== "empty") using += 1;
      if (desk.status === "timeout") timeout += 1;
      if (desk.status !== "empty" && dateKey(desk.prepareTime || desk.startTime || now) === today) activeFee += safeNumber(desk.extraTimeFee);
    }
    for (i = 0; i < records.length; i += 1) {
      record = records[i];
      closedFee += safeNumber(record.totalFee != null ? record.totalFee : record.extraFee);
    }
    return { total: total, empty: empty, preparing: preparing, using: using, timeout: timeout, revenue: activeFee + closedFee };
  }

  function statCard(label, value, variant, action, active, hint) {
    return (
      '<article class="compat-stat ' +
      variant +
      (action ? " clickable" : "") +
      (active ? " active" : "") +
      '"' +
      (action ? ' data-action="' + action + '"' : "") +
      "><span>" +
      label +
      "</span><strong>" +
      value +
      "</strong>" +
      (hint ? "<em>" + hint + "</em>" : "") +
      "</article>"
    );
  }

  function renderHeader() {
    return (
      '<header class="compat-header">' +
      '<div class="brand-block">' +
      '<p class="brand-kicker">LIBMS PERLER TIMER</p>' +
      '<h1 class="brand-title">✨ 时里白造物创意手作体验空间 ✨</h1>' +
      '<p class="brand-subtitle">拼豆计时管理控制台 · 兼容模式</p>' +
      "</div>" +
      '<div class="header-side">' +
      '<a class="download-bridge-link" href="/api/download-windows-bridge" target="_blank" rel="noopener">下载 Windows 打印桥</a>' +
      '<div class="clock-card"><span>当前时间</span><strong>' +
      fullDateTime(now) +
      "</strong></div>" +
      "</div>" +
      "</header>"
    );
  }

  function renderStats() {
    var s = getTopStats();
    return (
      '<section class="compat-stats">' +
      statCard("总桌数", s.total, "slate") +
      statCard("空闲", s.empty, "neutral") +
      statCard("准备中", s.preparing, "cyan") +
      statCard("使用中", s.using, "emerald", "aggregate", isAggregatedOnly, isAggregatedOnly ? "聚合中" : "点我聚合") +
      statCard("已超时", s.timeout, "rose") +
      statCard("今日营收", "¥" + s.revenue, "amber") +
      "</section>"
    );
  }

  function renderTabs() {
    var html = '<nav class="compat-tabs">';
    var i;
    for (i = 0; i < regionMeta.length; i += 1) {
      html +=
        '<button type="button" class="compat-tab ' +
        (!isAggregatedOnly && activeRegion === regionMeta[i].key ? "active" : "") +
        '" data-action="tab" data-region="' +
        regionMeta[i].key +
        '">' +
        regionMeta[i].label +
        "</button>";
    }
    return html + "</nav>";
  }

  function renderEmptyDesk(desk) {
    return (
      '<div class="empty-state"><div class="plus-mark">+</div><strong>开桌</strong><span>点击选择场次</span></div>'
    );
  }

  function renderDeskActions(desk) {
    if (desk.status === "empty") return "";
    if (desk.status === "preparing") {
      return (
        '<div class="compat-actions two">' +
        '<button type="button" class="compat-action start" data-action="start" data-id="' +
        desk.id +
        '">' +
        (desk.startTime && desk.startTime > now ? "立即开始" : "开始计时") +
        "</button>" +
        '<button type="button" class="compat-action muted" data-action="cancel-prepare" data-id="' +
        desk.id +
        '">取消</button>' +
        "</div>"
      );
    }
    if (desk.isPaused) {
      return (
        '<div class="compat-actions three">' +
        '<button type="button" class="compat-action resume" data-action="resume" data-id="' +
        desk.id +
        '">▶️ 恢复</button>' +
        '<button type="button" class="compat-action note" data-action="note" data-id="' +
        desk.id +
        '">备注</button>' +
        '<button type="button" class="compat-action stop" data-action="finish" data-id="' +
        desk.id +
        '">🛑 结束</button>' +
        "</div>"
      );
    }
    if (desk.status === "infinit") {
      return (
        '<div class="compat-actions three">' +
        '<button type="button" class="compat-action pause" data-action="pause" data-id="' +
        desk.id +
        '">⏸️ 暂停</button>' +
        '<button type="button" class="compat-action note" data-action="note" data-id="' +
        desk.id +
        '">备注</button>' +
        '<button type="button" class="compat-action stop" data-action="finish" data-id="' +
        desk.id +
        '">🛑 结束</button>' +
        "</div>"
      );
    }
    return (
      '<div class="compat-actions four">' +
      '<button type="button" class="compat-action pause" data-action="pause" data-id="' +
      desk.id +
      '">⏸️</button>' +
      '<button type="button" class="compat-action plus" data-action="add" data-id="' +
      desk.id +
      '" data-min="30">+30</button>' +
      '<button type="button" class="compat-action plus" data-action="add" data-id="' +
      desk.id +
      '" data-min="60">+60</button>' +
      '<button type="button" class="compat-action stop" data-action="finish" data-id="' +
      desk.id +
      '">🛑</button>' +
      "</div>"
    );
  }

  function renderDeskCard(desk) {
    var className = "compat-desk-card status-" + desk.status + (desk.isPaused ? " is-paused" : "");
    var preset = sessionByType(desk.sessionType);
    var html =
      '<article class="' +
      className +
      '" data-action="' +
      (desk.status === "empty" ? "open" : "") +
      '" data-id="' +
      desk.id +
      '">' +
      '<div class="desk-head"><strong class="desk-id">' +
      desk.id +
      '</strong><span class="status-pill">' +
      (desk.isPaused ? "已暂停" : statusText(desk.status)) +
      "</span></div>";
    if (desk.status === "empty") {
      html += renderEmptyDesk(desk);
    } else {
      html +=
        '<p class="project-name">' +
        escapeHtml(preset.label) +
        '</p><div class="desk-times"><span>准：' +
        timeOnly(desk.prepareTime) +
        "</span><span>开：" +
        timeOnly(desk.startTime) +
        '</span></div><div class="live-time"><small>' +
        timeLabel(desk) +
        "</small><strong>" +
        primaryTimeText(desk) +
        "</strong></div>";
      if (desk.note) html += '<p class="desk-note">' + escapeHtml(desk.note) + "</p>";
      html += renderDeskActions(desk);
    }
    return html + "</article>";
  }

  function renderRegion() {
    var region = activeRegionMeta();
    var list = displayedDesks();
    var html =
      '<section class="region-panel"><div class="region-head"><div><h2>' +
      (isAggregatedOnly ? "🔥 使用中桌位聚合" : region.title) +
      "</h2><p>" +
      (isAggregatedOnly ? "隐藏空闲桌" : region.range) +
      " · " +
      list.length +
      (isAggregatedOnly ? " 桌在座" : " 桌") +
      "</p></div><span>" +
      (isAggregatedOnly ? "点区域恢复全量" : "手机端单区展示") +
      '</span></div>';
    var i;
    if (!list.length) return html + '<div class="aggregate-empty">当前没有使用中的桌位。</div></section>';
    html += '<div class="compat-desk-grid' + (isAggregatedOnly ? " aggregated-grid" : "") + '">';
    for (i = 0; i < list.length; i += 1) html += renderDeskCard(list[i]);
    return html + "</div></section>";
  }

  function renderStartTimeControls() {
    var startAt = resolveOpenStartAt();
    return (
      '<div class="start-time-card"><div class="start-time-head"><strong>开始时间</strong><span>' +
      (openStartUseNow ? "当前时间（即时开台）" : "指定 " + timeOnly(startAt) + " 开台") +
      '</span></div><div class="start-mode-row">' +
      '<button type="button" class="start-mode ' +
      (openStartUseNow ? "active" : "") +
      '" data-action="start-mode" data-mode="now">当前时间</button>' +
      '<button type="button" class="start-mode ' +
      (!openStartUseNow ? "active" : "") +
      '" data-action="start-mode" data-mode="custom">指定时间</button>' +
      '</div><div class="time-input-row">' +
      '<button type="button" class="time-nudge" data-action="shift-start" data-min="-15">-15</button>' +
      '<input class="time-input" type="time" data-action="start-time-input" value="' +
      escapeHtml(openStartInput || timeInputValue(now)) +
      '"' +
      (openStartUseNow ? " disabled" : "") +
      ">" +
      '<button type="button" class="time-nudge" data-action="shift-start" data-min="15">+15</button>' +
      '</div><p class="start-time-tip">可补录历史时间，也可预设未来开始；结束时间会按所选场次自动重算。</p></div>'
    );
  }

  function renderOpenModal() {
    var desk;
    var html;
    var i;
    var preset;
    if (!openingDeskId) return "";
    desk = findDesk(openingDeskId);
    if (!desk) return "";
    html =
      '<div class="compat-modal" data-action="close-open"><section class="compat-sheet" data-action="noop">' +
      '<div class="sheet-handle"></div><div class="sheet-title"><span>桌号 ' +
      desk.id +
      "</span><strong>选择开桌模式</strong></div>" +
      renderStartTimeControls() +
      '<div class="preset-list">';
    for (i = 0; i < sessionPresets.length; i += 1) {
      preset = sessionPresets[i];
      html +=
        '<button type="button" class="preset-button ' +
        (canPrepare(preset.type) ? "" : "disabled") +
        '" data-action="preset" data-id="' +
        desk.id +
        '" data-session="' +
        preset.type +
        '"' +
        (canPrepare(preset.type) ? "" : " disabled") +
        '><span class="preset-icon">' +
        preset.icon +
        '</span><span class="preset-copy"><strong>' +
        preset.label +
        "</strong><small>" +
        preset.desc +
        "</small></span><em>" +
        endHint(preset.type) +
        "</em></button>";
    }
    html += '</div><button type="button" class="sheet-cancel" data-action="close-open">取消</button></section></div>';
    return html;
  }

  function renderFinishModal() {
    var draft = checkoutDraft;
    if (!draft) return "";
    return (
      '<div class="compat-modal" data-action="close-finish"><section class="confirm-box" data-action="noop">' +
      "<h2>🛑 " +
      draft.deskId +
      ' 号桌结算</h2><p>场次：' +
      escapeHtml(draft.session) +
      " · 已停表 · " +
      (draft.wasPaused ? "停表前已处于暂停状态" : "停表时已自动暂停") +
      '</p><div class="settlement-grid">' +
      "<div><span>实际使用</span><strong>" +
      draft.billableMinutes +
      " 分钟</strong></div><div><span>基础费</span><strong>¥" +
      draft.baseFee +
      "</strong></div><div><span>加时费</span><strong>¥" +
      draft.extraFee +
      "</strong></div><div><span>应收合计</span><strong>¥" +
      draft.totalFee +
      '</strong></div></div><p class="settlement-tip">基础费当前按门店套餐价配置为 0；如需接入固定套餐价，可直接在场次配置里填写。</p>' +
      '<div class="confirm-actions"><button type="button" class="confirm-cancel" data-action="close-finish">继续计时</button>' +
      '<button type="button" class="confirm-submit" data-action="confirm-finish">确认结账</button></div></section></div>'
    );
  }

  function renderRecords() {
    var stat = getDailyStat(dateKey(now));
    var records = stat.records || [];
    var html =
      '<section class="records-drawer"><button type="button" class="records-toggle" data-action="records"><span>今日已完结订单明细</span><strong>' +
      records.length +
      " 条 " +
      (showRecords ? "收起" : "展开") +
      "</strong></button>";
    var i;
    var record;
    if (showRecords) {
      if (records.length === 0) {
        html += '<div class="records-empty">今天还没有完结订单。</div>';
      } else {
        html +=
          '<div class="records-table-wrap"><table class="records-table"><thead><tr><th>桌号</th><th>场次</th><th>准备</th><th>开始</th><th>结束/完结</th><th>实际用时</th><th>基础费</th><th>加时费</th><th>合计</th><th>超时</th></tr></thead><tbody>';
        for (i = records.length - 1; i >= 0; i -= 1) {
          record = records[i];
          html +=
            "<tr><td>" +
            escapeHtml(record.deskId) +
            "</td><td>" +
            escapeHtml(record.session) +
            "</td><td>" +
            escapeHtml(record.prepareTime) +
            "</td><td>" +
            escapeHtml(record.startTime) +
            "</td><td>" +
            escapeHtml(record.expectedEndTime) +
            " / " +
            escapeHtml(record.closedAt) +
            "</td><td>" +
            escapeHtml(record.actualDuration) +
            "</td><td>¥" +
            safeNumber(record.baseFee) +
            "</td><td>¥" +
            safeNumber(record.extraFee) +
            "</td><td>¥" +
            safeNumber(record.totalFee != null ? record.totalFee : record.extraFee) +
            '</td><td class="' +
            (record.isTimeout ? "dangerText" : "") +
            '">' +
            (record.isTimeout ? Math.floor(record.timeoutDuration / 60) + " 分钟" : "否") +
            "</td></tr>";
        }
        html += "</tbody></table></div>";
      }
    }
    return html + "</section>";
  }

  function render() {
    var root = document.getElementById("app");
    if (!root) return;
    root.innerHTML =
      '<div class="compat-shell">' +
      renderHeader() +
      renderStats() +
      renderTabs() +
      renderRegion() +
      renderRecords() +
      renderOpenModal() +
      renderFinishModal() +
      "</div>";
  }

  function closestAction(node, root) {
    while (node && node !== root) {
      if (node.getAttribute && node.getAttribute("data-action")) return node;
      node = node.parentNode;
    }
    return null;
  }

  function handleClick(event) {
    event = event || window.event;
    var root = document.getElementById("app");
    var target = closestAction(event.target || event.srcElement, root);
    var action;
    var id;
    var min;
    if (!target) return;
    action = target.getAttribute("data-action");
    id = target.getAttribute("data-id") || "";
    if (action === "noop") return;
    if (event.stopPropagation) event.stopPropagation();
    event.cancelBubble = true;

    if (action === "open") {
      openingDeskId = id;
      openStartUseNow = true;
      openStartInput = timeInputValue(nowMs());
      render();
    } else if (action === "tab") {
      isAggregatedOnly = false;
      activeRegion = target.getAttribute("data-region") || "window";
      render();
    } else if (action === "close-open") {
      openingDeskId = "";
      render();
    } else if (action === "start-mode") {
      openStartUseNow = target.getAttribute("data-mode") === "now";
      if (openStartUseNow) openStartInput = timeInputValue(nowMs());
      render();
    } else if (action === "shift-start") {
      openStartUseNow = false;
      if (!openStartInput) openStartInput = timeInputValue(nowMs());
      openStartInput = shiftTimeInputValue(openStartInput, parseInt(target.getAttribute("data-min") || "0", 10), now);
      render();
    } else if (action === "preset") {
      prepareDesk(id, target.getAttribute("data-session") || "1h");
    } else if (action === "start") {
      startPreparedDesk(id);
    } else if (action === "cancel-prepare") {
      cancelPreparing(id);
    } else if (action === "add") {
      min = parseInt(target.getAttribute("data-min") || "30", 10);
      addTime(id, min);
    } else if (action === "pause") {
      pauseDesk(id);
    } else if (action === "resume") {
      resumeDesk(id);
    } else if (action === "note") {
      editNote(id);
    } else if (action === "finish") {
      askFinish(id);
    } else if (action === "close-finish") {
      closeFinishModal();
    } else if (action === "confirm-finish") {
      finishDesk();
    } else if (action === "records") {
      showRecords = !showRecords;
      render();
    } else if (action === "aggregate") {
      isAggregatedOnly = !isAggregatedOnly;
      render();
    }
  }

  function handleInput(event) {
    event = event || window.event;
    var target = event.target || event.srcElement;
    if (!target || !target.getAttribute || target.getAttribute("data-action") !== "start-time-input") return;
    openStartUseNow = false;
    openStartInput = target.value || timeInputValue(nowMs());
    render();
  }

  function init(reason) {
    var root;
    if (booted) return;
    booted = true;
    window.LIBMS_TIMER_COMPAT_READY = true;
    now = nowMs();
    desks = loadDesks();
    statsByDate = loadStats();
    root = document.getElementById("app");
    if (root) {
      if (root.addEventListener) root.addEventListener("click", handleClick, false);
      else if (root.attachEvent) root.attachEvent("onclick", handleClick);
      if (root.addEventListener) root.addEventListener("input", handleInput, false);
      else if (root.attachEvent) root.attachEvent("onchange", handleInput);
    }
    tick();
    intervalId = window.setInterval(tick, 1000);
  }

  window.LIBMS_TIMER_COMPAT_BOOT = init;
})();
