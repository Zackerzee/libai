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
  Write-Host "WARN $message" -ForegroundColor Yellow
}

function Test-Cmd($name) {
  return [bool](Get-Command $name -ErrorAction SilentlyContinue)
}

function Refresh-Path {
  $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
  $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
  $extra = @(
    "C:\Program Files\nodejs",
    "$env:LOCALAPPDATA\Programs\Python\Python313",
    "$env:LOCALAPPDATA\Programs\Python\Python312",
    "$env:LOCALAPPDATA\Programs\Python\Python311",
    "$env:LOCALAPPDATA\Microsoft\WindowsApps"
  ) -join ";"
  $env:Path = "$machinePath;$userPath;$extra;$env:Path"
}

function Get-NodeMajor {
  if (-not (Test-Cmd "node")) { return 0 }
  try {
    $version = (& node --version 2>$null)
    if ($LASTEXITCODE -ne 0 -or -not $version) { return 0 }
    if ($version -match "v?(\d+)\.") { return [int]$Matches[1] }
  } catch {}
  return 0
}

function Ensure-Node {
  Write-Step "Checking Node.js"
  $major = Get-NodeMajor
  if ($major -ge 18 -and (Test-Cmd "npm")) {
    Write-Ok "Node.js is ready: $(node --version)"
    return
  }

  if ($major -gt 0) {
    throw "Detected Node.js $(node --version). Please install Node.js LTS 18+ from https://nodejs.org/, then reopen this script."
  }
  throw "Node.js was not detected. Please install Node.js LTS 18+ from https://nodejs.org/, then reopen this script."
}

function Get-PythonInfo($command, [string[]]$prefixArgs) {
  try {
    $code = "import sys; print(sys.executable); print('%s.%s.%s' % sys.version_info[:3])"
    $args = @()
    if ($prefixArgs) { $args += $prefixArgs }
    $args += @("-c", $code)
    $output = & $command @args 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $output -or $output.Count -lt 2) { return $null }
    $version = [Version]$output[1].Trim()
    return [pscustomobject]@{
      Command = $command
      Args = $prefixArgs
      Exe = $output[0].Trim()
      Version = $version
    }
  } catch {
    return $null
  }
}

function Test-PythonSupported($info) {
  if (-not $info) { return $false }
  if ($info.Version.Major -ne 3) { return $false }
  if ($info.Version.Minor -lt 9) { return $false }
  if ($info.Version.Minor -gt 13) { return $false }
  return $true
}

function Invoke-Python {
  param(
    [Parameter(Mandatory=$true, Position=0)]
    [object]$PythonInfo,
    [Parameter(Position=1, ValueFromRemainingArguments=$true)]
    [string[]]$PythonArgList
  )

  $allArgs = @()
  if ($PythonInfo.Args) { $allArgs += @($PythonInfo.Args) }
  if ($PythonArgList) { $allArgs += @($PythonArgList) }
  & $PythonInfo.Command @allArgs
  return $LASTEXITCODE
}

function Find-Python {
  $candidates = @()
  if (Test-Cmd "py") {
    $candidates += ,@("py", @("-3.12"))
    $candidates += ,@("py", @("-3.13"))
    $candidates += ,@("py", @("-3.11"))
    $candidates += ,@("py", @("-3"))
  }
  if (Test-Cmd "python") {
    $candidates += ,@("python", @())
  }

  foreach ($candidate in $candidates) {
    $info = Get-PythonInfo $candidate[0] $candidate[1]
    if (Test-PythonSupported $info) {
      Write-Ok ("Python is ready: {0} ({1}) via {2} {3}" -f $info.Exe, $info.Version, $info.Command, ($info.Args -join " "))
      return $info
    }
    if ($info) {
      Write-Warn ("Ignoring unsupported Python: {0} ({1}). Supported: 3.9 to 3.13." -f $info.Exe, $info.Version)
    }
  }

  return $null
}

function Ensure-Python {
  Write-Step "Checking Python"
  $info = Find-Python
  if ($info) { return $info }
  throw "No supported Python found. Install Python 3.12 from python.org and check Add Python to PATH. Python 3.14 is not supported yet."
}

