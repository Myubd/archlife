@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion

echo ============================================
echo  ArchLifeOS ローカルAI(Ollama)を起動します
echo ============================================
echo.
echo ※ 先に start-all.bat でバックエンドを起動しておいてください。
echo.

where docker >nul 2>nul
if errorlevel 1 (
  echo [エラー] docker コマンドが見つかりません。Docker Desktop をインストールし、起動してください。
  pause
  exit /b 1
)

echo [1/2] Ollamaコンテナを起動しています(初回はイメージ取得のため時間がかかります)...
pushd "%~dp0archlife-backend"
docker compose --profile ai up -d --build
if errorlevel 1 (
  echo [エラー] Ollamaコンテナの起動に失敗しました。
  popd
  pause
  exit /b 1
)

echo [2/2] モデル(qwen3:8b)を確認・取得しています(初回は数分かかることがあります)...
docker exec archlife-ollama ollama pull qwen3:8b
popd

echo.
echo 起動状況:
curl -s http://localhost:8080/api/ai/status
echo.
echo.
echo 完了しました。アプリの「AI」タブを開いて動作を確認してください。
echo.
pause
