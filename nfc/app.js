(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 6500;

  const defaultKeywordGroups = [
    "颜色选择多，做起来解压，成品好看",
    "选图案纠结了一会儿，做出来比想象中可爱",
    "刚开始怕手残，后面慢慢进入状态",
    "适合安静坐下来做点东西，成品有纪念感",
    "制作过程不赶，完成后挺有成就感",
  ];

  const localReviewOptions = {
    拼豆: [
      "拼豆比想象中更容易进入状态，颜色太多反而纠结了好一会儿。慢慢把图案拼出来的过程挺解压，最后成品拿到手的时候，比图片上看着更可爱。",
      "刚开始还担心自己没耐心，结果拼着拼着就进入状态了。选颜色和调整细节的时候挺有意思，最后做出来的小东西可以带走，感觉还蛮有成就感。",
      "本来只是想随便体验一下，没想到拼豆还挺上头的。图案选了半天，颜色也纠结了半天，最后做出来效果比预想好，拿到成品的时候很开心。",
      "第一次认真拼这种小图案，过程比想象中慢一点，但也正好让人静下来。颜色选择很多，做完之后看着自己的成品，还是有点小成就感的。",
    ],
    石膏彩绘: [
      "石膏彩绘比想象中更好上手，刚开始不知道怎么配色，涂着涂着就有思路了。最后出来的效果还挺完整，摆在桌面上也不会突兀。",
      "选石膏款式的时候纠结了一会儿，最后挑了一个比较顺眼的。上色过程不赶，慢慢把细节补完之后，成品看着比预想好很多。",
    ],
    香薰蜡烛: [
      "香薰蜡烛做起来比想象中更有参与感，选味道和搭配装饰的时候挺有意思。最后成品拿在手里，有种自己认真完成了一件小东西的感觉。",
      "本来只是想试试香薰蜡烛，结果搭配味道的时候还挺投入。成品出来之后比想象中精致，放在房间里也挺合适。",
    ],
    中药香囊: [
      "中药香囊做起来很安静，慢慢挑材料、装袋、整理形状，节奏刚刚好。成品不大，但拿在手里还挺有纪念感。",
      "第一次做中药香囊，材料的味道闻起来很舒服。过程不复杂，但自己一步步做完之后，感觉比直接买一个更有意思。",
    ],
    奶油胶: [
      "奶油胶的配件真的容易让人选择困难，挑来挑去才定下来。挤胶和摆装饰的过程挺有意思，最后成品比一开始想的更可爱。",
      "做奶油胶的时候有点像在搭一个小场景，配件摆哪里都要纠结一下。完成之后拍照很好看，拿回去也挺有成就感。",
    ],
    数字油画: [
      "数字油画适合慢慢坐下来画，刚开始觉得格子很多，画着画着反而安静下来了。颜色一层层填满之后，成品效果比想象中明显。",
      "第一次画数字油画，过程比想象中需要耐心，但不会觉得难。慢慢把空白填起来的时候挺解压，最后整体效果也还不错。",
    ],
  };

  const $ = (id) => document.getElementById(id);

  const elements = {
    project: $("project"),
    tone: $("tone"),
    keywords: $("keywords"),
    reviewText: $("reviewText"),
    aiBtn: $("aiBtn"),
    copyReviewButton: $("copyReviewButton"),
    stickyCopyReviewButton: $("stickyCopyReviewButton"),
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

  function randomItem(items) {
    return items[Math.floor(Math.random() * items.length)];
  }

  function getFinalKeywords(rawKeywords) {
    const keywords = String(rawKeywords || "").trim();
    return keywords || randomItem(defaultKeywordGroups);
  }

  function generateLocalReview(project) {
    const options =
      localReviewOptions[project] || [
        `这次做${project}比想象中更有意思，步骤不复杂，但需要一点耐心。慢慢完成之后，成品拿在手里还是挺有纪念感的。`,
        `原本只是想找个地方坐一会儿，没想到${project}做起来还挺投入。过程不赶，完成后看着自己的作品，感觉比单纯买一个东西更特别。`,
        `第一次尝试${project}，刚开始有点没思路，做着做着就顺了。最后出来的效果比预期好，适合想安静做点东西的时候来体验。`,
      ];
    const review = randomItem(options);
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
      project: elements.project.value || "手作",
      tone: elements.tone.value || "自然真实",
      keywords: finalKeywords,
    };

    generateLocalReview(payload.project);
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

  function openWifi() {
    elements.wifiModal.classList.add("is-open");
    elements.wifiModal.setAttribute("aria-hidden", "false");
  }

  function closeWifi() {
    elements.wifiModal.classList.remove("is-open");
    elements.wifiModal.setAttribute("aria-hidden", "true");
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
  elements.openWifiCardButton.addEventListener("click", openWifi);
  elements.closeWifiButton.addEventListener("click", closeWifi);
  elements.wifiModal.addEventListener("click", (event) => {
    if (event.target === elements.wifiModal) closeWifi();
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeWifi();
  });
})();
