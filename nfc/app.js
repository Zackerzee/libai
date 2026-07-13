(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 12000;
  const CACHE_TTL_MS = 8000;
  const MIN_LOCAL_REVIEW_LENGTH = 75;
  const MAX_LOCAL_REVIEW_LENGTH = 300;
  const VISITED_PLATFORM_KEY = "libms_nfc_visited_platforms_v1";
  const LAST_REVIEW_TEXT_KEY = "libms_nfc_last_review_text_v2";
  const RETURN_COPY_PENDING_KEY = "libms_nfc_return_copy_pending_v1";
  const REVIEW_OPEN_KEYS = new Set(["dianping-review", "meituan-review", "douyin-review"]);

  let isGenerating = false;
  let lastRequestKey = "";
  let lastReviewData = null;
  let lastRequestTime = 0;
  let lastPlatformOpenAt = 0;

  const wildLocalReviewTemplates = [
    "做{project}的时候有点上头，前面还在纠结怎么弄，后面就只想赶紧看看最后效果。手残党本残了属于是，中间一度怀疑自己要翻车，还好最后看着还行，丑萌丑萌的越看越顺眼。",
    "今天不想走路逛街太久，就跟朋友找了这家店坐下来弄{project}。讲真过程比想象中更消磨时间，坐下之后手机都少刷了好一会儿，整个人难得安静下来弄个小玩意。",
    "周末过得有点无聊，跑来挑战一下{project}。刚开始做得手忙脚乱的，脑子反而放空了一会儿。这种慢吞吞、完全不用赶时间的感觉还挺解压的，比窝在家里睡觉有意思多了。",
    "本来只是想随便体验一下{project}，结果坐下来之后还挺投入的哈。前面有点不知道从哪里下手，后面越做越想看看成品长啥样，最后拿到手的时候还挺开心。",
    "{project}比我想象中更需要耐心一点，刚开始还觉得自己肯定搞不定，做着做着反而安静下来了。虽然中间有点小翻车，但最后成品出来还蛮像那么回事的啦。",
    "和朋友一起做{project}真的比单纯逛街有意思，边聊天边慢慢弄，时间一下就过去了。做完以后还有个小东西可以带走，感觉今天没有白出门啊。",
  ];

  const envTemplates = [
    "店里环境挺舒服的，背景音乐也刚好，坐着不知不觉两个多小时就过去了，很适合周末跟闺蜜来泡一下午",
    "整体氛围蛮松弛的，店员小姐姐人也很nice，中间卡壳了还会过来指导，完全不会有催促感，体验很加分",
    "店里各种手工小样琳琅满目的，看着就很治愈。而且位置蛮好找的，很适合坐下来安安静静做点喜欢的事",
    "空调很足，桌面也收拾得挺干净，坐下来以后就不太想继续逛了，慢慢做东西的感觉还挺舒服",
    "工具和材料摆得比较清楚，新手也不会太慌，反正不懂就问一下，整体体验下来还蛮顺的",
    "店里不会很吵，适合想放空的时候过来坐坐，做着做着整个人就慢下来了，挺难得的啊",
  ];

  const photoTemplates = [
    "做完赶紧拉着朋友拍了几张作品照片发朋友圈炫耀一下，感觉有被自己心灵手巧到哈",
    "拿回家摆在床头柜上当个小摆件还挺可爱的，自己亲手做出来的东西就是自带一层滤镜，怎么看怎么喜欢",
    "成品带走的时候店家还给包装了一下，拿在手里沉甸甸的很有成就感，赶紧用原相机记录一下今天的手作初体验",
    "拍照的时候才发现细节还挺多的，虽然不是那种完美作品，但就是有一点自己的小风格在里面",
    "成品拿在手里越看越顺眼，刚做完就忍不住找角度拍了几张，发给朋友看还被夸了一下哈哈",
    "带回去之后放在桌上也不突兀，偶尔看到会想起今天坐在店里慢慢做东西的那段时间",
  ];

  const moodTemplates = [
    "发出来也算给这次手作留个认真的记录吧，下次有空打算再过来挑战个稍微复杂点的款式",
    "算是给今天的生活加点小小的仪式感，以后想放空或者找地方发呆的时候，这地方肯定在我的首选清单里了",
    "这次体验直接入坑了，感觉以后每个周末都要多一个手工DIY的项目了，总体来说强推强推",
    "虽然中间一度想摆烂，但做完以后真的会有一点小骄傲，属于越看越觉得还不错的那种",
    "整个过程没什么压力，做完以后心情也变好了点，感觉偶尔认真完成一个小东西还挺治愈的啦",
    "这次算是给自己找了个不用一直刷手机的理由，慢慢做完以后还挺有满足感的啊",
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
    return ensureLocalReviewLength(randomItem(wildLocalReviewTemplates).replace(/\{project\}/g, safeProject));
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
