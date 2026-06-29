"use strict";

const starts = [
  "今天来体验了一下，整体感觉很不错～",
  "朋友推荐来的，确实是很适合放松的小店。",
  "第一次来做手工，本来担心自己不会，结果体验感很好。",
  "这家店还挺宝藏的，环境舒服，氛围也很安静。",
  "周末来这里坐一会儿做手工，真的挺治愈的。",
];

const projects = [
  "拼豆图案选择很多，颜色也很丰富，从小挂件到大一点的作品都有。",
  "店里的手作项目挺多的，拼豆、香薰蜡烛、石膏彩绘这些都可以体验。",
  "材料和工具准备得比较齐全，做起来很方便。",
  "豆子颜色很多，成品做出来比想象中还好看。",
  "可以选择的图案挺丰富，适合不同年龄段的人来玩。",
];

const services = [
  "店员很耐心，不懂的地方都会帮忙。",
  "老板服务态度很好，会一步一步教新手操作。",
  "过程中有人指导，不用担心自己做不好。",
  "工具整理得很干净，体验过程很顺利。",
  "有不懂的细节也会帮忙调整，整体很省心。",
];

const endings = [
  "做完很有成就感，下次还会再来。",
  "挺适合朋友、情侣、亲子一起来玩，值得推荐。",
  "价格也比较实惠，整体体验很好。",
  "已经推荐给朋友了，有机会还会再来。",
  "很适合消磨时间，也适合做一份有纪念感的小礼物。",
];

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function createReview() {
  return [
    randomItem(starts),
    randomItem(projects),
    randomItem(services),
    randomItem(endings),
  ].join("\n");
}

function setStatus(message) {
  const status = document.querySelector("#copy-status");
  if (status) status.textContent = message;
}

function generateReview() {
  const review = document.querySelector("#review");
  if (!review) return;
  review.textContent = createReview();
  setStatus("");
}

function fallbackCopy(text) {
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  textarea.style.top = "0";
  document.body.appendChild(textarea);
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    textarea.remove();
  }
}

function selectReviewText() {
  const review = document.querySelector("#review");
  if (!review || !window.getSelection) return;

  const range = document.createRange();
  range.selectNodeContents(review);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
  review.focus();
}

async function copyReview() {
  const review = document.querySelector("#review");
  const text = review?.textContent?.trim() || "";
  if (!text || text === "点击下方按钮，随机生成一条评价。") {
    generateReview();
    setStatus("已先为你生成一条评价，再点一次即可复制。");
    return;
  }

  try {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else if (!fallbackCopy(text)) {
      throw new Error("copy failed");
    }
    setStatus("已复制，可以去粘贴评价啦～");
  } catch {
    selectReviewText();
    setStatus("复制失败，已帮你选中文字，请按 Cmd/Ctrl+C 手动复制。");
  }
}

document.addEventListener("DOMContentLoaded", () => {
  document.querySelector("#generate-review-button")?.addEventListener("click", generateReview);
  document.querySelector("#copy-review-button")?.addEventListener("click", copyReview);
});
