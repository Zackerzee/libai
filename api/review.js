const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_PHOTO_TIPS = [
  "图1：作品成品图，拍清楚细节。",
  "图2：制作过程图，比如选色、拼豆、上色或制作中的画面。",
  "图3：门店环境、朋友互动或亲子互动图。",
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
  "晚上来",
  "下午来",
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

function countExclamationMarks(text) {
  return (String(text || "").match(/[!！]/g) || []).length;
}

function cleanFallbackKeywords(keywords) {
  let text = String(keywords || "").trim();
  for (const word of [...BAD_WORDS, ...TIME_WORDS]) {
    text = text.replaceAll(word, "");
  }
  text = text
    .replace(/[，,、；;]+/g, "，")
    .replace(/^，+|，+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return text || "环境比较舒服，制作过程也比较轻松";
}

function makeSafeFallback(project, tone, keywords) {
  const safeProject = cleanText(project, "手作", 24);
  const cleanKeywords = cleanFallbackKeywords(keywords);

  if (safeProject.includes("拼豆")) {
    return `今天来时里白造物体验了拼豆，${cleanKeywords}。颜色选择比较多，做完的成品由店员帮忙熨烫，可以带走留作纪念，整体体验比较轻松。`;
  }

  return `今天来时里白造物体验了${safeProject}，${cleanKeywords}。制作过程比较轻松，做完的作品可以带走，适合想放松的时候来体验一下。`;
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

  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);
  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  const systemPrompt = `
你是“时里白造物”的门店评价整理助手，不是营销文案助手。
你只能基于顾客选择的项目、语气、关键词生成评价。
不允许编造用户没提供的信息。
不允许写“全江油第一”“天花板”“必须冲”“闭眼入”“绝绝子”“无敌”“封神”“YYDS”等夸张词。
不允许写“老板人超好”“老师特别专业”“一对一指导”“全程陪同”，除非关键词明确提到。
不允许写“好评送礼”“商家让我写”“为了礼品来评价”等诱导评价内容。
不允许出现“AI生成”“复制粘贴”“模板”等字眼。
评价控制在 70 到 110 字。
语气自然、克制、像真人。
最多使用 1 个感叹号。

门店真实规则：
1. 拼豆成品只能由店员熨烫，顾客不能自行熨烫。
2. 如果体验项目是拼豆，可以写“成品由店员帮忙熨烫”“熨烫交给店员处理”。
3. 禁止写“店员教我怎么熨烫”“自己熨烫”“自己上手熨烫”“学习熨烫”“熨烫过程很有趣”等错误内容。
4. 不要默认顾客是周末来的。
5. 不要频繁出现“周末”“假期”“下班后”“放学后”“下午”“晚上”等具体时间场景，除非顾客关键词明确提供。
6. 可以使用更中性的表达，比如“空闲的时候”“和朋友一起来”“带孩子来体验”“想放松的时候”“适合来坐一会儿”。

输出严格 JSON：
{
  "review": "评价正文",
  "photoTips": ["图1建议", "图2建议", "图3建议"]
}
`.trim();

  const userPrompt = `
请根据下面信息生成一条真实自然的门店评价。

门店：时里白造物
体验项目：${project}
评价语气：${tone}
顾客提供的真实关键词：${keywords || "环境舒服，过程轻松，作品可以带走"}

特别注意：
- 评价只能围绕以上关键词展开。
- 如果关键词没有提到店员、孩子、价格、朋友、亲子，就不要主动写这些内容。
- 如果关键词没有提到周末、假期、下班后、放学后、晚上、下午，就不要主动写具体时间场景。
- 不要写“周末来玩”“周末放松”“周末和朋友来”等默认时间。
- 如果项目是拼豆，只能写“成品由店员帮忙熨烫”或“熨烫交给店员处理”。
- 禁止写顾客自己熨烫、店员教顾客熨烫、熨烫过程有趣。
- 不要写诱导评价、送礼内容或平台违规表达。
- 不要写夸张广告语。
- 评价要像顾客自己写的，不要像商家宣传文案。
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
      hasUnprovidedTimeWords(review, keywords) ||
      countExclamationMarks(review) > 1
    ) {
      review = makeSafeFallback(project, tone, keywords);
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
