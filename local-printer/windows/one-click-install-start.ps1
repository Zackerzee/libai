$ErrorActionPreference = "Stop"

$scriptDir = $PSScriptRoot
$rootDir = Resolve-Path (Join-Path $scriptDir "..")
$envFile = Join-Path $scriptDir "printer.env"

function Write-Step($message) {
  Write-Host ""
  Write-Host "==> $message" -ForegroundColor Cyan
}

function Write-Ok($message) {
  Write-Host "OK  $message" -ForegroundColor Green
}

function Write-Warn($message) {
  Write-Host "提示 $message" -ForegroundColor Yellow
}

function Test-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $extra = @(
    "C:\Program Files\nodejs",
    "$env:LOCALAPPDATA\Programs\Python\Python314",
    "$env:LOCALAPPDATA\Programs\Python\Python313",
    "$env:LOCALAPPDATA\Programs\Python\Python312",
    "$env:LOCALAPPDATA\Programs\Python\Python311",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps"
  ) -join ";"
  $env:Path = "$machinePath;$userPath;$extra;$env:Path"
}

function Install-WithWinget($id, $name) {
  if (-not (Test-Cmd "winget")) {
    throw "未检测到 winget，无法自动安装 $name。请先手动安装 $name 后再运行本脚本。"
  }

  Write-Step "正在自动安装 $name"
  winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "$name 自动安装失败。可以右键本文件选择“以管理员身份运行”，或手动安装后重试。"
  }
  Refresh-Path
}

function Get-PythonExe {
  $commands = @("python", "py")
  foreach ($cmd in $commands) {
    if (-not (Test-Cmd $cmd)) { continue }

    try {
      if ($cmd -eq "py") {
        $exe = & py -3 -c "import sys; print(sys.executable)" 2>$null
      } else {
        $exe = & python -c "import sys; print(sys.executable)" 2>$null
      }

      if ($LASTEXITCODE -eq 0 -and $exe -and (Test-Path $exe.Trim())) {
        return $exe.Trim()
      }
    } catch {
      continue
    }
  }
  return ""
}

function Invoke-Python($pythonExe, [string[]]$args) {
  & $pythonExe @args
  return $LASTEXITCODE
}

function Ensure-Node {
  Write-Step "检查 Node.js"
  if ((Test-Cmd "node") -and (Test-Cmd "npm")) {
    Write-Ok "已检测到 Node.js：$(node --version)"
    return
  }

  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"

  if (-not ((Test-Cmd "node") -and (Test-Cmd "npm"))) {
    throw "Node.js 安装后仍不可用。请重新打开窗口，或手动安装 Node.js LTS。"
  }
  Write-Ok "Node.js 安装完成：$(node --version)"
}

function Ensure-Python {
  Write-Step "检查 Python"
  $pythonExe = Get-PythonExe
  if ($pythonExe) {
    Write-Ok "已检测到 Python：$pythonExe"
    return $pythonExe
  }

  Install-WithWinget "Python.Python.3.12" "Python 3"
  $pythonExe = Get-PythonExe
  if (-not $pythonExe) {
    throw "Python 安装后仍不可用。请重新打开窗口，或手动安装 Python 3。"
  }
  Write-Ok "Python 安装完成：$pythonExe"
  return $pythonExe
}

function Ensure-Pillow($pythonExe) {
  Write-Step "检查 Python 图片依赖 Pillow"
  & $pythonExe -c "import PIL" 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "Pillow 已可用"
    return
  }

  Write-Step "正在安装 Pillow"
  & $pythonExe -m pip install --upgrade pillow
  if ($LASTEXITCODE -ne 0) {
    throw "Pillow 安装失败。请检查网络或 Python/pip 配置。"
  }
  Write-Ok "Pillow 安装完成"
}

function Ensure-PyWin32($pythonExe) {
  Write-Step "检查 Windows 打印依赖 pywin32"
  & $pythonExe -c "import win32print, win32ui" 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "pywin32 已可用"
    return
  }

  Write-Step "正在安装 pywin32"
  & $pythonExe -m pip install --upgrade pywin32
  if ($LASTEXITCODE -ne 0) {
    throw "pywin32 安装失败。请检查网络或 Python/pip 配置。"
  }
  Write-Ok "pywin32 安装完成"
}

