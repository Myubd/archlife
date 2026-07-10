@echo off
setlocal enabledelayedexpansion

echo ============================================
echo  Starting ArchLifeOS (local-only mode)
echo ============================================
echo.

REM --- required commands ---------------------------------------------------
where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] node command not found. Please install Node.js.
  pause
  exit /b 1
)

where python3 >nul 2>nul
if errorlevel 1 (
  echo [ERROR] python3 command not found. Please install Python.
  pause
  exit /b 1
)

REM --- Ollama (local AI) check. Not required to continue. -------------------
where ollama >nul 2>nul
if errorlevel 1 (
  echo [WARNING] ollama command not found. Install Ollama to use AI features.
  echo           Non-AI features will still work without it.
) else (
  echo [1/5] Checking Ollama model qwen3:8b - this is quick if already installed...
  ollama pull qwen3:8b
)

echo [2/5] Starting backend (FastAPI)...
start "ArchLife Backend" "%~dp0_backend.bat"

echo [3/5] Waiting for backend to become healthy...
set "HEALTH_OK=0"
for /l %%i in (1,1,15) do (
  if "!HEALTH_OK!"=="0" (
    curl -s -o nul -w "%%{http_code}" http://127.0.0.1:8080/health > "%TEMP%\archlife_health.txt" 2>nul
    set /p HTTP_CODE=<"%TEMP%\archlife_health.txt"
    if "!HTTP_CODE!"=="200" (
      set "HEALTH_OK=1"
    ) else (
      timeout /t 1 /nobreak >nul
    )
  )
)

if "!HEALTH_OK!"=="1" (
  echo   -^> OK: http://127.0.0.1:8080/health responded.
) else (
  echo   -^> [WARNING] No response yet. Check the "ArchLife Backend" window log.
)

echo [4/5] Starting frontend (Vite)...
start "ArchLife Frontend" "%~dp0_frontend.bat"

echo   Waiting a moment for Vite to boot...
timeout /t 5 /nobreak >nul

echo [5/5] Starting Electron app...
cd /d "%~dp0electron-app"
if not exist node_modules (
  echo   Installing dependencies for the first time...
  call npm install
)
call npm start

echo.
echo Done. The "ArchLife Backend" window is still running in the
echo background - close it manually or press Ctrl+C in it to stop.
echo.
pause
