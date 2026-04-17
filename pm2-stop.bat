@echo off
chcp 936 >nul
echo ========================================
echo    PM2 Stop Server
echo ========================================
echo.

cd /d %~dp0

echo Stopping server...
pm2 stop sqlserver-proxy

timeout /t 1 >nul

echo.
pm2 status
echo.
echo Server stopped!

pause
