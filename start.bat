@echo off
title BotsApp - WhatsApp Gateway
echo ===================================================
echo   BotsApp - Enterprise WhatsApp Gateway Service
echo ===================================================
echo.
cd /d "%~dp0"

where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [ERROR] Node.js is not installed or not in PATH!
    echo Please install Node.js (v18+ or v20+) from https://nodejs.org
    pause
    exit /b 1
)

echo Starting BotsApp Server...
node src/index.js
pause
