@echo off
setlocal enabledelayedexpansion

echo.
echo ========================================
echo   ArchLifeOS Release Tool
echo ========================================
echo.

set LATEST_TAG=v0.0.0
for /f "tokens=*" %%i in ('git tag --sort=version:refname') do set LATEST_TAG=%%i

echo Current latest tag: %LATEST_TAG%
echo.

set VERSION=%LATEST_TAG:v=%

for /f "tokens=1,2,3 delims=." %%a in ("%VERSION%") do (
    set MAJOR=%%a
    set MINOR=%%b
    set PATCH=%%c
)

set /a NEXT_MAJOR=%MAJOR%+1
set /a NEXT_MINOR=%MINOR%+1
set /a NEXT_PATCH=%PATCH%+1

set NEW_MAJOR=v%NEXT_MAJOR%.0.0
set NEW_MINOR=v%MAJOR%.%NEXT_MINOR%.0
set NEW_PATCH=v%MAJOR%.%MINOR%.%NEXT_PATCH%

echo Select release type:
echo.
echo   1. Major  (%LATEST_TAG% -^> %NEW_MAJOR%)
echo   2. Minor  (%LATEST_TAG% -^> %NEW_MINOR%)
echo   3. Patch  (%LATEST_TAG% -^> %NEW_PATCH%)
echo   0. Cancel
echo.
set /p CHOICE=Enter number: 

if "%CHOICE%"=="1" set NEW_TAG=%NEW_MAJOR%
if "%CHOICE%"=="2" set NEW_TAG=%NEW_MINOR%
if "%CHOICE%"=="3" set NEW_TAG=%NEW_PATCH%
if "%CHOICE%"=="0" ( echo Cancelled. & pause & exit /b 0 )
if not defined NEW_TAG ( echo Invalid input. & pause & exit /b 1 )

echo.
echo New tag: %NEW_TAG%
echo.
set /p COMMIT_MSG=Commit message (blank to skip): 

echo.
if not "%COMMIT_MSG%"=="" echo   git add . + git commit
echo   git push origin main
echo   git tag %NEW_TAG%
echo   git push origin %NEW_TAG%
echo.
set /p CONFIRM=Proceed? (y/n): 
if /i not "%CONFIRM%"=="y" ( echo Cancelled. & pause & exit /b 0 )

echo.
if not "%COMMIT_MSG%"=="" (
    echo [1/4] Committing...
    git add .
    git commit -m "%COMMIT_MSG%"
) else (
    echo [1/4] Skipping commit.
)

echo [2/4] Pushing main...
git push origin main
if errorlevel 1 ( echo Push failed. & pause & exit /b 1 )

echo [3/4] Creating tag %NEW_TAG%...
git tag %NEW_TAG%
if errorlevel 1 ( echo Tag already exists. & pause & exit /b 1 )

echo [4/4] Pushing tag...
git push origin %NEW_TAG%
if errorlevel 1 ( echo Tag push failed. & pause & exit /b 1 )

echo.
echo ========================================
echo   Released: %NEW_TAG%
echo   https://github.com/Myubd/archlife/actions
echo ========================================
echo.
pause
