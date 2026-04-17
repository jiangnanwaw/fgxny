@echo off
chcp 936 >nul
echo ========================================
echo    PM2 Restart Server
echo ========================================
echo.

cd /d %~dp0

echo Restarting server...
pm2 restart sqlserver-proxy

timeout /t 2 >nul

echo.
pm2 status
echo.
echo Server restarted!

pause
