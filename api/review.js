const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_PHOTO_TIPS = [
  "图1：作品或体验过程图。",
  "图2：门店环境或制作过程图。",
  "图3：朋友/亲子互动或完成作品图。",
];

const PLATFORM_CONFIG = {
  dianping: {
    label: "大众点评/美团",
    rule: [
      "30到80字。",
      "平实、简单，像普通消费点评。",
      "可以提位置、项目、孩子、朋友、体验时长。",
      "不要文艺，不要小红书腔，不要表情符号。",
      "不要写“种草”“打卡”。",
    ].join("\n"),
  },
  xiaohongshu: {
    label: "小红书",
    rule: [
      "60到140字。",
      "像生活笔记，可以有场景感。",
      "可以自然提江油、圣名国际、带娃、朋友、手作。",
      "不要夸张种草，不要写“宝藏小店”“必须冲”“绝绝子”。",
    ].join("\n"),
  },
  douyin: {
    label: "抖音",
    rule: [
      "15到50字。",
      "像视频标题或评论区文案。",
      "更口语，可以很短。",
      "不要写完整评价。",
    ].join("\n"),
  },
};

const CONSUMER_ANGLES = [
  "带孩子来玩",
  "朋友一起坐会儿",
  "逛商场顺便体验",
  "不想一直逛街",
  "找个地方休息一下",
  "孩子能坐得住",
  "大人也能一起参与",
  "项目选择比较多",
  "拼豆颜色选择多",
  "作品可以带走",
  "适合亲子",
  "适合朋友小聚",
  "适合拍照记录",
  "位置在圣名国际",
  "店里可以坐下来慢慢做",
  "比单纯逛街有意思",
  "下次想试别的项目",
  "适合生日/团建先了解一下",
];

const ABSOLUTE_BAD_WORDS = [
  "全江油第一",
  "无敌",
  "离谱",
  "封神",
  "性价比天花板",
  "老板人超好",
  "老师特别专业",
  "一对一指导",
  "全程陪同",
  "玩到不想走",
  "来了就不想走",
  "好评送",
  "好评返",
  "商家让我",
  "为了礼品",
  "复制粘贴",
  "AI生成",
  "模板",
  "好评",
  "五星",
  "返现",
  "必须评价",
  "评价几个送几个",
  "自己熨烫",
  "自己上手熨烫",
  "教我怎么熨烫",
  "教我们怎么熨烫",
  "学习熨烫",
  "熨烫过程很有趣",
  "自己把作品熨好",
];

const DEFAULT_BANNED_WORDS = [
  "边角",
  "对齐",
  "颜色亮",
  "亮一点",
  "质感",
  "顺眼",
  "没翻车",
  "成型",
  "成型那一刻",
  "有成就感",
  "细节到位",
  "眼睛酸",
  "费眼睛",
  "拍出来好看",
  "挂包上",
  "不知不觉",
  "进入状态",
  "越做越顺",
  "解压",
  "治愈",
  "天花板",
  "宝藏",
  "必须冲",
  "闭眼入",
  "绝绝子",
  "YYDS",
];

const TIME_WORDS = ["周末", "假期", "下班后", "放学后", "晚上", "下午"];

const DIANPING_FALLBACKS = [
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
];

const XIAOHONGSHU_FALLBACKS = [
  "江油圣名国际这家手作店可以坐下来慢慢玩，拼豆、石膏、蜡烛这些项目都有。今天先体验了拼豆，做完的小作品可以带走。",
  "不想一直逛商场的话，可以找个地方坐下来做点手作。拼豆上手不难，适合朋友一起边做边聊。",
  "带孩子来做拼豆，孩子自己选图案，大人在旁边帮忙找颜色，整个过程比想象中更能坐得住。",
  "江油带娃又多了一个选择，逛商场的时候可以顺便来体验一下手作。",
  "朋友约着来做手作，这次先试了拼豆。店里项目不少，适合想找地方坐会儿的时候。",
];

const DOUYIN_FALLBACKS = [
  "江油圣名国际这个手作店，带娃能坐得住。",
  "本来陪孩子玩，结果大人也跟着做起来了。",
  "不想逛街的时候，做个拼豆还挺合适。",
  "朋友一起做手作，比单纯喝奶茶有意思。",
  "拼豆这个项目，小朋友真的能安静坐一会儿。",
  "江油带娃可以试试这种手作体验。",
  "逛商场累了，坐下来做个小手作。",
  "第一次玩拼豆，比想象中容易上手。",
];

const FALLBACKS_BY_PLATFORM = {
  dianping: DIANPING_FALLBACKS,
  xiaohongshu: XIAOHONGSHU_FALLBACKS,
  douyin: DOUYIN_FALLBACKS,
};

