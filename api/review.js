const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_PHOTO_TIPS = [
  "图1：作品成品图，拍清楚细节。",
  "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
  "图3：门店环境、朋友互动或亲子互动图。",
];
const DEFAULT_KEYWORD_GROUPS = [
  "颜色选择多，最后没有翻车",
  "做了简单小图案，细节比预想多",
  "想安静坐一会儿，最后小图案还可以",
  "颜色搭配意外还行",
  "实物颜色比照片亮一点",
];
const PERSONAS = [
  {
    name: "随手记录型",
    rule: "话少，不夸张，像随手发一句。不要写太完整的广告式评价。",
  },
  {
    name: "手残党型",
    rule: "可以写一开始担心做不好，但不要固定使用“怕手残”这个词。",
  },
  {
    name: "细节控型",
    rule: "关注颜色、边角、图案细节、配色变化。",
  },
  {
    name: "陪朋友型",
    rule: "像是跟朋友一起过来，不要写得太正式。",
  },
  {
    name: "拍照打卡型",
    rule: "关注成品是否好拍、颜色是否好看，但不要网红营销腔。",
  },
  {
    name: "安静放空型",
    rule: "关注慢慢做、安静、放空、坐一会儿。",
  },
  {
    name: "简短点评型",
    rule: "短一点，像大众点评普通用户随手评价。",
  },
  {
    name: "轻微吐槽型",
    rule: "允许一点小吐槽，比如颜色难选、细节费眼睛，但整体保持正向。",
  },
  {
    name: "作品用途型",
    rule: "关注做出来的小东西可以挂包、放桌面、送人、留作纪念。",
  },
];
const PARENT_PERSONA = {
  name: "亲子型",
  rule: "只有用户明确选择亲子或关键词提到孩子时使用。孩子自己参与，大人辅助，不要夸张。",
};
const STRUCTURES = [
  "先说来之前预期，再说实际体验",
  "先说成品，再回忆制作过程",
  "先说一个小细节，再补充整体感受",
  "只写简短体验，不铺垫",
  "带一点轻微吐槽，再转正向",
  "像小红书随手笔记，但不要过度营销",
  "像大众点评简短评价",
  "像朋友口吻推荐，但不要写必须来",
];
const VOICE_STYLES = [
  {
    name: "很短的点评",
    rule: "40字以内，像顾客随手写一句，不要完整起承转合。",
  },
  {
    name: "轻微吐槽",
    rule: "允许一点小吐槽，比如费眼睛、颜色太多不好选、细节有点磨人，但最后整体正向。",
  },
  {
    name: "实物展示",
    rule: "重点写实物用途或完成后的效果，不展开完整过程。",
  },
  {
    name: "过程碎片",
    rule: "只写制作中的一个小片段，比如找颜色、对齐、改边角，不做总结。",
  },
  {
    name: "朋友对话感",
    rule: "可以出现朋友一句反应，但不要像作文。",
  },
  {
    name: "普通大众点评",
    rule: "平实、短句，不要小红书腔。",
  },
  {
    name: "小红书随手记",
    rule: "可以稍微有画面感，但不要营销，不要夸张。",
  },
  {
    name: "低调满意",
    rule: "不热情，不夸张，只表达还可以、没有踩雷。",
  },
  {
    name: "细节观察",
    rule: "只写一个具体细节，比如颜色、边缘、图案、小豆子排列。",
  },
  {
    name: "下次尝试",
    rule: "结尾可以写下次想试别的图案或别的项目，但不要像广告。",
  },
];
const PLATFORM_STYLES = [
  {
    name: "大众点评短评",
    rule: "短一点，平实，不要太文艺，不要表情符号。",
  },
  {
    name: "小红书随手记",
    rule: "可以有一点画面感，但不要种草腔，不要夸张。",
  },
  {
    name: "朋友聊天口吻",
    rule: "像发给朋友看的，允许一点口语，比如哈哈、还行、没想到。",
  },
  {
    name: "极简一句话",
    rule: "30到45字，只抓一个点说，不要完整总结。",
  },
  {
    name: "轻微吐槽型",
    rule: "可以说一个小麻烦，比如找颜色、对齐、费眼睛，但整体是正向。",
  },
  {
    name: "拍照分享型",
    rule: "重点写实物、颜色、拍照效果，不要写完整制作过程。",
  },
  {
    name: "亲子记录型",
    rule: "只有关键词或项目包含孩子/亲子时才能使用，写孩子参与，不要夸张。",
  },
];
const TINY_FLAWS = [
  "找颜色花了点时间",
  "小豆子有点费眼睛",
  "边角对齐的时候有点慢",
  "一开始摆歪了几颗",
  "颜色太多反而不好选",
  "图案小细节有点磨人",
  "手有点抖",
  "中间拆掉重摆了一小块",
  "比想象中更需要耐心",
  "做快了容易摆歪",
];
const BANNED_PAIR_RULES = `
禁止常见连用：
1. 写了“纠结”，就不要再写“换了几次”“定下来”。
2. 写了“进入状态”，就不要再写“越做越顺”。
3. 写了“细节比想象中多”，就不要再写“挺费心思”。
4. 写了“店里不催”，就不要再写“慢慢做挺舒服”。
5. 写了“还不错”，结尾不要再写“挺开心”“挺舒服”“挺适合”。
`.trim();
const FOCUS_POOL = [
  "找颜色",
  "边缘对齐",
  "小豆子摆放",
  "图案一点点成型",
  "颜色比照片亮",
  "实物比预想规整",
  "小挂件用途",
  "放桌面",
  "挂包",
  "朋友做得比自己快",
  "做歪了又调整",
  "小细节费眼睛",
  "简单图案也需要耐心",
  "拍照效果",
  "颜色搭配意外顺眼",
  "手上有事做比较容易安静",
  "没有翻车",
  "做完有个小纪念",
  "想换个颜色再做一次",
  "店员最后帮忙处理",
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
  "性价比超高",
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
  "教我怎么熨烫",
  "教我们怎么熨烫",
  "自己熨烫",
  "自己上手熨烫",
  "学习熨烫",
  "熨烫过程很有趣",
  "熨烫也很好玩",
  "自己把作品熨好",
];
const TIME_WORDS = [
  "周末",
  "假期",
  "下班后",
  "放学后",
  "晚上",
  "下午",
];

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

