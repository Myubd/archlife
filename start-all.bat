@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo  ArchLifeOS を起動します (AIなし: DB + API + フロント)
echo ============================================
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [エラー] docker コマンドが見つかりません。Docker Desktop をインストールし、起動してください。
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [エラー] node コマンドが見つかりません。Node.js をインストールしてください。
  pause
  exit /b 1
)

echo [1/3] バックエンド(DB + APIサーバー)を起動しています...
pushd "%~dp0archlife-backend"
docker compose up -d --build
if errorlevel 1 (
  echo [エラー] docker compose の起動に失敗しました。Docker Desktop が起動しているか確認してください。
  popd
  pause
  exit /b 1
)
popd

echo [2/3] APIサーバーの起動を確認しています...
set "HEALTH_OK=0"
for /l %%i in (1,1,15) do (
  if "!HEALTH_OK!"=="0" (
    curl -s -o nul -w "%%{http_code}" http://localhost:8080/health > "%TEMP%\archlife_health.txt" 2>nul
    set /p HTTP_CODE=<"%TEMP%\archlife_health.txt"
    if "!HTTP_CODE!"=="200" (
      set "HEALTH_OK=1"
    ) else (
      timeout /t 1 /nobreak >nul
    )
  )
)

if "!HEALTH_OK!"=="1" (
  echo   -^> OK: http://localhost:8080/health が応答しました。
) else (
  echo   -^> [警告] まだ応答がありません。次のコマンドでログを確認してください: docker compose logs -f
)

echo [3/3] フロントエンドを起動しています(新しいウィンドウが開きます)...
start "ArchLife Frontend" cmd /k "cd /d "%~dp0archlife-frontend" && (if not exist node_modules npm install) && (if not exist .env.local copy .env.example .env.local >nul) && npm run dev"

echo.
echo 完了しました。フロントエンドのウィンドウに表示されるURL(通常 http://localhost:5173 )を開いてください。
echo AI機能を使いたい場合は、別途 start-ai.bat を実行してください。
echo.
pause
