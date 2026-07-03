(function () {
  "use strict";

  const toneOpeners = {
    自然真实: [
      "今天来时里白造物体验了一下，整体感觉挺舒服。",
      "第一次来时里白造物做手工，比想象中更容易上手。",
      "这家手作店氛围很安静，坐下来慢慢做东西挺放松。",
    ],
    亲子体验: [
      "带孩子来时里白造物体验手作，孩子从选材料到完成都很投入。",
      "很适合亲子一起来的小店，孩子能自己动手完成作品。",
      "今天带小朋友来做手工，过程比较顺利，也很有参与感。",
    ],
    朋友打卡: [
      "和朋友一起来时里白造物打卡，整体体验比预期更轻松。",
      "适合朋友聚会的一家手作店，边聊天边做作品很舒服。",
      "和朋友周末来做手工，环境和氛围都挺适合拍照记录。",
    ],
    解压治愈: [
      "坐下来慢慢做手工真的挺解压，过程很适合放空一下。",
      "整个体验节奏不赶，慢慢完成作品的过程很治愈。",
      "很适合周末来放松的一家店，做完作品还挺有成就感。",
    ],
  };

  const projectDetails = {
    拼豆: "拼豆颜色选择很多，选图、配色和完成作品的过程都挺有意思。",
    石膏彩绘: "石膏彩绘图案选择比较丰富，上色过程很放松，成品也适合带回家摆放。",
    香薰蜡烛: "香薰蜡烛可以自己搭配味道和装饰，做出来很有纪念感。",
    中药香囊: "中药香囊的材料准备得比较齐全，做起来有参与感，也很适合当小礼物。",
    奶油胶: "奶油胶配件选择挺多，可以按自己的喜好搭配，成品拍照也很好看。",
    数字油画: "数字油画上手比较轻松，慢慢涂完很有成就感，适合安静坐一会儿。",
    亲子手作: "亲子手作项目比较适合孩子参与，过程中也有人提醒步骤和细节。",
    朋友聚会: "朋友聚会来这里很合适，项目选择多，大家可以一起做不同作品。",
  };

  const serviceLines = [
    "店员讲解很耐心，不懂的地方也会及时帮忙。",
    "工具和材料整理得比较清楚，体验过程很顺利。",
    "店里环境干净舒服，做完作品也很适合拍照。",
    "位置比较好找，整体体验轻松不赶时间。",
  ];

  const endingLines = [
    "做完以后很有成就感，下次有机会还会再来。",
    "适合朋友、情侣或亲子一起来体验，整体很推荐。",
    "成品可以带走，作为一份有纪念感的小礼物也不错。",
    "这次体验很轻松，适合周末来放松一下。",
  ];

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

  function generateLocalReview() {
    const project = elements.project.value || "手作";
    const tone = elements.tone.value || "自然真实";
    const keywords = elements.keywords.value.trim();
    const opener = randomItem(toneOpeners[tone] || toneOpeners.自然真实);
    const projectLine = projectDetails[project] || `这次体验的是${project}，整体过程比较轻松。`;
    const serviceLine = keywords ? `印象比较深的是${keywords}。` : randomItem(serviceLines);
    const endingLine = randomItem(endingLines);
    const review = `${opener}${projectLine}${serviceLine}${endingLine}`;
    elements.reviewText.innerText = review;
    setStatus("已生成随机评价，可按真实体验稍微修改后发布。");
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

  elements.aiBtn.addEventListener("click", generateLocalReview);
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
