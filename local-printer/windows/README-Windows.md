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
5. 自动识别 Windows 里的 NIIMBOT/B3S 打印机队列；
6. 找到打印机队列时安装 pywin32 并优先走系统打印；
7. 同时自动识别 COM 串口作为备用；
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

一键脚本会优先使用 Windows 系统打印机队列。也就是“设置 -> 蓝牙和设备 -> 打印机和扫描仪”里看到的：

```text
NIIMBOT B3S_P
```

如果没有识别到这个打印机队列，才会尝试走 COM 串口协议。

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

把里面的端口改成真实端口，例如：

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

如果你要强制使用 Windows 打印机队列，可以在 `printer.env` 里写：

```text
LIBMS_PRINT_METHOD=windows-printer
LIBMS_WINDOWS_PRINTER_NAME=NIIMBOT B3S_P
```

打印机名称必须和 Windows 系统里显示的名称完全一致。

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

### 找不到 COM 口

确认标签机已开机、USB 已连接、驱动已安装。然后重新运行 `check-com-ports.bat`。

### 换 USB 口后不打印

Windows 可能会分配新的 COM 口。重新运行 `check-com-ports.bat`，并更新 `printer.env`。
