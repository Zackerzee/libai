const DEFAULT_DEEPSEEK_BASE_URL = "https://api.deepseek.com/v1";
const DEFAULT_DEEPSEEK_MODEL = "deepseek-chat";
const MIN_REVIEW_LENGTH = 36;
const MAX_REVIEW_LENGTH = 75;
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

const WILD_FALLBACKS = [
  "今日份手作存档，做了{project}，比我想的更费手，弄完只想先拍照炫一下。",
  "外面热到不想动，坐下来做了个{project}，慢慢弄完，手机都少刷了好一会儿。",
  "手残党挑战{project}，中间一度怀疑自己，最后看着还行，丑萌丑萌的我也喜欢。",
  "本来只是随便试试{project}，结果做着做着安静下来了，时间过得比刷手机快。",
  "做{project}的时候有点上头，前面还在纠结怎么弄，后面就只想赶紧看看最后效果。",
  "今天不想走路逛太久，就坐下来弄了个{project}，过程比想象中更消磨时间。",
  "{project}完成，手是真的忙，脑子反而放空了一会儿，这种慢吞吞的感觉还不错。",
  "给自己安排了一点手作时间，做了{project}，不算完美，但越看越觉得是我的风格。",
  "做了一下午{project}，中途差点想摆烂，最后拿起来看看又觉得还蛮可爱。",
  "今日份快乐来自{project}，手忙脚乱了一阵，最后居然也能看，先发出来纪念一下。",
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

function randomItem(items) {
  return items[Math.floor(Math.random() * items.length)];
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
  if (countWildDetailGroups(text) > 1) return "too_many_detail_groups";
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

function ensureMinimumReviewLength(review) {
  const text = stripModelNoise(review);
  if (textLength(text) >= MIN_REVIEW_LENGTH) return text;
  return `${text} 拿回去看了看也还行。`;
}

function makeWildFallback(projectName) {
  for (let index = 0; index < 30; index += 1) {
    const candidate = ensureMinimumReviewLength(randomItem(WILD_FALLBACKS).replaceAll("{project}", projectName));
    if (!getInvalidReason(candidate, projectName, { checkSimilarity: true })) return candidate;
  }

  for (let index = 0; index < 30; index += 1) {
    const candidate = ensureMinimumReviewLength(randomItem(WILD_FALLBACKS).replaceAll("{project}", projectName));
    if (!getInvalidReason(candidate, projectName, { checkSimilarity: false })) return candidate;
  }

  return ensureMinimumReviewLength(`今日份手作存档，做了${projectName}，过程有点忙乱，最后看着还行，先发出来纪念一下。`);
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
4. 字数必须大于 35 个中文字，控制在 36 到 75 个中文字之间，越长越假。
5. 只输出评价正文，不要 JSON、Markdown、前缀、括号、解释。
`.trim();
}

function buildUserPrompt(projectName) {
  return `输入项目：【${projectName}】。请直接输出针对该项目的野生人类评价文本，不要任何前缀、括号、解释和 Markdown 标记。`;
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

async function requestDeepSeekWildReview({ apiKey, baseUrl, model, signal, projectName }) {
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
        { role: "user", content: buildUserPrompt(projectName) },
      ],
      temperature: 1.1,
      max_tokens: 120,
    }),
    signal,
  });

  const raw = await response.text();
  if (!response.ok) {
    console.error("DeepSeek request failed", response.status, raw.slice(0, 500));
    throw new Error("DeepSeek request failed");
  }

  const completion = JSON.parse(raw);
  return stripModelNoise(completion?.choices?.[0]?.message?.content || "");
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

  const apiKey = process.env.DEEPSEEK_API_KEY;
  const baseUrl = normalizeBaseUrl(process.env.DEEPSEEK_BASE_URL || process.env.DEEPSEEK_API_BASE_URL);
  const model = cleanText(process.env.DEEPSEEK_MODEL, DEFAULT_DEEPSEEK_MODEL, 80);

  if (!apiKey || apiKey.includes("your-deepseek-api-key")) {
    const review = makeWildFallback(projectName);
    recordRecentReview(review);
    return json(res, 200, {
      review,
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source: "fallback_missing_key",
      },
    });
  }

  const timeoutMs = Math.max(3000, Math.min(Number(process.env.DEEPSEEK_TIMEOUT_MS) || 15000, 30000));
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let review = await requestDeepSeekWildReview({
      apiKey,
      baseUrl,
      model,
      signal: controller.signal,
      projectName,
    });

    let invalidReason = getInvalidReason(review, projectName);
    if (invalidReason === "similar") {
      const retryReview = await requestDeepSeekWildReview({
        apiKey,
        baseUrl,
        model,
        signal: controller.signal,
        projectName,
      });
      const retryInvalidReason = getInvalidReason(retryReview, projectName);
      if (!retryInvalidReason) {
        review = retryReview;
        invalidReason = "";
      } else {
        invalidReason = retryInvalidReason;
      }
    }

    if (invalidReason) {
      review = makeWildFallback(projectName);
    }

    recordRecentReview(review);
    return json(res, 200, {
      review,
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source: invalidReason ? `fallback_${invalidReason}` : "deepseek",
      },
    });
  } catch (error) {
    console.error("Review API error", error);
    const review = makeWildFallback(projectName);
    recordRecentReview(review);
    return json(res, 200, {
      review,
      photoTips: DEFAULT_PHOTO_TIPS,
      debug: {
        project: projectName,
        source: "fallback_error",
      },
    });
  } finally {
    clearTimeout(timeout);
  }
}
