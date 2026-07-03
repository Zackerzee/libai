const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_PHOTO_TIPS = [
  "图1：作品成品图，拍清楚细节。",
  "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
  "图3：门店环境、朋友互动或亲子互动图。",
];

const DEFAULT_KEYWORD_GROUPS = [
  "颜色多，最后搭出来顺眼",
  "边角对齐花了点时间",
  "实物颜色比照片亮一点",
  "做了个简单款，没有太复杂",
  "朋友做得比我快",
  "小挂件放包上刚好",
];

const PLATFORM_STYLES = [
  {
    name: "大众点评短评",
    rule: "平实、短句，像普通点评用户。不要文艺，不要种草腔。",
  },
  {
    name: "小红书随手记",
    rule: "可以有一点画面感，但不要营销，不要夸张，不要像广告。",
  },
  {
    name: "朋友聊天口吻",
    rule: "像发给朋友看的，允许一点口语，但不要过度可爱。",
  },
  {
    name: "极简一句话",
    rule: "25到45字，只抓一个点，不做完整总结。",
  },
  {
    name: "轻微吐槽型",
    rule: "可以说一个小麻烦，但整体不要变成差评。",
  },
  {
    name: "拍照分享型",
    rule: "重点写实物颜色、拍照效果、摆放效果，不写完整过程。",
  },
  {
    name: "低调满意型",
    rule: "不热情，不夸张，语气像“还行、可以、顺眼”。",
  },
  {
    name: "碎片记录型",
    rule: "像随手记一个片段，可以不完整，不要有标准开头结尾。",
  },
  {
    name: "亲子记录型",
    rule: "只有关键词或项目包含孩子/亲子时才能使用，写孩子参与，不要夸张。",
  },
];

const PERSONAS = [
  {
    name: "第一次尝试的人",
    rule: "可以写不太熟悉，但不要总写怕手残。",
  },
  {
    name: "陪朋友来的人",
    rule: "像是被朋友带来，自己顺手做了一个。",
  },
  {
    name: "一个人安静做的人",
    rule: "只写安静做东西的状态，不要总写放空。",
  },
  {
    name: "细节控",
    rule: "关注边角、颜色、图案是否齐。",
  },
  {
    name: "拍照型顾客",
    rule: "关注实物和照片里的差异。",
  },
  {
    name: "轻微吐槽顾客",
    rule: "允许一点真实小麻烦，比如找颜色、对齐、费眼睛。",
  },
  {
    name: "成品用途型",
    rule: "关注挂包、放桌面、送人、当小纪念。",
  },
  {
    name: "低调路人型",
    rule: "评价很平，不夸张，不热情。",
  },
];

const PARENT_PERSONA = {
  name: "亲子型",
  rule: "只有 project、tone 或 keywords 明确出现亲子、孩子、小朋友、女儿、儿子时使用。",
};

const FOCUS_POOL = [
  "颜色很多，但不要写眼花",
  "找颜色花时间，但不要写眼睛酸",
  "边角对齐",
  "小豆子摆放",
  "图案慢慢成型",
  "做歪了几颗又调整",
  "简单图案也有细节",
  "实物颜色比照片亮",
  "拍照效果",
  "挂包用途",
  "放桌面用途",
  "朋友做得比自己快",
  "朋友随口评价了一句",
  "做完有个小纪念",
  "小图案没有翻车",
  "想换个颜色再做一次",
  "店员最后帮忙处理成品",
  "孩子自己选图案",
  "孩子负责找颜色",
  "自己配色意外顺眼",
  "做的时候比较安静",
  "中间拆掉一小块重摆",
  "第一次尝试没有想象中难",
  "成品比预期规整",
  "不赶时间慢慢做",
];

const LENGTH_RULES = [
  { name: "极短", rule: "25到45字，只写一句或两句。", weight: 35 },
  { name: "短评", rule: "45到70字，不要完整起承转合。", weight: 35 },
  { name: "普通", rule: "70到100字，可以多一点细节，但只写一个切口。", weight: 25 },
  { name: "稍长", rule: "100到130字，必须像真实记录，不能像作文。", weight: 5 },
];

const BAD_WORDS = [
  "全江油第一",
  "天花板",
  "必须冲",
  "闭眼入",
  "绝绝子",
  "无敌",
  "离谱",
  "封神",
  "YYDS",
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
  "自己熨烫",
  "自己上手熨烫",
  "教我怎么熨烫",
  "教我们怎么熨烫",
  "学习熨烫",
  "熨烫过程很有趣",
  "自己把作品熨好",
];

