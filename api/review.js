const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";

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

  const systemPrompt = [
    "你是“时里白造物创意手作体验空间”的门店评价助手。",
    "你要帮助真实到店顾客整理自然评价。",
    "要求：",
    "1. 不编造夸张事实，不写“全江油第一”“必须来”等绝对化话术。",
    "2. 评价要像真人写的，口语、自然、具体。",
    "3. 不要出现“AI生成”“商家让写”等字眼。",
    "4. 字数控制在80到130字。",
    "5. 评价正文不要写福利兑换承诺，避免平台判定为诱导评价。",
    "6. 输出严格 JSON，不要 Markdown。",
    "JSON格式：{\"review\":\"评价正文\"}",
  ].join("\n");

  const userPrompt = [
    "门店：时里白造物创意手作体验空间，圣名国际购物广场2层。",
    "现场提醒文案：真实带图评价可领取钥匙扣一枚，评价几个送几个。",
    `顾客体验项目：${project}`,
    `评价风格：${tone}`,
    `顾客真实关键词：${keywords || "没有填写，请生成通用但自然的到店体验"}`,
    "请生成一条适合大众点评/美团/小红书的真实体验评价。",
  ].join("\n");

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
        temperature: 0.85,
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
    const review = cleanText(parsed.review, "", 220);

    if (!review) {
      return json(res, 502, { error: "Invalid DeepSeek response" });
    }

    return json(res, 200, {
      review,
    });
  } catch (error) {
    console.error("Review API error", error);
    return json(res, 500, { error: "Server error" });
  } finally {
    clearTimeout(timeout);
  }
}
