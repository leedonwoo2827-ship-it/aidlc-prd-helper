@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"
title PRD Helper - setup

echo ============================================
echo   AI-DLC PRD Helper - 설치 (입력 없이 자동 진행)
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
echo [2/3] AI 코치 CLI 확인
set PROVIDER=
where claude >nul 2>nul && set PROVIDER=claude
if not defined PROVIDER (
  where codex >nul 2>nul && set PROVIDER=codex
)
if not defined PROVIDER (
  set PROVIDER=claude
  echo [경고] claude / codex 명령을 찾을 수 없습니다. 설치 후 다시 실행하세요.
  echo        Claude: npm install -g @anthropic-ai/claude-code
  echo        Codex : npm install -g @openai/codex
) else (
  echo [OK] !PROVIDER! 사용
)

echo.
echo [3/3] 설정 파일 .env
if exist .env (
  echo [OK] 기존 .env 를 그대로 사용합니다.
) else (
  > .env echo PORT=4319
  >> .env echo COACH_PROVIDER=!PROVIDER!
  >> .env echo COACH_MODEL=
  echo [OK] .env 생성: PORT=4319, COACH_PROVIDER=!PROVIDER!
)

echo.
echo --------------------------------------------
echo  설치 완료. run.bat 을 실행하세요.
echo  로그인은 웹 화면 오른쪽 위 [로그인] 버튼으로 할 수 있습니다.
echo  Codex 로 바꾸려면 .env 의 COACH_PROVIDER=codex 로 수정하세요.
echo --------------------------------------------
timeout /t 15
exit /b 0

:nonode
echo [오류] Node.js 22 이상이 필요합니다: https://nodejs.org
pause
exit /b 1
