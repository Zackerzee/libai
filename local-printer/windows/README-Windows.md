# Windows 使用说明：时里白造物 NIIMBOT B3S-P 本机打印桥

网页无法直接控制 USB 标签机。Windows 电脑需要先运行这个本机打印桥：

```text
网页 https://www.libms.net/mentor-timer
  -> http://127.0.0.1:17888/print-label
  -> Windows 本机打印桥
  -> 精臣 B3S-P 标签机
```

## 一键安装所有

先右键 zip 选择“全部解压”，再把精臣 B3S-P 开机并用 USB 插到 Windows 电脑。

推荐直接双击解压目录根部的：

```text
1-START-WINDOWS.cmd
```

也可以进入 `windows` 文件夹后双击：

```text
one-click-install-start.cmd
```

它会自动完成：

1. 检查并尝试安装 Node.js；
2. 检查并尝试安装 Python；
3. 安装 Pillow 图片依赖；
4. 安装 Node 打印依赖；
5. 自动识别精臣 B3S-P 的 USB / 蓝牙 COM 串口；
6. 强制使用串口协议打印；
7. 忽略 Windows 系统打印机驱动和打印队列；
8. 生成 `printer.env`；
9. 启动本机打印桥。

窗口不要关闭。看到 `LIBMS NIIMBOT print bridge listening` 后，再打开网页计时器开台。

正常情况下只需要这一步。下面的手动步骤只用于一键脚本失败时排查。

## 1. 手动准备环境

Windows 电脑需要安装：

1. Node.js 18 或更高版本；
2. Python 3；
3. 精臣 B3S-P / USB 串口驱动。

## 2. 查看打印模式

新版一键脚本默认强制使用串口模式，并支持自动选择串口：

```text
LIBMS_PRINT_METHOD=serial
LIBMS_NIIMBOT_PORT=auto
```

也就是说：不需要在 Windows “打印机和扫描仪”里把精臣配置成可打印队列。那里如果显示 DYMO、驱动错误、脱机，都不作为网页计时器的判断依据。

网页计时器真正需要的是设备管理器里出现一个 COM 口，例如：

```text
COM3 USB 串行设备
```

`auto` 模式不是只靠名字猜端口。打印桥会在打印前按顺序尝试 COM 口，只有能拿到精臣打印机信息的端口才会继续打印；蓝牙串口会排到最后。
最新版默认不会尝试蓝牙 COM 口，因为 Windows 下蓝牙串口容易出现 `Timeout waiting response` 或 `Operation aborted`，导致打印桥异常退出。

默认配置应保持：

```text
LIBMS_NIIMBOT_PORT=auto
LIBMS_TRY_BLUETOOTH_PORTS=0
```

只有明确要用蓝牙连接时，才把 `LIBMS_TRY_BLUETOOTH_PORTS` 改成 `1`。

## 3. 查看串口号

双击：

```text
check-com-ports.bat
```

记下类似 `COM3`、`COM4` 的端口号。

## 4. 配置串口 / 打印机

复制：

```text
printer.env.example
```

改名为：

```text
printer.env
```

推荐保持自动选择：

```text
LIBMS_NIIMBOT_PORT=auto
```

如果自动选择失败，再把里面的端口改成真实 USB 端口，例如：

```text
LIBMS_NIIMBOT_PORT=COM3
```

如果设备管理器显示的是 `COM10` 或更大的端口号，也直接填写：

```text
LIBMS_NIIMBOT_PORT=COM10
```

打印桥会自动转换为 Windows 串口需要的内部格式。

中文标签字体默认使用微软雅黑：

```text
LIBMS_LABEL_FONT=C:\Windows\Fonts\msyh.ttc
```

打印模式保持：

```text
LIBMS_PRINT_METHOD=serial
```

`LIBMS_WINDOWS_PRINTER_NAME` 留空即可。

## 5. 启动打印桥

双击：

```text
start-print-service.bat
```

窗口不要关闭。正常时会看到：

```text
打印桥即将启动：
- 服务地址：http://127.0.0.1:17888
- 标签机串口：COM3
```

## 6. 测试打印

保持 `start-print-service.bat` 窗口运行，再双击：

```text
test-print.bat
```

如果测试标签能打印，打开网页计时器开台也会自动打印。

## 7. 设置开机自启

确认测试打印成功后，可以双击：

```text
install-autostart.bat
```

它会在当前 Windows 用户的“启动”文件夹里创建快捷方式，通常不需要管理员权限。

取消开机自启：

```text
uninstall-autostart.bat
```

## 常见问题

### 计时正常但不打印

先检查 `start-print-service.bat` 是否在运行，再打开：

```text
http://127.0.0.1:17888/health
```

能看到 `{"ok":true...}` 才表示本机打印桥正常。

健康检查里会显示 `printMethod`、`windowsPrinterName`、`rawSerialPort`、`serialPort`、`pythonBin`，用于确认实际使用的打印模式、打印机、串口和 Python。

正确状态应类似：

```json
{
  "ok": true,
  "printMethod": "serial",
  "rawSerialPort": "COM3",
  "serialPort": "COM3"
}
```

如果黑窗口里出现：

```text
Unable to fetch printer info
Timeout waiting response
Serial port: COM5
Operation aborted
```

基本就是选到了蓝牙串口或错误串口。新版脚本会在打印前逐个 USB/非蓝牙 COM 口握手，并默认跳过蓝牙口。请重新下载最新版并保持：

```text
LIBMS_NIIMBOT_PORT=auto
LIBMS_TRY_BLUETOOTH_PORTS=0
```

如果仍不行，运行 `windows\check-com-ports.bat`，把 `windows\printer.env` 里的 `LIBMS_NIIMBOT_PORT` 改成显示为 `USB 串行设备` 的 COM 口，例如 `COM3`。

### 找不到 COM 口

确认标签机已开机、USB 已连接、驱动已安装。然后重新运行 `check-com-ports.bat`。

如果关闭蓝牙后 COM 口消失，说明当前识别到的可能是蓝牙串口，不是 USB 串口。此时需要：

1. 换一根支持数据传输的 USB 线，不要只用充电线；
2. 换电脑 USB 口；
3. 安装精臣/USB 串口驱动；
4. 再运行 `check-com-ports.bat`，确认出现非 Bluetooth 的 COM 口。

### 换 USB 口后不打印

Windows 可能会分配新的 COM 口。重新运行 `check-com-ports.bat`，并更新 `printer.env`。