function Ensure-NodeDependencies {
  Write-Step "检查 Node 打印依赖"
  $depPath = Join-Path $rootDir "node_modules\@mmote\niimbluelib"
  if (Test-Path $depPath) {
    Write-Ok "Node 打印依赖已存在"
    return
  }

  Set-Location $rootDir
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install 失败。请检查网络、Node.js 或 npm 配置。"
  }
  Write-Ok "Node 打印依赖安装完成"
}

function Read-EnvValue($key) {
  if (-not (Test-Path $envFile)) { return "" }
  $line = Get-Content $envFile | Where-Object { $_ -match "^\s*$key\s*=" } | Select-Object -First 1
  if (-not $line) { return "" }
  return (($line -split "=", 2)[1]).Trim()
}

function Get-SerialPortCandidates {
  $items = @()

  try {
    $ports = Get-CimInstance Win32_SerialPort -ErrorAction SilentlyContinue
    foreach ($port in $ports) {
      if (-not $port.DeviceID) { continue }
      $name = [string]$port.Name
      $score = 10
      if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P") { $score += 100 }
      if ($name -match "USB|Serial|串口|CH340|CP210|Prolific") { $score += 30 }
      if ($name -match "Bluetooth|蓝牙") { $score -= 20 }
      $items += [pscustomobject]@{ Port = $port.DeviceID; Name = $name; Score = $score }
    }
  } catch {}

  try {
    $names = [System.IO.Ports.SerialPort]::GetPortNames()
    foreach ($name in $names) {
      if ($items.Port -contains $name) { continue }
      $items += [pscustomobject]@{ Port = $name; Name = "系统串口 $name"; Score = 1 }
    }
  } catch {}

  return $items | Sort-Object Score -Descending
}

function Get-WindowsPrinterCandidates {
  $items = @()

  try {
    $printers = Get-Printer -ErrorAction SilentlyContinue
    foreach ($printer in $printers) {
      if (-not $printer.Name) { continue }
      $name = [string]$printer.Name
      $score = 0
      if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P|精臣") { $score += 100 }
      if ($printer.Type -match "Local") { $score += 5 }
      if ($printer.PrinterStatus -match "Normal|Idle") { $score += 5 }
      $items += [pscustomobject]@{ Name = $name; Score = $score }
    }
  } catch {
    try {
      $printers = Get-CimInstance Win32_Printer -ErrorAction SilentlyContinue
      foreach ($printer in $printers) {
        if (-not $printer.Name) { continue }
        $name = [string]$printer.Name
        $score = 0
        if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P|精臣") { $score += 100 }
        $items += [pscustomobject]@{ Name = $name; Score = $score }
      }
    } catch {}
  }

  return $items | Sort-Object Score -Descending
}

function Resolve-WindowsPrinterName {
  Write-Step "识别 Windows 打印机队列"
  $existing = Read-EnvValue "LIBMS_WINDOWS_PRINTER_NAME"
  $candidates = @(Get-WindowsPrinterCandidates)

  if ($candidates.Count -gt 0) {
    Write-Host "检测到打印机：" -ForegroundColor Gray
    foreach ($item in $candidates) {
      Write-Host ("- {0}" -f $item.Name) -ForegroundColor Gray
    }
  }

  if ($existing) {
    foreach ($item in $candidates) {
      if ($item.Name -eq $existing) {
        Write-Ok "继续使用已配置打印机：$existing"
        return $existing
      }
    }
  }

  foreach ($item in $candidates) {
    if ($item.Score -ge 100) {
      Write-Ok "自动选择 Windows 打印机：$($item.Name)"
      return $item.Name
    }
  }

  Write-Warn "没有识别到 NIIMBOT/B3S 打印机队列，将尝试使用串口协议。"
  return ""
}

function Resolve-PrintMethod($windowsPrinterName) {
  $existing = Read-EnvValue "LIBMS_PRINT_METHOD"
  if ($existing) { return $existing }
  if ($windowsPrinterName) { return "windows-printer" }
  return "auto"
}

