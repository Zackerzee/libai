@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "RUNNER=%ROOT_DIR%windows\one-click-install-start.cmd"

if not exist "%RUNNER%" (
  echo ERROR: windows\one-click-install-start.cmd not found.
  echo Please extract the zip first, then run this file from the extracted folder.
  pause
  exit /b 1
)

start "LIBMS Print Bridge" cmd.exe /k ""%RUNNER%""
exit /b 0
