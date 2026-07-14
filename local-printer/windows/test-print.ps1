$ErrorActionPreference = "Stop"

$healthUrl = "http://127.0.0.1:17888/health"
$printUrl = "http://127.0.0.1:17888/print-label"

Write-Host ""
Write-Host "正在检查本机打印桥..." -ForegroundColor Cyan

try {
  $health = Invoke-RestMethod -Uri $healthUrl -Method Get -TimeoutSec 5
  Write-Host ("打印桥正常：{0}" -f $health.printer) -ForegroundColor Green
  Write-Host ("打印模式：{0}" -f $health.printMethod) -ForegroundColor Green
  if ($health.windowsPrinterName) {
    Write-Host ("Windows 打印机：{0}" -f $health.windowsPrinterName) -ForegroundColor Green
  }
  Write-Host ("串口：{0}" -f $health.serialPort) -ForegroundColor Green
} catch {
  Write-Host "无法连接打印桥。请先运行 start-print-service.bat，并保持窗口不要关闭。" -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}

$now = Get-Date -Format "HH:mm"
$body = @{
  deskId = "01"
  session = "Windows测试"
  mode = "countdown"
  startLabel = $now
  endLabel = "测试"
  note = "Windows本机打印桥测试"
} | ConvertTo-Json -Compress

Write-Host ""
Write-Host "正在发送测试标签..." -ForegroundColor Cyan

try {
  $result = Invoke-RestMethod -Uri $printUrl -Method Post -ContentType "application/json" -Body $body -TimeoutSec 30
  if ($result.ok -eq $true) {
    Write-Host "测试打印请求成功。请查看标签机是否出纸。" -ForegroundColor Green
  } else {
    Write-Host ("测试打印失败：{0}" -f $result.error) -ForegroundColor Red
    exit 1
  }
} catch {
  Write-Host "测试打印请求失败：" -ForegroundColor Red
  Write-Host $_.Exception.Message
  exit 1
}
