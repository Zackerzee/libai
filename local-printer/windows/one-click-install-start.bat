@echo off
chcp 65001 >nul
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0one-click-install-start.ps1"
echo.
echo 如果窗口停在这里，请查看上方提示。
pause