const SIMILARITY_KEYWORDS = [
  "带孩子",
  "孩子",
  "朋友",
  "逛商场",
  "圣名国际",
  "坐一会儿",
  "手作",
  "拼豆",
  "项目",
  "可以带走",
  "大人",
  "亲子",
  "拍照",
  "小作品",
  "别的项目",
  "团建",
  "生日",
];

let recentReviews = [];

function json(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(statusCode).json(payload);
}

function normalizeBaseUrl(value) {
  return String(value || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, "");
}

function cleanText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizePlatform(value) {
  const platform = String(value || "").trim();
  if (platform === "meituan") return "dianping";
  return PLATFORM_CONFIG[platform] ? platform : "dianping";
}

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function hasAnyWord(text, words) {
  const safeText = String(text || "");
  return words.some((word) => safeText.includes(word));
}

function pickMany(items, min, max) {
  const count = min + Math.floor(Math.random() * (max - min + 1));
  const pool = [...items];
  const picked = [];
  while (picked.length < count && pool.length > 0) {
    const index = Math.floor(Math.random() * pool.length);
    picked.push(pool[index]);
    pool.splice(index, 1);
  }
  return picked;
}

function isChildContext(project, tone, keywords) {
  return hasAnyWord(`${project} ${tone} ${keywords}`, ["亲子", "孩子", "小朋友", "儿子", "女儿", "带娃"]);
}

function isFriendContext(tone, keywords) {
  return hasAnyWord(`${tone} ${keywords}`, ["朋友", "闺蜜", "同学", "同事", "小聚"]);
}

function isGroupContext(keywords) {
  return hasAnyWord(keywords, ["生日", "团建", "包场", "活动"]);
}

function filterConsumerAngles(project, tone, keywords) {
  const childContext = isChildContext(project, tone, keywords);
  const friendContext = isFriendContext(tone, keywords);
  const groupContext = isGroupContext(keywords);

  return CONSUMER_ANGLES.filter((angle) => {
    if (["带孩子来玩", "孩子能坐得住", "大人也能一起参与", "适合亲子"].includes(angle)) {
      return childContext;
    }
    if (["朋友一起坐会儿", "适合朋友小聚"].includes(angle)) {
      return friendContext;
    }
    if (angle === "适合生日/团建先了解一下") {
      return groupContext;
    }
    return true;
  });
}

function pickConsumerAngles(project, tone, keywords) {
  const candidates = filterConsumerAngles(project, tone, keywords);
  return pickMany(candidates.length > 0 ? candidates : CONSUMER_ANGLES, 1, 2);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text, word) {
  return (String(text || "").match(new RegExp(escapeRegExp(word), "g")) || []).length;
}

function parseJsonContent(content) {
  const text = String(content || "").trim();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch (error) {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return {};
    try {
      return JSON.parse(match[0]);
    } catch (innerError) {
      return {};
    }
  }
}

function hasAbsoluteBadWords(text) {
  return ABSOLUTE_BAD_WORDS.some((word) => String(text || "").includes(word));
}

function hasDefaultBannedWords(text, keywords) {
  const safeText = String(text || "");
  const safeKeywords = String(keywords || "");
  return DEFAULT_BANNED_WORDS.some((word) => safeText.includes(word) && !safeKeywords.includes(word));
}

function hasUnprovidedTimeWords(text, keywords) {
  const safeText = String(text || "");
  const safeKeywords = String(keywords || "");
  return TIME_WORDS.some((word) => safeText.includes(word) && !safeKeywords.includes(word));
}

function hasUnprovidedRelationshipWords(text, project, tone, keywords, consumerAngles) {
  const safeText = String(text || "");
  const providedText = `${project} ${tone} ${keywords} ${consumerAngles.join(" ")}`;
  const childProvided = hasAnyWord(providedText, ["亲子", "孩子", "小朋友", "儿子", "女儿", "带娃"]);
  const friendProvided = hasAnyWord(providedText, ["朋友", "闺蜜", "同学", "同事", "小聚"]);
  const childInReview = hasAnyWord(safeText, ["孩子", "小朋友", "儿子", "女儿", "带娃", "亲子"]);
  const friendInReview = hasAnyWord(safeText, ["朋友", "闺蜜", "同学", "同事"]);
  return (childInReview && !childProvided) || (friendInReview && !friendProvided);
}

function hasUnprovidedServiceWords(text, project, tone, keywords, consumerAngles) {
  const safeText = String(text || "");
  const providedText = `${project} ${tone} ${keywords} ${consumerAngles.join(" ")}`;
  const serviceProvided = hasAnyWord(providedText, ["服务", "店员", "老板", "老师", "指导", "讲解", "帮忙"]);
  const serviceInReview = hasAnyWord(safeText, ["服务", "店员", "老板", "老师", "指导", "讲解", "态度"]);
  const pinDouProcessing = String(project || "").includes("拼豆") && hasAnyWord(safeText, ["熨", "处理成品", "帮忙处理"]);
  return serviceInReview && !serviceProvided && !pinDouProcessing;
}

