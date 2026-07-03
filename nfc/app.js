(function () {
  "use strict";

  const DEEPSEEK_TIMEOUT_MS = 6500;

  const defaultKeywordGroups = [
    "颜色多，最后搭出来顺眼",
    "边角对齐花了点时间",
    "实物颜色比照片亮一点",
    "做了个简单款，没有太复杂",
    "朋友做得比我快",
    "小挂件放包上刚好",
  ];

  const localReviewOptions = {
    拼豆: [
      "颜色是真的多，最后随便搭了一套，出来效果反而顺眼。",
      "小豆子摆起来比看着费耐心，尤其边角要慢慢对。",
      "做了个简单款，没翻车，已经算满意。",
      "朋友做得比我快，我这边一直在找颜色。",
      "实物颜色比照片里亮一点，拍出来还可以。",
      "做快了容易歪，还是得慢慢摆。",
      "最后那个小挂件不大，挂包上刚好。",
      "边缘调整了几次，完成后看着顺眼多了。",
      "本来只是试一下，结果找颜色花了不少时间。",
      "小细节有点磨人，但做出来不会失望。",
      "没有选太复杂的图，简单款也够研究一会儿。",
      "颜色多到有点选择困难，随便搭一下也还行。",
      "手有点抖，摆歪了几颗，后面又调回来了。",
      "图案一点点出来的时候，感觉还蛮有意思。",
      "最后店员帮忙处理好，拿走比较省心。",
      "这个项目不难，就是急不来。",
      "做出来的小东西不大，但自己摆出来的感觉不一样。",
      "找颜色比想象中花时间。",
      "边角那里对了好久，最后还算整齐。",
      "颜色搭出来比预想顺眼。",
      "做了个小挂件，挂在包上不夸张。",
      "朋友说我做得太慢，但最后效果还可以。",
      "小豆子一颗颗摆上去，确实需要耐心。",
      "没想到简单图案也有不少细节。",
      "颜色比手机里看着更亮一点。",
      "做完之后拍了几张，实物还挺上镜。",
      "本来想随便做一个，结果还是认真调了半天边角。",
      "小图案看着简单，真摆起来才发现不能太急。",
      "完成后放桌上看了一会儿，还蛮顺眼。",
      "做的时候手上有事，反而容易安静下来。",
      "找颜色找了半天，最后搭出来没有翻车。",
      "选了个小款，时间刚好，不会太累。",
      "成型那一下还是有点小满足。",
      "不算难，但需要坐得住。",
      "我这个配色一开始不太确定，出来以后还行。",
      "朋友的图案比我的复杂，我先做了个简单的。",
      "中间拆掉重摆了一块，后面顺眼多了。",
      "做完拿在手里，比单看图片有质感一点。",
      "简单款适合先试试，至少不容易翻车。",
      "颜色选多了反而会乱，最后还是挑了少一点的配色。",
      "边缘如果摆歪会很明显，得慢慢调。",
      "最后出来的小东西比预想规整。",
      "店员最后帮忙熨好，省了自己处理的麻烦。",
      "拼的时候没觉得，做完看实物还挺有意思。",
      "找颜色的时候最花时间。",
      "做这个不能急，急了就容易摆错。",
      "最后那个颜色搭配比我想的好。",
      "我做得不算快，但完成后还挺满意。",
      "适合想安静做点东西的时候，不太吵。",
      "小颗粒摆多了会有点累，但完成后还行。",
      "选颜色的时候试了几套，最后这套最顺眼。",
      "本来以为会很快，结果细节花了不少时间。",
      "做完发现小挂件还挺实用。",
      "拍照的时候颜色比现场看着更明显。",
      "朋友在旁边一直催我快点，我还是慢慢摆完了。",
      "小细节需要耐心，适合不赶时间的时候做。",
      "最后拿到手的时候，比想象中规整。",
      "颜色一多就容易乱，挑少一点反而更好看。",
      "简单图案也能做出一点小成就感。",
      "整体不是很难，主要是要细心。",
      "做完的小东西留着当个小纪念还可以。",
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
        `这次做${project}步骤不算复杂，但自己动手做出来的感觉还是不一样。`,
        `${project}比我想象中更细致一点，做出来不算完美，但有点纪念感。`,
        `第一次尝试${project}，中间有点慢，但最后效果还算满意。`,
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
