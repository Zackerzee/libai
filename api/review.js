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
  "商圈",
  "全江油第一",
  "有成就感",
  "超级多",
  "超多",
  "超好",
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

const NEGATIVE_REVIEW_WORDS = [
  "差评",
  "踩雷",
  "避雷",
  "不推荐",
  "后悔",
  "浪费钱",
  "不好玩",
  "太差",
  "很差",
  "一般般",
  "不值",
  "坑人",
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
  if (hasAnyWord(text, NEGATIVE_REVIEW_WORDS)) return true;
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

function getProjectWords(projectName) {
  const map = {
    串珠DIY: ["串珠", "珠子", "手链", "配饰"],
    拼豆: ["拼豆", "豆子", "图案", "小板", "熨烫"],
    海岛礼物: ["海岛礼物", "海岛", "摆件", "小物"],
    韩国刺绣布贴: ["刺绣", "布贴", "韩国刺绣布贴", "贴布"],
    毛料娃娃: ["毛料娃娃", "毛线", "娃娃"],
    石膏娃娃DIY: ["石膏", "石膏娃娃", "上色", "彩绘"],
    蔬果花皂DIY: ["花皂", "蔬果花皂", "香皂", "皂"],
    数字油画DIY: ["数字油画", "油画", "画布", "涂色"],
    台灯拼布手作: ["台灯", "拼布", "灯"],
    夏日甜品冰淇淋: ["冰淇淋", "甜品", "夏日甜品"],
    香薰蜡烛: ["香薰", "蜡烛", "香味"],
    中药香囊: ["香囊", "中药香囊", "香包"],
  };
  return map[projectName] || [projectName];
}

function hasReferenceValue(text, projectName) {
  const safeText = String(text || "");
  const dimensions = [
    getProjectWords(projectName),
    ["适合", "亲子", "孩子", "小朋友", "朋友", "新手", "一个人", "带娃", "家人", "情侣"],
    ["上手", "步骤", "难度", "不复杂", "简单", "需要耐心", "慢慢", "不赶", "坐下来", "耗时", "时间"],
    ["颜色", "图案", "材料", "工具", "款式", "选择", "搭配", "尺寸"],
    ["成品", "作品", "带走", "留念", "摆", "挂", "包装", "熨烫"],
    ["圣名", "江油", "商场", "二层", "位置", "路过", "逛街", "休息"],
    ["拍照", "照片", "记录", "发图", "出片"],
  ];
  const hitCount = dimensions.filter((group) => group.some((word) => safeText.includes(word))).length;
  return hitCount >= 3;
}

function hasUnprovidedTimeWords(text, keywords) {
  const safeText = String(text || "");
  const safeKeywords = String(keywords || "");
  const timeWords = ["周末", "假期", "下班后", "放学后", "晚上", "下午"];
  return timeWords.some((word) => safeText.includes(word) && !safeKeywords.includes(word));
}

function hasUnsupportedUseClaims(text, keywords) {
  const safeText = String(text || "");
  const safeKeywords = String(keywords || "");
  if (safeText.includes("钥匙扣") && !safeKeywords.includes("钥匙扣")) return true;
  if (/(挂包|包上|挂在包)/.test(safeText) && !/(挂包|包上|挂在包|包)/.test(safeKeywords)) return true;
  return false;
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

function getInvalidReason(review, projectName, keywords = "", { checkSimilarity = true } = {}) {
  const text = stripModelNoise(review);
  const length = textLength(text);
  if (!text) return "empty";
  if (length < MIN_REVIEW_LENGTH || length > MAX_REVIEW_LENGTH) return "length";
  if (hasInvalidWords(text, projectName)) return "bad_words";
  if (hasUnprovidedTimeWords(text, keywords)) return "unprovided_time";
  if (hasUnsupportedUseClaims(text, keywords)) return "unsupported_use_claim";
  if (looksTooFormal(text)) return "formal";
  if (!hasReferenceValue(text, projectName)) return "low_reference_value";
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
你是“时里白造物”的门店评价整理助手，不是营销文案助手。
你的任务是：根据顾客选择的手作项目、平台、语气和真实关键词，生成一条正向、自然、对其他顾客有参考价值的中文评价。

[高质量评价标准]
1. 必须是正向评价，但要像真实顾客写的，不要像商家广告。
2. 评价要对别人有参考意义，至少包含 3 类信息：体验项目、适合人群/消费场景、上手难度或耗时感受、材料/颜色/图案选择、成品是否能带走、拍照记录、位置是否方便。
3. 每条只选 2 到 4 个重点，不要把所有优点堆满。
4. 允许口语化，但不要低质碎碎念；不要只写“开心、不错、好玩、下次再来”。
5. 不要每条都写门店名；可以偶尔写“圣名国际”“江油”，但不要硬塞地址。
6. 门店范围只能写：拼豆、蔬果花皂DIY、香薰蜡烛、海岛礼物、串珠DIY、韩国刺绣布贴、毛料娃娃、石膏娃娃DIY、数字油画DIY、台灯拼布手作、夏日甜品冰淇淋、中药香囊。禁止写美甲、美睫、按摩、理发、摄影、医美、儿童乐园、电玩城、KTV、住宿、培训机构等不属于门店范围的内容。
7. 事实边界：不要编造价格、优惠、团购、会员、老师特别专业、一对一指导、全程陪同、老板人超好、排队、课程、生日会、团建等顾客没有提供的信息。
8. 拼豆规则：拼豆成品可以偶尔写“店员帮忙处理成品/熨烫”，但禁止写顾客自己熨烫、店员教顾客熨烫、学习熨烫。
9. 如果关键词没有提到周末、假期、下班后、放学后、晚上、下午，就不要主动写这些具体时间。
10. 不要把成品默认写成钥匙扣、挂包、送礼，除非关键词明确提供。
11. 禁止平台违规或诱导表达：好评、五星、返现、为了礼品、好评送、好评返、复制粘贴、AI生成、模板。
12. 禁止夸张营销词：天花板、宝藏、必须冲、闭眼入、绝绝子、YYDS、无敌、封神、强烈推荐、快来体验吧、超级多、超多。
13. 字数必须控制在 75 到 250 个中文字之间。
14. 只输出评价正文，不要 JSON、Markdown、前缀、括号、解释。
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
    "请写一条高质量正向评价：要自然，但必须能给其他顾客提供参考，比如适合谁、项目难不难、材料选择、作品效果、是否适合拍照或带走等。",
    "如果关键词没有提到孩子、朋友、店员、价格、具体时间，就不要主动编造这些信息。",
    "如果关键词没有提到周末、假期、下午、晚上等时间，就不要写这些时间；如果关键词没有提到钥匙扣、挂包、送礼，就不要写这些成品用途。",
    "请直接输出评价正文，不要任何前缀、括号、解释和 Markdown 标记。",
  ].join("");
}

function makeReferenceFallback(context) {
  const project = context.projectName || "手作";
  const hasChild = /孩子|小朋友|亲子|带娃/.test(context.keywords || context.tone || "");
  const hasFriend = /朋友|闺蜜|同事|一起/.test(context.keywords || context.tone || "");
  const audience = hasChild ? "带孩子来体验" : hasFriend ? "朋友一起过来" : "想找个室内活动的时候过来";

  if (project === "拼豆") {
    return `${audience}拼豆比较合适，颜色和图案选择比较多，前面选款会花一点时间。制作过程不算复杂，但需要耐心慢慢拼，做完的成品由店员帮忙熨烫处理，可以带走留作纪念。整体是比较轻松的体验，适合想坐下来做点小东西的人。`;
  }

  return `${audience}做${project}比较合适，项目上手不算复杂，材料和样式选择比较直观，可以按照自己的节奏慢慢完成。做完以后有作品可以带走，也适合拍几张过程照和成品照。整体体验比较轻松，对第一次尝试手作的人也比较友好。`;
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
    temperature: 0.72,
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
    temperature: 0.72,
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
        temperature: 0.75,
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
          temperature: 0.75,
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
      const invalidReason = getInvalidReason(review, context.projectName, context.keywords);
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
    const review = makeReferenceFallback(context);
    recordRecentReview(review);
    return json(res, 200, {
      success: true,
      review,
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source: "safe_fallback",
      },
    });
  }
}
