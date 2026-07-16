Write-Host ""
Write-Host "正在检查 Windows 串口..." -ForegroundColor Cyan
Write-Host ""

$items = @()
$best = @{}

try {
  $ports = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue
  foreach ($port in $ports) {
    if (-not $port.DeviceID) { continue }
    $items += [pscustomobject]@{
      Port = $port.DeviceID
      Name = [string]$port.Name
      Source = "serial"
    }
  }
} catch {}

try {
  $pnpPorts = Get-CimInstance Win32_PnPEntity -ErrorAction SilentlyContinue | Where-Object { $_.Name -match "\((COM\d+)\)" }
  foreach ($port in $pnpPorts) {
    $items += [pscustomobject]@{
      Port = $matches[1]
      Name = [string]$port.Name
      Source = "pnp"
    }
  }
} catch {}

try {
  $names = [System.IO.Ports.SerialPort]::GetPortNames()
  foreach ($name in $names) {
    $items += [pscustomobject]@{
      Port = $name
      Name = "System serial port $name"
      Source = "dotnet"
    }
  }
} catch {
  Write-Host "读取 .NET 串口列表失败：$($_.Exception.Message)" -ForegroundColor Yellow
}

foreach ($item in $items) {
  if (-not $best.ContainsKey($item.Port) -or $item.Source -eq "pnp" -or ($best[$item.Port].Source -eq "dotnet" -and $item.Source -eq "serial")) {
    $best[$item.Port] = $item
  }
}

$result = @()
foreach ($item in $best.Values) {
  $score = 0
  if ($item.Name -match "NIIMBOT|B3S|B3S_P|B3S-P") { $score += 120 }
  if ($item.Name -match "USB|Serial|串行|CH340|CP210|Prolific") { $score += 80 }
  if ($item.Name -match "Bluetooth|蓝牙|BTH") { $score -= 140 }
  $isBluetooth = $item.Name -match "Bluetooth|蓝牙|BTH"
  $result += [pscustomobject]@{
    Port = $item.Port
    Name = $item.Name
    Source = $item.Source
    Score = $score
    Bluetooth = $isBluetooth
  }
}

$ordered = @($result | Sort-Object Score -Descending)

if ($ordered.Count -gt 0) {
  Write-Host "识别到的串口：" -ForegroundColor Green
  foreach ($item in $ordered) {
    $kind = if ($item.Bluetooth) { "蓝牙/不推荐" } elseif ($item.Score -ge 50) { "USB/优先" } else { "未知/可尝试" }
    $color = if ($item.Bluetooth) { "Yellow" } elseif ($item.Score -ge 50) { "Green" } else { "Gray" }
    Write-Host ("- {0}  {1}  [{2}]" -f $item.Port, $item.Name, $kind) -ForegroundColor $color
  }
} else {
  Write-Host "没有发现 COM 串口。请确认标签机已开机、USB 已连接，并安装精臣/USB 串口驱动。" -ForegroundColor Red
}

Write-Host ""
Write-Host "推荐保持 windows\printer.env：" -ForegroundColor Cyan
Write-Host "LIBMS_NIIMBOT_PORT=auto"
Write-Host "LIBMS_TRY_BLUETOOTH_PORTS=0"
Write-Host ""
Write-Host "如果要测试蓝牙，把 LIBMS_TRY_BLUETOOTH_PORTS 改成 1；但门店稳定使用建议 USB 数据线。" -ForegroundColor Yellow
