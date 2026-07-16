@echo off
chcp 65001 >nul
setlocal

set "SCRIPT_DIR=%~dp0"
set "ROOT_DIR=%SCRIPT_DIR%.."
set "ENV_FILE=%SCRIPT_DIR%printer.env"

cd /d "%ROOT_DIR%"

echo.
echo ========================================
echo  时里白造物 NIIMBOT B3S-P 本机打印桥
echo ========================================
echo.

if not exist "%ENV_FILE%" (
  echo 未找到 printer.env，正在从示例配置创建...
  copy "%SCRIPT_DIR%printer.env.example" "%ENV_FILE%" >nul
  echo 已创建：%ENV_FILE%
  echo 请先运行 check-com-ports.bat 查看串口号，再修改 printer.env 里的 LIBMS_NIIMBOT_PORT。
  echo.
)

for /f "usebackq eol=# tokens=1,* delims==" %%A in ("%ENV_FILE%") do (
  if not "%%A"=="" set "%%A=%%B"
)

if not defined LIBMS_NIIMBOT_PORT set "LIBMS_NIIMBOT_PORT=auto"
if not defined LIBMS_TRY_BLUETOOTH_PORTS set "LIBMS_TRY_BLUETOOTH_PORTS=0"
if not defined LIBMS_PRINT_PORT set "LIBMS_PRINT_PORT=17888"
if not defined LIBMS_PYTHON_BIN set "LIBMS_PYTHON_BIN=python"
if not defined LIBMS_PYTHON_ARGS set "LIBMS_PYTHON_ARGS="
if not defined LIBMS_LABEL_FONT set "LIBMS_LABEL_FONT=C:\Windows\Fonts\msyh.ttc"
set "LIBMS_PRINT_METHOD=serial"
set "LIBMS_WINDOWS_PRINTER_NAME="

where node >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Node.js。请先安装 Node.js 18 或更高版本。
  echo 安装后重新打开本窗口再运行本脚本。
  pause
  exit /b 1
)

where npm >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 npm。请确认 Node.js 已正确安装。
  pause
  exit /b 1
)

"%LIBMS_PYTHON_BIN%" %LIBMS_PYTHON_ARGS% --version >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Python：%LIBMS_PYTHON_BIN% %LIBMS_PYTHON_ARGS%
  echo 请先安装 Python，并确认 printer.env 里的 LIBMS_PYTHON_BIN 配置正确。
  pause
  exit /b 1
)

"%LIBMS_PYTHON_BIN%" %LIBMS_PYTHON_ARGS% -c "import PIL" >nul 2>nul
if errorlevel 1 (
  echo 正在安装 Python 图片依赖 Pillow...
  "%LIBMS_PYTHON_BIN%" %LIBMS_PYTHON_ARGS% -m pip install pillow
  if errorlevel 1 (
    echo [错误] Pillow 安装失败。请检查网络或 Python/pip 配置。
    pause
    exit /b 1
  )
)

if defined LIBMS_WINDOWS_PRINTER_NAME (
  "%LIBMS_PYTHON_BIN%" %LIBMS_PYTHON_ARGS% -c "import win32print, win32ui" >nul 2>nul
  if errorlevel 1 (
    echo 正在安装 Windows 打印队列依赖 pywin32...
    "%LIBMS_PYTHON_BIN%" %LIBMS_PYTHON_ARGS% -m pip install --upgrade pywin32
    if errorlevel 1 (
      echo [提醒] pywin32 安装失败。串口打印仍会尝试，但 Windows 队列兜底不可用。
      echo.
    )
  )
)

if defined LIBMS_LABEL_FONT (
  if not exist "%LIBMS_LABEL_FONT%" (
    echo [提醒] 未找到字体文件：%LIBMS_LABEL_FONT%
    echo 标签仍会尝试打印，但中文可能显示异常。建议在 printer.env 里改成 C:\Windows\Fonts\msyh.ttc 或 simhei.ttf。
    echo.
  )
)

if not exist "%ROOT_DIR%\node_modules\@mmote\niimbluelib" (
  echo 正在安装 Node 打印依赖...
  npm install
  if errorlevel 1 (
    echo [错误] npm install 失败。请检查网络或 Node.js 配置。
    pause
    exit /b 1
  )
)

echo.
echo 打印桥即将启动：
echo - 服务地址：http://127.0.0.1:%LIBMS_PRINT_PORT%
echo - 打印模式：%LIBMS_PRINT_METHOD%
if defined LIBMS_WINDOWS_PRINTER_NAME echo - Windows 打印机：%LIBMS_WINDOWS_PRINTER_NAME%
echo - 标签机串口：%LIBMS_NIIMBOT_PORT%
echo - 尝试蓝牙串口：%LIBMS_TRY_BLUETOOTH_PORTS%
echo - 标签字体：%LIBMS_LABEL_FONT%
echo - Python：%LIBMS_PYTHON_BIN% %LIBMS_PYTHON_ARGS%
echo.
echo 保持此窗口运行，网页开台后会自动打印标签。
echo 如需后台自动启动，请运行 install-autostart.bat。
echo.

node server.js

echo.
echo 打印桥已退出。如果不是你手动关闭，请检查上方错误信息。
pause
