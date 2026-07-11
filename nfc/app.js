(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 12000;
  const CACHE_TTL_MS = 8000;
  const DOUYIN_ID = "98526701829";
  const MAX_QUICK_PHOTOS = 9;
  const QUICK_REVIEW_HISTORY_KEY = "libms_dynamic_review_card_history_v1";

  let isGenerating = false;
  let lastRequestKey = "";
  let lastReviewData = null;
  let lastRequestTime = 0;
  let quickRating = 5;
  let quickPhotoItems = [];

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

  const quickReviewOpenings = [
    "今天做了一个手作小作品",
    "逛商场的时候顺便坐下来做点手作",
    "第一次认真体验这种小手作",
    "本来只是想找个地方休息一下",
    "和朋友一起坐下来做手作",
    "带孩子来体验了一下",
    "给自己安排了一点慢下来的时间",
    "今天没有一直逛街，改成坐下来做点东西",
    "手作这件事比想象中更容易投入",
    "进店后选了一个自己喜欢的项目",
    "今天的快乐来自这次手作体验",
    "做完以后第一反应就是想拍照留一下",
  ];

  const quickReviewMiddles = [
    "刚开始还有点没思路，做着做着就顺了",
    "过程不赶，慢慢弄完刚刚好",
    "中间有一点小纠结，但完成后越看越喜欢",
    "比单纯刷手机更容易让人安静下来",
    "步骤不算复杂，但需要一点耐心",
    "边做边聊天，时间过得还挺快",
    "自己动手做出来的感觉确实不太一样",
    "孩子自己选喜欢的图案和颜色，大人在旁边陪着也不无聊",
    "整体节奏比较舒服，不会有被催着完成的感觉",
    "选材料的时候纠结了一会儿，最后效果比预想好",
    "做的时候手一直在忙，脑子反而放空了一下",
    "完成的小作品拿在手里还挺有纪念感",
  ];

  const quickReviewEndings = [
    "最后成品拿到手还挺满意，已经拍照存档了。",
    "适合想休息一下，又不想只是坐着玩手机的时候来。",
    "发出来记录一下，算是给今天留个小纪念。",
    "下次有机会还想试试别的项目。",
    "做完的小作品可以带走，这点还蛮加分。",
    "整体是一次比较轻松的体验。",
    "照片拍出来也挺有生活感，适合带作品一起发。",
    "如果带朋友或者孩子一起，会更有参与感。",
    "不算很难，但认真做完还是会有点小满足。",
    "这种慢慢完成一件小东西的感觉还不错。",
    "最后效果比刚开始想的更好，先发出来纪念一下。",
    "坐下来做一会儿，比一直逛商场舒服不少。",
  ];

  const platformUrls = {
    dianping:
      "https://m.dianping.com/an/ugcastroreact/addreview_qrcode/page/addreviewrouter?lch=saomaxiepingjia&utm_source=saomaxiepingjia&shopcategoryid=144&id=1029212885625444&shoptype=30&shopuuid=l9wfdv6RIbERlpwV&cityid=1618&offlinecode=12508367426672&incentive=smreviewpuma01-daozong01-dpapp-myshop",
    meituan: "https://g.meituan.com/qrcode/transfer?scene=promo_shop&q=fzB8PQwj4S1",
    xiaohongshu: "https://xhslink.com/m/2DusZnAnZaP",
    douyin: "https://v.douyin.com/fA8z1S8iVmI/",
  };

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
    quickPlatform: $("quickPlatform"),
    quickRating: $("quickRating"),
    quickRatingValue: $("quickRatingValue"),
    quickReviewText: $("quickReviewText"),
    quickChangeButton: $("quickChangeButton"),
    quickCopyButton: $("quickCopyButton"),
    quickCopyOpenButton: $("quickCopyOpenButton"),
    quickPhotoInput: $("quickPhotoInput"),
    quickPhotoMeta: $("quickPhotoMeta"),
    quickPreviewGrid: $("quickPreviewGrid"),
    quickStatus: $("quickStatus"),
  };

  const quickPlatformButtons = Array.from(document.querySelectorAll("[data-quick-platform]"));

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

  function setQuickStatus(message) {
    if (elements.quickStatus) elements.quickStatus.textContent = message || "";
  }

  function normalizeReviewText(text) {
    return String(text || "").replace(/\s+/g, " ").trim();
  }

  function loadQuickReviewHistory() {
    try {
      const raw = JSON.parse(localStorage.getItem(QUICK_REVIEW_HISTORY_KEY) || "[]");
      if (!Array.isArray(raw)) return [];
      return raw.map(normalizeReviewText).filter(Boolean);
    } catch (error) {
      return [];
    }
  }

  function saveQuickReviewHistory(history) {
    try {
      localStorage.setItem(QUICK_REVIEW_HISTORY_KEY, JSON.stringify(Array.from(new Set(history)).slice(-2500)));
    } catch (error) {
      // localStorage 写满或被禁用时，页面仍可继续生成，只是不再保证本机去重。
    }
  }

  function markQuickReviewUsed(text) {
    const normalized = normalizeReviewText(text);
    if (!normalized) return;
    const history = loadQuickReviewHistory();
    if (!history.includes(normalized)) {
      history.push(normalized);
      saveQuickReviewHistory(history);
    }
  }

  function buildQuickReviewCandidate(opening, middle, ending) {
    return `${opening}，${middle}。${ending}`;
  }

  function getQuickReviewCandidates() {
    const candidates = [];
    for (const opening of quickReviewOpenings) {
      for (const middle of quickReviewMiddles) {
        for (const ending of quickReviewEndings) {
          candidates.push(buildQuickReviewCandidate(opening, middle, ending));
        }
      }
    }
    return candidates;
  }

  function getUnusedQuickReview(currentText) {
    const history = new Set(loadQuickReviewHistory());
    const current = normalizeReviewText(currentText);
    const available = getQuickReviewCandidates().filter((text) => {
      const normalized = normalizeReviewText(text);
      return normalized !== current && !history.has(normalized);
    });

    if (available.length === 0) return "";
    return randomItem(available);
  }

  function fillQuickReview() {
    if (!elements.quickReviewText) return;
    const next = getUnusedQuickReview(elements.quickReviewText.value);
    if (!next) {
      setQuickStatus("本机灵动文案已全部用过，请使用下方 AI 评价助手重新生成。");
      return;
    }

    elements.quickReviewText.value = next;
    markQuickReviewUsed(next);
    setQuickStatus("已换好一条未在本机出现过的评价参考，可按真实体验微调。");
  }

  function setQuickPlatform(platform) {
    if (elements.quickPlatform) elements.quickPlatform.value = platform;
    quickPlatformButtons.forEach((button) => {
      button.classList.toggle("active", button.dataset.quickPlatform === platform);
    });
  }

  function renderQuickRating() {
    if (!elements.quickRating || !elements.quickRatingValue) return;
    elements.quickRatingValue.textContent = `${quickRating} 星`;
    elements.quickRating.innerHTML = "";

    for (let score = 1; score <= 5; score += 1) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = `star-button${score > quickRating ? " inactive" : ""}`;
      button.textContent = "★";
      button.setAttribute("role", "radio");
      button.setAttribute("aria-label", `${score}星`);
      button.setAttribute("aria-checked", String(score === quickRating));
      button.addEventListener("click", () => {
        quickRating = score;
        renderQuickRating();
        setQuickStatus("评分已调整，请按真实体验发布。");
      });
      elements.quickRating.appendChild(button);
    }
  }

  function formatFileSize(size) {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)}MB`;
    return `${Math.max(1, Math.round(size / 1024))}KB`;
  }

  function cleanupQuickPhotoUrls() {
    quickPhotoItems.forEach((item) => URL.revokeObjectURL(item.url));
    quickPhotoItems = [];
  }

  function renderQuickPhotos() {
    if (!elements.quickPreviewGrid || !elements.quickPhotoMeta) return;
    elements.quickPreviewGrid.innerHTML = "";

    if (quickPhotoItems.length === 0) {
      elements.quickPhotoMeta.textContent = "暂未选择图片";
      return;
    }

    elements.quickPhotoMeta.textContent = `已选择 ${quickPhotoItems.length} 张图片：${quickPhotoItems
      .map((item) => `${item.file.name}（${formatFileSize(item.file.size)}）`)
      .join("、")}`;

    quickPhotoItems.forEach((item, index) => {
      const card = document.createElement("div");
      card.className = "preview-item";

      const img = document.createElement("img");
      img.src = item.url;
      img.alt = item.file.name || `作品照片 ${index + 1}`;
      img.loading = "lazy";

      const removeButton = document.createElement("button");
      removeButton.type = "button";
      removeButton.textContent = "×";
      removeButton.setAttribute("aria-label", `移除第 ${index + 1} 张图片`);
      removeButton.addEventListener("click", () => {
        URL.revokeObjectURL(item.url);
        quickPhotoItems.splice(index, 1);
        renderQuickPhotos();
      });

      const name = document.createElement("div");
      name.className = "preview-name";
      name.textContent = item.file.name || `作品照片 ${index + 1}`;

      card.append(img, removeButton, name);
      elements.quickPreviewGrid.appendChild(card);
    });
  }

  function handleQuickPhotoChange(event) {
    const files = Array.from(event.target.files || []).filter((file) => file.type.startsWith("image/"));
    cleanupQuickPhotoUrls();

    quickPhotoItems = files.slice(0, MAX_QUICK_PHOTOS).map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));

    renderQuickPhotos();

    if (files.length > MAX_QUICK_PHOTOS) {
      setQuickStatus(`最多预览 ${MAX_QUICK_PHOTOS} 张图片，已自动保留前 ${MAX_QUICK_PHOTOS} 张。`);
    } else if (quickPhotoItems.length > 0) {
      setQuickStatus("图片已加载为本机预览，发布到平台时请手动选择这些照片。");
    } else {
      setQuickStatus("未选择可预览的图片，请从相册选择作品照片。");
    }
  }

  async function copyQuickReview(options = {}) {
    const text = elements.quickReviewText?.value || "";
    markQuickReviewUsed(text);
    await copyText(text, "评价已复制，请按真实体验确认后发布", options);
    setQuickStatus("评价已复制。作品照片请在平台发布页手动上传。");
  }

  function copyQuickReviewAndOpen() {
    if (!String(elements.quickReviewText?.value || "").trim()) {
      setQuickStatus("暂无可复制内容，请先换一句评价参考。");
      return;
    }

    const platform = elements.quickPlatform?.value || "dianping";
    const url = platformUrls[platform] || platformUrls.dianping;
    copyQuickReview({ alert: false }).catch(() => {
      setQuickStatus("跳转已打开，如未复制成功，请返回页面手动复制评价。");
    });

    const opened = window.open(url, "_blank", "noopener,noreferrer");
    if (!opened) {
      setQuickStatus("评价已复制。如浏览器拦截跳转，请点击下方发布入口手动打开。");
    }
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

  renderQuickRating();
  fillQuickReview();
  setQuickPlatform(elements.quickPlatform?.value || "dianping");
  elements.quickChangeButton?.addEventListener("click", fillQuickReview);
  elements.quickCopyButton?.addEventListener("click", copyQuickReview);
  elements.quickCopyOpenButton?.addEventListener("click", copyQuickReviewAndOpen);
  elements.quickPhotoInput?.addEventListener("change", handleQuickPhotoChange);
  elements.quickPlatform?.addEventListener("change", () => {
    setQuickPlatform(elements.quickPlatform.value);
  });
  quickPlatformButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setQuickPlatform(button.dataset.quickPlatform || "dianping");
      copyQuickReviewAndOpen();
    });
  });

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

  window.addEventListener("pagehide", cleanupQuickPhotoUrls);
})();