function Ensure-PipPackage($pythonInfo, $importName, $packageName) {
  Write-Step "Checking Python package: $packageName"
  Invoke-Python $pythonInfo "-c" "import $importName" | Out-Null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "$packageName is ready"
    return
  }

  Write-Step "Installing Python package: $packageName"
  Invoke-Python $pythonInfo "-m" "pip" "install" "--upgrade" $packageName | Out-Null
  if ($LASTEXITCODE -ne 0) {
    throw "$packageName install failed. Run manually: py -3.12 -m pip install --upgrade $packageName"
  }
  Write-Ok "$packageName installed"
}

function Ensure-Pillow($pythonInfo) {
  Ensure-PipPackage $pythonInfo "PIL" "pillow"
}

function Ensure-PyWin32($pythonInfo) {
  Ensure-PipPackage $pythonInfo "win32print, win32ui" "pywin32"
}

function Ensure-NodeDependencies {
  Write-Step "Checking Node dependencies"
  $depPath = Join-Path $rootDir "node_modules\@mmote\niimbluelib"
  if (Test-Path $depPath) {
    Write-Ok "Node dependencies already exist"
    return
  }

  Set-Location $rootDir
  npm install
  if ($LASTEXITCODE -ne 0) {
    throw "npm install failed. Check network, Node.js, and npm."
  }
  Write-Ok "Node dependencies installed"
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
      $score = 0
      if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P") { $score += 120 }
      if ($name -match "USB|Serial|串行|CH340|CP210|Prolific") { $score += 80 }
      if ($name -match "Bluetooth|蓝牙") { $score -= 140 }
      $items += [pscustomobject]@{ Port = $port.DeviceID; Name = $name; Score = $score }
    }
  } catch {}

  try {
    $names = [System.IO.Ports.SerialPort]::GetPortNames()
    foreach ($name in $names) {
      if ($items.Port -contains $name) { continue }
      $items += [pscustomobject]@{ Port = $name; Name = "System serial port $name"; Score = 1 }
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
      if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P") { $score += 100 }
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
        if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P") { $score += 100 }
        $items += [pscustomobject]@{ Name = $name; Score = $score }
      }
    } catch {}
  }
  return $items | Sort-Object Score -Descending
}

function Resolve-WindowsPrinterName {
  Write-Step "Detecting Windows printer queue"
  $existing = Read-EnvValue "LIBMS_WINDOWS_PRINTER_NAME"
  $candidates = @(Get-WindowsPrinterCandidates)

  if ($candidates.Count -gt 0) {
    Write-Host "Detected printers:" -ForegroundColor Gray
    foreach ($item in $candidates) {
      Write-Host ("- {0}" -f $item.Name) -ForegroundColor Gray
    }
  }

  if ($existing) {
    foreach ($item in $candidates) {
      if ($item.Name -eq $existing) {
        Write-Ok "Using configured printer: $existing"
        return $existing
      }
    }
  }

  foreach ($item in $candidates) {
    if ($item.Score -ge 100) {
      Write-Ok "Using Windows printer: $($item.Name)"
      return $item.Name
    }
  }

  Write-Warn "No NIIMBOT/B3S Windows printer queue detected. Serial mode will be used as fallback."
  return ""
}

function Resolve-PrintMethod($windowsPrinterName) {
  # 精臣 B3S-P 在门店计时器里默认走 USB/蓝牙串口协议。
  # 不依赖 Windows 打印机队列，避免 DYMO/系统驱动识别错误导致无法打印。
  return "serial"
}

