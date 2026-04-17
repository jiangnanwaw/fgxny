@echo off
chcp 936 >nul
echo Restarting server...
call %~dp0stop_temp.txt
timeout /t 2 >nul
call %~dp0start_temp.txt
