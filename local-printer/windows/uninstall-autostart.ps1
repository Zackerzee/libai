$startupDir = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startupDir "LIBMS NIIMBOT Print Bridge.lnk"

Write-Host ""
Write-Host "正在移除开机自启快捷方式..." -ForegroundColor Cyan

if (Test-Path $shortcutPath) {
  Remove-Item $shortcutPath -Force
  Write-Host "已移除：" -ForegroundColor Green
  Write-Host $shortcutPath
} else {
  Write-Host "没有找到开机自启快捷方式，可能之前没有安装。" -ForegroundColor Yellow
}
