# 里白造物拼豆图纸生成器独立站部署

这是一个纯前端静态站，不需要后端、不需要数据库。图片处理、像素化、图纸生成都在用户浏览器本地完成。

## 最推荐上传方式

直接上传 `deploy` 文件夹里的所有内容。这个文件夹已经整理好了独立站需要的静态文件，不包含无关工程目录。

## 需要上传的前端文件

**不要手工挑文件。** 站点是模块化的，`app.js` 会动态 `import` 一批子模块，
漏掉任何一个都会让页面白屏或功能静默失效。完整的收录范围由
`tools/sync-deploy.mjs` 的清单定义，共 215 个文件。

根级入口文件（清单里的 `INCLUDE_FILES`）：

- `index.html`（主工作台）、`algorithm-lab.html`（算法实验页）
- `app.js`、`styles.css`
- `favicon.svg`、`libai-logo-pixel.svg`（站点 logo，**在用**）
- `libai-logo.png`（1.0 MB，**全站零引用**，历史遗留，可删）
- 可选：`pricing.html`、`pricing.css`、`pricing.js`

必须整目录一起上传的（漏了必坏）：

| 目录 | 作用 |
|---|---|
| `styles/` | `tokens.css` `workspace.css` `generation-editor.css` `pixler-skin.css` |
| `vendor/` | `qrcode.js`、`fflate.js`、`fusion-pixel/`（全站界面字体，81 个文件） |
| `ui/` | 工作台界面模块 |
| `services/` | OCR、库存、形状、图纸图例等服务 |
| `smart-preprocessing/` | 像素化与配色算法 |
| `src/` | 算法引擎（BGS、自适应分辨率、hybrid-v2 等） |
| `state/` | 工程状态存储 |
| `importers/` | `.pixler` 项目文件导入 |

独立站配置文件：

- `netlify.toml`：Netlify 使用
- `vercel.json`：Vercel 使用
- `_headers`：Cloudflare Pages / Netlify 静态头配置
- `.nojekyll`：GitHub Pages 使用，避免静态资源被 Jekyll 处理

**不发布的内容**（清单已排除）：`tests/`、`tools/`、`*.test.mjs`、
`docs/`（3.7 MB 内部工程文档，站点无任何链接引用）、`outputs/`。

## 改完源码后必须同步发布目录

`deploy/` 是**手工维护的副本**，改了源码不会自动跟。曾经出过一次事故：
`deploy/` 缺了 `styles/pixler-skin.css` 和 `vendor/fusion-pixel/`，
`index.html` / `app.js` 也是旧版 —— 整套皮肤一发布就消失。

```bash
node tools/sync-deploy.mjs --check   # 只看差异，有漂移退出码 1
node tools/sync-deploy.mjs           # 同步（只增改，不删）
node tools/sync-deploy.mjs --prune   # 同步并清理多余文件（破坏性，先备份）
```

`tests/deploy-sync.test.mjs` 已纳入常规测试：发布目录缺文件或落后于源码时，
`node --test` 会直接变红。**跑测试时必须显式枚举文件**
（`node --test <目录>` 在 Node 22 下会被当模块解析并报错）：

```bash
node --test $(find smart-preprocessing tests src -name '*.test.mjs' | sort)
```

## 推荐部署方式

### Netlify

1. 新建站点，选择手动上传或连接 GitHub 仓库。
2. 手动上传时，拖入 `deploy` 文件夹里的所有文件。
3. 连接 GitHub 仓库时，发布目录填 `deploy`。
4. 不需要构建命令。
5. 绑定自己的域名。

### Vercel

1. 新建项目，导入当前目录或 GitHub 仓库。
2. Framework 选择 `Other`。
3. Build Command 留空。
4. Output Directory 填 `deploy`。
5. 绑定自己的域名。

### Cloudflare Pages

1. 新建 Pages 项目，上传当前目录或连接 GitHub 仓库。
2. 构建命令留空。
3. 输出目录填 `deploy`。
4. 绑定自己的域名。

## 注意

- 如果只部署在海外平台并使用海外服务器，通常不需要中国大陆ICP备案。
- 如果使用中国大陆服务器、国内云厂商大陆节点、或国内 CDN，一般需要备案。
- 当前安全头已限制第三方嵌套、摄像头、麦克风、定位等权限。
- **图片审查与 OCR 都依赖 `cdn.jsdelivr.net`**（tfjs、nsfwjs、tesseract）
  和 `tessdata.projectnaptha.com`。这些域名在中国大陆经常被重置：
  - 审查失败会**静默放行**（不拦截，也不提示）
  - OCR 失败会给出可读提示，且不影响「手工录入 / CSV 导入 / 站内图纸直读」三条路径
  - 图片本身始终不上传到任何服务器
- `deploy/` 里有一个误 `git init` 出来的空仓库 `deploy/.git`（零提交、无远端），
  同步脚本会跳过它，建议删除。
