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
    "这次做{project}比想象中容易进入状态，前面选样式会花点时间，后面按步骤慢慢做就顺了。成品拿在手里比单纯买个小东西更有记忆点，适合想坐下来做点手作的人。",
    "{project}做起来不算赶，比较适合朋友一起边聊边弄。材料和样式能自己选，过程里会有一点自己的想法在里面，最后看到成品的时候还挺满足，比只逛商场有意思。",
    "第一次尝试{project}也没有想象中那么难，开始会纠结选什么，做着做着就慢慢有思路了。完成后能带走自己的作品，放家里或者拍照留个记录都很合适。",
    "带孩子或者和家人一起做{project}还蛮合适，步骤不会一下子太复杂，大人也能一起参与。孩子能安静坐下来做一会儿，最后拿着自己的作品会比较开心。",
    "{project}适合想体验手作但又怕太复杂的人，选好材料后慢慢做就行。过程不会很赶，成品出来以后能看出是自己一点点完成的，整体是比较轻松的一次体验。",
    "这次做{project}的感觉比预期好，前面选款式有点纠结，后面做起来就比较专注。完成的小作品可以带走，作为一次逛街中间的手作体验还挺有记忆点。",
  ];

  const pinDouLocalReviewTemplates = [
    "这次做拼豆选图案的时候纠结了一会儿，颜色选择挺多，照着图纸慢慢摆就能做下去。小图对新手比较友好，不会一开始就太有压力，拼完店员帮忙熨好，拿到成品时还蛮开心。",
    "第一次认真做拼豆，本来担心自己没耐心，结果找颜色和摆豆子的时候还挺投入。图案选小一点会轻松很多，做完的小作品可以带走，拿在手里会觉得这段时间没有白坐。",
    "带孩子做拼豆比想象中省心，孩子自己选图案，大人在旁边帮忙找颜色就行。过程需要一点耐心，但不会太难，最后成品由店员处理好，拿走的时候孩子还挺舍不得放手。",
    "如果想拼大一点的图，确实要留够时间，选色和对图纸都会更细一点。慢慢把图案摆出来的过程还蛮有意思，最后店员帮忙处理成品，拿到手比只看图片更有感觉。",
    "拼豆的颜色和图案选择都不少，刚开始会纠结选哪个，真正开始后就跟着图纸一点点摆。新手选小图会更轻松，拼完以后不用自己熨，店员处理好就能带走。",
    "朋友一起做拼豆还挺适合聊天的，各自选图案，边找颜色边互相看进度。这个项目不太需要基础，主要是耐心，最后做出来的小东西能带走，感觉比单纯坐着喝东西更有意思。",
    "拼豆做起来比想象中更需要细心，颜色找对了后面就顺很多。图纸清楚的话上手不难，完成后交给店员熨好，成品拿到手那一下还是有点小惊喜的。",
    "这次拼豆选了个不算太大的图，刚好适合第一次尝试。颜色多但不会乱，慢慢摆出来的过程比较安静，拼好后店员会帮忙处理，最后带走一个自己的小作品。",
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
    "店里能坐下来慢慢做，不用一直赶进度，逛累了来停一下也合适。",
    "位置在商场里还算方便，临时想找个室内活动也不会太折腾。",
    "桌面和工具摆得比较清楚，第一次做也不会一上来就很慌。",
    "整体节奏比较慢，朋友聊天、亲子陪伴，或者一个人安静做一会儿都可以。",
    "做的过程比较适合拍几张照片留念，成品拿在手里也比想象中有意思。",
    "如果选的是大一点的作品，会更适合不赶时间的时候慢慢做。",
  ];

  const photoTemplates = [
    "做完以后忍不住多拍了几张，自己做出来的东西确实会自带一点滤镜。",
    "如果是拼豆这类项目，选色和慢慢摆出来的过程本身就挺适合记录。",
    "作品能带走这一点比较实用，适合想留下纪念或者送朋友的人。",
    "成品拿到手会比只看图案时更有感觉，尤其是自己一点点做出来的。",
    "拍照的时候能看出颜色和大小，发朋友圈也不会显得太单调。",
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
    project: $("project"),
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
      platform: "dianping",
      project: elements.project.value || "手作",
      tone: "自然真实",
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
