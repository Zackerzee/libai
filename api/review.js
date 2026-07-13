const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const DEFAULT_QWEN_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
const DEFAULT_QWEN_MODEL = "qwen-plus";
const DEFAULT_QIANFAN_BASE_URL = "https://qianfan.baidubce.com/v2/chat/completions";
const DEFAULT_QIANFAN_MODEL = "ernie-speed-8k";
const DEFAULT_QIANFAN_MODEL_CANDIDATES = [
  DEFAULT_QIANFAN_MODEL,
  "ernie-speed-pro-128k",
  "ernie-lite-8k",
  "ernie-3.5-8k",
  "ERNIE-Speed-8K",
];
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_GEMINI_MODEL = "gemini-1.5-flash";
const MIN_REVIEW_LENGTH = 75;
const MAX_REVIEW_LENGTH = 250;
const DEFAULT_PHOTO_TIPS = [
  "图1：作品或体验过程图。",
  "图2：门店环境或制作过程图。",
  "图3：朋友/亲子互动或完成作品图。",
];

const OFFICIAL_PROJECT_WHITELIST = [
  "串珠DIY",
  "拼豆",
  "海岛礼物",
  "韩国刺绣布贴",
  "毛料娃娃",
  "石膏娃娃DIY",
  "蔬果花皂DIY",
  "数字油画DIY",
  "台灯拼布手作",
  "夏日甜品冰淇淋",
  "香薰蜡烛",
  "中药香囊",
];

const PROJECT_ALIASES = {
  串珠: "串珠DIY",
  石膏彩绘: "石膏娃娃DIY",
  石膏娃娃: "石膏娃娃DIY",
  蔬果花皂: "蔬果花皂DIY",
  数字油画: "数字油画DIY",
  拼布台灯: "台灯拼布手作",
  台灯: "台灯拼布手作",
  刺绣布贴: "韩国刺绣布贴",
  香囊: "中药香囊",
};

const TEMPLATE_AND_MARKETING_WORDS = [
  "总之",
  "总而言之",
  "值得一提",
  "不容错过",
  "快来体验吧",
  "推荐大家",
  "强烈推荐",
  "欢迎大家",
  "店铺",
  "商家",
  "美甲",
  "美睫",
  "按摩",
  "理发",
  "摄影",
  "医美",
  "儿童乐园",
  "电玩城",
  "KTV",
  "酒店",
  "住宿",
  "培训机构",
  "培训班",
  "课程顾问",
  "老师专业",
  "一对一",
  "全程陪同",
  "老板人超好",
  "价格便宜",
  "性价比",
  "团购券",
  "优惠券",
  "宣传",
  "AI生成",
  "复制粘贴",
  "模板",
  "好评",
  "五星",
  "返现",
  "为了礼品",
  "为了礼物",
  "好评送",
  "好评返",
  "充卡",
  "会员",
  "打折",
  "余额",
  "12个项目",
  "所有项目",
  "全项目",
  "江油",
  "圣名",
  "广场",
  "地址",
  "商圈",
  "全江油第一",
  "有成就感",
  "天花板",
  "宝藏",
  "必须冲",
  "闭眼入",
  "绝绝子",
  "YYDS",
  "无敌",
  "封神",
];

const PIN_DOU_BAD_WORDS = [
  "自己熨烫",
  "自己上手熨烫",
  "教我怎么熨烫",
  "教我们怎么熨烫",
  "学习熨烫",
  "熨烫过程很有趣",
  "自己把作品熨好",
];

let recentReviews = [];

function json(res, statusCode, payload) {
  res.setHeader("Cache-Control", "no-store");
  return res.status(statusCode).json(payload);
}

function normalizeBaseUrl(value) {
  const baseUrl = String(value || DEFAULT_DEEPSEEK_BASE_URL).replace(/\/+$/, "");
  if (baseUrl === "https://api.deepseek.com") return `${baseUrl}/v1`;
  return baseUrl;
}