function pickMany(items, count) {
  const available = [...items];
  const picked = [];
  while (picked.length < count && available.length > 0) {
    const index = Math.floor(Math.random() * available.length);
    picked.push(available[index]);
    available.splice(index, 1);
  }
  return picked;
}

function hasAnyWord(text, words) {
  const safeText = String(text || "");
  return words.some((word) => safeText.includes(word));
}

function pickPersona(project, tone, keywords) {
  const text = `${project} ${tone} ${keywords}`;
  if (hasAnyWord(text, ["亲子", "孩子", "小朋友"])) {
    return PARENT_PERSONA;
  }
  return randomItem(PERSONAS);
}

function pickFocus(project, tone, keywords, persona) {
  const text = `${project} ${tone} ${keywords}`;
  const isPinDou = String(project || "").includes("拼豆");
  const canUseChild = persona.name === "亲子型" || hasAnyWord(text, ["亲子", "孩子", "小朋友"]);
  const canUseFriend = persona.name === "陪朋友型" || hasAnyWord(text, ["朋友", "闺蜜", "同学", "同事"]);
  const candidates = FOCUS_POOL.filter((item) => {
    if (item === "朋友做得比自己快") return canUseFriend;
    if (item === "店员最后帮忙处理") return isPinDou;
    return true;
  });

  const picked = pickMany(candidates, 1);

  if (canUseChild && persona.name === "亲子型") {
    picked[picked.length - 1] = "孩子自己选图案";
  }
  if (canUseFriend && persona.name === "陪朋友型" && !hasAnyWord(picked.join(" "), ["朋友", "两个人"])) {
    picked[picked.length - 1] = "朋友做得比自己快";
  }

  return picked;
}

