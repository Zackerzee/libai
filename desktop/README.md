# 时里白拼豆图纸工作台 · Windows 本地版

这是现有拼豆图纸生成网站的 Windows 桌面封装，不重写核心算法。

## 本地开发

在仓库根目录进入：

```bat
cd desktop
npm install
npm start
```

## 本地打包 Windows EXE

```bat
cd desktop
npm install
npm run dist:win
```

生成文件位于：

```txt
desktop/dist/
```

默认同时生成：
- NSIS 安装版 EXE
- Portable 免安装 EXE

## 离线原则

桌面版通过本机 `127.0.0.1` 临时 HTTP 服务加载现有前端，因此：
- 拼豆核心生成、Canvas、Web Worker、色卡匹配、项目导入导出、图纸下载继续使用现有前端代码；
- 图片生成过程不上传服务器；
- `/api/*` 在线接口在桌面离线模式下明确返回 `OFFLINE_DESKTOP`；
- NFC、在线打印订单、在线评价等网站入口在桌面版中隐藏；
- 外部 http/https 链接会交给系统默认浏览器打开。

## GitHub 自动构建

仓库中的 `.github/workflows/build-windows-desktop.yml` 会在 Windows Runner 上自动构建 EXE，并上传为 GitHub Actions Artifact。
