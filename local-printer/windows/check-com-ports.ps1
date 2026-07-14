Write-Host ""
Write-Host "正在检查 Windows 串口..." -ForegroundColor Cyan
Write-Host ""

$ports = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue
if ($ports) {
  Write-Host "设备管理器识别到的串口：" -ForegroundColor Green
  $ports | ForEach-Object {
    Write-Host ("- {0}  {1}" -f $_.DeviceID, $_.Name)
  }
} else {
  Write-Host "Win32_SerialPort 没有返回设备。下面列出系统可用端口名：" -ForegroundColor Yellow
}

try {
  $names = [System.IO.Ports.SerialPort]::GetPortNames()
  if ($names.Count -gt 0) {
    Write-Host ""
    Write-Host "可用端口：" -ForegroundColor Green
    $names | ForEach-Object { Write-Host ("- {0}" -f $_) }
  } else {
    Write-Host ""
    Write-Host "没有发现 COM 串口。请确认标签机已开机、USB 已连接，并安装精臣/USB 串口驱动。" -ForegroundColor Red
  }
} catch {
  Write-Host "读取串口失败：$($_.Exception.Message)" -ForegroundColor Red
}

Write-Host ""
Write-Host "把实际端口号填到 windows\printer.env 的 LIBMS_NIIMBOT_PORT，例如：COM3" -ForegroundColor Cyan