function hasUnsupportedPinDouProcessing(text, project, consumerAngles) {
  const safeText = String(text || "");
  if (!hasAnyWord(safeText, ["熨", "处理成品", "帮忙处理"])) return false;
  return !String(project || "").includes("拼豆");
}

function violatesPlatformLength(text, platform) {
  const length = Array.from(String(text || "")).length;
  if (platform === "douyin") return length < 10 || length > 60;
  if (platform === "xiaohongshu") return length < 40 || length > 160;
  return length < 20 || length > 100;
}

function violatesPlatformStyle(text, platform) {
  const safeText = String(text || "");
  if (platform === "dianping" && hasAnyWord(safeText, ["种草", "打卡", "姐妹", "氛围感"])) return true;
  if (platform === "douyin" && safeText.split(/[。！？!?]/).filter(Boolean).length > 3) return true;
  return false;
}

function hasRepeatedDirection(text) {
  const safeText = String(text || "");
  const groups = [
    ["成品", "颜色", "拼豆制作", "边角", "质感"],
    ["环境", "过程", "成品", "推荐"],
  ];
  return groups.some((group) => group.filter((word) => safeText.includes(word)).length >= 3);
}

function keywordSignature(text) {
  return SIMILARITY_KEYWORDS.filter((keyword) => String(text || "").includes(keyword));
}

function isTooSimilarToRecent(text) {
  const safeText = String(text || "").trim();
  if (recentReviews.includes(safeText)) return true;
  const signature = keywordSignature(safeText);
  if (signature.length === 0) return false;
  return recentReviews.some((review) => {
    const oldSignature = keywordSignature(review);
    const overlap = signature.filter((keyword) => oldSignature.includes(keyword)).length;
    return overlap >= 4;
  });
}

function getInvalidReason({ review, platform, project, tone, keywords, consumerAngles, checkSimilarity = true }) {
  const text = String(review || "").trim();
  if (!text) return "empty";
  if (hasAbsoluteBadWords(text)) return "absolute_bad_words";
  if (hasDefaultBannedWords(text, keywords)) return "default_banned_words";
  if (hasUnprovidedTimeWords(text, keywords)) return "time_words";
  if (hasUnprovidedRelationshipWords(text, project, tone, keywords, consumerAngles)) return "relationship_words";
  if (hasUnprovidedServiceWords(text, project, tone, keywords, consumerAngles)) return "service_words";
  if (hasUnsupportedPinDouProcessing(text, project, consumerAngles)) return "unsupported_processing";
  if (violatesPlatformLength(text, platform)) return "platform_length";
  if (violatesPlatformStyle(text, platform)) return "platform_style";
  if (hasRepeatedDirection(text)) return "repeated_direction";
  if (countOccurrences(text, "成品") > 1) return "too_many_chengpin";
  if (countOccurrences(text, "颜色") > 2) return "too_many_color";
  if (checkSimilarity && isTooSimilarToRecent(text)) return "similar";
  return "";
}

function recordRecentReview(review) {
  const text = String(review || "").trim();
  if (!text) return;
  recentReviews.push(text);
  if (recentReviews.length > 20) {
    recentReviews = recentReviews.slice(recentReviews.length - 20);
  }
}

function normalizePhotoTips() {
  return DEFAULT_PHOTO_TIPS;
}

function getFallbacks(platform) {
  return FALLBACKS_BY_PLATFORM[platform] || DIANPING_FALLBACKS;
}

function makePlatformFallback({ platform, project, tone, keywords, consumerAngles }) {
  const options = getFallbacks(platform);

  for (let index = 0; index < 40; index += 1) {
    const candidate = randomItem(options);
    const invalidReason = getInvalidReason({
      review: candidate,
      platform,
      project,
      tone,
      keywords,
      consumerAngles,
      checkSimilarity: true,
    });
    if (!invalidReason) return candidate;
  }

  for (let index = 0; index < 40; index += 1) {
    const candidate = randomItem(options);
    const invalidReason = getInvalidReason({
      review: candidate,
      platform,
      project,
      tone,
      keywords,
      consumerAngles,
      checkSimilarity: false,
    });
    if (!invalidReason) return candidate;
  }

  return options[0];
}

