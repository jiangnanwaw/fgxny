@echo off
chcp 936 >nul
echo ========================================
echo    PM2 Setup Auto-Start
echo ========================================
echo.

cd /d %~dp0

echo Saving PM2 process list...
pm2 save

echo.
echo Setting up PM2 startup...
pm2 startup

echo.
echo ========================================
echo PM2 auto-start configured!
echo Server will start automatically on boot.
echo ========================================

pause
