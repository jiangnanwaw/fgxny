@echo off
chcp 936 >nul
echo ========================================
echo    PM2 Server Status
echo ========================================
echo.

cd /d %~dp0

pm2 status
echo.
echo ========================================
echo Commands:
echo   pm2 logs sqlserver-proxy  - View logs
echo   pm2 monit                 - Monitor
echo ========================================

pause
