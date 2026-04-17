@echo off
echo ========================================
echo    启动服务器 (端口3020)
echo ========================================
echo.

cd /d "%~dp0"

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3020" ^| findstr "LISTENING"') do (
    echo 端口3020已被占用，进程ID: %%a
    echo 正在停止现有服务...
    taskkill /F /PID %%a >/dev/null 2>&1
    timeout /t 2 >/dev/null
)

echo 正在启动服务器...
start /B node proxy-server.js > server-output.log 2> server-error.log

timeout /t 3 >/dev/null

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3020" ^| findstr "LISTENING"') do (
    echo ========================================
    echo 服务器已启动！
    echo ========================================
    echo 进程ID: %%a
    echo 端口: 3020
    echo 本地访问: http://localhost:3020
    echo 外网访问: http://csfhcdz.f3322.net:3020
    echo ========================================
    goto :end
)

echo 服务器启动失败，请检查 server-error.log

:end
pause
