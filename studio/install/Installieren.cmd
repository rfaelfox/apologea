@echo off
chcp 65001 >nul
title APOLOGEA Studio - Installation
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install\install.ps1"
if errorlevel 1 (
  echo.
  echo Die Installation wurde nicht vollstaendig abgeschlossen. Bitte die Meldungen oben pruefen.
)
echo.
pause
