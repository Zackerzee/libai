# 时里白造物 NFC 评价助手

这是部署到 Vercel 的 NFC / 二维码评价生成页面。

## 项目结构

```txt
/nfc/index.html       前端页面
/nfc/app.js           前端交互逻辑，只请求 /api/review
/nfc/review-library.js 本地随机评价兜底文案库
/print/index.html     顾客拼豆图纸上传页面
/admin/print-orders/  拼豆图纸后台页面
/api/review.js        Vercel Serverless Function
/api/print-orders/    Vercel 拼豆图纸上传 / 查询 / 下载接口
/functions/api/print-orders/ Cloudflare Pages Functions 版本，使用 PRINT_UPLOADS R2 binding
/cloudflare/print-orders-worker.js Cloudflare Worker 版本，用于在 Vercel 站点上接管 /api/print-orders*
/wrangler.print-orders.toml Cloudflare Worker 路由和 R2 binding 配置
/package.json         Vercel / Node 项目配置，type: "module"
/.gitignore           忽略本地环境变量和依赖目录
/README.md            部署说明
```

## 调用链路

```txt
/nfc/index.html
  ↓ POST /api/review
/api/review.js
  ↓ DeepSeek → 通义千问/阿里云百炼 → 文心千帆/百度千帆 → Gemini
  ↓
返回评价 review + 3 张图建议 photoTips
```

前端不会直接请求任何 AI API，也不会包含 `DEEPSEEK_API_KEY`、`QWEN_API_KEY`、`QIANFAN_API_KEY` 或 `GEMINI_API_KEY`。

## Vercel 环境变量

在 Vercel 项目中配置：

```txt
DEEPSEEK_API_KEY=你的 DeepSeek API 密钥
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-chat

QWEN_API_KEY=你的阿里云百炼或 DashScope Key
QWEN_BASE_URL=https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions
QWEN_MODEL=qwen-plus

QIANFAN_API_KEY=你的百度千帆 Key
QIANFAN_BASE_URL=https://qianfan.baidubce.com/v2/chat/completions
QIANFAN_MODEL=ERNIE-Speed-8K

GEMINI_API_KEY=你的 Gemini Key
GEMINI_MODEL=gemini-1.5-flash
```

不要把真实 Key 写入前端、`.env`、`.env.local` 或提交到 GitHub。

`/api/review` 会按顺序尝试 DeepSeek、通义千问、文心千帆、Gemini。某个模型缺少 Key、超时、返回空内容或内容未通过门店规则校验时，会自动切换到下一个模型。所有模型都失败时接口返回非 2xx JSON，前端会触发本地碎碎念评价兜底。

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

## 拼豆图纸打印

顾客页面：

```txt
/print
```

后台页面：

```txt
/admin/print-orders
```

顾客上传 JPG / PNG / PDF 后，系统会生成订单号。后台输入 PIN 后可以查看最近 7 天订单并下载图纸。网页不会直接调用打印机，最终由店员确认后打印。

### Cloudflare Pages + R2 配置

如果部署到 Cloudflare Pages，请在项目中绑定 R2 bucket：

```txt
Binding name: PRINT_UPLOADS
```

并配置环境变量：

```txt
PRINT_ADMIN_PIN=你的后台 PIN
```

R2 生命周期规则需要手动配置，避免长期保存顾客图纸：

```txt
规则名称：delete-perler-print-orders-after-7-days
规则前缀：perler-print-orders/
过期时间：7 天
```

如果使用 Wrangler，可参考：

```bash
npx wrangler r2 bucket lifecycle add PRINT_UPLOADS delete-perler-print-orders-after-7-days perler-print-orders/ --expire-days 7
```

如果实际 bucket 名称不是 `PRINT_UPLOADS`，请把命令里的 bucket 名称替换成真实名称。

### Vercel + Cloudflare Worker + R2 配置

当前线上站点部署在 Vercel，但 `/api/print-orders*` 由 Cloudflare Worker 接管，并通过 R2 binding 写入私有 bucket。这样不需要在 Vercel 配置 R2 S3 密钥，也不会把文件公开到前端。

```txt
Worker name: libai-print-orders
Route: www.libms.net/api/print-orders*
R2 bucket: print-uploads
Binding name: PRINT_UPLOADS
Secret: PRINT_ADMIN_PIN
```

文件会写入私有 R2 bucket，路径统一为：

```txt
perler-print-orders/YYYY-MM-DD/PB-MMDD-XXXXX/
```

部署 / 更新 Worker：

```bash
npx wrangler secret put PRINT_ADMIN_PIN --config wrangler.print-orders.toml
npx wrangler deploy --config wrangler.print-orders.toml
```

不要把 PIN、R2 密钥或任何 `.env*` 文件写入前端或提交到 GitHub。
