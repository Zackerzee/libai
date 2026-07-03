(function () {
  "use strict";

  const PHOTO_TIPS = [
    "图1：作品成品图，尽量拍清楚细节。",
    "图2：制作过程图，体现手作体验感。",
    "图3：门店环境 / 朋友互动 / 亲子互动图。",
  ];

  const localReviews = [
    "第一次来里白造物体验拼豆，颜色选择很多，过程也挺解压。店员会讲解步骤，最后成品做出来很有成就感，适合周末和朋友一起过来坐一会儿。",
    "带孩子来做了一次手作，孩子从选图到完成都很投入。店里工具准备得比较齐全，颜色分类清楚，遇到不会的地方也有人帮忙，整体体验很省心。",
    "环境挺舒服的一家手作店，项目选择比想象中丰富。今天做的作品可以带走，也很适合拍照记录，做完之后很有纪念感。",
    "和朋友来里白造物打卡，拼豆颜色很多，慢慢做的过程很治愈。店员态度也不错，会提醒一些细节，成品比想象中好看。",
    "本来担心自己手残，实际体验下来还挺容易上手。店里氛围安静，适合放松，也适合做一份小礼物送人。",
    "亲子体验感很好，孩子能自己动手选颜色和做图案。过程中店员会帮忙检查和熨烫，做完的小作品孩子很喜欢。",
    "店在圣名国际购物广场，位置比较好找。手作项目挺多，拼豆、石膏彩绘、香薰蜡烛都可以体验，适合朋友聚会。",
    "今天做手工整体很顺利，材料和工具都整理得很清楚。做完拍照也好看，感觉是一次挺轻松的体验。",
  ];

  const $ = (id) => document.getElementById(id);

  const elements = {
    project: $("project"),
    tone: $("tone"),
    keywords: $("keywords"),
    reviewText: $("reviewText"),
    photoTips: $("photoTips"),
    aiBtn: $("aiBtn"),
    copyReviewButton: $("copyReviewButton"),
    stickyCopyReviewButton: $("stickyCopyReviewButton"),
    copyPhotoTipsButton: $("copyPhotoTipsButton"),
    localReviewButton: $("localReviewButton"),
    copyPhoneButton: $("copyPhoneButton"),
    copyWifiButton: $("copyWifiButton"),
    openWifiCardButton: $("openWifiCardButton"),
    closeWifiButton: $("closeWifiButton"),
    wifiModal: $("wifiModal"),
    copyStatus: $("copyStatus"),
  };

  function setStatus(message) {
    elements.copyStatus.textContent = message || "";
  }

  function setPhotoTips(tips) {
    const safeTips = Array.isArray(tips) && tips.length > 0 ? tips.slice(0, 3) : PHOTO_TIPS;
    elements.photoTips.replaceChildren();

    for (const tip of safeTips) {
      const li = document.createElement("li");
      li.textContent = String(tip || "").trim();
      elements.photoTips.appendChild(li);
    }
  }

  function generateLocalReview() {
    const review = localReviews[Math.floor(Math.random() * localReviews.length)];
    elements.reviewText.innerText = review;
    setPhotoTips(PHOTO_TIPS);
    setStatus("已生成本地随机评价，可按真实体验稍微修改后发布。");
  }

  async function requestAIReview(payload) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch("/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.error || "生成失败");
      }
      return data;
    } finally {
      window.clearTimeout(timeout);
    }
  }

  async function generateAIReview() {
    elements.aiBtn.disabled = true;
    elements.aiBtn.innerText = "生成中...";
    setStatus("正在生成评价，请稍等。");

    const payload = {
      project: elements.project.value,
      tone: elements.tone.value,
      keywords: elements.keywords.value.trim(),
    };

    try {
      const data = await requestAIReview(payload);
      elements.reviewText.innerText = data.review || "";
      setPhotoTips(data.photoTips);
      setStatus("已生成评价。发布前请根据真实体验检查并补充细节。");
    } catch (error) {
      generateLocalReview();
      setStatus("AI 生成暂时不可用，已自动切换成本地随机评价。");
    } finally {
      elements.aiBtn.disabled = false;
      elements.aiBtn.innerText = "AI生成评价";
    }
  }

  function getPhotoTipsText() {
    return Array.from(elements.photoTips.querySelectorAll("li"))
      .map((li) => li.textContent.trim())
      .filter(Boolean)
      .join("\n");
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

  function openWifi() {
    elements.wifiModal.classList.add("is-open");
    elements.wifiModal.setAttribute("aria-hidden", "false");
  }

  function closeWifi() {
    elements.wifiModal.classList.remove("is-open");
    elements.wifiModal.setAttribute("aria-hidden", "true");
  }

  elements.aiBtn.addEventListener("click", generateAIReview);
  elements.localReviewButton.addEventListener("click", generateLocalReview);
  elements.copyReviewButton.addEventListener("click", () => {
    copyText(elements.reviewText.innerText, "已复制，可以去点评/小红书粘贴啦");
  });
  elements.stickyCopyReviewButton.addEventListener("click", () => {
    copyText(elements.reviewText.innerText, "已复制，可以去点评/小红书粘贴啦");
  });
  elements.copyPhotoTipsButton.addEventListener("click", () => {
    copyText(getPhotoTipsText(), "3张图要求已复制");
  });
  elements.copyPhoneButton.addEventListener("click", () => {
    copyText("19949539970", "电话已复制");
  });
  elements.copyWifiButton.addEventListener("click", () => {
    copyText("88888888", "WiFi密码已复制");
  });
  elements.openWifiCardButton.addEventListener("click", openWifi);
  elements.closeWifiButton.addEventListener("click", closeWifi);
  elements.wifiModal.addEventListener("click", (event) => {
    if (event.target === elements.wifiModal) closeWifi();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWifi();
  });
})();
