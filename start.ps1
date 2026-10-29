# BotsApp PowerShell Launcher
$botDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $botDir

Write-Host "===================================================" -ForegroundColor Cyan
Write-Host "   BotsApp - Enterprise WhatsApp Gateway Service   " -ForegroundColor Green
Write-Host "===================================================" -ForegroundColor Cyan

$node = Get-Command "node" -ErrorAction SilentlyContinue
if (-not $node) {
    Write-Host "[ERROR] Node.js is not found in PATH! Please install Node.js." -ForegroundColor Red
    pause
    exit 1
}

Write-Host "Starting BotsApp Server..." -ForegroundColor Yellow
node src/index.js

