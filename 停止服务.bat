@echo off
chcp 936 >nul
echo Stopping server...

for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":3020" ^| findstr "LISTENING"') do (
    echo Found process ID: %%a
    taskkill /F /PID %%a
    echo Server stopped
    goto :end
)
echo No running server found
:end
pause
