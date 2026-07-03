# 里白造物拼豆图纸生成器独立站部署

这是一个纯前端静态站，不需要后端、不需要数据库。图片处理、像素化、图纸生成都在用户浏览器本地完成。

## 最推荐上传方式

直接上传 `deploy` 文件夹里的所有内容。这个文件夹已经整理好了独立站需要的静态文件，不包含无关工程目录。

## 需要上传的前端文件

- `index.html`
- `styles.css`
- `app.js`
- `libai-logo-pixel.svg`
- `libai-logo.png`
- `favicon.svg`
- `assets/fonts/DottedSongtiSquareRegular.otf`

可选页面：

- `pricing.html`
- `pricing.css`
- `pricing.js`
- `review-helper.html`
- `review.html`
- `review-helper.css`
- `review-helper.js`
- `nfc/index.html`
- `nfc/app.js`

可选后端接口：

- `api/review.js`：NFC 页面使用的 DeepSeek AI 评价生成接口，只在 Vercel 等支持 Serverless Function 的平台生效。

独立站配置文件：

- `netlify.toml`：Netlify 使用
- `vercel.json`：Vercel 使用
- `_headers`：Cloudflare Pages / Netlify 静态头配置
- `.nojekyll`：GitHub Pages 使用，避免静态资源被 Jekyll 处理

## 推荐部署方式

### Netlify

1. 新建站点，选择手动上传或连接 GitHub 仓库。
2. 手动上传时，拖入 `deploy` 文件夹里的所有文件。
3. 连接 GitHub 仓库时，发布目录填 `deploy`。
3. 不需要构建命令。
4. 绑定自己的域名。

### Vercel

1. 新建项目，导入当前目录或 GitHub 仓库。
2. Framework 选择 `Other`。
3. Build Command 留空。
4. Output Directory 填 `deploy`。
5. 绑定自己的域名。
6. 如果启用 `/nfc/` AI 评价功能，在环境变量中配置：
   - `DEEPSEEK_API_KEY`
   - `DEEPSEEK_BASE_URL=https://api.deepseek.com`
   - `DEEPSEEK_MODEL=deepseek-chat`

NFC 最终写入地址：

```txt
https://www.libms.net/nfc/
```

### Cloudflare Pages

1. 新建 Pages 项目，上传当前目录或连接 GitHub 仓库。
2. 构建命令留空。
3. 输出目录填 `deploy`。
4. 绑定自己的域名。

## 注意

- 如果只部署在海外平台并使用海外服务器，通常不需要中国大陆ICP备案。
- 如果使用中国大陆服务器、国内云厂商大陆节点、或国内 CDN，一般需要备案。
- 当前安全头已限制第三方嵌套、摄像头、麦克风、定位等权限。
- 图片审查模型、PDF 导出等第三方依赖已随站点自托管；图片与项目数据不会上传到服务器。
- `/nfc/` 页面不会在前端保存顾客资料；DeepSeek API Key 必须只配置在后端环境变量里，不能写入页面代码。
