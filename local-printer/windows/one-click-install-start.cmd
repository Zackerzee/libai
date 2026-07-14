@echo off
setlocal
title LIBMS Print Bridge Installer

set "SCRIPT_DIR=%~dp0"
set "PS_SCRIPT=%SCRIPT_DIR%one-click-install-start.ps1"
set "LOG_FILE=%SCRIPT_DIR%install-log.txt"

echo.
echo ========================================
echo  LIBMS Windows Print Bridge
echo ========================================
echo.

if not exist "%PS_SCRIPT%" (
  echo.
  echo [错误] 没有找到 one-click-install-start.ps1。
  echo.
  echo 你现在很可能还在 zip 压缩包预览里。
  echo 请先点击文件管理器右上角“全部解压”，
  echo 然后进入解压出来的 local-printer 文件夹，
  echo 再双击 1-START-WINDOWS.cmd。
  echo.
  pause
  exit /b 1
)

where powershell.exe >nul 2>nul
if errorlevel 1 (
  echo ERROR: powershell.exe not found.
  echo Windows PowerShell is required.
  pause
  exit /b 1
)

echo Running installer. This window will stay open.
echo Log file: %LOG_FILE%
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "Start-Transcript -Path '%LOG_FILE%' -Force; & '%PS_SCRIPT%'; $code=$LASTEXITCODE; Stop-Transcript; exit $code"
set "EXIT_CODE=%ERRORLEVEL%"

echo.
echo ========================================
echo Installer exited with code %EXIT_CODE%.
echo If printing still does not work, send this file to Codex:
echo %LOG_FILE%
echo ========================================
echo.
echo Health URL:
echo http://127.0.0.1:17888/health
echo.

pause
exit /b %EXIT_CODE%