const TIME_WORDS = ["周末", "假期", "下班后", "放学后", "晚上", "下午"];

const TEMPLATE_WORDS = [
  "纠结",
  "眼花",
  "眼睛酸",
  "费眼睛",
  "安静坐会儿",
  "安静坐",
  "慢慢拼",
  "慢慢摆",
  "解压",
  "放空",
  "还可以",
  "还行",
  "没翻车",
  "挺好看",
  "拍出来好看",
  "小图案",
  "成品",
  "带回去",
  "挂包",
  "下次想试",
  "复杂点",
  "有成就感",
  "不知不觉",
];

const SIMILARITY_KEYWORDS = [
  "找颜色",
  "眼花",
  "费眼睛",
  "安静",
  "慢慢",
  "小图案",
  "成品",
  "拍出来",
  "挂包",
  "没翻车",
  "边角",
  "纠结",
  "朋友",
  "放空",
  "挺好看",
  "还可以",
  "下次",
  "复杂",
];

const PIN_DOU_FALLBACKS = [
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
];

const GENERAL_FALLBACKS = [
  "步骤不算复杂，自己动手做出来的感觉还是不一样。",
  "比我想象中更细致一点，做出来不算完美，但有点纪念感。",
  "原本只是随便试试，做完之后觉得可以。",
  "安静坐下来做点东西，完成的时候会有一点小惊喜。",
  "第一次尝试，中间有点慢，但最后效果还算满意。",
  "这个项目不太适合赶时间，慢慢做会更有意思。",
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

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function weightedRandom(items) {
  const total = items.reduce((sum, item) => sum + item.weight, 0);
  let cursor = Math.random() * total;
  for (const item of items) {
    cursor -= item.weight;
    if (cursor <= 0) return item;
  }
  return items[items.length - 1];
}

function hasAnyWord(text, words) {
  const safeText = String(text || "");
  return words.some((word) => safeText.includes(word));
}

function isParentContext(project, tone, keywords) {
  return hasAnyWord(`${project} ${tone} ${keywords}`, ["亲子", "孩子", "小朋友", "女儿", "儿子"]);
}

function isFriendContext(persona, keywords) {
  return persona.name === "陪朋友来的人" || hasAnyWord(keywords, ["朋友", "闺蜜", "同学", "同事"]);
}

function pickPersona(project, tone, keywords) {
  if (isParentContext(project, tone, keywords)) return PARENT_PERSONA;
  return randomItem(PERSONAS);
}

function pickPlatformStyle(project, tone, keywords) {
  const parentContext = isParentContext(project, tone, keywords);
  const candidates = PLATFORM_STYLES.filter((style) => style.name !== "亲子记录型" || parentContext);
  if (parentContext && Math.random() < 0.35) {
    return PLATFORM_STYLES.find((style) => style.name === "亲子记录型");
  }
  return randomItem(candidates);
}

function pickFocus(project, tone, keywords, persona) {
  const parentContext = isParentContext(project, tone, keywords);
  const friendContext = isFriendContext(persona, keywords);
  const isPinDou = String(project || "").includes("拼豆");
  const candidates = FOCUS_POOL.filter((focus) => {
    if (focus.includes("孩子")) return parentContext;
    if (focus.includes("朋友")) return friendContext;
    if (focus === "店员最后帮忙处理成品") return isPinDou;
    return true;
  });

  return randomItem(candidates);
}

function buildSkeleton(project, tone, finalKeywords) {
  const persona = pickPersona(project, tone, finalKeywords);
  const platformStyle = pickPlatformStyle(project, tone, finalKeywords);
  const focus = pickFocus(project, tone, finalKeywords, persona);
  const lengthRule = weightedRandom(LENGTH_RULES);

  return {
    platformStyle,
    persona,
    focus,
    lengthRule,
    debug: {
      platformStyle: platformStyle.name,
      persona: persona.name,
      focus,
      lengthRule: lengthRule.name,
    },
  };
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text, word) {
  return (String(text || "").match(new RegExp(escapeRegExp(word), "g")) || []).length;
}

function countKeywordHits(text, words) {
  const safeText = String(text || "");
  return words.filter((word) => safeText.includes(word)).length;
}

function hasBadWords(text) {
  return BAD_WORDS.some((word) => String(text || "").includes(word));
}

function hasUnprovidedTimeWords(review, keywords) {
  const safeReview = String(review || "");
  const safeKeywords = String(keywords || "");
  return TIME_WORDS.some((word) => safeReview.includes(word) && !safeKeywords.includes(word));
}

function hasUnprovidedRelationshipWords(review, skeleton, keywords) {
  const reviewText = String(review || "");
  const parentContext = isParentContext("", "", keywords);
  const friendContext = isFriendContext(skeleton.persona, keywords) || skeleton.focus.includes("朋友");
  const hasChild = hasAnyWord(reviewText, ["孩子", "小朋友", "亲子", "女儿", "儿子"]);
  const hasFriend = hasAnyWord(reviewText, ["朋友", "闺蜜", "同学", "同事"]);
  return (hasChild && !parentContext) || (hasFriend && !friendContext);
}

function hasUnsupportedPinDouProcessing(review, project, focus) {
  const text = String(review || "");
  if (!hasAnyWord(text, ["熨", "处理成品", "帮忙处理"])) return false;
  return !String(project || "").includes("拼豆") || focus !== "店员最后帮忙处理成品";
}

function hasTooManyTemplateWords(text) {
  return countKeywordHits(text, TEMPLATE_WORDS) > 2;
}

function hasSingleWordLimitViolation(text, focus) {
  const safeText = String(text || "");
  const neutralWords = ["还可以", "还行", "没翻车"];
  const eyeWords = ["眼花", "眼睛酸", "费眼睛"];
  const defaultBannedNext = ["下次想试", "复杂点"];

  if (countOccurrences(safeText, "挺") > 1) return true;
  if (countOccurrences(safeText, "成品") > 1) return true;
  if (countOccurrences(safeText, "小图案") > 1) return true;
  if (countKeywordHits(safeText, neutralWords) > 1) return true;
  if (countKeywordHits(safeText, eyeWords) > 1) return true;
  if (focus !== "想换个颜色再做一次" && hasAnyWord(safeText, defaultBannedNext)) return true;
  return false;
}

function hasBadRhythm(text) {
  const patterns = [
    /本来.*结果/,
    /一开始.*后面/,
    /找颜色.*最后/,
    /慢慢.*最后/,
    /成品.*拍出来/,
    /想安静坐会儿.*选了拼豆/,
    /朋友.*两个人边聊边/,
    /小豆子一颗颗/,
    /比预想.*最后/,
    /整体感觉/,
  ];
  const count = patterns.filter((pattern) => pattern.test(String(text || ""))).length;
  return count >= 2;
}

function looksLikeFullProcess(text) {
  const safeText = String(text || "");
  const processWords = ["进店", "选图案", "找颜色", "制作过程", "成品", "推荐", "环境"];
  return countKeywordHits(safeText, processWords) >= 4;
}

function tokenizeChinese(text) {
  return String(text || "")
    .replace(/[，。！？、,.!?]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function keywordSignature(text) {
  return SIMILARITY_KEYWORDS.filter((keyword) => String(text || "").includes(keyword));
}

function isTooSimilarToRecent(text, reviews = recentReviews) {
  const normalizedText = String(text || "").trim();
  if (reviews.some((oldReview) => oldReview === normalizedText)) return true;

  const signature = keywordSignature(text);
  if (signature.length === 0) return false;

  return reviews.some((oldReview) => {
    const oldSignature = keywordSignature(oldReview);
    const overlap = signature.filter((keyword) => oldSignature.includes(keyword)).length;
    return overlap >= 3;
  });
}

function countExclamationMarks(text) {
  return (String(text || "").match(/[!！]/g) || []).length;
}

function getInvalidReason(review, skeleton, project, keywords, options = {}) {
  const text = String(review || "").trim();
  if (!text) return "empty";
  if (hasBadWords(text)) return "bad_words";
  if (hasUnprovidedTimeWords(text, keywords)) return "time_words";
  if (hasUnprovidedRelationshipWords(text, skeleton, keywords)) return "relationship_words";
  if (hasUnsupportedPinDouProcessing(text, project, skeleton.focus)) return "unsupported_processing";
  if (hasTooManyTemplateWords(text)) return "template_words";
  if (hasSingleWordLimitViolation(text, skeleton.focus)) return "single_word_limit";
  if (hasBadRhythm(text)) return "bad_rhythm";
  if (looksLikeFullProcess(text)) return "full_process";
  if (countExclamationMarks(text) > 1) return "too_many_exclamation";
  if (options.checkSimilarity !== false && isTooSimilarToRecent(text)) return "similar";
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

function makeHumanFallback(project, skeleton, keywords) {
  const options = String(project || "").includes("拼豆") ? PIN_DOU_FALLBACKS : GENERAL_FALLBACKS;

  for (let index = 0; index < 40; index += 1) {
    const candidate = randomItem(options);
    const invalidReason = getInvalidReason(candidate, skeleton, project, keywords, { checkSimilarity: true });
    if (!invalidReason) return candidate;
  }

  for (let index = 0; index < 40; index += 1) {
    const candidate = randomItem(options);
    const invalidReason = getInvalidReason(candidate, skeleton, project, keywords, { checkSimilarity: false });
    if (!invalidReason) return candidate;
  }

  return options[0];
}

function buildSystemPrompt() {
  return `
你是一个真实顾客评价整理助手，不是商家宣传文案助手。

你只负责把后端提供的“顾客画像、平台语气、唯一重点”整理成一句或一小段自然评价。

强制原则：
1. 只写一个切口，不要写完整体验流程。
2. 不要每条都写门店名。
3. 不要每条都写环境、过程、成品、推荐。
4. 不要像广告，不要像作文，不要像商家写的评价模板。
5. 可以很短，可以碎片化，可以只说一个细节。
6. 允许轻微小瑕疵，但整体保持正向。
7. 拼豆不能写顾客自己熨烫。
8. 除非本次重点是“店员最后帮忙处理成品”，否则不要写熨烫。
9. 不要默认时间场景。
10. 不要高频使用“挺、成品、小图案、还可以、没翻车、眼花、费眼睛、安静坐会儿、下次想试复杂点”。

输出严格 JSON：
{
  "review": "评价正文",
  "photoTips": [
    "图1：作品成品图，拍清楚细节。",
    "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
    "图3：门店环境、朋友互动或亲子互动图。"
  ],
  "debug": {
    "platformStyle": "",
    "persona": "",
    "focus": "",
    "lengthRule": ""
  }
}
`.trim();
}

function buildUserPrompt(project, tone, finalKeywords, skeleton) {
  return `
体验项目：${project}
评价语气：${tone}
顾客关键词：${finalKeywords}

本次平台语气：${skeleton.platformStyle.name}
规则：${skeleton.platformStyle.rule}

本次顾客画像：${skeleton.persona.name}
规则：${skeleton.persona.rule}

本次唯一重点：${skeleton.focus}

本次长度：${skeleton.lengthRule.rule}

请只围绕“本次唯一重点”写。
不要加入没有提供的信息。
不要把完整体验写完。
不要写门店名，除非平台语气是“大众点评短评”且内容自然。
不要使用固定模板。
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

async function requestDeepSeekReview({ apiKey, baseUrl, model, signal, project, tone, finalKeywords, skeleton }) {
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
        { role: "user", content: buildUserPrompt(project, tone, finalKeywords, skeleton) },
      ],
      temperature: 0.42,
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
  return cleanText(parsed.review, "", 220);
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
  const project = cleanText(body.project, "拼豆", 24);
  const tone = cleanText(body.tone, "自然真实", 24);
  const keywords = cleanText(body.keywords, "", 120);
  const finalKeywords = keywords || randomItem(DEFAULT_KEYWORD_GROUPS);
  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);
  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let skeleton = buildSkeleton(project, tone, finalKeywords);
  let review = "";
  let invalidReason = "";

  try {
    review = await requestDeepSeekReview({
      apiKey,
      baseUrl,
      model,
      signal: controller.signal,
      project,
      tone,
      finalKeywords,
      skeleton,
    });
    invalidReason = getInvalidReason(review, skeleton, project, finalKeywords);

    if (invalidReason === "similar") {
      const retrySkeleton = buildSkeleton(project, tone, finalKeywords);
      const retryReview = await requestDeepSeekReview({
        apiKey,
        baseUrl,
        model,
        signal: controller.signal,
        project,
        tone,
        finalKeywords,
        skeleton: retrySkeleton,
      });
      const retryInvalidReason = getInvalidReason(retryReview, retrySkeleton, project, finalKeywords);
      if (!retryInvalidReason) {
        skeleton = retrySkeleton;
        review = retryReview;
        invalidReason = "";
      } else {
        skeleton = retrySkeleton;
        invalidReason = retryInvalidReason;
      }
    }

    if (invalidReason) {
      review = makeHumanFallback(project, skeleton, finalKeywords);
    }

    recordRecentReview(review);

    return json(res, 200, {
      review,
      photoTips: normalizePhotoTips(),
      debug: skeleton.debug,
    });
  } catch (error) {
    console.error("Review API error", error);
    review = makeHumanFallback(project, skeleton, finalKeywords);
    recordRecentReview(review);
    return json(res, 200, {
      review,
      photoTips: normalizePhotoTips(),
      debug: skeleton.debug,
    });
  } finally {
    clearTimeout(timeout);
  }
}
