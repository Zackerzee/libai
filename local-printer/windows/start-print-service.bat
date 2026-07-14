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

if not defined LIBMS_NIIMBOT_PORT set "LIBMS_NIIMBOT_PORT=COM3"
if not defined LIBMS_PRINT_PORT set "LIBMS_PRINT_PORT=17888"
if not defined LIBMS_PYTHON_BIN set "LIBMS_PYTHON_BIN=python"

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

"%LIBMS_PYTHON_BIN%" --version >nul 2>nul
if errorlevel 1 (
  echo [错误] 未检测到 Python：%LIBMS_PYTHON_BIN%
  echo 请先安装 Python，并确认 printer.env 里的 LIBMS_PYTHON_BIN 配置正确。
  pause
  exit /b 1
)

"%LIBMS_PYTHON_BIN%" -c "import PIL" >nul 2>nul
if errorlevel 1 (
  echo 正在安装 Python 图片依赖 Pillow...
  "%LIBMS_PYTHON_BIN%" -m pip install pillow
  if errorlevel 1 (
    echo [错误] Pillow 安装失败。请检查网络或 Python/pip 配置。
    pause
    exit /b 1
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
echo - 标签机串口：%LIBMS_NIIMBOT_PORT%
echo.
echo 保持此窗口运行，网页开台后会自动打印标签。
echo 如需后台自动启动，请运行 install-autostart.bat。
echo.

node server.js

echo.
echo 打印桥已退出。如果不是你手动关闭，请检查上方错误信息。
pause