function normalizeChatCompletionsUrl(value, fallback) {
  const baseUrl = String(value || fallback).replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/chat/completions`;
}

function cleanText(value, fallback, maxLength) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) return fallback;
  return text.slice(0, maxLength);
}

function normalizeProject(value) {
  const raw = cleanText(value, "", 40);
  if (OFFICIAL_PROJECT_WHITELIST.includes(raw)) return raw;
  return PROJECT_ALIASES[raw] || raw;
}

function isOfficialProject(projectName) {
  return OFFICIAL_PROJECT_WHITELIST.includes(projectName);
}

function hasAnyWord(text, words) {
  const safeText = String(text || "");
  return words.some((word) => safeText.includes(word));
}

function textLength(text) {
  return Array.from(String(text || "").trim()).length;
}

function stripModelNoise(value) {
  return String(value || "")
    .trim()
    .replace(/^```(?:json|text)?/i, "")
    .replace(/```$/i, "")
    .replace(/^["“”'‘’]+|["“”'‘’]+$/g, "")
    .replace(/^(评价|点评|文案|输出|review)\s*[:：]\s*/i, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim();
}

function getEnvKey(...names) {
  for (const name of names) {
    const value = process.env[name];
    if (value && !value.includes("your-") && !value.includes("你的")) return value;
  }
  return "";
}

function getProviderTimeout(providerName) {
  const specific = Number(process.env[`${providerName}_TIMEOUT_MS`]);
  const fallback = Number(process.env.REVIEW_AI_TIMEOUT_MS || process.env.DEEPSEEK_TIMEOUT_MS);
  return Math.max(3000, Math.min(specific || fallback || 15000, 30000));
}

function parseCsvList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

async function fetchTextWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    return {
      ok: response.ok,
      status: response.status,
      text: await response.text(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function hasInvalidWords(text, projectName) {
  if (hasAnyWord(text, TEMPLATE_AND_MARKETING_WORDS)) return true;
  if (projectName === "拼豆" && hasAnyWord(text, PIN_DOU_BAD_WORDS)) return true;
  if (countPunctuation(text, "！") + countPunctuation(text, "!") > 1) return true;
  return false;
}

function countPunctuation(text, mark) {
  return String(text || "").split(mark).length - 1;
}

function looksTooFormal(text) {
  const safeText = String(text || "");
  const formalPatterns = [
    /本次体验.{0,12}整体/,
    /在.{0,10}体验了/,
    /环境.{0,8}服务.{0,8}项目/,
    /无论是.{0,20}都/,
    /非常适合.{0,20}人群/,
    /让人感受到/,
  ];
  return formalPatterns.some((pattern) => pattern.test(safeText));
}

function countWildDetailGroups(text) {
  const safeText = String(text || "");
  const detailGroups = [
    ["外面热", "太热", "避暑", "空调", "放的歌", "歌很好听", "安静", "发呆", "放空", "戒掉手机", "少刷"],
    ["手残", "搞砸", "图纸", "抓瞎", "丑萌", "体力活", "摆烂"],
    ["今日份", "晒图", "朋友圈", "快乐", "绝美", "存档", "纪念"],
  ];
  return detailGroups.filter((group) => group.some((word) => safeText.includes(word))).length;
}

function isTooSimilarToRecent(text) {
  const safeText = String(text || "").trim();
  if (!safeText) return true;
  if (recentReviews.includes(safeText)) return true;
  const signature = ["手残", "外面热", "手机", "发呆", "空调", "拍照", "丑萌", "摆烂", "上头", "快乐"].filter((word) =>
    safeText.includes(word),
  );
  if (signature.length === 0) return false;
  return recentReviews.some((oldReview) => signature.filter((word) => oldReview.includes(word)).length >= 2);
}

function getInvalidReason(review, projectName, { checkSimilarity = true } = {}) {
  const text = stripModelNoise(review);
  const length = textLength(text);
  if (!text) return "empty";
  if (length < MIN_REVIEW_LENGTH || length > MAX_REVIEW_LENGTH) return "length";
  if (hasInvalidWords(text, projectName)) return "bad_words";
  if (looksTooFormal(text)) return "formal";
  if (countWildDetailGroups(text) > 2) return "too_many_detail_groups";
  if (checkSimilarity && isTooSimilarToRecent(text)) return "similar";
  return "";
}

function recordRecentReview(review) {
  const text = stripModelNoise(review);
  if (!text) return;
  recentReviews.push(text);
  if (recentReviews.length > 30) {
    recentReviews = recentReviews.slice(recentReviews.length - 30);
  }
}

function buildSystemPrompt() {
  return `
You are a random customer who just completed a DIY handcraft project. Write one short, highly casual Chinese review based only on the provided project name.

[CRITICAL RULES]
1. 极致去中心化：绝对不固定句式。95% 的概率完全不提任何地址、商圈、地标、门店名，也绝对不提充卡、会员、打折、余额、钱、12个项目、所有项目等功利或商业词汇。
2. 盲盒细节抽样：每次生成必须且只能从以下野生细节里随机抓取 1 个，严禁面面俱到：
   - 细节 A：外面太热/进来避暑、空调很足、放的歌很好听、环境安静适合发呆放空、戒掉手机几小时。
   - 细节 B：手残党差点搞砸、幸好有图纸不然抓瞎、成品丑萌丑萌的很治愈、自己动手是个体力活。
   - 细节 C：极度精简，只有一两句话，类似朋友圈晒图配文。
3. 仿生红线：严禁出现“总之、总而言之、值得一提、不容错过、快来体验吧”等 AI 模板腔。短句为主，多用空格代替逗号，允许标点随意一点。
4. 门店范围：只能围绕创意手作体验写。可写的项目只有：拼豆、蔬果花皂DIY、香薰蜡烛、海岛礼物、串珠DIY、韩国刺绣布贴、毛料娃娃、石膏娃娃DIY、数字油画DIY、台灯拼布手作、夏日甜品冰淇淋、中药香囊。禁止写美甲、美睫、按摩、理发、摄影、医美、儿童乐园、电玩城、KTV、住宿、培训机构等不属于门店范围的内容。
5. 事实边界：不要编造价格、优惠、团购、会员、老师专业、一对一指导、全程陪同、老板人超好、排队、课程、生日会、团建等顾客没有提供的信息。
6. 拼豆规则：拼豆成品可以写店员帮忙处理成品，但禁止写顾客自己熨烫、店员教顾客熨烫、学习熨烫。
7. 字数必须控制在 75 到 250 个中文字之间，不能少于 75 字。
8. 只输出评价正文，不要 JSON、Markdown、前缀、括号、解释。
`.trim();
}

function buildReviewContext(body, projectName) {
  return {
    projectName,
    platform: cleanText(body.platform, "大众点评/美团", 40),
    tone: cleanText(body.tone, "自然真实", 40),
    keywords: cleanText(body.keywords, "", 160),
  };
}

function buildUserPrompt(context) {
  const keywordsText = context.keywords ? `顾客真实关键词：【${context.keywords}】。` : "顾客没有额外填写关键词。";
  return [
    `发布平台：【${context.platform}】。`,
    `体验项目：【${context.projectName}】。`,
    `评价语气：【${context.tone}】。`,
    keywordsText,
    "请直接输出针对该项目的野生人类评价文本，不要任何前缀、括号、解释和 Markdown 标记。",
  ].join("");
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

function parseOpenAICompatibleReview(raw, providerName) {
  const completion = JSON.parse(raw);
  const review = stripModelNoise(completion?.choices?.[0]?.message?.content || "");
  if (!review) throw new Error(`${providerName} returned empty review`);
  return review;
}

async function requestOpenAICompatibleReview({ providerName, apiKey, url, model, context, temperature = 1.1 }) {
  if (!apiKey) throw new Error(`${providerName} API key missing`);

  const result = await fetchTextWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: buildSystemPrompt() },
          { role: "user", content: buildUserPrompt(context) },
        ],
        temperature,
        max_tokens: 420,
      }),
    },
    getProviderTimeout(providerName),
  );

  if (!result.ok) {
    console.error(`${providerName} request failed`, result.status, result.text.slice(0, 500));
    throw new Error(`${providerName} request failed`);
  }

  return parseOpenAICompatibleReview(result.text, providerName);
}

async function fetchFromDeepSeek({ context }) {
  const apiKey = getEnvKey("DEEPSEEK_API_KEY");
  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);

  return requestOpenAICompatibleReview({
    providerName: "DEEPSEEK",
    apiKey,
    url: `${baseUrl}/chat/completions`,
    model,
    context,
    temperature: 1.1,
  });
}

async function fetchFromTongyiQianwen({ context }) {
  const apiKey = getEnvKey("QWEN_API_KEY", "ALIYUN_BAILIAN_API_KEY", "DASHSCOPE_API_KEY", "DOMESTIC_AI_API_KEY");
  const url = normalizeChatCompletionsUrl(
    process.env.QWEN_BASE_URL || process.env.ALIYUN_BAILIAN_BASE_URL || process.env.DOMESTIC_AI_BASE_URL,
    DEFAULT_QWEN_BASE_URL,
  );
  const model = cleanText(
    process.env.QWEN_MODEL || process.env.ALIYUN_BAILIAN_MODEL || process.env.DOMESTIC_AI_MODEL,
    DEFAULT_QWEN_MODEL,
    80,
  );

  return requestOpenAICompatibleReview({
    providerName: "QWEN",
    apiKey,
    url,
    model,
    context,
    temperature: 0.65,
  });
}

async function fetchFromWenxinQianfan({ context }) {
  const apiKey = getEnvKey("QIANFAN_API_KEY", "WENXIN_QIANFAN_API_KEY", "BAIDU_QIANFAN_API_KEY");
  const url = normalizeChatCompletionsUrl(process.env.QIANFAN_BASE_URL, DEFAULT_QIANFAN_BASE_URL);
  const models = [
    ...parseCsvList(process.env.QIANFAN_MODEL),
    ...DEFAULT_QIANFAN_MODEL_CANDIDATES,
  ].filter((model, index, list) => model && list.indexOf(model) === index);

  let lastError;
  for (const model of models) {
    try {
      return await requestOpenAICompatibleReview({
        providerName: "QIANFAN",
        apiKey,
        url,
        model,
        context,
        temperature: 0.85,
      });
    } catch (error) {
      lastError = error;
      console.error(`QIANFAN model failed: ${model}`, error instanceof Error ? error.message : String(error));
    }
  }

  throw lastError || new Error("QIANFAN request failed");
}

async function fetchFromGemini({ context }) {
  const apiKey = getEnvKey("GEMINI_API_KEY", "GOOGLE_GEMINI_API_KEY");
  if (!apiKey) throw new Error("GEMINI API key missing");

  const baseUrl = String(process.env.GEMINI_BASE_URL || DEFAULT_GEMINI_BASE_URL).replace(/\/+$/, "");
  const model = cleanText(process.env.GEMINI_MODEL, DEFAULT_GEMINI_MODEL, 80);
  const url = `${baseUrl}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const result = await fetchTextWithTimeout(
    url,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: buildSystemPrompt() }],
        },
        contents: [
          {
            role: "user",
            parts: [{ text: buildUserPrompt(context) }],
          },
        ],
        generationConfig: {
          temperature: 0.9,
          maxOutputTokens: 420,
        },
      }),
    },
    getProviderTimeout("GEMINI"),
  );

  if (!result.ok) {
    console.error("GEMINI request failed", result.status, result.text.slice(0, 500));
    throw new Error("GEMINI request failed");
  }

  const completion = JSON.parse(result.text);
  const review = stripModelNoise(
    completion?.candidates?.[0]?.content?.parts?.map((part) => part?.text || "").join("") || "",
  );
  if (!review) throw new Error("GEMINI returned empty review");
  return review;
}

