@echo off
echo ========================================
echo    服务器状态检查 (端口3020)
echo ========================================
echo.
netstat -ano | findstr ":3020" | findstr "LISTENING"
if %errorlevel% equ 0 (
    echo.
    echo 服务器正在运行
    echo 访问地址: http://localhost:3020
) else (
    echo.
    echo 服务器未运行
)
echo.
pause