function Resolve-PrinterPort {
  Write-Step "识别标签机串口"
  $existing = Read-EnvValue "LIBMS_NIIMBOT_PORT"
  $candidates = @(Get-SerialPortCandidates)

  if ($candidates.Count -gt 0) {
    Write-Host "检测到串口：" -ForegroundColor Gray
    foreach ($item in $candidates) {
      Write-Host ("- {0}  {1}" -f $item.Port, $item.Name) -ForegroundColor Gray
    }
  }

  if ($existing -and ($candidates.Port -contains $existing)) {
    Write-Ok "继续使用已配置串口：$existing"
    return $existing
  }

  if ($candidates.Count -gt 0) {
    $selected = $candidates[0].Port
    Write-Ok "自动选择串口：$selected"
    return $selected
  }

  Write-Warn "没有自动识别到 COM 口，暂用 COM3。若无法打印，请先确认标签机开机、USB 连接和驱动。"
  return "COM3"
}

function Resolve-LabelFont {
  $existing = Read-EnvValue "LIBMS_LABEL_FONT"
  if ($existing -and (Test-Path $existing)) { return $existing }

  $candidates = @(
    "C:\Windows\Fonts\msyh.ttc",
    "C:\Windows\Fonts\simhei.ttf",
    "C:\Windows\Fonts\simsun.ttc",
    "C:\Windows\Fonts\Deng.ttf"
  )

  foreach ($font in $candidates) {
    if (Test-Path $font) { return $font }
  }
  return "C:\Windows\Fonts\msyh.ttc"
}

function Write-PrinterEnv($port, $pythonExe, $fontPath, $printMethod, $windowsPrinterName) {
  Write-Step "写入本机配置"
  $content = @(
    "# 自动生成。需要手动修改时，可直接编辑本文件。",
    "LIBMS_NIIMBOT_PORT=$port",
    "LIBMS_PRINT_PORT=17888",
    "LIBMS_PYTHON_BIN=$pythonExe",
    "LIBMS_LABEL_FONT=$fontPath",
    "LIBMS_PRINT_METHOD=$printMethod",
    "LIBMS_WINDOWS_PRINTER_NAME=$windowsPrinterName"
  ) -join "`r`n"

  Set-Content -Path $envFile -Value $content -Encoding UTF8
  Write-Ok "配置已写入：$envFile"
}

function Start-Bridge($port, $pythonExe, $fontPath, $printMethod, $windowsPrinterName) {
  Write-Step "启动本机打印桥"
  $env:LIBMS_NIIMBOT_PORT = $port
  $env:LIBMS_PRINT_PORT = "17888"
  $env:LIBMS_PYTHON_BIN = $pythonExe
  $env:LIBMS_LABEL_FONT = $fontPath
  $env:LIBMS_PRINT_METHOD = $printMethod
  $env:LIBMS_WINDOWS_PRINTER_NAME = $windowsPrinterName

  Write-Host ""
  Write-Host "打印桥已准备启动：" -ForegroundColor Green
  Write-Host "- 服务地址：http://127.0.0.1:17888"
  Write-Host "- 打印模式：$printMethod"
  if ($windowsPrinterName) {
    Write-Host "- Windows 打印机：$windowsPrinterName"
  }
  Write-Host "- 标签机串口：$port"
  Write-Host "- Python：$pythonExe"
  Write-Host "- 字体：$fontPath"
  Write-Host ""
  Write-Host "保持此窗口运行。网页开台后会自动打印标签。" -ForegroundColor Yellow
  Write-Host "测试地址：http://127.0.0.1:17888/health"
  Write-Host ""

  Set-Location $rootDir
  node server.js
}

try {
  Write-Host ""
  Write-Host "========================================"
  Write-Host " 时里白造物 Windows 一键打印桥"
  Write-Host "========================================"

  Refresh-Path
  Ensure-Node
  $pythonExe = Ensure-Python
  Ensure-Pillow $pythonExe
  Ensure-NodeDependencies
  $windowsPrinterName = Resolve-WindowsPrinterName
  if ($windowsPrinterName) {
    Ensure-PyWin32 $pythonExe
  }
  $printMethod = Resolve-PrintMethod $windowsPrinterName
  $port = Resolve-PrinterPort
  $fontPath = Resolve-LabelFont
  Write-PrinterEnv $port $pythonExe $fontPath $printMethod $windowsPrinterName
  Start-Bridge $port $pythonExe $fontPath $printMethod $windowsPrinterName
} catch {
  Write-Host ""
  Write-Host "安装或启动失败：" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "如果自动安装失败，可以先手动安装 Node.js LTS、Python 3 和精臣驱动，再重新运行本脚本。" -ForegroundColor Yellow
  exit 1
}
