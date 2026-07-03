(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 6500;

  const defaultKeywordGroups = [
    "颜色选择多，成品看着顺眼",
    "做了简单小图案，细节比预想多",
    "想安静坐一会儿，最后成品还可以",
    "颜色搭配意外还行",
    "成品适合拍照，下次想试复杂一点的图",
  ];

  const localReviewOptions = {
    拼豆: [
      "颜色确实挺多，挑的时候有点选择困难。最后做了个小图案，没翻车。",
      "拼豆比想象中费眼睛一点，但图案出来的时候还是挺有意思的。",
      "做了个简单款，小豆子一颗颗摆上去还挺需要耐心。",
      "成品小小一个，挂包上应该还挺合适。比直接买现成的有意思。",
      "一开始没太会配色，后来随便搭了一下，出来效果居然还行。",
      "朋友做得比我快，我这边一直在调整边角。最后成品也算满意。",
      "这个项目适合慢慢做，急着弄反而容易摆歪。",
      "拼到后面会有点专注，图案一点点出来的时候还挺爽。",
      "选了个不复杂的图案，成品出来比我预想的规整一点。",
      "小细节有点磨人，不过完成之后看着还挺顺眼。",
      "本来只是试一下，结果做完还想再试个复杂点的图。",
      "颜色比照片里看着更亮，成品拍出来还可以。",
      "没有想象中难，就是需要耐心。最后店员帮忙处理好成品，可以直接拿走。",
      "做完才发现拼豆挺适合放空的，手上有事做，脑子反而安静一点。",
      "小图案看着简单，真摆起来还是要慢慢对齐。",
    ],
    石膏彩绘: [
      "石膏彩绘比想象中更好上手，刚开始不知道怎么配色，涂着涂着就有思路了。最后出来的效果还挺完整，摆在桌面上也不会突兀。",
      "选石膏款式的时候纠结了一会儿，最后挑了一个比较顺眼的。上色过程不赶，慢慢把细节补完之后，成品看着比预想好很多。",
      "石膏彩绘最花时间的反而是想颜色，真正开始涂以后就顺了。做完之后看着自己的小摆件，感觉还挺像那么回事。",
      "本来担心涂得不均匀，后来发现慢慢补细节就好。成品不是完美那种，但自己做出来的感觉还是不一样。",
    ],
    香薰蜡烛: [
      "香薰蜡烛做起来比想象中更有参与感，选味道和搭配装饰的时候挺有意思。最后成品拿在手里，有种自己认真完成了一件小东西的感觉。",
      "本来只是想试试香薰蜡烛，结果搭配味道的时候还挺投入。成品出来之后比想象中精致，放在房间里也挺合适。",
      "做香薰蜡烛的时候最纠结的是味道和装饰怎么配，选完以后反而很顺。最后出来的小蜡烛看着挺舒服。",
      "香薰蜡烛不算复杂，但每一步都能自己参与。做好以后闻着味道还可以，放着也算一个小纪念。",
    ],
    中药香囊: [
      "中药香囊做起来很安静，慢慢挑材料、装袋、整理形状，节奏刚刚好。成品不大，但拿在手里还挺有纪念感。",
      "第一次做中药香囊，材料的味道闻起来很舒服。过程不复杂，但自己一步步做完之后，感觉比直接买一个更有意思。",
      "香囊做起来不是很难，主要是慢慢搭配材料。味道闻起来挺自然，做完之后放包里也合适。",
      "中药香囊这个项目比较慢，不是很热闹，但适合安静做一会儿。最后的小袋子看着还挺耐看。",
    ],
    奶油胶: [
      "奶油胶的配件真的容易让人选择困难，挑来挑去才定下来。挤胶和摆装饰的过程挺有意思，最后成品比一开始想的更可爱。",
      "做奶油胶的时候有点像在搭一个小场景，配件摆哪里都要纠结一下。完成之后拍照很好看，拿回去也挺有成就感。",
      "奶油胶看着简单，实际摆配件的时候还挺考验审美。中间挪了几次位置，最后出来的效果比随便摆好很多。",
      "配件太多会让人选半天，最后还是按自己喜欢的颜色来。做完拍出来挺可爱，拿回去放桌面上也合适。",
    ],
    数字油画: [
      "数字油画适合慢慢坐下来画，刚开始觉得格子很多，画着画着反而安静下来了。颜色一层层填满之后，成品效果比想象中明显。",
      "第一次画数字油画，过程比想象中需要耐心，但不会觉得难。慢慢把空白填起来的时候挺解压，最后整体效果也还不错。",
      "数字油画最开始看着有点密，画几块之后就顺了。等颜色慢慢铺满，画面会比刚开始有变化很多。",
      "这个项目不需要太多技巧，就是要坐得住。慢慢把编号填完以后，成品看着还挺完整。",
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
