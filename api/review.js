const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_PHOTO_TIPS = [
  "图1：作品成品图，拍清楚细节。",
  "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
  "图3：门店环境、朋友互动或亲子互动图。",
];
const DEFAULT_KEYWORD_GROUPS = [
  "颜色选择多，成品看着顺眼",
  "做了简单小图案，细节比预想多",
  "想安静坐一会儿，最后成品还可以",
  "配色换了几次，效果还不错",
  "成品适合拍照，下次想试复杂一点的图",
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
    name: "成品用途型",
    rule: "关注成品可以挂包、放桌面、送人、留作纪念。",
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
const FOCUS_POOL = [
  "颜色选择多",
  "选图案",
  "配色纠结",
  "制作过程安静",
  "做到一半进入状态",
  "成品比预期好",
  "适合拍照",
  "可以带走",
  "店员帮忙处理成品",
  "店里不催人",
  "适合放空",
  "和朋友一起做",
  "孩子自己参与",
  "小细节有点考验耐心",
  "做完想再试别的图案",
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
    if (item === "孩子自己参与") return canUseChild;
    if (item === "和朋友一起做") return canUseFriend;
    if (item === "店员帮忙处理成品") return isPinDou;
    return true;
  });

  const focusCount = Math.random() < 0.65 ? 1 : 2;
  const picked = pickMany(candidates, focusCount);

  if (canUseChild && persona.name === "亲子型" && !picked.includes("孩子自己参与")) {
    picked[picked.length - 1] = "孩子自己参与";
  }
  if (canUseFriend && persona.name === "陪朋友型" && !picked.includes("和朋友一起做")) {
    picked[picked.length - 1] = "和朋友一起做";
  }

  return picked;
}

function pickWordCountRule() {
  const value = Math.random();
  if (value < 0.3) return "40到70字，短一点，像随手评价";
  if (value < 0.8) return "70到110字，自然完整";
  return "110到150字，可以多一点细节，但不要像作文";
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

function hasUnwantedStoreName(review, persona, structure) {
  const text = String(review || "");
  if (!text.includes("时里白造物")) return false;
  return persona.name !== "简短点评型" && structure !== "像大众点评简短评价";
}

function hasUnprovidedRelationshipWords(review, persona, keywords) {
  const reviewText = String(review || "");
  const keywordText = String(keywords || "");
  const hasChild = hasAnyWord(reviewText, ["孩子", "小朋友", "亲子"]);
  const hasFriend = hasAnyWord(reviewText, ["朋友", "闺蜜", "同学", "同事"]);
  const childProvided = persona.name === "亲子型" || hasAnyWord(keywordText, ["孩子", "小朋友", "亲子"]);
  const friendProvided = persona.name === "陪朋友型" || hasAnyWord(keywordText, ["朋友", "闺蜜", "同学", "同事"]);

  return (hasChild && !childProvided) || (hasFriend && !friendProvided);
}

function hasUnsupportedPinDouProcessing(review, project, focus) {
  const text = String(review || "");
  if (!hasAnyWord(text, ["熨", "处理成品", "帮忙处理"])) return false;
  return !String(project || "").includes("拼豆") || !focus.includes("店员帮忙处理成品");
}

function countExclamationMarks(text) {
  return (String(text || "").match(/[!！]/g) || []).length;
}

function makeHumanFallback(project, tone, keywords) {
  const safeProject = cleanText(project, "手作", 24);

  if (safeProject.includes("拼豆")) {
    const options = [
      "拼豆这个东西有点神奇，看着是一颗颗小豆子，坐下来之后反而容易专注。最后图案出来的时候，确实会有一点小满足。",
      "颜色比我想的多，挑的时候花了点时间。最后做了一个不算复杂的小图案，成品看着还挺顺眼。",
      "本来以为会很快做完，结果细节还挺多。慢慢拼完之后，看到图案一点点出来，感觉还不错。",
      "拼的时候需要一点耐心，但不会很难。中间改了几次颜色，最后出来的效果比一开始想的好。",
      "这次做了个小图案，过程挺安静的。不是那种很热闹的项目，但适合坐下来慢慢弄。",
      "成品比照片里看着更有质感一点，小小一个拿在手里还挺可爱。下次想试试复杂一点的图。",
      "选颜色的时候有点选择困难，后来随便定了一套配色，没想到出来效果还行。",
      "拼豆比想象中更考验耐心，尤其是小细节。不过完成之后看着自己的成品，还是挺值得的。",
      "做的是一个比较简单的图案，没有翻车。整体体验比想象中轻松，适合想安静待一会儿的时候。",
      "一开始只是想试试，结果拼到后面会有点停不下来。图案成型的过程还挺有意思。",
    ];
    return randomItem(options);
  }

  const options = [
    `这次做的${safeProject}比想象中更有参与感，不是简单看一下就结束，自己动手的过程还挺有意思。`,
    `做${safeProject}的时候节奏比较慢，反而容易静下来。成品不算完美，但自己做出来的感觉还是不一样。`,
    `本来没抱太大期待，实际体验下来还可以。步骤不复杂，做完之后有个自己的小作品。`,
    `这类手作适合慢慢来，急着做反而没意思。最后成品出来的时候，还是会有一点小惊喜。`,
    `第一次尝试${safeProject}，过程比想象中更细致。做完之后感觉比直接买现成的更有记忆点。`,
    `整体不是那种很吵的体验，比较适合安静坐下来做点东西。成品完成后看着还挺满意。`,
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
  const structure = randomItem(STRUCTURES);
  const focus = pickFocus(project, tone, finalKeywords, persona);
  const wordCountRule = pickWordCountRule();
  const debug = {
    persona: persona.name,
    structure,
    focus,
  };

  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);
  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `
你是一个真实顾客评价改写助手，不是商家宣传文案助手。

你的任务：
根据顾客选择的项目、语气、真实关键词、本次随机顾客画像、本次写作结构和本次关注点，生成一条像普通顾客随手写出来的评价。

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
7. 只能重点写本次给定的 1 到 2 个关注点，不要把所有优点都堆进去。
8. 可以写一个具体小细节，但不要每次都是“选图案纠结”“怕手残”“进入状态”。
9. 不要写得太满，语气要自然克制。
10. 最多使用 1 个感叹号。
11. 不要像广告文案，不要像官方介绍。
12. 如果本次关注点没有“店员帮忙处理成品”，拼豆评价也不要主动写熨烫。

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
    "structure": "本次随机结构",
    "focus": ["重点1", "重点2"]
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

本次写作结构：
${structure}

本次只允许重点写这些内容：
${focus.join("、")}

本次字数要求：
${wordCountRule}

请严格遵守：
1. 不要每条都写门店名。
2. 不要写成“在XX体验了XX，环境XX，过程XX，成品XX”的模板句式。
3. 不要把所有优点都写进去，只写本次重点。
4. 如果本次重点没有“店员帮忙处理成品”，拼豆评价也不要主动写熨烫。
5. 如果关键词没有提到孩子，就不要写孩子。
6. 如果关键词没有提到朋友，且 persona 不是陪朋友型，就不要写朋友。
7. 如果关键词没有提到具体时间，就不要写周末、假期、下午、晚上。
8. 可以有一个很小的真实细节，但不要每次都是“选图案纠结”“怕手残”。
9. 评价要像普通顾客自己写的，不要像商家宣传。
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
      hasUnwantedStoreName(review, persona, structure) ||
      hasUnprovidedRelationshipWords(review, persona, finalKeywords) ||
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
