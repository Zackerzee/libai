# 时里白造物 NIIMBOT B3S-P 本机打印桥

这个目录用于门店电脑本地运行。网页端无法直接访问 USB 标签机，所以需要在连接标签机的 Mac 上启动一个本机服务。

## 安装

```bash
cd local-printer
npm install
```

## 启动

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

## 测试打印

```bash
npm test
```

## 网页端触发

拼豆计时器开台成功后，会异步请求：

```text
POST http://127.0.0.1:17888/print-label
```

如果本机服务没有启动，计时器仍会正常开台，只是不会打印标签。
