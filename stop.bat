@echo off
echo 正在停止服务器...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3020" ^| findstr "LISTENING"') do (
    echo 找到进程ID: %%a
    taskkill /F /PID %%a
    echo 服务器已停止
    goto :end
)
echo 未找到运行中的服务器
:end
pause
