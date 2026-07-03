(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 6500;

  const defaultKeywordGroups = [
    "带孩子来玩",
    "朋友一起坐会儿",
    "逛商场顺便体验",
    "不想一直逛街",
    "作品可以带走",
    "位置在圣名国际",
  ];

  const localReviewOptions = {
    dianping: [
      "带孩子来玩的，拼豆颜色挺多，孩子能坐住，做完的小作品也可以带走。",
      "在圣名国际逛街时看到的，项目还不少，这次先体验了拼豆。",
      "适合带小朋友来坐一会儿，大人也可以一起做，整体还可以。",
      "朋友一起去的，坐下来做个手作，比单纯逛街有意思。",
      "店里项目选择挺多，拼豆比较适合第一次体验。",
      "孩子自己选的图案，做完可以带走，体验还可以。",
      "位置比较好找，逛商场的时候顺便玩了一下。",
      "拼豆适合亲子一起做，不需要太复杂的基础。",
      "第一次带孩子体验这类手作，整体比较顺利。",
      "项目挺多的，这次做了拼豆，下次可以试试别的。",
    ],
    xiaohongshu: [
      "江油圣名国际这家手作店可以坐下来慢慢玩，拼豆、石膏、蜡烛这些项目都有。今天先体验了拼豆，做完的小作品可以带走。",
      "不想一直逛商场的话，可以找个地方坐下来做点手作。拼豆上手不难，适合朋友一起边做边聊。",
      "带孩子来做拼豆，孩子自己选图案，大人在旁边帮忙找颜色，整个过程比想象中更能坐得住。",
      "江油带娃又多了一个选择，逛商场的时候可以顺便来体验一下手作。",
      "朋友约着来做手作，这次先试了拼豆。店里项目不少，适合想找地方坐会儿的时候。",
    ],
    douyin: [
      "江油圣名国际这个手作店，带娃能坐得住。",
      "本来陪孩子玩，结果大人也跟着做起来了。",
      "不想逛街的时候，做个拼豆还挺合适。",
      "朋友一起做手作，比单纯喝奶茶有意思。",
      "拼豆这个项目，小朋友真的能安静坐一会儿。",
      "江油带娃可以试试这种手作体验。",
      "逛商场累了，坐下来做个小手作。",
      "第一次玩拼豆，比想象中容易上手。",
    ],
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
    copyStatus: $("copyStatus"),
  };

  function setStatus(message) {
    elements.copyStatus.textContent = message || "";
  }

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function hasAnyWord(text, words) {
    const value = String(text || "");
    return words.some((word) => value.includes(word));
  }

  function matchesLocalContext(review, context) {
    const hasChildInReview = hasAnyWord(review, ["孩子", "小朋友", "带娃", "亲子"]);
    const hasFriendInReview = hasAnyWord(review, ["朋友", "一起去", "一起做"]);
    const hasChildContext = hasAnyWord(context, ["孩子", "小朋友", "带娃", "亲子"]);
    const hasFriendContext = hasAnyWord(context, ["朋友", "闺蜜", "同学", "同事", "小聚", "同去"]);
    return (!hasChildInReview || hasChildContext) && (!hasFriendInReview || hasFriendContext);
  }

  function getFinalKeywords(rawKeywords) {
    const keywords = String(rawKeywords || "").trim();
    return keywords || randomItem(defaultKeywordGroups);
  }

  function generateLocalReview(platform, context) {
    const options = localReviewOptions[platform] || localReviewOptions.dianping;
    const matchedOptions = options.filter((review) => matchesLocalContext(review, context));
    const review = randomItem(matchedOptions.length > 0 ? matchedOptions : options);
    elements.reviewText.innerText = review;
    setStatus("已生成随机评价，可按真实体验稍微修改后发布。");
    return review;
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
    const finalKeywords = getFinalKeywords(elements.keywords.value);
    const payload = {
      platform: elements.platform.value || "dianping",
      project: elements.project.value || "手作",
      tone: elements.tone.value || "自然真实",
      keywords: finalKeywords,
    };

    generateLocalReview(payload.platform, `${payload.project} ${payload.tone} ${payload.keywords}`);
    elements.aiBtn.disabled = true;
    elements.aiBtn.innerText = "生成中...";
    setStatus("已先生成一条评价参考，正在继续优化文案。");

    try {
      const review = await requestDeepSeekReview(payload);
      elements.reviewText.innerText = review;
      setStatus("已生成评价，可按真实体验稍微修改后发布。");
    } catch (error) {
      setStatus("已生成随机评价，可按真实体验稍微修改后发布。");
    } finally {
      elements.aiBtn.disabled = false;
      elements.aiBtn.innerText = "随机生成评价";
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
})();
