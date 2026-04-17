@echo off
chcp 936 >nul
echo ========================================
echo    Starting Server (Port 3020)
echo ========================================
echo.

cd /d %~dp0

netstat -ano | findstr ":3020" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo Port 3020 is in use, stopping...
    for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3020" ^| findstr "LISTENING"') do taskkill /F /PID %%a >nul 2>&1
    timeout /t 2 >nul
)

echo Starting server...
start /B node proxy-server.js

timeout /t 3 >nul

netstat -ano | findstr ":3020" | findstr "LISTENING" >nul
if %errorlevel% equ 0 (
    echo ========================================
    echo Server started successfully!
    echo Port: 3020
    echo Local: http://localhost:3020
    echo ========================================
) else (
    echo Server failed to start
    if exist server-error.log type server-error.log
)

pause
