# 时里白造物 NIIMBOT B3S-P 本机打印桥

这个目录用于门店电脑本地运行。网页端无法直接访问 USB 标签机，所以需要在连接标签机的电脑上启动一个本机服务。

```text
网页计时器
  -> http://127.0.0.1:17888/print-label
  -> 本机打印桥
  -> NIIMBOT B3S-P
```

## Windows 快速使用

Windows 版脚本在：

```text
local-printer/windows/
```

使用顺序：

```text
1. 安装 Node.js 18+、Python 3、精臣/USB 串口驱动
2. 双击 windows/check-com-ports.bat 查看 COM 口
3. 复制 windows/printer.env.example 为 windows/printer.env
4. 修改 LIBMS_NIIMBOT_PORT=COM3 之类的真实端口
5. 双击 windows/start-print-service.bat 启动打印桥
6. 双击 windows/test-print.bat 测试打印
7. 成功后可双击 windows/install-autostart.bat 设置开机自启
```

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
