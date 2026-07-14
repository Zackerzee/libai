# 时里白造物 NIIMBOT B3S-P 本机打印桥

这个目录用于门店电脑本地运行。网页端无法直接访问 USB 标签机，所以需要在连接标签机的电脑上启动一个本机服务。

```text
网页计时器
  -> http://127.0.0.1:17888/print-label
  -> 本机打印桥
  -> NIIMBOT B3S-P
```

## Windows 一键安装所有

Windows 版脚本在：

```text
local-printer/windows/
```

使用顺序：

```text
1. 打开精臣 B3S-P 并用 USB 插到 Windows 电脑
2. 双击 windows/one-click-install-start.bat
3. 等它自动安装依赖、识别 COM 口并启动打印桥
4. 打开 https://www.libms.net/mentor-timer 开台测试
```

如果一键脚本失败，再使用 windows/README-Windows.md 里的手动排查步骤。

详细说明见：

```text
local-printer/windows/README-Windows.md
```

## Mac 手动安装

### 安装

```bash
cd local-printer
npm install
```

### 启动

```bash
npm start
```

默认监听：

```text
http://127.0.0.1:17888
```

默认串口：

```text
/dev/cu.usbmodem1301
```

如果串口变化，可以这样启动：

```bash
LIBMS_NIIMBOT_PORT=/dev/cu.usbmodem1301 npm start
```

### 测试打印

```bash
npm test
```

## 网页端触发

拼豆计时器开台成功后，会异步请求：

```text
POST http://127.0.0.1:17888/print-label
```

如果本机服务没有启动，计时器仍会正常开台，只是不会打印标签。
