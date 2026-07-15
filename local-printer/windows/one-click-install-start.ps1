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

function Install-WithWinget($id, $name) {
  if (-not (Test-Cmd "winget")) {
    throw "winget is not available. Please install $name manually, then run this script again."
  }

  Write-Step "Installing $name"
  winget install --id $id --exact --silent --accept-package-agreements --accept-source-agreements
  if ($LASTEXITCODE -ne 0) {
    throw "$name install failed. Try running this window as Administrator, or install it manually."
  }
  Refresh-Path
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
    Write-Warn "Detected Node.js $(node --version), but Node.js 18 or newer is required."
  } else {
    Write-Warn "Node.js was not detected."
  }

  Install-WithWinget "OpenJS.NodeJS.LTS" "Node.js LTS"
  $major = Get-NodeMajor
  if ($major -lt 18 -or -not (Test-Cmd "npm")) {
    throw "Node.js 18+ is still not available. Please install Node.js LTS from https://nodejs.org/ and reopen this script."
  }
  Write-Ok "Node.js is ready: $(node --version)"
}

function Get-PythonInfo($exe, $args) {
  try {
    $code = "import sys; print(sys.executable); print('%s.%s.%s' % sys.version_info[:3])"
    $output = & $exe @args -c $code 2>$null
    if ($LASTEXITCODE -ne 0 -or -not $output -or $output.Count -lt 2) { return $null }
    $version = [Version]$output[1].Trim()
    return [pscustomobject]@{
      Command = $exe
      Args = $args
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

function Get-PythonExe {
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
      Write-Ok ("Python is ready: {0} ({1})" -f $info.Exe, $info.Version)
      return $info.Exe
    }
    if ($info) {
      Write-Warn ("Ignoring unsupported Python: {0} ({1}). Supported: 3.9 to 3.13." -f $info.Exe, $info.Version)
    }
  }

  return ""
}

function Ensure-Python {
  Write-Step "Checking Python"
  $pythonExe = Get-PythonExe
  if ($pythonExe) { return $pythonExe }

  Write-Warn "No supported Python found. Python 3.14 is not supported by this printer bridge yet."
  Install-WithWinget "Python.Python.3.12" "Python 3.12"

  $pythonExe = Get-PythonExe
  if (-not $pythonExe) {
    throw "Python 3.12/3.13 is still not available. Install Python 3.12 from python.org, check Add Python to PATH, then retry."
  }
  return $pythonExe
}

function Ensure-PipPackage($pythonExe, $importName, $packageName) {
  Write-Step "Checking Python package: $packageName"
  & $pythonExe -c "import $importName" 2>$null
  if ($LASTEXITCODE -eq 0) {
    Write-Ok "$packageName is ready"
    return
  }

  Write-Step "Installing Python package: $packageName"
  & $pythonExe -m pip install --upgrade $packageName
  if ($LASTEXITCODE -ne 0) {
    throw "$packageName install failed. Check network, Python, and pip."
  }
  Write-Ok "$packageName installed"
}

function Ensure-Pillow($pythonExe) {
  Ensure-PipPackage $pythonExe "PIL" "pillow"
}

function Ensure-PyWin32($pythonExe) {
  Ensure-PipPackage $pythonExe "win32print, win32ui" "pywin32"
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
      $score = 10
      if ($name -match "NIIMBOT|B3S|B3S_P|B3S-P") { $score += 100 }
      if ($name -match "USB|Serial|CH340|CP210|Prolific") { $score += 30 }
      if ($name -match "Bluetooth") { $score -= 20 }
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
  $existing = Read-EnvValue "LIBMS_PRINT_METHOD"
  if ($existing) { return $existing }
  if ($windowsPrinterName) { return "windows-printer" }
  return "auto"
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

  if ($existing -and ($candidates.Port -contains $existing)) {
    Write-Ok "Using configured serial port: $existing"
    return $existing
  }

  if ($candidates.Count -gt 0) {
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

function Write-PrinterEnv($port, $pythonExe, $fontPath, $printMethod, $windowsPrinterName) {
  Write-Step "Writing local config"
  $content = @(
    "# Auto generated. You may edit this file manually.",
    "LIBMS_NIIMBOT_PORT=$port",
    "LIBMS_PRINT_PORT=17888",
    "LIBMS_PYTHON_BIN=$pythonExe",
    "LIBMS_LABEL_FONT=$fontPath",
    "LIBMS_PRINT_METHOD=$printMethod",
    "LIBMS_WINDOWS_PRINTER_NAME=$windowsPrinterName"
  ) -join "`r`n"

  Set-Content -Path $envFile -Value $content -Encoding ASCII
  Write-Ok "Config written: $envFile"
}

function Start-Bridge($port, $pythonExe, $fontPath, $printMethod, $windowsPrinterName) {
  Write-Step "Starting local print bridge"
  $env:LIBMS_NIIMBOT_PORT = $port
  $env:LIBMS_PRINT_PORT = "17888"
  $env:LIBMS_PYTHON_BIN = $pythonExe
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
  Write-Host "- Python: $pythonExe"
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
  Write-Host "Install or startup failed:" -ForegroundColor Red
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ""
  Write-Host "Send windows\install-log.txt to Codex if you need diagnosis." -ForegroundColor Yellow
  exit 1
}
