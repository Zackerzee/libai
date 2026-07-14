@echo off
chcp 65001 >nul
setlocal
title 时里白造物 Windows 一键打印桥

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%one-click-install-start.ps1"
set "LOG_FILE=%SCRIPT_DIR%install-log.txt"

echo ======================================== > "%LOG_FILE%"
echo 时里白造物 Windows 一键打印桥 >> "%LOG_FILE%"
echo 启动时间：%date% %time% >> "%LOG_FILE%"
echo ======================================== >> "%LOG_FILE%"
echo. >> "%LOG_FILE%"

echo.
echo ========================================
echo  时里白造物 Windows 一键打印桥
echo ========================================
echo.

if not exist "%PS_SCRIPT%" (
  echo [错误] 没有找到 one-click-install-start.ps1
  echo.
  echo 请不要在 zip 压缩包里直接双击运行。
  echo 正确做法：
  echo 1. 先右键 zip，选择“全部解压”
  echo 2. 进入解压后的 local-printer\windows 文件夹
  echo 3. 再双击 one-click-install-start.bat
  echo.
  echo [错误] 没有找到 one-click-install-start.ps1 >> "%LOG_FILE%"
  echo 请先全部解压 zip 后再运行。 >> "%LOG_FILE%"
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo [错误] 当前 Windows 找不到 powershell.exe，无法运行一键脚本。
  echo [错误] 当前 Windows 找不到 powershell.exe。 >> "%LOG_FILE%"
  pause
  exit /b 1
)

echo 正在启动安装脚本，请稍等...
echo 日志文件：%LOG_FILE%
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS_SCRIPT%" >> "%LOG_FILE%" 2>&1
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ========== 安装日志 ==========
type "%LOG_FILE%"
echo ==============================
echo.

if not "%EXIT_CODE%"=="0" (
  echo [失败] 一键安装或启动没有成功。错误码：%EXIT_CODE%
  echo 请把这个窗口最后的错误内容，或 install-log.txt 发给 Codex。
) else (
  echo [提示] 打印桥已退出。如果不是你手动关闭，请把 install-log.txt 发给 Codex。
)

echo.
echo health 测试地址：http://127.0.0.1:17888/health
pause
exit /b %EXIT_CODE%
