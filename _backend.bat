@echo off
cd /d "%~dp0archlife-fastapi"
set "DATA_DIR=%LOCALAPPDATA%\ArchLifeOS-dev"
if not exist "%DATA_DIR%" mkdir "%DATA_DIR%"
echo DATA_DIR=%DATA_DIR%
python3 -m uvicorn main:app --host 127.0.0.1 --port 8080