function pickPlatformStyle(project, tone, keywords) {
  const text = `${project} ${tone} ${keywords}`;
  const canUseParent = hasAnyWord(text, ["亲子", "孩子", "小朋友"]);
  const candidates = PLATFORM_STYLES.filter((style) => style.name !== "亲子记录型" || canUseParent);
  if (canUseParent && Math.random() < 0.35) {
    return PLATFORM_STYLES.find((style) => style.name === "亲子记录型");
  }
  return randomItem(candidates);
}

function pickTinyFlaw() {
  return Math.random() < 0.4 ? randomItem(TINY_FLAWS) : "";
}

function pickWordCountRule() {
  const value = Math.random();
  if (value < 0.45) return "25到55字，很短，像随手评价";
  if (value < 0.8) return "55到90字，自然一点";
  return "90到130字，可以多一点细节，但不要像作文";
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

function normalizePhotoTips() {
  return DEFAULT_PHOTO_TIPS;
}

function hasBadWords(text) {
  return BAD_WORDS.some((word) => String(text || "").includes(word));
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countOccurrences(text, word) {
  return (String(text || "").match(new RegExp(escapeRegExp(word), "g")) || []).length;
}

function hasOverusedWords(text) {
  const rules = [
    { word: "挺", max: 1 },
    { word: "成品", max: 1 },
    { word: "还不错", max: 0 },
    { word: "整体感觉", max: 0 },
    { word: "没踩雷", max: 0 },
    { word: "挺适合", max: 0 },
    { word: "打发时间", max: 0 },
    { word: "下次想试", max: 0 },
    { word: "复杂点", max: 0 },
  ];

  return rules.some((rule) => countOccurrences(text, rule.word) > rule.max);
}

function hasUnprovidedTimeWords(review, keywords) {
  const safeReview = String(review || "");
  const safeKeywords = String(keywords || "");
  return TIME_WORDS.some((word) => safeReview.includes(word) && !safeKeywords.includes(word));
}

function looksLikeTemplate(text) {
  const normalized = String(text || "").replace(/\s+/g, "");
  const patterns = [
    /在.{0,8}体验了.{0,8}[，,]环境.{0,8}[，,]过程.{0,8}/,
    /环境.{0,6}舒服.*过程.{0,6}轻松/,
    /成品.{0,8}熨烫.*带走/,
    /挺开心的[。.!！]?$/,
    /挺不错的[。.!！]?$/,
    /挺方便的[。.!！]?$/,
  ];

  return patterns.some((pattern) => pattern.test(normalized));
}

function countTemplateWords(text) {
  const words = [
    "第一次",
    "怕手残",
    "纠结",
    "解压",
    "有成就感",
    "比想象中好看",
    "比想象中可爱",
    "挺开心",
    "挺不错",
    "过程轻松",
    "环境舒服",
    "进入状态",
  ];

  return words.filter((word) => String(text || "").includes(word)).length;
}

function hasBadCombinations(text) {
  const safeText = String(text || "");
  const combos = [
    ["第一次", "怕手残", "进入状态"],
    ["选图案", "纠结", "解压", "有成就感"],
    ["比想象中", "拿在手里", "有成就感"],
    ["环境舒服", "过程轻松", "可以带走"],
    ["在时里白造物", "体验了拼豆", "挺开心"],
  ];

  return combos.some((combo) => combo.every((word) => safeText.includes(word)));
}

function tooMuchTemplateFlavor(text) {
  return countTemplateWords(text) > 2 || hasBadCombinations(text);
}

function countRepeatedFlavorWords(text) {
  const words = [
    "纠结",
    "换了几次",
    "配色换了",
    "定下来",
    "进入状态",
    "越做越顺",
    "不知不觉",
    "细节比想象中多",
    "细节比预想的多",
    "店里不会催",
    "店里不催",
    "挺舒服",
    "还不错",
    "挺适合",
    "打发时间",
    "比想象中",
    "比预想",
    "有成就感",
  ];

  return words.filter((word) => String(text || "").includes(word)).length;
}

function hasSameReviewRhythm(text) {
  const patterns = [
    /一开始.*纠结.*最后.*还不错/,
    /本来.*没.*期待.*结果.*还挺/,
    /选.*纠结.*换了.*定下来/,
    /做到一半.*进入状态/,
    /越.*越.*最后/,
    /细节.*比.*想象.*多/,
    /店里.*不催.*慢慢/,
    /适合.*打发时间/,
    /整体.*挺.*的/,
  ];

  return patterns.some((pattern) => pattern.test(String(text || "")));
}

function hasUnwantedStoreName(review, persona, structure) {
  const text = String(review || "");
  if (!text.includes("时里白造物")) return false;
  return persona.name !== "简短点评型" && structure !== "像大众点评简短评价";
}

function hasUnprovidedRelationshipWords(review, persona, voiceStyle, keywords) {
  const reviewText = String(review || "");
  const keywordText = String(keywords || "");
  const hasChild = hasAnyWord(reviewText, ["孩子", "小朋友", "亲子"]);
  const hasFriend = hasAnyWord(reviewText, ["朋友", "闺蜜", "同学", "同事"]);
  const childProvided = persona.name === "亲子型" || hasAnyWord(keywordText, ["孩子", "小朋友", "亲子"]);
  const friendProvided =
    persona.name === "陪朋友型" ||
    voiceStyle.name === "朋友对话感" ||
    hasAnyWord(keywordText, ["朋友", "闺蜜", "同学", "同事"]);

  return (hasChild && !childProvided) || (hasFriend && !friendProvided);
}

function hasUnsupportedPinDouProcessing(review, project, focus) {
  const text = String(review || "");
  if (!hasAnyWord(text, ["熨", "处理成品", "帮忙处理"])) return false;
  return !String(project || "").includes("拼豆") || !focus.includes("店员最后帮忙处理");
}

function countExclamationMarks(text) {
  return (String(text || "").match(/[!！]/g) || []).length;
}

function makeHumanFallback(project, tone, keywords) {
  const safeProject = cleanText(project, "手作", 24);

  if (safeProject.includes("拼豆")) {
    const options = [
      "颜色是真的多，找了半天才凑出一套顺眼的。",
      "小豆子一颗颗摆上去，比想象中更需要耐心。",
      "选了个简单图案，最后没有翻车，已经满意了。",
      "边角对齐的时候有点慢，不过做出来还算规整。",
      "做了个小挂件，挂包上刚好，不会太夸张。",
      "一开始摆歪了几颗，后面慢慢调顺了。",
      "实物颜色比手机里看着亮一点，拍照还可以。",
      "朋友做得比我快，我一直在找颜色。",
      "这个项目不难，就是急不来，慢慢摆会更顺。",
      "图案一点点出来的时候，确实有点小满足。",
      "找颜色找了好久，最后搭出来倒是比预想顺眼。",
      "做快了容易歪，还是得慢慢来。",
      "选了个小图案，完成后放桌上看着还可以。",
      "小细节有点费眼睛，但做出来不会失望。",
      "最后店员帮忙处理好，可以直接拿走，这点比较省心。",
      "本来没想做太久，结果找颜色就花了不少时间。",
      "做出来的小东西不大，但自己摆出来的感觉不一样。",
      "没有做很复杂的款，简单图案也够我研究一会儿。",
      "颜色多到有点选择困难，最后随便搭了一套也还行。",
      "手有点抖，边缘调整了几次，最后看着顺眼多了。",
    ];
    return randomItem(options);
  }

  const options = [
    `这次做的${safeProject}步骤不算复杂，但自己动手做出来的感觉还是不一样。`,
    `${safeProject}比我想象中更细致一点，做出来不算完美，但有点纪念感。`,
    `原本只是随便试试，做完之后觉得可以，至少不是走马观花的体验。`,
    `安静坐下来做点东西，完成的时候会有一点小惊喜。`,
    `第一次尝试${safeProject}，中间有点慢，但最后效果还算满意。`,
    `这个项目不太适合赶时间，慢慢做会更有意思。`,
  ];

  return randomItem(options);
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
  const persona = pickPersona(project, tone, finalKeywords);
  const voiceStyle = randomItem(VOICE_STYLES);
  const platformStyle = pickPlatformStyle(project, tone, finalKeywords);
  const structure = randomItem(STRUCTURES);
  const focus = pickFocus(project, tone, finalKeywords, persona);
  const tinyFlaw = pickTinyFlaw();
  const wordCountRule = pickWordCountRule();
  const debug = {
    persona: persona.name,
    voiceStyle: voiceStyle.name,
    platformStyle: platformStyle.name,
    structure,
    focus,
    tinyFlaw: tinyFlaw || "",
  };

  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);
  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `
你是一个真实顾客评价改写助手，不是商家宣传文案助手。

你的任务：
根据顾客选择的项目、语气、真实关键词、本次随机顾客画像、本次平台语气、本次写作结构和本次关注点，生成一条像普通顾客随手写出来的评价。

门店信息：
- 门店名称：时里白造物
- 类型：创意手作体验空间
- 地址：圣名国际购物广场2层
- 常见项目：拼豆、石膏彩绘、香薰蜡烛、中药香囊、奶油胶、亲子手作、朋友聚会

真实规则：
1. 拼豆成品只能由店员熨烫，顾客不能自行熨烫。
2. 如果项目是拼豆，可以偶尔写“店员会帮忙处理成品”“成品会帮忙熨好”，但不要每条都写。
3. 禁止写“店员教我怎么熨烫”“自己熨烫”“学习熨烫”“熨烫过程很有趣”。
4. 不要默认顾客是周末来的。
5. 除非关键词明确提供，不要写周末、假期、下班后、放学后、晚上、下午等具体时间。

写作风格要求：
1. 评价要像真人随手写的，不要像商家模板。
2. 不要每条都出现门店名“时里白造物”。
3. 不要使用固定句式：在XX体验了XX，环境XX，过程XX，成品XX，挺XX。
4. 不要总是写“环境舒服、过程轻松、可以带走”。
5. 不要每次都写“第一次、怕手残、纠结、解压、有成就感、比想象中好看”。
6. 句子长短要有变化，不要每句都很工整。
7. 只能重点写本次给定的 1 个关注点，不要把所有优点都堆进去。
8. 可以写一个具体小细节，但不要每次都是“选图案纠结”“怕手残”“进入状态”。
9. 不要写得太满，语气要自然克制。
10. 最多使用 1 个感叹号。
11. 不要像广告文案，不要像官方介绍。
12. 如果本次关注点没有“店员最后帮忙处理”，拼豆评价也不要主动写熨烫。

用词要求：
1. 每条评价最多出现 1 次“挺”。
2. “成品”最多出现 1 次；能不用就不用，可以换成“小图案、小挂件、做出来的小东西、完成后的效果、实物、最后那个图案”。
3. 不要写“还不错、整体感觉、没踩雷、挺适合、打发时间、下次想试复杂点”。
4. 不要总在结尾替别人总结“适合……”。真实顾客更多是在描述自己的体验，不是写推荐语。
5. 可以有一点小麻烦，比如找颜色、对齐、费眼睛、摆歪，但不要写成差评，也不要强行转成“但是很好”。

避免高频模板：
不要反复写“选图案纠结、配色纠结、换了几次、做到一半进入状态、越做越顺、细节比想象中多、店里不催人、适合打发时间”。
这些表达不是绝对禁止，但每条评价最多只能出现其中 1 个。
如果已经写了“纠结”，就不要再写“换了几次”“定下来”。
如果已经写了“进入状态”，就不要再写“越做越顺”。
如果已经写了“还不错”，结尾就不要再写“挺舒服”“挺适合”。

禁止夸张词：
全江油第一、天花板、必须冲、闭眼入、绝绝子、无敌、离谱、封神、YYDS、性价比天花板、老板人超好、老师特别专业、一对一指导、全程陪同、玩到不想走、来了就不想走。

禁止诱导评价内容：
好评送、好评返、商家让我、为了礼品、复制粘贴、AI生成、模板。

输出必须是严格 JSON，不要 Markdown，不要解释。

JSON 格式：
{
  "review": "评价正文",
  "photoTips": [
    "图1：作品成品图，拍清楚细节。",
    "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
    "图3：门店环境、朋友互动或亲子互动图。"
  ],
  "debug": {
    "persona": "本次随机的人设",
    "voiceStyle": "本次说话风格",
    "platformStyle": "本次平台语气",
    "structure": "本次随机结构",
    "focus": ["本次唯一重点"],
    "tinyFlaw": "本次轻微瑕疵或空字符串"
  }
}
`.trim();

  const userPrompt = `
请根据下面信息生成一条真实自然的顾客评价。

体验项目：${project}
评价语气：${tone}
顾客真实关键词：${finalKeywords}

本次顾客画像：
${persona.name}
${persona.rule}

本次说话风格：
${voiceStyle.name}
${voiceStyle.rule}

本次平台语气：
${platformStyle.name}
${platformStyle.rule}

本次写作结构：
${structure}

本次只能写这一个重点：
${focus.join("、")}

本次轻微瑕疵：
${tinyFlaw ? `可以自然带过：${tinyFlaw}` : "不需要刻意写小瑕疵"}

本次字数要求：
${wordCountRule}

特别重要：
1. 只写一个切口，不要把完整体验从进店、制作、成品、环境、推荐全部写完。
2. 不要每条都写“选图案纠结、配色纠结、换了几次、进入状态、越做越顺”。
3. 不要写成完整小作文。
4. 不要每条都出现“挺舒服、还不错、挺适合、打发时间”。
5. 不要每条都写门店名。
6. 如果本次重点不是“店员最后帮忙处理”，不要写熨烫。
7. 不要默认写周末、假期、下午、晚上。
8. 评价可以短，可以碎，可以像随手记录。
9. 评价要像不同顾客写的，不要像同一个人换词。
10. 不要每条都正向完整，可以有一点小麻烦，但整体不要变差评。
11. 不要每条都用“挺”。
12. 不要每条都写“成品”，可改成“小图案、小挂件、做出来的小东西、实物、最后那个图案”。
13. 不要每条都写“下次想试复杂点”。
14. 不要总写“适合打发时间 / 适合放空”。
${BANNED_PAIR_RULES}
`.trim();

  try {
    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.45,
        max_tokens: 700,
        response_format: { type: "json_object" },
      }),
      signal: controller.signal,
    });

    const raw = await response.text();
    if (!response.ok) {
      console.error("DeepSeek request failed", response.status, raw.slice(0, 500));
      return json(res, 502, { error: "DeepSeek request failed" });
    }

    const completion = JSON.parse(raw);
    const content = completion?.choices?.[0]?.message?.content || "{}";
    const parsed = parseJsonContent(content);
    let review = cleanText(parsed.review, "", 220);

    if (!review) {
      return json(res, 502, { error: "Invalid DeepSeek response" });
    }

    if (
      hasBadWords(review) ||
      hasUnprovidedTimeWords(review, finalKeywords) ||
      looksLikeTemplate(review) ||
      tooMuchTemplateFlavor(review) ||
      countRepeatedFlavorWords(review) > 2 ||
      hasSameReviewRhythm(review) ||
      hasOverusedWords(review) ||
      hasUnwantedStoreName(review, persona, structure) ||
      hasUnprovidedRelationshipWords(review, persona, voiceStyle, finalKeywords) ||
      hasUnsupportedPinDouProcessing(review, project, focus) ||
      countExclamationMarks(review) > 1
    ) {
      review = makeHumanFallback(project, tone, finalKeywords);
    }

    return json(res, 200, {
      review,
      photoTips: normalizePhotoTips(),
      debug,
    });
  } catch (error) {
    console.error("Review API error", error);
    return json(res, 500, { error: "Server error" });
  } finally {
    clearTimeout(timeout);
  }
}
