@echo off
chcp 936 >nul
echo ========================================
echo    PM2 Start Server
echo ========================================
echo.

cd /d %~dp0

echo Starting server with PM2...
pm2 start ecosystem.config.js

timeout /t 2 >nul

echo.
echo ========================================
pm2 status
echo ========================================
echo.
echo Server started with PM2!
echo.
echo Commands:
echo   pm2 status       - View status
echo   pm2 logs         - View logs
echo   pm2 restart all  - Restart server
echo   pm2 stop all     - Stop server
echo ========================================

pause
