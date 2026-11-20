@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title PRD Helper - setup

echo ============================================
echo   AI-DLC PRD Helper - 설치
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 goto nonode
for /f "tokens=1 delims=." %%v in ('node -p "process.versions.node"') do set NODEMAJOR=%%v
if !NODEMAJOR! LSS 22 goto nonode
echo [OK] Node.js
node -v

echo.
echo [1/3] 패키지 설치 중...
call npm ci --ignore-scripts
if errorlevel 1 (
  echo [오류] npm ci 실패
  pause
  exit /b 1
)

echo.
echo [2/3] AI 코치 연결 방식 선택 - 이미 로그인된 CLI의 OAuth 구독을 사용합니다
echo    1 = Claude Code CLI
echo    2 = Codex CLI
set CHOICE=
set /p CHOICE=번호 [기본 1]:
if "!CHOICE!"=="" set CHOICE=1
set PROVIDER=claude
if "!CHOICE!"=="2" set PROVIDER=codex

where !PROVIDER! >nul 2>nul
if errorlevel 1 (
  echo [경고] !PROVIDER! 명령을 찾을 수 없습니다.
  if "!PROVIDER!"=="claude" echo        설치: npm install -g @anthropic-ai/claude-code
  if "!PROVIDER!"=="codex" echo        설치: npm install -g @openai/codex
) else (
  echo [OK] !PROVIDER! 확인됨
)

set PORT=
set /p PORT=포트 [기본 4319]:
if "!PORT!"=="" set PORT=4319

echo.
echo [3/3] .env 작성
> .env echo PORT=!PORT!
>> .env echo COACH_PROVIDER=!PROVIDER!
>> .env echo COACH_MODEL=
echo [OK] .env 저장: PORT=!PORT!, COACH_PROVIDER=!PROVIDER!

:login
echo.
echo --------------------------------------------
echo  로그인이 안 되어 있다면 먼저 로그인하세요:
echo    Claude : 터미널에서 claude 실행 후 /login
echo    Codex  : 터미널에서 codex login
echo  API 키는 필요 없습니다. ANTHROPIC_API_KEY 는 사용하지 않습니다.
echo --------------------------------------------
echo  설치 완료. run.bat 을 실행하세요.
pause
exit /b 0

:nonode
echo [오류] Node.js 22 이상이 필요합니다: https://nodejs.org
pause
exit /b 1
