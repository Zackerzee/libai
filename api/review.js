const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_PHOTO_TIPS = [
  "图1：作品成品图，拍清楚细节。",
  "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
  "图3：门店环境、朋友互动或亲子互动图。",
];
const DEFAULT_KEYWORD_GROUPS = [
  "颜色选择多，做起来解压，成品好看",
  "选图案纠结了一会儿，做出来比想象中可爱",
  "刚开始怕手残，后面慢慢进入状态",
  "适合安静坐下来做点东西，成品有纪念感",
  "制作过程不赶，完成后挺有成就感",
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

function countExclamationMarks(text) {
  return (String(text || "").match(/[!！]/g) || []).length;
}

function makeHumanFallback(project, tone, keywords) {
  const safeProject = cleanText(project, "手作", 24);

  if (safeProject.includes("拼豆")) {
    const options = [
      "拼豆比想象中更容易进入状态，选颜色的时候纠结了好久，慢慢拼出来还挺有成就感。成品店员会帮忙处理好，拿到手之后比想象中可爱。",
      "刚开始还怕自己手残，拼着拼着就停不下来了。颜色选择挺多，做出来的小东西可以带走，放在桌面上或者包上都挺合适。",
      "选图案的时候纠结了一会儿，最后还是挑了一个自己喜欢的。拼豆过程挺解压的，成品拿到手比图片上看着更有感觉。",
      "本来以为拼豆会很难，实际做起来节奏刚刚好。慢慢把图案拼出来的过程挺有意思，最后成品也比预期好看。",
    ];
    return randomItem(options);
  }

  const options = [
    `这次体验的${safeProject}比想象中更有意思，步骤不复杂，但做出来还挺有成就感。成品拿在手里的时候，感觉比单纯买一个东西更有纪念感。`,
    `原本只是想找个地方坐一会儿，没想到${safeProject}做起来还挺投入。过程不赶，慢慢做完之后，成品看着也挺满意。`,
    `第一次尝试${safeProject}，刚开始有点没思路，做着做着就顺了。最后出来的效果比预期好，适合想安静做点东西的时候来体验。`,
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
  const promptKeywords = keywords || randomItem(DEFAULT_KEYWORD_GROUPS);

  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);
  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `
你是一个真实顾客评价改写助手，不是商家宣传文案助手。

你的任务：
根据顾客选择的项目、语气和真实关键词，生成一条像普通顾客随手写出来的评价。

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
5. 允许有一点口语化，比如“还挺上头”“比想象中好看”“慢慢拼还挺解压”“刚开始有点怕手残”。
6. 句子长短要有变化，不要每句都很工整。
7. 可以写一个具体小细节，比如选颜色、选图案、纠结颜色、拼到一半进入状态、成品拿到手有成就感。
8. 不要写得太满，语气要自然克制。
9. 字数控制在 70 到 130 字。
10. 最多使用 1 个感叹号。
11. 不要像广告文案，不要像官方介绍。

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
  ]
}
`.trim();

  const userPrompt = `
请根据下面信息生成一条真实自然的顾客评价。

体验项目：${project}
评价语气：${tone}
顾客真实关键词：${promptKeywords}

请严格遵守：
1. 不要每条都写门店名。
2. 不要写成“在XX体验了XX，环境XX，过程XX，成品XX”的模板句式。
3. 如果关键词没有提到店员，就不要主动写店员服务。
4. 如果关键词没有提到孩子，就不要写孩子。
5. 如果关键词没有提到朋友，就不要写朋友。
6. 如果关键词没有提到具体时间，就不要写周末、假期、下午、晚上。
7. 如果项目是拼豆，不要写顾客自己熨烫，也不要写店员教顾客熨烫。
8. 可以加入一个真实的小细节，比如选颜色、选图案、纠结配色、做出来比想象中好看。
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
        max_tokens: 500,
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
      hasUnprovidedTimeWords(review, promptKeywords) ||
      looksLikeTemplate(review) ||
      countExclamationMarks(review) > 1
    ) {
      review = makeHumanFallback(project, tone, promptKeywords);
    }

    return json(res, 200, {
      review,
      photoTips: normalizePhotoTips(),
    });
  } catch (error) {
    console.error("Review API error", error);
    return json(res, 500, { error: "Server error" });
  } finally {
    clearTimeout(timeout);
  }
}
