(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 12000;
  const CACHE_TTL_MS = 8000;
  const MIN_LOCAL_REVIEW_LENGTH = 75;
  const MAX_LOCAL_REVIEW_LENGTH = 250;
  const VISITED_PLATFORM_KEY = "libms_nfc_visited_platforms_v1";
  const LAST_REVIEW_TEXT_KEY = "libms_nfc_last_review_text_v2";
  const RETURN_COPY_PENDING_KEY = "libms_nfc_return_copy_pending_v1";
  const REVIEW_OPEN_KEYS = new Set(["dianping-review", "meituan-review", "douyin-review"]);
  const KEYWORD_CHIP_COUNT = 5;

  let isGenerating = false;
  let lastRequestKey = "";
  let lastReviewData = null;
  let lastRequestTime = 0;
  let lastPlatformOpenAt = 0;

  const referenceLocalReviewTemplates = [
    "这次体验的是{project}，比较适合想坐下来慢慢做点东西的人。项目上手不算复杂，前面选图案和材料会花一点时间，后面做起来节奏比较稳，最后作品可以带走，整体对新手也算友好。",
    "{project}比单纯逛商场更有参与感，适合朋友一起坐下来边聊边做。过程不会太赶，材料选择也比较清楚，做完能带走一个自己的小作品，想拍照记录也比较方便。",
    "如果是第一次做手作，{project}还算比较容易开始。前面需要一点耐心选样式和颜色，做的过程能安静坐一会儿，成品出来以后可以带走，适合想找个地方休息又不想只刷手机的人。",
    "带孩子或者和家人一起体验{project}会比较合适，步骤不会一下子太复杂，大人也能在旁边一起参与。整个过程主要是慢慢做，完成后有作品可以留作纪念，比只逛街更有内容。",
    "{project}适合想体验手作但又怕太难的人，现场材料和工具比较直观，按照自己的节奏做就行。最后的作品能带走，也适合拍几张过程照和成品照，发出来会比单纯文字更有参考。",
    "这次做{project}的感受还不错，比较适合空闲时坐下来体验。项目本身有选择空间，做的时候不会太单调，最后能看到一个完成的小作品，对想了解手作体验的人来说信息比较明确。",
  ];

  const pinDouLocalReviewTemplates = [
    "拼豆比较适合想坐下来慢慢做的人，颜色和图案选择比较多，小图对新手更友好。照着图纸一点点摆就行，拼好后交给店员熨烫处理，成品可以带走，配上过程图和成品图会更直观。",
    "第一次做拼豆可以先选小一点的图案，找颜色会花一点时间，但步骤不复杂。现场主要看图纸慢慢摆，做完以后由店员处理成品，最后能带走留念，适合想体验手作又怕太难的人。",
    "带孩子体验拼豆的话，建议先选难度低一点的图案，孩子更容易坐得住。颜色选择比较多，大人可以帮忙找色号，拼好后交给店员熨烫处理，整体适合作为一次室内亲子手作。",
    "如果想拼大一点的图，最好预留充足时间，选色和对图纸都会更细。拼豆的过程需要耐心，完成后成品可以带走，拍一张制作过程和最后效果，对后面想来的人会比较有参考。",
    "拼豆最有参考的地方还是颜色、图案和成品处理。颜色选择比较多，照着图纸慢慢摆就能开始，新手可以先选简单款。拼好后不用自己熨烫，交给店员处理就行，最后带走作品会更方便。",
    "如果是朋友一起做拼豆，可以各自选图案，边找颜色边聊天。这个项目不太需要手作基础，主要看耐心和图纸，做完拍一下过程和成品，别人看评价时也更容易判断适不适合自己。",
    "做拼豆时图纸难度和颜色是否好找会比较影响体验，新手可以先选小图。制作过程主要是照图摆豆，成品交给店员处理后能带走，过程图和成品图一起发会更有参考。",
    "拼豆适合想认真做一个小作品的人，重点可以看颜色选择、图纸清晰度和工具是否顺手。做的时候不用赶，成品最后由店员处理，适合给后面想体验的人一个比较直观的参考。",
  ];

  const commonKeywordChips = [
    "适合新手",
    "孩子能坐住",
    "朋友一起做",
    "亲子体验",
    "位置好找",
    "空调足",
    "环境安静",
    "灯光明亮",
    "座位宽敞",
    "人多但有序",
    "工具齐全",
    "制作过程不赶",
    "作品可以带走",
    "适合拍照记录",
    "下次想试别的项目",
  ];

  const projectKeywordChips = {
    拼豆: [
      "颜色选择多",
      "色号好找",
      "豆子分区清楚",
      "豆子没有混色",
      "豆子无毛刺",
      "图纸清楚",
      "图案选择多",
      "镊子顺手",
      "垫板清楚",
      "清洁刷方便",
      "可以打印图纸",
      "小图适合新手",
      "大图需要耐心",
      "压豆不翻车",
      "成品由店员处理",
      "熨烫比较平整",
      "做完可以打孔",
      "成品有包装",
    ],
    香薰蜡烛: ["味道可以自己选", "颜色搭配自由", "成品适合摆放", "制作步骤清楚", "适合送朋友"],
    蔬果花皂DIY: ["造型选择多", "颜色搭配自由", "成品适合拍照", "孩子容易参与", "适合亲子"],
    石膏娃娃DIY: ["款式选择多", "上色比较自由", "颜料颜色多", "成品适合摆放", "适合慢慢涂"],
    串珠DIY: ["珠子款式多", "颜色搭配自由", "适合做小饰品", "步骤比较直观", "适合朋友一起做"],
  };

  const envTemplates = [
    "店里可以坐下来慢慢做，不太适合赶时间的人，适合想停下来做点小东西的时候来。",
    "位置在商场里，逛累了顺便体验会比较方便，不用特意安排很复杂的行程。",
    "桌面和工具看起来比较清楚，新手第一次做也不容易一下子不知道从哪里开始。",
    "整体节奏比较慢，适合朋友聊天、亲子陪伴，或者一个人安静做一会儿。",
    "如果想拍照记录，过程图和成品图都比较好拍，发布时配图会更有参考。",
    "如果现场有打印图纸或大图需求，评价里写清楚会更方便后面的人参考。",
  ];

  const photoTemplates = [
    "做完以后可以拍一张成品照，别人看评价时能更直观看到项目效果。",
    "如果是拼豆这类项目，建议拍一下选色或制作过程，能看出实际操作是不是适合自己。",
    "作品能带走这一点比较实用，适合想留下纪念或者送朋友的人。",
    "成品照片比只写感受更有说服力，尤其是颜色、大小和完成效果都能看清楚。",
    "发布时加一两张制作过程图，会比只放最终作品更容易让别人判断体验感。",
  ];

  const moodTemplates = [
    "整体是比较轻松的正向体验，不会只适合特别会做手工的人。",
    "比较适合想找个室内活动的人，尤其是不想一直走路逛街的时候。",
    "对没做过手作的人来说，难度和耗时都比较容易接受，不会一上来就觉得压力很大。",
    "如果是和朋友一起来，边做边聊会更自然，比单纯找地方坐着更有参与感。",
    "完成后的作品能看见自己的选择和动手过程，作为一次体验记录也比较合适。",
  ];

  const $ = (id) => document.getElementById(id);

  const elements = {
    platform: $("platform"),
    project: $("project"),
    tone: $("tone"),
    keywords: $("keywords"),
    keywordChips: $("keywordChips"),
    selectedKeywordChips: $("selectedKeywordChips"),
    refreshKeywordChipsButton: $("refreshKeywordChipsButton"),
    clearKeywordsButton: $("clearKeywordsButton"),
    reviewText: $("reviewText"),
    aiBtn: $("aiBtn"),
    copyReviewButton: $("copyReviewButton"),
    copyPhoneButton: $("copyPhoneButton"),
    copyWifiButton: $("copyWifiButton"),
    connectWifiButton: $("connectWifiButton"),
    copyWechatButton: $("copyWechatButton"),
    wifiConnectHint: $("wifiConnectHint"),
    wechatDouyinTip: $("wechatDouyinTip"),
    copyStatus: $("copyStatus"),
  };
  const visitLinks = Array.from(document.querySelectorAll("[data-visit-key]"));

  function setStatus(message) {
    elements.copyStatus.textContent = message || "";
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function getFinalKeywords(rawKeywords) {
    return String(rawKeywords || "").trim();
  }

  function textLength(text) {
    return Array.from(String(text || "").trim()).length;
  }

  function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function shuffle(items) {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
      const target = Math.floor(Math.random() * (index + 1));
      [result[index], result[target]] = [result[target], result[index]];
    }
    return result;
  }

  function sampleUnique(items, count) {
    return shuffle(items).slice(0, Math.min(count, items.length));
  }

  function trimToMaxLength(text) {
    const chars = Array.from(String(text || "").trim());
    if (chars.length <= MAX_LOCAL_REVIEW_LENGTH) return chars.join("");
    return chars.slice(0, MAX_LOCAL_REVIEW_LENGTH).join("").replace(/[，、；：,.!?！？\s]+$/g, "");
  }

  function normalizeReviewSentence(text) {
    const value = String(text || "").trim().replace(/[。！？!?\s]+$/g, "");
    return value ? `${value}。` : "";
  }

  function ensureLocalReviewLength(text) {
    const value = String(text || "").trim();
    const currentLength = textLength(value);
    if (currentLength >= MIN_LOCAL_REVIEW_LENGTH && currentLength <= MAX_LOCAL_REVIEW_LENGTH) return value;
    if (currentLength > MAX_LOCAL_REVIEW_LENGTH) return trimToMaxLength(value);

    const fragments = shuffle([
      ...sampleUnique(envTemplates, randomInt(1, 2)),
      ...sampleUnique(photoTemplates, randomInt(1, 2)),
      ...sampleUnique(moodTemplates, randomInt(1, 2)),
    ]);

    let result = normalizeReviewSentence(value);
    for (const fragment of fragments) {
      const next = `${result}${normalizeReviewSentence(fragment)}`;
      if (textLength(next) <= MAX_LOCAL_REVIEW_LENGTH) {
        result = next;
      }
      if (textLength(result) >= MIN_LOCAL_REVIEW_LENGTH) break;
    }

    if (textLength(result) < MIN_LOCAL_REVIEW_LENGTH) {
      for (const fragment of shuffle([...envTemplates, ...photoTemplates, ...moodTemplates])) {
        const next = `${result}${normalizeReviewSentence(fragment)}`;
        if (textLength(next) <= MAX_LOCAL_REVIEW_LENGTH) {
          result = next;
        }
        if (textLength(result) >= MIN_LOCAL_REVIEW_LENGTH) break;
      }
    }

    return trimToMaxLength(result);
  }

  function getLocalFallback(project) {
    const safeProject = String(project || "手作").trim() || "手作";
    const templates = safeProject === "拼豆" ? pinDouLocalReviewTemplates : referenceLocalReviewTemplates;
    return ensureLocalReviewLength(randomItem(templates).replace(/\{project\}/g, safeProject));
  }

  function getShareableReviewText() {
    const text = String(elements.reviewText.innerText || "").trim();
    if (!text || /点击下方按钮|正在生成/.test(text)) {
      const fallback = getLocalFallback(elements.project.value || "手作");
      elements.reviewText.innerText = fallback;
      return fallback;
    }
    return text;
  }

  function sanitizeClipboardText(text) {
    return String(text || "")
      .normalize("NFC")
      .replace(/https?:\/\/[^\s"'<>，。！？、；：）)】\]]+/gi, "")
      .replace(/(^|\s)[0-9a-z][0-9a-z.+-]*:\/\/[^\s"'<>，。！？、；：）)】\]]+/gi, " ")
      .replace(/复制所有描述#\*[a-z0-9]{6,}\*#\d?@?.*?(App|应用|后到|打开)?/gi, "")
      .replace(/#\*[a-z0-9]{6,}\*#\d?@?/gi, "")
      .replace(/\u00a0/g, " ")
      .replace(/[\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g, "")
      .replace(/[^\S\r\n]+/g, " ")
      .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, "")
      .trim();
  }

  function isSafeReviewClipboardText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    if (/https?:\/\//i.test(text)) return false;
    if (/(^|\s)[a-z][a-z0-9.+-]*:\/\//i.test(text)) return false;
    if (/复制所有描述|后到|#\*[a-z0-9]{6,}\*#|@[^\s]{1,20}/i.test(text)) return false;
    return true;
  }

  function rememberReviewText(text) {
    const value = sanitizeClipboardText(text);
    if (!value) return;
    try {
      sessionStorage.setItem(LAST_REVIEW_TEXT_KEY, value);
    } catch (error) {
      // sessionStorage 不可用不影响主流程。
    }
  }

  function getRememberedReviewText() {
    try {
      return sanitizeClipboardText(sessionStorage.getItem(LAST_REVIEW_TEXT_KEY) || "");
    } catch (error) {
      return "";
    }
  }

  function setReturnCopyPending(isPending) {
    try {
      if (isPending) {
        sessionStorage.setItem(RETURN_COPY_PENDING_KEY, "1");
      } else {
        sessionStorage.removeItem(RETURN_COPY_PENDING_KEY);
      }
    } catch (error) {
      // sessionStorage 不可用不影响复制按钮。
    }
  }

  function hasReturnCopyPending() {
    try {
      return sessionStorage.getItem(RETURN_COPY_PENDING_KEY) === "1";
    } catch (error) {
      return false;
    }
  }

  function loadVisitedPlatforms() {
    try {
      const value = JSON.parse(localStorage.getItem(VISITED_PLATFORM_KEY) || "[]");
      return Array.isArray(value) ? value.filter(Boolean) : [];
    } catch (error) {
      return [];
    }
  }

  function saveVisitedPlatforms(keys) {
    try {
      localStorage.setItem(VISITED_PLATFORM_KEY, JSON.stringify(Array.from(new Set(keys)).slice(-80)));
    } catch (error) {
      // localStorage 不可用时不影响跳转，只是不显示“已前往”。
    }
  }

  function renderVisitedPlatforms() {
    const visited = new Set(loadVisitedPlatforms());
    visitLinks.forEach((link) => {
      link.classList.toggle("visited", visited.has(link.dataset.visitKey));
    });
  }

  function markPlatformVisited(key) {
    if (!key) return;
    const visited = loadVisitedPlatforms();
    if (!visited.includes(key)) {
      visited.push(key);
      saveVisitedPlatforms(visited);
    }
    renderVisitedPlatforms();
  }

  function setWifiHint(message) {
    if (elements.wifiConnectHint) {
      elements.wifiConnectHint.textContent = message;
    }
  }

  function openSystemWifiSettings() {
    const ua = navigator.userAgent || "";

    if (/iPhone|iPad|iPod/i.test(ua)) {
      window.location.href = "App-Prefs:root=WIFI";
      return true;
    }

    if (/Android/i.test(ua)) {
      window.location.href = "intent:#Intent;action=android.settings.WIFI_SETTINGS;end";
      return true;
    }

    return false;
  }

  function getKeywordPoolForProject(project) {
    const safeProject = String(project || "").trim();
    const projectPool = projectKeywordChips[safeProject] || [];
    return Array.from(new Set([...projectPool, ...commonKeywordChips]));
  }

  function parseKeywordTokens(value) {
    return String(value || "")
      .split(/[，,、；;\n]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function writeKeywordTokens(tokens) {
    const unique = Array.from(new Set(tokens.map((item) => item.trim()).filter(Boolean)));
    let value = unique.join("，");
    while (textLength(value) > 100 && unique.length > 0) {
      unique.pop();
      value = unique.join("，");
    }
    elements.keywords.value = value;
    syncKeywordUi();
  }

  function updateKeywordChipState() {
    if (!elements.keywordChips) return;
    const selected = new Set(parseKeywordTokens(elements.keywords.value));
    elements.keywordChips.querySelectorAll("[data-keyword-chip]").forEach((button) => {
      const isActive = selected.has(button.dataset.keywordChip);
      button.classList.toggle("active", isActive);
      button.setAttribute("aria-pressed", isActive ? "true" : "false");
    });
  }

  function renderSelectedKeywordChips() {
    if (!elements.selectedKeywordChips) return;
    const tokens = parseKeywordTokens(elements.keywords.value);
    elements.selectedKeywordChips.textContent = "";
    elements.selectedKeywordChips.classList.toggle("has-items", tokens.length > 0);

    tokens.forEach((keyword) => {
      const chip = document.createElement("span");
      chip.className = "selected-keyword-chip";
      chip.textContent = keyword;

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.className = "selected-keyword-remove";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `删除关键词：${keyword}`);
      removeButton.addEventListener("click", () => {
        writeKeywordTokens(parseKeywordTokens(elements.keywords.value).filter((item) => item !== keyword));
      });

      chip.appendChild(removeButton);
      elements.selectedKeywordChips.appendChild(chip);
    });
  }

  function syncKeywordUi() {
    updateKeywordChipState();
    renderSelectedKeywordChips();
  }

  function toggleKeywordChip(keyword) {
    const tokens = parseKeywordTokens(elements.keywords.value);
    const index = tokens.indexOf(keyword);
    if (index >= 0) {
      tokens.splice(index, 1);
    } else {
      tokens.push(keyword);
    }
    writeKeywordTokens(tokens);
  }

  function renderKeywordChips() {
    if (!elements.keywordChips) return;
    elements.keywordChips.textContent = "";
    const keywords = sampleUnique(getKeywordPoolForProject(elements.project.value), KEYWORD_CHIP_COUNT);

    keywords.forEach((keyword) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "keyword-chip";
      button.dataset.keywordChip = keyword;
      button.textContent = keyword;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => toggleKeywordChip(keyword));
      elements.keywordChips.appendChild(button);
    });

    syncKeywordUi();
  }

  function getRequestKey(payload) {
    return JSON.stringify(payload);
  }

  function canUseCache(payload) {
    const key = getRequestKey(payload);
    const now = Date.now();
    return Boolean(lastReviewData && lastRequestKey === key && now - lastRequestTime < CACHE_TTL_MS);
  }

  function saveCache(payload, review) {
    lastRequestKey = getRequestKey(payload);
    lastReviewData = { review };
    lastRequestTime = Date.now();
  }

  async function requestDeepSeekReview(payload) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), DEEPSEEK_TIMEOUT_MS);

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.review) {
        throw new Error(data.error || "生成失败");
      }
      return String(data.review).trim();
    } finally {
      clearTimeout(timeout);
    }
  }

  async function generateReview() {
    if (isGenerating) return;

    const finalKeywords = getFinalKeywords(elements.keywords.value);
    const payload = {
      platform: elements.platform.value || "dianping",
      project: elements.project.value || "手作",
      tone: elements.tone.value || "自然真实",
      keywords: finalKeywords,
    };

    if (canUseCache(payload)) {
      elements.reviewText.innerText = lastReviewData.review;
      setStatus("已显示刚刚生成的评价参考，可按真实体验稍微修改后发布。");
      return;
    }

    isGenerating = true;
    elements.aiBtn.disabled = true;
    elements.aiBtn.innerText = "正在生成...";
    elements.reviewText.innerText = "正在生成高质量评价参考，请稍等...";
    setStatus("正在生成有参考价值的评价内容，请稍等。");

    try {
      const review = await requestDeepSeekReview(payload);
      elements.reviewText.innerText = review;
      saveCache(payload, review);
      setStatus("已生成评价参考，可按真实体验稍微修改后发布。");
    } catch (error) {
      const fallback = getLocalFallback(payload.project);
      elements.reviewText.innerText = fallback;
      setStatus("网络暂时不稳定，已生成本地评价参考，可按真实体验稍微修改后发布。");
    } finally {
      isGenerating = false;
      elements.aiBtn.disabled = false;
      elements.aiBtn.innerText = "生成高质量评价参考";
    }
  }

  function copyByTextareaSelection(value) {
    if (!isSafeReviewClipboardText(value)) return false;

    const textarea = document.createElement("textarea");
    textarea.value = value;
    if (textarea.value !== value) return false;
    textarea.setAttribute("aria-hidden", "true");
    textarea.style.position = "fixed";
    textarea.style.top = "0";
    textarea.style.left = "0";
    textarea.style.width = "1px";
    textarea.style.height = "1px";
    textarea.style.padding = "0";
    textarea.style.border = "0";
    textarea.style.opacity = "0.01";
    textarea.style.fontSize = "16px";
    textarea.style.zIndex = "-1";
    document.body.appendChild(textarea);

    try {
      textarea.focus({ preventScroll: true });
      textarea.select();
      textarea.setSelectionRange(0, value.length);
      return document.execCommand("copy");
    } catch (error) {
      return false;
    } finally {
      setTimeout(() => textarea.remove(), 80);
    }
  }

  function copyByContentEditable(value) {
    if (!isSafeReviewClipboardText(value)) return false;

    const container = document.createElement("div");
    container.textContent = value;
    container.contentEditable = "true";
    container.setAttribute("aria-hidden", "true");
    container.style.position = "fixed";
    container.style.top = "0";
    container.style.left = "0";
    container.style.width = "1px";
    container.style.height = "1px";
    container.style.overflow = "hidden";
    container.style.opacity = "0.01";
    container.style.zIndex = "-1";
    document.body.appendChild(container);

    const selection = window.getSelection();
    const range = document.createRange();

    try {
      range.selectNodeContents(container);
      selection.removeAllRanges();
      selection.addRange(range);
      return document.execCommand("copy");
    } catch (error) {
      return false;
    } finally {
      selection?.removeAllRanges();
      setTimeout(() => container.remove(), 80);
    }
  }

  async function copyByClipboardApi(value) {
    if (!isSafeReviewClipboardText(value)) return false;
    if (!navigator.clipboard || !window.isSecureContext) return false;
    try {
      await navigator.clipboard.writeText(value);
      return true;
    } catch (error) {
      return false;
    }
  }

  async function verifyClipboardWrite(value) {
    if (!navigator.clipboard?.readText || !window.isSecureContext) return true;
    let timeout = 0;
    try {
      const current = await Promise.race([
        navigator.clipboard.readText(),
        new Promise((_, reject) => {
          timeout = window.setTimeout(() => reject(new Error("clipboard_read_timeout")), 600);
        }),
      ]);
      const cleanCurrent = sanitizeClipboardText(current);
      return cleanCurrent === value;
    } catch (error) {
      return true;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  function showManualCopyPanel(value) {
    const existing = $("manualCopyPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "manualCopyPanel";
    panel.style.position = "fixed";
    panel.style.left = "14px";
    panel.style.right = "14px";
    panel.style.bottom = "14px";
    panel.style.zIndex = "9999";
    panel.style.border = "1px solid #f0d2c2";
    panel.style.borderRadius = "18px";
    panel.style.padding = "14px";
    panel.style.background = "#fff8f1";
    panel.style.boxShadow = "0 16px 44px rgba(70, 40, 20, 0.22)";

    panel.innerHTML = `
      <div style="font-weight:900;margin-bottom:8px;">复制被浏览器拦截</div>
      <div style="color:#766e66;font-size:13px;line-height:1.5;margin-bottom:10px;">请长按下面文字，选择“复制”，再去平台粘贴。</div>
      <textarea id="manualCopyTextarea" style="width:100%;min-height:108px;border:1px solid #f0e3d8;border-radius:14px;padding:10px;font-size:15px;line-height:1.6;background:#fff;" readonly></textarea>
      <button id="closeManualCopyPanel" type="button" style="width:100%;margin-top:10px;background:#222;color:#fff;">我知道了</button>
    `;
    document.body.appendChild(panel);

    const textarea = $("manualCopyTextarea");
    textarea.value = value;
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, value.length);
    $("closeManualCopyPanel")?.addEventListener("click", () => panel.remove(), { once: true });
  }

  async function copyText(text, successMessage, options = {}) {
    const value = sanitizeClipboardText(text);
    const shouldAlert = options.alert === true;
    if (!isSafeReviewClipboardText(value)) {
      setStatus("复制内容为空或包含平台短链接，请重新生成评价后再复制。");
      if (shouldAlert) alert("复制内容为空或包含平台短链接，请重新生成评价后再复制。");
      return false;
    }

    const copied = (await copyByClipboardApi(value)) || copyByTextareaSelection(value) || copyByContentEditable(value);

    if (copied && (await verifyClipboardWrite(value))) {
      setStatus(successMessage || "已复制");
      if (shouldAlert) alert(successMessage || "已复制");
      return true;
    }

    showManualCopyPanel(value);
    setStatus("自动复制被浏览器拦截，请长按弹窗文字手动复制。");
    if (shouldAlert) alert("自动复制被浏览器拦截，请长按弹窗文字手动复制。");
    return false;
  }

  function showReturnCopyPanel() {
    const review = getRememberedReviewText();
    if (!review) return;

    const existing = $("returnCopyPanel");
    if (existing) existing.remove();

    const panel = document.createElement("div");
    panel.id = "returnCopyPanel";
    panel.style.position = "fixed";
    panel.style.left = "14px";
    panel.style.right = "14px";
    panel.style.bottom = "14px";
    panel.style.zIndex = "9998";
    panel.style.border = "1px solid #f0d2c2";
    panel.style.borderRadius = "20px";
    panel.style.padding = "14px";
    panel.style.background = "#fff8f1";
    panel.style.boxShadow = "0 16px 44px rgba(70, 40, 20, 0.22)";
    panel.innerHTML = `
      <div style="font-weight:950;margin-bottom:6px;">返回后请先复制评价</div>
      <div style="color:#766e66;font-size:13px;line-height:1.5;margin-bottom:10px;">平台会把剪贴板改成短链接。回到这里点下面按钮，再切回平台粘贴。</div>
      <button id="returnCopyButton" type="button" style="width:100%;background:#222;color:#fff;">复制评价正文</button>
      <button id="closeReturnCopyPanel" type="button" style="width:100%;margin-top:8px;background:#fff;color:#766e66;border:1px solid #f0e3d8;">暂时关闭</button>
    `;
    document.body.appendChild(panel);

    $("returnCopyButton")?.addEventListener("click", async () => {
      const copied = await copyText(review, "评价已复制。现在切回平台评价框粘贴。");
      if (copied) {
        setReturnCopyPending(false);
        panel.remove();
      }
    });
    $("closeReturnCopyPanel")?.addEventListener("click", () => panel.remove(), { once: true });
  }

  function prepareReturnCopyAfterOpen() {
    const review = getShareableReviewText();
    rememberReviewText(review);
    setReturnCopyPending(true);
    lastPlatformOpenAt = Date.now();
    setStatus("已打开平台入口。不要在跳转前复制，平台会覆盖剪贴板；返回本页后点“复制评价正文”再粘贴。");
  }

  function showReturnCopyPanelAfterPlatformReturn() {
    if (!hasReturnCopyPending() || !getRememberedReviewText()) return;
    if (Date.now() - lastPlatformOpenAt < 1200) return;
    showReturnCopyPanel();
    setStatus("平台可能已把剪贴板改成短链接。请点“复制评价正文”后再切回平台粘贴。");
  }

  renderKeywordChips();
  elements.keywords.addEventListener("input", syncKeywordUi);
  elements.project.addEventListener("change", renderKeywordChips);
  elements.refreshKeywordChipsButton?.addEventListener("click", renderKeywordChips);
  elements.clearKeywordsButton?.addEventListener("click", () => {
    writeKeywordTokens([]);
    elements.keywords.focus({ preventScroll: true });
  });

  elements.aiBtn.addEventListener("click", generateReview);
  elements.copyReviewButton.addEventListener("click", () => {
    const review = getShareableReviewText();
    rememberReviewText(review);
    copyText(review, "评价已复制。请在目标平台评价输入框长按粘贴；如果出现平台口令，请回本页重新复制。");
  });
  elements.copyPhoneButton.addEventListener("click", () => {
    copyText("19949539970", "电话已复制");
  });
  elements.copyWifiButton.addEventListener("click", () => {
    copyText("88888888", "WiFi密码已复制");
  });
  elements.connectWifiButton?.addEventListener("click", () => {
    markPlatformVisited("wifi-connect");
    copyText("88888888", "WiFi密码已复制，可打开系统 WiFi 连接“时里白造物”。", { alert: false });
    const opened = openSystemWifiSettings();
    setWifiHint(opened ? "已复制密码，并尝试打开系统 WiFi 设置；请选择“时里白造物”。" : "已复制 WiFi 密码：88888888。请在系统 WiFi 中选择“时里白造物”。");
  });
  elements.copyWechatButton?.addEventListener("click", () => {
    markPlatformVisited("wechat-copy");
    copyText("19949539970", "门店电话 / 微信已复制");
  });
  visitLinks.forEach((link) => {
    link.addEventListener("click", () => {
      markPlatformVisited(link.dataset.visitKey);
      if (REVIEW_OPEN_KEYS.has(link.dataset.visitKey)) {
        prepareReturnCopyAfterOpen();
      }
    });
  });
  renderVisitedPlatforms();

  window.addEventListener("pageshow", () => {
    showReturnCopyPanelAfterPlatformReturn();
  });
  window.addEventListener("focus", () => {
    showReturnCopyPanelAfterPlatformReturn();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      showReturnCopyPanelAfterPlatformReturn();
    }
  });

  if (/MicroMessenger/i.test(navigator.userAgent) && elements.wechatDouyinTip) {
    elements.wechatDouyinTip.hidden = false;
  }
})();