async function generateReviewWithProviderChain(context) {
  const providers = [
    { name: "deepseek", fetcher: fetchFromDeepSeek },
    { name: "tongyi_qianwen", fetcher: fetchFromTongyiQianwen },
    { name: "wenxin_qianfan", fetcher: fetchFromWenxinQianfan },
    { name: "gemini", fetcher: fetchFromGemini },
  ];
  const errors = [];

  for (const provider of providers) {
    try {
      const review = await provider.fetcher({ context });
      const invalidReason = getInvalidReason(review, context.projectName);
      if (invalidReason) {
        throw new Error(`invalid_${invalidReason}`);
      }
      return {
        review,
        source: provider.name,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`${provider.name}:${message}`);
      console.warn(`Review provider failed, switching provider: ${provider.name}`, message);
    }
  }

  throw new Error(`All review providers failed: ${errors.join(" | ")}`);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return json(res, 405, { error: "Method Not Allowed" });
  }

  const body = await getBody(req);
  const projectName = normalizeProject(body.project);

  if (!isOfficialProject(projectName)) {
    console.error(`[安全拦截] 收到非法项目传入: ${body.project}`);
    return json(res, 200, {
      review: "项目未上线",
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source: "blocked",
      },
    });
  }

  const context = buildReviewContext(body, projectName);

  try {
    const { review, source } = await generateReviewWithProviderChain(context);
    recordRecentReview(review);
    return json(res, 200, {
      success: true,
      review,
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source,
      },
    });
  } catch (error) {
    console.error("Review API all providers failed", error);
    return json(res, 424, {
      success: false,
      error: "AI_PROVIDERS_FAILED",
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source: "provider_chain_failed",
      },
    });
  }
}