function buildSystemPrompt() {
  return `
你是一个真实顾客评价整理助手，不是商家宣传文案助手。

DeepSeek 不负责自由创作，只能根据后端提供的 platform、project、tone、keywords、consumerAngle 生成对应平台的一条自然评价。

强制规则：
1. 不要主动写门店名“时里白造物”，除非平台是大众点评/美团且内容自然需要。
2. 不要每条都写拼豆制作细节。
3. 不要每条都写“成品”。
4. 不要每条都写“颜色”。
5. 不要写完整体验流程，只围绕给定的 1 到 2 个消费场景角度。
6. 不要写“边角、对齐、颜色亮、亮一点、质感、顺眼、没翻车、成型、有成就感、眼睛酸、费眼睛、拍出来好看、挂包上、进入状态、越做越顺、解压、治愈”等词，除非用户关键词明确提供。
7. 不要写诱导评价、返现、五星、好评、复制粘贴、模板。
8. 拼豆不能写顾客自己熨烫。
9. 不要默认写周末、假期、下午、晚上、下班后、放学后。
10. 不要主动写服务、店员、老板、老师、指导、讲解，除非用户关键词明确提供；拼豆只允许偶尔写店员处理成品。

输出严格 JSON：
{
  "review": "评价正文",
  "photoTips": [
    "图1：作品或体验过程图。",
    "图2：门店环境或制作过程图。",
    "图3：朋友/亲子互动或完成作品图。"
  ],
  "debug": {
    "platform": "",
    "consumerAngle": ""
  }
}
`.trim();
}

function buildUserPrompt({ platform, project, tone, keywords, consumerAngles }) {
  const config = PLATFORM_CONFIG[platform] || PLATFORM_CONFIG.dianping;
  return `
平台：${platform}（${config.label}）
平台写法规则：
${config.rule}

体验项目：${project}
评价语气：${tone}
顾客关键词：${keywords || "无"}
本次消费场景角度：${consumerAngles.join("、")}

请只围绕本次消费场景角度写。
不要加入没有提供的信息。
不要写工艺细节总结。
不要写商家广告语。
`.trim();
}

async function getBody(req) {
  if (req.body && typeof req.body === "object") return req.body;
  if (typeof req.body === "string") {
    try {
      return JSON.parse(req.body);
    } catch (error) {
      return {};
    }
  }
  return {};
}

async function requestDeepSeekReview({ apiKey, baseUrl, model, signal, platform, project, tone, keywords, consumerAngles }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: buildSystemPrompt() },
        { role: "user", content: buildUserPrompt({ platform, project, tone, keywords, consumerAngles }) },
      ],
      temperature: 0.5,
      max_tokens: 500,
      response_format: { type: "json_object" },
    }),
    signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    console.error("DeepSeek request failed", response.status, raw.slice(0, 500));
    throw new Error("DeepSeek request failed");
  }

  const completion = JSON.parse(raw);
  const content = completion?.choices?.[0]?.message?.content || "{}";
  const parsed = parseJsonContent(content);
  return cleanText(parsed.review, "", 240);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey || apiKey.includes("your-deepseek-api-key")) {
    return json(res, 500, { error: "Missing DEEPSEEK_API_KEY" });
  }

  const body = await getBody(req);
  const platform = normalizePlatform(body.platform);
  const project = cleanText(body.project, "拼豆", 24);
  const tone = cleanText(body.tone, "自然真实", 24);
  const keywords = cleanText(body.keywords, "", 120);
  const consumerAngles = pickConsumerAngles(project, tone, keywords);
  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);
  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let review = "";
  let invalidReason = "";

  try {
    review = await requestDeepSeekReview({
      apiKey,
      baseUrl,
      model,
      signal: controller.signal,
      platform,
      project,
      tone,
      keywords,
      consumerAngles,
    });
    invalidReason = getInvalidReason({ review, platform, project, tone, keywords, consumerAngles });

    if (invalidReason === "similar") {
      const retryAngles = pickConsumerAngles(project, tone, keywords);
      const retryReview = await requestDeepSeekReview({
        apiKey,
        baseUrl,
        model,
        signal: controller.signal,
        platform,
        project,
        tone,
        keywords,
        consumerAngles: retryAngles,
      });
      const retryInvalidReason = getInvalidReason({
        review: retryReview,
        platform,
        project,
        tone,
        keywords,
        consumerAngles: retryAngles,
      });
      if (!retryInvalidReason) {
        review = retryReview;
        consumerAngles.splice(0, consumerAngles.length, ...retryAngles);
        invalidReason = "";
      } else {
        invalidReason = retryInvalidReason;
      }
    }

    if (invalidReason) {
      review = makePlatformFallback({ platform, project, tone, keywords, consumerAngles });
    }

    recordRecentReview(review);

    return json(res, 200, {
      review,
      photoTips: normalizePhotoTips(),
      debug: {
        platform,
        consumerAngle: consumerAngles.join("、"),
      },
    });
  } catch (error) {
    console.error("Review API error", error);
    review = makePlatformFallback({ platform, project, tone, keywords, consumerAngles });
    recordRecentReview(review);
    return json(res, 200, {
      review,
      photoTips: normalizePhotoTips(),
      debug: {
        platform,
        consumerAngle: consumerAngles.join("、"),
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
