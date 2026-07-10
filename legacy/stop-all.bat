@echo off
chcp 65001 >nul
setlocal

echo ArchLifeOS のバックエンド(DB / API / ローカルAI)を停止します...
pushd "%~dp0archlife-backend"
docker compose --profile ai down
popd

echo.
echo 停止しました。フロントエンド(npm run dev)のウィンドウは手動で閉じてください。
echo.
pause