function Resolve-PrinterPort {
  Write-Step "Detecting serial port"
  $existing = Read-EnvValue "LIBMS_NIIMBOT_PORT"
  $candidates = @(Get-SerialPortCandidates)

  if ($candidates.Count -gt 0) {
    Write-Host "Detected serial ports:" -ForegroundColor Gray
    foreach ($item in $candidates) {
      Write-Host ("- {0}  {1}" -f $item.Port, $item.Name) -ForegroundColor Gray
    }
  }

  if ($candidates.Count -gt 0) {
    if ($existing -and ($candidates.Port -contains $existing)) {
      $existingItem = $candidates | Where-Object { $_.Port -eq $existing } | Select-Object -First 1
      $best = $candidates[0]

      if ($existingItem.Score -ge 50 -and $existingItem.Score -ge $best.Score) {
        Write-Ok "Using configured serial port: $existing"
        return $existing
      }

      Write-Warn ("Ignoring configured serial port {0} ({1}). It looks like Bluetooth/wrong port; using {2} ({3})." -f $existing, $existingItem.Name, $best.Port, $best.Name)
    }

    $selected = $candidates[0].Port
    Write-Ok "Using serial port: $selected"
    return $selected
  }

  Write-Warn "No COM port detected. COM3 will be used as fallback."
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

function Write-PrinterEnv($port, $pythonInfo, $fontPath, $printMethod, $windowsPrinterName) {
  Write-Step "Writing local config"
  $pythonArgs = ""
  if ($pythonInfo.Args) { $pythonArgs = ($pythonInfo.Args -join " ") }
  $configPort = $port
  if ($port -ne "auto") { $configPort = "auto" }

  $content = @(
    "# Auto generated. You may edit this file manually.",
    "LIBMS_NIIMBOT_PORT=$configPort",
    "LIBMS_TRY_BLUETOOTH_PORTS=0",
    "LIBMS_PRINT_PORT=17888",
    "LIBMS_PYTHON_BIN=$($pythonInfo.Command)",
    "LIBMS_PYTHON_ARGS=$pythonArgs",
    "LIBMS_LABEL_FONT=$fontPath",
    "LIBMS_PRINT_METHOD=$printMethod",
    "LIBMS_WINDOWS_PRINTER_NAME=$windowsPrinterName"
  ) -join "`r`n"

  Set-Content -Path $envFile -Value $content -Encoding ASCII
  Write-Ok "Config written: $envFile"
}

function Start-Bridge($port, $pythonInfo, $fontPath, $printMethod, $windowsPrinterName) {
  Write-Step "Starting local print bridge"
  $pythonArgs = ""
  if ($pythonInfo.Args) { $pythonArgs = ($pythonInfo.Args -join " ") }

  $env:LIBMS_NIIMBOT_PORT = $port
  $env:LIBMS_TRY_BLUETOOTH_PORTS = "0"
  $env:LIBMS_PRINT_PORT = "17888"
  $env:LIBMS_PYTHON_BIN = $pythonInfo.Command
  $env:LIBMS_PYTHON_ARGS = $pythonArgs
  $env:LIBMS_LABEL_FONT = $fontPath
  $env:LIBMS_PRINT_METHOD = $printMethod
  $env:LIBMS_WINDOWS_PRINTER_NAME = $windowsPrinterName

  Write-Host ""
  Write-Host "Print bridge is ready:" -ForegroundColor Green
  Write-Host "- URL: http://127.0.0.1:17888"
  Write-Host "- Method: $printMethod"
  if ($windowsPrinterName) {
    Write-Host "- Windows printer: $windowsPrinterName"
  }
  Write-Host "- Serial port: $port"
  Write-Host "- Try Bluetooth COM: 0"
  Write-Host "- Python: $($pythonInfo.Command) $pythonArgs"
  Write-Host "- Font: $fontPath"
  Write-Host ""
  Write-Host "Keep this window open. The website will print labels through this bridge." -ForegroundColor Yellow
  Write-Host "Health check: http://127.0.0.1:17888/health"
  Write-Host ""

  Set-Location $rootDir
  node server.js
}

try {
  Write-Host ""
  Write-Host "========================================"
  Write-Host " LIBMS Windows Print Bridge Installer"
  Write-Host "========================================"

  Refresh-Path
  Ensure-Node
  $pythonInfo = Ensure-Python
  Ensure-Pillow $pythonInfo
  Ensure-NodeDependencies
  $windowsPrinterName = ""
  $printMethod = Resolve-PrintMethod $windowsPrinterName
  Write-Warn "Using serial mode. Windows printer driver/queue will be ignored."
  $detectedPort = Resolve-PrinterPort
  Write-Warn "Serial auto-probe enabled. Preferred detected port: $detectedPort. The bridge will test COM ports before each print."
  $port = "auto"
  $fontPath = Resolve-LabelFont
  Write-PrinterEnv $port $pythonInfo $fontPath $printMethod $windowsPrinterName
  Start-Bridge $port $pythonInfo $fontPath $printMethod $windowsPrinterName
} catch {
  Write-Host ""
  Write-Host "Install or startup failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "Send windows\install-log.txt to Codex if you need diagnosis." -ForegroundColor Yellow
  exit 1
}
