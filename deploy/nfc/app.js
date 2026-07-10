(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 12000;
  const CACHE_TTL_MS = 30000;
  const DOUYIN_ID = "98526701829";

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
    copyDouyinButton: $("copyDouyinButton"),
    wechatDouyinTip: $("wechatDouyinTip"),
    copyStatus: $("copyStatus"),
  };

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

  async function copyText(text, successMessage) {
    const value = String(text || "").trim();
    if (!value) {
      alert("暂无可复制内容");
      return;
    }

    try {
      await navigator.clipboard.writeText(value);
      setStatus(successMessage || "已复制");
      alert(successMessage || "已复制");
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
        alert(successMessage || "已复制");
      } catch (fallbackError) {
        setStatus("复制失败，请长按文字手动复制");
        alert("复制失败，请长按文字手动复制");
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
  elements.copyDouyinButton.addEventListener("click", () => {
    copyText(DOUYIN_ID, "抖音号已复制，请打开抖音搜索关注");
  });

  if (/MicroMessenger/i.test(navigator.userAgent) && elements.wechatDouyinTip) {
    elements.wechatDouyinTip.hidden = false;
  }
})();
