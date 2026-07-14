@echo off
setlocal
set "SCRIPT_DIR=%~dp0"
set "RUNNER=%SCRIPT_DIR%one-click-install-start.cmd"

if not exist "%RUNNER%" (
  echo ERROR: one-click-install-start.cmd not found.
  echo Please extract the zip first, then run this file from the extracted folder.
  pause
  exit /b 1
)

start "LIBMS Print Bridge" cmd.exe /k ""%RUNNER%""
exit /b 0
