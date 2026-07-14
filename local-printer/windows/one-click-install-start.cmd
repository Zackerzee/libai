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
  echo ERROR: one-click-install-start.ps1 not found.
  echo.
  echo Do not run this file inside the zip preview.
  echo Please right click the zip file, choose Extract All, then run it again.
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
