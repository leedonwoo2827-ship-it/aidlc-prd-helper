@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"
title PRD Helper

if not exist node_modules goto needsetup
if not exist .env goto needsetup

set PORT=4319
for /f "usebackq eol=# tokens=1,* delims==" %%a in (".env") do if /i "%%a"=="PORT" if not "%%b"=="" set PORT=%%b

echo PRD Helper: http://127.0.0.1:%PORT%/
echo 종료하려면 이 창에서 Ctrl+C
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:%PORT%/'"
call npm start
pause
exit /b 0

:needsetup
echo 먼저 setup.bat 을 실행하세요.
pause
exit /b 1
