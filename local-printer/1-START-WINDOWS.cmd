@echo off
setlocal
set "ROOT_DIR=%~dp0"
set "RUNNER=%ROOT_DIR%windows\one-click-install-start.cmd"

if not exist "%RUNNER%" (
  echo.
  echo [错误] 当前不是完整解压后的文件夹。
  echo.
  echo 你现在很可能还在 zip 压缩包预览里。
  echo 请先点击文件管理器右上角“全部解压”，
  echo 然后进入解压出来的 local-printer 文件夹，
  echo 再双击 1-START-WINDOWS.cmd。
  echo.
  pause
  exit /b 1
)

start "LIBMS Print Bridge" cmd.exe /k ""%RUNNER%""
exit /b 0
