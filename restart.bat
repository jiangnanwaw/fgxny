@echo off
echo 正在重启服务...
call "%~dp0停止服务.bat"
timeout /t 2 >/dev/null
call "%~dp0启动服务.bat"
