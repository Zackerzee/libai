$ErrorActionPreference = "Stop"

$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "LIBMS NIIMBOT Print Bridge.lnk"
$vbsPath = Join-Path $PSScriptRoot "start-hidden.vbs"

Write-Host ""
Write-Host "正在安装开机自启快捷方式..." -ForegroundColor Cyan

if (-not (Test-Path $vbsPath)) {
  throw "找不到 start-hidden.vbs：$vbsPath"
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "wscript.exe"
$shortcut.Arguments = "`"$vbsPath`""
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.WindowStyle = 7
$shortcut.Description = "时里白造物 NIIMBOT B3S-P 本机打印桥"
$shortcut.Save()

Write-Host "已安装：" -ForegroundColor Green
Write-Host $shortcutPath
Write-Host ""
Write-Host "下次登录 Windows 后会自动启动本机打印桥。"
Write-Host "当前也可以手动运行 start-print-service.bat 立即启动。"
