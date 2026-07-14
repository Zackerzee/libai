# Windows 使用说明：时里白造物 NIIMBOT B3S-P 本机打印桥

网页无法直接控制 USB 标签机。Windows 电脑需要先运行这个本机打印桥：

```text
网页 https://www.libms.net/mentor-timer
  -> http://127.0.0.1:17888/print-label
  -> Windows 本机打印桥
  -> 精臣 B3S-P 标签机
```

## 1. 准备环境

Windows 电脑需要安装：

1. Node.js 18 或更高版本；
2. Python 3；
3. 精臣 B3S-P / USB 串口驱动。

## 2. 查看串口号

双击：

```text
check-com-ports.bat
```

记下类似 `COM3`、`COM4` 的端口号。

## 3. 配置串口

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

## 4. 启动打印桥

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

## 5. 测试打印

保持 `start-print-service.bat` 窗口运行，再双击：

```text
test-print.bat
```

如果测试标签能打印，打开网页计时器开台也会自动打印。

## 6. 设置开机自启

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

### 找不到 COM 口

确认标签机已开机、USB 已连接、驱动已安装。然后重新运行 `check-com-ports.bat`。

### 换 USB 口后不打印

Windows 可能会分配新的 COM 口。重新运行 `check-com-ports.bat`，并更新 `printer.env`。
