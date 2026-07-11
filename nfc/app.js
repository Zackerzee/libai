(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 12000;
  const CACHE_TTL_MS = 8000;
  const VISITED_PLATFORM_KEY = "libms_nfc_visited_platforms_v1";

  let isGenerating = false;
  let lastRequestKey = "";
  let lastReviewData = null;
  let lastRequestTime = 0;

  const wildLocalReviewTemplates = [
    "今日份手作存档，做了{project}，比我想的更费手，弄完只想先拍照炫一下。",
    "外面热到不想动，坐下来做了个{project}，慢慢弄完，手机都少刷了好一会儿。",
    "手残党挑战{project}，中间一度怀疑自己，最后看着还行，丑萌丑萌的我也喜欢。",
    "本来只是随便试试{project}，结果做着做着安静下来了，时间过得比刷手机快。",
    "做{project}的时候有点上头，前面还在纠结怎么弄，后面就只想赶紧看看最后效果。",
    "今天不想走路逛太久，就坐下来弄了个{project}，过程比想象中更消磨时间。",
    "{project}完成，手是真的忙，脑子反而放空了一会儿，这种慢吞吞的感觉还不错。",
    "给自己安排了一点手作时间，做了{project}，不算完美，但越看越觉得是我的风格。",
  ];

  const $ = (id) => document.getElementById(id);

  const elements = {
    platform: $("platform"),
    project: $("project"),
    tone: $("tone"),
    keywords: $("keywords"),
    reviewText: $("reviewText"),
    aiBtn: $("aiBtn"),
    copyReviewButton: $("copyReviewButton"),
    stickyCopyReviewButton: $("stickyCopyReviewButton"),
    copyPhoneButton: $("copyPhoneButton"),
    copyWifiButton: $("copyWifiButton"),
    connectWifiButton: $("connectWifiButton"),
    copyWechatButton: $("copyWechatButton"),
    copyMomentsVideoButton: $("copyMomentsVideoButton"),
    copyMomentsPostButton: $("copyMomentsPostButton"),
    copyWechatChannelsButton: $("copyWechatChannelsButton"),
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

  function getLocalFallback(project) {
    const safeProject = String(project || "手作").trim() || "手作";
    return randomItem(wildLocalReviewTemplates).replace(/\{project\}/g, safeProject);
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

  function openWechatApp() {
    window.location.href = "weixin://";
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
    elements.reviewText.innerText = "正在生成真实短评，请稍等...";
    setStatus("正在生成评价参考，请稍等。");

    try {
      const review = await requestDeepSeekReview(payload);
      elements.reviewText.innerText = review;
      saveCache(payload, review);
      setStatus("已生成评价，可按真实体验稍微修改后发布。");
    } catch (error) {
      const fallback = getLocalFallback(payload.project);
      elements.reviewText.innerText = fallback;
      setStatus("网络暂时不稳定，已生成本地评价参考，可按真实体验稍微修改后发布。");
    } finally {
      isGenerating = false;
      elements.aiBtn.disabled = false;
      elements.aiBtn.innerText = "生成一条真实短评";
    }
  }

  async function copyText(text, successMessage, options = {}) {
    const value = String(text || "").trim();
    const shouldAlert = options.alert !== false;
    if (!value) {
      if (shouldAlert) alert("暂无可复制内容");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage || "已复制");
      if (shouldAlert) alert(successMessage || "已复制");
      return;
    } catch (error) {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        const ok = document.execCommand("copy");
        if (!ok) throw new Error("execCommand failed");
        setStatus(successMessage || "已复制");
        if (shouldAlert) alert(successMessage || "已复制");
      } catch (fallbackError) {
        setStatus("复制失败，请长按文字手动复制");
        if (shouldAlert) alert("复制失败，请长按文字手动复制");
      } finally {
        textarea.remove();
      }
    }
  }

  elements.aiBtn.addEventListener("click", generateReview);
  elements.copyReviewButton.addEventListener("click", () => {
    copyText(elements.reviewText.innerText, "已复制，可以去点评/小红书粘贴啦");
  });
  elements.stickyCopyReviewButton.addEventListener("click", () => {
    copyText(elements.reviewText.innerText, "已复制，可以去点评/小红书粘贴啦");
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
  elements.copyMomentsVideoButton?.addEventListener("click", () => {
    markPlatformVisited("wechat-moments-video");
    copyText(getShareableReviewText(), "评价参考已复制，请在微信选择视频发布。", { alert: false });
    setStatus("评价参考已复制，请在微信朋友圈选择视频发布。");
    openWechatApp();
  });
  elements.copyMomentsPostButton?.addEventListener("click", () => {
    markPlatformVisited("wechat-moments-post");
    copyText(getShareableReviewText(), "评价参考已复制，请在微信选择照片发布。", { alert: false });
    setStatus("评价参考已复制，请在微信朋友圈选择照片发布。");
    openWechatApp();
  });
  elements.copyWechatChannelsButton?.addEventListener("click", () => {
    markPlatformVisited("wechat-channels");
    copyText(getShareableReviewText(), "评价参考已复制，请在视频号选择作品发布。", { alert: false });
    setStatus("评价参考已复制，请在微信视频号选择作品发布。");
    openWechatApp();
  });
  visitLinks.forEach((link) => {
    link.addEventListener("click", () => markPlatformVisited(link.dataset.visitKey));
  });
  renderVisitedPlatforms();

  if (/MicroMessenger/i.test(navigator.userAgent) && elements.wechatDouyinTip) {
    elements.wechatDouyinTip.hidden = false;
  }
})();
