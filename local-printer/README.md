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
1. 先右键 zip，选择“全部解压”
2. 打开精臣 B3S-P 并用 USB 插到 Windows 电脑
3. 双击 1-START-WINDOWS.cmd
4. 等它自动安装依赖、识别 USB / 蓝牙 COM 口并启动打印桥
5. 打开 https://www.libms.net/mentor-timer 开台测试
```

新版强制使用串口协议，不依赖 Windows “打印机和扫描仪”里的系统驱动。即使那里显示 DYMO、驱动错误、脱机，也不影响网页计时器；关键是设备管理器里要有 COM 口。`.bat` 文件只作为兼容入口，优先使用 `.cmd`。

Windows 默认配置：

```text
LIBMS_NIIMBOT_PORT=auto
LIBMS_TRY_BLUETOOTH_PORTS=0
```

也就是自动选择 USB/非蓝牙 COM 口，默认跳过蓝牙 COM，避免 `Timeout waiting response` 和 `Operation aborted`。

Windows 版还会识别 `NIIMBOT B3S_P` 系统打印队列。串口协议失败时，如果检测到 Windows 打印机名，会自动用系统队列再尝试一次。

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
