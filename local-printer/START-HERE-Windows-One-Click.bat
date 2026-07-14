@echo off
chcp 65001 >nul
setlocal
title 时里白造物 Windows 一键打印桥

set "ROOT_DIR=%~dp0"
set "START_SCRIPT=%ROOT_DIR%windows\one-click-install-start.bat"

echo.
echo ========================================
echo  时里白造物 Windows 一键打印桥
echo ========================================
echo.

if not exist "%START_SCRIPT%" (
  echo [错误] 没有找到 windows\one-click-install-start.bat
  echo.
  echo 请先右键 zip，选择“全部解压”，不要在压缩包预览里直接运行。
  echo.
  pause
  exit /b 1
)

call "%START_SCRIPT%"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo 如果仍然无法打印，请把 windows\install-log.txt 发给 Codex。
pause
exit /b %EXIT_CODE%
