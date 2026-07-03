# 时里白造物 NFC 评价助手

这是部署到 Vercel 的 NFC / 二维码评价生成页面。

## 项目结构

```txt
/nfc/index.html       前端页面
/nfc/app.js           前端交互逻辑，只请求 /api/review
/nfc/review-library.js 本地随机评价兜底文案库
/api/review.js        Vercel Serverless Function
/package.json         Vercel / Node 项目配置，type: "module"
/.gitignore           忽略本地环境变量和依赖目录
/README.md            部署说明
```

## 调用链路

```txt
/nfc/index.html
  ↓ POST /api/review
/api/review.js
  ↓ process.env.DEEPSEEK_API_KEY
DeepSeek
  ↓
返回评价 review + 3 张图建议 photoTips
```

前端不会直接请求 DeepSeek API，也不会包含 `DEEPSEEK_API_KEY`。

## Vercel 环境变量

在 Vercel 项目中配置：

```txt
DEEPSEEK_API_KEY=你的 DeepSeek API 密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat
```

不要把真实 Key 写入前端、`.env`、`.env.local` 或提交到 GitHub。

## 本地开发

本地可以创建 `.env.local` 或 `.env`，但这些文件已被 `.gitignore` 忽略。

```bash
npm run check
npm run dev
```

## Vercel 部署

1. 推送到 GitHub。
2. 在 Vercel 中选择 Import Git Repository。
3. Framework Preset 选择 `Other`。
4. 配置 Environment Variables。
5. Deploy。
6. 绑定域名 `nfc.libms.net`。

当前 `vercel.json` 已配置 host rewrite：访问 `https://nfc.libms.net/` 会显示 `/nfc` 页面。
